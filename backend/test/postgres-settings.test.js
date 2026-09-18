// Phase 2AA PostgreSQL-path tests for the AttendanceSetting and PriestSetting
// repositories and services.
//
// These tests run with the datasource seam connected so the repositories and
// services must select the PostgreSQL path. They verify that:
//   - attendanceSettingRepository / priestSettingRepository persist to and read
//     from the real attendance_settings / priest_settings tables (no mocks),
//   - every persisted Mongo schema field round-trips losslessly (the five
//     AttendanceSetting numerics and the four PriestSetting toggles),
//   - the schema defaults (0/0/100/15/30 and true/true/true/false) are applied
//     identically on both datasources,
//   - the lazy singleton / per-priest materialisation both controllers rely on
//     still happens on first read,
//   - the partial-update semantics the controllers depend on are preserved: an
//     omitted or null field keeps its stored value, and a supplied `false` is
//     honoured rather than treated as "absent",
//   - priest_settings reproduces Mongo's unique index on priestId and a
//     duplicate raises the 11000-shaped error, while attendance_settings
//     deliberately allows more than one row (the Mongo schema declares no
//     unique index there),
//   - the service never writes to MongoDB while PostgreSQL is selected (no dual
//     writes) and can switch datasources in-process,
//   - the controllers still emit the exact same response shapes and status
//     codes as before this phase.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const AttendanceSetting = require("../src/models/AttendanceSetting");
const PriestSetting = require("../src/models/PriestSetting");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");
const priestIdFor = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let attendanceSettingRepository;
let attendanceSettingService;
let priestSettingRepository;
let priestSettingService;

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

// Best-effort MongoDB connection so the cross-datasource "no dual write"
// assertions are real queries rather than skips. When MongoDB is unreachable the
// assertions degrade to a skip while the Mongoose-spy tests still prove the
// PostgreSQL path never invokes the model.
const tryConnectMongo = async () => {
  try {
    const mongoose = require("mongoose");
    await mongoose.connect(
      process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/temple_billing_test",
      { serverSelectionTimeoutMS: 3000 }
    );
  } catch {
    /* leave the connection down; the cross-datasource tests skip */
  }
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  // Start from a clean slate for both tables (this phase owns them).
  await pgQuery("DROP TABLE IF EXISTS priest_settings CASCADE");
  await pgQuery("DROP TABLE IF EXISTS attendance_settings CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '028_create_settings.sql'");
  runMigrate();
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  await tryConnectMongo();
  dbConfig.isDbConnected = () => true;
  attendanceSettingRepository = require("../src/repositories/attendanceSettingRepository");
  attendanceSettingService = require("../src/services/attendanceSettingService");
  priestSettingRepository = require("../src/repositories/priestSettingRepository");
  priestSettingService = require("../src/services/priestSettingService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  } catch {
    /* nothing to disconnect */
  }
  await closePostgres();
});

// Every test that asserts on the singleton starts from an empty table so the
// "created with defaults" behaviour is deterministic.
const clearAttendanceSettings = () => pgQuery("DELETE FROM attendance_settings");

// ─── Datasource selection ─────────────────────────────────────────────────
test("settings: the services select PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(attendanceSettingService.isConnected(), true);
  assert.strictEqual(await attendanceSettingService.usePostgres(), true);
  assert.strictEqual(priestSettingService.isConnected(), true);
  assert.strictEqual(await priestSettingService.usePostgres(), true);
});

test("settings: PostgreSQL unavailable keeps the Mongoose path even when the seam is connected", async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await attendanceSettingService.usePostgres(), false);
    assert.strictEqual(await priestSettingService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = savedUrl;
    await closePostgres();
  }
});

// ─── AttendanceSetting: full field mapping ─────────────────────────────────
test("attendance settings (PG): every persisted Mongo field round-trips through the repository", async () => {
  await clearAttendanceSettings();

  const created = await attendanceSettingService.create({
    templeLatitude: 17.385044,
    templeLongitude: 78.486671,
    allowedRadius: 250,
    lateThreshold: 20,
    earlyCheckInWindow: 45,
  });

  // The document is Mongoose-shaped so the controllers and the settings page
  // need no changes.
  assert.ok(created._id, "a 24-hex id is returned");
  assert.strictEqual(created._id, created.id);
  assert.match(String(created._id), /^[0-9a-f]{24}$/);

  assert.strictEqual(created.templeLatitude, 17.385044);
  assert.strictEqual(created.templeLongitude, 78.486671);
  assert.strictEqual(created.allowedRadius, 250);
  assert.strictEqual(created.lateThreshold, 20);
  assert.strictEqual(created.earlyCheckInWindow, 45);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  // ...and the same values are what actually landed in PostgreSQL.
  const rows = await pgQuery(
    `SELECT temple_latitude, temple_longitude, allowed_radius, late_threshold, early_check_in_window
     FROM attendance_settings WHERE id = $1`,
    [created._id]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(String(rows[0].temple_latitude), "17.385044");
  assert.strictEqual(String(rows[0].temple_longitude), "78.486671");
  assert.strictEqual(String(rows[0].allowed_radius), "250");
  assert.strictEqual(String(rows[0].late_threshold), "20");
  assert.strictEqual(String(rows[0].early_check_in_window), "45");

  // The read path returns the identical shape.
  const reread = await attendanceSettingRepository.findById(created._id);
  assert.strictEqual(reread.templeLatitude, 17.385044);
  assert.strictEqual(reread.allowedRadius, 250);
});

test("attendance settings (PG): defaults mirror the Mongo schema exactly", async () => {
  await clearAttendanceSettings();

  // mongoose: { templeLatitude: 0, templeLongitude: 0, allowedRadius: 100,
  //             lateThreshold: 15, earlyCheckInWindow: 30 }
  const created = await attendanceSettingService.create({});
  assert.strictEqual(created.templeLatitude, 0);
  assert.strictEqual(created.templeLongitude, 0);
  assert.strictEqual(created.allowedRadius, 100);
  assert.strictEqual(created.lateThreshold, 15);
  assert.strictEqual(created.earlyCheckInWindow, 30);
});

test("attendance settings (PG): getOrCreate lazily materialises the singleton with defaults", async () => {
  await clearAttendanceSettings();
  assert.strictEqual((await pgQuery("SELECT count(*)::int AS c FROM attendance_settings"))[0].c, 0);

  const settings = await attendanceSettingService.getOrCreate();
  assert.strictEqual(settings.templeLatitude, 0);
  assert.strictEqual(settings.allowedRadius, 100);
  assert.strictEqual(settings.lateThreshold, 15);
  assert.strictEqual(settings.earlyCheckInWindow, 30);

  // Exactly one row was created, and a second call returns the same document
  // rather than creating a second one.
  assert.strictEqual((await pgQuery("SELECT count(*)::int AS c FROM attendance_settings"))[0].c, 1);
  const again = await attendanceSettingService.getOrCreate();
  assert.strictEqual(again._id, settings._id);
  assert.strictEqual((await pgQuery("SELECT count(*)::int AS c FROM attendance_settings"))[0].c, 1);
});

test("attendance settings (PG): findOne resolves to the oldest row, like Mongo's natural findOne", async () => {
  await clearAttendanceSettings();

  // Two rows are physically possible (the Mongo schema declares no unique
  // index), so findOne must deterministically resolve to the first inserted.
  const first = await attendanceSettingService.create({ lateThreshold: 11 });
  const second = await attendanceSettingService.create({ lateThreshold: 99 });
  assert.notStrictEqual(first._id, second._id);

  const found = await attendanceSettingService.findOne();
  assert.strictEqual(found._id, first._id);
  assert.strictEqual(found.lateThreshold, 11);
});

// ─── AttendanceSetting: update semantics ───────────────────────────────────
test("attendance settings (PG): updateSettings patches only the supplied fields", async () => {
  await clearAttendanceSettings();

  const created = await attendanceSettingService.create({
    templeLatitude: 1,
    templeLongitude: 2,
    allowedRadius: 3,
    lateThreshold: 4,
    earlyCheckInWindow: 5,
  });

  // Only lateThreshold is supplied; everything else must keep its stored value
  // (`body.x ?? settings.x` semantics).
  const updated = await attendanceSettingService.updateSettings({ lateThreshold: 30 });
  assert.strictEqual(updated.templeLatitude, 1);
  assert.strictEqual(updated.templeLongitude, 2);
  assert.strictEqual(updated.allowedRadius, 3);
  assert.strictEqual(updated.lateThreshold, 30);
  assert.strictEqual(updated.earlyCheckInWindow, 5);

  // A null is treated the same as "absent" by the `??` guards, so it must not
  // reset the field to the schema default.
  const afterNull = await attendanceSettingService.updateSettings({
    lateThreshold: null,
    allowedRadius: 77,
  });
  assert.strictEqual(afterNull.lateThreshold, 30);
  assert.strictEqual(afterNull.allowedRadius, 77);

  // A value of 0 is preserved (it is not falsy-coerced away).
  const afterZero = await attendanceSettingService.updateSettings({ lateThreshold: 0 });
  assert.strictEqual(afterZero.lateThreshold, 0);
  assert.strictEqual(afterZero.allowedRadius, 77, "the other fields are still untouched");
});

test("attendance settings (PG): updateSettings creates the singleton seeded from the body when absent", async () => {
  await clearAttendanceSettings();

  const settings = await attendanceSettingService.updateSettings({
    templeLatitude: 12.5,
    templeLongitude: 77.5,
    allowedRadius: 150,
    lateThreshold: 10,
    earlyCheckInWindow: 25,
  });
  assert.strictEqual(settings.templeLatitude, 12.5);
  assert.strictEqual(settings.allowedRadius, 150);
  assert.strictEqual(settings.lateThreshold, 10);
  // The unspecified paths still receive the schema defaults.
  assert.strictEqual(settings.earlyCheckInWindow, 25);
  assert.strictEqual((await pgQuery("SELECT count(*)::int AS c FROM attendance_settings"))[0].c, 1);
});

// ─── AttendanceSetting: validation ─────────────────────────────────────────
test("attendance settings (PG): non-numeric values are rejected like Mongoose would", async () => {
  await clearAttendanceSettings();

  await assert.rejects(
    () => attendanceSettingService.create({ allowedRadius: "not-a-number" }),
    /allowedRadius must be a number/
  );
  await assert.rejects(
    () => attendanceSettingService.updateSettings({ lateThreshold: "abc" }),
    /lateThreshold must be a number/
  );
});

// ─── PriestSetting: full field mapping ─────────────────────────────────────
test("priest settings (PG): every persisted Mongo field round-trips through the repository", async () => {
  const priestId = priestIdFor("PG");

  const created = await priestSettingService.create({
    priestId,
    smsNotifications: false,
    dutyReminders: false,
    calendarWidget: true,
    agamaReferenceModule: true,
  });

  assert.match(String(created._id), /^[0-9a-f]{24}$/);
  assert.strictEqual(created.priestId, priestId);
  assert.strictEqual(created.smsNotifications, false);
  assert.strictEqual(created.dutyReminders, false);
  assert.strictEqual(created.calendarWidget, true);
  assert.strictEqual(created.agamaReferenceModule, true);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  // Genuine booleans in the column, not text/int flags.
  const rows = await pgQuery(
    `SELECT sms_notifications, duty_reminders, calendar_widget, agama_reference_module
     FROM priest_settings WHERE id = $1`,
    [created._id]
  );
  assert.strictEqual(rows[0].sms_notifications, false);
  assert.strictEqual(rows[0].duty_reminders, false);
  assert.strictEqual(rows[0].calendar_widget, true);
  assert.strictEqual(rows[0].agama_reference_module, true);
});

test("priest settings (PG): defaults mirror the Mongo schema's asymmetric toggles", async () => {
  const created = await priestSettingService.create({ priestId: priestIdFor("Defaults") });

  // mongoose: smsNotifications/dutyReminders/calendarWidget default true,
  //           agamaReferenceModule defaults false.
  assert.strictEqual(created.smsNotifications, true);
  assert.strictEqual(created.dutyReminders, true);
  assert.strictEqual(created.calendarWidget, true);
  assert.strictEqual(created.agamaReferenceModule, false);
});

test("priest settings (PG): getOrCreate lazily materialises one document per priest", async () => {
  const priestId = priestIdFor("Lazy");

  const settings = await priestSettingService.getOrCreate(priestId);
  assert.strictEqual(settings.priestId, priestId);
  assert.strictEqual(settings.smsNotifications, true);
  assert.strictEqual(settings.agamaReferenceModule, false);

  const again = await priestSettingService.getOrCreate(priestId);
  assert.strictEqual(again._id, settings._id);
  assert.strictEqual(
    (await pgQuery("SELECT count(*)::int AS c FROM priest_settings WHERE priest_id = $1", [priestId]))[0].c,
    1
  );
});

test("priest settings (PG): a second priest gets an independent document", async () => {
  const first = priestIdFor("A");
  const second = priestIdFor("B");

  await priestSettingService.updateSettings(first, { smsNotifications: false });
  const other = await priestSettingService.getOrCreate(second);

  assert.strictEqual((await priestSettingService.findOne({ priestId: first })).smsNotifications, false);
  assert.strictEqual(other.smsNotifications, true, "the second priest keeps the default");
});

// ─── PriestSetting: update semantics ───────────────────────────────────────
test("priest settings (PG): updateSettings honours an explicit false and leaves omitted toggles alone", async () => {
  const priestId = priestIdFor("Update");

  const created = await priestSettingService.getOrCreate(priestId);
  assert.strictEqual(created.smsNotifications, true);
  assert.strictEqual(created.dutyReminders, true);

  // `false` must be persisted — it is never treated as "absent".
  const updated = await priestSettingService.updateSettings(priestId, { smsNotifications: false });
  assert.strictEqual(updated.smsNotifications, false);
  assert.strictEqual(updated.dutyReminders, true, "an omitted toggle keeps its value");
  assert.strictEqual(updated.calendarWidget, true);
  assert.strictEqual(updated.agamaReferenceModule, false);

  // ...and it survives a re-read.
  const reread = await priestSettingService.findOne({ priestId });
  assert.strictEqual(reread.smsNotifications, false);

  // Turning it back on works too.
  const backOn = await priestSettingService.updateSettings(priestId, { smsNotifications: true });
  assert.strictEqual(backOn.smsNotifications, true);
});

test("priest settings (PG): updateSettings creates the per-priest document when absent", async () => {
  const priestId = priestIdFor("CreateOnUpdate");

  const settings = await priestSettingService.updateSettings(priestId, { agamaReferenceModule: true });
  assert.strictEqual(settings.priestId, priestId);
  assert.strictEqual(settings.agamaReferenceModule, true);
  assert.strictEqual(settings.smsNotifications, true, "the other toggles keep their defaults");
  assert.strictEqual(
    (await pgQuery("SELECT count(*)::int AS c FROM priest_settings WHERE priest_id = $1", [priestId]))[0].c,
    1
  );
});

// ─── PriestSetting: validation and constraints ─────────────────────────────
test("priest settings (PG): priestId is required", async () => {
  await assert.rejects(() => priestSettingService.create({}), /priestId is required/);
  await assert.rejects(() => priestSettingService.create({ priestId: "   " }), /priestId is required/);
});

test("priest settings (PG): a duplicate priestId raises the 11000-shaped error", async () => {
  const priestId = priestIdFor("Dup");

  await priestSettingService.create({ priestId });
  await assert.rejects(
    () => priestSettingService.create({ priestId }),
    (error) => error.code === 11000
  );

  // findOne still resolves the original document — a duplicate was never
  // silently upserted.
  assert.strictEqual(
    (await pgQuery("SELECT count(*)::int AS c FROM priest_settings WHERE priest_id = $1", [priestId]))[0].c,
    1
  );
});

test("priest settings (PG): a unique-constraint violation is caught by the repository's remapping", async () => {
  const priestId = priestIdFor("Raw");
  const id = unique();
  await pgQuery("INSERT INTO priest_settings (id, priest_id) VALUES ($1, $2)", [id, priestId]);
  await assert.rejects(
    () => priestSettingRepository.create({ priestId }),
    (error) => error.code === 11000
  );
});

// ─── Mongo cast parity ─────────────────────────────────────────────────────
test("priest settings (PG): the Boolean cast matches Mongoose exactly", async () => {
  // Mongoose casts any non-'false'/'0' value truthily; only the exact strings
  // 'false' and '0' become false. Verified against the model.
  const falsey = await priestSettingService.create({
    priestId: priestIdFor("CastFalse"),
    smsNotifications: "false",
    dutyReminders: "0",
    calendarWidget: 0,
  });
  assert.strictEqual(falsey.smsNotifications, false);
  assert.strictEqual(falsey.dutyReminders, false);
  assert.strictEqual(falsey.calendarWidget, false);

  const truthy = await priestSettingService.create({
    priestId: priestIdFor("CastTrue"),
    smsNotifications: "FALSE",
    dutyReminders: "No",
    calendarWidget: "yes",
  });
  assert.strictEqual(truthy.smsNotifications, true, "'FALSE' is cast truthily, like Mongoose");
  assert.strictEqual(truthy.dutyReminders, true);
  assert.strictEqual(truthy.calendarWidget, true);
});

// ─── No dual writes (PostgreSQL selected) ──────────────────────────────────
test("settings (PG): a PostgreSQL write leaves no MongoDB document behind", async (t) => {
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 1) return t.skip("MongoDB not reachable");

  // A real 24-hex ObjectId, because the Mongoose model on the other side of
  // this assertion would reject anything else with a CastError.
  const priestId = unique();
  const created = await priestSettingService.create({ priestId });

  const mongoDoc = await PriestSetting.findById(created._id);
  assert.strictEqual(mongoDoc, null, "the PG path must not write MongoDB");
  assert.strictEqual(await PriestSetting.findOne({ priestId }), null);
});

test("settings (PG): the service never touches the Mongoose model while PG is selected", async () => {
  // Spying on the model proves the PostgreSQL branch is taken even when MongoDB
  // is unreachable, so this assertion is never skipped.
  const attendanceSpy = spyOn(AttendanceSetting, ["findOne", "create", "findById", "findByIdAndUpdate"]);
  const priestSpy = spyOn(PriestSetting, ["findOne", "create", "findById", "findByIdAndUpdate"]);
  try {
    await clearAttendanceSettings();
    await attendanceSettingService.getOrCreate();
    await attendanceSettingService.updateSettings({ lateThreshold: 21 });
    await priestSettingService.getOrCreate(priestIdFor("Spy"));
    await priestSettingService.updateSettings(priestIdFor("Spy2"), { dutyReminders: false });

    assert.deepStrictEqual(attendanceSpy.calls, [], "the PG path must not call Mongoose");
    assert.deepStrictEqual(priestSpy.calls, [], "the PG path must not call Mongoose");
  } finally {
    attendanceSpy.restore();
    priestSpy.restore();
  }
});

// ─── The controllers' response shapes ──────────────────────────────────────
test("settings (PG): the controllers surface the same response shapes as before", async () => {
  const attendanceSettingsController = require("../src/controllers/attendanceSettingsController");
  await clearAttendanceSettings();

  const makeRes = () => ({
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  });

  // GET /api/attendance/settings -> { success, settings } with the singleton
  // created on first read.
  const getRes = makeRes();
  await attendanceSettingsController.getSettings({}, getRes);
  assert.strictEqual(getRes.statusCode, 200);
  assert.strictEqual(getRes.body.success, true);
  assert.strictEqual(getRes.body.settings.lateThreshold, 15);
  assert.strictEqual(getRes.body.settings.earlyCheckInWindow, 30);
  assert.strictEqual(getRes.body.settings.allowedRadius, 100);

  // POST /api/attendance/settings -> { success, message, settings }.
  const postRes = makeRes();
  await attendanceSettingsController.updateSettings(
    { body: { lateThreshold: 25, earlyCheckInWindow: 40 } },
    postRes
  );
  assert.strictEqual(postRes.statusCode, 200);
  assert.strictEqual(postRes.body.success, true);
  assert.strictEqual(postRes.body.message, "Attendance settings updated");
  assert.strictEqual(postRes.body.settings.lateThreshold, 25);
  assert.strictEqual(postRes.body.settings.earlyCheckInWindow, 40);
  // The two fields the admin page never sends are preserved.
  assert.strictEqual(postRes.body.settings.allowedRadius, 100);
  assert.strictEqual(postRes.body.settings.templeLatitude, 0);

  // A failure still produces the original 500 envelope.
  const failRes = makeRes();
  await attendanceSettingsController.updateSettings({ body: { lateThreshold: "nope" } }, failRes);
  assert.strictEqual(failRes.statusCode, 500);
  assert.strictEqual(failRes.body.success, false);
  assert.match(failRes.body.message, /lateThreshold must be a number/);
});

test("priest settings (PG): the controller surfaces the same response shapes as before", async () => {
  const priestController = require("../src/controllers/priestController");

  // The handler resolves the priest through User + Employee first, so those are
  // stubbed for the duration of the test; the settings store itself is real.
  const priestId = priestIdFor("Ctrl");
  const User = require("../src/models/User");
  const Employee = require("../src/models/Employee");
  const originalUserFindById = User.findById;
  const originalEmployeeFindOne = Employee.findOne;
  User.findById = async () => ({ _id: "u1", email: "priest@example.test" });
  Employee.findOne = async () => ({ _id: priestId });
  try {
    const makeRes = () => ({
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    });

    // GET /api/priest/settings -> the raw document, no envelope.
    const getRes = makeRes();
    await priestController.getSettings({ user: { id: "u1" } }, getRes);
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.body.priestId, priestId);
    assert.strictEqual(getRes.body.smsNotifications, true);
    assert.strictEqual(getRes.body.agamaReferenceModule, false);
    assert.strictEqual(getRes.body.message, undefined, "the GET response stays unenveloped");

    // PUT /api/priest/settings -> { message, settings }.
    const putRes = makeRes();
    await priestController.updateSettings(
      { user: { id: "u1" }, body: { smsNotifications: false, agamaReferenceModule: true } },
      putRes
    );
    assert.strictEqual(putRes.statusCode, 200);
    assert.strictEqual(putRes.body.message, "Settings updated successfully");
    assert.strictEqual(putRes.body.settings.smsNotifications, false);
    assert.strictEqual(putRes.body.settings.agamaReferenceModule, true);
    assert.strictEqual(putRes.body.settings.dutyReminders, true);
  } finally {
    User.findById = originalUserFindById;
    Employee.findOne = originalEmployeeFindOne;
  }
});

// ─── Dynamic datasource switching ──────────────────────────────────────────
test("settings: the datasource is read at call time, not at module load", async () => {
  // The modules were loaded in test.before. Flipping the seam now must take
  // effect immediately — a require-time destructure would keep reporting true.
  assert.strictEqual(await attendanceSettingService.usePostgres(), true);
  assert.strictEqual(await priestSettingService.usePostgres(), true);

  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(attendanceSettingService.isConnected(), false);
    assert.strictEqual(await attendanceSettingService.usePostgres(), false);
    assert.strictEqual(priestSettingService.isConnected(), false);
    assert.strictEqual(await priestSettingService.usePostgres(), false);
  } finally {
    dbConfig.isDbConnected = () => true;
  }

  // And back again, in the same process, with no reload.
  assert.strictEqual(await attendanceSettingService.usePostgres(), true);
  assert.strictEqual(await priestSettingService.usePostgres(), true);
});

// ─── Helpers ───────────────────────────────────────────────────────────────
// Minimal call recorder for a Mongoose model's static methods.
function spyOn(model, methods) {
  const originals = {};
  const calls = [];
  for (const name of methods) {
    originals[name] = model[name];
    model[name] = async (...args) => {
      calls.push({ name, args });
      throw new Error(`Mongoose ${name} must not be called on the PostgreSQL path`);
    };
  }
  return {
    calls,
    restore() {
      Object.assign(model, originals);
    },
  };
}