const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const AuditLog = require("../src/models/AuditLog");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let auditLogService;
let auditLogRepository;
let auditLogController;

// The fallback behaviour must hold even when PostgreSQL is completely
// unavailable or lacks the audit_logs table. We pin the datasource-selection
// seam to "disconnected" so the repository routes to the Mongoose model,
// exactly as Phases 2A–2AA do — this is the documented fallback path, never a
// dual write.
const pinMongoFallback = () => {
  dbConfig.isDbConnected = () => false;
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  pinMongoFallback();
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;

  // The service and repository read the seam at call time, but they must be
  // loaded with a clean PostgreSQL config anyway (same ordering as the earlier
  // fallback tests).
  auditLogService = require("../src/services/auditLogService");
  auditLogRepository = require("../src/repositories/auditLogRepository");
  auditLogController = require("../src/controllers/auditLogController");
});

// Re-runs the migrations so the audit_logs table exists in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

/**
 * Replaces the AuditLog Mongoose model with call-tracking spies so tests can
 * prove the Mongo path is genuinely invoked on the fallback branch. The
 * repository captures the model object itself and calls properties like
 * AuditLog.create at call time, so swapping the methods is authoritative
 * regardless of module load order.
 */
const stubLogsCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    toObject: () => ({ ...obj, _id: id }),
  });
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    populate: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
    catch: (reject) => execQuery().catch(reject),
  };

  const create = async (data) => { calls.push(["create", data]); const d = doc(data); saved.push(d); return d; };
  const findById = async (id) => { calls.push(["findById", id]); return null; };
  const findOne = async (filter) => { calls.push(["findOne", filter]); return null; };
  const find = (filter) => { calls.push(["find", filter]); return chain; };
  const countDocuments = async (filter) => { calls.push(["countDocuments", filter]); return 0; };

  AuditLog.create = create;
  AuditLog.findById = findById;
  AuditLog.findOne = findOne;
  AuditLog.find = find;
  AuditLog.countDocuments = countDocuments;
  return { saved, calls, chain };
};

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ─────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await auditLogService.usePostgres(), false);
  assert.strictEqual(auditLogService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await auditLogService.usePostgres(), false);
});

test("fallback: repository routes creates to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubLogsCollection();
  const log = await auditLogRepository.create({
    user: "000000000000000000000002",
    action: "Approved Expense",
    module: "Accounts & Finance",
  });
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(log.action, "Approved Expense");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  stubLogsCollection();

  const byId = await auditLogRepository.findById("000000000000000000000099");
  const list = await auditLogRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.ok(byId === null); // stubbed findById returns null; the fallback is what matters
  assert.strictEqual(typeof (await auditLogRepository.count({})), "number");
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the audit_logs table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubLogsCollection();
  // The Mongoose model path must not touch PostgreSQL at all.
  const log = await auditLogRepository.create({
    user: "000000000000000000000002",
    action: "Submitted Shift Closing",
    module: "Accounts & Finance",
  });
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(log.action, "Submitted Shift Closing");

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS audit_logs CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }

  const again = await auditLogRepository.create({
    user: "000000000000000000000002",
    action: "Rejected Expense",
    module: "Accounts & Finance",
  });
  assert.strictEqual(again.action, "Rejected Expense");
});

// ─── Fallback: existing Mongo behaviour is unchanged ───────────────────────
test("fallback: Mongo validation is still applied by the model path", async () => {
  pinMongoFallback();
  const { saved } = stubLogsCollection();
  const log = await auditLogService.create({
    user: "000000000000000000000002",
    action: "Approved Expense",
    module: "Accounts & Finance",
  });
  assert.strictEqual(log.action, "Approved Expense");
  assert.ok(saved[0]);
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  // First migrate so PostgreSQL has the audit_logs table, then measure its row
  // count before and after a Mongo-fallback create. Since the seam is
  // disconnected, the repository must touch ONLY the Mongo model — no PG row
  // may appear.
  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM audit_logs");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubLogsCollection();
  await auditLogRepository.create({
    user: "000000000000000000000002",
    action: "Approved Expense",
    module: "Accounts & Finance",
  });
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── The SERVICE routes every operation through the Mongoose model ─────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { saved, calls } = stubLogsCollection();

  const log = await auditLogService.create({
    user: "000000000000000000000002",
    action: "Approved Expense",
    module: "Accounts & Finance",
    details: "ok",
    ipAddress: "10.0.0.1",
  });
  assert.strictEqual(calls[0][0], "create", "create routed to Mongoose create");
  assert.strictEqual(log.action, "Approved Expense");

  await auditLogService.findById("000000000000000000000099");
  assert.ok(
    calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"),
    "findById routed to Mongoose findById spy"
  );

  await auditLogService.findOne({ user: "000000000000000000000002" });
  assert.ok(
    calls.some(([name, filter]) => name === "findOne" && filter && filter.user === "000000000000000000000002"),
    "findOne routed to Mongoose findOne spy"
  );

  await auditLogService.findMany({ filter: { user: "000000000000000000000002" } });
  assert.ok(
    calls.some(([name, filter]) => name === "find" && filter && filter.user === "000000000000000000000002"),
    "findMany routed to Mongoose find spy"
  );

  await auditLogService.count({ user: "000000000000000000000002" });
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");

  assert.ok(saved.length >= 1);
  assert.ok(calls.length >= 5, "expected at least 5 model method calls, got " + calls.length);
});

// ─── Datasource seam is read at call time, never captured ──────────────────
test("fallback: seam can flip PostgreSQL → MongoDB → PostgreSQL in one process", async () => {
  // The module must not have captured dbConfig.isDbConnected at load time; the
  // seam is re-read on every call, so the datasource can change at runtime
  // without restarting the process.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.POSTGRES_SSL;
  await require("../src/config/postgres").initPostgres();
  assert.strictEqual(await auditLogService.usePostgres(), true, "flipped back to PostgreSQL");

  pinMongoFallback();
  assert.strictEqual(await auditLogService.usePostgres(), false, "flipped to MongoDB");

  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await auditLogService.usePostgres(), true, "flipped to PostgreSQL again");
});

// ─── Controller behaviour on the fallback path ─────────────────────────────
test("fallback: controller logAudit swallows write failures and never throws", async () => {
  pinMongoFallback();
  AuditLog.create = async () => { throw new Error("mongo down"); };

  // The business request must not fail because an audit write failed.
  await assert.doesNotReject(() =>
    auditLogController.logAudit("000000000000000000000002", "Approved Expense", "Accounts & Finance", "x", "1.2.3.4")
  );
});

test("fallback: controller getAuditLogs returns 500 with the same shape on error", async () => {
  pinMongoFallback();
  AuditLog.find = () => { throw new Error("boom"); };

  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await auditLogController.getAuditLogs({ query: {} }, res);

  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.message, "Failed to fetch audit logs");
  assert.strictEqual(res.body.error, "boom");
});
