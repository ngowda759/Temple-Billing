// Phase 2V controller-level tests for the Payroll endpoints.
//
// These drive the real payrollController handlers (not the service in
// isolation) so the API contract is verified end-to-end:
//   - payEmployeePayroll persists through the controller on the PostgreSQL
//     path, including the Razorpay order / verification branches, and the
//     response shape the frontend consumes is unchanged,
//   - the Mongo fallback path routes the same handlers to the Mongoose model,
//   - a controller operation reaches exactly one datasource.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Employee = require("../src/models/Employee");
const PayrollRecord = require("../src/models/PayrollRecord");
const attendanceService = require("../src/services/attendanceService");
const leaveService = require("../src/services/leaveService");
const taskService = require("../src/services/taskService");
const accountingService = require("../src/services/accountingService");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let payrollController;
let originalRazorpayAddResources;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS payroll_records CASCADE");
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

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

// The controller constructs `new Razorpay(...)` per request, so the stub is
// installed on the constructor's prototype: addResources() is what the
// constructor calls to attach the resource objects.
const stubRazorpayOrders = () => {
  const Razorpay = require("razorpay");
  originalRazorpayAddResources = Razorpay.prototype.addResources;
  const orders = [];
  Razorpay.prototype.addResources = function addResources() {
    this.orders = {
      create: async (options) => {
        orders.push(options);
        return { id: "order_ctrl_" + orders.length, ...options };
      },
    };
  };
  return orders;
};

// The controller uses the four same-domain services plus Task for its inputs.
// They are stubbed to fixed sets so the calculation runs deterministically.
const stubPayrollInputs = () => {
  const originals = {
    attendanceFindMany: attendanceService.findMany,
    leaveFindMany: leaveService.findMany,
    taskFindMany: taskService.findMany,
    taskDeleteMany: taskService.deleteMany,
    employeeFindById: Employee.findById,
    employeeFind: Employee.find,
    recorded: accountingService.recordTransaction,
  };
  accountingService.recordTransaction = async () => null;
  attendanceService.findMany = async () => [];
  leaveService.findMany = async () => [];
  taskService.findMany = async () => [];
  return originals;
};

const restorePayrollInputs = (originals) => {
  attendanceService.findMany = originals.attendanceFindMany;
  leaveService.findMany = originals.leaveFindMany;
  taskService.findMany = originals.taskFindMany;
  taskService.deleteMany = originals.taskDeleteMany;
  Employee.findById = originals.employeeFindById;
  Employee.find = originals.employeeFind;
  accountingService.recordTransaction = originals.recorded;
};

const employeeDoc = (overrides = {}) => ({
  _id: "0000000000000000000000e1",
  name: "Asha Rao",
  department: "Kitchen",
  role: "cook",
  salary: 30000,
  employeeId: "EMP-1",
  email: "asha@example.com",
  weeklyOff: "Sunday",
  joiningDate: new Date("2024-01-15T00:00:00Z"),
  status: "Active",
  compOffBalance: 0,
  ...overrides,
});

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
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;
  payrollController = require("../src/controllers/payrollController");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  if (originalRazorpayAddResources) {
    require("razorpay").prototype.addResources = originalRazorpayAddResources;
  }
  await closePostgres();
});

// ─── PostgreSQL path ───────────────────────────────────────────────────────
test("payroll controller (PG): payEmployeePayroll persists the simulated payment", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  Employee.findById = async () => employeeDoc();
  try {
    const res = createMockRes();
    await payrollController.payEmployeePayroll(
      {
        params: { employeeId: "0000000000000000000000e1" },
        body: { monthKey: "2026-07", paymentMethod: "Cash", bonus: 500, extraDutyPay: 0, transactionId: "CASH-7", notes: "  July  " },
        user: { name: "Admin" },
      },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.simulated, true, "with no Razorpay keys the payment is simulated");
    assert.strictEqual(res.body.record.status, "Paid", "a simulated payment is marked Paid");
    assert.strictEqual(res.body.record.paymentMethod, "Cash");
    assert.strictEqual(res.body.record.transactionId, "CASH-7");
    assert.strictEqual(res.body.record.bonus, 500);
    assert.strictEqual(res.body.record.monthKey, "2026-07");
    assert.strictEqual(res.body.record.notes, "July");
    assert.strictEqual(res.body.record.paidBy, "Admin");
    assert.ok(res.body.record.paidAt instanceof Date, "paidAt is set on a real payment");

    // The response's employee block is built from the computed payload.
    assert.strictEqual(res.body.employee.status, "Paid");
    assert.strictEqual(res.body.employee.paymentMethod, "Cash");
    assert.strictEqual(res.body.employee.transactionId, "CASH-7");

    // It really landed in PostgreSQL, and nowhere else.
    const rows = await pgQuery("SELECT status, net_salary::text AS n FROM payroll_records WHERE id = $1",
      [res.body.record._id]);
    assert.strictEqual(rows.length, 1, "the row exists in PostgreSQL");
    assert.strictEqual(rows[0].status, "Paid");
    assert.strictEqual(rows[0].n, String(res.body.record.netSalary));
  } finally {
    restorePayrollInputs(originals);
    if (savedKeys.id !== undefined) process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

test("payroll controller (PG): a second payment for the same month updates the existing row", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  Employee.findById = async () => employeeDoc();
  try {
    const first = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2026-09", paymentMethod: "Cash" }, user: { name: "Admin" } },
      first
    );
    const firstId = first.body.record._id;

    const second = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2026-09", paymentMethod: "Cash", bonus: 250 }, user: { name: "Admin" } },
      second
    );

    assert.strictEqual(second.body.record._id, firstId, "the existing record is updated, not duplicated");
    assert.strictEqual(second.body.record.bonus, 250);

    const rows = await pgQuery(
      "SELECT COUNT(*)::int AS n FROM payroll_records WHERE employee_id = $1 AND month_key = '2026-09'",
      ["0000000000000000000000e1"]
    );
    assert.strictEqual(rows[0].n, 1, "exactly one row for the employee + period");
  } finally {
    restorePayrollInputs(originals);
    if (savedKeys.id !== undefined) process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

test("payroll controller (PG): the Razorpay order branch stores the order id and stays Pending", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
  const orders = stubRazorpayOrders();
  Employee.findById = async () => employeeDoc();
  try {
    const res = createMockRes();
    await payrollController.payEmployeePayroll(
      {
        params: { employeeId: "0000000000000000000000e1" },
        body: { monthKey: "2026-10", paymentMethod: "UPI" },
        user: { name: "Admin" },
      },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.simulated, false);
    assert.strictEqual(res.body.key, "rzp_test_key");
    assert.strictEqual(res.body.record.status, "Pending", "an order does not mark the salary paid");
    assert.ok(res.body.record.razorpayOrderId, "the order id was persisted through the repository");
    assert.strictEqual(res.body.record.razorpayOrderId, res.body.order.id);
    assert.strictEqual(orders.length, 1, "one Razorpay order was created");
    assert.strictEqual(orders[0].amount, Math.round(res.body.record.netSalary * 100),
      "the order amount is the net salary in paise");

    // The order id is really in PostgreSQL — the controller went through the
    // repository, not through a Mongoose document mutation.
    const rows = await pgQuery(
      "SELECT status, razorpay_order_id FROM payroll_records WHERE id = $1",
      [res.body.record._id]
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, "Pending");
    assert.strictEqual(rows[0].razorpay_order_id, res.body.order.id);
  } finally {
    restorePayrollInputs(originals);
    require("razorpay").prototype.addResources = originalRazorpayAddResources;
    if (savedKeys.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

test("payroll controller (PG): verifyPayrollPayment marks the record Paid", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
  const orders = stubRazorpayOrders();
  Employee.findById = async () => employeeDoc();
  try {
    const payRes = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2026-11", paymentMethod: "UPI" }, user: { name: "Admin" } },
      payRes
    );
    const recordId = payRes.body.record._id;
    const orderId = payRes.body.order.id;
    assert.strictEqual(orders.length, 1);

    const paymentId = "pay_ctrl_1";
    const signature = crypto
      .createHmac("sha256", "rzp_test_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const res = createMockRes();
    await payrollController.verifyPayrollPayment(
      { body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature, recordId } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    const rows = await pgQuery(
      "SELECT status, transaction_id, razorpay_payment_id, razorpay_signature, razorpay_order_id, paid_at FROM payroll_records WHERE id = $1",
      [recordId]
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, "Paid", "the record moved to Paid");
    assert.strictEqual(rows[0].transaction_id, paymentId);
    assert.strictEqual(rows[0].razorpay_payment_id, paymentId);
    assert.strictEqual(rows[0].razorpay_signature, signature);
    assert.strictEqual(rows[0].razorpay_order_id, orderId, "the order id is preserved");
    assert.ok(rows[0].paid_at instanceof Date, "paid_at was set");
  } finally {
    restorePayrollInputs(originals);
    require("razorpay").prototype.addResources = originalRazorpayAddResources;
    if (savedKeys.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

test("payroll controller (PG): verifyPayrollPayment rejects an invalid signature with 400", async () => {
  const res = createMockRes();
  await payrollController.verifyPayrollPayment(
    { body: { razorpay_order_id: "order_x", razorpay_payment_id: "pay_x", razorpay_signature: "not-a-signature" } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
});

test("payroll controller (PG): the pre-phase 400/404 guards are unchanged", async () => {
  const originals = stubPayrollInputs();
  Employee.findById = async () => employeeDoc();
  try {
    const badId = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "not-an-object-id" }, body: { monthKey: "2026-07" } },
      badId
    );
    assert.strictEqual(badId.statusCode, 400, "an invalid employee id is still rejected");

    const badMonth = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2026-7" } },
      badMonth
    );
    assert.strictEqual(badMonth.statusCode, 400, "an invalid monthKey is still rejected");

    const badMethod = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2026-07", paymentMethod: "Bitcoin" } },
      badMethod
    );
    assert.strictEqual(badMethod.statusCode, 400, "an invalid payment method is still rejected");

    Employee.findById = async () => null;
    const missing = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e2" }, body: { monthKey: "2026-07" } },
      missing
    );
    assert.strictEqual(missing.statusCode, 404, "a missing employee is still a 404");
  } finally {
    restorePayrollInputs(originals);
  }
});

test("payroll controller (PG): getPayrollDashboard reads the month through PostgreSQL", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  Employee.find = () => ({ sort: () => Promise.resolve([employeeDoc()]) });
  Employee.findById = async () => employeeDoc();
  try {
    const payRes = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2026-12", paymentMethod: "Cash" }, user: { name: "Admin" } },
      payRes
    );

    const res = createMockRes();
    await payrollController.getPayrollDashboard({ query: { month: "2026-12" } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.monthKey, "2026-12");
    assert.strictEqual(res.body.summary.paidEmployees, 1, "the paid record came back from PostgreSQL");
    assert.strictEqual(res.body.summary.monthlyPayroll, payRes.body.record.netSalary);
    assert.strictEqual(res.body.summary.pendingSalary, 0);
    assert.strictEqual(res.body.employees.length, 1);

    // The six-month trend is a separate PostgreSQL read. Its buckets are a
    // trailing six-month window ending at the current month (the response
    // exposes { month, salary }, matching the pre-phase shape).
    assert.strictEqual(res.body.trend.length, 6);
    const now = new Date();
    const currentLabel = new Date(now.getFullYear(), now.getMonth(), 1)
      .toLocaleString("default", { month: "short" });
    assert.strictEqual(res.body.trend[res.body.trend.length - 1].month, currentLabel);
    assert.ok(res.body.trend.every((b) => typeof b.salary === "number"));
  } finally {
    restorePayrollInputs(originals);
    if (savedKeys.id !== undefined) process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

test("payroll controller (PG): an operation reaches exactly one datasource", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  Employee.findById = async () => employeeDoc();
  const mongoWrites = [];
  const originalCreate = PayrollRecord.create;
  const originalFindByIdAndUpdate = PayrollRecord.findByIdAndUpdate;
  PayrollRecord.create = async (data) => { mongoWrites.push(data); return null; };
  PayrollRecord.findByIdAndUpdate = async () => { mongoWrites.push("update"); return null; };
  try {
    const before = (await pgQuery("SELECT COUNT(*)::int AS n FROM payroll_records"))[0].n;
    const res = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2027-01", paymentMethod: "Cash" }, user: { name: "Admin" } },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    const after = (await pgQuery("SELECT COUNT(*)::int AS n FROM payroll_records"))[0].n;
    assert.strictEqual(after, before + 1, "exactly one PostgreSQL row was written");
    assert.strictEqual(mongoWrites.length, 0, "the Mongoose model was not written to");
  } finally {
    PayrollRecord.create = originalCreate;
    PayrollRecord.findByIdAndUpdate = originalFindByIdAndUpdate;
    restorePayrollInputs(originals);
    if (savedKeys.id !== undefined) process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

// ─── Mongo fallback path ───────────────────────────────────────────────────
test("payroll controller (Mongo fallback): the same handlers route to Mongoose", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;

  const calls = [];
  const makeDoc = (obj, id) => ({
    ...obj,
    _id: id,
    id,
    save: async function save() { calls.push(["save", this._id]); return this; },
  });

  const original = {
    create: PayrollRecord.create,
    findOne: PayrollRecord.findOne,
    find: PayrollRecord.find,
    findByIdAndUpdate: PayrollRecord.findByIdAndUpdate,
  };
  PayrollRecord.create = async (data) => { calls.push(["create", data]); return makeDoc(data, "mongo-pay-1"); };
  PayrollRecord.findOne = async (filter) => { calls.push(["findOne", filter]); return null; };
  PayrollRecord.find = (filter) => {
    calls.push(["find", filter]);
    const q = {
      sort(arg) { calls.push(["sort", arg]); return q; },
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return q;
  };
  PayrollRecord.findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    return makeDoc({ monthKey: "2027-02", ...updates }, id);
  };
  Employee.findById = async () => employeeDoc();

  dbConfig.isDbConnected = () => false;
  try {
    const created = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2027-02", paymentMethod: "Cash" }, user: { name: "Admin" } },
      created
    );

    assert.strictEqual(created.statusCode, 200);
    assert.ok(calls.some(([name]) => name === "findOne"), "the existing-record lookup reached Mongoose");
    assert.ok(calls.some(([name]) => name === "create"), "payEmployeePayroll reached PayrollRecord.create");

    // The fallback writes nothing to PostgreSQL.
    const rows = await pgQuery(
      "SELECT id FROM payroll_records WHERE month_key = '2027-02' AND employee_id = $1",
      ["0000000000000000000000e1"]
    );
    assert.strictEqual(rows.length, 0, "the Mongo fallback did not write a PostgreSQL row");

    // The dashboard's month read also routes to Mongoose.
    calls.length = 0;
    Employee.find = () => ({ sort: () => Promise.resolve([]) });
    const dash = createMockRes();
    await payrollController.getPayrollDashboard({ query: { month: "2027-02" } }, dash);
    assert.strictEqual(dash.statusCode, 200);
    assert.ok(calls.some(([name]) => name === "find"), "the dashboard month read reached Mongoose find");
  } finally {
    PayrollRecord.create = original.create;
    PayrollRecord.findOne = original.findOne;
    PayrollRecord.find = original.find;
    PayrollRecord.findByIdAndUpdate = original.findByIdAndUpdate;
    dbConfig.isDbConnected = () => true;
    restorePayrollInputs(originals);
    if (savedKeys.id !== undefined) process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});

test("payroll controller (Mongo fallback): the Razorpay branches use the loaded document", async () => {
  const originals = stubPayrollInputs();
  const savedKeys = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
  const orders = stubRazorpayOrders();

  const calls = [];
  const makeDoc = (obj, id) => ({
    ...obj,
    _id: id,
    id,
    save: async function save() { calls.push(["save", this._id, this.status, this.razorpayOrderId]); return this; },
  });

  const original = {
    create: PayrollRecord.create,
    findOne: PayrollRecord.findOne,
    findById: PayrollRecord.findById,
  };
  PayrollRecord.create = async (data) => { calls.push(["create", data]); return makeDoc(data, "mongo-pay-2"); };
  PayrollRecord.findOne = async () => null;
  PayrollRecord.findById = async (id) => makeDoc({ monthKey: "2027-03", netSalary: 100, status: "Pending" }, id);
  Employee.findById = async () => employeeDoc();

  dbConfig.isDbConnected = () => false;
  try {
    const res = createMockRes();
    await payrollController.payEmployeePayroll(
      { params: { employeeId: "0000000000000000000000e1" }, body: { monthKey: "2027-03", paymentMethod: "UPI" }, user: { name: "Admin" } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    // The order branch mutates the loaded document and calls save(), exactly as
    // before this phase.
    assert.ok(calls.some(([name, , status]) => name === "save" && status === "Pending"),
      "the Razorpay branch saved the Mongo document in place");
    assert.strictEqual(res.body.record.razorpayOrderId, "order_ctrl_1");

    // And the verification branch does the same.
    calls.length = 0;
    const orderId = "order_ctrl_1";
    const paymentId = "pay_fb_1";
    const signature = crypto
      .createHmac("sha256", "rzp_test_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const verify = createMockRes();
    await payrollController.verifyPayrollPayment(
      { body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature, recordId: "mongo-pay-2" } },
      verify
    );
    assert.strictEqual(verify.statusCode, 200);
    assert.ok(calls.some(([name, , status]) => name === "save" && status === "Paid"),
      "verifyPayrollPayment saved the Mongo document in place");

    // No PostgreSQL row was written by either branch.
    const rows = await pgQuery("SELECT id FROM payroll_records WHERE id = 'mongo-pay-2'");
    assert.strictEqual(rows.length, 0, "the Mongo branches wrote nothing to PostgreSQL");
  } finally {
    PayrollRecord.create = original.create;
    PayrollRecord.findOne = original.findOne;
    PayrollRecord.findById = original.findById;
    dbConfig.isDbConnected = () => true;
    require("razorpay").prototype.addResources = originalRazorpayAddResources;
    restorePayrollInputs(originals);
    if (savedKeys.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = savedKeys.id;
    if (savedKeys.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = savedKeys.secret;
  }
});
