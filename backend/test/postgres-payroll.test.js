// Phase 2V PostgreSQL tests for the Payroll (PayrollRecord) repository and
// service, plus the payroll calculation and workflow behavior the controller
// already had.
//
// These tests exercise the real PostgreSQL path: the service's datasource seam
// is pinned to "connected" and DATABASE_URL points at the test database, so
// every operation below goes through the real payrollRepository and the real
// payroll_records table. They verify:
//   - the complete Mongo → PostgreSQL field mapping (every persisted field),
//   - nullability and the schema's own defaults,
//   - financial round-trips (zero, integers, decimals, large values) with no
//     floating-point comparison and no silent rounding,
//   - the payroll period semantics and the employee+period uniqueness the Mongo
//     compound unique index declares,
//   - workflow transitions (Pending → Paid) and that payment metadata survives,
//   - the calculation inputs the controller derives (allowances/deductions/
//     overtime/bonus/net) are stored and returned unchanged,
//   - filtering, sorting and pagination,
//   - no dual writes (a PG operation never touches Mongo),
//   - the datasource seam genuinely selects both paths.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const PayrollRecord = require("../src/models/PayrollRecord");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "db", "migrations");
const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");

let originalIsDbConnected;
let payrollService;
let payrollRepository;

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
  await pgQuery("DROP TABLE IF EXISTS payroll_records CASCADE");
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
  payrollService = require("../src/services/payrollService");
  payrollRepository = require("../src/repositories/payrollRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// A complete payload matching what payrollController.payEmployeePayroll writes.
const payrollPayload = (overrides = {}) => ({
  employeeId: unique(),
  employeeName: "Asha Rao",
  department: "Kitchen",
  role: "cook",
  monthKey: "2026-07",
  baseSalary: 30000,
  presentDays: 22,
  absentDays: 1,
  leaveDays: 3,
  halfDays: 1,
  lateDays: 2,
  extraDutyDays: 4,
  overtimeHours: 3.5,
  deduction: 2000,
  extraDutyPay: 1500,
  bonus: 500,
  netSalary: 30000,
  status: "Pending",
  paymentMethod: "Bank Transfer",
  transactionId: "",
  paidAt: null,
  paidBy: "",
  notes: "",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("payroll: service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(payrollService.isConnected(), true);
  assert.strictEqual(await payrollService.usePostgres(), true);
});

// ─── Full field mapping ────────────────────────────────────────────────────
test("payroll (PG): every persisted Mongo field round-trips through the repository", async () => {
  const payload = payrollPayload({
    employeeName: "  Asha Rao  ",
    department: "  Kitchen  ",
    role: "  cook  ",
    notes: "  July salary  ",
    transactionId: "  TXN-1  ",
    paidBy: "  Admin  ",
    status: "Paid",
    paymentMethod: "UPI",
    paidAt: new Date("2026-08-01T10:30:00Z"),
    razorpayOrderId: "order_abc",
    razorpayPaymentId: "pay_abc",
    razorpaySignature: "sig_abc",
  });

  const created = await payrollRepository.create(payload);
  assert.ok(created._id, "a Mongo-shaped _id is returned");

  const found = await payrollService.findById(created._id);
  assert.strictEqual(found._id, created._id);
  assert.strictEqual(found.id, created._id, "the helper id is exposed too");
  assert.strictEqual(found.employeeId, String(payload.employeeId).trim());
  assert.strictEqual(found.employeeName, "Asha Rao", "employeeName is trimmed");
  assert.strictEqual(found.department, "Kitchen");
  assert.strictEqual(found.role, "cook");
  assert.strictEqual(found.monthKey, "2026-07");
  assert.strictEqual(found.baseSalary, 30000);
  assert.strictEqual(found.presentDays, 22);
  assert.strictEqual(found.absentDays, 1);
  assert.strictEqual(found.leaveDays, 3);
  assert.strictEqual(found.halfDays, 1);
  assert.strictEqual(found.lateDays, 2);
  assert.strictEqual(found.extraDutyDays, 4);
  assert.strictEqual(found.overtimeHours, 3.5, "fractional overtime hours survive");
  assert.strictEqual(found.deduction, 2000);
  assert.strictEqual(found.extraDutyPay, 1500);
  assert.strictEqual(found.bonus, 500);
  assert.strictEqual(found.netSalary, 30000);
  assert.strictEqual(found.status, "Paid");
  assert.strictEqual(found.paymentMethod, "UPI");
  assert.strictEqual(found.transactionId, "TXN-1", "transactionId is trimmed");
  assert.ok(found.paidAt instanceof Date, "paidAt is a real instant");
  assert.strictEqual(found.paidAt.toISOString(), "2026-08-01T10:30:00.000Z");
  assert.strictEqual(found.paidBy, "Admin");
  assert.strictEqual(found.notes, "July salary");
  assert.strictEqual(found.razorpayOrderId, "order_abc");
  assert.strictEqual(found.razorpayPaymentId, "pay_abc");
  assert.strictEqual(found.razorpaySignature, "sig_abc");
  assert.ok(found.createdAt instanceof Date);
  assert.ok(found.updatedAt instanceof Date);

  // The row really is in PostgreSQL under the same id.
  const rows = await pgQuery("SELECT id, employee_id, month_key FROM payroll_records WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].employee_id, String(payload.employeeId).trim());
});

test("payroll (PG): the three razorpay fields stay absent when not supplied", async () => {
  const created = await payrollRepository.create(payrollPayload());
  const found = await payrollRepository.findById(created._id);
  assert.strictEqual(found.razorpayOrderId, undefined, "razorpayOrderId is undefined, like the MongoDB document");
  assert.strictEqual(found.razorpayPaymentId, undefined);
  assert.strictEqual(found.razorpaySignature, undefined);
});

test("payroll (PG): schema defaults are applied exactly as Mongoose applies them", async () => {
  // Only the required fields plus netSalary — everything else must default.
  const created = await payrollRepository.create({
    employeeId: unique(),
    employeeName: "Defaults",
    monthKey: "2026-09",
    baseSalary: 12000,
    netSalary: 12000,
  });
  const found = await payrollRepository.findById(created._id);

  assert.strictEqual(found.department, "");
  assert.strictEqual(found.role, "");
  assert.strictEqual(found.presentDays, 0);
  assert.strictEqual(found.absentDays, 0);
  assert.strictEqual(found.leaveDays, 0);
  assert.strictEqual(found.halfDays, 0);
  assert.strictEqual(found.lateDays, 0);
  assert.strictEqual(found.extraDutyDays, 0);
  assert.strictEqual(found.overtimeHours, 0);
  assert.strictEqual(found.deduction, 0);
  assert.strictEqual(found.extraDutyPay, 0);
  assert.strictEqual(found.bonus, 0);
  assert.strictEqual(found.status, "Pending", "status defaults to Pending");
  assert.strictEqual(found.paymentMethod, "Bank Transfer", "paymentMethod defaults to Bank Transfer");
  assert.strictEqual(found.transactionId, "");
  assert.strictEqual(found.paidAt, null, "paidAt defaults to null");
  assert.strictEqual(found.paidBy, "");
  assert.strictEqual(found.notes, "");
});

test("payroll (PG): the required fields are enforced before reaching PostgreSQL", async () => {
  for (const [patch, label] of [
    [{ employeeId: "" }, "employeeId"],
    [{ employeeName: "  " }, "employeeName"],
    [{ monthKey: "" }, "monthKey"],
    [{ baseSalary: null }, "baseSalary"],
    [{ netSalary: undefined }, "netSalary"],
  ]) {
    const payload = payrollPayload(patch);
    if (patch.netSalary === undefined) delete payload.netSalary;
    await assert.rejects(
      payrollRepository.create(payload),
      new RegExp(`${label} is required`),
      `${label} is required`
    );
  }

  await assert.rejects(
    payrollRepository.create(payrollPayload({ monthKey: "2026-7" })),
    /monthKey must be a YYYY-MM period key/,
    "the period key shape is validated"
  );
  await assert.rejects(
    payrollRepository.create(payrollPayload({ status: "Approved" })),
    /Invalid status/,
    "only the two real statuses are accepted"
  );
  await assert.rejects(
    payrollRepository.create(payrollPayload({ paymentMethod: "Bitcoin" })),
    /Invalid paymentMethod/,
    "only the six real payment methods are accepted"
  );
});

// ─── Financial precision round-trips ───────────────────────────────────────
test("payroll (PG): monetary values round-trip exactly — zero, integers, decimals, large", async () => {
  // Compared as exact strings (NUMERIC::text) so no assertion ever goes through
  // floating-point arithmetic.
  const amounts = ["0", "1", "0.01", "0.1", "1234.5678", "99999.99", "9999999999.99"];
  for (const amount of amounts) {
    const created = await payrollRepository.create(payrollPayload({
      employeeId: unique(),
      baseSalary: amount,
      deduction: amount,
      extraDutyPay: amount,
      bonus: amount,
      netSalary: amount,
      overtimeHours: amount,
    }));
    const rows = await pgQuery(
      `SELECT base_salary::text AS b, deduction::text AS d, extra_duty_pay::text AS e,
              bonus::text AS bo, net_salary::text AS n, overtime_hours::text AS o
       FROM payroll_records WHERE id = $1`,
      [created._id]
    );
    const r = rows[0];
    assert.strictEqual(r.b, String(Number(amount)), `base_salary stored exactly as ${amount}`);
    assert.strictEqual(r.d, String(Number(amount)), `deduction stored exactly as ${amount}`);
    assert.strictEqual(r.e, String(Number(amount)), `extra_duty_pay stored exactly as ${amount}`);
    assert.strictEqual(r.bo, String(Number(amount)), `bonus stored exactly as ${amount}`);
    assert.strictEqual(r.n, String(Number(amount)), `net_salary stored exactly as ${amount}`);
    assert.strictEqual(r.o, String(Number(amount)), `overtime_hours stored exactly as ${amount}`);

    // And the same values come back through the repository as Numbers.
    const found = await payrollRepository.findById(created._id);
    assert.strictEqual(found.baseSalary, Number(amount));
    assert.strictEqual(found.netSalary, Number(amount));
    assert.strictEqual(found.deduction, Number(amount));
    assert.strictEqual(found.extraDutyPay, Number(amount));
    assert.strictEqual(found.bonus, Number(amount));
    assert.strictEqual(found.overtimeHours, Number(amount));
  }
});

test("payroll (PG): money is never stored as a floating-point type", async () => {
  const cols = await pgQuery(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'payroll_records'`);
  for (const { column_name: col, data_type: type } of cols) {
    assert.ok(!/^(real|double precision)$/.test(type),
      `payroll_records.${col} must not be ${type}`);
  }
  for (const col of ["base_salary", "deduction", "extra_duty_pay", "bonus", "net_salary"]) {
    const hit = cols.find((c) => c.column_name === col);
    assert.strictEqual(hit.data_type, "numeric", `${col} is NUMERIC`);
  }
});

test("payroll (PG): a computed net salary round-trips without rescaling", async () => {
  // Mirrors the controller's own arithmetic: roundMoney(base - deduction +
  // extraDutyPay + bonus) with Math.round, then persisted. The value must come
  // back identical — no rounding is applied by the database.
  const base = 30000;
  const deduction = 2667;
  const extraDutyPay = 1567;
  const bonus = 501;
  const netSalary = Math.round(base - deduction + extraDutyPay + bonus);

  const created = await payrollRepository.create(payrollPayload({
    employeeId: unique(),
    baseSalary: base,
    deduction,
    extraDutyPay,
    bonus,
    netSalary,
  }));
  const found = await payrollRepository.findById(created._id);
  assert.strictEqual(found.netSalary, netSalary);
  assert.strictEqual(found.baseSalary - found.deduction + found.extraDutyPay + found.bonus, netSalary,
    "the stored components still reproduce the stored net salary");
});

// ─── Payroll period + uniqueness ───────────────────────────────────────────
test("payroll (PG): one record per employee per period, enforced by the repository's unique row", async () => {
  const employeeId = unique();

  const first = await payrollRepository.create(payrollPayload({ employeeId, monthKey: "2026-05" }));
  assert.ok(first._id);

  // A second insert for the same employee + period is rejected by the
  // PostgreSQL unique constraint — the same rule the Mongo compound unique
  // index declares.
  await assert.rejects(
    pgQuery(
      `INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary)
       VALUES ($1, $2, 'Dup', '2026-05', 1, 1)`,
      [unique(), employeeId]
    ),
    /duplicate key value violates unique constraint "payroll_records_employee_id_month_key_key"/
  );

  // A different employee in the same period is fine.
  const other = await payrollRepository.create(
    payrollPayload({ employeeId: unique(), monthKey: "2026-05" })
  );
  assert.ok(other._id);

  // The same employee in a different period is fine, across year boundaries.
  for (const monthKey of ["2026-04", "2026-06", "2025-12", "2027-01"]) {
    const doc = await payrollRepository.create(payrollPayload({ employeeId, monthKey }));
    assert.strictEqual(doc.monthKey, monthKey);
  }

  // findOne({ employeeId, monthKey }) is how payEmployeePayroll detects the
  // existing record it should update instead of inserting.
  const existing = await payrollService.findOne({ employeeId, monthKey: "2026-05" });
  assert.strictEqual(existing._id, first._id);
  assert.strictEqual(existing.monthKey, "2026-05");
});

test("payroll (PG): a missing employee + period pair returns null, like Mongo findOne", async () => {
  const employeeId = unique();
  await payrollRepository.create(payrollPayload({ employeeId, monthKey: "2026-03" }));

  assert.strictEqual(
    await payrollService.findOne({ employeeId, monthKey: "2026-02" }),
    null,
    "a period with no record returns null"
  );
  assert.strictEqual(
    await payrollService.findOne({ employeeId: unique(), monthKey: "2026-03" }),
    null,
    "another employee's period returns null"
  );
});

test("payroll (PG): the period is compared as text, exactly like the Mongo monthKey Strings", async () => {
  const employeeId = unique();
  for (const monthKey of ["2026-01", "2026-06", "2026-12", "2027-01"]) {
    await payrollRepository.create(payrollPayload({ employeeId, monthKey }));
  }

  // A lexicographic range over month_key matches the Mongo string semantics.
  const inYear = await payrollRepository.findMany({
    filter: { employeeId, monthKey: { $gte: "2026-01", $lte: "2026-12" } },
    sort: { monthKey: 1 },
  });
  assert.deepStrictEqual(inYear.map((r) => r.monthKey), ["2026-01", "2026-06", "2026-12"]);

  // $in membership, the shape the dashboard's six-month trend uses.
  const trend = await payrollRepository.findMany({
    filter: { employeeId, monthKey: { $in: ["2026-06", "2027-01"] }, status: "Pending" },
  });
  assert.deepStrictEqual(trend.map((r) => r.monthKey).sort(), ["2026-06", "2027-01"]);
});

// ─── Calculation inputs ────────────────────────────────────────────────────
test("payroll (PG): the calculation inputs the controller derives are stored and returned unchanged", async () => {
  // A realistic month: a base salary, an absence deduction, half days, overtime
  // pay, a bonus and the resulting net salary. These are the values
  // buildEmployeePayroll computes and payEmployeePayroll persists; this test
  // pins that PostgreSQL preserves them exactly (no formula is re-implemented).
  const employeeId = unique();
  const created = await payrollRepository.create(payrollPayload({
    employeeId,
    monthKey: "2026-10",
    baseSalary: 26000,
    presentDays: 20,
    absentDays: 2,
    leaveDays: 5,
    halfDays: 1,
    lateDays: 3,
    extraDutyDays: 6,
    overtimeHours: 12.5,
    deduction: 2500,
    extraDutyPay: 2083,
    bonus: 1000,
    netSalary: 26583,
    notes: "October payroll",
  }));

  const found = await payrollService.findById(created._id);
  assert.strictEqual(found.baseSalary, 26000);
  assert.strictEqual(found.presentDays, 20);
  assert.strictEqual(found.absentDays, 2);
  assert.strictEqual(found.leaveDays, 5);
  assert.strictEqual(found.halfDays, 1);
  assert.strictEqual(found.lateDays, 3);
  assert.strictEqual(found.extraDutyDays, 6);
  assert.strictEqual(found.overtimeHours, 12.5, "fractional overtime hours survive");
  assert.strictEqual(found.deduction, 2500);
  assert.strictEqual(found.extraDutyPay, 2083);
  assert.strictEqual(found.bonus, 1000);
  assert.strictEqual(found.netSalary, 26583);
  assert.strictEqual(found.notes, "October payroll");
});

test("payroll (PG): a zero-salary month (nothing earned) round-trips", async () => {
  const created = await payrollRepository.create(payrollPayload({
    employeeId: unique(),
    monthKey: "2026-11",
    baseSalary: 0,
    netSalary: 0,
    deduction: 0,
    extraDutyPay: 0,
    bonus: 0,
    presentDays: 0,
    absentDays: 0,
    leaveDays: 0,
    halfDays: 0,
    lateDays: 0,
    extraDutyDays: 0,
    overtimeHours: 0,
  }));
  const found = await payrollRepository.findById(created._id);
  assert.strictEqual(found.baseSalary, 0);
  assert.strictEqual(found.netSalary, 0);
  assert.strictEqual(found.deduction, 0);
  assert.strictEqual(found.overtimeHours, 0);
  assert.strictEqual(found.netSalary, found.baseSalary - found.deduction + found.extraDutyPay + found.bonus);
});

// ─── Reads, filtering, sorting, pagination ─────────────────────────────────
test("payroll (PG): month and period+status scans match the dashboard's reads", async () => {
  const employeeId = unique();
  await payrollRepository.create(payrollPayload({ employeeId, monthKey: "2026-02" }));
  await payrollRepository.create(payrollPayload({
    employeeId: unique(), monthKey: "2026-02", status: "Paid",
    paymentMethod: "UPI", paidAt: new Date("2026-03-01T00:00:00Z"), paidBy: "Admin",
  }));

  const month = await payrollRepository.findMany({ filter: { monthKey: "2026-02" } });
  assert.ok(month.length >= 2, "the whole month is readable");
  assert.ok(month.every((r) => r.monthKey === "2026-02"));

  const paid = await payrollRepository.findMany({ filter: { monthKey: "2026-02", status: "Paid" } });
  assert.ok(paid.every((r) => r.status === "Paid"));
  assert.ok(paid.length >= 1);
});

test("payroll (PG): list supports the whitelisted sorts and drops unknown keys", async () => {
  const employeeId = unique();
  for (const monthKey of ["2026-01", "2026-03", "2026-02"]) {
    await payrollRepository.create(payrollPayload({ employeeId, monthKey }));
  }

  const asc = await payrollRepository.findMany({
    filter: { employeeId },
    sort: { monthKey: 1 },
  });
  assert.deepStrictEqual(asc.map((r) => r.monthKey), ["2026-01", "2026-02", "2026-03"]);

  const desc = await payrollRepository.findMany({
    filter: { employeeId },
    sort: { monthKey: -1 },
  });
  assert.deepStrictEqual(desc.map((r) => r.monthKey), ["2026-03", "2026-02", "2026-01"]);

  // An unknown (or injection-shaped) sort key is dropped and the default order
  // applies — nothing is interpolated into the SQL.
  const safe = await payrollRepository.findMany({
    filter: { employeeId },
    sort: { "month_key; DROP TABLE payroll_records": 1 },
  });
  assert.strictEqual(safe.length, 3, "an unknown sort key does not break or alter the read");
});

test("payroll (PG): pagination preserves the existing limit/offset semantics", async () => {
  const employeeId = unique();
  for (const monthKey of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
    await payrollRepository.create(payrollPayload({ employeeId, monthKey }));
  }

  const page1 = await payrollRepository.findMany({
    filter: { employeeId }, sort: { monthKey: 1 }, limit: 2,
  });
  const page2 = await payrollRepository.findMany({
    filter: { employeeId }, sort: { monthKey: 1 }, limit: 2, offset: 2,
  });

  assert.deepStrictEqual(page1.map((r) => r.monthKey), ["2026-01", "2026-02"]);
  assert.deepStrictEqual(page2.map((r) => r.monthKey), ["2026-03", "2026-04"]);
});

test("payroll (PG): findById returns null for an unknown id, like Mongoose", async () => {
  assert.strictEqual(await payrollService.findById(unique()), null);
  assert.strictEqual(await payrollService.findById(""), null);
  assert.strictEqual(await payrollService.findById(undefined), null);
});

// ─── Workflow ──────────────────────────────────────────────────────────────
test("payroll (PG): the Pending → Paid transition persists the payment metadata", async () => {
  const created = await payrollRepository.create(payrollPayload({
    employeeId: unique(),
    monthKey: "2026-12",
    status: "Pending",
  }));
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.paidAt, null);

  // The offline/simulated branch of payEmployeePayroll: the record is marked
  // Paid with the method, reference, timestamp and actor.
  const paidAt = new Date("2027-01-02T09:00:00Z");
  const paid = await payrollService.updateById(created._id, {
    status: "Paid",
    paymentMethod: "Cash",
    transactionId: "CASH-42",
    paidAt,
    paidBy: "Admin",
    notes: "paid in cash",
  });

  assert.strictEqual(paid.status, "Paid");
  assert.strictEqual(paid.paymentMethod, "Cash");
  assert.strictEqual(paid.transactionId, "CASH-42");
  assert.strictEqual(paid.paidBy, "Admin");
  assert.strictEqual(paid.notes, "paid in cash");
  assert.ok(paid.paidAt instanceof Date);
  assert.strictEqual(paid.paidAt.toISOString(), "2027-01-02T09:00:00.000Z");
  assert.strictEqual(paid.netSalary, created.netSalary, "the financial values are untouched");
  assert.strictEqual(paid.baseSalary, created.baseSalary);
});

test("payroll (PG): the Razorpay branch keeps the record Pending and stores the order id", async () => {
  const created = await payrollRepository.create(payrollPayload({
    employeeId: unique(),
    monthKey: "2027-02",
    status: "Pending",
    paidAt: null,
  }));

  // payEmployeePayroll's record.razorpayOrderId = order.id; record.save().
  const withOrder = await payrollService.updateById(created._id, { razorpayOrderId: "order_xyz" });
  assert.strictEqual(withOrder.status, "Pending", "an order does not mark the salary paid");
  assert.strictEqual(withOrder.razorpayOrderId, "order_xyz");
  assert.strictEqual(withOrder.paidAt, null, "paidAt stays null until verification");

  // verifyPayrollPayment's fallback lookup: findOne({ razorpayOrderId }).
  const byOrder = await payrollService.findOne({ razorpayOrderId: "order_xyz" });
  assert.strictEqual(byOrder._id, created._id);

  // The verification mutation.
  const verifiedAt = new Date("2027-03-01T12:00:00Z");
  const verified = await payrollService.updateById(created._id, {
    status: "Paid",
    transactionId: "pay_xyz",
    razorpayPaymentId: "pay_xyz",
    razorpaySignature: "sig_xyz",
    paidAt: verifiedAt,
  });
  assert.strictEqual(verified.status, "Paid");
  assert.strictEqual(verified.transactionId, "pay_xyz");
  assert.strictEqual(verified.razorpayPaymentId, "pay_xyz");
  assert.strictEqual(verified.razorpaySignature, "sig_xyz");
  assert.strictEqual(verified.razorpayOrderId, "order_xyz", "the order id is preserved");
  assert.strictEqual(verified.paidAt.toISOString(), "2027-03-01T12:00:00.000Z");
});

test("payroll (PG): an update patches only the supplied fields", async () => {
  const created = await payrollRepository.create(payrollPayload({
    employeeId: unique(),
    monthKey: "2027-04",
    notes: "original",
    bonus: 123,
  }));

  const updated = await payrollService.updateById(created._id, { notes: "revised" });
  assert.strictEqual(updated.notes, "revised");
  assert.strictEqual(updated.bonus, 123, "untouched fields survive a partial update");
  assert.strictEqual(updated.status, created.status);
  assert.strictEqual(updated.netSalary, created.netSalary);
  assert.strictEqual(updated.createdAt.toISOString(), created.createdAt.toISOString(),
    "createdAt is not rewritten by an update");
});

test("payroll (PG): an update with no recognised fields leaves the record unchanged", async () => {
  const created = await payrollRepository.create(payrollPayload({ employeeId: unique(), monthKey: "2027-05" }));
  const same = await payrollService.updateById(created._id, { notAField: 1 });
  assert.strictEqual(same._id, created._id);
  assert.strictEqual(same.monthKey, created.monthKey);
  assert.strictEqual(same.netSalary, created.netSalary);
});

test("payroll (PG): an invalid status or payment method is rejected on update too", async () => {
  const created = await payrollRepository.create(payrollPayload({ employeeId: unique(), monthKey: "2027-06" }));
  await assert.rejects(
    payrollService.updateById(created._id, { status: "Reversed" }),
    /Invalid status/,
    "only the two real statuses are accepted"
  );
  await assert.rejects(
    payrollService.updateById(created._id, { paymentMethod: "Crypto" }),
    /Invalid paymentMethod/,
    "only the six real payment methods are accepted"
  );
  const unchanged = await payrollService.findById(created._id);
  assert.strictEqual(unchanged.status, "Pending", "the rejected update did not persist");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("payroll (PG): a PostgreSQL write never reaches the Mongoose model", async () => {
  const calls = [];
  const original = {
    create: PayrollRecord.create,
    findByIdAndUpdate: PayrollRecord.findByIdAndUpdate,
  };
  PayrollRecord.create = async (...args) => { calls.push(["create", args]); return null; };
  PayrollRecord.findByIdAndUpdate = async (...args) => { calls.push(["findByIdAndUpdate", args]); return null; };
  try {
    const created = await payrollService.create(payrollPayload({ employeeId: unique(), monthKey: "2027-07" }));
    assert.ok(created._id, "the record was created on the PostgreSQL path");
    await payrollService.updateById(created._id, { notes: "pg only" });

    assert.strictEqual(calls.length, 0, "no Mongoose write was performed");

    const rows = await pgQuery("SELECT id FROM payroll_records WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "the row is in PostgreSQL");
  } finally {
    PayrollRecord.create = original.create;
    PayrollRecord.findByIdAndUpdate = original.findByIdAndUpdate;
  }
});

test("payroll (PG): reading on the PostgreSQL path never queries the Mongoose model", async () => {
  const created = await payrollRepository.create(payrollPayload({ employeeId: unique(), monthKey: "2027-08" }));

  const calls = [];
  const original = { findById: PayrollRecord.findById, find: PayrollRecord.find, findOne: PayrollRecord.findOne };
  PayrollRecord.findById = (...args) => { calls.push(["findById", args]); return Promise.resolve(null); };
  PayrollRecord.find = (...args) => { calls.push(["find", args]); return { sort: () => Promise.resolve([]) }; };
  PayrollRecord.findOne = (...args) => { calls.push(["findOne", args]); return Promise.resolve(null); };
  try {
    const found = await payrollService.findById(created._id);
    assert.strictEqual(found._id, created._id, "the PostgreSQL read returned the row");

    const list = await payrollService.findMany({
      filter: { employeeId: created.employeeId },
      sort: { monthKey: -1 },
    });
    assert.ok(list.some((r) => r._id === created._id), "the list came from PostgreSQL");

    const one = await payrollService.findOne({ employeeId: created.employeeId, monthKey: created.monthKey });
    assert.strictEqual(one._id, created._id);

    assert.strictEqual(calls.length, 0, "no Mongoose read was performed");
  } finally {
    PayrollRecord.findById = original.findById;
    PayrollRecord.find = original.find;
    PayrollRecord.findOne = original.findOne;
  }
});

// ─── The datasource seam ───────────────────────────────────────────────────
test("payroll (PG): the seam can flip between datasources in-process without a stale reference", async () => {
  const original = dbConfig.isDbConnected;
  try {
    const employeeId = unique();
    const created = await payrollRepository.create(payrollPayload({ employeeId, monthKey: "2027-09" }));

    // Pin the seam to "disconnected": the service must now route to Mongoose.
    // A require-time destructure of isDbConnected would ignore this flip.
    dbConfig.isDbConnected = () => false;
    const calls = [];
    const originalCreate = PayrollRecord.create;
    PayrollRecord.create = async (data) => { calls.push(data); return { _id: "mongo-1", ...data }; };
    try {
      assert.strictEqual(await payrollService.usePostgres(), false);
      await payrollService.create(payrollPayload({ employeeId: unique(), monthKey: "2027-09" }));
      assert.strictEqual(calls.length, 1, "the flipped seam routed the write to Mongoose");
    } finally {
      PayrollRecord.create = originalCreate;
    }

    // Flip back: PostgreSQL is selected again for already-loaded modules.
    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await payrollService.usePostgres(), true);
    const found = await payrollService.findOne({ employeeId, monthKey: "2027-09" });
    assert.strictEqual(found._id, created._id, "the PostgreSQL row is readable after the flip back");
  } finally {
    dbConfig.isDbConnected = original;
  }
});

// ─── Migration wiring ──────────────────────────────────────────────────────
test("payroll (PG): migration 023 is applied and the table exists with its indexes", async () => {
  const rows = await pgQuery("SELECT name FROM schema_migrations ORDER BY id");
  assert.ok(
    rows.some((r) => r.name === "023_create_payroll_records.sql"),
    "023_create_payroll_records.sql is recorded as applied"
  );

  const tbl = await pgQuery("SELECT to_regclass('public.payroll_records') AS t");
  assert.ok(tbl[0].t, "the payroll_records table exists");

  const indexes = await pgQuery(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'payroll_records' ORDER BY indexname"
  );
  assert.deepStrictEqual(indexes.map((r) => r.indexname), [
    "idx_payroll_records_created_at",
    "idx_payroll_records_month_key",
    "idx_payroll_records_razorpay_order_id",
    "idx_payroll_records_status_month_key",
    "payroll_records_employee_id_month_key_key",
    "payroll_records_pkey",
  ]);

  // The migration file is the only new DDL and it carries the table definition.
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, "023_create_payroll_records.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS payroll_records/);
  assert.match(sql, /UNIQUE \(employee_id, month_key\)/);
  // No column is declared with a floating-point type — the DDL lines only.
  const ddl = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.ok(
    !/\b(FLOAT|REAL|DOUBLE\s+PRECISION)\b/i.test(ddl),
    "no floating-point column type is declared"
  );
});
