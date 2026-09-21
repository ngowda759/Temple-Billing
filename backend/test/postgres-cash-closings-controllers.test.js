// Phase 2AH controller-level tests for the Cash Closing endpoints.
//
// These drive the real accountController handlers (not the service in
// isolation) so the API contract is verified end-to-end:
//   - getCashClosings / submitCashClosing / verifyCashClosing persist and read
//     through the PostgreSQL repository when the datasource seam selects
//     PostgreSQL,
//   - the same handlers fall back to Mongoose when the seam selects Mongo,
//   - a write reaches exactly one datasource (no dual persistence),
//   - the accounting-calculation behaviour, response shapes and error handling
//     are unchanged from before the wiring.
//
// Two behaviours are deliberately preserved even though they look like defects.
// They are migration-compatibility requirements, NOT bugs to fix here:
//   1. `Cheque` and `System` are valid AccountTransaction payment methods, but
//      submitCashClosing only inspects four methods, so those amounts fall
//      through every branch and are excluded from the collected buckets.
//   2. `req.body.cashCollected` is ignored — the server recomputes it from
//      AccountTransaction and its value is authoritative.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const AccountTransaction = require("../src/models/AccountTransaction");
const CashClosing = require("../src/models/CashClosing");
const AuditLog = require("../src/models/AuditLog");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const hex24 = () => crypto.randomBytes(12).toString("hex");

let originalIsDbConnected;
let originalFind;
let originalCreate;
let originalAuditCreate;
let accountController;
let cashClosingService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const row of rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    }
  } finally {
    await pool.end();
  }
};

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const createMockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const pinConnected = () => { dbConfig.isDbConnected = () => true; };
const pinDisconnected = () => { dbConfig.isDbConnected = () => false; };

// Captures the collection read and the Mongo writes without touching real Mongo.
// submitCashClosing reads AccountTransaction on its existing (Mongo-only) path
// — that read is intentionally NOT migrated, because MongoDB is still the
// source of truth for accounting transactions and PostgreSQL is not backfilled.
const stubAccountingAndMongoWrites = (transactions = []) => {
  const calls = { findFilters: [], mongoCreates: [], auditCreates: [] };
  AccountTransaction.find = (filter) => {
    calls.findFilters.push(filter);
    return Promise.resolve(transactions);
  };
  CashClosing.create = async (data) => {
    calls.mongoCreates.push(data);
    return { ...data, _id: hex24() };
  };
  AuditLog.create = async (data) => {
    calls.auditCreates.push(data);
    return { ...data, _id: hex24() };
  };
  return calls;
};

const tx = (paymentMethod, amount) => ({
  paymentMethod,
  amount,
  transactionType: "Credit",
  status: "Completed",
});

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  originalFind = AccountTransaction.find;
  originalCreate = CashClosing.create;
  originalAuditCreate = AuditLog.create;

  await resetAllTables(TEST_DB_URL);
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  if (res.status !== 0) {
    throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);
  }

  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;

  accountController = require("../src/controllers/accountController");
  cashClosingService = require("../src/services/cashClosingService");
  pinConnected();
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  AccountTransaction.find = originalFind;
  CashClosing.create = originalCreate;
  AuditLog.create = originalAuditCreate;
  await closePostgres();
});

// ─── PostgreSQL path ───────────────────────────────────────────────────────
test("cash closing controller (PG): submitCashClosing persists one row and keeps the 201 shape", async () => {
  const userId = hex24();
  const calls = stubAccountingAndMongoWrites([tx("Cash", 500), tx("UPI", 250)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    {
      body: { openingCash: 1000, cashDeposited: 0, closingCash: 1500, notes: "PG submit" },
      user: { id: userId },
      ip: "10.0.0.1",
    },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.message, "Cash closing submitted successfully");
  assert.ok(res.body.closing, "response carries the closing document");
  assert.match(res.body.closing._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(res.body.closing.recordedBy, userId);

  // Persisted in PostgreSQL…
  const rows = await pgQuery("SELECT * FROM cash_closings WHERE id = $1", [res.body.closing._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(Number(rows[0].opening_cash), 1000);
  assert.strictEqual(Number(rows[0].closing_cash), 1500);

  // …and NOT also written to Mongo: exactly one datasource was written.
  assert.strictEqual(calls.mongoCreates.length, 0, "no dual write to Mongo");

  // The collection read still targets the cashier + Credit + Completed + day range.
  assert.strictEqual(calls.findFilters.length, 1);
  assert.strictEqual(calls.findFilters[0].recordedBy, userId);
  assert.strictEqual(calls.findFilters[0].transactionType, "Credit");
  assert.strictEqual(calls.findFilters[0].status, "Completed");
  assert.ok(calls.findFilters[0].date.$gte instanceof Date);
  assert.ok(calls.findFilters[0].date.$lte instanceof Date);
});

test("cash closing controller (PG): submitCashClosing computes the buckets and discrepancy unchanged", async () => {
  stubAccountingAndMongoWrites([
    tx("Cash", 500),
    tx("UPI", 250),
    tx("Card", 100),
    tx("Bank Transfer", 150),
  ]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 1000, cashDeposited: 200, closingCash: 1450 }, user: { id: hex24() }, ip: "10.0.0.2" },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  const c = res.body.closing;
  assert.strictEqual(c.cashCollected, 500);
  assert.strictEqual(c.upiCollected, 250);
  assert.strictEqual(c.cardCollected, 100);
  assert.strictEqual(c.bankTransferCollected, 150);
  assert.strictEqual(c.totalSystemCollection, 1000);
  // expected = opening(1000) + cashCollected(500) - cashDeposited(200) = 1300
  // discrepancy = closing(1450) - 1300 = 150
  assert.strictEqual(c.discrepancy, 150);
});

test("COMPAT: Cheque amounts fall through every branch and are excluded from the buckets", async () => {
  // A Cheque is a valid AccountTransaction payment method, but
  // submitCashClosing only inspects Cash/UPI/Card/Bank Transfer. The Cheque
  // amount must therefore be absent from every bucket AND from the total.
  stubAccountingAndMongoWrites([tx("Cash", 500), tx("Cheque", 999)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 0, cashDeposited: 0, closingCash: 500 }, user: { id: hex24() }, ip: "10.0.0.3" },
    res
  );

  const c = res.body.closing;
  assert.strictEqual(c.cashCollected, 500, "only the Cash transaction is counted");
  assert.strictEqual(c.upiCollected, 0);
  assert.strictEqual(c.cardCollected, 0);
  assert.strictEqual(c.bankTransferCollected, 0);
  assert.strictEqual(c.totalSystemCollection, 500, "Cheque 999 is NOT in the total (fall-through preserved)");
  assert.notStrictEqual(c.totalSystemCollection, 1499, "the Cheque amount must not be added");
});

test("COMPAT: System amounts fall through every branch and are excluded from the buckets", async () => {
  stubAccountingAndMongoWrites([tx("Cash", 100), tx("System", 777)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 0, cashDeposited: 0, closingCash: 100 }, user: { id: hex24() }, ip: "10.0.0.4" },
    res
  );

  const c = res.body.closing;
  assert.strictEqual(c.cashCollected, 100);
  assert.strictEqual(c.totalSystemCollection, 100, "System 777 is NOT in the total (fall-through preserved)");
});

test("COMPAT: req.body.cashCollected is ignored and the server value is authoritative", async () => {
  stubAccountingAndMongoWrites([tx("Cash", 500)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    {
      // The cashier form posts a cashCollected value; the server must ignore it.
      body: { openingCash: 1000, cashCollected: 99999, cashDeposited: 0, closingCash: 1500 },
      user: { id: hex24() },
      ip: "10.0.0.5",
    },
    res
  );

  const c = res.body.closing;
  assert.strictEqual(c.cashCollected, 500, "server-computed value wins over the client value");
  assert.notStrictEqual(c.cashCollected, 99999, "the client-posted value must never be authoritative");

  const rows = await pgQuery("SELECT cash_collected FROM cash_closings WHERE id = $1", [c._id]);
  assert.strictEqual(Number(rows[0].cash_collected), 500, "the stored row holds the server value");
});

test("cash closing controller (PG): a cashier with no transactions stores zero buckets", async () => {
  stubAccountingAndMongoWrites([]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 500, cashDeposited: 0, closingCash: 500 }, user: { id: hex24() }, ip: "10.0.0.6" },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.closing.cashCollected, 0);
  assert.strictEqual(res.body.closing.totalSystemCollection, 0);
  assert.strictEqual(res.body.closing.discrepancy, 0);
});

test("cash closing controller (PG): submitCashClosing writes the audit record like before", async () => {
  stubAccountingAndMongoWrites([tx("Cash", 100)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 0, cashDeposited: 0, closingCash: 100 }, user: { id: hex24() }, ip: "10.0.0.7" },
    res
  );

  const logs = await pgQuery(
    "SELECT action, module, details FROM audit_logs WHERE action = 'Submitted Shift Closing' AND ip_address = $1",
    ["10.0.0.7"]
  );
  assert.strictEqual(logs.length, 1, "the shift-closing audit record is still written");
  assert.strictEqual(logs[0].module, "Accounts & Finance");
  assert.match(logs[0].details, /Expected Cash/);
});

test("cash closing controller (PG): getCashClosings returns the populated shape with 200", async () => {
  const cashier = hex24();
  await pgQuery(
    "INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)",
    [cashier, `Cashier ${unique()}`, `${unique()}@temple.test`, "x", "cashier"]
  );
  stubAccountingAndMongoWrites([tx("Cash", 100)]);
  const submitRes = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 0, cashDeposited: 0, closingCash: 100 }, user: { id: cashier }, ip: "10.0.0.8" },
    submitRes
  );

  const res = createMockRes();
  await accountController.getCashClosings({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body));
  const found = res.body.find((c) => c._id === submitRes.body.closing._id);
  assert.ok(found, "submitted closing is listed");
  assert.ok(found.recordedBy && typeof found.recordedBy === "object", "recordedBy is populated");
  assert.strictEqual(found.recordedBy._id, cashier);
  assert.match(found.recordedBy.name, /^Cashier /);
  assert.strictEqual(found.cashDeposited, 0);
});

test("cash closing controller (PG): verifyCashClosing sets status + verifiedBy and returns 200", async () => {
  stubAccountingAndMongoWrites([tx("Cash", 100)]);
  const cashier = hex24();
  const accountant = hex24();
  const submitRes = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 0, cashDeposited: 0, closingCash: 100 }, user: { id: cashier }, ip: "10.0.0.9" },
    submitRes
  );
  const id = submitRes.body.closing._id;

  const res = createMockRes();
  await accountController.verifyCashClosing(
    { params: { id }, body: { status: "Verified" }, user: { id: accountant }, ip: "10.0.0.9" },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.message, "Cash closing Verified");
  assert.strictEqual(res.body.closing.status, "Verified");
  assert.strictEqual(res.body.closing.verifiedBy, accountant);

  const rows = await pgQuery("SELECT status, verified_by FROM cash_closings WHERE id = $1", [id]);
  assert.strictEqual(rows[0].status, "Verified");
  assert.strictEqual(rows[0].verified_by, accountant);
});

test("cash closing controller (PG): verifyCashClosing returns 404 for an unknown id", async () => {
  stubAccountingAndMongoWrites([]);
  const res = createMockRes();
  await accountController.verifyCashClosing(
    { params: { id: hex24() }, body: { status: "Verified" }, user: { id: hex24() }, ip: "10.0.0.10" },
    res
  );
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.message, "Cash closing not found");
});

test("cash closing controller (PG): submitCashClosing returns 500 when closingCash is missing", async () => {
  stubAccountingAndMongoWrites([tx("Cash", 100)]);
  const res = createMockRes();
  await accountController.submitCashClosing(
    // closingCash is required in the schema, so this payload is rejected.
    { body: { openingCash: 0, cashDeposited: 0 }, user: { id: hex24() }, ip: "10.0.0.11" },
    res
  );
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.message, "Failed to submit cash closing");
  assert.match(res.body.error, /closingCash is required/);
});

// ─── Mongo fallback ───────────────────────────────────────────────────────
test("cash closing controller (Mongo fallback): submitCashClosing writes through Mongoose", async () => {
  pinDisconnected();
  assert.strictEqual(await cashClosingService.usePostgres(), false);

  const userId = hex24();
  const calls = stubAccountingAndMongoWrites([tx("Cash", 500)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 1000, cashDeposited: 0, closingCash: 1500, notes: "Mongo submit" }, user: { id: userId }, ip: "10.0.0.12" },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(calls.mongoCreates.length, 1, "Mongoose create is the write path");
  assert.strictEqual(calls.mongoCreates[0].recordedBy, userId);
  assert.strictEqual(calls.mongoCreates[0].cashCollected, 500);

  // Nothing was written to PostgreSQL on the fallback branch (no dual write).
  const rows = await pgQuery("SELECT COUNT(*)::int AS n FROM cash_closings WHERE recorded_by = $1", [userId]);
  assert.strictEqual(rows[0].n, 0, "no PostgreSQL write on the Mongo fallback");
  pinConnected();
});

test("cash closing controller (Mongo fallback): the Cheque fall-through is preserved on Mongo too", async () => {
  pinDisconnected();
  const calls = stubAccountingAndMongoWrites([tx("Cash", 500), tx("Cheque", 999)]);

  const res = createMockRes();
  await accountController.submitCashClosing(
    { body: { openingCash: 0, cashDeposited: 0, closingCash: 500 }, user: { id: hex24() }, ip: "10.0.0.13" },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(calls.mongoCreates.length, 1);
  assert.strictEqual(calls.mongoCreates[0].totalSystemCollection, 500);
  pinConnected();
});