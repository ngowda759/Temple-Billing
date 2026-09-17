// Phase 2W PostgreSQL tests for the Notification repository and persistence
// service.
//
// The Notification domain is migrated additively: PostgreSQL is an additional
// persistence path selected at operation time, MongoDB stays the source of
// truth and the fallback. These tests exercise the real PostgreSQL path (the
// datasource seam is pinned "connected" and DATABASE_URL points at the test
// database, so every operation below reaches the real notificationRepository
// and the real notifications table). They verify:
//   - the complete Mongo → PostgreSQL field mapping (every persisted field),
//   - nullability and the schema's own defaults,
//   - read/readAt and viewed/viewedAt semantics, including the unread count,
//   - the recipient (audienceId / audienceEmail / audienceRole) semantics and
//     that one recipient's rows never leak into another's query,
//   - filtering ($or, $in, $nin, $ne, null-handling), sorting and pagination,
//   - that no operation writes to both databases (no dual writes),
//   - the datasource seam genuinely selects both paths, and the Mongo fallback
//     really runs Mongoose when PostgreSQL is unavailable.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Notification = require("../src/models/Notification");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");
const emailFor = (tag) => `${tag}-${unique()}@example.com`;

let originalIsDbConnected;
let notificationRepository;
let notificationPersistenceService;

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const runMigrate = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await pgQuery("DROP TABLE IF EXISTS notifications CASCADE");
  await pgQuery("DROP TABLE IF EXISTS schema_migrations");
  runMigrate();
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;
  notificationRepository = require("../src/repositories/notificationRepository");
  notificationPersistenceService = require("../src/services/notificationPersistenceService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const notificationPayload = (overrides = {}) => ({
  title: "Temple Announcement",
  message: "The temple will remain closed on Monday.",
  audienceId: unique(),
  audienceEmail: emailFor("staff"),
  audienceRole: "staff",
  category: "event",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("notifications: the service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(notificationPersistenceService.isConnected(), true);
  assert.strictEqual(await notificationPersistenceService.usePostgres(), true);
});

test("notifications: the service falls back to Mongoose when the datasource seam is disconnected", async () => {
  const original = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(notificationPersistenceService.isConnected(), false);
    assert.strictEqual(await notificationPersistenceService.usePostgres(), false);
  } finally {
    dbConfig.isDbConnected = original;
  }
});

// ─── Full field mapping ────────────────────────────────────────────────────
test("notifications (PG): every persisted Mongo field round-trips through the repository", async () => {
  const payload = notificationPayload({
    title: "  Festival Notice  ",
    message: "  Brahmotsavam begins on 20 May.  ",
    audienceId: "abc123",
    audienceEmail: "  Devotee@Example.COM  ",
    audienceRole: "  Priest  ",
    category: "  festival  ",
    date: new Date("2026-05-20T08:00:00Z"),
    viewed: true,
    viewedAt: new Date("2026-05-20T09:00:00Z"),
    read: false,
    readAt: null,
    attachment: "https://example.com/invite.pdf",
    emailSent: true,
    emailSentAt: new Date("2026-05-20T08:05:00Z"),
    emailRecipient: "  Devotee@Example.COM  ",
  });

  const created = await notificationRepository.create(payload);
  assert.ok(created._id, "a Mongo-shaped _id is returned");

  const found = await notificationRepository.findById(created._id);
  assert.strictEqual(found._id, created._id);
  assert.strictEqual(found.id, created._id, "the helper id is exposed too");
  assert.strictEqual(found.title, "Festival Notice", "title is trimmed");
  assert.strictEqual(found.message, "Brahmotsavam begins on 20 May.", "message is trimmed");
  assert.strictEqual(found.audienceId, "abc123");
  assert.strictEqual(found.audienceEmail, "devotee@example.com", "audienceEmail is lowercased");
  assert.strictEqual(found.audienceRole, "priest", "audienceRole is lowercased");
  assert.strictEqual(found.category, "festival");
  assert.strictEqual(found.viewed, true);
  assert.ok(found.viewedAt instanceof Date);
  assert.strictEqual(found.viewedAt.toISOString(), "2026-05-20T09:00:00.000Z");
  assert.strictEqual(found.read, false);
  assert.strictEqual(found.readAt, null);
  assert.strictEqual(found.attachment, "https://example.com/invite.pdf");
  assert.strictEqual(found.emailSent, true);
  assert.ok(found.emailSentAt instanceof Date);
  assert.strictEqual(found.emailRecipient, "devotee@example.com");
  assert.ok(found.date instanceof Date);
  assert.strictEqual(found.date.toISOString(), "2026-05-20T08:00:00.000Z");
  assert.ok(found.createdAt instanceof Date);
  assert.ok(found.updatedAt instanceof Date);

  // The row really is in PostgreSQL under the same id.
  const rows = await pgQuery(
    "SELECT id, title, audience_email, audience_role FROM notifications WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, "Festival Notice");
});

test("notifications (PG): optional fields stay absent and the schema defaults apply", async () => {
  const created = await notificationRepository.create({
    title: "Minimal",
    message: "Body",
  });
  const found = await notificationRepository.findById(created._id);

  // No default in the schema → the field is absent/undefined, like a Mongo doc.
  for (const field of [
    "audienceId", "audienceEmail", "audienceRole", "category", "attachment",
    "emailRecipient",
  ]) {
    assert.strictEqual(found[field], undefined, `${field} should be absent`);
  }
  // Schema defaults.
  assert.strictEqual(found.read, false);
  assert.strictEqual(found.viewed, false);
  assert.strictEqual(found.emailSent, false);
  assert.strictEqual(found.readAt, null);
  assert.strictEqual(found.viewedAt, null);
  assert.strictEqual(found.emailSentAt, null);
  assert.ok(found.date instanceof Date, "date defaults to now");
  assert.ok(found.createdAt instanceof Date);
  assert.ok(found.updatedAt instanceof Date);
});

test("notifications (PG): required title/message are enforced as the schema enforces them", async () => {
  await assert.rejects(
    () => notificationRepository.create({ message: "Body" }),
    /title is required/,
  );
  await assert.rejects(
    () => notificationRepository.create({ title: "Title" }),
    /message is required/,
  );
  // Mongoose trims before the required check, so an all-whitespace value fails.
  await assert.rejects(
    () => notificationRepository.create({ title: "   ", message: "Body" }),
    /title is required/,
  );
});

test("notifications (PG): a broadcast array creates one row per recipient", async () => {
  const role = "broadcast-" + unique();
  const created = await notificationRepository.create([
    { title: "Broadcast", message: "M", audienceRole: role, audienceEmail: emailFor("b1") },
    { title: "Broadcast", message: "M", audienceRole: role, audienceEmail: emailFor("b2") },
    { title: "Broadcast", message: "M", audienceRole: role, audienceEmail: emailFor("b3") },
  ]);

  assert.strictEqual(created.length, 3);
  const ids = new Set(created.map((d) => d._id));
  assert.strictEqual(ids.size, 3, "each recipient gets its own row and id");

  const count = await notificationRepository.countDocuments({ audienceRole: role });
  assert.strictEqual(count, 3);
});

// ─── Read / unread semantics ───────────────────────────────────────────────
test("notifications (PG): a new notification is unread with a null readAt", async () => {
  const created = await notificationRepository.create(
    notificationPayload({ audienceId: undefined, audienceEmail: emailFor("unread") })
  );
  const found = await notificationRepository.findById(created._id);
  assert.strictEqual(found.read, false);
  assert.strictEqual(found.readAt, null);
  assert.strictEqual(found.viewed, false);
  assert.strictEqual(found.viewedAt, null);
});

test("notifications (PG): mark-as-read sets read + readAt exactly like findByIdAndUpdate", async () => {
  const email = emailFor("markread");
  const created = await notificationRepository.create(notificationPayload({ audienceEmail: email, audienceId: undefined }));

  const readAt = new Date();
  const updated = await notificationRepository.findByIdAndUpdate(created._id, {
    read: true,
    readAt,
  });

  assert.ok(updated, "the updated document is returned");
  assert.strictEqual(updated.read, true);
  assert.ok(updated.readAt instanceof Date);
  assert.strictEqual(updated.readAt.toISOString(), readAt.toISOString());
  // Read state does not change `viewed` — the two flags are independent in Mongo.
  assert.strictEqual(updated.viewed, false);
  assert.strictEqual(updated.viewedAt, null);
});

test("notifications (PG): the unread count reflects mark-read and never crosses recipients", async () => {
  const emailA = emailFor("count-a");
  const emailB = emailFor("count-b");
  const role = "count-" + unique();

  for (let i = 0; i < 3; i += 1) {
    await notificationRepository.create({ title: `A${i}`, message: "M", audienceEmail: emailA, audienceRole: role });
    await notificationRepository.create({ title: `B${i}`, message: "M", audienceEmail: emailB, audienceRole: role });
  }

  const filterFor = (email) => ({ audienceEmail: email, read: false });
  assert.strictEqual(await notificationRepository.countDocuments(filterFor(emailA)), 3);
  assert.strictEqual(await notificationRepository.countDocuments(filterFor(emailB)), 3);

  await notificationRepository.findByIdAndUpdate(
    (await notificationRepository.findMany({ filter: { audienceEmail: emailA, title: "A0" } }))[0]._id,
    { read: true, readAt: new Date() }
  );

  assert.strictEqual(await notificationRepository.countDocuments(filterFor(emailA)), 2);
  assert.strictEqual(
    await notificationRepository.countDocuments(filterFor(emailB)),
    3,
    "the other recipient's unread count is untouched"
  );
});

test("notifications (PG): mark-all-read updates only the unread rows in scope", async () => {
  const email = emailFor("markall");
  const role = "markall-" + unique();

  for (let i = 0; i < 4; i += 1) {
    await notificationRepository.create({ title: `N${i}`, message: "M", audienceEmail: email, audienceRole: role });
  }
  // Pre-read one row so the updateMany must skip it.
  const one = (await notificationRepository.findMany({ filter: { audienceEmail: email, title: "N0" } }))[0];
  const firstReadAt = new Date("2026-01-01T00:00:00Z");
  await notificationRepository.findByIdAndUpdate(one._id, { read: true, readAt: firstReadAt });

  const readAt = new Date();
  const result = await notificationRepository.updateMany(
    { audienceEmail: email, audienceRole: role, read: false },
    { read: true, readAt }
  );
  assert.strictEqual(result.modifiedCount, 3, "only the three unread rows are modified");

  assert.strictEqual(await notificationRepository.countDocuments({ audienceEmail: email, read: false }), 0);
  const all = await notificationRepository.findMany({ filter: { audienceEmail: email } });
  assert.strictEqual(all.length, 4);
  assert.ok(all.every((d) => d.read === true));

  // The already-read row keeps its original readAt — the filter excluded it.
  const stillFirst = all.find((d) => d.title === "N0");
  assert.strictEqual(stillFirst.readAt.toISOString(), firstReadAt.toISOString());
});

test("notifications (PG): the viewed flag has its own mark-as-viewed path", async () => {
  const email = emailFor("viewed");
  const role = "viewed-" + unique();
  for (let i = 0; i < 2; i += 1) {
    await notificationRepository.create({ title: `V${i}`, message: "M", audienceEmail: email, audienceRole: role });
  }

  const viewedAt = new Date();
  const result = await notificationRepository.updateMany(
    { audienceEmail: email, audienceRole: role, viewed: false },
    { viewed: true, viewedAt }
  );
  assert.strictEqual(result.modifiedCount, 2);

  const rows = await notificationRepository.findMany({ filter: { audienceEmail: email } });
  assert.ok(rows.every((d) => d.viewed === true && d.viewedAt instanceof Date));
  // Viewing does not imply reading.
  assert.ok(rows.every((d) => d.read === false));
});

test("notifications (PG): the email stamp updates only the three email fields", async () => {
  const created = await notificationRepository.create(
    notificationPayload({ audienceEmail: emailFor("stamp"), audienceId: undefined })
  );
  const stampAt = new Date();
  const updated = await notificationRepository.findByIdAndUpdate(created._id, {
    emailSent: true,
    emailSentAt: stampAt,
    emailRecipient: "  Stamped@Example.COM  ",
  });

  assert.strictEqual(updated.emailSent, true);
  assert.strictEqual(updated.emailSentAt.toISOString(), stampAt.toISOString());
  assert.strictEqual(updated.emailRecipient, "stamped@example.com");
  // The unrelated fields are untouched.
  assert.strictEqual(updated.title, created.title);
  assert.strictEqual(updated.read, false);
  assert.strictEqual(updated.readAt, null);
  assert.strictEqual(updated.audienceEmail, created.audienceEmail);
});

// ─── Recipient semantics ───────────────────────────────────────────────────
test("notifications (PG): recipient queries by audienceId/Email/Role do not leak", async () => {
  const emailX = emailFor("leak-x");
  const emailY = emailFor("leak-y");
  const idX = unique();
  const roleZ = "leak-role-" + unique();

  await notificationRepository.create({ title: "X", message: "M", audienceEmail: emailX });
  await notificationRepository.create({ title: "Y", message: "M", audienceEmail: emailY });
  await notificationRepository.create({ title: "Z", message: "M", audienceId: idX });
  await notificationRepository.create({ title: "R", message: "M", audienceRole: roleZ });

  const x = await notificationRepository.findMany({ filter: { audienceEmail: emailX } });
  assert.deepStrictEqual(x.map((d) => d.title), ["X"]);
  const y = await notificationRepository.findMany({ filter: { audienceEmail: emailY } });
  assert.deepStrictEqual(y.map((d) => d.title), ["Y"]);
  const z = await notificationRepository.findMany({ filter: { audienceId: idX } });
  assert.deepStrictEqual(z.map((d) => d.title), ["Z"]);
  const r = await notificationRepository.findMany({ filter: { audienceRole: roleZ } });
  assert.deepStrictEqual(r.map((d) => d.title), ["R"]);
});

test("notifications (PG): the shared $or recipient filter matches each branch exactly", async () => {
  const role = "or-" + unique();
  const email = emailFor("or");
  const id = unique();

  await notificationRepository.create({ title: "role", message: "M", audienceRole: role });
  await notificationRepository.create({ title: "id", message: "M", audienceId: id });
  await notificationRepository.create({ title: "other", message: "M", audienceRole: "unrelated-" + unique() });

  // The shape staffController builds.
  const rows = await notificationRepository.findMany({
    filter: { $or: [{ audienceRole: role }, { audienceId: id }] },
  });
  assert.deepStrictEqual(rows.map((d) => d.title).sort(), ["id", "role"]);

  // The shape notificationController.buildNotificationsQuery builds, including
  // the $nin category exclusion.
  const withNin = await notificationRepository.findMany({
    filter: { $or: [{ audienceRole: role }, { audienceId: id }], category: { $nin: ["event", "festival"] } },
  });
  assert.deepStrictEqual(withNin.map((d) => d.title).sort(), ["id", "role"]);

  // The devotee general-broadcast predicate: audienceEmail/audienceId in
  // [null, '', undefined] — Mongo also matches a missing field.
  const broadcast = await notificationRepository.create({
    title: "broadcast", message: "M", audienceRole: role,
  });
  const broadcasts = await notificationRepository.findMany({
    filter: {
      audienceRole: role,
      audienceEmail: { $in: [null, "", undefined] },
      audienceId: { $in: [null, "", undefined] },
    },
  });
  assert.ok(broadcasts.some((d) => d._id === broadcast._id), "the null/absent-broadcast row matches");
});

test("notifications (PG): $in over the recipient email aliases keeps equality meaning", async () => {
  const aliasA = emailFor("alias-a");
  const aliasB = emailFor("alias-b");
  await notificationRepository.create({ title: "A", message: "M", audienceEmail: aliasA });
  await notificationRepository.create({ title: "B", message: "M", audienceEmail: aliasB });
  await notificationRepository.create({ title: "C", message: "M", audienceEmail: emailFor("alias-c") });

  const rows = await notificationRepository.findMany({
    filter: { audienceEmail: { $in: [aliasA, aliasB] } },
  });
  assert.deepStrictEqual(rows.map((d) => d.title).sort(), ["A", "B"]);
});

test("notifications (PG): an empty $in matches nothing, as Mongo does", async () => {
  await notificationRepository.create({ title: "present", message: "M", audienceEmail: emailFor("empty-in") });
  const rows = await notificationRepository.findMany({ filter: { audienceId: { $in: [] } } });
  assert.strictEqual(rows.length, 0);
});

// ─── Sorting and pagination ────────────────────────────────────────────────
test("notifications (PG): listing sorts newest-first and paginates", async () => {
  const role = "page-" + unique();
  for (let i = 0; i < 5; i += 1) {
    const doc = await notificationRepository.create({ title: `P${i}`, message: "M", audienceRole: role });
    // Space the rows out so createdAt ordering is unambiguous; P4 is the newest.
    await pgQuery("UPDATE notifications SET created_at = now() - make_interval(secs => $2) WHERE id = $1", [doc._id, (4 - i) * 10]);
  }

  const all = await notificationRepository.findMany({ filter: { audienceRole: role }, sort: { createdAt: -1 } });
  assert.strictEqual(all.length, 5);
  assert.deepStrictEqual(all.map((d) => d.title), ["P4", "P3", "P2", "P1", "P0"]);

  const page1 = await notificationRepository.findMany({
    filter: { audienceRole: role }, sort: { createdAt: -1 }, limit: 2,
  });
  const page2 = await notificationRepository.findMany({
    filter: { audienceRole: role }, sort: { createdAt: -1 }, limit: 2, offset: 2,
  });
  assert.deepStrictEqual(page1.map((d) => d.title), ["P4", "P3"]);
  assert.deepStrictEqual(page2.map((d) => d.title), ["P2", "P1"]);
});

test("notifications (PG): the staff { date: -1, createdAt: -1 } sort is preserved", async () => {
  const role = "date-sort-" + unique();
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-06-01T00:00:00Z");

  await notificationRepository.create({ title: "old", message: "M", audienceRole: role, date: older });
  await notificationRepository.create({ title: "new", message: "M", audienceRole: role, date: newer });

  const rows = await notificationRepository.findMany({
    filter: { audienceRole: role }, sort: { date: -1, createdAt: -1 },
  });
  assert.deepStrictEqual(rows.map((d) => d.title), ["new", "old"]);
});

test("notifications (PG): pagination over the unread subset is stable", async () => {
  const email = emailFor("page-unread");
  for (let i = 0; i < 6; i += 1) {
    await notificationRepository.create({ title: `U${i}`, message: "M", audienceEmail: email });
  }
  // Read the even ones.
  for (const title of ["U0", "U2", "U4"]) {
    const row = (await notificationRepository.findMany({ filter: { audienceEmail: email, title } }))[0];
    await notificationRepository.findByIdAndUpdate(row._id, { read: true, readAt: new Date() });
  }

  const unread = await notificationRepository.findMany({
    filter: { audienceEmail: email, read: false }, sort: { createdAt: -1 },
  });
  assert.strictEqual(unread.length, 3);
  assert.strictEqual(await notificationRepository.countDocuments({ audienceEmail: email, read: false }), 3);

  const firstUnreadPage = await notificationRepository.findMany({
    filter: { audienceEmail: email, read: false }, sort: { createdAt: -1 }, limit: 2,
  });
  assert.strictEqual(firstUnreadPage.length, 2);
  assert.ok(firstUnreadPage.every((d) => d.read === false));
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("notifications (PG): a PG operation never touches the Mongoose model", async () => {
  const originals = {
    create: Notification.create,
    find: Notification.find,
    findById: Notification.findById,
    findByIdAndUpdate: Notification.findByIdAndUpdate,
    updateMany: Notification.updateMany,
    countDocuments: Notification.countDocuments,
  };
  const touched = [];
  const record = (name) => async () => {
    touched.push(name);
    throw new Error(`Mongo ${name} must not be called on the PG path`);
  };
  Notification.create = record("create");
  Notification.find = record("find");
  Notification.findById = record("findById");
  Notification.findByIdAndUpdate = record("findByIdAndUpdate");
  Notification.updateMany = record("updateMany");
  Notification.countDocuments = record("countDocuments");

  try {
    const doc = await notificationPersistenceService.create(notificationPayload({ audienceEmail: emailFor("nodual") }));
    await notificationPersistenceService.findById(doc._id);
    await notificationPersistenceService.findMany({ filter: { audienceId: doc.audienceId } });
    await notificationPersistenceService.countDocuments({ read: false, id: doc._id });
    await notificationPersistenceService.findByIdAndUpdate(doc._id, { read: true, readAt: new Date() });
    await notificationPersistenceService.updateMany({ id: doc._id }, { viewed: true, viewedAt: new Date() });
    assert.deepStrictEqual(touched, [], "no Mongoose method was invoked");
  } finally {
    Notification.create = originals.create;
    Notification.find = originals.find;
    Notification.findById = originals.findById;
    Notification.findByIdAndUpdate = originals.findByIdAndUpdate;
    Notification.updateMany = originals.updateMany;
    Notification.countDocuments = originals.countDocuments;
  }
});

// ─── Mongo fallback ────────────────────────────────────────────────────────
test("notifications (Mongo fallback): a disconnected datasource routes the same operations to Mongoose", async () => {
  const originals = {
    create: Notification.create,
    find: Notification.find,
    findById: Notification.findById,
    findByIdAndUpdate: Notification.findByIdAndUpdate,
    updateMany: Notification.updateMany,
    countDocuments: Notification.countDocuments,
  };
  const calls = [];
  const stub = (name, value) => async (...args) => {
    calls.push(name);
    return value;
  };
  Notification.create = stub("create", { _id: "mongo-1", title: "T" });
  Notification.find = () => ({ sort: () => [] });
  Notification.findById = stub("findById", { _id: "mongo-1" });
  Notification.findByIdAndUpdate = stub("findByIdAndUpdate", { _id: "mongo-1", read: true });
  Notification.updateMany = stub("updateMany", { modifiedCount: 1 });
  Notification.countDocuments = stub("countDocuments", 7);

  const wasConnected = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(await notificationPersistenceService.usePostgres(), false);

    await notificationPersistenceService.create({ title: "T", message: "M" });
    await notificationPersistenceService.findById("mongo-1");
    await notificationPersistenceService.findMany({ filter: { read: false } });
    assert.strictEqual(await notificationPersistenceService.countDocuments({ read: false }), 7);
    await notificationPersistenceService.findByIdAndUpdate("mongo-1", { read: true });
    await notificationPersistenceService.updateMany({ read: false }, { read: true });

    assert.ok(calls.includes("create"), "create used Mongoose");
    assert.ok(calls.includes("findById"), "findById used Mongoose");
    assert.ok(calls.includes("findByIdAndUpdate"), "findByIdAndUpdate used Mongoose");
    assert.ok(calls.includes("updateMany"), "updateMany used Mongoose");
    assert.ok(calls.includes("countDocuments"), "countDocuments used Mongoose");
  } finally {
    dbConfig.isDbConnected = wasConnected;
    Object.assign(Notification, originals);
  }
});

test("notifications (fallback): PostgreSQL unavailable keeps the Mongoose path even when the seam is connected", async () => {
  // The seam says connected, but the PostgreSQL configuration points nowhere, so
  // the service must decline the PG path rather than fail the request.
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await notificationPersistenceService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = savedUrl;
    await closePostgres();
  }
});

test("notifications (fallback): the repository itself honours the disconnected seam", async () => {
  const wasConnected = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  const originalFindById = Notification.findById;
  let used = false;
  Notification.findById = async () => {
    used = true;
    return { _id: "fallback" };
  };
  try {
    const doc = await notificationRepository.findById("fallback");
    assert.strictEqual(used, true, "the repository delegated to Mongoose");
    assert.strictEqual(doc._id, "fallback");
  } finally {
    dbConfig.isDbConnected = wasConnected;
    Notification.findById = originalFindById;
  }
});

// ─── Validation parity ─────────────────────────────────────────────────────
test("notifications: validation rejects the same payloads Mongo rejects", () => {
  assert.throws(() => notificationPersistenceService.validate({ message: "M" }), /title is required/);
  assert.throws(() => notificationPersistenceService.validate({ title: "T" }), /message is required/);
  assert.throws(() => notificationPersistenceService.validate({ title: " ", message: "M" }), /title is required/);
  assert.throws(
    () => notificationPersistenceService.validate({ title: "T", message: "M", readAt: "not-a-date" }),
    /Invalid readAt/
  );
  // A valid payload must not throw.
  assert.doesNotThrow(() => notificationPersistenceService.validate({ title: "T", message: "M" }));
});
