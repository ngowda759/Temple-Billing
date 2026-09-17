// Phase 2X PostgreSQL tests for the Event repository and persistence service.
//
// The Event domain is migrated additively: PostgreSQL is an additional
// persistence path selected at operation time, MongoDB stays the source of
// truth and the fallback. These tests exercise the real PostgreSQL path (the
// datasource seam is pinned "connected" and DATABASE_URL points at the test
// database, so every operation below reaches the real eventRepository and the
// real events table). They verify:
//   - the complete Mongo → PostgreSQL field mapping (every persisted field),
//   - nullability and the schema's own defaults,
//   - the 4-value status enum and the automatic Completed transition,
//   - date semantics: absolute instants, same-day/multi-day, month and year
//     boundaries, UTC-midnight vs local-midnight writes,
//   - filtering, sorting, pagination and the two overview $group $sum
//     aggregates,
//   - the Mongo-style $inc aggregate bumps the booking/donation flows issue,
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
const Event = require("../src/models/Event");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");

let originalIsDbConnected;
let eventRepository;
let eventPersistenceService;

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
  await pgQuery("DROP TABLE IF EXISTS events CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '025_create_events.sql'");
  runMigrate();
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;
  eventRepository = require("../src/repositories/eventRepository");
  eventPersistenceService = require("../src/services/eventPersistenceService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// A fixed future date so the status/default assertions are deterministic.
const FUTURE = "2099-05-20T00:00:00.000Z";

const eventPayload = (overrides = {}) => ({
  title: "Brahmotsavam",
  date: new Date(FUTURE),
  endDate: new Date("2099-05-22T00:00:00.000Z"),
  location: "Main Mandapam",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("events: the service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(eventPersistenceService.isConnected(), true);
  assert.strictEqual(await eventPersistenceService.usePostgres(), true);
});

test("events: the service falls back to Mongoose when the datasource seam is disconnected", async () => {
  const original = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(eventPersistenceService.isConnected(), false);
    assert.strictEqual(await eventPersistenceService.usePostgres(), false);
  } finally {
    dbConfig.isDbConnected = original;
  }
});

test("events: PostgreSQL unavailable keeps the Mongoose path even when the seam is connected", async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await eventPersistenceService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = savedUrl;
    await closePostgres();
  }
});

// ─── Full field mapping ────────────────────────────────────────────────────
test("events (PG): every persisted Mongo field round-trips through the repository", async () => {
  const payload = eventPayload({
    title: "  Diwali Festival  ",
    date: new Date("2099-11-01T00:00:00.000Z"),
    endDate: new Date("2099-11-03T00:00:00.000Z"),
    location: "  East Gate  ",
    description: "  Ten days of celebration  ",
    image: "  https://example.com/banner.png  ",
    slots: 250,
    registrations: 42,
    collection: 12345.5,
    status: "Active",
  });

  const created = await eventPersistenceService.create(payload);

  // Required text paths are trimmed exactly as `trim: true` does in Mongo.
  assert.strictEqual(created.title, "Diwali Festival");
  assert.strictEqual(created.location, "East Gate");
  assert.strictEqual(created.description, "Ten days of celebration");
  assert.strictEqual(created.image, "https://example.com/banner.png");
  assert.strictEqual(created.date.toISOString(), "2099-11-01T00:00:00.000Z");
  assert.strictEqual(created.endDate.toISOString(), "2099-11-03T00:00:00.000Z");
  // Counters come back as JS Numbers, not NUMERIC strings.
  assert.strictEqual(created.slots, 250);
  assert.strictEqual(created.registrations, 42);
  assert.strictEqual(created.collection, 12345.5);
  assert.strictEqual(created.status, "Active");
  // The Mongoose shape carries both _id and createdAt/updatedAt.
  assert.ok(created._id);
  assert.ok(created.createdAt);
  assert.ok(created.updatedAt);

  // And the row itself holds the exact mapped values.
  const rows = await pgQuery("SELECT * FROM events WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, "Diwali Festival");
  assert.strictEqual(rows[0].location, "East Gate");
  assert.strictEqual(rows[0].end_date.toISOString(), "2099-11-03T00:00:00.000Z");
  assert.strictEqual(Number(rows[0].slots), 250);
  assert.strictEqual(Number(rows[0].registrations), 42);
  assert.strictEqual(Number(rows[0].collection), 12345.5);
  assert.strictEqual(rows[0].status, "Active");
});

test("events (PG): the schema defaults are applied on insert (slots/registrations/collection/status/endDate)", async () => {
  const created = await eventPersistenceService.create({
    title: "Minimal",
    date: new Date(FUTURE),
    location: "Hall",
  });

  assert.strictEqual(created.slots, 0);
  assert.strictEqual(created.registrations, 0);
  assert.strictEqual(created.collection, 0);
  assert.strictEqual(created.status, "Upcoming");
  // endDate is optional in the schema, so an absent value stays unset.
  assert.strictEqual(created.endDate, undefined);
  assert.strictEqual(created.description, undefined);
  assert.strictEqual(created.image, undefined);
});

test("events (PG): an explicit empty description/image is preserved, an absent one is not invented", async () => {
  const created = await eventPersistenceService.create({
    title: "Empties",
    date: new Date(FUTURE),
    location: "Hall",
    description: "",
    image: "",
  });

  // Mongoose `trim: true` keeps '' — it does not turn it into an unset field.
  assert.strictEqual(created.description, "");
  assert.strictEqual(created.image, "");

  const rows = await pgQuery("SELECT description, image FROM events WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].description, "");
  assert.strictEqual(rows[0].image, "");
});

test("events (PG): unknown body keys are discarded exactly as Mongoose strict mode does", async () => {
  // eventController.createEvent spreads req.body into Event.create, so stray
  // keys such as imageUrl must never reach the table.
  const created = await eventPersistenceService.create({
    title: "Strict",
    date: new Date(FUTURE),
    location: "Hall",
    imageUrl: "https://example.com/should-be-ignored.png",
    featured: true,
    category: "Festival",
    organizer: "Someone",
  });

  assert.strictEqual(created.image, undefined);
  const cols = await pgQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'events' ORDER BY column_name"
  );
  const names = cols.map((c) => c.column_name);
  assert.ok(!names.includes("image_url"));
  assert.ok(!names.includes("featured"));
  assert.ok(!names.includes("category"));
  assert.ok(!names.includes("organizer"));
});

// ─── CRUD ──────────────────────────────────────────────────────────────────
test("events (PG): findById returns the row and null for a missing id", async () => {
  const created = await eventPersistenceService.create(eventPayload());
  const found = await eventPersistenceService.findById(created._id);
  assert.strictEqual(found._id, created._id);
  assert.strictEqual(found.title, "Brahmotsavam");

  assert.strictEqual(await eventPersistenceService.findById(unique()), null);
  assert.strictEqual(await eventPersistenceService.findById(undefined), null);
});

test("events (PG): findMany sorts ascending by date exactly as the controllers require", async () => {
  await pgQuery("DELETE FROM events");
  const make = (title, iso) => eventPayload({ title, date: new Date(iso), endDate: new Date(iso) });
  await eventPersistenceService.create(make("third", "2099-03-01T00:00:00.000Z"));
  await eventPersistenceService.create(make("first", "2099-01-01T00:00:00.000Z"));
  await eventPersistenceService.create(make("second", "2099-02-01T00:00:00.000Z"));

  const events = await eventPersistenceService.findMany({ sort: { date: 1 } });
  assert.deepStrictEqual(events.map((e) => e.title), ["first", "second", "third"]);
});

test("events (PG): findMany supports pagination without leaking ordering", async () => {
  await pgQuery("DELETE FROM events");
  for (const day of ["01", "02", "03", "04", "05"]) {
    await eventPersistenceService.create(
      eventPayload({ title: `day-${day}`, date: new Date(`2099-07-${day}T00:00:00.000Z`), endDate: new Date(`2099-07-${day}T00:00:00.000Z`) })
    );
  }

  const page = await eventPersistenceService.findMany({ sort: { date: 1 }, limit: 2, offset: 1 });
  assert.deepStrictEqual(page.map((e) => e.title), ["day-02", "day-03"]);
});

test("events (PG): updateById applies only the supplied fields and returns the updated document", async () => {
  const created = await eventPersistenceService.create(
    eventPayload({ description: "before", slots: 10, registrations: 1, collection: 5 })
  );

  const updated = await eventPersistenceService.updateById(created._id, {
    title: "  Renamed  ",
    slots: 99,
    status: "Completed",
  });

  assert.strictEqual(updated.title, "Renamed");
  assert.strictEqual(updated.slots, 99);
  assert.strictEqual(updated.status, "Completed");
  // Untouched fields survive.
  assert.strictEqual(updated.description, "before");
  assert.strictEqual(updated.registrations, 1);
  assert.strictEqual(updated.collection, 5);
  assert.strictEqual(updated.location, "Main Mandapam");
});

test("events (PG): updateById maps a blank image to an unset field (the controllers' `imageUrl || undefined`)", async () => {
  const created = await eventPersistenceService.create(
    eventPayload({ image: "https://example.com/old.png" })
  );

  const updated = await eventPersistenceService.updateById(created._id, { image: null });
  assert.strictEqual(updated.image, undefined);

  const rows = await pgQuery("SELECT image FROM events WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].image, null);
});

test("events (PG): updateById returns null for a missing id and skips an empty update", async () => {
  assert.strictEqual(await eventPersistenceService.updateById(unique(), { title: "x" }), null);

  const created = await eventPersistenceService.create(eventPayload());
  const unchanged = await eventPersistenceService.updateById(created._id, {});
  assert.strictEqual(unchanged._id, created._id);
  assert.strictEqual(unchanged.title, "Brahmotsavam");
});

test("events (PG): findByIdAndDelete removes the row and returns the deleted document", async () => {
  const created = await eventPersistenceService.create(eventPayload({ title: "ToDelete" }));

  const deleted = await eventPersistenceService.findByIdAndDelete(created._id);
  assert.strictEqual(deleted._id, created._id);
  assert.strictEqual(deleted.title, "ToDelete");

  assert.strictEqual(await eventPersistenceService.findById(created._id), null);
  assert.strictEqual(await eventPersistenceService.findByIdAndDelete(created._id), null);
});

// ─── Status / auto-complete ────────────────────────────────────────────────
test("events (PG): the four-value status enum round-trips and an invalid status is rejected", async () => {
  for (const status of ["Upcoming", "Active", "Completed", "Cancelled"]) {
    const created = await eventPersistenceService.create(eventPayload({ status }));
    assert.strictEqual(created.status, status);
  }

  await assert.rejects(
    () => eventPersistenceService.create(eventPayload({ status: "Published" })),
    /Invalid status/
  );
});

test("events (PG): the auto-complete updateMany marks only past Upcoming/Active events Completed", async () => {
  await pgQuery("DELETE FROM events");
  const insert = (title, iso, status) =>
    eventPersistenceService.create(
      eventPayload({ title, date: new Date(iso), endDate: new Date(iso), status })
    );

  await insert("past-upcoming", "2020-01-05T00:00:00.000Z", "Upcoming");
  await insert("past-active", "2020-02-05T00:00:00.000Z", "Active");
  await insert("past-completed", "2020-03-05T00:00:00.000Z", "Completed");
  await insert("past-cancelled", "2020-04-05T00:00:00.000Z", "Cancelled");
  await insert("future", "2099-01-05T00:00:00.000Z", "Upcoming");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const result = await eventPersistenceService.updateMany(
    { date: { $lt: todayStart }, status: { $in: ["Upcoming", "Active"] } },
    { $set: { status: "Completed" } }
  );
  assert.strictEqual(result.modifiedCount, 2);

  const byTitle = Object.fromEntries(
    (await eventPersistenceService.findMany({ sort: { date: 1 } })).map((e) => [e.title, e.status])
  );
  assert.strictEqual(byTitle["past-upcoming"], "Completed");
  assert.strictEqual(byTitle["past-active"], "Completed");
  // Untouched: the statuses the filter deliberately excludes.
  assert.strictEqual(byTitle["past-completed"], "Completed");
  assert.strictEqual(byTitle["past-cancelled"], "Cancelled");
  assert.strictEqual(byTitle["future"], "Upcoming");
});

// ─── Overview counts and aggregates ────────────────────────────────────────
test("events (PG): countDocuments reproduces the three overview counts", async () => {
  await pgQuery("DELETE FROM events");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const nextMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 1);

  // One event today, one tomorrow and one long past. The month count is derived
  // from the same boundaries so the assertion holds on any calendar day (e.g.
  // when "tomorrow" falls into next month or next year).
  const make = (title, day, status) =>
    eventPersistenceService.create(
      eventPayload({ title, date: new Date(day), endDate: new Date(day), status })
    );

  await make("today", todayStart, "Upcoming");
  await make("tomorrow", tomorrowStart, "Upcoming");
  await make("past", new Date("2020-01-05T00:00:00.000Z"), "Completed");

  const upcoming = await eventPersistenceService.countDocuments({
    date: { $gte: todayStart },
    status: { $nin: ["Completed", "Cancelled"] },
  });
  assert.strictEqual(upcoming, 2);

  const todays = await eventPersistenceService.countDocuments({ date: { $gte: todayStart, $lt: tomorrowStart } });
  assert.strictEqual(todays, 1);

  const expectedMonth = [todayStart, tomorrowStart]
    .filter((day) => day >= monthStart && day < nextMonthStart).length;
  const month = await eventPersistenceService.countDocuments({ date: { $gte: monthStart, $lt: nextMonthStart } });
  assert.strictEqual(month, expectedMonth);
});

test("events (PG): sumTotals reproduces the two $group $sum aggregates", async () => {
  await pgQuery("DELETE FROM events");
  await eventPersistenceService.create(
    eventPayload({ title: "a", registrations: 3, collection: 100.25, date: new Date("2099-01-01T00:00:00.000Z") })
  );
  await eventPersistenceService.create(
    eventPayload({ title: "b", registrations: 4, collection: 50.5, date: new Date("2099-02-01T00:00:00.000Z") })
  );

  const all = await eventPersistenceService.sumTotals({});
  assert.strictEqual(all.registrations, 7);
  assert.strictEqual(all.collection, 150.75);

  const january = await eventPersistenceService.sumTotals({
    date: { $gte: new Date("2099-01-01T00:00:00.000Z"), $lt: new Date("2099-02-01T00:00:00.000Z") },
  });
  assert.strictEqual(january.registrations, 3);
  assert.strictEqual(january.collection, 100.25);

  // Mongo's $sum over an empty match yields no group row, which the controller
  // reads as 0 — so an empty table must report 0, not null/NaN.
  await pgQuery("DELETE FROM events");
  const empty = await eventPersistenceService.sumTotals({});
  assert.strictEqual(empty.registrations, 0);
  assert.strictEqual(empty.collection, 0);
});

// ─── $inc aggregate bumps ──────────────────────────────────────────────────
test("events (PG): incrementById reproduces Mongo's $inc on registrations and collection", async () => {
  const created = await eventPersistenceService.create(
    eventPayload({ registrations: 0, collection: 0 })
  );

  const first = await eventPersistenceService.incrementById(created._id, {
    registrations: 1,
    collection: 500,
  });
  assert.strictEqual(first.registrations, 1);
  assert.strictEqual(first.collection, 500);

  // A second link adds to the stored value rather than replacing it.
  const second = await eventPersistenceService.incrementById(created._id, {
    registrations: 1,
    collection: 250.75,
  });
  assert.strictEqual(second.registrations, 2);
  assert.strictEqual(second.collection, 750.75);

  // The collection-only bump the donation paths issue.
  const third = await eventPersistenceService.incrementById(created._id, { collection: 9.25 });
  assert.strictEqual(third.registrations, 2);
  assert.strictEqual(third.collection, 760);
});

test("events (PG): incrementById is a no-op for a missing event, as Mongo $inc is", async () => {
  const result = await eventPersistenceService.incrementById(unique(), { registrations: 1, collection: 10 });
  assert.strictEqual(result, null);
});

// ─── Date / time semantics ─────────────────────────────────────────────────
test("events (PG): a same-day event keeps date === endDate as an instant", async () => {
  const day = new Date("2099-08-15T00:00:00.000Z");
  const created = await eventPersistenceService.create(
    eventPayload({ date: day, endDate: day })
  );

  assert.strictEqual(created.date.toISOString(), "2099-08-15T00:00:00.000Z");
  assert.strictEqual(created.endDate.toISOString(), "2099-08-15T00:00:00.000Z");
});

test("events (PG): a multi-day event preserves both boundary instants across a month and a year", async () => {
  const created = await eventPersistenceService.create(
    eventPayload({
      date: new Date("2099-12-30T00:00:00.000Z"),
      endDate: new Date("2100-01-02T00:00:00.000Z"),
    })
  );

  assert.strictEqual(created.date.toISOString(), "2099-12-30T00:00:00.000Z");
  assert.strictEqual(created.endDate.toISOString(), "2100-01-02T00:00:00.000Z");

  const reread = await eventPersistenceService.findById(created._id);
  assert.strictEqual(reread.date.toISOString(), "2099-12-30T00:00:00.000Z");
  assert.strictEqual(reread.endDate.toISOString(), "2100-01-02T00:00:00.000Z");
});

test("events (PG): both write-path instants round-trip unchanged (UTC midnight and local midnight)", async () => {
  // The create paths hand Mongoose the raw request string → UTC midnight.
  const utc = await eventPersistenceService.create(
    eventPayload({ date: "2099-05-20", endDate: "2099-05-21" })
  );
  assert.strictEqual(utc.date.toISOString(), "2099-05-20T00:00:00.000Z");

  // devoteeController.updateEvent builds endDate with setHours(0,0,0,0) →
  // local midnight. The stored instant is preserved exactly, whatever the
  // server offset is.
  const localMidnight = new Date("2099-06-15T00:00:00");
  const updated = await eventPersistenceService.updateById(utc._id, { endDate: localMidnight });
  assert.strictEqual(updated.endDate.getTime(), localMidnight.getTime());
});

test("events (PG): a date range query respects month and year boundaries", async () => {
  await pgQuery("DELETE FROM events");
  const insert = (title, iso) =>
    eventPersistenceService.create(eventPayload({ title, date: new Date(iso), endDate: new Date(iso) }));

  await insert("dec-2099", "2099-12-31T23:59:59.000Z");
  await insert("jan-2100", "2100-01-01T00:00:00.000Z");

  const dec = await eventPersistenceService.findMany({
    filter: {
      date: { $gte: new Date("2099-12-01T00:00:00.000Z"), $lt: new Date("2100-01-01T00:00:00.000Z") },
    },
    sort: { date: 1 },
  });
  assert.deepStrictEqual(dec.map((e) => e.title), ["dec-2099"]);

  const jan = await eventPersistenceService.findMany({
    filter: {
      date: { $gte: new Date("2100-01-01T00:00:00.000Z"), $lt: new Date("2100-02-01T00:00:00.000Z") },
    },
    sort: { date: 1 },
  });
  assert.deepStrictEqual(jan.map((e) => e.title), ["jan-2100"]);
});

// ─── Sorting / filtering ───────────────────────────────────────────────────
test("events (PG): whitelisted sorting works and unknown sort keys fall back to date ASC", async () => {
  await pgQuery("DELETE FROM events");
  await eventPersistenceService.create(eventPayload({ title: "bb", date: new Date("2099-01-01T00:00:00.000Z") }));
  await eventPersistenceService.create(eventPayload({ title: "aa", date: new Date("2099-02-01T00:00:00.000Z") }));

  const byTitle = await eventPersistenceService.findMany({ sort: { title: 1 } });
  assert.deepStrictEqual(byTitle.map((e) => e.title), ["aa", "bb"]);

  // An unknown key must not be interpolated — it falls back to the default.
  const fallback = await eventPersistenceService.findMany({ sort: { "; DROP TABLE events": -1 } });
  assert.strictEqual(fallback.length, 2);
  const stillThere = await pgQuery("SELECT to_regclass('public.events') AS t");
  assert.match(stillThere[0].t, /events/);
});

test("events (PG): filtering by status and date reproduces the Mongo predicates", async () => {
  await pgQuery("DELETE FROM events");
  await eventPersistenceService.create(eventPayload({ title: "u", date: new Date("2099-01-01T00:00:00.000Z"), status: "Upcoming" }));
  await eventPersistenceService.create(eventPayload({ title: "c", date: new Date("2099-01-02T00:00:00.000Z"), status: "Completed" }));

  const upcoming = await eventPersistenceService.findMany({ filter: { status: "Upcoming" }, sort: { date: 1 } });
  assert.deepStrictEqual(upcoming.map((e) => e.title), ["u"]);

  const notCompleted = await eventPersistenceService.findMany({
    filter: { status: { $nin: ["Completed", "Cancelled"] } },
    sort: { date: 1 },
  });
  assert.deepStrictEqual(notCompleted.map((e) => e.title), ["u"]);

  const inList = await eventPersistenceService.findMany({
    filter: { status: { $in: ["Completed", "Cancelled"] } },
    sort: { date: 1 },
  });
  assert.deepStrictEqual(inList.map((e) => e.title), ["c"]);
});

// ─── Validation parity ─────────────────────────────────────────────────────
test("events: validation rejects the same payloads Mongo rejects", () => {
  assert.throws(() => eventPersistenceService.validate({ date: new Date(), location: "L" }), /title is required/);
  assert.throws(() => eventPersistenceService.validate({ title: "T", location: "L" }), /date is required/);
  assert.throws(() => eventPersistenceService.validate({ title: "T", date: new Date() }), /location is required/);
  assert.throws(() => eventPersistenceService.validate({ title: " ", date: new Date(), location: "L" }), /title is required/);
  assert.throws(
    () => eventPersistenceService.validate({ title: "T", date: "not-a-date", location: "L" }),
    /Invalid date/
  );
  assert.throws(
    () => eventPersistenceService.validate({ title: "T", date: new Date(), location: "L", slots: "abc" }),
    /Invalid slots/
  );
  assert.throws(
    () => eventPersistenceService.validate({ title: "T", date: new Date(), location: "L", status: "Nope" }),
    /Invalid status/
  );
  // A valid payload must not throw.
  assert.doesNotThrow(() => eventPersistenceService.validate({ title: "T", date: new Date(), location: "L" }));
});