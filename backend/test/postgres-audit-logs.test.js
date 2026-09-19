const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const hex24 = () => crypto.randomBytes(12).toString("hex");

// Every table the chain creates that this file touches, dropped in FK-safe
// order so a stale dependency can never block a fresh migration run.
const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS audit_logs CASCADE");
    await pool.query("DROP TABLE IF EXISTS prasadams CASCADE");
    await pool.query("DROP TABLE IF EXISTS poojas CASCADE");
    await pool.query("DROP TABLE IF EXISTS events CASCADE");
    await pool.query("DROP TABLE IF EXISTS notifications CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
  } finally {
    await pool.end();
  }
};

let originalIsDbConnected;
let auditLogRepository;
let auditLogService;

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await resetAllTables(TEST_DB_URL);
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  if (res.status !== 0) {
    throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);
  }
  dbConfig.isDbConnected = () => true;
  auditLogRepository = require("../src/repositories/auditLogRepository");
  auditLogService = require("../src/services/auditLogService");
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// A real users row, so the populate LEFT JOIN has something to resolve. Users
// are inserted directly because registration still goes through Mongoose.
const makeUser = async (role = "admin") => {
  const id = hex24();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query(
      "INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)",
      [id, `Auditor ${unique()}`, `${unique()}@temple.test`, "not-a-real-hash", role]
    );
  } finally {
    await pool.end();
  }
  return id;
};

const logBase = (overrides = {}) => ({
  user: hex24(),
  action: "Approved Expense",
  module: "Accounts & Finance",
  details: "Expense approved",
  ...overrides,
});

// ─── PostgreSQL path: service selects PG and round trips ───────────────────
test("PG path: service uses PostgreSQL when the Audit Log path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await auditLogService.usePostgres(), true);
  assert.strictEqual(auditLogService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const userId = hex24();
  const when = new Date("2025-06-01T10:30:00+05:30");
  const log = await auditLogService.create(logBase({
    user: userId,
    action: "Submitted Shift Closing",
    module: "Accounts & Finance",
    details: "Shift closed",
    ipAddress: "10.1.2.3",
    date: when,
  }));

  assert.ok(log._id);
  assert.match(log._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(log.user, userId);
  assert.strictEqual(log.action, "Submitted Shift Closing");
  assert.strictEqual(log.module, "Accounts & Finance");
  assert.strictEqual(log.details, "Shift closed");
  assert.strictEqual(log.ipAddress, "10.1.2.3");
  assert.ok(log.date instanceof Date);
  assert.strictEqual(log.date.toISOString(), when.toISOString());
  assert.ok(log.createdAt instanceof Date);
  assert.ok(log.updatedAt instanceof Date);

  const read = await auditLogService.findById(log._id);
  assert.strictEqual(read._id, log._id);
  assert.strictEqual(read.user, userId);
  assert.strictEqual(read.action, "Submitted Shift Closing");
});

test("PG path: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const userId = hex24();
  const when = new Date("2025-12-31T23:59:59+05:30");
  const log = await auditLogRepository.create(logBase({
    user: userId,
    action: "Rejected Expense",
    module: "Accounts & Finance",
    details: "Missing receipt",
    ipAddress: "192.168.1.50",
    date: when,
  }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM audit_logs WHERE id = $1", [log._id]);
    const row = rows[0];
    assert.strictEqual(row.user_id, userId);
    assert.strictEqual(row.action, "Rejected Expense");
    assert.strictEqual(row.module, "Accounts & Finance");
    assert.strictEqual(row.details, "Missing receipt");
    assert.strictEqual(row.ip_address, "192.168.1.50");
    assert.strictEqual(row.date.toISOString(), when.toISOString());
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
  } finally {
    await pool.end();
  }

  const read = await auditLogRepository.findById(log._id);
  assert.strictEqual(read.user, userId);
  assert.strictEqual(read.ipAddress, "192.168.1.50");
});

// ─── Defaults / validation parity with the Mongoose schema ─────────────────
test("PG path: defaults mirror the schema (date now, ipAddress 127.0.0.1, details NULL)", async () => {
  const log = await auditLogRepository.create({
    user: hex24(),
    action: "Approved Expense",
    module: "Accounts & Finance",
  });

  assert.ok(log.date instanceof Date);
  assert.strictEqual(log.ipAddress, "127.0.0.1");
  // `details` has no default in the schema, so an absent value stays absent
  // rather than becoming ''.
  assert.strictEqual(log.details, undefined);
});

test("PG path: required fields are enforced like Mongo", async () => {
  await assert.rejects(
    () => auditLogRepository.create(logBase({ user: undefined })),
    /user is required/,
  );
  await assert.rejects(
    () => auditLogRepository.create(logBase({ user: "" })),
    /user is required/,
  );
  await assert.rejects(
    () => auditLogRepository.create(logBase({ action: undefined })),
    /action is required/,
  );
  await assert.rejects(
    () => auditLogRepository.create(logBase({ module: undefined })),
    /module is required/,
  );
});

test("PG path: action and module are free text — no enum rejection", async () => {
  // The Mongo model declares no enum, so an arbitrary action/module must be
  // accepted rather than being forced into an invented CHECK constraint.
  const log = await auditLogRepository.create(logBase({
    action: "Some Future Action",
    module: "Some Future Module",
  }));
  assert.strictEqual(log.action, "Some Future Action");
  assert.strictEqual(log.module, "Some Future Module");
});

// ─── The exact getAuditLogs query shapes ───────────────────────────────────
test("PG path: date range filter matches $gte/$lte semantics", async () => {
  const user = hex24();
  const inside = await auditLogRepository.create(logBase({
    user, date: new Date("2025-03-15T12:00:00Z"),
  }));
  const before = await auditLogRepository.create(logBase({
    user, date: new Date("2025-01-01T00:00:00Z"),
  }));
  const after = await auditLogRepository.create(logBase({
    user, date: new Date("2025-09-01T00:00:00Z"),
  }));

  const rows = await auditLogRepository.findMany({
    filter: { user, date: { $gte: new Date("2025-03-01T00:00:00Z"), $lte: new Date("2025-03-31T23:59:59Z") } },
    sort: { date: -1 },
  });
  const ids = rows.map((r) => r._id);
  assert.ok(ids.includes(inside._id), "inside range returned");
  assert.ok(!ids.includes(before._id), "before range excluded");
  assert.ok(!ids.includes(after._id), "after range excluded");
});

test("PG path: action filter is a case-insensitive substring match like $regex i", async () => {
  const user = hex24();
  const approved = await auditLogRepository.create(logBase({
    user, action: "Approved Expense",
  }));
  const rejected = await auditLogRepository.create(logBase({
    user, action: "Rejected Expense",
  }));

  const lower = await auditLogRepository.findMany({
    filter: { user, action: { $regex: "approved", $options: "i" } },
  });
  assert.deepStrictEqual(lower.map((r) => r._id), [approved._id]);

  const upper = await auditLogRepository.findMany({
    filter: { user, action: { $regex: "APPROVED", $options: "i" } },
  });
  assert.deepStrictEqual(upper.map((r) => r._id), [approved._id]);

  const substring = await auditLogRepository.findMany({
    filter: { user, action: { $regex: "xpens", $options: "i" } },
  });
  assert.strictEqual(substring.length, 2, "substring matches both actions");
  assert.ok(substring.some((r) => r._id === rejected._id));
});

test("PG path: regex metacharacters in the action filter are matched literally", async () => {
  const user = hex24();
  const withDot = await auditLogRepository.create(logBase({ user, action: "a.b" }));
  await auditLogRepository.create(logBase({ user, action: "axb" }));

  // A literal '.' must not behave as a regex wildcard.
  const rows = await auditLogRepository.findMany({
    filter: { user, action: { $regex: "a.b", $options: "i" } },
  });
  assert.deepStrictEqual(rows.map((r) => r._id), [withDot._id]);
});

test("PG path: module filter is exact equality", async () => {
  const user = hex24();
  const finance = await auditLogRepository.create(logBase({
    user, module: "Accounts & Finance",
  }));
  await auditLogRepository.create(logBase({ user, module: "Accounts" }));

  const rows = await auditLogRepository.findMany({ filter: { user, module: "Accounts & Finance" } });
  assert.deepStrictEqual(rows.map((r) => r._id), [finance._id]);
});

test("PG path: default sort is date DESC (the only sort the endpoint uses)", async () => {
  const user = hex24();
  const older = await auditLogRepository.create(logBase({
    user, date: new Date("2024-01-01T00:00:00Z"),
  }));
  const newer = await auditLogRepository.create(logBase({
    user, date: new Date("2024-06-01T00:00:00Z"),
  }));

  const rows = await auditLogRepository.findMany({ filter: { user }, sort: { date: -1 } });
  assert.deepStrictEqual(rows.map((r) => r._id), [newer._id, older._id]);
});

test("PG path: findOne returns the newest match and count honors the filter", async () => {
  const user = hex24();
  await auditLogRepository.create(logBase({ user, date: new Date("2024-01-01T00:00:00Z") }));
  const latest = await auditLogRepository.create(logBase({
    user, date: new Date("2024-06-01T00:00:00Z"),
  }));

  const one = await auditLogRepository.findOne({ user });
  assert.strictEqual(one._id, latest._id);
  assert.strictEqual(await auditLogRepository.count({ user }), 2);
  assert.strictEqual(await auditLogRepository.count({ user: hex24() }), 0);
});

// ─── populate: the shape GET /api/audit-logs returns ───────────────────────
test("PG path: populate returns the { _id, name, role } shape the frontend reads", async () => {
  const userId = await makeUser("accountant");
  const log = await auditLogRepository.create(logBase({ user: userId }));

  const rows = await auditLogService.findMany({
    filter: { user: userId },
    sort: { date: -1 },
    populate: true,
  });
  const found = rows.find((r) => r._id === log._id);
  assert.ok(found, "populated row returned");
  assert.ok(found.user && typeof found.user === "object", "user is populated to an object");
  assert.strictEqual(found.user._id, userId);
  assert.match(found.user.name, /^Auditor /);
  assert.strictEqual(found.user.role, "accountant");
});

test("PG path: populate keeps audit rows whose user no longer exists (LEFT JOIN, not INNER)", async () => {
  const missingUser = hex24();
  const log = await auditLogRepository.create(logBase({ user: missingUser }));

  const rows = await auditLogService.findMany({
    filter: { user: missingUser },
    sort: { date: -1 },
    populate: true,
  });
  const found = rows.find((r) => r._id === log._id);
  assert.ok(found, "audit row is NOT dropped when the user is missing");
  // Mongo populate leaves the path null for a dangling ref.
  assert.strictEqual(found.user, null);
});

test("PG path: populate is off by default so the plain surface returns the id string", async () => {
  const userId = await makeUser("admin");
  const log = await auditLogRepository.create(logBase({ user: userId }));

  const rows = await auditLogRepository.findMany({ filter: { id: log._id } });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].user, userId, "unpopulated user is the id string");
});

// ─── SQL schema assertions ─────────────────────────────────────────────────
test("PG path: audit_logs table has the exact Mongo field mapping", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'audit_logs'
      ORDER BY ordinal_position`);
    const col = (name) => rows.find((c) => c.column_name === name);
    assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO");
    assert.ok(col("date") && col("date").data_type === "timestamp with time zone" && col("date").is_nullable === "NO");
    assert.ok(col("user_id") && col("user_id").data_type === "text" && col("user_id").is_nullable === "NO");
    assert.ok(col("action") && col("action").data_type === "text" && col("action").is_nullable === "NO");
    assert.ok(col("module") && col("module").data_type === "text" && col("module").is_nullable === "NO");
    assert.ok(col("details") && col("details").data_type === "text" && col("details").is_nullable === "YES");
    assert.ok(col("ip_address") && col("ip_address").data_type === "text" && col("ip_address").is_nullable === "NO");
    assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
    assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  } finally {
    await pool.end();
  }
});

test("PG path: no FK on user_id and no JSONB — audit history survives user deletion", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows: fks } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'audit_logs'::regclass AND contype = 'f'`);
    assert.strictEqual(fks.length, 0, "audit_logs declares no foreign key");

    const { rows: jsonb } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'audit_logs' AND data_type = 'jsonb'`);
    assert.strictEqual(jsonb.length, 0, "details is TEXT, not JSONB");
  } finally {
    await pool.end();
  }
});

test("PG path: deleting the referenced user keeps the audit row intact", async () => {
  const userId = await makeUser("staff");
  const log = await auditLogRepository.create(logBase({ user: userId }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  } finally {
    await pool.end();
  }

  const read = await auditLogRepository.findById(log._id);
  assert.ok(read, "audit row still readable after the user is deleted");
  assert.strictEqual(read.user, userId, "historical user id preserved verbatim");
  assert.strictEqual(read.action, "Approved Expense");
});

test("PG path: indexes cover the real query patterns", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'audit_logs'`);
    const defs = rows.map((r) => r.indexdef);
    // getAuditLogs: .sort({ date: -1 })
    assert.ok(defs.some((d) => /\(date DESC\)/.test(d)), "date DESC index");
    // getAuditLogs: { user } equality (and the populate join)
    assert.ok(defs.some((d) => /\(user_id\)/.test(d)), "user_id index");
    // getAuditLogs: { module } equality
    assert.ok(defs.some((d) => /\(module\)/.test(d)), "module index");
  } finally {
    await pool.end();
  }
});
