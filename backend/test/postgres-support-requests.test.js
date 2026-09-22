// Phase 2AH PostgreSQL-path tests for the Support Request repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - supportRequestRepository / supportRequestService persist to and read from
//     the real support_requests table (no mocks),
//   - every migrated Mongo schema field round-trips losslessly,
//   - defaults, validation and null semantics match the Mongo model exactly
//     (name/email/subject/message required; reply optional; status defaults to
//     'Open' and is nullable; read defaults to false and is nullable),
//   - findMany mirrors SupportRequest.find(filter).sort({ createdAt: -1 }),
//     including the email filter the controller builds,
//   - create / updateById / count / destroy behave like their Mongoose
//     counterparts, including the reply + read mutation surface,
//   - the table carries exactly the approved shape — one primary key, one status
//     CHECK, the two approved indexes, NO unique constraint, NO foreign key,
//   - and the service never writes to MongoDB while PostgreSQL is selected
//     (no dual writes) and can switch datasources in-process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const SupportRequest = require("../src/models/SupportRequest");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const hex24 = () => crypto.randomBytes(12).toString("hex");

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

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

let originalIsDbConnected;
let supportRequestRepository;
let supportRequestService;

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
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;
  supportRequestRepository = require("../src/repositories/supportRequestRepository");
  supportRequestService = require("../src/services/supportRequestService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const requestBase = (overrides = {}) => ({
  name: `Devotee ${unique()}`,
  email: `devotee_${unique()}@example.com`,
  subject: "Pooja timing query",
  message: "What time does the evening aarti begin?",
  ...overrides,
});

// ─── Round trip ───────────────────────────────────────────────────────────
test("PG path: create persists one row and returns the Mongoose-shaped document", async () => {
  const payload = requestBase();
  const created = await supportRequestService.create(payload);

  assert.ok(created._id, "an _id is returned");
  assert.strictEqual(created._id.length, 24, "the id is a 24-char Mongo-compatible hex string");
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.name, payload.name);
  assert.strictEqual(created.email, payload.email);
  assert.strictEqual(created.subject, payload.subject);
  assert.strictEqual(created.message, payload.message);
  assert.strictEqual(created.status, "Open", "status defaults to 'Open'");
  assert.strictEqual(created.read, false, "read defaults to false");
  assert.strictEqual(created.reply, undefined, "reply stays unset until an admin replies");
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  const raw = await poolQuery(
    "SELECT id, name, email, subject, message, reply, status, read FROM support_requests WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(raw.length, 1, "exactly one row written");
  assert.strictEqual(raw[0].status, "Open");
  assert.strictEqual(raw[0].read, false);
  assert.strictEqual(raw[0].reply, null);
});

test("PG path: id values are ObjectId-compatible and stable", async () => {
  const created = await supportRequestService.create(requestBase());
  const asObjectId = await poolQuery("SELECT id::text AS id FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(asObjectId[0].id, created._id);
  assert.ok(/^[0-9a-f]{24}$/.test(asObjectId[0].id));
});

test("PG path: a caller-supplied id is honored", async () => {
  const id = hex24();
  const created = await supportRequestRepository.create({ ...requestBase(), id });
  assert.strictEqual(created._id, id);
});

// ─── Required / default / null semantics mirror Mongoose exactly ──────────
test("PG path: name/email/subject/message are required like Mongo", async () => {
  for (const field of ["name", "email", "subject", "message"]) {
    await assert.rejects(
      () => supportRequestService.create(requestBase({ [field]: undefined })),
      new RegExp(`${field} is required`),
      `${field} omitted is rejected`
    );
    await assert.rejects(
      () => supportRequestService.create(requestBase({ [field]: "" })),
      new RegExp(`${field} is required`),
      `${field} empty is rejected`
    );
    await assert.rejects(
      () => supportRequestService.create(requestBase({ [field]: "   " })),
      new RegExp(`${field} is required`),
      `${field} whitespace-only collapses to '' under trim and fails`
    );
  }
});

test("PG path: required text fields are trimmed on write", async () => {
  const created = await supportRequestService.create(requestBase({
    name: "  Padded Name  ",
    email: "  padded@example.com  ",
    subject: "  Padded Subject  ",
    message: "  Padded message  ",
  }));
  assert.strictEqual(created.name, "Padded Name");
  assert.strictEqual(created.email, "padded@example.com");
  assert.strictEqual(created.subject, "Padded Subject");
  assert.strictEqual(created.message, "Padded message");

  const raw = await poolQuery("SELECT name, email, subject, message FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].name, "Padded Name");
  assert.strictEqual(raw[0].message, "Padded message");
});

test("PG path: status defaults to 'Open' and read to false when omitted", async () => {
  const created = await supportRequestService.create(requestBase());
  assert.strictEqual(created.status, "Open");
  assert.strictEqual(created.read, false);
});

test("PG path: status and read accept an explicit null, as Mongo does", async () => {
  // `default` fires only on an omitted value, so `status: null` / `read: null`
  // validate and persist as null under Mongoose. The columns must be nullable.
  const created = await supportRequestService.create(requestBase({ status: null, read: null }));
  const raw = await poolQuery("SELECT status, read FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].status, null);
  assert.strictEqual(raw[0].read, null);
});

test("PG path: an out-of-enum status is rejected exactly as Mongoose rejects it", async () => {
  await assert.rejects(
    () => supportRequestService.create(requestBase({ status: "Bogus" })),
    /support_requests_status_check|enum/i
  );
  // The three declared enum values are all accepted.
  for (const status of ["Open", "In Progress", "Closed"]) {
    const created = await supportRequestService.create(requestBase({ status }));
    assert.strictEqual(created.status, status);
  }
});

test("PG path: reply is optional, trimmed, and null until set", async () => {
  const created = await supportRequestService.create(requestBase());
  assert.strictEqual(created.reply, undefined, "unset reply reads back as undefined like Mongoose");

  const replied = await supportRequestService.updateById(created._id, { reply: "  Aarti is at 6:30 PM.  " });
  assert.strictEqual(replied.reply, "Aarti is at 6:30 PM.");

  const raw = await poolQuery("SELECT reply FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].reply, "Aarti is at 6:30 PM.");
});

// ─── Read / list semantics ────────────────────────────────────────────────
test("PG path: findById returns null for a missing id and the document for an existing one", async () => {
  const created = await supportRequestService.create(requestBase());
  const found = await supportRequestService.findById(created._id);
  assert.strictEqual(found._id, created._id);
  assert.strictEqual(found.subject, created.subject);

  assert.strictEqual(await supportRequestService.findById(hex24()), null);
  assert.strictEqual(await supportRequestService.findById(""), null);
});

test("PG path: findMany mirrors find().sort({ createdAt: -1 })", async () => {
  const mine = `order_${unique()}@example.com`;
  const first = await supportRequestService.create(requestBase({ email: mine, subject: "first" }));
  const second = await supportRequestService.create(requestBase({ email: mine, subject: "second" }));

  const listed = await supportRequestService.findMany({ filter: { email: mine }, sort: { createdAt: -1 } });
  assert.strictEqual(listed.length, 2);
  // The filter is an exact email match, exactly what the controller builds.
  assert.ok(listed.every((r) => r.email === mine));
  // Newest first — the secondary id tiebreak cannot reorder distinct timestamps.
  assert.ok(listed.findIndex((r) => r._id === second._id) <= listed.findIndex((r) => r._id === first._id));
});

test("PG path: findMany with an empty filter lists across requesters", async () => {
  const a = await supportRequestService.create(requestBase());
  const b = await supportRequestService.create(requestBase());
  const all = await supportRequestService.findMany({ filter: {}, sort: { createdAt: -1 } });
  const ids = all.map((r) => r._id);
  assert.ok(ids.includes(a._id));
  assert.ok(ids.includes(b._id));
});

test("PG path: findMany honours limit and offset", async () => {
  const mine = `page_${unique()}@example.com`;
  for (let i = 0; i < 3; i += 1) {
    await supportRequestService.create(requestBase({ email: mine, subject: `s${i}` }));
  }
  const page = await supportRequestService.findMany({ filter: { email: mine }, sort: { createdAt: -1 }, limit: 2, offset: 1 });
  assert.strictEqual(page.length, 2);
});

// ─── Mutation surface used by the controller ──────────────────────────────
test("PG path: updateById applies the reply + status the controller computes", async () => {
  const created = await supportRequestService.create(requestBase());
  const before = new Date();

  const updated = await supportRequestService.updateById(created._id, {
    reply: "We have forwarded this to the office.",
    status: "In Progress",
  });
  assert.strictEqual(updated.reply, "We have forwarded this to the office.");
  assert.strictEqual(updated.status, "In Progress");
  assert.ok(updated.updatedAt >= before, "updated_at is refreshed like Mongoose timestamps");
});

test("PG path: updateById sets read true (markSupportRequestAsRead)", async () => {
  const created = await supportRequestService.create(requestBase());
  assert.strictEqual(created.read, false);
  const updated = await supportRequestService.updateById(created._id, { read: true });
  assert.strictEqual(updated.read, true);
  const raw = await poolQuery("SELECT read FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].read, true);
});

test("PG path: updateById on a missing id returns null", async () => {
  assert.strictEqual(await supportRequestService.updateById(hex24(), { read: true }), null);
});

test("PG path: updateById with no writable fields returns the current document", async () => {
  const created = await supportRequestService.create(requestBase());
  const same = await supportRequestService.updateById(created._id, {});
  assert.strictEqual(same._id, created._id);
});

test("PG path: count mirrors countDocuments for the email filter", async () => {
  const mine = `count_${unique()}@example.com`;
  await supportRequestService.create(requestBase({ email: mine }));
  await supportRequestService.create(requestBase({ email: mine }));
  assert.strictEqual(await supportRequestService.count({ email: mine }), 2);
  assert.strictEqual(await supportRequestService.count({ email: `none_${unique()}@example.com` }), 0);
});

test("PG path: destroy is not exposed to any route but behaves like findByIdAndDelete", async () => {
  const created = await supportRequestService.create(requestBase());
  const deleted = await supportRequestService.destroy(created._id);
  assert.strictEqual(deleted._id, created._id);
  assert.strictEqual(await supportRequestService.findById(created._id), null);
});

// ─── Approved shape ───────────────────────────────────────────────────────
test("PG path: the table carries exactly one primary key, one status CHECK and two indexes", async () => {
  const cons = await poolQuery(
    `SELECT conname, contype FROM pg_constraint
     WHERE conrelid = 'public.support_requests'::regclass ORDER BY contype`
  );
  assert.deepStrictEqual(cons.map((c) => c.contype), ["c", "p"], "exactly one CHECK and one primary key");

  const checks = await poolQuery(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'public.support_requests'::regclass AND contype = 'c'`
  );
  assert.match(checks[0].def, /status = ANY/i);

  const idx = await poolQuery(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'support_requests' AND schemaname = 'public' ORDER BY indexname`
  );
  const names = idx.map((r) => r.indexname);
  assert.ok(names.includes("idx_support_requests_created_at"));
  assert.ok(names.includes("idx_support_requests_email"));
  assert.strictEqual(idx.length, 3, "pkey + the two approved indexes");
  const nonPk = idx.filter((r) => r.indexname !== "support_requests_pkey");
  assert.strictEqual(nonPk.length, 2);
});

test("PG path: NO unique constraint and NO foreign key", async () => {
  const uniques = await poolQuery(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.support_requests'::regclass AND contype = 'u'`
  );
  assert.deepStrictEqual(uniques, [], "two devotees may share an email, so no unique constraint");

  const fks = await poolQuery(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.support_requests'::regclass AND contype = 'f'`
  );
  assert.deepStrictEqual(fks, [], "no foreign key");
});

test("PG path: NO existing table gained a foreign key to support_requests", async () => {
  const fks = await poolQuery(
    `SELECT conrelid::regclass::text AS tbl FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'public.support_requests'::regclass`
  );
  assert.deepStrictEqual(fks, [], "nothing references support_requests");
});

test("PG path: the model declares no index, so no Mongo index parity is owed", async () => {
  // Guard for the migration's one-index-per-query rationale: the source schema
  // has no indexes, so the two PostgreSQL indexes exist to serve the two real
  // queries, not to mirror the model.
  assert.deepStrictEqual(SupportRequest.schema.indexes(), []);
});

// ─── No dual writes + datasource switching ────────────────────────────────
test("PG path: the service never writes MongoDB while PostgreSQL is selected", async () => {
  let mongoCalled = false;
  const originalCreate = SupportRequest.create;
  SupportRequest.create = async () => { mongoCalled = true; return {}; };
  try {
    await supportRequestService.create(requestBase());
    assert.strictEqual(mongoCalled, false, "create used PostgreSQL only");
  } finally {
    SupportRequest.create = originalCreate;
  }
});

test("PG path: the service falls back to Mongoose when the seam selects Mongo", async () => {
  const originalFind = SupportRequest.find;
  const originalCreate = SupportRequest.create;
  const seen = { finds: [], creates: [] };
  SupportRequest.find = (filter) => {
    seen.finds.push(filter);
    const chain = { sort: () => chain, limit: () => chain, skip: () => chain, then: (r) => Promise.resolve([]).then(r) };
    return chain;
  };
  SupportRequest.create = async (data) => { seen.creates.push(data); return { ...data, _id: hex24() }; };
  dbConfig.isDbConnected = () => true;
  try {
    // With the seam connected but MongoDB being the model path (isPostgresConnected
    // is real and reachable here), the service still uses PostgreSQL; to observe
    // the fallback we disable the seam instead.
    dbConfig.isDbConnected = () => false;
    await supportRequestService.findMany({ filter: { email: "x@example.com" } });
    await supportRequestService.create(requestBase());
    assert.ok(seen.finds.length >= 1, "Mongoose find was used on the fallback path");
    assert.strictEqual(seen.creates.length, 1, "Mongoose create was used on the fallback path");
  } finally {
    SupportRequest.find = originalFind;
    SupportRequest.create = originalCreate;
    dbConfig.isDbConnected = () => true;
  }
});
