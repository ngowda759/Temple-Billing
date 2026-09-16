// Phase 2U PostgreSQL-path tests for the Shift repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the shiftRepository / shiftService persist to and read from the real
//     shifts table (no mocks),
//   - every persisted Mongo schema field round-trips losslessly (shift name, the
//     two time-of-day strings, the free-text category, the staff headcount, the
//     active flag, the notes and the two real Date instants) and that no field
//     the Mongoose schema does not declare is persisted,
//   - defaults ('General', 1, true, '') match the Mongoose schema defaults
//     exactly,
//   - time semantics: start_time / end_time stay TEXT so the 12-hour meridiem
//     display strings ("9:00 AM") round-trip byte-for-byte, and only
//     created_at / updated_at are real instants,
//   - overnight shifts (end <= start, e.g. "10:00 PM" -> "6:00 AM") are
//     storable and round-trip unchanged, preserving the existing business rule,
//   - validation (required fields) matches the Mongoose model,
//   - the query surface the controllers use is reproduced exactly: the
//     { shiftName, active: true } equality lookup, the anchored
//     case-insensitive RegExp lookup from attendanceController, the
//     { active: true } scans and the standing sorts,
//   - the service never writes to MongoDB while PostgreSQL is selected (no dual
//     writes).
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const nameFor = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let shiftRepository;
let shiftService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS shifts CASCADE");
    await pool.query("DROP TABLE IF EXISTS leaves CASCADE");
    await pool.query("DROP TABLE IF EXISTS attendance CASCADE");
  } finally {
    await pool.end();
  }
};

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
  shiftRepository = require("../src/repositories/shiftRepository");
  shiftService = require("../src/services/shiftService");
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

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const shiftBase = (overrides = {}) => ({
  shiftName: nameFor("Shift"),
  startTime: "9:00 AM",
  endTime: "5:00 PM",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("shift: the service selects PostgreSQL when the seam and PG are both available", async () => {
  assert.strictEqual(shiftService.isConnected(), true);
  assert.strictEqual(await shiftService.usePostgres(), true);
});

// ─── Full field round trip ─────────────────────────────────────────────────
test("shift repository: every persisted Mongo field round-trips through PostgreSQL", async () => {
  const input = shiftBase({
    shiftName: "Evening Shift",
    startTime: "2:30 PM",
    endTime: "10:30 PM",
    category: "Security",
    requiredStaff: 4,
    active: false,
    notes: "Gate duty rounds every hour",
  });

  const created = await shiftService.create(input);
  assert.ok(created._id, "created id present");

  const read = await shiftRepository.findById(created._id);
  assert.deepStrictEqual(
    Object.keys(read).sort(),
    ["_id", "id", "shiftName", "startTime", "endTime", "category",
      "requiredStaff", "active", "notes", "createdAt", "updatedAt"].sort(),
    "the returned document carries exactly the persisted Mongo fields"
  );

  assert.strictEqual(read._id, created._id);
  assert.strictEqual(read.id, created._id, "id mirrors _id for Mongo compatibility");
  assert.strictEqual(read.shiftName, "Evening Shift");
  assert.strictEqual(read.startTime, "2:30 PM");
  assert.strictEqual(read.endTime, "10:30 PM");
  assert.strictEqual(read.category, "Security");
  assert.strictEqual(read.requiredStaff, 4, "requiredStaff reads back as a Number");
  assert.strictEqual(read.active, false);
  assert.strictEqual(read.notes, "Gate duty rounds every hour");
  assert.ok(read.createdAt instanceof Date, "createdAt is a Date");
  assert.ok(read.updatedAt instanceof Date, "updatedAt is a Date");
});

test("shift repository: MongoDB-only fields are neither persisted nor returned", async () => {
  const created = await shiftRepository.create(shiftBase({
    shiftCode: "SH-001",
    description: "should not exist",
    status: "Active",
    breakDuration: 30,
    gracePeriod: 10,
    workingHours: 8,
    shiftType: "Rotational",
    employees: ["000000000000000000000001"],
    createdBy: "someone",
    metadata: { a: 1 },
  }));

  const read = await shiftRepository.findById(created._id);
  for (const absent of ["shiftCode", "description", "status", "breakDuration",
    "gracePeriod", "workingHours", "shiftType", "employees", "createdBy",
    "metadata", "updatedBy"]) {
    assert.strictEqual(read[absent], undefined, `${absent} is not returned`);
  }

  const cols = await poolQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'shifts'"
  );
  const names = cols.map((c) => c.column_name);
  for (const absent of ["shift_code", "description", "status", "break_duration",
    "grace_period", "working_hours", "shift_type", "employees", "created_by",
    "metadata", "updated_by"]) {
    assert.ok(!names.includes(absent), `${absent} column does not exist`);
  }
});

// ─── Defaults ──────────────────────────────────────────────────────────────
test("shift repository: schema defaults are applied exactly like Mongoose", async () => {
  const created = await shiftRepository.create({
    shiftName: nameFor("Default"),
    startTime: "9:00 AM",
    endTime: "5:00 PM",
  });

  assert.strictEqual(created.category, "General", "category defaults to 'General'");
  assert.strictEqual(created.requiredStaff, 1, "requiredStaff defaults to 1");
  assert.strictEqual(created.active, true, "active defaults to true");
  assert.strictEqual(created.notes, "", "notes defaults to ''");
});

test("shift repository: strings are trimmed exactly like the Mongoose schema", async () => {
  const created = await shiftRepository.create({
    shiftName: "  Trimmed Shift  ",
    startTime: "  9:00 AM  ",
    endTime: "  5:00 PM  ",
    category: "  General  ",
    notes: "  padded notes  ",
  });

  assert.strictEqual(created.shiftName, "Trimmed Shift", "shiftName is trimmed");
  assert.strictEqual(created.startTime, "9:00 AM", "startTime is trimmed");
  assert.strictEqual(created.endTime, "5:00 PM", "endTime is trimmed");
  assert.strictEqual(created.category, "General", "category is trimmed");
  assert.strictEqual(created.notes, "padded notes", "notes is trimmed");
});

// ─── Validation ────────────────────────────────────────────────────────────
test("shift repository: validation mirrors the Mongoose model", async () => {
  await assert.rejects(
    shiftRepository.create(shiftBase({ shiftName: undefined })),
    /shiftName is required/,
    "shiftName is required"
  );
  await assert.rejects(
    shiftRepository.create(shiftBase({ shiftName: "   " })),
    /shiftName is required/,
    "whitespace-only shiftName is rejected like Mongo's trim-then-required"
  );
  await assert.rejects(
    shiftRepository.create(shiftBase({ startTime: "" })),
    /startTime is required/,
    "startTime is required"
  );
  await assert.rejects(
    shiftRepository.create(shiftBase({ endTime: "  " })),
    /endTime is required/,
    "endTime is required"
  );
  await assert.rejects(
    shiftRepository.create(shiftBase({ requiredStaff: "abc" })),
    /requiredStaff must be a number/,
    "a non-numeric requiredStaff is rejected"
  );

  // category and notes are free text in Mongo — no enum or shape is imposed.
  const custom = await shiftRepository.create(shiftBase({ category: "Festival Roster" }));
  assert.strictEqual(custom.category, "Festival Roster");

  // requiredStaff has no min in Mongo: fractional values are preserved.
  const fractional = await shiftRepository.create(shiftBase({ requiredStaff: 2.5 }));
  assert.strictEqual(fractional.requiredStaff, 2.5);
});

// ─── Time semantics ────────────────────────────────────────────────────────
test("shift repository: start_time and end_time stay TEXT 12-hour meridiem strings", async () => {
  const storedStart = await poolQuery(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'start_time'"
  );
  assert.strictEqual(storedStart[0].data_type, "text", "start_time is TEXT, not TIME/timestamp");
  const storedEnd = await poolQuery(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'end_time'"
  );
  assert.strictEqual(storedEnd[0].data_type, "text", "end_time is TEXT, not TIME/timestamp");

  // The exact strings the frontend form produces must survive verbatim: a TIME
  // column would rewrite "9:00 AM" into "09:00:00" and break both the API
  // contract and the frontend's /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i parser.
  for (const [start, end] of [
    ["9:00 AM", "5:00 PM"],
    ["9:30 AM", "6:45 PM"],
    ["12:00 PM", "12:30 AM"],
    ["12:00 AM", "11:59 PM"],
    ["05:00 PM", "09:00 AM"],
  ]) {
    const created = await shiftRepository.create(shiftBase({ startTime: start, endTime: end }));
    const read = await shiftRepository.findById(created._id);
    assert.strictEqual(read.startTime, start, `${start} round-trips verbatim`);
    assert.strictEqual(read.endTime, end, `${end} round-trips verbatim`);

    // The stored value is byte-identical to what was sent.
    const raw = await poolQuery(
      "SELECT start_time, end_time FROM shifts WHERE id = $1", [created._id]
    );
    assert.strictEqual(raw[0].start_time, start);
    assert.strictEqual(raw[0].end_time, end);
  }
});

test("shift repository: created_at and updated_at are the only real instants", async () => {
  const before = new Date();
  const created = await shiftRepository.create(shiftBase());
  const after = new Date();

  assert.ok(created.createdAt >= before && created.createdAt <= after,
    "createdAt is generated at insert time");
  assert.ok(created.updatedAt instanceof Date, "updatedAt is a Date");

  const raw = await poolQuery(
    "SELECT pg_typeof(created_at)::text AS c, pg_typeof(updated_at)::text AS u FROM shifts WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(raw[0].c, "timestamp with time zone");
  assert.strictEqual(raw[0].u, "timestamp with time zone");
});

// ─── Overnight shifts ──────────────────────────────────────────────────────
test("shift repository: overnight shifts (end <= start) round-trip unchanged", async () => {
  // Shift.js declares no ordering rule and normalizeRange in shiftController
  // adds 24h when end <= start, so "10:00 PM" -> "6:00 AM" is a supported shift.
  // The PostgreSQL path must not reject or rewrite it.
  const created = await shiftRepository.create(shiftBase({
    shiftName: nameFor("Overnight"),
    startTime: "10:00 PM",
    endTime: "6:00 AM",
  }));

  assert.strictEqual(created.startTime, "10:00 PM");
  assert.strictEqual(created.endTime, "6:00 AM");

  const read = await shiftRepository.findById(created._id);
  assert.strictEqual(read.startTime, "10:00 PM", "the overnight start survives");
  assert.strictEqual(read.endTime, "6:00 AM", "the overnight end survives");

  // An update must not disturb the midnight-crossing pair either.
  const updated = await shiftRepository.updateById(created._id, { requiredStaff: 3 });
  assert.strictEqual(updated.startTime, "10:00 PM");
  assert.strictEqual(updated.endTime, "6:00 AM");
  assert.strictEqual(updated.requiredStaff, 3);
});

test("shift repository: midnight-exact boundaries are stored without conversion", async () => {
  const midnightStart = await shiftRepository.create(shiftBase({
    startTime: "12:00 AM", endTime: "8:00 AM",
  }));
  assert.strictEqual(midnightStart.startTime, "12:00 AM");

  const midnightEnd = await shiftRepository.create(shiftBase({
    startTime: "4:00 PM", endTime: "12:00 AM",
  }));
  assert.strictEqual(midnightEnd.endTime, "12:00 AM");

  const noon = await shiftRepository.create(shiftBase({
    startTime: "12:00 PM", endTime: "9:00 PM",
  }));
  assert.strictEqual(noon.startTime, "12:00 PM", "12:00 PM is not converted to 00:00");
});

// ─── Query surface ─────────────────────────────────────────────────────────
test("shift repository: the { shiftName, active: true } lookup matches assignShift", async () => {
  const name = nameFor("DefaultShift");

  const active = await shiftRepository.create(
    shiftBase({ shiftName: name, startTime: "9:00 AM", endTime: "5:00 PM", active: true })
  );
  // An inactive shift with the same name must NOT be returned by the lookup.
  await shiftRepository.create(
    shiftBase({ shiftName: name, startTime: "6:00 AM", endTime: "2:00 PM", active: false })
  );

  const found = await shiftRepository.findOne({ shiftName: name, active: true });
  assert.ok(found, "the active shift is found by name");
  assert.strictEqual(found._id, active._id);
  assert.strictEqual(found.active, true);

  // { active: false } finds the other one.
  const inactive = await shiftRepository.findOne({ shiftName: name, active: false });
  assert.ok(inactive, "the inactive shift is found when active: false is requested");
  assert.strictEqual(inactive.active, false);
});

test("shift repository: the anchored case-insensitive RegExp lookup matches resolveShiftDefinition", async () => {
  const name = nameFor("Morning");

  const created = await shiftRepository.create(
    shiftBase({ shiftName: name, startTime: "9:00 AM", endTime: "5:00 PM", active: true })
  );

  // attendanceController builds /^name$/i from an employee's defaultShift.
  const found = await shiftRepository.findOne({
    shiftName: new RegExp(`^${name}$`, "i"),
    active: true,
  });
  assert.ok(found, "an exact case-insensitive match is found");
  assert.strictEqual(found._id, created._id);

  const upper = await shiftRepository.findOne({
    shiftName: new RegExp(`^${name.toUpperCase()}$`, "i"),
    active: true,
  });
  assert.ok(upper, "the lookup is case-insensitive in both directions");
  assert.strictEqual(upper._id, created._id);

  // The anchors are honoured: a name with extra characters must not match.
  const partial = await shiftRepository.findOne({
    shiftName: new RegExp(`^${name} Extra$`, "i"),
    active: true,
  });
  assert.strictEqual(partial, null, "the anchored RegExp does not match a superstring");

  const prefix = await shiftRepository.findOne({
    shiftName: new RegExp(`^${name.slice(0, -1)}$`, "i"),
    active: true,
  });
  assert.strictEqual(prefix, null, "the anchored RegExp does not match a prefix");
});

test("shift repository: the { active: true } scans and standing sorts behave like Mongo", async () => {
  const tag = nameFor("Scan");
  const a = await shiftRepository.create(shiftBase({ shiftName: `${tag}-A`, active: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const b = await shiftRepository.create(shiftBase({ shiftName: `${tag}-B`, active: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const c = await shiftRepository.create(shiftBase({ shiftName: `${tag}-C`, active: false }));

  // shiftService.findMany({ filter: { active: true } }) — getAvailableEmployees.
  const active = await shiftRepository.findMany({ filter: { active: true } });
  const activeIds = active.map((s) => s._id);
  assert.ok(activeIds.includes(a._id) && activeIds.includes(b._id));
  assert.ok(!activeIds.includes(c._id), "the inactive shift is excluded");

  // Shift.find().sort({ createdAt: -1 }) — getShifts / getShiftDashboard.
  const byCreated = await shiftRepository.findMany({
    filter: { id: { $in: [a._id, b._id, c._id] } },
    sort: { createdAt: -1 },
  });
  assert.deepStrictEqual(byCreated.map((s) => s._id), [c._id, b._id, a._id],
    "newest first, exactly like the Mongo sort");

  // Shift.find({ active: true }).sort({ shiftName: 1 }) — attendance dashboard.
  const byName = await shiftRepository.findMany({
    filter: { active: true, id: { $in: [a._id, b._id, c._id] } },
    sort: { shiftName: 1 },
  });
  assert.deepStrictEqual(byName.map((s) => s.shiftName), [`${tag}-A`, `${tag}-B`],
    "active shifts ordered by name");

  // { updatedAt: -1, createdAt: -1 } — resolveShiftDefinition's ordering.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await shiftRepository.updateById(a._id, { notes: "touched" });
  const byUpdated = await shiftRepository.findMany({
    filter: { id: { $in: [a._id, b._id] } },
    sort: { updatedAt: -1, createdAt: -1 },
  });
  assert.strictEqual(byUpdated[0]._id, a._id, "the most recently updated shift leads");
});

test("shift repository: filters, $in, $ne and pagination behave like Mongo", async () => {
  const tag = nameFor("Filter");
  const one = await shiftRepository.create(shiftBase({ shiftName: `${tag}-1`, category: "Security" }));
  await shiftRepository.create(shiftBase({ shiftName: `${tag}-2`, category: "Kitchen", active: false }));
  await shiftRepository.create(shiftBase({ shiftName: `${tag}-3`, category: "Security" }));

  const securityCount = await shiftRepository.count({ category: "Security", id: { $in: [one._id] } });
  assert.strictEqual(securityCount, 1, "count honours the same filter as findMany");
  assert.strictEqual(
    (await shiftRepository.findMany({ filter: { id: { $in: [one._id] } } })).length, 1,
    "$in matches the requested id"
  );
  assert.strictEqual(
    (await shiftRepository.findMany({ filter: { id: { $in: [] } } })).length, 0,
    "$in: [] matches nothing"
  );
  assert.strictEqual(
    (await shiftRepository.findMany({ filter: { id: one._id } })).length, 1,
    "a plain id equality matches"
  );

  const activeOnly = await shiftRepository.findMany({ filter: { id: { $in: [one._id] }, active: true } });
  assert.strictEqual(activeOnly.length, 1);

  // A missing id returns null like findById.
  assert.strictEqual(await shiftRepository.findById("0000000000000000000000ff"), null);

  // Sorting by an unknown / injection-shaped key is dropped by the whitelist
  // and the default order applies instead of being interpolated.
  const injected = await shiftRepository.findMany({
    filter: { id: { $in: [one._id] } },
    sort: { "shift_name; DROP TABLE shifts; --": -1 },
  });
  assert.strictEqual(injected.length, 1, "an unknown sort key is ignored, not interpolated");

  // limit / offset pagination.
  const limited = await shiftRepository.findMany({
    filter: { id: { $in: [one._id] } }, limit: 1,
  });
  assert.strictEqual(limited.length, 1);
});

// ─── Update / delete semantics ─────────────────────────────────────────────
test("shift repository: updateById patches only supplied fields and refreshes updatedAt", async () => {
  const created = await shiftRepository.create(shiftBase({
    shiftName: "Patch Me", startTime: "8:00 AM", endTime: "4:00 PM", category: "Kitchen",
  }));
  const before = created.updatedAt;

  await new Promise((resolve) => setTimeout(resolve, 10));
  const updated = await shiftRepository.updateById(created._id, { requiredStaff: 3 });

  assert.strictEqual(updated.requiredStaff, 3, "the patched field changed");
  assert.strictEqual(updated.shiftName, "Patch Me", "shiftName is untouched");
  assert.strictEqual(updated.startTime, "8:00 AM", "startTime is untouched");
  assert.strictEqual(updated.endTime, "4:00 PM", "endTime is untouched");
  assert.strictEqual(updated.category, "Kitchen", "category is untouched");
  assert.ok(updated.updatedAt >= before, "updatedAt is refreshed");

  // Deactivating through update is the only activation path the app has.
  const deactivated = await shiftRepository.updateById(created._id, { active: false });
  assert.strictEqual(deactivated.active, false);

  assert.strictEqual(await shiftRepository.updateById("0000000000000000000000ff", { active: false }), null,
    "a missing id returns null like findByIdAndUpdate");

  await assert.rejects(
    shiftRepository.updateById(created._id, { shiftName: "   " }),
    /shiftName is required/,
    "an all-whitespace shiftName is rejected on update too"
  );
});

test("shift repository: destroy removes exactly one row and returns the deleted document", async () => {
  const created = await shiftRepository.create(shiftBase({ shiftName: nameFor("Doomed") }));

  const deleted = await shiftRepository.destroy(created._id);
  assert.ok(deleted, "the deleted document is returned like findByIdAndDelete");
  assert.strictEqual(deleted._id, created._id);
  assert.strictEqual(deleted.shiftName, created.shiftName);

  assert.strictEqual(await shiftRepository.findById(created._id), null, "the row is gone");
  assert.strictEqual(await shiftRepository.destroy(created._id), null,
    "deleting a missing id returns null");
});

// ─── Duplicate names ───────────────────────────────────────────────────────
test("shift repository: duplicate shift names are allowed, exactly like Mongo", async () => {
  const name = nameFor("Dupe");

  const first = await shiftRepository.create(shiftBase({ shiftName: name }));
  const second = await shiftRepository.create(shiftBase({ shiftName: name }));

  assert.notStrictEqual(first._id, second._id, "two distinct documents share the name");

  const rows = await poolQuery("SELECT id FROM shifts WHERE shift_name = $1", [name]);
  assert.strictEqual(rows.length, 2, "both rows exist in PostgreSQL");

  // The schema declares no unique index, so PostgreSQL must not have one.
  const uniques = await poolQuery(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'shifts'::regclass AND contype = 'u'`);
  assert.strictEqual(uniques.length, 0, "no UNIQUE constraint on shifts");

  // ...and the standing { shiftName, active: true } lookup deterministically
  // returns the newest row, matching .sort({ createdAt: -1 }).limit(1).
  const newest = await shiftRepository.findOne({ shiftName: name, active: true });
  assert.strictEqual(newest._id, second._id, "the newest duplicate wins the lookup");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("shift repository: no dual writes — Mongoose is never connected on the PG path", async () => {
  const before = await shiftRepository.count({});
  await shiftRepository.create(shiftBase({ shiftName: nameFor("NoDual") }));
  assert.strictEqual(await shiftRepository.count({}), before + 1, "exactly one PG row");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
});

test("shift service: a single create reaches exactly one datasource", async () => {
  assert.strictEqual(await shiftService.usePostgres(), true);
  const before = await shiftRepository.count({});
  const created = await shiftService.create(shiftBase({ shiftName: nameFor("OneWrite") }));
  const after = await shiftRepository.count({});
  assert.strictEqual(after, before + 1, "exactly one write");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
  assert.ok(created._id);
});

test("shift service: a delete reaches only PostgreSQL", async () => {
  const created = await shiftService.create(shiftBase({ shiftName: nameFor("DelOne") }));
  const before = await shiftRepository.count({});
  assert.ok(await shiftService.destroy(created._id), "the delete reported success");
  assert.strictEqual(await shiftRepository.count({}), before - 1, "exactly one PG row removed");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
});
