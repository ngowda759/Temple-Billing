// Phase 2S PostgreSQL-path tests for the Attendance repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the attendanceRepository / attendanceService persist to and read from the
//     real attendance table (no mocks),
//   - every persisted Mongo schema field round-trips losslessly (staff identity
//     and identity snapshot, the display clock strings, the real Date instants,
//     shift/duty strings, the status enum, durations, location/face verification
//     data and the correction fields) and that no field the Mongoose schema does
//     not declare is persisted,
//   - defaults ('--', 'Morning', 'Absent', 0, false, '', null) match the
//     Mongoose schema defaults exactly,
//   - date/time semantics: date_key stays the timezone-free 'YYYY-MM-DD'
//     calendar key and check_in_at / check_out_at / correction_date round-trip
//     as exact instants,
//   - the uniqueness rule (staffId + dateKey) is reproduced and that duplicates
//     fail while different employee/date combinations succeed,
//   - validation (required staff fields, status enum, dateKey shape, numeric
//     finiteness) matches the Mongoose model,
//   - filtering / $in / range / $or identity lookups / sorting / pagination
//     behave like the Mongo query surface used by the controllers,
//   - the service never writes to MongoDB while PostgreSQL is selected (no dual
//     writes) and can switch datasources in-process.
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
const staffId = (tag) => `${tag}-${unique()}`;
const dateKey = (day) => `2026-03-${String(day).padStart(2, "0")}`;

let originalIsDbConnected;
let attendanceRepository;
let attendanceService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS attendance CASCADE");
    await pool.query("DROP TABLE IF EXISTS rooms CASCADE");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS damage_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_order_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_logs CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS prasadam_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS pooja_booking_material_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS pooja_bookings CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_material_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS bookings CASCADE");
    await pool.query("DROP TABLE IF EXISTS bill_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS bills CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_transactions CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_heads CASCADE");
    await pool.query("DROP TABLE IF EXISTS employees CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_tickets CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS donations CASCADE");
    await pool.query("DROP TABLE IF EXISTS pg_health");
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
  attendanceRepository = require("../src/repositories/attendanceRepository");
  attendanceService = require("../src/services/attendanceService");
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

const attendanceBase = (overrides = {}) => ({
  staffId: staffId("PG"),
  staffName: "Ram Kumar",
  dateKey: dateKey(5),
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("attendance: the service selects PostgreSQL when the seam and PG are both available", async () => {
  assert.strictEqual(attendanceService.isConnected(), true);
  assert.strictEqual(await attendanceService.usePostgres(), true);
});

// ── create / read round trip ──────────────────────────────────────────────
test("attendance repository: every persisted Mongo field round-trips through PostgreSQL", async () => {
  const checkInAt = new Date("2026-03-05T03:45:00.000Z");
  const checkOutAt = new Date("2026-03-05T12:30:00.000Z");
  const correctionDate = new Date("2026-03-06T05:00:00.000Z");

  const created = await attendanceRepository.create({
    staffId: staffId("RT"),
    staffName: "Sita Devi",
    employeeId: "EMP-1024",
    staffEmail: "SITA@Example.com",
    dateKey: dateKey(7),
    checkIn: "09:15 AM",
    checkOut: "06:30 PM",
    checkInAt,
    checkOutAt,
    shift: "Evening",
    shiftStartTime: "09:00 AM",
    shiftEndTime: "06:00 PM",
    assignmentType: "Emergency Duty",
    dutyName: "Annadanam",
    dutyArea: "Kitchen",
    status: "Present",
    isLateCheckIn: true,
    workingMinutes: "555",
    workingHours: "9h 15m",
    overtimeMinutes: 75,
    overtimeHours: "1h 15m",
    isOvertime: true,
    note: "Festival duty",
    source: "biometric",
    correctedBy: "Admin",
    correctionDate,
    correctionReason: "Late punch",
    latitude: "12.9715987",
    longitude: "77.5945627",
    locationVerified: true,
    faceVerified: true,
    distanceFromTemple: "12.5",
    deviceInfo: "Pixel 7",
    browser: "Chrome",
    ipAddress: "10.0.0.5",
    checkInPhoto: "photo-in.jpg",
    checkOutPhoto: "photo-out.jpg",
  });

  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.staffName, "Sita Devi");
  assert.strictEqual(created.employeeId, "EMP-1024");
  assert.strictEqual(created.checkIn, "09:15 AM");
  assert.strictEqual(created.shift, "Evening");
  assert.strictEqual(created.status, "Present");
  assert.strictEqual(created.isLateCheckIn, true);
  assert.strictEqual(created.workingMinutes, 555);
  assert.strictEqual(created.workingHours, "9h 15m");
  assert.strictEqual(created.overtimeMinutes, 75);
  assert.strictEqual(created.isOvertime, true);
  assert.strictEqual(created.latitude, 12.9715987);
  assert.strictEqual(created.locationVerified, true);
  assert.strictEqual(created.correctedBy, "Admin");

  const read = await attendanceRepository.findById(created._id);
  assert.deepStrictEqual(Object.keys(read).sort(), [
    "_id", "assignmentType", "browser", "checkIn", "checkInAt", "checkInPhoto",
    "checkOut", "checkOutAt", "checkOutPhoto", "correctedBy", "correctionDate",
    "correctionReason", "createdAt", "dateKey", "deviceInfo", "distanceFromTemple",
    "dutyArea", "dutyName", "employeeId", "faceVerified", "id", "ipAddress",
    "isLateCheckIn", "isOvertime", "latitude", "locationVerified", "longitude",
    "note", "overtimeHours", "overtimeMinutes", "shift", "shiftEndTime",
    "shiftStartTime", "source", "staffEmail", "staffId", "staffName", "status",
    "updatedAt", "workingHours", "workingMinutes",
  ].sort(), "the returned document carries exactly the persisted Mongo fields");
  assert.strictEqual(read.checkInAt.getTime(), checkInAt.getTime(), "checkInAt instant preserved");
  assert.strictEqual(read.checkOutAt.getTime(), checkOutAt.getTime(), "checkOutAt instant preserved");
  assert.strictEqual(read.correctionDate.getTime(), correctionDate.getTime(), "correctionDate instant preserved");
  assert.ok(read.createdAt instanceof Date);
  assert.ok(read.updatedAt instanceof Date);
});

test("attendance repository: MongoDB-only fields are neither persisted nor returned", async () => {
  const created = await attendanceRepository.create(attendanceBase({
    // These keys exist on other entities but not on the Attendance schema, so
    // the repository must not invent columns for them.
    shiftId: "SHIFT-1",
    leaveId: "LEAVE-1",
    createdBy: "ghost",
    updatedBy: "ghost",
    approvalStatus: "Approved",
    metadata: { anything: true },
    sessions: [{ in: "09:00", out: "10:00" }],
  }));

  for (const key of ["shiftId", "leaveId", "createdBy", "updatedBy", "approvalStatus", "metadata", "sessions"]) {
    assert.strictEqual(created[key], undefined, `${key} is not part of the Attendance model`);
  }
  const cols = await poolQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'attendance'"
  );
  const names = cols.map((c) => c.column_name);
  assert.ok(!names.includes("shift_id"));
  assert.ok(!names.includes("leave_id"));
  assert.ok(!names.includes("metadata"));
  assert.ok(!names.includes("sessions"));
});

test("attendance repository: optional identity/coordinate fields read back as undefined/null exactly like Mongoose", async () => {
  const created = await attendanceRepository.create(attendanceBase());
  assert.strictEqual(created.employeeId, undefined, "employeeId unset reads back undefined");
  assert.strictEqual(created.staffEmail, undefined, "staffEmail unset reads back undefined");
  assert.strictEqual(created.checkInAt, null, "checkInAt default null");
  assert.strictEqual(created.checkOutAt, null, "checkOutAt default null");
  assert.strictEqual(created.correctionDate, null, "correctionDate default null");
  assert.strictEqual(created.latitude, null, "latitude default null");
  assert.strictEqual(created.longitude, null, "longitude default null");
  assert.strictEqual(created.distanceFromTemple, null, "distanceFromTemple default null");
});

test("attendance repository: schema defaults are applied exactly like Mongoose", async () => {
  const created = await attendanceRepository.create(attendanceBase());
  assert.strictEqual(created.checkIn, "--");
  assert.strictEqual(created.checkOut, "--");
  assert.strictEqual(created.shift, "Morning");
  assert.strictEqual(created.shiftStartTime, "");
  assert.strictEqual(created.shiftEndTime, "");
  assert.strictEqual(created.assignmentType, "");
  assert.strictEqual(created.dutyName, "");
  assert.strictEqual(created.dutyArea, "");
  assert.strictEqual(created.status, "Absent", "status defaults to Absent");
  assert.strictEqual(created.isLateCheckIn, false);
  assert.strictEqual(created.workingMinutes, 0);
  assert.strictEqual(created.workingHours, "--");
  assert.strictEqual(created.overtimeMinutes, 0);
  assert.strictEqual(created.overtimeHours, "--");
  assert.strictEqual(created.isOvertime, false);
  assert.strictEqual(created.note, "");
  assert.strictEqual(created.source, "manual");
  assert.strictEqual(created.correctedBy, "");
  assert.strictEqual(created.correctionReason, "");
  assert.strictEqual(created.locationVerified, false);
  assert.strictEqual(created.faceVerified, false);
  assert.strictEqual(created.deviceInfo, "");
  assert.strictEqual(created.browser, "");
  assert.strictEqual(created.ipAddress, "");
  assert.strictEqual(created.checkInPhoto, "");
  assert.strictEqual(created.checkOutPhoto, "");
});

test("attendance repository: strings are trimmed exactly like the Mongoose schema", async () => {
  const created = await attendanceRepository.create(attendanceBase({
    staffId: "  TRIM-1  ",
    staffName: "  Trimmed Name  ",
    employeeId: "  EMP-9  ",
    staffEmail: "  upper@Example.com  ",
    checkIn: "  09:00 AM  ",
    shift: "  Night  ",
    source: "  biometric  ",
  }));
  assert.strictEqual(created.staffId, "TRIM-1");
  assert.strictEqual(created.staffName, "Trimmed Name");
  assert.strictEqual(created.employeeId, "EMP-9");
  assert.strictEqual(created.staffEmail, "upper@Example.com");
  assert.strictEqual(created.checkIn, "09:00 AM");
  assert.strictEqual(created.shift, "Night");
  assert.strictEqual(created.source, "biometric");
});

// ── Validation ────────────────────────────────────────────────────────────
test("attendance repository: validation mirrors the Mongoose model", async () => {
  await assert.rejects(attendanceRepository.create({ staffName: "X", dateKey: dateKey(1) }), /staffId is required/);
  await assert.rejects(attendanceRepository.create({ staffId: "X", dateKey: dateKey(1) }), /staffName is required/);
  await assert.rejects(attendanceRepository.create({ staffId: "X", staffName: "Y" }), /dateKey is required/);
  await assert.rejects(
    attendanceRepository.create({ staffId: "   ", staffName: "Y", dateKey: dateKey(1) }),
    /staffId is required/,
    "whitespace-only required String rejected (Mongoose trims before the required check)"
  );
  await assert.rejects(
    attendanceRepository.create(attendanceBase({ dateKey: "05/03/2026" })),
    /must be a YYYY-MM-DD calendar key/
  );
  await assert.rejects(
    attendanceRepository.create(attendanceBase({ status: "Vacation" })),
    /Invalid status/
  );
  await assert.rejects(
    attendanceRepository.create(attendanceBase({ workingMinutes: "abc" })),
    /workingMinutes must be a number/
  );
  // Every enum value the Mongoose schema declares is accepted.
  for (const status of ["Present", "Absent", "Half Day", "Leave", "Pending",
    "Working", "Holiday", "Late", "Weekly Off", "Compensatory Off"]) {
    const created = await attendanceRepository.create(attendanceBase({
      staffId: staffId("ENUM"),
      status,
    }));
    assert.strictEqual(created.status, status);
  }
});

// ─── Uniqueness ────────────────────────────────────────────────────────────
test("attendance repository: staffId + dateKey uniqueness matches the Mongo unique index", async () => {
  const id = staffId("UNIQ");
  const created = await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(9) }));

  await assert.rejects(
    attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(9) })),
    (err) => /attendance_staff_id_date_key_key|duplicate key/i.test(err.message),
    "duplicate staffId+dateKey rejected"
  );

  // Same staff, different day.
  const nextDay = await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(10) }));
  assert.strictEqual(nextDay.dateKey, dateKey(10));

  // Different staff, same day.
  const otherStaff = await attendanceRepository.create(attendanceBase({ staffId: staffId("UNIQ"), dateKey: dateKey(9) }));
  assert.strictEqual(otherStaff.dateKey, dateKey(9));

  // A shared employeeId/staffEmail on the same day is legal — those composites
  // are non-unique in Mongo.
  const a = await attendanceRepository.create(attendanceBase({ employeeId: "EMP-SHARED", staffEmail: "shared@example.com", dateKey: dateKey(11) }));
  const b = await attendanceRepository.create(attendanceBase({ employeeId: "EMP-SHARED", staffEmail: "shared@example.com", dateKey: dateKey(11) }));
  assert.notStrictEqual(a._id, b._id);
  assert.strictEqual(created.staffId, id);
});

// ─── Date and time semantics ───────────────────────────────────────────────
test("attendance repository: date_key stays a timezone-free calendar key", async () => {
  const keys = [dateKey(1), dateKey(15), dateKey(31), "2026-12-31", "2027-01-01"];
  for (const key of keys) {
    const created = await attendanceRepository.create(attendanceBase({ dateKey: key, staffId: staffId("KEY") }));
    assert.strictEqual(created.dateKey, key, "dateKey is returned verbatim");
    const read = await attendanceRepository.findById(created._id);
    assert.strictEqual(read.dateKey, key);
  }

  // The stored value is TEXT — no timezone conversion can shift it.
  const stored = await poolQuery(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'attendance' AND column_name = 'date_key'"
  );
  assert.strictEqual(stored[0].data_type, "text");

  const oneRow = await poolQuery("SELECT date_key FROM attendance WHERE date_key = '2027-01-01'");
  assert.strictEqual(oneRow[0].date_key, "2027-01-01");

  // Year boundaries compare lexicographically, exactly as the Mongo string
  // comparisons do (payrollController relies on this).
  const yearEnd = await attendanceRepository.findMany({
    filter: { dateKey: { $gte: "2026-12-31", $lte: "2027-01-01" } },
    sort: { dateKey: 1 },
  });
  assert.deepStrictEqual(yearEnd.map((d) => d.dateKey), ["2026-12-31", "2027-01-01"]);
});

test("attendance repository: instant fields round-trip timezone-sensitively and null is preserved", async () => {
  // Timestamps that fall on different UTC/local boundaries must keep their
  // exact instant, not a shifted local date.
  const instants = [
    new Date("2026-03-05T00:00:00.000Z"),
    new Date("2026-03-05T18:30:00.000Z"),
    new Date("2026-03-05T23:59:59.999Z"),
    new Date("2026-06-30T18:30:00.000Z"),
  ];
  for (const instant of instants) {
    const created = await attendanceRepository.create(attendanceBase({
      staffId: staffId("INSTANT"),
      checkInAt: instant,
      checkOutAt: null,
    }));
    assert.strictEqual(created.checkInAt.getTime(), instant.getTime(), "instant preserved");
    assert.strictEqual(created.checkOutAt, null, "null check-out is allowed");
    const read = await attendanceRepository.findById(created._id);
    assert.strictEqual(read.checkInAt.getTime(), instant.getTime());
    assert.strictEqual(read.checkOutAt, null);
  }
});

test("attendance repository: working/overtime durations round-trip exactly", async () => {
  const cases = [
    { workingMinutes: 0, overtimeMinutes: 0 },
    { workingMinutes: 480, overtimeMinutes: 90 },
    { workingMinutes: "465.5", overtimeMinutes: "0.25" },
    { workingMinutes: 30, overtimeMinutes: 1440 },
  ];
  for (const c of cases) {
    const created = await attendanceRepository.create(attendanceBase({
      staffId: staffId("DUR"),
      ...c,
    }));
    assert.strictEqual(created.workingMinutes, Number(c.workingMinutes));
    assert.strictEqual(created.overtimeMinutes, Number(c.overtimeMinutes));
  }

  // NUMERIC keeps fractional scale (no float representation).
  const created = await attendanceRepository.create(attendanceBase({
    staffId: "DUR-SCALE",
    workingMinutes: "465.25",
    overtimeMinutes: "90.5",
  }));
  const rows = await poolQuery(
    "SELECT working_minutes::text AS w, overtime_minutes::text AS o FROM attendance WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(rows[0].w, "465.25");
  assert.strictEqual(rows[0].o, "90.5");
});

// ─── Check-in / check-out flows ────────────────────────────────────────────
test("attendance service: check-in then check-out flows preserve the controller semantics", async () => {
  const id = staffId("FLOW");
  const day = dateKey(20);

  const payload = {
    staffId: id,
    staffName: "Flow Staff",
    dateKey: day,
    checkIn: "09:10 AM",
    checkInAt: new Date("2026-03-20T03:40:00.000Z"),
    status: "Pending",
    source: "biometric",
    isLateCheckIn: true,
    latitude: "12.9715987",
    longitude: "77.5945627",
    distanceFromTemple: "0",
    locationVerified: true,
    faceVerified: true,
    deviceInfo: "Pixel",
    browser: "Chrome",
    ipAddress: "10.0.0.9",
  };
  const checkedIn = await attendanceService.create(payload);
  assert.strictEqual(checkedIn.status, "Pending");
  assert.strictEqual(checkedIn.source, "biometric");
  assert.strictEqual(checkedIn.checkOut, "--");

  // A second check-in for the same staff/day patches the existing record
  // instead of creating a duplicate (the controller's update branch).
  const patched = await attendanceService.updateById(checkedIn._id, { checkInPhoto: "in.jpg" });
  assert.strictEqual(patched._id, checkedIn._id);
  assert.strictEqual(patched.checkInPhoto, "in.jpg");
  assert.strictEqual(patched.status, "Pending", "unrelated fields untouched");

  // Check-out: status is derived from the working duration by the controller and
  // written through the same patch path.
  const checkedOut = await attendanceService.updateById(checkedIn._id, {
    checkOut: "06:40 PM",
    checkOutAt: new Date("2026-03-20T13:10:00.000Z"),
    workingMinutes: 570,
    workingHours: "9h 30m",
    status: "Present",
    isOvertime: true,
    overtimeMinutes: 90,
    overtimeHours: "1h 30m",
  });
  assert.strictEqual(checkedOut.checkOut, "06:40 PM");
  assert.strictEqual(checkedOut.workingMinutes, 570);
  assert.strictEqual(checkedOut.overtimeMinutes, 90);
  assert.strictEqual(checkedOut.status, "Present");
  assert.strictEqual(checkedOut.checkIn, "09:10 AM", "check-in survives the check-out patch");

  // Half-day / absent derivations are plain status writes.
  const halfDay = await attendanceService.updateById(checkedIn._id, { status: "Half Day", workingMinutes: 300 });
  assert.strictEqual(halfDay.status, "Half Day");
  const absent = await attendanceService.updateById(checkedIn._id, { status: "Absent", workingMinutes: 60 });
  assert.strictEqual(absent.status, "Absent");
});

test("attendance repository: the admin-correction flow stamps correction fields and can clear times", async () => {
  const created = await attendanceRepository.create(attendanceBase({
    staffId: staffId("CORR"),
    checkIn: "09:00 AM",
    checkInAt: new Date("2026-03-05T03:30:00.000Z"),
    status: "Present",
    workingMinutes: 480,
  }));

  const corrected = await attendanceRepository.updateById(created._id, {
    checkIn: "--",
    checkInAt: null,
    workingMinutes: 0,
    workingHours: "--",
    correctedBy: "Admin",
    correctionDate: new Date("2026-03-06T04:00:00.000Z"),
    correctionReason: "Missed punch",
    source: "admin-correction",
  });

  assert.strictEqual(corrected.checkIn, "--");
  assert.strictEqual(corrected.checkInAt, null, "cleared instant stored as null");
  assert.strictEqual(corrected.workingMinutes, 0);
  assert.strictEqual(corrected.correctedBy, "Admin");
  assert.strictEqual(corrected.source, "admin-correction");
  assert.strictEqual(corrected.correctionReason, "Missed punch");
  assert.strictEqual(corrected.correctionDate.getTime(), new Date("2026-03-06T04:00:00.000Z").getTime());
  // checkOut was never supplied, so it keeps its stored default.
  assert.strictEqual(corrected.checkOut, "--");
});

// ── updateById semantics ──────────────────────────────────────────────────
test("attendance repository: updateById patches only supplied fields and refreshes updatedAt", async () => {
  const created = await attendanceRepository.create(attendanceBase({
    staffId: staffId("PATCH"),
    dutyName: "Original",
    note: "keep me",
    workingMinutes: 120,
  }));

  const updated = await attendanceRepository.updateById(created._id, { dutyName: "Changed" });
  assert.strictEqual(updated.dutyName, "Changed");
  assert.strictEqual(updated.note, "keep me", "unsupplied fields untouched");
  assert.strictEqual(updated.workingMinutes, 120);
  assert.strictEqual(updated.staffId, created.staffId);
  assert.ok(updated.updatedAt.getTime() >= created.updatedAt.getTime(), "updatedAt refreshed");

  assert.strictEqual(await attendanceRepository.updateById("000000000000000000000000", { note: "x" }), null);
  assert.strictEqual((await attendanceRepository.updateById(created._id, {})).note, "keep me");
  assert.strictEqual(await attendanceRepository.updateById(null, { note: "x" }), null);
});

// ─── Filtering / sorting / pagination ──────────────────────────────────────
test("attendance repository: identity $or lookups match the controller query shape", async () => {
  const empId = staffId("IDENT");
  const email = `${unique()}@example.com`;

  const byStaffId = await attendanceRepository.create(attendanceBase({
    staffId: empId, staffEmail: email, dateKey: dateKey(12), status: "Present",
  }));
  const byEmployeeId = await attendanceRepository.create(attendanceBase({
    staffId: staffId("OTHER"), employeeId: empId, staffEmail: `${unique()}@example.com`, dateKey: dateKey(12),
  }));
  await attendanceRepository.create(attendanceBase({
    staffId: staffId("NOPE"), staffEmail: `${unique()}@example.com`, dateKey: dateKey(12),
  }));

  // buildAttendanceQuery's shape: { dateKey, $or: [{staffId:$in},{employeeId:$in},{staffEmail:$in}] }
  const found = await attendanceRepository.findMany({
    filter: {
      dateKey: dateKey(12),
      $or: [
        { staffId: { $in: [empId, "unused"] } },
        { employeeId: { $in: [empId] } },
        { staffEmail: { $in: [email] } },
      ],
    },
  });
  const ids = found.map((d) => d._id).sort();
  assert.deepStrictEqual(ids, [byStaffId._id, byEmployeeId._id].sort());
  assert.strictEqual(found.length, 2, "the unrelated third record is excluded");

  // getAttendanceForAssignment's findOne shape is dateKey + the same $or.
  const one = await attendanceRepository.findOne({
    dateKey: dateKey(12),
    $or: [{ staffId: { $in: [empId] } }],
  });
  assert.strictEqual(one._id, byStaffId._id);
});

test("attendance repository: date-range and month queries return the same rows Mongo would", async () => {
  const id = staffId("RANGE");
  for (let day = 1; day <= 5; day += 1) {
    await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(day), status: "Present" }));
  }
  await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: "2026-04-01", status: "Present" }));

  const inRange = await attendanceRepository.findMany({
    filter: { staffId: id, dateKey: { $gte: dateKey(2), $lte: dateKey(4) } },
    sort: { dateKey: 1 },
  });
  assert.deepStrictEqual(inRange.map((d) => d.dateKey), [dateKey(2), dateKey(3), dateKey(4)]);

  // The payroll generator's monthly scan has no staff filter, so this reads the
  // whole month and must include exactly this staff's five March rows.
  const month = await attendanceRepository.findMany({
    filter: { dateKey: { $gte: "2026-03-01", $lte: "2026-03-31" } },
    sort: { dateKey: 1 },
  });
  const mine = month.filter((d) => d.staffId === id).map((d) => d.dateKey);
  assert.deepStrictEqual(mine, [dateKey(1), dateKey(2), dateKey(3), dateKey(4), dateKey(5)]);
  assert.ok(month.length >= 5, "the unfiltered monthly scan sees every March record");

  // April falls outside the March range.
  const april = await attendanceRepository.findMany({
    filter: { dateKey: { $gte: "2026-04-01", $lte: "2026-04-30" } },
  });
  assert.deepStrictEqual(april.map((d) => d.dateKey), ["2026-04-01"]);

  // Month boundaries are inclusive on both ends.
  const firstOfMarch = await attendanceRepository.findMany({ filter: { staffId: id, dateKey: "2026-03-01" } });
  assert.strictEqual(firstOfMarch.length, 1);
  assert.strictEqual(
    await attendanceRepository.count({ staffId: id, dateKey: { $gte: "2026-03-01", $lte: "2026-03-01" } }),
    firstOfMarch.length
  );
  assert.strictEqual(await attendanceRepository.count({ staffId: id, dateKey: { $gte: "2026-03-31", $lte: "2026-04-01" } }), 1);
});

test("attendance repository: status / shift / source / boolean filters and $in semantics", async () => {
  const id = staffId("FILTER");
  await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(21), status: "Present", shift: "Night", source: "biometric", isOvertime: true }));
  await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(22), status: "Leave", shift: "Morning", source: "manual" }));
  await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(23), status: "Half Day", shift: "Night", source: "manual" }));

  const nights = await attendanceRepository.findMany({ filter: { staffId: id, shift: "Night" }, sort: { dateKey: 1 } });
  assert.deepStrictEqual(nights.map((d) => d.dateKey), [dateKey(21), dateKey(23)]);

  const biometric = await attendanceRepository.findMany({ filter: { staffId: id, source: "biometric" } });
  assert.strictEqual(biometric.length, 1);
  assert.strictEqual(biometric[0].isOvertime, true);

  const presentOrLeave = await attendanceRepository.findMany({
    filter: { staffId: id, status: { $in: ["Present", "Leave"] } },
    sort: { dateKey: 1 },
  });
  assert.deepStrictEqual(presentOrLeave.map((d) => d.dateKey), [dateKey(21), dateKey(22)]);

  const overtimeOnly = await attendanceRepository.findMany({ filter: { staffId: id, isOvertime: true } });
  assert.strictEqual(overtimeOnly.length, 1);

  // Mongo $in: [] matches nothing.
  assert.strictEqual((await attendanceRepository.findMany({ filter: { staffId: id, status: { $in: [] } } })).length, 0);
  assert.strictEqual(await attendanceRepository.count({ staffId: id, status: { $in: [] } }), 0);

  // An undeclared status value is rejected before it reaches SQL.
  await assert.rejects(
    attendanceRepository.findMany({ filter: { status: "Vacation" } }),
    /Invalid status/
  );
  await assert.rejects(
    attendanceRepository.findMany({ filter: { status: { $in: ["Present", "Vacation"] } } }),
    /Invalid status/
  );
});

test("attendance repository: sorting honours the whitelist and pagination semantics", async () => {
  const id = staffId("SORT");
  for (const day of [3, 1, 5, 2, 4]) {
    await attendanceRepository.create(attendanceBase({ staffId: id, dateKey: dateKey(day), status: "Present" }));
  }

  // The dashboards' standing sort: { dateKey: -1, createdAt: -1 }.
  const desc = await attendanceRepository.findMany({ filter: { staffId: id }, sort: { dateKey: -1, createdAt: -1 } });
  assert.deepStrictEqual(desc.map((d) => d.dateKey), [dateKey(5), dateKey(4), dateKey(3), dateKey(2), dateKey(1)]);

  const asc = await attendanceRepository.findMany({ filter: { staffId: id }, sort: { dateKey: 1 } });
  assert.deepStrictEqual(asc.map((d) => d.dateKey), [dateKey(1), dateKey(2), dateKey(3), dateKey(4), dateKey(5)]);

  // Unknown sort keys fall back to the default ordering rather than injecting SQL.
  const unknown = await attendanceRepository.findMany({ filter: { staffId: id }, sort: { "; DROP TABLE attendance": -1 } });
  assert.strictEqual(unknown.length, 5);

  // Pagination used by the employee detail history (limit 100) and offset paging.
  const page1 = await attendanceRepository.findMany({ filter: { staffId: id }, sort: { dateKey: 1 }, limit: 2 });
  const page2 = await attendanceRepository.findMany({ filter: { staffId: id }, sort: { dateKey: 1 }, limit: 2, offset: 2 });
  const page3 = await attendanceRepository.findMany({ filter: { staffId: id }, sort: { dateKey: 1 }, limit: 2, offset: 4 });
  assert.deepStrictEqual(page1.map((d) => d.dateKey), [dateKey(1), dateKey(2)]);
  assert.deepStrictEqual(page2.map((d) => d.dateKey), [dateKey(3), dateKey(4)]);
  assert.deepStrictEqual(page3.map((d) => d.dateKey), [dateKey(5)]);

  assert.strictEqual(await attendanceRepository.count({ staffId: id }), 5);
  assert.strictEqual(await attendanceRepository.count({ staffId: "does-not-exist" }), 0);
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("attendance repository: no dual writes — Mongoose is never connected on the PG path", async () => {
  const before = await attendanceRepository.count({});
  await attendanceRepository.create(attendanceBase({ staffId: staffId("NODUAL") }));
  assert.strictEqual(await attendanceRepository.count({}), before + 1, "exactly one PG row");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
});

test("attendance service: a single create reaches exactly one datasource", async () => {
  assert.strictEqual(await attendanceService.usePostgres(), true);
  const before = await attendanceRepository.count({});
  const created = await attendanceService.create(attendanceBase({ staffId: staffId("ONEWRITE") }));
  const after = await attendanceRepository.count({});
  assert.strictEqual(after, before + 1);
  assert.strictEqual(mongoose.connection.readyState, 0);
  assert.ok(created._id);
});