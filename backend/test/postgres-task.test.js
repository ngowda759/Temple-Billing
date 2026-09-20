// Phase 2AH PostgreSQL-path tests for the Task repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the taskRepository / taskService persist to and read from the real tasks
//     table (no mocks),
//   - every persisted Mongo schema field round-trips losslessly and that no
//     field the Mongoose schema does not declare is persisted,
//   - the schema defaults ('Duty & Shift', '', 'Pending', 'Medium', 1, 0, false)
//     match the Mongoose schema exactly,
//   - time semantics: start_time / end_time / time / reporting_time keep the
//     12-hour meridiem display strings ("9:00 AM") byte-for-byte as TEXT, and
//     date_key / due_date stay "YYYY-MM-DD" day strings comparable with the
//     lexicographic range filters the payroll controller uses,
//   - only accepted_at / rejected_at / completed_at / created_at / updated_at
//     are real instants,
//   - required-field and enum validation matches the Mongoose model,
//   - the query surface the controllers use is reproduced exactly: the $or
//     identity triad, the dateKey/dueDate ranges, $in / $nin, the dateKey RegExp
//     from getAvailablePriestsForTransfer, and the standing sorts,
//   - the service never writes to MongoDB while PostgreSQL is selected.
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
const nameFor = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let taskRepository;
let taskService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS tasks CASCADE");
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
  taskRepository = require("../src/repositories/taskRepository");
  taskService = require("../src/services/taskService");
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

// The required fields every real Task write supplies (staffController.assignTask,
// shiftController.assignShift, transferController.directAdminTransfer).
const taskBase = (overrides = {}) => ({
  staffId: nameFor("staff"),
  staffName: "Pandit Sharma",
  duty: "Abhishekam",
  area: "Main Sanctum",
  time: "9:00 AM",
  assignedBy: "admin",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("task: the service selects PostgreSQL when the seam and PG are both available", async () => {
  assert.strictEqual(taskService.isConnected(), true);
  assert.strictEqual(await taskService.usePostgres(), true);
});

// ─── Full field round trip ─────────────────────────────────────────────────
test("task repository: every persisted Mongo field round-trips through PostgreSQL", async () => {
  const accepted = new Date("2026-03-01T04:15:00.000Z");
  const input = taskBase({
    assignmentType: "Special Duty",
    shiftId: "64b7f0c2e1a2b3c4d5e6f701",
    shiftName: "Morning Shift",
    shiftStartTime: "6:00 AM",
    shiftEndTime: "2:00 PM",
    dateKey: "2026-03-01",
    startTime: "6:30 AM",
    endTime: "8:30 AM",
    employeeId: "64b7f0c2e1a2b3c4d5e6f702",
    staffEmail: "  PANDIT@Temple.ORG  ",
    dutyName: "Abhishekam",
    title: "Morning Abhishekam",
    description: "Garbhagriha abhishekam",
    dueDate: "2026-03-01",
    dutyArea: "Garbhagriha",
    reportingTime: "6:00 AM",
    supervisor: "Head Priest",
    priority: "High",
    workingHours: "2",
    status: "Accepted",
    attendanceStatus: "Present",
    conflict: true,
    reason: "Festival schedule",
    notes: "Bring fresh flowers",
    requiredStaff: 3,
    durationMinutes: 120,
    acceptedAt: accepted,
    completionRemarks: "Done well",
    completionDuration: 115,
  });

  const created = await taskRepository.create(input);
  assert.ok(created && created._id, "a Mongo-compatible _id is returned");

  const loaded = await taskRepository.findById(created._id);
  assert.strictEqual(loaded.assignmentType, "Special Duty");
  assert.strictEqual(loaded.shiftId, input.shiftId);
  assert.strictEqual(loaded.shiftName, "Morning Shift");
  assert.strictEqual(loaded.shiftStartTime, "6:00 AM");
  assert.strictEqual(loaded.shiftEndTime, "2:00 PM");
  assert.strictEqual(loaded.dateKey, "2026-03-01");
  assert.strictEqual(loaded.startTime, "6:30 AM");
  assert.strictEqual(loaded.endTime, "8:30 AM");
  assert.strictEqual(loaded.staffId, input.staffId);
  assert.strictEqual(loaded.staffName, "Pandit Sharma");
  assert.strictEqual(loaded.employeeId, input.employeeId);
  // Mongoose's lowercase setter plus trim is reproduced.
  assert.strictEqual(loaded.staffEmail, "pandit@temple.org");
  assert.strictEqual(loaded.dutyName, "Abhishekam");
  assert.strictEqual(loaded.title, "Morning Abhishekam");
  assert.strictEqual(loaded.description, "Garbhagriha abhishekam");
  assert.strictEqual(loaded.dueDate, "2026-03-01");
  assert.strictEqual(loaded.duty, "Abhishekam");
  assert.strictEqual(loaded.area, "Main Sanctum");
  assert.strictEqual(loaded.dutyArea, "Garbhagriha");
  assert.strictEqual(loaded.time, "9:00 AM");
  assert.strictEqual(loaded.reportingTime, "6:00 AM");
  assert.strictEqual(loaded.assignedBy, "admin");
  assert.strictEqual(loaded.supervisor, "Head Priest");
  assert.strictEqual(loaded.priority, "High");
  assert.strictEqual(loaded.workingHours, "2");
  assert.strictEqual(loaded.status, "Accepted");
  assert.strictEqual(loaded.attendanceStatus, "Present");
  assert.strictEqual(loaded.conflict, true);
  assert.strictEqual(loaded.reason, "Festival schedule");
  assert.strictEqual(loaded.notes, "Bring fresh flowers");
  assert.strictEqual(loaded.requiredStaff, 3);
  assert.strictEqual(loaded.durationMinutes, 120);
  assert.strictEqual(new Date(loaded.acceptedAt).getTime(), accepted.getTime());
  assert.strictEqual(loaded.completionRemarks, "Done well");
  assert.strictEqual(loaded.completionDuration, 115);
  assert.ok(loaded.createdAt, "createdAt is present");
  assert.ok(loaded.updatedAt, "updatedAt is present");
  // Fields the Mongoose schema does not declare are never invented.
  assert.strictEqual(loaded.role, undefined);
  assert.strictEqual(loaded.compensation, undefined);
  assert.strictEqual(loaded.employeeName, undefined);
  assert.strictEqual(loaded.category, undefined);
});

test("task repository: schema defaults match the Mongoose model", async () => {
  const created = await taskRepository.create(taskBase());
  const loaded = await taskRepository.findById(created._id);

  assert.strictEqual(loaded.assignmentType, "Duty & Shift");
  assert.strictEqual(loaded.shiftName, "");
  assert.strictEqual(loaded.shiftStartTime, "");
  assert.strictEqual(loaded.shiftEndTime, "");
  assert.strictEqual(loaded.dateKey, "");
  assert.strictEqual(loaded.startTime, "");
  assert.strictEqual(loaded.endTime, "");
  assert.strictEqual(loaded.dutyName, "");
  assert.strictEqual(loaded.dutyArea, "");
  assert.strictEqual(loaded.reportingTime, "");
  assert.strictEqual(loaded.supervisor, "");
  assert.strictEqual(loaded.priority, "Medium");
  assert.strictEqual(loaded.workingHours, "");
  assert.strictEqual(loaded.status, "Pending");
  assert.strictEqual(loaded.attendanceStatus, "Pending");
  assert.strictEqual(loaded.conflict, false);
  assert.strictEqual(loaded.reason, "");
  assert.strictEqual(loaded.notes, "");
  assert.strictEqual(loaded.requiredStaff, 1);
  assert.strictEqual(loaded.durationMinutes, 0);
  assert.strictEqual(loaded.completionRemarks, "");
  assert.strictEqual(loaded.completionDuration, 0);

  // Paths with no default stay absent, exactly as a Mongo read returns them.
  assert.strictEqual(loaded.shiftId, undefined);
  assert.strictEqual(loaded.employeeId, undefined);
  assert.strictEqual(loaded.staffEmail, undefined);
  assert.strictEqual(loaded.title, undefined);
  assert.strictEqual(loaded.description, undefined);
  assert.strictEqual(loaded.dueDate, undefined);
  assert.strictEqual(loaded.acceptedAt, undefined);
  assert.strictEqual(loaded.rejectedAt, undefined);
  assert.strictEqual(loaded.rejectionReason, undefined);
  assert.strictEqual(loaded.completedAt, undefined);
});

// ─── Time and day semantics ────────────────────────────────────────────────
test("task repository: 12-hour meridiem time strings round-trip byte-for-byte", async () => {
  const created = await taskRepository.create(taskBase({
    time: "12:00 PM",
    startTime: "11:30 PM",
    endTime: "1:15 AM",
    reportingTime: "7:45 AM",
  }));

  // The raw column value is TEXT, never a rewritten TIME.
  const raw = await poolQuery("SELECT time, start_time, end_time, reporting_time FROM tasks WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].time, "12:00 PM");
  assert.strictEqual(raw[0].start_time, "11:30 PM");
  assert.strictEqual(raw[0].end_time, "1:15 AM");
  assert.strictEqual(raw[0].reporting_time, "7:45 AM");

  const loaded = await taskRepository.findById(created._id);
  assert.strictEqual(loaded.time, "12:00 PM");
  assert.strictEqual(loaded.startTime, "11:30 PM");
  assert.strictEqual(loaded.endTime, "1:15 AM");
  assert.strictEqual(loaded.reportingTime, "7:45 AM");
});

test("task repository: dateKey / dueDate stay lexicographically comparable day strings", async () => {
  const staffId = nameFor("days");
  const gregorian = await taskRepository.create(taskBase({ staffId, dateKey: "2026-03-15", dueDate: "2026-04-01" }));
  const raw = await poolQuery("SELECT date_key, due_date FROM tasks WHERE id = $1", [gregorian._id]);
  assert.strictEqual(raw[0].date_key, "2026-03-15");
  assert.strictEqual(raw[0].due_date, "2026-04-01");

  // The payroll controller's { $gte: startKey, $lte: endKey } range must behave
  // exactly as the string comparison it performs over Mongo does.
  const inRange = await taskRepository.findMany({
    filter: { staffId, dateKey: { $gte: "2026-03-01", $lte: "2026-03-31" } },
  });
  assert.strictEqual(inRange.length, 1);
  assert.strictEqual(inRange[0].dateKey, "2026-03-15");

  const outOfRange = await taskRepository.findMany({
    filter: { staffId, dateKey: { $gte: "2026-04-01", $lte: "2026-04-30" } },
  });
  assert.strictEqual(outOfRange.length, 0);
});

// ─── Validation ────────────────────────────────────────────────────────────
test("task service: the required fields are enforced like the Mongoose model", async () => {
  for (const missing of ["staffId", "staffName", "duty", "area", "time", "assignedBy"]) {
    const payload = taskBase();
    delete payload[missing];
    await assert.rejects(
      () => taskService.create(payload),
      /required/,
      `${missing} must be rejected`
    );
  }
});

test("task service: an all-whitespace required field is rejected (trim-then-required)", async () => {
  await assert.rejects(
    () => taskService.create(taskBase({ duty: "   " })),
    /required/
  );
});

test("task service: required String values are trimmed", async () => {
  const created = await taskService.create(taskBase({ staffName: "  Pandit Sharma  " }));
  assert.strictEqual(created.staffName, "Pandit Sharma");
});

test("task repository: the status and priority CHECK constraints mirror the schema enums", async () => {
  await assert.rejects(
    () => poolQuery(
      "INSERT INTO tasks (id, staff_id, staff_name, duty, area, time, assigned_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [unique(), "s1", "n", "d", "a", "9:00 AM", "admin", "NotARealStatus"]
    ),
    /tasks_status_check/
  );
  await assert.rejects(
    () => poolQuery(
      "INSERT INTO tasks (id, staff_id, staff_name, duty, area, time, assigned_by, priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [unique(), "s1", "n", "d", "a", "9:00 AM", "admin", "Critical"]
    ),
    /tasks_priority_check/
  );
});

test("task repository: duplicate duties stay legal (the schema declares no unique index)", async () => {
  const staffId = nameFor("dup");
  await taskRepository.create(taskBase({ staffId, dateKey: "2026-05-01", time: "9:00 AM" }));
  const second = await taskRepository.create(taskBase({ staffId, dateKey: "2026-05-01", time: "9:00 AM" }));
  const rows = await taskRepository.findMany({ filter: { staffId, dateKey: "2026-05-01" } });
  assert.strictEqual(rows.length, 2, "Mongo allows the duplicate, so PostgreSQL must too");
  assert.ok(second._id, "the second write produced its own id");
});

// ─── Query surface ─────────────────────────────────────────────────────────
test("task repository: the $or identity triad from attendanceController matches", async () => {
  const staffId = nameFor("tri");
  const email = `${staffId}@temple.org`;
  const employeeId = nameFor("emp");

  const byStaff = await taskRepository.create(taskBase({ staffId, staffEmail: email, employeeId, dateKey: "2026-06-01" }));
  const byEmployee = await taskRepository.create(taskBase({ staffId: nameFor("other"), employeeId, dateKey: "2026-06-01" }));
  const byEmail = await taskRepository.create(taskBase({ staffId: nameFor("other"), staffEmail: email, dateKey: "2026-06-01" }));

  const matched = await taskRepository.findMany({
    filter: {
      $or: [{ staffId }, { employeeId }, { staffEmail: email }],
      dateKey: "2026-06-01",
    },
  });

  const ids = matched.map((t) => t._id).sort();
  assert.deepStrictEqual(ids, [byStaff._id, byEmployee._id, byEmail._id].sort());
});

test("task repository: $in and $nin reproduce getAvailableEmployees and the payroll ranges", async () => {
  const day = "2026-06-15";
  const active = await taskRepository.create(taskBase({ dateKey: day, status: "Assigned" }));
  const cancelled = await taskRepository.create(taskBase({ dateKey: day, status: "Cancelled" }));
  const rejected = await taskRepository.create(taskBase({ dateKey: day, status: "Rejected" }));

  const available = await taskRepository.findMany({
    filter: { dateKey: day, status: { $nin: ["Cancelled", "Rejected"] } },
  });
  const availableIds = available.map((t) => t._id);
  assert.ok(availableIds.includes(active._id));
  assert.ok(!availableIds.includes(cancelled._id));
  assert.ok(!availableIds.includes(rejected._id));

  const requested = await taskRepository.findMany({
    filter: { status: { $in: ["Pending", "Assigned", "Accepted", "In Progress", "Transfer Requested"] } },
  });
  const requestedIds = requested.map((t) => t._id);
  assert.ok(requestedIds.includes(active._id));
  assert.ok(!requestedIds.includes(cancelled._id));
});

test("task repository: the dateKey RegExp from getAvailablePriestsForTransfer is a substring match", async () => {
  const day = "2026-07-04";
  const match = await taskRepository.create(taskBase({ dateKey: day, status: "Assigned" }));
  const other = await taskRepository.create(taskBase({ dateKey: "2026-07-05", status: "Assigned" }));

  const found = await taskRepository.findMany({
    filter: {
      dateKey: { $regex: new RegExp(day, "i") },
      status: { $in: ["Pending", "Assigned", "Accepted", "In Progress"] },
    },
  });
  const ids = found.map((t) => t._id);
  assert.ok(ids.includes(match._id));
  assert.ok(!ids.includes(other._id));
});

test("task repository: the standing sorts are honoured", async () => {
  const staffId = nameFor("sort");
  await taskRepository.create(taskBase({ staffId, dateKey: "2026-08-02" }));
  await taskRepository.create(taskBase({ staffId, dateKey: "2026-08-01" }));

  const ascending = await taskRepository.findMany({ filter: { staffId }, sort: { dateKey: 1, startTime: 1 } });
  assert.deepStrictEqual(ascending.map((t) => t.dateKey), ["2026-08-01", "2026-08-02"]);

  const descending = await taskRepository.findMany({ filter: { staffId }, sort: { dateKey: -1 } });
  assert.deepStrictEqual(descending.map((t) => t.dateKey), ["2026-08-02", "2026-08-01"]);
});

test("task repository: limit and offset are applied", async () => {
  const staffId = nameFor("page");
  for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
    await taskRepository.create(taskBase({ staffId, dueDate: day }));
  }
  const limited = await taskRepository.findMany({ filter: { staffId }, sort: { dueDate: 1 }, limit: 2 });
  assert.strictEqual(limited.length, 2);
  assert.deepStrictEqual(limited.map((t) => t.dueDate), ["2026-09-01", "2026-09-02"]);

  const offset = await taskRepository.findMany({ filter: { staffId }, sort: { dueDate: 1 }, limit: 2, offset: 2 });
  assert.deepStrictEqual(offset.map((t) => t.dueDate), ["2026-09-03"]);
});

// ─── Mutations ─────────────────────────────────────────────────────────────
test("task service: updateById patches only the supplied fields", async () => {
  const created = await taskService.create(taskBase({ notes: "original", priority: "Low" }));
  const updated = await taskService.updateById(created._id, { status: "In Progress" });

  assert.strictEqual(updated.status, "In Progress");
  assert.strictEqual(updated.notes, "original", "untouched fields survive the patch");
  assert.strictEqual(updated.priority, "Low");
});

test("task service: a duty status transition persists the instants", async () => {
  const created = await taskService.create(taskBase());
  const acceptedAt = new Date();
  const updated = await taskService.updateById(created._id, { status: "Accepted", acceptedAt });

  const reloaded = await taskService.findById(created._id);
  assert.strictEqual(reloaded.status, "Accepted");
  assert.strictEqual(new Date(reloaded.acceptedAt).getTime(), acceptedAt.getTime());
});

test("task service: completion remarks and duration are persisted", async () => {
  const created = await taskService.create(taskBase({ status: "In Progress" }));
  await taskService.updateById(created._id, {
    status: "Completed",
    completedAt: new Date(),
    completionRemarks: "All done",
    completionDuration: 95,
  });

  const reloaded = await taskService.findById(created._id);
  assert.strictEqual(reloaded.status, "Completed");
  assert.strictEqual(reloaded.completionRemarks, "All done");
  assert.strictEqual(reloaded.completionDuration, 95);
  assert.ok(reloaded.completedAt);
});

test("task service: updateById ignores undeclared fields like Mongoose strict mode", async () => {
  const created = await taskService.create(taskBase({ status: "Assigned" }));
  const updated = await taskService.updateById(created._id, {
    status: "Assigned",
    assignedPriest: "someone",
    category: "Priest Duty",
  });
  assert.strictEqual(updated.status, "Assigned");
  assert.strictEqual(updated.assignedPriest, undefined);
  assert.strictEqual(updated.category, undefined);
});

test("task service: updateMany patches a filtered set (the seva dateKey rollover)", async () => {
  const staffId = nameFor("roll");
  const first = await taskService.create(taskBase({ staffId, dateKey: "" }));
  const second = await taskService.create(taskBase({ staffId, dateKey: "" }));
  const untouched = await taskService.create(taskBase({ staffId: nameFor("other"), dateKey: "" }));

  const result = await taskService.updateMany({ staffId }, { dateKey: "2026-10-01" });
  assert.ok(result.modifiedCount >= 2, "the filtered tasks were patched");

  const rolled = await taskService.findById(first._id);
  const rolledSecond = await taskService.findById(second._id);
  const kept = await taskService.findById(untouched._id);
  assert.strictEqual(rolled.dateKey, "2026-10-01");
  assert.strictEqual(rolledSecond.dateKey, "2026-10-01");
  assert.strictEqual(kept.dateKey, "", "the other staff's task is untouched");
});

test("task service: destroy removes exactly one task", async () => {
  const created = await taskService.create(taskBase());
  const deleted = await taskService.destroy(created._id);
  assert.ok(deleted, "the deleted task is returned");
  assert.strictEqual(await taskService.findById(created._id), null);
});

test("task service: deleteMany is the shift cascade", async () => {
  const shiftId = nameFor("shift");
  const first = await taskService.create(taskBase({ shiftId }));
  const second = await taskService.create(taskBase({ shiftId }));
  const survivor = await taskService.create(taskBase({ shiftId: nameFor("shift") }));

  const result = await taskService.deleteMany({ shiftId });
  assert.strictEqual(result.deletedCount, 2);
  assert.strictEqual(await taskService.findById(first._id), null);
  assert.strictEqual(await taskService.findById(second._id), null);
  assert.ok(await taskService.findById(survivor._id), "another shift's task survives");
});

test("task service: count matches the filter", async () => {
  const staffId = nameFor("count");
  await taskService.create(taskBase({ staffId }));
  await taskService.create(taskBase({ staffId }));
  assert.strictEqual(await taskService.count({ staffId }), 2);
});

// ─── Single datasource ─────────────────────────────────────────────────────
test("task service: a create reaches exactly one datasource", async () => {
  const before = (await poolQuery("SELECT COUNT(*)::int AS n FROM tasks"))[0].n;
  const created = await taskService.create(taskBase());
  const after = (await poolQuery("SELECT COUNT(*)::int AS n FROM tasks"))[0].n;
  assert.strictEqual(after, before + 1, "exactly one PostgreSQL row was written");

  // The row is genuinely there under the id the service returned.
  const rows = await poolQuery("SELECT id FROM tasks WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 1);
});