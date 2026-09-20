// Phase 2AF — Accounting transaction routing tests.
//
// `accountingService.recordTransaction` is the single ledger entry point every
// controller uses. Phase 2AF routes it through `accountTransactionService`,
// which writes to PostgreSQL when the datasource seam selects PostgreSQL (and
// PostgreSQL is actually reachable) and to the existing Mongoose model
// otherwise — never both.
//
// These tests drive the real service through the real repositories:
//   - the PostgreSQL path persists the transaction and the auto-created account
//     head and writes nothing to MongoDB,
//   - the Mongo fallback persists through Mongoose and writes nothing to
//     PostgreSQL,
//   - an unreachable PostgreSQL while the seam says "connected" still falls back
//     safely,
//   - the documented field mapping, idempotency and debit/credit semantics are
//     preserved,
//   - the head + transaction writes are ONE PostgreSQL transaction: a failure
//     leaves no partial accounting state.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const AccountTransaction = require("../src/models/AccountTransaction");
const AccountHead = require("../src/models/AccountHead");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let originalDatabaseUrl;
let accountingService;
let accountTransactionService;

const pinConnected = () => { dbConfig.isDbConnected = () => true; };
const pinDisconnected = () => { dbConfig.isDbConnected = () => false; };

const resetAccountTables = async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS account_transactions CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_heads CASCADE");
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

const payload = (overrides = {}) => ({
  transactionType: "Credit",
  source: "Donation",
  category: "Donation Income " + unique(),
  amount: 100.5,
  paymentMethod: "Cash",
  status: "Completed",
  description: "A donation",
  referenceId: "0000000000000000000000" + unique().slice(0, 2),
  referenceModel: "Donation",
  recordedBy: "0000000000000000000000a1",
  ...overrides,
});

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  originalDatabaseUrl = process.env.DATABASE_URL;

  await resetAccountTables();
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

  pinConnected();
  accountingService = require("../src/services/accountingService");
  accountTransactionService = require("../src/services/accountTransactionService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  await closePostgres();
});

// ─── A. PostgreSQL transaction path ────────────────────────────────────────
test("PG path: recordTransaction persists the ledger row and the auto-created head", async () => {
  pinConnected();
  const tx = payload();
  const mongoWrites = { create: 0, headCreate: 0 };
  const originalCreate = AccountTransaction.create;
  const originalHeadCreate = AccountHead.create;
  AccountTransaction.create = async () => { mongoWrites.create += 1; return null; };
  AccountHead.create = async () => { mongoWrites.headCreate += 1; return null; };

  try {
    const recorded = await accountingService.recordTransaction(tx);
    assert.ok(recorded && recorded._id, "a resolved document is returned");
    assert.strictEqual(recorded.amount, 100.5, "NUMERIC comes back as a Number");
    assert.strictEqual(recorded.transactionType, "Credit");
    assert.strictEqual(recorded.source, "Donation");

    const rows = await pgQuery(
      "SELECT transaction_type, source, category, amount::text AS amount, status, financial_year FROM account_transactions WHERE id = $1",
      [recorded._id]
    );
    assert.strictEqual(rows.length, 1, "exactly one PostgreSQL ledger row");
    assert.strictEqual(rows[0].transaction_type, "Credit");
    assert.strictEqual(rows[0].source, "Donation");
    assert.strictEqual(rows[0].category, tx.category);
    assert.strictEqual(rows[0].amount, "100.5");
    assert.strictEqual(rows[0].status, "Completed");
    assert.ok(rows[0].financial_year, "the derived financial year is stored");

    // The account head was auto-created on the same datasource.
    const head = await pgQuery("SELECT id, type FROM account_heads WHERE name = $1", [tx.category]);
    assert.strictEqual(head.length, 1, "the missing account head was auto-created in PostgreSQL");
    assert.strictEqual(head[0].type, "Income", "a Credit auto-creates an Income head");

    assert.strictEqual(mongoWrites.create, 0, "the PostgreSQL path wrote no Mongo transaction");
    assert.strictEqual(mongoWrites.headCreate, 0, "the PostgreSQL path wrote no Mongo account head");
  } finally {
    AccountTransaction.create = originalCreate;
    AccountHead.create = originalHeadCreate;
  }
});

test("PG path: a Debit auto-creates an Expense head (debit/credit semantics preserved)", async () => {
  pinConnected();
  const tx = payload({ transactionType: "Debit", source: "Payroll", referenceModel: "PayrollRecord", category: "Salaries " + unique() });
  const recorded = await accountingService.recordTransaction(tx);
  assert.ok(recorded._id);

  const rows = await pgQuery("SELECT transaction_type, status FROM account_transactions WHERE id = $1", [recorded._id]);
  assert.strictEqual(rows[0].transaction_type, "Debit", "a debit stays a debit");
  assert.strictEqual(rows[0].status, "Completed", "the explicit status is preserved");

  const head = await pgQuery("SELECT type FROM account_heads WHERE name = $1", [tx.category]);
  assert.strictEqual(head[0].type, "Expense", "a Debit auto-creates an Expense head");
});

test("PG path: field mapping — every payload field lands in its PostgreSQL column", async () => {
  pinConnected();
  const date = new Date("2026-05-04T10:20:30.000Z");
  const tx = payload({
    date,
    paymentMethod: "UPI",
    status: "Approved",
    description: "Mapped description",
    receiptNumber: "R-1",
    invoiceNumber: "INV-1",
    referenceId: "0000000000000000000000bb",
    referenceModel: "Donation",
    cashierId: "0000000000000000000000c1",
    cashierName: "Cashier One",
    recordedBy: "0000000000000000000000d1",
  });
  const recorded = await accountingService.recordTransaction(tx);

  const rows = await pgQuery(
    `SELECT date, financial_year, payment_method, status, description, receipt_number,
            invoice_number, reference_id, reference_model, cashier_id, cashier_name, recorded_by,
            created_at, updated_at
       FROM account_transactions WHERE id = $1`,
    [recorded._id]
  );
  const row = rows[0];
  assert.strictEqual(row.date.toISOString(), date.toISOString(), "date preserved");
  assert.strictEqual(row.financial_year, "2026-2027", "financial year derived Apr–Mar");
  assert.strictEqual(row.payment_method, "UPI");
  assert.strictEqual(row.status, "Approved");
  assert.strictEqual(row.description, "Mapped description");
  assert.strictEqual(row.receipt_number, "R-1");
  assert.strictEqual(row.invoice_number, "INV-1");
  assert.strictEqual(row.reference_id, "0000000000000000000000bb");
  assert.strictEqual(row.reference_model, "Donation");
  assert.strictEqual(row.cashier_id, "0000000000000000000000c1");
  assert.strictEqual(row.cashier_name, "Cashier One");
  assert.strictEqual(row.recorded_by, "0000000000000000000000d1");
  assert.ok(row.created_at instanceof Date, "timestamps are materialised");
});

test("PG path: idempotency — the same business event is recorded once", async () => {
  pinConnected();
  const tx = payload({
    referenceId: "00000000000000000000ff",
    referenceModel: "Donation",
    category: "Idempotent Head " + unique(),
  });

  const first = await accountingService.recordTransaction(tx);
  const second = await accountingService.recordTransaction(tx);

  assert.strictEqual(second._id, first._id, "the existing transaction is returned, not duplicated");
  const count = await pgQuery(
    "SELECT COUNT(*)::int AS n FROM account_transactions WHERE reference_id = $1 AND category = $2",
    [tx.referenceId, tx.category]
  );
  assert.strictEqual(count[0].n, 1, "exactly one ledger row for the business event");
});

test("PG path: an absent or non-positive amount is a silent no-op (caller contract preserved)", async () => {
  pinConnected();
  const before = await pgQuery("SELECT COUNT(*)::int AS n FROM account_transactions");

  assert.strictEqual(await accountingService.recordTransaction(payload({ amount: 0 })), null);
  assert.strictEqual(await accountingService.recordTransaction(payload({ amount: -5 })), null);
  assert.strictEqual(await accountingService.recordTransaction({}), null);

  const after = await pgQuery("SELECT COUNT(*)::int AS n FROM account_transactions");
  assert.strictEqual(after[0].n, before[0].n, "a non-positive amount writes nothing");
});

test("PG path: an invalid referenceModel is rejected as before", async () => {
  pinConnected();
  await assert.rejects(
    () => accountingService.recordTransaction(payload({ referenceModel: "NotAModel" })),
    /Invalid referenceModel/
  );
});

// ─── I. Atomicity ──────────────────────────────────────────────────────────
test("atomicity: a failing ledger insert rolls back the head created in the same unit of work", async () => {
  pinConnected();
  const category = "Atomic Head " + unique();

  // An unparseable date reaches PostgreSQL, so the INSERT fails *after* the
  // auto-created head was written. Both statements share one client, so the
  // head must not survive.
  await assert.rejects(
    () => accountingService.recordTransaction(payload({ category, date: "not-a-date" })),
    /invalid input syntax|timestamptz|timestamp/i,
    "the PostgreSQL failure propagates to the caller"
  );

  const heads = await pgQuery("SELECT id FROM account_heads WHERE name = $1", [category]);
  assert.strictEqual(heads.length, 0, "no partial accounting state: the head was rolled back");

  const txns = await pgQuery("SELECT id FROM account_transactions WHERE category = $1", [category]);
  assert.strictEqual(txns.length, 0, "no ledger row was left behind");
});

test("atomicity: a rejected ledger insert rolls back the head created in the same unit of work", async () => {
  pinConnected();
  const category = "Atomic Enum Head " + unique();

  // The repository's enum validation throws inside the transaction after the
  // head write, exercising the ROLLBACK path.
  await assert.rejects(
    () => accountingService.recordTransaction(payload({ category, transactionType: "Sideways" })),
    /Invalid transactionType/
  );

  const heads = await pgQuery("SELECT id FROM account_heads WHERE name = $1", [category]);
  assert.strictEqual(heads.length, 0, "the head written before the failure was rolled back");
});

test("atomicity: a pre-existing head is reused and never duplicated", async () => {
  pinConnected();
  const category = "Reused Head " + unique();
  const first = await accountingService.recordTransaction(payload({ category }));
  const second = await accountingService.recordTransaction(payload({ category, referenceId: "00000000000000000000ee" }));
  assert.notStrictEqual(second._id, first._id, "a different event still records");

  const heads = await pgQuery("SELECT COUNT(*)::int AS n FROM account_heads WHERE name = $1", [category]);
  assert.strictEqual(heads[0].n, 1, "the head is not duplicated");
});

// ─── B/D. Mongo fallback ───────────────────────────────────────────────────
test("Mongo fallback: the seam selects Mongo and no PostgreSQL write happens", async () => {
  const tx = payload({ category: "Fallback Head " + unique() });
  const calls = [];
  const originals = {
    txCreate: AccountTransaction.create,
    txFindOne: AccountTransaction.findOne,
    headFindOne: AccountHead.findOne,
    headCreate: AccountHead.create,
  };
  AccountTransaction.findOne = async () => null;
  AccountTransaction.create = async (data) => { calls.push(["txCreate", data]); return { _id: "mongo-tx-1", ...data }; };
  AccountHead.findOne = async () => ({ _id: "mongo-head-1", name: tx.category });
  AccountHead.create = async (data) => { calls.push(["headCreate", data]); return { _id: "mongo-head-2", ...data }; };

  const before = await pgQuery("SELECT COUNT(*)::int AS n FROM account_transactions");
  try {
    pinDisconnected();
    const recorded = await accountingService.recordTransaction(tx);
    assert.strictEqual(recorded._id, "mongo-tx-1", "MongoDB produced the document");
    assert.ok(calls.some(([n]) => n === "txCreate"), "AccountTransaction.create was reached");
    assert.ok(!calls.some(([n]) => n === "headCreate"), "an existing head is not re-created");

    const after = await pgQuery("SELECT COUNT(*)::int AS n FROM account_transactions");
    assert.strictEqual(after[0].n, before[0].n, "the Mongo fallback wrote nothing to PostgreSQL");
  } finally {
    AccountTransaction.create = originals.txCreate;
    AccountTransaction.findOne = originals.txFindOne;
    AccountHead.findOne = originals.headFindOne;
    AccountHead.create = originals.headCreate;
    pinConnected();
  }
});

test("Mongo fallback: a missing head is auto-created on the Mongo path", async () => {
  const tx = payload({ category: "Fallback Missing Head " + unique() });
  const calls = [];
  const originals = {
    txCreate: AccountTransaction.create,
    txFindOne: AccountTransaction.findOne,
    headFindOne: AccountHead.findOne,
    headCreate: AccountHead.create,
  };
  AccountTransaction.findOne = async () => null;
  AccountTransaction.create = async (data) => ({ _id: "mongo-tx-2", ...data });
  AccountHead.findOne = async () => null;
  AccountHead.create = async (data) => { calls.push(data); return { _id: "mongo-head-3", ...data }; };

  try {
    pinDisconnected();
    const recorded = await accountingService.recordTransaction(tx);
    assert.strictEqual(recorded._id, "mongo-tx-2");
    assert.strictEqual(calls.length, 1, "the head was auto-created");
    assert.strictEqual(calls[0].type, "Income", "a Credit auto-creates an Income head");

    const heads = await pgQuery("SELECT id FROM account_heads WHERE name = $1", [tx.category]);
    assert.strictEqual(heads.length, 0, "the Mongo fallback wrote no PostgreSQL head");
  } finally {
    AccountTransaction.create = originals.txCreate;
    AccountTransaction.findOne = originals.txFindOne;
    AccountHead.findOne = originals.headFindOne;
    AccountHead.create = originals.headCreate;
    pinConnected();
  }
});

test("Mongo fallback: the idempotency lookup uses the Mongo query, not the repository", async () => {
  const tx = payload({ category: "Fallback Idem " + unique() });
  const originals = { txFindOne: AccountTransaction.findOne };
  let findOneFilter;
  AccountTransaction.findOne = async (filter) => { findOneFilter = filter; return { _id: "mongo-existing" }; };

  try {
    pinDisconnected();
    const recorded = await accountingService.recordTransaction(tx);
    assert.strictEqual(recorded._id, "mongo-existing", "the existing document is returned");
    assert.ok(findOneFilter.status.$in.includes("Completed"), "the Mongo-style status filter is used");
  } finally {
    AccountTransaction.findOne = originals.txFindOne;
    pinConnected();
  }
});

// ─── E. PostgreSQL unavailable → safe Mongo fallback ───────────────────────
test("PG unavailable: the seam is connected but PostgreSQL is unreachable, so Mongo handles the write", async () => {
  const savedUrl = process.env.DATABASE_URL;
  const tx = payload({ category: "Unreachable Head " + unique() });
  const originals = {
    txCreate: AccountTransaction.create,
    txFindOne: AccountTransaction.findOne,
    headFindOne: AccountHead.findOne,
  };
  const calls = [];
  AccountTransaction.findOne = async () => null;
  AccountTransaction.create = async (data) => { calls.push("txCreate"); return { _id: "mongo-pg-down", ...data }; };
  AccountHead.findOne = async () => ({ _id: "mongo-head-down" });

  try {
    pinConnected();
    process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nope";
    await closePostgres();

    assert.strictEqual(await accountTransactionService.usePostgres(), false,
      "an unreachable PostgreSQL fails the service-level availability gate");

    const recorded = await accountingService.recordTransaction(tx);
    assert.strictEqual(recorded._id, "mongo-pg-down", "the write safely fell back to MongoDB");
    assert.deepStrictEqual(calls, ["txCreate"], "exactly one Mongo write and no PostgreSQL write");
  } finally {
    process.env.DATABASE_URL = savedUrl;
    await closePostgres();
    AccountTransaction.create = originals.txCreate;
    AccountTransaction.findOne = originals.txFindOne;
    AccountHead.findOne = originals.headFindOne;
    pinConnected();
  }
});

// ─── Datasource seam alignment (Phase 2AD) ─────────────────────────────────
test("seam: accountingService delegates to the live accountTransactionService gate", async () => {
  pinConnected();
  assert.strictEqual(accountTransactionService.isConnected(), true);
  pinDisconnected();
  assert.strictEqual(accountTransactionService.isConnected(), false);
  assert.strictEqual(await accountTransactionService.usePostgres(), false);
  pinConnected();
  assert.strictEqual(accountTransactionService.isConnected(), true);
  assert.strictEqual(await accountTransactionService.usePostgres(), true);
});

test("seam: accountingService still owns the financial-year helper callers import", () => {
  assert.strictEqual(accountingService.getFinancialYear(new Date("2026-04-01T00:00:00Z")), "2026-2027");
  assert.strictEqual(accountingService.getFinancialYear(new Date("2026-03-31T00:00:00Z")), "2025-2026");
});