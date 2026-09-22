// Phase 2AH controller-level tests for the SupportRequest endpoints.
//
// These drive the real devoteeController handlers (not the service in
// isolation) so the API contract is verified end-to-end:
//   - submitSupportRequest / getSupportRequests / replySupportRequest /
//     markSupportRequestAsRead persist and read through the PostgreSQL
//     repository when the datasource seam selects PostgreSQL,
//   - the same handlers fall back to Mongoose when the seam selects Mongo,
//   - a write reaches exactly one datasource (no dual persistence),
//   - the response shapes, status codes, defaults, validation, filtering and
//     sorting are unchanged from before the wiring,
//   - the outbound notificationPersistenceService.create side effect still
//     fires exactly ONCE per create/reply on the PostgreSQL path, and is never
//     duplicated.
//
// The Mongo model is stubbed (not a live MongoDB) because these tests must prove
// *which* datasource each handler selected and that the Mongo branch genuinely
// invokes the Mongoose model — the PG branch is exercised against the real
// PostgreSQL tables with no mocks.
//
// Notification is deliberately NOT migrated in this phase. The controller still
// calls the pre-existing notificationPersistenceService, whose own datasource
// selection is untouched; these tests assert only that the SupportRequest wiring
// invokes it exactly once.
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
      limit: () => chain,
      skip: () => chain,
      then: (resolve) => Promise.resolve([]).then(resolve),
    };
    return chain;
  };
  SupportRequest.create = async (data) => {
    calls.creates.push(data);
    return { ...data, _id: hex24(), status: data.status || "Open", read: data.read || false };
  };
  SupportRequest.findById = async (id) => {
    calls.findByIds.push(id);
    return null;
  };
  SupportRequest.findOne = async (filter) => filter;
  SupportRequest.countDocuments = async () => 0;
  SupportRequest.findByIdAndUpdate = async (id, updates, options) => {
    calls.updates.push({ id, updates, options });
    return { _id: id, ...updates };
  };
  return calls;
};

// Counts the outbound notification side effect without touching MongoDB or
// PostgreSQL: the SupportRequest wiring must invoke it exactly once.
const countNotifications = () => {
  const original = notificationPersistenceService.create;
  const calls = [];
  notificationPersistenceService.create = async (data) => {
    calls.push(data);
    return { _id: hex24(), ...data };
  };
  return {
    calls,
    restore: () => { notificationPersistenceService.create = original; },
  };
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;

  await resetAllTables(TEST_DB_URL);
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  if (res.status !== 0) throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);

  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;

  devoteeController = require("../src/controllers/devoteeController");
  supportRequestService = require("../src/services/supportRequestService");
  pinConnected();
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// ─── Routes are unchanged ──────────────────────────────────────────────────
test("routes: the four support endpoints keep their URLs, methods and both prefixes", () => {
  const devoteeRoutes = require("../src/routes/devoteeRoutes");
  const support = devoteeRoutes.stack
    .filter((layer) => layer.route && layer.route.path.startsWith("/support"))
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

  assert.deepStrictEqual(support.sort(), [
    "GET /support",
    "PATCH /support/:id",
    "PATCH /support/:id/read",
    "POST /support",
  ]);

  // app.js mounts the same router under both prefixes; that is unchanged by this
  // phase and is asserted so a future edit cannot silently drop one.
  const appSource = require("fs").readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  assert.match(appSource, /app\.use\("\/api\/devotee", devoteeRoutes\)/);
  assert.match(appSource, /app\.use\("\/api\/devotees", devoteeRoutes\)/);
});

// ─── POST /support ─────────────────────────────────────────────────────────
test("POST /support (PG): creates a request, returns 201 and fires one notification", async () => {
  pinConnected();
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.submitSupportRequest(
      { body: { name: "  Devotee One  ", email: "  one@example.com  ", subject: " Help ", message: " Please " } },
      res
    );

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.status, "success");
    assert.strictEqual(res.body.message, "Support request received.");
    assert.strictEqual(res.body.request.name, "Devotee One", "the schema trim is applied");
    assert.strictEqual(res.body.request.email, "one@example.com");
    assert.strictEqual(res.body.request.subject, "Help");
    assert.strictEqual(res.body.request.message, "Please");
    assert.strictEqual(res.body.request.status, "Open");
    assert.strictEqual(res.body.request.read, false);

    const rows = await pgQuery("SELECT id, subject, status, read FROM support_requests WHERE id = $1", [res.body.request._id]);
    assert.strictEqual(rows.length, 1, "the request landed in PostgreSQL");

    assert.strictEqual(notif.calls.length, 1, "exactly one notification was created");
    assert.strictEqual(notif.calls[0].title, "New Support Request");
    assert.strictEqual(notif.calls[0].message, "Devotee One raised: Help");
  } finally {
    notif.restore();
  }
});

test("POST /support (PG): name and email default when omitted, exactly as before", async () => {
  pinConnected();
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.submitSupportRequest({ body: { subject: "No name", message: "Body" } }, res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.request.name, "Anonymous Devotee");
    assert.strictEqual(res.body.request.email, "support@devotee.com");
    assert.strictEqual(notif.calls[0].message, "Anonymous Devotee raised: No name");
  } finally {
    notif.restore();
  }
});

test("POST /support (PG): an empty-string name/email also takes the default", async () => {
  pinConnected();
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.submitSupportRequest(
      { body: { name: "", email: "", subject: "S", message: "M" } },
      res
    );
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.request.name, "Anonymous Devotee");
    assert.strictEqual(res.body.request.email, "support@devotee.com");
  } finally {
    notif.restore();
  }
});

test("POST /support (PG): a missing subject or message returns 400 and writes nothing", async () => {
  pinConnected();
  const notif = countNotifications();
  const before = (await pgQuery("SELECT count(*)::int AS n FROM support_requests"))[0].n;
  try {
    for (const body of [
      { message: "M" },
      { subject: "S" },
      {},
      { subject: "", message: "M" },
      { subject: "S", message: "" },
    ]) {
      const res = createMockRes();
      await devoteeController.submitSupportRequest({ body }, res);
      assert.strictEqual(res.statusCode, 400, `body ${JSON.stringify(body)} is rejected`);
      assert.strictEqual(res.body.error, "Please provide a subject and message.");
    }
    const after = (await pgQuery("SELECT count(*)::int AS n FROM support_requests"))[0].n;
    assert.strictEqual(after, before, "nothing was written to PostgreSQL");
    assert.strictEqual(notif.calls.length, 0, "no notification was created");
  } finally {
    notif.restore();
  }
});

// ─── GET /support ──────────────────────────────────────────────────────────
test("GET /support (PG): returns { requests } sorted createdAt DESC", async () => {
  pinConnected();
  const email = `get-${unique()}@example.com`;
  await supportRequestService.create({ name: "A", email, subject: "old", message: "M", createdAt: new Date("2024-01-01T00:00:00Z") });
  await supportRequestService.create({ name: "B", email, subject: "new", message: "M", createdAt: new Date("2025-01-01T00:00:00Z") });

  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: { email } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.requests), "the response shape stays { requests }");
  assert.deepStrictEqual(res.body.requests.map((r) => r.subject), ["new", "old"]);
});

test("GET /support (PG): the email query parameter is trimmed and lowercased", async () => {
  pinConnected();
  const email = `lower-${unique()}@example.com`;
  const created = await supportRequestService.create({ name: "A", email, subject: "lowercase-filter", message: "M" });

  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: { email: `  ${email.toUpperCase()}  ` } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(
    res.body.requests.map((r) => r._id),
    [created._id],
    "the query value is lowercased before the equality filter"
  );
});

test("GET /support (PG): no email parameter returns every request", async () => {
  pinConnected();
  const res = createMockRes();
  await devoteeController.getSupportRequests({ query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.requests.length > 0);

  const res2 = createMockRes();
  await devoteeController.getSupportRequests({ query: { email: "   " } }, res2);
  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(res2.body.requests.length, res.body.requests.length, "a blank filter means no filter");
});

test("GET /support (PG): a datasource failure returns the unchanged 500 shape", async () => {
  pinConnected();
  const original = supportRequestService.findMany;
  supportRequestService.findMany = async () => { throw new Error("boom"); };
  try {
    const res = createMockRes();
    await devoteeController.getSupportRequests({ query: {} }, res);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error, "Failed to load support requests.");
  } finally {
    supportRequestService.findMany = original;
  }
});

// ─── PATCH /support/:id ────────────────────────────────────────────────────
test("PATCH /support/:id (PG): stores the reply, keeps a valid status and fires one notification", async () => {
  pinConnected();
  const created = await supportRequestService.create({ name: "R", email: "reply@example.com", subject: "Rep", message: "M" });
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.replySupportRequest(
      { params: { id: created._id }, body: { reply: "  We fixed it  ", status: "In Progress" } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.request.reply, "We fixed it");
    assert.strictEqual(res.body.request.status, "In Progress");

    const rows = await pgQuery("SELECT reply, status FROM support_requests WHERE id = $1", [created._id]);
    assert.strictEqual(rows[0].reply, "We fixed it");
    assert.strictEqual(rows[0].status, "In Progress");

    assert.strictEqual(notif.calls.length, 1, "exactly one notification was created");
    assert.strictEqual(notif.calls[0].title, "Feedback Response");
    assert.strictEqual(notif.calls[0].audienceEmail, "reply@example.com");
  } finally {
    notif.restore();
  }
});

test("PATCH /support/:id (PG): every valid enum status is preserved", async () => {
  pinConnected();
  for (const status of ["Open", "In Progress", "Closed"]) {
    const created = await supportRequestService.create({ name: "R", email: "s@example.com", subject: "S", message: "M" });
    const notif = countNotifications();
    try {
      const res = createMockRes();
      await devoteeController.replySupportRequest(
        { params: { id: created._id }, body: { reply: "r", status } },
        res
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.request.status, status, `${status} is preserved`);
    } finally {
      notif.restore();
    }
  }
});

test("PATCH /support/:id (PG): an invalid or missing status becomes Closed", async () => {
  pinConnected();
  for (const status of [undefined, "", "Bogus", "open", "Closed ", null]) {
    const created = await supportRequestService.create({ name: "R", email: "s@example.com", subject: "S", message: "M" });
    const notif = countNotifications();
    try {
      const res = createMockRes();
      await devoteeController.replySupportRequest(
        { params: { id: created._id }, body: { reply: "r", status } },
        res
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.request.status, "Closed", `status=${JSON.stringify(status)} falls back to Closed`);
      const rows = await pgQuery("SELECT status FROM support_requests WHERE id = $1", [created._id]);
      assert.strictEqual(rows[0].status, "Closed");
    } finally {
      notif.restore();
    }
  }
});

test("PATCH /support/:id (PG): a missing reply returns 400 and writes nothing", async () => {
  pinConnected();
  const created = await supportRequestService.create({ name: "R", email: "s@example.com", subject: "S", message: "M" });
  const notif = countNotifications();
  try {
    for (const reply of [undefined, "", null]) {
      const res = createMockRes();
      await devoteeController.replySupportRequest({ params: { id: created._id }, body: { reply } }, res);
      assert.strictEqual(res.statusCode, 400, `reply=${JSON.stringify(reply)} is rejected`);
      assert.strictEqual(res.body.error, "Reply text is required.");
    }
    const rows = await pgQuery("SELECT reply FROM support_requests WHERE id = $1", [created._id]);
    assert.strictEqual(rows[0].reply, null, "the request was not modified");
    assert.strictEqual(notif.calls.length, 0, "no notification was created");
  } finally {
    notif.restore();
  }
});

test("PATCH /support/:id (PG): an unknown id returns 404 and fires no notification", async () => {
  pinConnected();
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.replySupportRequest(
      { params: { id: hex24() }, body: { reply: "r", status: "Closed" } },
      res
    );
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.error, "Support request not found.");
    assert.strictEqual(notif.calls.length, 0, "no notification for a missing request");
  } finally {
    notif.restore();
  }
});

// ─── PATCH /support/:id/read ───────────────────────────────────────────────
test("PATCH /support/:id/read (PG): sets read = true and keeps the response shape", async () => {
  pinConnected();
  const created = await supportRequestService.create({ name: "R", email: "read@example.com", subject: "Read", message: "M" });

  const res = createMockRes();
  await devoteeController.markSupportRequestAsRead({ params: { id: created._id } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.supportRequest, "the response key is supportRequest");
  assert.strictEqual(res.body.supportRequest.read, true);
  assert.strictEqual(res.body.supportRequest.subject, "Read");

  const rows = await pgQuery("SELECT read FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].read, true);
});

test("PATCH /support/:id/read (PG): an unknown id returns 404", async () => {
  pinConnected();
  const res = createMockRes();
  await devoteeController.markSupportRequestAsRead({ params: { id: hex24() } }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.error, "Support request not found.");
});

test("PATCH /support/:id/read (PG): a datasource failure returns the unchanged 500 shape", async () => {
  pinConnected();
  const original = supportRequestService.markRead;
  supportRequestService.markRead = async () => { throw new Error("boom"); };
  try {
    const res = createMockRes();
    await devoteeController.markSupportRequestAsRead({ params: { id: hex24() } }, res);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error, "Failed to mark support request as read.");
  } finally {
    supportRequestService.markRead = original;
  }
});

// ─── Notification side effect fires exactly once, never twice ──────────────
test("notification: a PG create and reply each fire exactly one side effect (never a duplicate)", async () => {
  pinConnected();
  const notif = countNotifications();
  const mongo = stubMongo();
  try {
    const createRes = createMockRes();
    await devoteeController.submitSupportRequest({ body: { subject: "N1", message: "M" } }, createRes);
    assert.strictEqual(notif.calls.length, 1, "one notification after create");

    const replyRes = createMockRes();
    await devoteeController.replySupportRequest(
      { params: { id: createRes.body.request._id }, body: { reply: "r", status: "Closed" } },
      replyRes
    );
    assert.strictEqual(notif.calls.length, 2, "exactly one more notification after reply");

    assert.strictEqual(mongo.creates.length, 0, "no duplicate Mongo SupportRequest write");
    assert.strictEqual(mongo.updates.length, 0);
  } finally {
    notif.restore();
  }
});

test("notification: notificationPersistenceService keeps its own datasource selection (Notification not migrated here)", async () => {
  // The SupportRequest wiring must not have changed how Notification selects a
  // datasource: the pre-existing service still exposes usePostgres and is the
  // single call site. Notification is out of scope for this phase.
  assert.strictEqual(typeof notificationPersistenceService.usePostgres, "function");
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "src", "controllers", "devoteeController.js"),
    "utf8"
  );
  const handlerBody = (name, nextName) =>
    src.slice(src.indexOf(`const ${name} =`), src.indexOf(`const ${nextName} =`));

  for (const [name, next] of [
    ["submitSupportRequest", "updateProfile"],
    ["replySupportRequest", "createNotification"],
  ]) {
    const calls = handlerBody(name, next).match(/notificationPersistenceService\.create/g) || [];
    assert.strictEqual(calls.length, 1, `${name} fires the side effect exactly once`);
  }
});

// ─── Mongo fallback ────────────────────────────────────────────────────────
test("POST /support (Mongo fallback): writes through the Mongoose model and not PostgreSQL", async () => {
  pinDisconnected();
  const mongo = stubMongo();
  const notif = countNotifications();
  const before = (await pgQuery("SELECT count(*)::int AS n FROM support_requests"))[0].n;
  try {
    const res = createMockRes();
    await devoteeController.submitSupportRequest(
      { body: { name: "Mongo Devotee", subject: "Mongo subject", message: "M" } },
      res
    );

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(mongo.creates.length, 1, "Mongoose create is the write path");
    assert.strictEqual(mongo.creates[0].name, "Mongo Devotee");
    assert.strictEqual(mongo.creates[0].email, "support@devotee.com", "the controller default is still applied");
    assert.strictEqual(notif.calls.length, 1, "the notification side effect still fires once on the fallback path");

    const after = (await pgQuery("SELECT count(*)::int AS n FROM support_requests"))[0].n;
    assert.strictEqual(after, before, "no dual write to PostgreSQL");
  } finally {
    notif.restore();
    pinConnected();
  }
});

test("GET /support (Mongo fallback): reads through the Mongoose model with the same filter and sort", async () => {
  pinDisconnected();
  const mongo = stubMongo();
  try {
    const res = createMockRes();
    await devoteeController.getSupportRequests({ query: { email: "  Fallback@Example.com  " } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(mongo.finds[0], { email: "fallback@example.com" }, "the same trimmed+lowercased filter");
    assert.deepStrictEqual(mongo.finds[1], { createdAt: -1 }, "the same sort");
  } finally {
    pinConnected();
  }
});

test("GET /support (Mongo fallback): no email yields an empty filter", async () => {
  pinDisconnected();
  const mongo = stubMongo();
  try {
    const res = createMockRes();
    await devoteeController.getSupportRequests({ query: {} }, res);
    assert.deepStrictEqual(mongo.finds[0], {});
  } finally {
    pinConnected();
  }
});

test("PATCH /support/:id (Mongo fallback): loads, mutates and saves through Mongoose", async () => {
  pinDisconnected();
  const id = hex24();
  const saved = [];
  let docRef;
  SupportRequest.findById = async (docId) => {
    docRef = {
      _id: docId,
      subject: "Fallback",
      email: "f@example.com",
      status: "Open",
      save: async () => { saved.push({ id: docId, reply: docRef.reply, status: docRef.status }); },
    };
    return docRef;
  };
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.replySupportRequest(
      { params: { id }, body: { reply: "  done  ", status: "Bogus" } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.request.reply, "done");
    assert.strictEqual(res.body.request.status, "Closed", "an invalid status becomes Closed");
    assert.strictEqual(saved.length, 1, "the document was saved through Mongoose");
    assert.strictEqual(notif.calls.length, 1);
  } finally {
    notif.restore();
    pinConnected();
  }
});

test("PATCH /support/:id (Mongo fallback): a missing document returns 404", async () => {
  pinDisconnected();
  SupportRequest.findById = async () => null;
  const notif = countNotifications();
  try {
    const res = createMockRes();
    await devoteeController.replySupportRequest(
      { params: { id: hex24() }, body: { reply: "r" } },
      res
    );
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(notif.calls.length, 0);
  } finally {
    notif.restore();
    pinConnected();
  }
});

test("PATCH /support/:id/read (Mongo fallback): keeps the findByIdAndUpdate contract", async () => {
  pinDisconnected();
  const mongo = stubMongo();
  const id = hex24();
  try {
    const res = createMockRes();
    await devoteeController.markSupportRequestAsRead({ params: { id } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(mongo.updates.length, 1);
    assert.strictEqual(mongo.updates[0].id, id);
    assert.deepStrictEqual(mongo.updates[0].updates, { read: true });
    assert.deepStrictEqual(mongo.updates[0].options, { new: true }, "the { new: true } option is preserved");
    assert.strictEqual(res.body.supportRequest.read, true);
  } finally {
    pinConnected();
  }
});

// ─── Datasource switching ──────────────────────────────────────────────────
test("datasource switching: the same handlers flip between PG and Mongo by patching the seam", async () => {
  const tag = unique();

  pinConnected();
  const pgRes = createMockRes();
  const notif = countNotifications();
  try {
    await devoteeController.submitSupportRequest({ body: { subject: `switch-${tag}`, message: "M" } }, pgRes);
    assert.strictEqual(pgRes.statusCode, 201);
    const pgRows = await pgQuery("SELECT id FROM support_requests WHERE subject = $1", [`switch-${tag}`]);
    assert.strictEqual(pgRows.length, 1, "row landed in PostgreSQL");

    pinDisconnected();
    const mongo = stubMongo();
    const mongoRes = createMockRes();
    await devoteeController.submitSupportRequest({ body: { subject: `switch-mongo-${tag}`, message: "M" } }, mongoRes);
    assert.strictEqual(mongo.creates.length, 1, "Mongoose handled the write once the seam flipped");

    const leaked = await pgQuery("SELECT id FROM support_requests WHERE subject = $1", [`switch-mongo-${tag}`]);
    assert.strictEqual(leaked.length, 0, "no dual write while Mongo was selected");
  } finally {
    notif.restore();
    pinConnected();
  }
});

// ─── Regression: unrelated devotee handlers are untouched ─────────────────
test("regression: unrelated devotee handlers do not import or call the support service", () => {
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "src", "controllers", "devoteeController.js"),
    "utf8"
  );
  // Only the four SupportRequest handlers may reference the new service.
  const references = src.split("\n")
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((entry) => entry.text.includes("supportRequestService."));
  assert.strictEqual(references.length, 5, `expected 5 service calls, found ${references.length}`);

  // Those five call sites must all sit inside the four support handlers.
  const bounds = [
    ["submitSupportRequest", "updateProfile"],
    ["getSupportRequests", "replySupportRequest"],
    ["replySupportRequest", "createNotification"],
    ["markSupportRequestAsRead", "sendNotificationEmail"],
  ].map(([name, next]) => [
    src.slice(0, src.indexOf(`const ${name} =`)).split("\n").length,
    src.slice(0, src.indexOf(`const ${next} =`)).split("\n").length,
  ]);

  for (const { line } of references) {
    assert.ok(
      bounds.some(([start, end]) => line >= start && line <= end),
      `supportRequestService call on line ${line} is outside the four support handlers`
    );
  }
});
