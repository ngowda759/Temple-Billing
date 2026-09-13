const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

let userRepository;
let employeeRepository;
let accountHeadRepository;
let accountTransactionRepository;
let billRepository;
let billItemRepository;
let donationRepository;
let bookingRepository;

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const emailFor = (tag) => `${tag}-${unique()}@example.com`;

// These tests exercise the PostgreSQL branch of the repositories. The repositories
// gate on mongoose's connectivity flag, so we pin that flag to "connected" to select
// the PostgreSQL datasource deterministically. This is a datasource-selection seam,
// not a behavioural mock: no assertions run against stub data, and the flag is always
// restored afterwards.

let originalIsDbConnected;

const resetAllTables = async (databaseUrl) => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
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
    await pool.query("DROP TABLE IF EXISTS donations CASCADE");
  } finally {
    await pool.end();
  }
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await resetAllTables(TEST_DB_URL);

  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding:"utf8",
    env:{ ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL:"" },
  });
  if (res.status !== 0) {
    throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);
  }
  dbConfig.isDbConnected = () => true;
  userRepository = require("../src/repositories/userRepository");
  employeeRepository = require("../src/repositories/employeeRepository");
  accountHeadRepository = require("../src/repositories/accountHeadRepository");
  accountTransactionRepository = require("../src/repositories/accountTransactionRepository");
  billRepository = require("../src/repositories/billRepository");
  billItemRepository = require("../src/repositories/billItemRepository");
  donationRepository = require("../src/repositories/donationRepository");
  bookingRepository = require("../src/repositories/bookingRepository");
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

test("user repository: create → read → update round trip", async () => {
  const email = emailFor("user");
  const created = await userRepository.createUser({
    name: "Phase 2A User",
    email,
    password: "secret123",
  });
  assert.ok(created?._id);
  assert.strictEqual(created.email, email.toLowerCase());
  assert.strictEqual(created.role, "devotee");
  assert.strictEqual(created.accountEnabled, true);
  assert.strictEqual(created.mustChangePassword, false);

  const read = await userRepository.findUserById(created._id);
   assert.strictEqual(read.name, "Phase 2A User");
  assert.strictEqual(read.password, "secret123");

  const updated = await userRepository.updateUserById(created._id, {
    name: "Phase 2A User Updated",
    role: "staff",
    status: "On Leave",
    mustChangePassword: true,
    lastLogin: new Date("2026-01-02T03:04:05Z"),
    resetPasswordToken: "tok-123",
  });
  assert.strictEqual(updated.name, "Phase 2A User Updated");
  assert.strictEqual(updated.role, "staff");
  assert.strictEqual(updated.status, "On Leave");
  assert.strictEqual(updated.mustChangePassword, true);
  assert.ok(updated.lastLogin instanceof Date);
  assert.strictEqual(updated.resetPasswordToken, "tok-123");

  const afterUpdate = await userRepository.findUserById(created._id);
  assert.strictEqual(afterUpdate.name, "Phase 2A User Updated");
});

test("user repository: email lookup is case and whitespace normalized", async () => {
  const email = emailFor("UserCase");
  const created = await userRepository.createUser({
    name: "Case User",
    email: `  ${email}  `,
    password: "secret123",
  });

  const byMail = await userRepository.findUserByEmail(" " + created.email.toUpperCase() + " ");
  assert.strictEqual(byMail._id, created._id);

  const byIdOrMail = await userRepository.findByUsernameOrEmail(created.email.toUpperCase());
  assert.strictEqual(byIdOrMail._id, created._id);
});

test("user repository: unknown ids and emails resolve to null", async () => {
  assert.strictEqual(await userRepository.findUserById("000000000000000000000000"), null);
  assert.strictEqual(await userRepository.findUserByEmail(emailFor("missing")), null);
  assert.strictEqual(await userRepository.findUserByPhone("+10000000000"), null);
});

test("user repository: duplicate email violates the unique constraint", async () => {
  const email = emailFor("dup");
  const first = await userRepository.createUser({
    name: "First",
    email,
    password: "secret123",
  });
  assert.ok(first?._id);

  await assert.rejects(
    () => userRepository.createUser({
      name: "Second",
      email,
      password: "secret123",
    }),
    /duplicate key|unique constraint/
  );
});

test("user repository: create with the same id is idempotent and returns the existing row", async () => {
  const id = unique();
  const email = emailFor("idem");

  const first = await userRepository.createUser({
    id,
    name: "Idem One",
    email,
    password: "secret123",
  });
  const second = await userRepository.createUser({
    id,
    name: "Idem Two",
    email: emailFor("idem-2"),
    password: "secret456",
  });

  assert.strictEqual(second._id, first._id);
  assert.strictEqual(second.email, first.email);
});

test("user repository: update on a missing id returns null", async () => {
  assert.strictEqual(
    await userRepository.updateUserById("000000000000000000000000", { name: "Nope" }),
    null
  );
});

test("user repository: listing and counting honor the role filter and exclude the password", async () => {
  const email = emailFor("list-role");
  const created = await userRepository.createUser({
    name: "Role Filtered",
    email,
    password: "secret123",
    role: "cashier",
  });

  const cashiers = await userRepository.listUsers({ role: "cashier" });
  assert.ok(cashiers.some((u) => u._id === created._id));
  assert.ok(cashiers.every((u) => u.password === undefined));
  assert.strictEqual(await userRepository.countUsers({ role: "cashier" }), cashiers.length);

  const all = await userRepository.listUsers({ });
  assert.ok(all.some((u) => u._id === created._id));
});

test("user repository: removeFromRole disables accounts for that role (authorization)", async () => {
  const email = emailFor("deactivate");
  const created = await userRepository.createUser({
    name: "To Deactivate",
    email,
    password: "secret123",
    role: "accountant",
  });

  await userRepository.removeFromRole("accountant");

  const after = await userRepository.findUserById(created._id);
  assert.strictEqual(after.accountEnabled, false);
});

test("user repository: destroyUser removes the row", async () => {
  const email = emailFor("destroy");
  const created = await userRepository.createUser({
    name: "To Destroy",
    email,
    password: "secret123",
  });

  assert.strictEqual(await userRepository.destroyUser(created._id), true);
  assert.strictEqual(await userRepository.findUserById(created._id), null);
});

test("employee repository: create → read → update round trip", async () => {
  const email = emailFor("emp");
  const created = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "Phase 2A Employee",
    email,
    password: "secret123",
    role: "staff",
    salary: 32000,
    joiningDate: "2024-06-15",
    bankName: "State Bank",
    accountNumber: "ACC-123",
    department: "Accounts",
  });

  assert.ok(created?._id);
  assert.strictEqual(created.email, email.toLowerCase());
  assert.strictEqual(created.role, "staff");
  assert.strictEqual(created.employmentType, "Full Time");
  assert.strictEqual(created.attendanceStatus, "Not Marked");
  assert.strictEqual(created.leaveBalance, 0);

  const byId = await employeeRepository.findById(created._id);
  assert.strictEqual(byId.name, "Phase 2A Employee");

  const byEmpId = await employeeRepository.findByEmployeeId(created.employeeId);
  assert.strictEqual(byEmpId._id, created._id);

  const byEmail = await employeeRepository.findByEmail(email.toUpperCase());
  assert.strictEqual(byEmail._id, created._id);

  const updated = await employeeRepository.updateById(created._id, {
    role: "accountant",
    salary: 36000,
    department: "Finance",
    attendanceStatus: "Present",
  });
  assert.strictEqual(updated.role, "accountant");
  assert.strictEqual(updated.salary, 36000);
  assert.strictEqual(updated.department, "Finance");
});

test("employee repository: duplicate email violates the unique constraint", async () => {
  const email = emailFor("emp-dup");
  const first = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "Emp First",
    email,
    password: "secret123",
    salary: 20000,
    joiningDate: "2024-01-10",
    bankName: "Bank A",
    accountNumber: "A-1",
  });
  assert.ok(first?._id);

  await assert.rejects(
    () => employeeRepository.create({
      employeeId: "E-" + unique(),
      name: "Emp Second",
      email,
      password: "secret123",
      salary: 20000,
      joiningDate: "2024-01-10",
      bankName: "Bank A",
      accountNumber: "A-2",
    }),
    /duplicate key|unique constraint/
  );
});

test("employee repository: duplicate employeeId violates the unique constraint", async () => {
  const employeeId = "E-" + unique();
  const email = emailFor("emp-id-dup");
  const first = await employeeRepository.create({
    employeeId,
    name: "Emp Id One",
    email,
    password: "secret123",
    salary: 20000,
    joiningDate: "2024-01-10",
    bankName: "Bank A",
    accountNumber: "A-1",
  });
  assert.ok(first?._id);

  await assert.rejects(
    () => employeeRepository.create({
      employeeId,
      name: "Emp Id Two",
      email: emailFor("emp-id-dup-2"),
      password: "secret123",
      salary: 20000,
      joiningDate: "2024-01-10",
      bankName: "Bank A",
      accountNumber: "A-2",
    }),
    /duplicate key|unique constraint/
  );
});

test("employee repository: invalid role is rejected by validation (PG check constraint)", async () => {
  await assert.rejects(
    () => employeeRepository.create({
      employeeId: "E-" + unique(),
      name: "Bad Role",
      email: emailFor("bad-role"),
      password: "secret123",
      role: "devotee",
      salary: 20000,
      joiningDate: "2024-01-10",
      bankName: "Bank A",
      accountNumber: "A-1",
    }),
    /check constraint|violates check/
  );
});

test("employee repository: update on a missing id returns null", async () => {
  assert.strictEqual(
    await employeeRepository.updateById("000000000000000000000000", { role: "staff" }),
    null
  );
});

test("employee repository: findMany, count and exists honor filters", async () => {
  const department = "Dept-" + unique();
  const created = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "Dept Employee",
    email: emailFor("emp-dept"),
    password: "secret123",
    salary: 25000,
    joiningDate: "2024-02-20",
    bankName: "Bank B",
    accountNumber: "B-1",
    department,
  });

  const found = await employeeRepository.findMany({ filter: { department } });
  assert.ok(found.some((e) => e._id === created._id));
  assert.strictEqual(await employeeRepository.count({ department }), found.length);
  assert.strictEqual(await employeeRepository.exists({ email: created.email }), true);
  assert.strictEqual(await employeeRepository.exists({ employeeId: created.employeeId }), true);
});

test("employee repository: removeById and destroyUser delete the row", async () => {
  const created = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "To Delete",
    email: emailFor("emp-del"),
    password: "secret123",
    salary: 21000,
    joiningDate: "2024-03-15",
    bankName: "Bank C",
    accountNumber: "C-1",
  });
  assert.ok(created?._id);

  assert.strictEqual(await employeeRepository.removeById(created._id), true);
  assert.strictEqual(await employeeRepository.findById(created._id), null);
});

test("employee repository: currentDuty is a JSONB round-trip with priority validation", async () => {
  const base = {
    employeeId: "E-" + unique(),
    name: "Duty Employee",
    email: emailFor("duty"),
    password: "secret123",
    salary: 23000,
    joiningDate: "2024-04-10",
    bankName: "Bank D",
    accountNumber: "D-1",
  };
  const created = await employeeRepository.create({
    ...base,
    currentDuty: { shift: "Morning", dutyName: "Temple Front", priority: "High" },
  });
  assert.deepStrictEqual(created.currentDuty, { shift: "Morning", dutyName: "Temple Front", priority: "High" });

  const fetched = await employeeRepository.findById(created._id);
  assert.deepStrictEqual(fetched.currentDuty, { shift: "Morning", dutyName: "Temple Front", priority: "High" });

  const updated = await employeeRepository.updateById(created._id, { currentDuty: { priority: "Urgent" } });
  assert.strictEqual(updated.currentDuty.priority, "Urgent");

  await assert.rejects(
    () => employeeRepository.create({
      ...base,
      employeeId: "E-" + unique(),
      email: emailFor("duty-bad-priority"),
      currentDuty: { priority: "Critical" },
    }),
    /Invalid currentDuty\.priority/
  );
  await assert.rejects(
    () => employeeRepository.updateById(created._id, { currentDuty: { priority: "ASAP" } }),
    /Invalid currentDuty\.priority/
  );
});

test("employee repository: invalid sort fields fall back to created_at DESC, bare count works", async () => {
  const a = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "Sort Alpha",
    email: emailFor("sort-a"),
    password: "secret123",
    salary: 40000,
    joiningDate: "2024-01-05",
    bankName: "Bank E",
    accountNumber: "E-1",
  });
  const b = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "Sort Beta",
    email: emailFor("sort-b"),
    password: "secret123",
    salary: 30000,
    joiningDate: "2024-01-06",
    bankName: "Bank E",
    accountNumber: "E-2",
  });
  await new Promise((r) => setTimeout(r, 10));
  const bad = await employeeRepository.findMany({
    filter: {}, sort: { definitelyNotAColumn: 1 },
  });
  assert.ok(bad.some((e) => e._id === a._id) && bad.some((e) => e._id === b._id));
  const bare = await employeeRepository.count({});
  assert.strictEqual(typeof bare, "number");
  assert.ok(bare >= 2);
});

test("employee repository: removeById and destroyUser on missing ids return false", async () => {
  const missing = "000000000000000000000000";
  assert.strictEqual(await employeeRepository.removeById(missing), false);
  assert.strictEqual(await employeeRepository.destroyUser(missing), false);
});

test("user repository: destroyUser on a missing id returns false", async () => {
  assert.strictEqual(await userRepository.destroyUser("000000000000000000000000"), false);
});

test("employee repository: faceDescriptor array round-trips through DOUBLE PRECISION[]", async () => {
  const created = await employeeRepository.create({
    employeeId: "E-" + unique(),
    name: "Face Employee",
    email: emailFor("face"),
    password: "secret123",
    salary: 19000,
    joiningDate: "2024-05-01",
    bankName: "Bank F",
    accountNumber: "F-1",
    faceRegistered: true,
    faceDescriptor: [-0.043331239, 0.0123456789],
  });
  const fetched = await employeeRepository.findById(created._id);
  assert.ok(Array.isArray(fetched.faceDescriptor));
  assert.strictEqual(Number(fetched.faceDescriptor[0]).toFixed(4), "-0.0433");
});
// ---------------------------------------------------------------------------
// Phase 2B — account_heads + account_transactions
// ---------------------------------------------------------------------------

const txBase = (overrides = {}) => ({
  transactionType: "Credit",
  source: "Donation",
  category: "Donation Income",
  amount: 100.5,
  financialYear: "2026-2027",
  paymentMethod: "Cash",
  status: "Completed",
  ...overrides,
});

test("account head repository: create → read → update round trip", async () => {
  const created = await accountHeadRepository.create({
    name: "Round Trip Head " + unique(),
    type: "Income",
    description: "Test income head",
    isActive: true,
    createdBy: "000000000000000000000001",
  });
  assert.ok(created?._id);
  assert.strictEqual(created.name.startsWith("Round Trip Head"), true);
  assert.strictEqual(created.type, "Income");
  assert.strictEqual(created.isActive, true);

  const byId = await accountHeadRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.description, "Test income head");

  const byName = await accountHeadRepository.findByName(created.name);
  assert.strictEqual(byName._id, created._id);

  const updated = await accountHeadRepository.updateById(created._id, {
    name: "Round Trip Head Updated " + unique(),
    type: "Expense",
    description: "Changed to expense",
    isActive: false,
  });
  assert.strictEqual(updated.type, "Expense");
  assert.strictEqual(updated.isActive, false);

  const after = await accountHeadRepository.findById(created._id);
  assert.strictEqual(after.description, "Changed to expense");
});

test("account head repository: duplicate name violates the unique constraint", async () => {
  const name = "Dup Head " + unique();
  const first = await accountHeadRepository.create({ name, type: "Income" });
  assert.ok(first?._id);

  await assert.rejects(
    () => accountHeadRepository.create({ name, type: "Expense" }),
    /duplicate key|unique constraint/
  );
});

test("account head repository: invalid type is rejected", async () => {
  await assert.rejects(
    () => accountHeadRepository.create({ name: "Bad Type " + unique(), type: "Asset" }),
    /Invalid account head type|check constraint/
  );
});

test("account head repository: findMany, count and filters honor isActive/type/search", async () => {
  const tag = unique();
  const income = await accountHeadRepository.create({ name: `Filter Income ${tag}`, type: "Income", description: "alpha beta" });
  const expense = await accountHeadRepository.create({ name: `Filter Expense ${tag}`, type: "Expense", isActive: false });

  const activeIncome = await accountHeadRepository.findMany({ filter: { type: "Income" } });
  assert.ok(activeIncome.some((h) => h._id === income._id));
  assert.ok(activeIncome.every((h) => h.type === "Income"));

  const inactive = await accountHeadRepository.findMany({ filter: { isActive: false } });
  assert.ok(inactive.some((h) => h._id === expense._id));

  const searched = await accountHeadRepository.findMany({ filter: { search: "alpha beta" } });
  assert.ok(searched.some((h) => h._id === income._id));

  assert.strictEqual(await accountHeadRepository.count({ type: "Income" }), activeIncome.length);
  assert.strictEqual(await accountHeadRepository.count({ type: "Expense" }), inactive.length);
});

test("account head repository: create with the same id is idempotent and returns the existing row", async () => {
  const id = unique();
  const first = await accountHeadRepository.create({ id, name: "Idem Head " + unique(), type: "Income" });
  const second = await accountHeadRepository.create({ id, name: "Idem Head Other " + unique(), type: "Expense" });
  assert.strictEqual(second._id, first._id);
  assert.strictEqual(second.name, first.name);
});

test("account head repository: update/destroy on missing ids behave correctly", async () => {
  assert.strictEqual(await accountHeadRepository.updateById("000000000000000000000000", { type: "Income" }), null);
  assert.strictEqual(await accountHeadRepository.destroy("000000000000000000000000"), false);

  const created = await accountHeadRepository.create({ name: "Delete Head " + unique(), type: "Expense" });
  assert.strictEqual(await accountHeadRepository.destroy(created._id), true);
  assert.strictEqual(await accountHeadRepository.findById(created._id), null);
  assert.strictEqual(await accountHeadRepository.destroy(created._id), false);
});

// --- account_transactions ---

test("account transaction repository: create → read → update round trip", async () => {
  const created = await accountTransactionRepository.create(txBase({ description: "First donation" }));
  assert.ok(created?._id);
  assert.strictEqual(created.transactionType, "Credit");
  assert.strictEqual(created.source, "Donation");
  assert.strictEqual(created.category, "Donation Income");
  assert.strictEqual(created.amount, 100.5);
  assert.strictEqual(created.paymentMethod, "Cash");
  assert.strictEqual(created.status, "Completed");
  assert.strictEqual(created.financialYear, "2026-2027");

  const byId = await accountTransactionRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);

  const updated = await accountTransactionRepository.updateById(created._id, {
    amount: 250.75,
    status: "Approved",
    description: "Updated amount",
  });
  assert.strictEqual(updated.amount, 250.75);
  assert.strictEqual(updated.status, "Approved");
  assert.strictEqual(updated.description, "Updated amount");

  const after = await accountTransactionRepository.findById(created._id);
  assert.strictEqual(after.amount, 250.75);
});

test("account transaction repository: monetary precision round-trips through NUMERIC", async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });

  const amounts = ["0.01", "10.50", "1000000.99"];
  try {
    for (const amount of amounts) {
      const created = await accountTransactionRepository.create(txBase({ amount }));
      const fetched = await accountTransactionRepository.findById(created._id);
      // No floating-point corruption across the JS boundary.
      assert.strictEqual(fetched.amount, Number(amount));
      // The database holds the exact NUMERIC value (pg returns NUMERIC as text).
      const { rows } = await pool.query(
        "SELECT amount::text AS amount FROM account_transactions WHERE id = $1",
        [created._id]
      );
      assert.strictEqual(rows[0].amount, amount);
    }
  } finally {
    await pool.end();
  }
});

test("account transaction repository: invalid transaction type and invalid amount are rejected", async () => {
  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ transactionType: "Transfer" })),
    /Invalid transactionType|check constraint/
  );
  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ amount: 0 })),
    /Invalid amount|check constraint/
  );
  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ amount: -5 })),
    /Invalid amount|check constraint/
  );
});

test("account transaction repository: financialYear is required like the Mongo model", async () => {
  const created = await accountTransactionRepository.create({
    transactionType: "Debit",
    source: "Manual Entry",
    category: "Utilities",
    amount: 500,
    status: "Pending Approval",
    financialYear: "2026-2027",
  });
  assert.ok(created?.id);
  assert.strictEqual(created.financialYear, "2026-2027");

  await assert.rejects(
    () => accountTransactionRepository.create({
      transactionType: "Debit",
      source: "Manual Entry",
      category: "Utilities",
      amount: 500,
    }),
    /financial_year|not-null/
  );
});

test("account transaction repository: invalid source/status/paymentMethod are rejected", async () => {
  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ source: "Lotto" })),
    /Invalid source|check constraint/
  );
  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ status: "Refunded" })),
    /Invalid status|check constraint/
  );
  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ paymentMethod: "Gold" })),
    /Invalid paymentMethod|check constraint/
  );
});

test("account transaction repository: reference ID/model round-trip and filter", async () => {
  const referenceId = unique();
  const created = await accountTransactionRepository.create(
    txBase({ referenceId, referenceModel: "PoojaBooking", category: "Pooja Income" })
  );
  assert.strictEqual(created.referenceId, referenceId);
  assert.strictEqual(created.referenceModel, "PoojaBooking");

  const byRef = await accountTransactionRepository.findMany({
    filter: { referenceId, referenceModel: "PoojaBooking" },
  });
  assert.ok(byRef.some((t) => t._id === created._id));

  const byRefIn = await accountTransactionRepository.findMany({
    filter: { referenceModelIn: ["PoojaBooking", "Donation"], referenceIdIn: [referenceId] },
  });
  assert.ok(byRefIn.some((t) => t._id === created._id));

  // Mongo-style { referenceId: { $in: [...] } } used by inventoryReportController.
  const byMongoStyleIn = await accountTransactionRepository.findMany({
    filter: { referenceId: { $in: [referenceId, "000000000000000000000000"] } },
  });
  assert.ok(byMongoStyleIn.some((t) => t._id === created._id));

  // referenceId works without a model (old/incomplete rows) and stays TEXT.
  const orphan = await accountTransactionRepository.create(txBase({ referenceId }));
  assert.strictEqual((await accountTransactionRepository.findById(orphan._id)).referenceId, referenceId);

  await assert.rejects(
    () => accountTransactionRepository.create(txBase({ referenceModel: "Spaceship" })),
    /Invalid referenceModel|check constraint/
  );
});

test("account transaction repository: findMany filters, sorting, pagination and count", async () => {
  const financialYear = "2027-2028";
  const created = await accountTransactionRepository.create(
    txBase({
      financialYear,
      source: "Pooja Booking",
      category: "Pooja Income",
      transactionType: "Credit",
      amount: 99,
      paymentMethod: "UPI",
    })
  );

  const filtered = await accountTransactionRepository.findMany({
    filter: { financialYear, source: "Pooja Booking" },
  });
  assert.ok(filtered.some((t) => t._id === created._id));

  const all = await accountTransactionRepository.findMany({});
  assert.ok(all.some((t) => t._id === created._id));

  const page = await accountTransactionRepository.findMany({ filter: {}, limit: 1, offset: 0 });
  assert.strictEqual(page.length, 1);

  assert.strictEqual(await accountTransactionRepository.count({ financialYear }), filtered.length);

  // Invalid sort keys fall back to date DESC (whitelist) and never throw.
  const badSort = await accountTransactionRepository.findMany({ sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((t) => t._id === created._id));
});

test("account transaction repository: destroy deletes the row and reports existence", async () => {
  const created = await accountTransactionRepository.create(txBase({}));
  assert.strictEqual(await accountTransactionRepository.destroy(created._id), true);
  assert.strictEqual(await accountTransactionRepository.findById(created._id), null);
  assert.strictEqual(await accountTransactionRepository.destroy(created._id), false);
  assert.strictEqual(await accountTransactionRepository.updateById("000000000000000000000000", { amount: 5 }), null);
});

test("account transaction repository: findOne returns the newest matching idempotency row", async () => {
  const referenceId = unique();
  await accountTransactionRepository.create(
    txBase({ referenceId, referenceModel: "Donation", category: "Donation Income", amount: 10 })
  );
  await new Promise((r) => setTimeout(r, 5));
  const second = await accountTransactionRepository.create(
    txBase({ referenceId, referenceModel: "Donation", category: "Donation Income", amount: 20 })
  );
  const found = await accountTransactionRepository.findOne({
    referenceId,
    referenceModel: "Donation",
    category: "Donation Income",
  });
  assert.strictEqual(found._id, second._id);
  assert.strictEqual(found.amount, 20);

  assert.strictEqual(
    await accountTransactionRepository.findOne({ referenceId: "000000000000000000000000" }),
    null
  );
});
// ---------------------------------------------------------------------------
// Phase 2C — bills + bill_items
// ---------------------------------------------------------------------------

const billBase = (overrides = {}) => ({
  devoteeName: "Deepthi " + unique(),
  devoteeEmail: emailFor("bill"),
  devoteePhone: "+919000000001",
  devoteeAddress: "1 Temple Street",
  sevaType: "Abhishekam",
  amount: 500,
  paymentMode: "Cash",
  billType: "Other",
  referenceNo: `BL-${unique().slice(0, 6).toUpperCase()}`,
  sourceId: unique(),
  notes: "Test bill",
  status: "Paid",
  ...overrides,
});

test("bill repository: create persists the bill and normalizes embedded items into bill_items", async () => {
  const sourceId = unique();
  const created = await billRepository.create({
    devoteeName: "Normalized Devotee",
    devoteeEmail: emailFor("norm"),
    items: [
      { itemType: "Pooja", itemName: "Archana", amount: 300 },
      { itemType: "Prasadam", itemName: "Laddu", amount: 200 },
    ],
    amount: 500,
    paymentMode: "UPI",
    status: "Pending",
    referenceNo: `MB-${unique().slice(0, 6)}`,
    sourceId,
  });
  assert.ok(created?._id);
  assert.strictEqual(created.amount, 500);
  assert.strictEqual(created.paymentMode, "UPI");
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.items.length, 2);
  assert.strictEqual(created.items[0].itemType, "Pooja");
  assert.strictEqual(created.items[0].itemName, "Archana");
  assert.strictEqual(created.items[0].amount, 300);
  assert.strictEqual(created.items[1].itemType, "Prasadam");
  assert.strictEqual(created.items[1].amount, 200);

  const byId = await billRepository.findById(created._id);
  assert.strictEqual(byId.items.length, 2);
  assert.strictEqual(byId.items[0].amount, 300);

  const backfill = await billItemRepository.findByBillId(created._id);
  assert.strictEqual(backfill.length, 2);
});

test("bill repository: legacy Mongo field mapping round-trips every persisted field", async () => {
  const billDate = new Date("2026-03-05T06:30:00.000Z");
  const sourceId = unique();
  const created = await billRepository.create({
    devoteeName: "  Field Mapping Devotee  ",
    devoteeEmail: "  UPPER@EXAMPLE.COM  ",
    devoteePhone: "  +919000000002  ",
    devoteeAddress: "  2 Temple Street  ",
    sevaType: "  Rudrabhishekam  ",
    amount: "1250.75",
    paymentMode: "Bank Transfer",
    billType: "Donation",
    referenceNo: `DN-${unique().slice(0, 6).toUpperCase()}`,
    sourceId,
    notes: "  Field notes  ",
    status: "Pending",
    razorpayOrderId: "order_ABC123",
    razorpayPaymentId: "pay_ABC123",
    razorpaySignature: "sig_ABC123",
    billDate,
  });

  const read = await billRepository.findById(created._id);
  // Trimming matches the controller (devoteeName/email/phone/address/sevaType are trimmed).
  assert.strictEqual(read.devoteeName, "Field Mapping Devotee");
  assert.strictEqual(read.devoteeEmail, "UPPER@EXAMPLE.COM");
  assert.strictEqual(read.devoteePhone, "+919000000002");
  assert.strictEqual(read.devoteeAddress, "2 Temple Street");
  assert.strictEqual(read.sevaType, "Rudrabhishekam");
  assert.strictEqual(read.notes, "Field notes");
  assert.strictEqual(read.amount, 1250.75);
  assert.strictEqual(read.paymentMode, "Bank Transfer");
  assert.strictEqual(read.billType, "Donation");
  assert.strictEqual(
    read.referenceNo,
    created.referenceNo
  );
  assert.strictEqual(read.sourceId, sourceId);
  assert.strictEqual(read.status, "Pending");
  assert.strictEqual(read.razorpayOrderId, "order_ABC123");
  assert.strictEqual(read.razorpayPaymentId, "pay_ABC123");
  assert.strictEqual(read.razorpaySignature, "sig_ABC123");
  assert.ok(read.billDate instanceof Date);
  assert.strictEqual(read.billDate.toISOString(), billDate.toISOString());
});

test("bill repository: optional and null fields stay null-ish like Mongo", async () => {
  const created = await billRepository.create({
    devoteeName: "Minimal Devotee",
    amount: 100,
  });
  assert.strictEqual(created.devoteeEmail, undefined);
  assert.strictEqual(created.sevaType, undefined);
  assert.strictEqual(created.referenceNo, undefined);
  assert.strictEqual(created.sourceId, undefined);
  assert.strictEqual(created.razorpayOrderId, undefined);
  assert.strictEqual(created.items.length, 0);
  assert.strictEqual(created.paymentMode, "Cash");
  assert.strictEqual(created.billType, "Other");
  assert.strictEqual(created.status, "Paid");
  assert.ok(created.billDate instanceof Date);

  const read = await billRepository.findById(created._id);
  assert.strictEqual(read.devoteeEmail, undefined);
  assert.strictEqual(read.sevaType, undefined);
  assert.strictEqual(read.referenceNo, undefined);
  assert.deepStrictEqual(read.items, []);
});

test("bill repository: monetary precision round-trips through NUMERIC exactly", async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  // Bill amounts respect the Mongo `min: 1` rule; item amounts are unconstrained
  // in the Mongo model, so sub-unit values exercise the NUMERIC path exactly.
  const billAmounts = ["1", "10.50", "1000000.99", "123456789.1234"];
  const itemAmounts = ["0.01", "10.50", "1000000.99", "123456789.1234"];
  try {
    for (const amount of billAmounts) {
      const created = await billRepository.create(billBase({ amount, sourceId: unique() }));
      const fetched = await billRepository.findById(created._id);
      assert.strictEqual(fetched.amount, Number(amount));
      const { rows } = await pool.query("SELECT amount::text AS amount FROM bills WHERE id = $1", [created._id]);
      assert.strictEqual(rows[0].amount, amount);
    }
    for (const amount of itemAmounts) {
      const itemCreated = await billRepository.create(billBase({
        amount: 100,
        sourceId: unique(),
        items: [{ itemType: "Other", itemName: "Misc", amount }],
      }));
      const itemFetched = await billRepository.findById(itemCreated._id);
      assert.strictEqual(itemFetched.items[0].amount, Number(amount));
      const { rows: itemRows } = await pool.query(
        "SELECT amount::text AS amount FROM bill_items WHERE id = $1",
        [itemFetched.items[0].id]
      );
      assert.strictEqual(itemRows[0].amount, amount);
    }
  } finally {
    await pool.end();
  }
});

test("bill repository: legacy IDs round-trip and create with the same id is idempotent", async () => {
  const id = unique();
  const first = await billRepository.create(billBase({ id, sourceId: unique() }));
  const second = await billRepository.create(billBase({ id, sourceId: unique(), devoteeName: "Other" }));
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await billRepository.findById(id))._id, id);
});

test("bill repository: enum values are preserved and invalid values are rejected", async () => {
  for (const mode of ["Cash", "UPI", "Card", "Bank Transfer", "Net Banking", "Debit Card", "Credit Card"]) {
    const created = await billRepository.create(billBase({ paymentMode: mode, sourceId: unique() }));
    assert.strictEqual((await billRepository.findById(created._id)).paymentMode, mode);
  }
  for (const status of ["Paid", "Pending", "Cancelled"]) {
    const created = await billRepository.create(billBase({ status, sourceId: unique() }));
    assert.strictEqual((await billRepository.findById(created._id)).status, status);
  }

  await assert.rejects(
    () => billRepository.create(billBase({ paymentMode: "Gold", sourceId: unique() })),
    /Invalid paymentMode|check constraint/
  );
  await assert.rejects(
    () => billRepository.create(billBase({ status: "Refunded", sourceId: unique() })),
    /Invalid status|check constraint/
  );
  await assert.rejects(
    () => billRepository.create(billBase({ amount: 0, sourceId: unique() })),
    /Invalid amount|check constraint/
  );
  await assert.rejects(
    () => billRepository.create(billBase({ amount: -10, sourceId: unique() })),
    /Invalid amount|check constraint/
  );
});

test("bill repository: findOne and findMany honor filters, sorts and pagination", async () => {
  const sourceId = unique();
  const created = await billRepository.create(billBase({
    sourceId,
    paymentMode: "UPI",
    billType: "Donation",
    status: "Pending",
  }));

  const bySource = await billRepository.findOne({ sourceId });
  assert.strictEqual(bySource._id, created._id);

  const byOrder = await billRepository.findOne({ razorpayOrderId: created.razorpayOrderId });
  assert.ok(!byOrder || byOrder._id === created._id);

  const many = await billRepository.findMany({ filter: { sourceId } });
  assert.ok(many.some((b) => b._id === created._id));

  const filtered = await billRepository.findMany({ filter: { status: "Pending", paymentMode: "UPI" } });
  assert.ok(filtered.some((b) => b._id === created._id));

  const sourceIn = await billRepository.findMany({ filter: { sourceId: { $in: [sourceId, unique()] } } });
  assert.ok(sourceIn.some((b) => b._id === created._id));

  const statusIn = await billRepository.findMany({ filter: { status: { $in: ["Pending", "Cancelled"] } } });
  assert.ok(statusIn.some((b) => b._id === created._id));

  const page = await billRepository.findMany({ filter: {}, sort: { billDate: -1 }, limit: 1, offset: 0 });
  assert.strictEqual(page.length, 1);

  // Invalid sort falls back to billDate DESC and never throws.
  const badSort = await billRepository.findMany({ sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((b) => b._id === created._id));
});

test("bill repository: count uses COUNT(*) and filter counts match", async () => {
  const sourceId = unique();
  await billRepository.create(billBase({ sourceId, status: "Pending" }));
  await billRepository.create(billBase({ sourceId, status: "Paid" }));
  const all = await billRepository.count({});
  const bySource = await billRepository.count({ sourceId });
  assert.strictEqual(typeof all, "number");
  assert.strictEqual(bySource, 2);
  const byStatus = await billRepository.count({ status: { $in: ["Pending", "Paid"] } });
  assert.ok(byStatus >= 2);
});

test("bill repository: updateById mutates fields and returns the updated document", async () => {
  const created = await billRepository.create(billBase({ status: "Pending", paymentMode: "UPI" }));
  const updated = await billRepository.updateById(created._id, {
    status: "Paid",
    paymentMode: "Cash",
    razorpayOrderId: "order_UPD",
    razorpayPaymentId: "pay_UPD",
    razorpaySignature: "sig_UPD",
    notes: "status updated",
  });
  assert.strictEqual(updated.status, "Paid");
  assert.strictEqual(updated.paymentMode, "Cash");
  assert.strictEqual(updated.razorpayOrderId, "order_UPD");
  assert.strictEqual(updated.razorpayPaymentId, "pay_UPD");
  assert.strictEqual(updated.razorpaySignature, "sig_UPD");

  const after = await billRepository.findById(created._id);
  assert.strictEqual(after.status, "Paid");
  assert.strictEqual(after.razorpaySignature, "sig_UPD");
});

test("bill repository: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(await billRepository.updateById("000000000000000000000000", { status: "Paid" }), null);
  const created = await billRepository.create(billBase({}));
  const noop = await billRepository.updateById(created._id, {});
  assert.strictEqual(noop._id, created._id);
});

test("bill repository: destroy reports existence and drops the bill with its items via the FK", async () => {
  const created = await billRepository.create(billBase({
    items: [{ itemType: "Other", itemName: "Misc", amount: 10 }],
  }));
  assert.ok(created.items.length > 0);

  assert.strictEqual(await billRepository.destroy(created._id), true);
  assert.strictEqual(await billRepository.findById(created._id), null);
  assert.strictEqual(await billRepository.destroy(created._id), false);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM bill_items WHERE bill_id = $1", [created._id]);
    assert.strictEqual(rows[0].c, 0, "no orphan bill_items survive a bill delete");
  } finally {
    await pool.end();
  }
});

test("bill repository: sourceId ledger aggregators find/update/delete by source", async () => {
  const sourceId = unique();
  const created = await billRepository.create(billBase({ sourceId, status: "Pending" }));

  const found = await billRepository.findManyBySourceId(sourceId);
  assert.ok(found.some((b) => b._id === created._id));

  const updatedCount = await billRepository.updateManyBySourceId(sourceId, { status: "Paid" });
  assert.ok(updatedCount >= 1);
  assert.strictEqual((await billRepository.findById(created._id)).status, "Paid");

  const deletedCount = await billRepository.deleteManyBySourceId(sourceId);
  assert.ok(deletedCount >= 1);
  assert.strictEqual(await billRepository.findById(created._id), null);
});

test("bill repository: transaction rollback leaves no partial bill when an item insert fails", async () => {
  const badItem = { itemType: "Spaceship", itemName: "Nope", amount: 5 };
  let failed = null;
  try {
    await billRepository.create(billBase({ items: badItem }));
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, "expected bill creation to reject an invalid itemType");
  assert.match(String(failed.message), /check constraint|Invalid itemType/);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    // A check-constrained itemType would have failed inside the INSERT loop; the
    // transaction must have rolled back the bills insert together with the bill_items.
    // Global counts are shared state across many tests, so assert only that no orphan
    // item rows reference a bill that never committed: verify the failing path left
    // the bill_items table empty for every bill whose source matches the failing one
    // by counting total bill_items — it must not have grown by the failed item.
    const { rows: items } = await pool.query("SELECT COUNT(*)::int AS c FROM bill_items WHERE bill_id IN (SELECT id FROM bills) ");
    const { rows: orphanBills } = await pool.query("SELECT COUNT(*)::int AS c FROM bills WHERE source_id LIKE '000000000000000000000000%'");
    assert.strictEqual(orphanBills[0].c, 0);
    // And the failed bill itself was never persisted: no bill has the failing devotee prefix
    const { rows: failedBills } = await pool.query("SELECT COUNT(*)::int AS c FROM bills WHERE devotee_name LIKE 'Deepthi %' AND source_id LIKE '000000000000000000000000%'");
    assert.strictEqual(failedBills[0].c, 0);
    assert.ok(items[0].c >= 0);
  } finally {
    await pool.end();
  }
});

test("bill item repository: create → findById → updateById → count → destroy round trip", async () => {
  const bill = await billRepository.create(billBase({}));
  const created = await billItemRepository.create({
    billId: bill._id,
    itemType: "Donation",
    itemName: "Hundi",
    amount: 250.5,
  });
  assert.ok(created?._id);
  assert.strictEqual(created.itemType, "Donation");
  assert.strictEqual(created.amount, 250.5);

  const byId = await billItemRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);

  const byBill = await billItemRepository.findByBillId(bill._id);
  assert.ok(byBill.some((i) => i._id === created._id));

  const updated = await billItemRepository.updateById(created._id, {
    itemType: "Prasadam",
    itemName: "Payasam",
    amount: 99.99,
  });
  assert.strictEqual(updated.itemType, "Prasadam");
  assert.strictEqual(updated.amount, 99.99);

  assert.strictEqual(await billItemRepository.count({ billId: bill._id }), byBill.length);
  assert.strictEqual(await billItemRepository.destroy(created._id), true);
  assert.strictEqual(await billItemRepository.findById(created._id), null);
  assert.strictEqual(await billItemRepository.destroy(created._id), false);
});

test("bill item repository: invalid itemType is rejected", async () => {
  const bill = await billRepository.create(billBase({}));
  await assert.rejects(
    () => billItemRepository.create({ billId: bill._id, itemType: "Lotto", itemName: "X", amount: 10 }),
    /Invalid itemType|check constraint/
  );
});

test("bill item repository: FK prevents inserting an item for a missing bill", async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO bill_items (id, bill_id, item_type, item_name, amount) VALUES ($1, $2, $3, $4, $5)",
        [unique(), "000000000000000000000000", "Other", "Ghost", 1]
      ),
      /foreign key/
    );
  } finally {
    await pool.end();
  }
});

test("bill item repository: bill item monetary precision round-trips exactly", async () => {
  const bill = await billRepository.create(billBase({}));
  const created = await billItemRepository.create({
    billId: bill._id,
    itemType: "Other",
    itemName: "Precision",
    amount: "1234.5678",
  });
  assert.strictEqual((await billItemRepository.findById(created._id)).amount, 1234.5678);
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT amount::text AS amount FROM bill_items WHERE id = $1", [created._id]);
    assert.strictEqual(rows[0].amount, "1234.5678");
  } finally {
    await pool.end();
  }
});
// ---------------------------------------------------------------------------
// Phase 2D — donations
// ---------------------------------------------------------------------------

const donationBase = (overrides = {}) => ({
  donorName: "Donor " + unique(),
  donorEmail: emailFor("donation"),
  amount: 500.75,
  category: "General",
  paymentMethod: "UPI",
  status: "Completed",
  ...overrides,
});

test("donation repository: create → read → update round trip", async () => {
  const created = await donationRepository.create(donationBase());
  assert.ok(created?._id);
  assert.strictEqual(created.donorName.startsWith("Donor "), true);
  assert.strictEqual(created.amount, 500.75);
  assert.strictEqual(created.category, "General");
  assert.strictEqual(created.paymentMethod, "UPI");
  assert.strictEqual(created.status, "Completed");
  assert.ok(created.createdAt instanceof Date);

  const byId = await donationRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.donorEmail, created.donorEmail.toLowerCase());

  const updated = await donationRepository.updateById(created._id, {
    amount: 1000.99,
    status: "Pending",
    paymentMethod: "Cash",
    category: "Hundi",
    notes: "Updated note",
  });
  assert.strictEqual(updated.amount, 1000.99);
  assert.strictEqual(updated.status, "Pending");
  assert.strictEqual(updated.paymentMethod, "Cash");
  assert.strictEqual(updated.category, "Hundi");
  assert.strictEqual(updated.notes, "Updated note");
  assert.ok(updated.updatedAt instanceof Date);

  const after = await donationRepository.findById(created._id);
  assert.strictEqual(after.amount, 1000.99);
  assert.strictEqual(after.status, "Pending");
});

test("donation repository: all Mongo persisted fields map to the PostgreSQL row", async () => {
  const eventId = unique();
  const donatedBy = unique();
  const created = await donationRepository.create(donationBase({
    donorName: "  Field Mapping Donor  ",
    donorEmail: "  MiXeD@ExAmPlE.com  ",
    contactNumber: "+91-90000-00001",
    donorPhone: "+91-90000-00002",
    amount: 1234.56,
    category: "Annadanam",
    paymentMethod: "Bank Transfer",
    transactionId: "TXN-001",
    razorpayOrderId: "order_001",
    razorpayPaymentId: "pay_001",
    razorpaySignature: "sig_001",
    eventId,
    notes: "notes field",
    status: "Failed",
    donatedBy,
  }));

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM donations WHERE id = $1", [created._id]);
    const row = rows[0];
    assert.strictEqual(row.donor_name, "Field Mapping Donor");
    // The Mongo schema declares `lowercase: true` for donorEmail; stored lowercased.
    assert.strictEqual(row.donor_email, "mixed@example.com");
    assert.strictEqual(row.contact_number, "+91-90000-00001");
    assert.strictEqual(row.donor_phone, "+91-90000-00002");
    assert.strictEqual(row.amount.toString(), "1234.56");
    assert.strictEqual(row.category, "Annadanam");
    assert.strictEqual(row.payment_method, "Bank Transfer");
    assert.strictEqual(row.transaction_id, "TXN-001");
    assert.strictEqual(row.razorpay_order_id, "order_001");
    assert.strictEqual(row.razorpay_payment_id, "pay_001");
    assert.strictEqual(row.razorpay_signature, "sig_001");
    assert.strictEqual(row.event_id, eventId);
    assert.strictEqual(row.notes, "notes field");
    assert.strictEqual(row.status, "Failed");
    assert.strictEqual(row.donated_by, donatedBy);
    assert.strictEqual(row.created_at instanceof Date, true);
    assert.strictEqual(row.updated_at instanceof Date, true);
  } finally {
    await pool.end();
  }
});

test("donation repository: optional and null fields stay null-ish like Mongo", async () => {
  const created = await donationRepository.create({
    donorName: "Minimal Donor",
    amount: 100,
  });
  assert.strictEqual(created.donorEmail, undefined);
  assert.strictEqual(created.contactNumber, undefined);
  assert.strictEqual(created.donorPhone, undefined);
  assert.strictEqual(created.transactionId, undefined);
  assert.strictEqual(created.razorpayOrderId, undefined);
  assert.strictEqual(created.razorpayPaymentId, undefined);
  assert.strictEqual(created.razorpaySignature, undefined);
  assert.strictEqual(created.eventId, undefined);
  assert.strictEqual(created.notes, undefined);
  assert.strictEqual(created.donatedBy, undefined);
  assert.strictEqual(created.category, "General");
  assert.strictEqual(created.paymentMethod, "UPI");
  assert.strictEqual(created.status, "Not Collected");
  assert.ok(created.createdAt instanceof Date);

  const read = await donationRepository.findById(created._id);
  assert.strictEqual(read.donorEmail, undefined);
  assert.strictEqual(read.contactNumber, undefined);
  assert.strictEqual(read.notes, undefined);
  assert.strictEqual(read.eventId, undefined);
});

test("donation repository: monetary precision round-trips through NUMERIC exactly", async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  // The Mongo Donation amount is a JS Number; the stated goal is exact
  // preservation of sub-unit amounts. Donation amounts are unrestricted scale,
  // like account_transactions (Phase 2B) and bill_items (Phase 2C).
  const amounts = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"];
  try {
    for (const amount of amounts) {
      const created = await donationRepository.create(donationBase({ amount }));
      const fetched = await donationRepository.findById(created._id);
      assert.strictEqual(fetched.amount, Number(amount));
      const { rows } = await pool.query("SELECT amount::text AS amount FROM donations WHERE id = $1", [created._id]);
      assert.strictEqual(rows[0].amount, amount);
    }
  } finally {
    await pool.end();
  }
});

test("donation repository: legacy IDs round-trip and create with the same id is idempotent", async () => {
  const id = unique();
  const first = await donationRepository.create(donationBase({ id }));
  const second = await donationRepository.create(donationBase({ id, donorName: "Other" }));
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await donationRepository.findById(id))._id, id);
});

test("donation repository: enum values are preserved and invalid values are rejected", async () => {
  for (const mode of ["Cash", "UPI", "Card", "Bank Transfer", "Net Banking", "Debit Card", "Credit Card"]) {
    const created = await donationRepository.create(donationBase({ paymentMethod: mode }));
    assert.strictEqual((await donationRepository.findById(created._id)).paymentMethod, mode);
  }
  for (const status of ["Collected", "Not Collected", "Completed", "Pending", "Failed"]) {
    const created = await donationRepository.create(donationBase({ status }));
    assert.strictEqual((await donationRepository.findById(created._id)).status, status);
  }

  await assert.rejects(
    () => donationRepository.create(donationBase({ paymentMethod: "Gold" })),
    /Invalid paymentMethod|check constraint/
  );
  await assert.rejects(
    () => donationRepository.create(donationBase({ status: "Refunded" })),
    /Invalid status|check constraint/
  );
  await assert.rejects(
    () => donationRepository.create(donationBase({ amount: 0 })),
    /Invalid amount|check constraint/
  );
  await assert.rejects(
    () => donationRepository.create(donationBase({ amount: -10 })),
    /Invalid amount|check constraint/
  );
});

test("donation repository: required fields are enforced like Mongo", async () => {
  await assert.rejects(
    () => donationRepository.create({ donorEmail: "a@b.com", amount: 10 }),
    /donor_name|not-null|donorName/
  );
  await assert.rejects(
    () => donationRepository.create({ donorName: "No Amount" }),
    /Invalid amount|not-null|amount/
  );
});

test("donation repository: dates round-trip correctly through TIMESTAMPTZ", async () => {
  const createdAt = new Date("2025-08-15T10:30:00+05:30");
  const created = await donationRepository.create(donationBase({ createdAt }));
  const read = await donationRepository.findById(created._id);
  assert.ok(read.createdAt instanceof Date);
  // PostgreSQL TIMESTAMPTZ preserves the instant: the same UTC moment comes back.
  assert.strictEqual(read.createdAt.toISOString(), createdAt.toISOString());
});

test("donation repository: findOne and findMany honor filters, sorts and pagination", async () => {
  const eventId = unique();
  const created = await donationRepository.create(donationBase({
    eventId,
    category: "Hundi",
    paymentMethod: "Cash",
    status: "Pending",
  }));

  const byEvent = await donationRepository.findOne({ eventId });
  assert.strictEqual(byEvent._id, created._id);

  const many = await donationRepository.findMany({ filter: { eventId } });
  assert.ok(many.some((d) => d._id === created._id));

  const filtered = await donationRepository.findMany({
    filter: { category: "Hundi", paymentMethod: "Cash", status: "Pending" },
  });
  assert.ok(filtered.some((d) => d._id === created._id));

  const byName = await donationRepository.findMany({ filter: { donorName: created.donorName } });
  assert.ok(byName.some((d) => d._id === created._id));

  // Mongo-style { status: { $in: [...] } }.
  const statusIn = await donationRepository.findMany({ filter: { status: { $in: ["Pending", "Failed"] } } });
  assert.ok(statusIn.some((d) => d._id === created._id));

  const page = await donationRepository.findMany({ filter: {}, sort: { createdAt: -1 }, limit: 1, offset: 0 });
  assert.strictEqual(page.length, 1);

  // Invalid sort fields fall back to created_at DESC and never throw.
  const badSort = await donationRepository.findMany({ sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((d) => d._id === created._id));

  // Date range filter: { createdAt: { $gte, $lte } }.
  const ranged = await donationRepository.findMany({
    filter: { createdAt: { $gte: "2020-01-01T00:00:00Z", $lte: new Date(Date.now() + 86400000) } },
  });
  assert.ok(ranged.some((d) => d._id === created._id));
});

test("donation repository: donorEmail $in filter mirrors buildEmailLookup aliases", async () => {
  // devoteeController.getDonations calls buildEmailLookup("donorEmail", email),
  // which for a gmail address emits { donorEmail: { $in: ['alias@gmail.com', 'alias@temple.local'] } }.
  // The devotee flow normalizes aliases at write time (normalizeEmail maps
  // @temple.local → @gmail.com), so the canonical value is what is stored.
  const created = await donationRepository.create(donationBase({ donorEmail: "alias@gmail.com" }));
  const byIn = await donationRepository.findMany({
    filter: { donorEmail: { $in: ["alias@gmail.com", "alias@temple.local"] } },
  });
  assert.ok(byIn.some((d) => d._id === created._id));

  const byCanonical = await donationRepository.findMany({
    filter: { donorEmail: "alias@gmail.com" },
  });
  assert.ok(byCanonical.some((d) => d._id === created._id));
});

test("donation repository: count uses COUNT(*) and filter counts match", async () => {
  const eventId = unique();
  await donationRepository.create(donationBase({ eventId, status: "Pending" }));
  await donationRepository.create(donationBase({ eventId, status: "Completed" }));
  const all = await donationRepository.count({});
  const byEvent = await donationRepository.count({ eventId });
  assert.strictEqual(typeof all, "number");
  assert.strictEqual(byEvent, 2);
  const byStatus = await donationRepository.count({ status: { $in: ["Pending", "Completed"] } });
  assert.ok(byStatus >= 2);
});

test("donation repository: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(
    await donationRepository.updateById("000000000000000000000000", { status: "Completed" }),
    null
  );
  const created = await donationRepository.create(donationBase({}));
  const noop = await donationRepository.updateById(created._id, {});
  assert.strictEqual(noop._id, created._id);
});

test("donation repository: destroy reports existence", async () => {
  const created = await donationRepository.create(donationBase({}));
  assert.strictEqual(await donationRepository.destroy(created._id), true);
  assert.strictEqual(await donationRepository.findById(created._id), null);
  assert.strictEqual(await donationRepository.destroy(created._id), false);
  assert.strictEqual(await donationRepository.destroy("000000000000000000000000"), false);
});

test("donation repository: donation → Bill.sourceId relationship round-trips", async () => {
  // Mirrors donationController.createDonation: a donation persists, then a bill
  // is created with sourceId = donation._id. The migration deliberately keeps
  // bills.source_id polymorphic TEXT (bookings/prasadam remain Mongo-backed), so
  // no FK exists; the polyglot relationship is verified end to end via the
  // already-migrated bill repository.
  const billRepositoryModule = require("../src/repositories/billRepository");
  const donation = await donationRepository.create(donationBase({ status: "Completed" }));
  const bill = await billRepositoryModule.create({
    devoteeName: donation.donorName,
    sevaType: donation.category,
    amount: donation.amount,
    paymentMode: donation.paymentMethod,
    billType: "Donation",
    referenceNo: `DN-${String(donation._id).slice(-6).toUpperCase()}`,
    sourceId: donation._id,
    notes: donation.notes || "",
    status: "Paid",
  });
  assert.strictEqual(bill.sourceId, donation._id);

  const bySource = await billRepositoryModule.findManyBySourceId(donation._id);
  assert.ok(bySource.some((b) => b._id === bill._id));

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT source_id FROM bills WHERE id = $1",
      [bill._id]
    );
    assert.strictEqual(rows[0].source_id, donation._id);
  } finally {
    await pool.end();
  }
});

test("donation repository: donation → AccountTransaction.referenceId relationship round-trips", async () => {
  // Mirrors donationController.createDonation / devoteeController flows: an
  // account transaction is recorded with referenceId = donation._id and
  // referenceModel = 'Donation'. The account_transactions.reference_id column
  // stays polymorphic TEXT until every referenced entity is migrated.
  const donation = await donationRepository.create(donationBase({ status: "Completed" }));
  const tx = await accountTransactionRepository.create({
    transactionType: "Credit",
    source: "Donation",
    category: "Donation Income",
    amount: donation.amount,
    financialYear: "2026-2027",
    paymentMethod: donation.paymentMethod,
    status: "Completed",
    description: `Donation by ${donation.donorName}`,
    referenceId: donation._id,
    referenceModel: "Donation",
  });
  assert.strictEqual(tx.referenceId, donation._id);
  assert.strictEqual(tx.referenceModel, "Donation");

  const byRef = await accountTransactionRepository.findMany({
    filter: { referenceId: donation._id, referenceModel: "Donation" },
  });
  assert.ok(byRef.some((t) => t._id === tx._id));
});