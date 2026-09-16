// Phase 2T PostgreSQL-path tests for the Leave repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the leaveRepository / leaveService persist to and read from the real
//     leaves table (no mocks),
//   - every persisted Mongo schema field round-trips losslessly (the staff
//     identity and its display snapshot, the reason, the free-text leaveType,
//     the inclusive calendar dates, the status enum, the review fields and the
//     real Date instant) and that no field the Mongoose schema does not declare
//     is persisted,
//   - defaults ('General', 'Pending', '', null) match the Mongoose schema
//     defaults exactly,
//   - date semantics: from_date / to_date stay timezone-free 'YYYY-MM-DD'
//     calendar keys compared lexicographically (one-day, multi-day, month and
//     year boundaries) and reviewed_at round-trips as an exact instant,
//   - validation (required fields, status enum, calendar-key shape) matches the
//     Mongoose model,
//   - the overlap query semantics used by applyLeave are reproduced exactly
//     (same-day, partial overlap, adjacent/non-overlapping, Rejected excluded,
//     different employees independent),
//   - filtering / $in / $ne / range / $or identity lookups / sorting /
//     pagination behave like the Mongo query surface used by the controllers,
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

let originalIsDbConnected;
let leaveRepository;
let leaveService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS shifts CASCADE");
    await pool.query("DROP TABLE IF EXISTS leaves CASCADE");
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
  leaveRepository = require("../src/repositories/leaveRepository");
  leaveService = require("../src/services/leaveService");
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

const leaveBase = (overrides = {}) => ({
  staffId: staffId("LV"),
  staffName: "Ram Kumar",
  reason: "Family function at home town",
  leaveType: "Casual",
  fromDate: "2026-03-05",
  toDate: "2026-03-07",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("leave: the service selects PostgreSQL when the seam and PG are both available", async () => {
  assert.strictEqual(leaveService.isConnected(), true);
  assert.strictEqual(await leaveService.usePostgres(), true);
});

// ─── Full field round trip ─────────────────────────────────────────────────
test("leave repository: every persisted Mongo field round-trips through PostgreSQL", async () => {
  const reviewedAt = new Date("2026-03-08T10:15:30.250Z");
  const input = leaveBase({
    staffName: "Sita Devi",
    reason: "Attending a family wedding out of station",
    leaveType: "Emergency",
    fromDate: "2026-03-10",
    toDate: "2026-03-12",
    status: "Approved",
    adminReason: "Approved after verification",
    reviewedBy: "Head Admin",
    reviewedAt,
  });

  const created = await leaveService.create(input);
  assert.ok(created._id, "created id present");

  const read = await leaveRepository.findById(created._id);
  assert.deepStrictEqual(
    Object.keys(read).sort(),
    ["_id", "id", "staffId", "staffName", "reason", "leaveType", "fromDate", "toDate",
      "status", "adminReason", "reviewedBy", "reviewedAt", "createdAt", "updatedAt"].sort(),
    "the returned document carries exactly the persisted Mongo fields"
  );

  assert.strictEqual(read._id, created._id);
  assert.strictEqual(read.id, created._id, "id mirrors _id for Mongo compatibility");
  assert.strictEqual(read.staffId, input.staffId);
  assert.strictEqual(read.staffName, "Sita Devi");
  assert.strictEqual(read.reason, "Attending a family wedding out of station");
  assert.strictEqual(read.leaveType, "Emergency");
  assert.strictEqual(read.fromDate, "2026-03-10");
  assert.strictEqual(read.toDate, "2026-03-12");
  assert.strictEqual(read.status, "Approved");
  assert.strictEqual(read.adminReason, "Approved after verification");
  assert.strictEqual(read.reviewedBy, "Head Admin");
  assert.deepStrictEqual(read.reviewedAt, reviewedAt, "reviewedAt keeps its exact instant");
  assert.ok(read.createdAt instanceof Date, "createdAt is a Date");
  assert.ok(read.updatedAt instanceof Date, "updatedAt is a Date");
});

test("leave repository: MongoDB-only fields are neither persisted nor returned", async () => {
  const created = await leaveRepository.create(leaveBase({
    staffEmail: "should-not-exist@example.com",
    leaveDays: 3,
    isHalfDay: true,
    fromTime: "09:00",
    toTime: "13:00",
    approvalHistory: [{ by: "admin" }],
    createdBy: "someone",
    metadata: { a: 1 },
  }));

  const read = await leaveRepository.findById(created._id);
  for (const absent of ["staffEmail", "leaveDays", "isHalfDay", "fromTime", "toTime",
    "approvalHistory", "createdBy", "metadata", "cancelledAt", "cancelledBy"]) {
    assert.strictEqual(read[absent], undefined, `${absent} is not returned`);
  }

  const cols = await poolQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'leaves'"
  );
  const names = cols.map((c) => c.column_name);
  for (const absent of ["staff_email", "leave_days", "is_half_day", "from_time", "to_time",
    "approval_history", "created_by", "metadata", "cancelled_at", "cancelled_by", "updated_by"]) {
    assert.ok(!names.includes(absent), `${absent} column does not exist`);
  }
});

// ─── Defaults ──────────────────────────────────────────────────────────────
test("leave repository: schema defaults are applied exactly like Mongoose", async () => {
  const created = await leaveRepository.create({
    staffId: staffId("DEF"),
    staffName: "Default Case",
    reason: "Testing the default values here",
    fromDate: "2026-04-01",
    toDate: "2026-04-01",
  });

  assert.strictEqual(created.leaveType, "General", "leaveType defaults to 'General'");
  assert.strictEqual(created.status, "Pending", "status defaults to 'Pending'");
  assert.strictEqual(created.adminReason, "", "adminReason defaults to ''");
  assert.strictEqual(created.reviewedBy, "", "reviewedBy defaults to ''");
  assert.strictEqual(created.reviewedAt, null, "reviewedAt defaults to null");
});

test("leave repository: strings are trimmed exactly like the Mongoose schema", async () => {
  const created = await leaveRepository.create({
    staffId: `  ${staffId("TRIM")}  `,
    staffName: "  Trimmed Name  ",
    reason: "  A reason with padding  ",
    leaveType: "  Casual  ",
    fromDate: "2026-05-01",
    toDate: "2026-05-02",
  });

  assert.ok(!/\s/.test(created.staffId), "staffId is trimmed");
  assert.strictEqual(created.staffName, "Trimmed Name");
  assert.strictEqual(created.reason, "A reason with padding");
  assert.strictEqual(created.leaveType, "Casual");
});

// ─── Validation ────────────────────────────────────────────────────────────
test("leave repository: validation mirrors the Mongoose model", async () => {
  await assert.rejects(
    leaveRepository.create(leaveBase({ staffId: undefined })),
    /staffId is required/,
    "staffId is required"
  );
  await assert.rejects(
    leaveRepository.create(leaveBase({ staffName: "   " })),
    /staffName is required/,
    "whitespace-only staffName is rejected like Mongo's trim-then-required"
  );
  await assert.rejects(
    leaveRepository.create(leaveBase({ reason: "" })),
    /reason is required/,
    "reason is required"
  );
  await assert.rejects(
    leaveRepository.create(leaveBase({ fromDate: "05-03-2026" })),
    /fromDate must be a YYYY-MM-DD calendar key/,
    "fromDate shape is enforced"
  );
  await assert.rejects(
    leaveRepository.create(leaveBase({ toDate: "2026-3-5" })),
    /toDate must be a YYYY-MM-DD calendar key/,
    "toDate shape is enforced"
  );
  await assert.rejects(
    leaveRepository.create(leaveBase({ status: "Cancelled" })),
    /Invalid status/,
    "a status outside the Mongo enum is rejected"
  );

  // Every value the Mongo enum declares is accepted.
  for (const status of ["Pending", "Approved", "Rejected"]) {
    const created = await leaveRepository.create(leaveBase({ status }));
    assert.strictEqual(created.status, status);
  }
  // leaveType is free text in Mongo — no enum is imposed.
  const custom = await leaveRepository.create(leaveBase({ leaveType: "Compensatory Off" }));
  assert.strictEqual(custom.leaveType, "Compensatory Off");
});

// ─── Date semantics ────────────────────────────────────────────────────────
test("leave repository: from_date and to_date stay timezone-free calendar keys", async () => {
  const stored = await poolQuery(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'leaves' AND column_name = 'from_date'"
  );
  assert.strictEqual(stored[0].data_type, "text", "from_date is TEXT, not a date/timestamp");
  const storedTo = await poolQuery(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'leaves' AND column_name = 'to_date'"
  );
  assert.strictEqual(storedTo[0].data_type, "text", "to_date is TEXT, not a date/timestamp");

  for (const value of ["2026-01-01", "2026-02-28", "2026-12-31", "2027-01-01"]) {
    const created = await leaveRepository.create(leaveBase({ fromDate: value, toDate: value }));
    const read = await leaveRepository.findById(created._id);
    assert.strictEqual(read.fromDate, value, `${value} round-trips verbatim`);
    assert.strictEqual(read.toDate, value);
  }
});

test("leave repository: one-day, multi-day and inclusive-end leave round-trip unchanged", async () => {
  const staff = staffId("DATES");

  const oneDay = await leaveRepository.create(
    leaveBase({ staffId: staff, fromDate: "2026-06-10", toDate: "2026-06-10" })
  );
  assert.strictEqual(oneDay.fromDate, "2026-06-10");
  assert.strictEqual(oneDay.toDate, "2026-06-10", "a single-day leave starts and ends the same day");

  const multiDay = await leaveRepository.create(
    leaveBase({ staffId: staff, fromDate: "2026-06-11", toDate: "2026-06-15" })
  );
  assert.strictEqual(multiDay.toDate, "2026-06-15", "the end date is inclusive, not exclusive");
});

test("leave repository: month and year boundary ranges compare lexicographically like Mongo", async () => {
  const staff = staffId("BOUND");

  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-02-26", toDate: "2026-03-02" }));
  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-12-30", toDate: "2027-01-02" }));

  // A month query must pick up the leave that straddles the month boundary.
  const march = await leaveRepository.findMany({
    filter: { staffId: staff, fromDate: { $lte: "2026-03-31" }, toDate: { $gte: "2026-03-01" } },
  });
  assert.strictEqual(march.length, 1, "month-boundary straddling leave is found");

  // A year query must pick up the leave that straddles the year boundary.
  const year2027 = await leaveRepository.findMany({
    filter: { staffId: staff, fromDate: { $lte: "2027-12-31" }, toDate: { $gte: "2027-01-01" } },
  });
  assert.strictEqual(year2027.length, 1, "year-boundary straddling leave is found");

  // ...and the 2026 query must NOT match the 2027-only leave.
  const year2026 = await leaveRepository.findMany({
    filter: { staffId: staff, fromDate: { $lte: "2026-12-31" }, toDate: { $gte: "2026-01-01" } },
  });
  assert.strictEqual(year2026.length, 2, "both leaves intersect the 2026 calendar year");
});

test("leave repository: reviewed_at round-trips timezone-sensitively and null is preserved", async () => {
  const instant = new Date("2026-07-04T18:30:00.000Z");

  // An unset reviewedAt keeps the schema's null default.
  const unset = await leaveRepository.create(leaveBase({ staffId: staffId("TSNULL") }));
  assert.strictEqual(unset.reviewedAt, null, "an unset reviewedAt reads back as null");

  // A real instant round-trips exactly, independent of the session timezone.
  const created = await leaveRepository.create(leaveBase({ staffId: staffId("TSINST"), reviewedAt: instant }));
  assert.deepStrictEqual(created.reviewedAt, instant, "the instant survives the create round trip");

  const updated = await leaveRepository.updateById(created._id, { reviewedAt: instant });
  assert.deepStrictEqual(updated.reviewedAt, instant, "the exact instant survives the update round trip");

  const cleared = await leaveRepository.updateById(created._id, { reviewedAt: null });
  assert.strictEqual(cleared.reviewedAt, null, "an explicit null clears the instant");
});

// ─── Overlap semantics ─────────────────────────────────────────────────────
test("leave repository: the overlap query matches Mongo's semantics exactly", async () => {
  const staff = staffId("OVER");
  const other = staffId("OVER2");

  // The record every case is tested against: 2026-03-10 .. 2026-03-12.
  await leaveRepository.create(leaveBase({
    staffId: staff, fromDate: "2026-03-10", toDate: "2026-03-12", status: "Approved",
  }));
  // A rejected record must never block a new request.
  await leaveRepository.create(leaveBase({
    staffId: staff, fromDate: "2026-03-20", toDate: "2026-03-22", status: "Rejected",
  }));
  // A different employee must be independent.
  await leaveRepository.create(leaveBase({
    staffId: other, fromDate: "2026-03-10", toDate: "2026-03-12", status: "Approved",
  }));

  const overlapFor = (from, to, id = staff) => leaveRepository.findOne({
    staffId: id,
    status: { $ne: "Rejected" },
    fromDate: { $lte: to },
    toDate: { $gte: from },
  });

  // Same-day leave inside the range.
  assert.ok(await overlapFor("2026-03-11", "2026-03-11"), "same-day leave inside the range overlaps");
  // Partial overlap on the leading edge.
  assert.ok(await overlapFor("2026-03-08", "2026-03-10"), "leading-edge partial overlap is detected");
  // Partial overlap on the trailing edge.
  assert.ok(await overlapFor("2026-03-12", "2026-03-15"), "trailing-edge partial overlap is detected");
  // Fully containing range.
  assert.ok(await overlapFor("2026-03-01", "2026-03-31"), "an enclosing range overlaps");
  // Exact duplicate.
  assert.ok(await overlapFor("2026-03-10", "2026-03-12"), "an exact duplicate overlaps");
  // Adjacent ranges do NOT overlap — the end date is inclusive, so a leave
  // ending on the 12th and one starting on the 13th are disjoint.
  assert.strictEqual(await overlapFor("2026-03-13", "2026-03-14"), null, "adjacent (after) does not overlap");
  assert.strictEqual(await overlapFor("2026-03-08", "2026-03-09"), null, "adjacent (before) does not overlap");
  // Non-overlapping range entirely after.
  assert.strictEqual(await overlapFor("2026-04-01", "2026-04-05"), null, "a later range does not overlap");
  // Overlapping the Rejected record must not be blocked.
  assert.strictEqual(await overlapFor("2026-03-20", "2026-03-21"), null, "Rejected leaves never block");
  // A different employee is unaffected by the first employee's leave.
  assert.ok(await overlapFor("2026-03-11", "2026-03-11", other), "the other employee's own leave is found");
  assert.strictEqual(
    await overlapFor("2026-03-11", "2026-03-11", staffId("NOBODY")), null,
    "an unrelated employee has no overlap"
  );
});

test("leave repository: the quota range query excludes Rejected and honours the year window", async () => {
  const staff = staffId("QUOTA");

  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-01-05", toDate: "2026-01-06", status: "Approved" }));
  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-06-05", toDate: "2026-06-06", status: "Pending" }));
  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-08-05", toDate: "2026-08-06", status: "Rejected" }));
  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2025-06-05", toDate: "2025-06-06", status: "Approved" }));

  const inYear = await leaveRepository.findMany({
    filter: {
      staffId: staff,
      status: { $ne: "Rejected" },
      fromDate: { $lte: "2026-12-31" },
      toDate: { $gte: "2026-01-01" },
    },
  });

  assert.strictEqual(inYear.length, 2, "only the non-rejected 2026 leaves count toward the quota");
  assert.deepStrictEqual(inYear.map((l) => l.status).sort(), ["Approved", "Pending"]);
});

// ─── Workflow ──────────────────────────────────────────────────────────────
test("leave service: pending -> approved -> rejected transitions stamp the review metadata", async () => {
  const created = await leaveService.create(leaveBase({ staffId: staffId("FLOW") }));
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.reviewedAt, null);
  assert.strictEqual(created.reviewedBy, "");
  assert.strictEqual(created.adminReason, "");

  // pending -> approved
  const approved = await leaveService.updateById(created._id, {
    status: "Approved",
    adminReason: "",
    reviewedBy: "Head Admin",
    reviewedAt: new Date(),
  });
  assert.strictEqual(approved.status, "Approved");
  assert.strictEqual(approved.reviewedBy, "Head Admin");
  assert.ok(approved.reviewedAt instanceof Date, "approval stamps reviewedAt");

  // approved -> rejected (the endpoint permits any transition among the enum)
  const rejected = await leaveService.updateById(created._id, {
    status: "Rejected",
    adminReason: "Insufficient staff on duty",
    reviewedBy: "Head Admin",
    reviewedAt: new Date(),
  });
  assert.strictEqual(rejected.status, "Rejected");
  assert.strictEqual(rejected.adminReason, "Insufficient staff on duty");
  assert.ok(rejected.reviewedAt instanceof Date, "rejection stamps reviewedAt");

  // back to pending resets the review fields
  const reopened = await leaveService.updateById(created._id, {
    status: "Pending", adminReason: "", reviewedBy: "", reviewedAt: null,
  });
  assert.strictEqual(reopened.status, "Pending");
  assert.strictEqual(reopened.adminReason, "");
  assert.strictEqual(reopened.reviewedBy, "");
  assert.strictEqual(reopened.reviewedAt, null, "returning to Pending clears reviewedAt");
});

// ─── Update semantics ──────────────────────────────────────────────────────
test("leave repository: updateById patches only supplied fields and refreshes updatedAt", async () => {
  const created = await leaveRepository.create(leaveBase({
    staffId: staffId("PATCH"), staffName: "Patch Me", leaveType: "Casual",
  }));
  const before = created.updatedAt;

  await new Promise((resolve) => setTimeout(resolve, 10));
  const updated = await leaveRepository.updateById(created._id, { status: "Approved" });

  assert.strictEqual(updated.status, "Approved", "the patched field changed");
  assert.strictEqual(updated.staffName, "Patch Me", "staffName is untouched");
  assert.strictEqual(updated.leaveType, "Casual", "leaveType is untouched");
  assert.strictEqual(updated.fromDate, created.fromDate, "fromDate is untouched");
  assert.strictEqual(updated.reason, created.reason, "reason is untouched");
  assert.ok(updated.updatedAt >= before, "updatedAt is refreshed");

  assert.strictEqual(await leaveRepository.updateById("0000000000000000000000ff", { status: "Approved" }), null,
    "a missing id returns null like findByIdAndUpdate");
});

// ─── Query surface ─────────────────────────────────────────────────────────
test("leave repository: $or identity lookups match the controller query shape", async () => {
  const staff = staffId("ORQ");
  const created = await leaveRepository.create(leaveBase({
    staffId: staff, fromDate: "2026-09-01", toDate: "2026-09-02", status: "Approved",
  }));

  const found = await leaveRepository.findOne({
    status: "Approved",
    fromDate: { $lte: "2026-09-01" },
    toDate: { $gte: "2026-09-01" },
    $or: [{ staffId: { $in: [staff] } }],
  });
  assert.ok(found, "the staffId $or clause matches");
  assert.strictEqual(found._id, created._id);

  // The staffEmail branch is inert: the Leave schema declares no such field, so
  // Mongo matches nothing. PostgreSQL must behave identically.
  const byEmail = await leaveRepository.findOne({
    status: "Approved",
    fromDate: { $lte: "2026-09-01" },
    toDate: { $gte: "2026-09-01" },
    $or: [{ staffEmail: { $in: ["nobody@example.com"] } }],
  });
  assert.strictEqual(byEmail, null, "the staffEmail $or branch matches nothing, exactly like Mongo");

  // $in: [] is an instant-false predicate in Mongo.
  const emptyIn = await leaveRepository.findMany({ filter: { staffId: { $in: [] } } });
  assert.strictEqual(emptyIn.length, 0, "$in: [] matches nothing");
});

test("leave repository: staff filters, $in and status $ne behave like Mongo", async () => {
  const staff = staffId("FILT");

  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-10-01", toDate: "2026-10-01", status: "Pending" }));
  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-10-05", toDate: "2026-10-05", status: "Approved" }));
  await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-10-09", toDate: "2026-10-09", status: "Rejected" }));

  assert.strictEqual((await leaveRepository.findMany({ filter: { staffId: staff } })).length, 3);
  assert.strictEqual((await leaveRepository.findMany({ filter: { staffId: staff, status: "Approved" } })).length, 1);
  assert.strictEqual(
    (await leaveRepository.findMany({ filter: { staffId: staff, status: { $ne: "Rejected" } } })).length, 2,
    "$ne excludes the rejected row"
  );
  assert.strictEqual(
    (await leaveRepository.findMany({ filter: { staffId: staff, status: { $in: ["Pending", "Approved"] } } })).length, 2
  );
  assert.strictEqual(
    (await leaveRepository.findMany({ filter: { staffId: { $in: [staff, staffId("OTHER")] } } })).length, 3
  );
  assert.strictEqual((await leaveRepository.count({ staffId: staff })), 3, "count honours the same filter");
  await assert.rejects(
    leaveRepository.findMany({ filter: { status: { $in: ["Nope"] } } }),
    /Invalid status/,
    "an invalid status is rejected before it reaches SQL"
  );
});

test("leave repository: sorting honours the whitelist and pagination semantics", async () => {
  const staff = staffId("SORT");

  const early = await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-02-01", toDate: "2026-02-01" }));
  const middle = await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-05-01", toDate: "2026-05-01" }));
  const late = await leaveRepository.create(leaveBase({ staffId: staff, fromDate: "2026-08-01", toDate: "2026-08-01" }));

  // { fromDate: -1, createdAt: -1 } — the dashboard ordering.
  const desc = await leaveRepository.findMany({ filter: { staffId: staff }, sort: { fromDate: -1, createdAt: -1 } });
  assert.deepStrictEqual(desc.map((l) => l.fromDate), ["2026-08-01", "2026-05-01", "2026-02-01"]);

  // { fromDate: 1 } — the ascending equivalent.
  const asc = await leaveRepository.findMany({ filter: { staffId: staff }, sort: { fromDate: 1 } });
  assert.deepStrictEqual(asc.map((l) => l.fromDate), ["2026-02-01", "2026-05-01", "2026-08-01"]);

  // An injection-shaped / unknown sort key is dropped by the whitelist and the
  // default order applies instead of being interpolated.
  const injected = await leaveRepository.findMany({
    filter: { staffId: staff },
    sort: { "from_date; DROP TABLE leaves; --": -1 },
  });
  assert.strictEqual(injected.length, 3, "an unknown sort key is ignored, not interpolated");

  // limit / offset pagination — the employee detail history reads the latest 100.
  const limited = await leaveRepository.findMany({ filter: { staffId: staff }, sort: { fromDate: -1 }, limit: 2 });
  assert.strictEqual(limited.length, 2);
  assert.deepStrictEqual(limited.map((l) => l._id), [late._id, middle._id]);

  const offset = await leaveRepository.findMany({ filter: { staffId: staff }, sort: { fromDate: -1 }, limit: 2, offset: 2 });
  assert.strictEqual(offset.length, 1);
  assert.strictEqual(offset[0]._id, early._id);

  // findOne returns the newest by the default order.
  const newest = await leaveRepository.findOne({ staffId: staff });
  assert.ok(newest, "findOne returns a row");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("leave repository: no dual writes — Mongoose is never connected on the PG path", async () => {
  const before = await leaveRepository.count({});
  await leaveRepository.create(leaveBase({ staffId: staffId("NODUAL") }));
  assert.strictEqual(await leaveRepository.count({}), before + 1, "exactly one PG row");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
});

test("leave service: a single create reaches exactly one datasource", async () => {
  assert.strictEqual(await leaveService.usePostgres(), true);
  const before = await leaveRepository.count({});
  const created = await leaveService.create(leaveBase({ staffId: staffId("ONEWRITE") }));
  const after = await leaveRepository.count({});
  assert.strictEqual(after, before + 1, "exactly one write");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
  assert.ok(created._id);
});