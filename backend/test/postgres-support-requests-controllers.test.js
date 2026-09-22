// Phase 2AH controller-level tests for the devotee support-request endpoints.
//
// These drive the real devoteeController handlers (not the service in
// isolation) so the API contract is verified end-to-end:
//   - submitSupportRequest / getSupportRequests / replySupportRequest /
//     markSupportRequestAsRead persist and read through the PostgreSQL
//     repository when the datasource seam selects PostgreSQL,
//   - the same handlers fall back to Mongoose when the seam selects Mongo,
//   - a write reaches exactly one datasource (no dual persistence),
//   - the response shapes, status codes, the defaulting of name/email on submit
//     and the reply status fallback-to-'Closed' rule are unchanged from before
//     the wiring.
//
// The Mongo model is stubbed (not a live MongoDB) because these tests must prove
// *which* datasource each handler selected and that the Mongo branch genuinely
// invokes the Mongoose model — the PG branch is exercised against the real
// PostgreSQL table with no mocks. notificationPersistenceService is stubbed so a
// support-request write never attempts an out-of-scope email/notification side
// effect; that dependency is already covered by its own suite.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const SupportRequest = require("../src/models/SupportRequest");
const notificationPersistenceService = require("../src/services/notificationPersistenceService");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const hex24 = () => crypto.randomBytes(12).toString("hex");
const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let originalFind;
let originalCreate;
let originalFindById;
let originalFindByIdAndUpdate;
let originalNotificationCreate;
let devoteeController;
let supportRequestService;

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

// Captures the Mongo reads/writes without touching real MongoDB, so a test can
// assert that the fallback branch really used the Mongoose model.
const stubMongo = () => {
  const calls = { finds: [], creates: [], findByIds: [], updates: [] };
  SupportRequest.find = (filter) => {
    calls.finds.push(filter);
    const chain = {
      sort: (s) => { calls.finds.push(s); return Promise.resolve([]); },
      then: (resolve) => Promise.resolve([]).then(resolve),
    };
    return chain;
  };
  SupportRequest.create = async (data) => {
    calls.creates.push(data);
    return { ...data, _id: hex24() };
  };
  SupportRequest.findById = async (id) => {
    calls.findByIds.push(id);
    return null;
  };
  SupportRequest.findByIdAndUpdate = async (id, updates, options) => {
    calls.updates.push({ id, updates, options });
    return { _id: id, ...updates };
  };
  return calls;
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  originalFind = SupportRequest.find;
  originalCreate = SupportRequest.create;
  originalFindById = SupportRequest.findById;
  originalFindByIdAndUpdate = SupportRequest.findByIdAndUpdate;
  originalNotificationCreate = notificationPersistenceService.create;

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

  devoteeController = require("../src/controllers/devoteeController");
  supportRequestService = require("../src/services/supportRequestService");
  // The handlers create a Notification on submit and reply. That side effect is
  // already exercised by the notifications suite; stub it so this suite verifies
  // only the support-request persistence path.
  notificationPersistenceService.create = async () => ({ _id: hex24() });
  pinConnected();
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  SupportRequest.find = originalFind;
  SupportRequest.create = originalCreate;
  SupportRequest.findById = originalFindById;
  SupportRequest.findByIdAndUpdate = originalFindByIdAndUpdate;
  notificationPersistenceService.create = originalNotificationCreate;
  await closePostgres();
});

// ─── PostgreSQL path ───────────────────────────────────────────────────────
test("devotee controller (PG): submitSupportRequest persists one row and keeps the 201 shape", async () => {
  const calls = stubMongo();
  const res = createMockRes();
  const email = `submit_${unique()}@example.com`;
  await devoteeController.submitSupportRequest(
    { body: { name: "  Devotee One  ", email, subject: "  Timing  ", message: "  Evening aarti?  " } },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.status, "success");
  assert.strictEqual(res.body.message, "Support request received.");
  // The service trims the required text paths, as Mongoose's `trim` does.
  assert.strictEqual(res.body.request.name, "Devotee One");
  assert.strictEqual(res.body.request.subject, "Timing");
  assert.strictEqual(res.body.request.message, "Evening aarti?");
  assert.strictEqual(res.body.request.status, "Open");
  assert.strictEqual(res.body.request.read, false);
  assert.ok(/^[0-9a-f]{24}$/.test(res.body.request._id));

  const rows = await pgQuery("SELECT name, email, subject, status FROM support_requests WHERE id = $1", [res.body.request._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, "Devotee One");
  assert.strictEqual(rows[0].status, "Open");
  assert.strictEqual(calls.creates.length, 0, "no dual write to Mongo");
});

test("devotee controller (PG): submitSupportRequest defaults name/email when absent", async () => {
  const res = createMockRes();
  await devoteeController.submitSupportRequest({ body: { subject: "Anonymous", message: "Hello" } }, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.request.name, "Anonymous Devotee");
  assert.strictEqual(res.body.request.email, "support@devotee.com");

  const rows = await pgQuery("SELECT name, email FROM support_requests WHERE id = $1", [res.body.request._id]);
  assert.strictEqual(rows[0].name, "Anonymous Devotee");
  assert.strictEqual(rows[0].email, "support@devotee.com");
});

test("devotee controller (PG): submitSupportRequest 400s without subject or message", async () => {
  const before = (await pgQuery("SELECT id FROM support_requests")).map((r) => r.id).sort();
  for (const body of [{ message: "no subject" }, { subject: "no message" }, {}]) {
    const res = createMockRes();
    await devoteeController.submitSupportRequest({ body }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, "Please provide a subject and message.");
  }
  const after = (await pgQuery("SELECT id FROM support_requests")).map((r) => r.id).sort();
  assert.deepStrictEqual(after, before, "nothing was written");
});

test("devotee controller (PG): getSupportRequests lists newest first and filters by email", async () => {
  const email = `list_${unique()}@example.com`;
  const a = await supportRequestService.create({ name: "A", email, subject: "first", message: "m" });
  const b = await supportRequestService.create({ name: "B", email, subject: "second", message: "m" });

  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: { email } }, res);

  assert.strictEqual(res.statusCode, 200);
  const mine = res.body.requests.filter((r) => r.email === email);
  assert.strictEqual(mine.length, 2);
  const ids = mine.map((r) => r._id);
  assert.ok(ids.indexOf(b._id) <= ids.indexOf(a._id), "createdAt descending");
});

test("devotee controller (PG): getSupportRequests lowercases the query email like the original filter", async () => {
  const email = `mixed_${unique()}@example.com`; // stored verbatim, lowercased already
  const created = await supportRequestService.create({ name: "C", email, subject: "s", message: "m" });
  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: { email: `  ${email.toUpperCase()}  ` } }, res);

  assert.strictEqual(res.statusCode, 200);
  // The stored value is not lowercased by the model, so an upper-cased stored
  // email would not match; this asserts the controller still lowercases the
  // query (the pre-migration behaviour) and that a lowercased stored row matches.
  const found = res.body.requests.find((r) => r._id === created._id);
  assert.ok(found, "the lowercase query matched the lowercase stored row");
});

test("devotee controller (PG): getSupportRequests with no email returns all requests", async () => {
  const created = await supportRequestService.create({ name: "All", email: `all_${unique()}@example.com`, subject: "s", message: "m" });
  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: {} }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.requests.some((r) => r._id === created._id));
});

test("devotee controller (PG): replySupportRequest sets the reply and falls back to 'Closed'", async () => {
  const created = await supportRequestService.create({ name: "R", email: `reply_${unique()}@example.com`, subject: "help", message: "m" });

  const res = createMockRes();
  await devoteeController.replySupportRequest({ params: { id: created._id }, body: { reply: "  We can help.  " } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.request.reply, "We can help.");
  assert.strictEqual(res.body.request.status, "Closed", "an absent/invalid status falls back to Closed");

  const rows = await pgQuery("SELECT reply, status FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].reply, "We can help.");
  assert.strictEqual(rows[0].status, "Closed");
});

test("devotee controller (PG): replySupportRequest honours a valid status and ignores a bogus one", async () => {
  const created = await supportRequestService.create({ name: "R2", email: `reply2_${unique()}@example.com`, subject: "help", message: "m" });

  const valid = createMockRes();
  await devoteeController.replySupportRequest({ params: { id: created._id }, body: { reply: "Looking into it", status: "In Progress" } }, valid);
  assert.strictEqual(valid.body.request.status, "In Progress");

  const bogus = createMockRes();
  await devoteeController.replySupportRequest({ params: { id: created._id }, body: { reply: "Done", status: "Bogus" } }, bogus);
  assert.strictEqual(bogus.statusCode, 200, "a bogus status does not error — it falls back to Closed");
  assert.strictEqual(bogus.body.request.status, "Closed");
});

test("devotee controller (PG): replySupportRequest 400s without reply text and 404s for an unknown id", async () => {
  const created = await supportRequestService.create({ name: "R3", email: `reply3_${unique()}@example.com`, subject: "help", message: "m" });

  const noReply = createMockRes();
  await devoteeController.replySupportRequest({ params: { id: created._id }, body: {} }, noReply);
  assert.strictEqual(noReply.statusCode, 400);
  assert.strictEqual(noReply.body.error, "Reply text is required.");

  const missing = createMockRes();
  await devoteeController.replySupportRequest({ params: { id: hex24() }, body: { reply: "Hi" } }, missing);
  assert.strictEqual(missing.statusCode, 404);
  assert.strictEqual(missing.body.error, "Support request not found.");
});

test("devotee controller (PG): markSupportRequestAsRead flips read and 404s for an unknown id", async () => {
  const created = await supportRequestService.create({ name: "M", email: `read_${unique()}@example.com`, subject: "s", message: "m" });
  assert.strictEqual(created.read, false);

  const res = createMockRes();
  await devoteeController.markSupportRequestAsRead({ params: { id: created._id } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.supportRequest.read, true);

  const rows = await pgQuery("SELECT read FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].read, true);

  const missing = createMockRes();
  await devoteeController.markSupportRequestAsRead({ params: { id: hex24() } }, missing);
  assert.strictEqual(missing.statusCode, 404);
  assert.strictEqual(missing.body.error, "Support request not found.");
});

// ─── Mongo fallback ────────────────────────────────────────────────────────
test("devotee controller (Mongo fallback): submitSupportRequest writes through Mongoose", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const res = createMockRes();
  await devoteeController.submitSupportRequest({ body: { name: "Mongo Devotee", email: "m@e.com", subject: "Hi", message: "There" } }, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(calls.creates.length, 1, "Mongoose create is the write path");
  assert.strictEqual(calls.creates[0].name, "Mongo Devotee");
  assert.strictEqual(calls.creates[0].subject, "Hi");

  const rows = await pgQuery("SELECT id FROM support_requests WHERE email = $1", ["m@e.com"]);
  assert.strictEqual(rows.length, 0, "no dual write to PostgreSQL");
  pinConnected();
});

test("devotee controller (Mongo fallback): getSupportRequests reads through Mongoose with the same filter and sort", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: { email: "Filter@Example.com" } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.finds[0], { email: "filter@example.com" }, "the trimmed, lowercased email filter is preserved");
  assert.deepStrictEqual(calls.finds[1], { createdAt: -1 }, "sorted newest first, as before the migration");
  pinConnected();
});

test("devotee controller (Mongo fallback): replySupportRequest keeps the findById + save contract", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const res = createMockRes();
  // The stub returns null from findById, so the handler must 404 without writing.
  await devoteeController.replySupportRequest({ params: { id: hex24() }, body: { reply: "Hi" } }, res);

  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(calls.findByIds.length, 1, "Mongoose findById is the read path on the fallback");
  pinConnected();
});

test("devotee controller (Mongo fallback): markSupportRequestAsRead uses findByIdAndUpdate with { new: true }", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const id = hex24();
  const res = createMockRes();
  await devoteeController.markSupportRequestAsRead({ params: { id } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.updates.length, 1);
  assert.strictEqual(calls.updates[0].id, id);
  assert.deepStrictEqual(calls.updates[0].updates, { read: true });
  assert.deepStrictEqual(calls.updates[0].options, { new: true }, "the { new: true } option is preserved");
  pinConnected();
});

// ─── Datasource switching ──────────────────────────────────────────────────
test("datasource switching: the same process flips between PG and Mongo by patching the seam", async () => {
  const email = `switch_${unique()}@example.com`;

  pinConnected();
  assert.strictEqual(await supportRequestService.usePostgres(), true);
  const created = await supportRequestService.create({ name: "Switch", email, subject: "s", message: "m" });
  assert.strictEqual(created._id.length, 24);
  const pgRows = await pgQuery("SELECT id FROM support_requests WHERE email = $1", [email]);
  assert.strictEqual(pgRows.length, 1, "row landed in PostgreSQL");

  pinDisconnected();
  const calls = stubMongo();
  assert.strictEqual(await supportRequestService.usePostgres(), false);
  await supportRequestService.create({ name: "Switch Mongo", email: `mongo_${unique()}@example.com`, subject: "s", message: "m" });
  assert.strictEqual(calls.creates.length, 1, "Mongoose handled the write once the seam flipped");

  pinConnected();
});

test("datasource gate: PostgreSQL unreachable falls back to Mongo even when the seam is connected", async () => {
  const saved = process.env.DATABASE_URL;
  try {
    pinConnected();
    process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nope";
    await closePostgres();
    assert.strictEqual(await supportRequestService.usePostgres(), false, "the PG probe gates the path, not just the seam");
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
    pinConnected();
  }
});
