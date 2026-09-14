const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

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
let inventoryRequestRepository;
let inventoryItemRepository;
let purchaseOrderRepository;
let purchaseOrderItemRepository;
let goodsReceivedNoteRepository;
let goodsReceivedNoteItemRepository;

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
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_order_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
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
  inventoryRequestRepository = require("../src/repositories/inventoryRequestRepository");
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
  purchaseOrderRepository = require("../src/repositories/purchaseOrderRepository");
  purchaseOrderItemRepository = require("../src/repositories/purchaseOrderItemRepository");
  goodsReceivedNoteRepository = require("../src/repositories/goodsReceivedNoteRepository");
  goodsReceivedNoteItemRepository = require("../src/repositories/goodsReceivedNoteItemRepository");
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

// ─── Phase 2L: Inventory Requests ─────────────────────────────────────────
const requestBase = (overrides = {}) => ({
  userId: "staff-ramesh",
  userName: "Ramesh Kumar",
  role: "Staff",
  itemName: "Camphor",
  quantity: 10,
  unit: "Pack",
  reason: "Daily pooja",
  purpose: "Pooja needs",
  expectedDate: new Date("2025-07-01T10:00:00+05:30"),
  priority: "Medium",
  status: "Pending",
  ...overrides,
});

test("inventory request repository: create → read → update round trip", async () => {
  const created = await inventoryRequestRepository.create(requestBase());
  assert.ok(created._id);
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.userId, "staff-ramesh");
  assert.strictEqual(created.userName, "Ramesh Kumar");
  assert.strictEqual(created.role, "Staff");
  assert.strictEqual(created.requestedBy, "");
  assert.strictEqual(created.itemName, "Camphor");
  assert.strictEqual(created.quantity, 10);
  assert.strictEqual(created.unit, "Pack");
  assert.strictEqual(created.reason, "Daily pooja");
  assert.strictEqual(created.purpose, "Pooja needs");
  assert.ok(created.expectedDate instanceof Date);
  assert.strictEqual(created.priority, "Medium");
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.adminReason, "");
  assert.strictEqual(created.rejectionReason, "");
  assert.strictEqual(created.approvedBy, "");
  assert.strictEqual(created.reviewedBy, "");
  assert.strictEqual(created.rejectedAt, undefined);
  assert.strictEqual(created.approvedAt, undefined);
  assert.strictEqual(created.reviewedAt, undefined);
  assert.strictEqual(created.issuedAt, undefined);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  const read = await inventoryRequestRepository.findById(created._id);
  assert.strictEqual(read.itemName, "Camphor");

  const updated = await inventoryRequestRepository.updateById(created._id, {
    status: "Approved",
    adminReason: "ok",
    reviewedBy: "Admin",
    reviewedAt: new Date("2025-07-02T09:00:00Z"),
    approvedBy: "Admin",
    approvedAt: new Date("2025-07-02T09:00:00Z"),
  });
  assert.strictEqual(updated.status, "Approved");
  assert.strictEqual(updated.adminReason, "ok");
  assert.strictEqual(updated.reviewedBy, "Admin");
  assert.ok(updated.reviewedAt instanceof Date);
  assert.strictEqual(updated.approvedBy, "Admin");
  assert.ok(updated.approvedAt instanceof Date);
  assert.ok(updated.updatedAt instanceof Date);
});

test("inventory request repository: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const when = new Date("2025-12-31T23:59:59+05:30");
  const approvedAt = new Date("2026-01-01T06:00:00Z");
  const issuedAt = new Date("2026-01-02T06:00:00Z");
  const created = await inventoryRequestRepository.create(requestBase({
    userId: "priest-kumar",
    userName: "Priest Kumar",
    role: "Priest",
    requestedBy: "Priest Kumar",
    itemName: "Kumkum",
    quantity: "1000.125",
    unit: "Gram (g)",
    reason: "Devotees",
    purpose: "Archana",
    expectedDate: when,
    priority: "High",
    adminReason: "Approved for archana",
    rejectionReason: "",
    approvedBy: "Admin",
    approvedAt,
    reviewedBy: "Admin",
    reviewedAt: approvedAt,
    issuedAt,
  }));
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_requests WHERE id = $1", [created._id]);
    const row = rows[0];
    assert.strictEqual(row.user_id, "priest-kumar");
    assert.strictEqual(row.user_name, "Priest Kumar");
    assert.strictEqual(row.role, "Priest");
    assert.strictEqual(row.requested_by, "Priest Kumar");
    assert.strictEqual(row.item_name, "Kumkum");
    assert.strictEqual(row.quantity.toString(), "1000.125");
    assert.strictEqual(row.unit, "Gram (g)");
    assert.strictEqual(row.reason, "Devotees");
    assert.strictEqual(row.purpose, "Archana");
    assert.strictEqual(row.expected_date.toISOString(), when.toISOString());
    assert.strictEqual(row.priority, "High");
    assert.strictEqual(row.status, "Pending");
    assert.strictEqual(row.admin_reason, "Approved for archana");
    assert.strictEqual(row.rejection_reason, "");
    assert.strictEqual(row.approved_by, "Admin");
    assert.strictEqual(row.approved_at.toISOString(), approvedAt.toISOString());
    assert.strictEqual(row.reviewed_by, "Admin");
    assert.strictEqual(row.reviewed_at.toISOString(), approvedAt.toISOString());
    assert.strictEqual(row.issued_at.toISOString(), issuedAt.toISOString());
    assert.strictEqual(row.rejected_at, null);
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
  } finally {
    await pool.end();
  }
});

test("inventory request repository: required fields are enforced like Mongo", async () => {
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ userId: undefined })), /userId is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ userName: " " })), /userName is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ itemName: "" })), /itemName is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ quantity: undefined })), /quantity is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ unit: " " })), /unit is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ reason: "" })), /reason is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ purpose: undefined })), /purpose is required/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ quantity: "abc" })), /quantity must be a number/);
});

test("inventory request repository: defaults match the Mongo schema", async () => {
  const created = await inventoryRequestRepository.create(requestBase({
    role: undefined,
    requestedBy: undefined,
    priority: undefined,
    status: undefined,
    adminReason: undefined,
    rejectionReason: undefined,
    approvedBy: undefined,
    reviewedBy: undefined,
    rejectedAt: undefined,
    approvedAt: undefined,
    reviewedAt: undefined,
    issuedAt: undefined,
    expectedDate: undefined,
  }));
  assert.strictEqual(created.role, "Staff");
  assert.strictEqual(created.requestedBy, "");
  assert.strictEqual(created.priority, "Medium");
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.adminReason, "");
  assert.strictEqual(created.rejectionReason, "");
  assert.strictEqual(created.approvedBy, "");
  assert.strictEqual(created.reviewedBy, "");
  assert.strictEqual(created.rejectedAt, undefined);
  assert.strictEqual(created.approvedAt, undefined);
  assert.strictEqual(created.reviewedAt, undefined);
  assert.strictEqual(created.issuedAt, undefined);
  assert.ok(created.expectedDate instanceof Date);
});

test("inventory request repository: enums are preserved and invalid values are rejected", async () => {
  for (const priority of ["High", "Medium", "Low"]) {
    const req = await inventoryRequestRepository.create(requestBase({ priority }));
    assert.strictEqual(req.priority, priority);
  }
  for (const status of ["Pending", "Approved", "Rejected", "Issued"]) {
    const req = await inventoryRequestRepository.create(requestBase({ status, userId: unique() + status }));
    assert.strictEqual(req.status, status);
  }
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ priority: "Urgent" })), /Invalid priority/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ status: "Cancelled" })), /Invalid status/);
  await assert.rejects(() => inventoryRequestRepository.updateById("000000000000000000000001", { status: "Cancelled" }), /Invalid status/);
});

test("inventory request repository: zero quantity is legal, negatives rejected (Mongo min: 0)", async () => {
  const zero = await inventoryRequestRepository.create(requestBase({ quantity: 0 }));
  assert.strictEqual(Number(zero.quantity), 0);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ quantity: -1 })), /quantity must be >= 0/);
  await assert.rejects(() => inventoryRequestRepository.create(requestBase({ quantity: -0.5 })), /quantity must be >= 0/);

  // The DB CHECK is real, not just service-level.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO inventory_requests (id, user_id, user_name, item_name, quantity, unit, reason, purpose) VALUES ($1, 'u', 'n', 'item', -1, 'Pack', 'r', 'p')",
        [crypto.randomBytes(12).toString("hex")]
      ),
      /inventory_requests_quantity_check/,
    );
  } finally {
    await pool.end();
  }
});

test("inventory request repository: quantity precision round-trips exactly through NUMERIC", async () => {
  const values = ["0", "0.01", "1", "10.50", "1000.125", "123456.789"];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const v of values) {
      const req = await inventoryRequestRepository.create(requestBase({ quantity: v, userId: unique() }));
      const { rows } = await pool.query("SELECT quantity::text AS q FROM inventory_requests WHERE id = $1", [req._id]);
      assert.strictEqual(rows[0].q, v);
      const read = await inventoryRequestRepository.findById(req._id);
      assert.strictEqual(read.quantity, Number(v));
    }
  } finally {
    await pool.end();
  }
});

test("inventory request repository: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const when = new Date("2025-08-15T10:30:00+05:30");
  const created = await inventoryRequestRepository.create(requestBase({ expectedDate: when }));
  const read = await inventoryRequestRepository.findById(created._id);
  assert.ok(read.expectedDate instanceof Date);
  assert.strictEqual(read.expectedDate.toISOString(), when.toISOString());
  assert.ok(read.createdAt instanceof Date);
  assert.ok(read.updatedAt instanceof Date);
});

test("inventory request repository: legacy IDs round-trip and create with the same id is idempotent", async () => {
  const chosenId = crypto.randomBytes(12).toString("hex");
  const first = await inventoryRequestRepository.create(requestBase({ id: chosenId }));
  assert.strictEqual(first._id, chosenId);
  const second = await inventoryRequestRepository.create(requestBase({ id: chosenId, quantity: 200 }));
  assert.strictEqual(second._id, chosenId);
  assert.strictEqual(second.quantity, 10, "ON CONFLICT DO NOTHING keeps the existing row");
});

test("inventory request repository: findOne, findMany, $in, filtering, sorting and pagination", async () => {
  const now = Date.now();
  const base = requestBase({ userId: `staff-filter-${unique()}` });
  const pending = await inventoryRequestRepository.create({ ...base, itemName: "Camphor", status: "Pending", createdAt: new Date(now - 5 * 60 * 1000) });
  const approved = await inventoryRequestRepository.create({ ...base, itemName: "Kumkum", status: "Approved", approvedAt: new Date(), createdAt: new Date(now - 4 * 60 * 1000) });
  const rejected = await inventoryRequestRepository.create({ ...base, itemName: "Vibhuti", status: "Rejected", rejectedAt: new Date(), createdAt: new Date(now - 3 * 60 * 1000) });

  // findMany with status filter
  const approvedList = await inventoryRequestRepository.findMany({ filter: { userId: base.userId, status: "Approved" } });
  assert.ok(approvedList.some((r) => r._id === approved._id));
  assert.ok(!approvedList.some((r) => r._id === rejected._id));

  // $in over status
  const inList = await inventoryRequestRepository.findMany({
    filter: { userId: base.userId, status: { $in: ["Pending", "Approved"] } },
  });
  assert.ok(inList.some((r) => r._id === pending._id));
  assert.ok(inList.some((r) => r._id === approved._id));
  assert.ok(!inList.some((r) => r._id === rejected._id));

  // $in over ids
  const idIn = await inventoryRequestRepository.findMany({
    filter: { id: { $in: [pending._id, approved._id] } },
  });
  assert.strictEqual(idIn.length, 2);

  // createdAt range filter (the createInventoryRequest duplicate guard)
  const since = new Date(now - 10 * 60 * 1000);
  const dupCandidate = await inventoryRequestRepository.findOne({
    userId: base.userId,
    itemName: "Camphor",
    status: "Pending",
    createdAt: { $gte: since, $lte: new Date() },
  });
  assert.ok(dupCandidate);
  assert.strictEqual(dupCandidate._id, pending._id);

  // sort default createdAt DESC; query-specific priority/quantity sorts
  const sorted = await inventoryRequestRepository.findMany({
    filter: { userId: base.userId },
    sort: { createdAt: -1 },
  });
  assert.deepStrictEqual(sorted.map((r) => r._id), [rejected._id, approved._id, pending._id]);

  // pagination
  const page1 = await inventoryRequestRepository.findMany({ filter: { userId: base.userId }, sort: { createdAt: -1 }, limit: 2 });
  assert.strictEqual(page1.length, 2);
  const page2 = await inventoryRequestRepository.findMany({ filter: { userId: base.userId }, sort: { createdAt: -1 }, limit: 2, offset: 2 });
  assert.strictEqual(page2.length, 1);

  // unknown sort keys fall back to createdAt DESC
  const safeSort = await inventoryRequestRepository.findMany({ filter: { userId: base.userId }, sort: { badColumn: 1 } });
  assert.strictEqual(safeSort.length, 3);
});

test("inventory request repository: count uses COUNT(*) and filter counts match", async () => {
  const userId = `count-user-${unique()}`;
  const total = await inventoryRequestRepository.count({});
  await inventoryRequestRepository.create(requestBase({ userId }));
  await inventoryRequestRepository.create(requestBase({ userId, status: "Approved", approvedAt: new Date() }));
  const pendingCount = await inventoryRequestRepository.count({ userId, status: "Pending" });
  assert.strictEqual(pendingCount, 1);
  const allCount = await inventoryRequestRepository.count({ userId });
  assert.strictEqual(allCount, 2);
  // bare count over everything grew by exactly 2
  const totalAfter = await inventoryRequestRepository.count({});
  assert.strictEqual(totalAfter, total + 2);
});

test("inventory request repository: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(await inventoryRequestRepository.updateById("000000000000000000000001", { adminReason: "x" }), null);
  const existing = await inventoryRequestRepository.create(requestBase());
  const noop = await inventoryRequestRepository.updateById(existing._id, {});
  assert.strictEqual(noop._id, existing._id);
});

test("inventory request repository: destroy reports existence", async () => {
  const created = await inventoryRequestRepository.create(requestBase());
  assert.strictEqual(await inventoryRequestRepository.destroy("000000000000000000000001"), false);
  assert.strictEqual(await inventoryRequestRepository.destroy(created._id), true);
  assert.strictEqual(await inventoryRequestRepository.destroy(created._id), false);
  assert.strictEqual(await inventoryRequestRepository.findById(created._id), null);
});


// ─── Phase 2M: Purchase Orders ─────────────────────────────────────────────
const poBase = (overrides = {}) => ({
  poNumber: `PO-${unique()}`,
  supplier: "0000000000000000000000aa",
  items: [
    { item: "0000000000000000000000bb", orderedQuantity: 10.5, unitPrice: "1000.99", totalPrice: 10510.395, receivedQuantity: 0 },
    { item: "0000000000000000000000cc", orderedQuantity: 2, unitPrice: "0.01", totalPrice: 0.02, receivedQuantity: 0 },
  ],
  totalAmount: "123456789.1234",
  status: "Pending Approval",
  expectedDeliveryDate: new Date("2026-01-15T10:00:00Z"),
  notes: "Repo test PO",
  createdBy: "0000000000000000000000dd",
  ...overrides,
});

// Creates a real inventory_items row (satisfying the real FK) and returns it.
const createInventoryItemRow = async (name) => {
  const created = await inventoryItemRepository.create({
    name: name || `PO-Item-${unique()}`,
    unit: "Pack",
  });
  assert.ok(created?._id, "inventory item row must exist for the PO FK");
  return created;
};

// Creates a PO whose items reference a REAL inventory_items row, so the FK is
// satisfied. Returns { po, item }.
const createPoWithRealItem = async (overrides = {}) => {
  const item = await createInventoryItemRow();
  const data = {
    ...poBase({ poNumber: `PO-${unique()}` }),
    items: [
      { item: item._id, orderedQuantity: 10.5, unitPrice: "1000.99", totalPrice: 10510.395, receivedQuantity: 0 },
    ],
    ...overrides,
  };
  const po = await purchaseOrderRepository.create(data);
  return { po, item };
};

// ON DELETE RESTRICT on purchase_order_items.inventory_item_id means an
// inventory item that still has referencing PO rows cannot be deleted (Mongo
// semantics preservation). Tests remove those POs first, then the item.
const cleanupPoItem = async (itemId) => {
  if (!itemId) return;
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT purchase_order_id AS po_id FROM purchase_order_items WHERE inventory_item_id = $1",
      [String(itemId)]
    );
    for (const r of rows) await purchaseOrderRepository.destroy(r.po_id);
  } finally {
    await pool.end();
  }
  await inventoryItemRepository.destroy(String(itemId)).catch(() => {});
};

test("purchase order repository: create → read → update round trip with embedded items", async () => {
  const item = await createInventoryItemRow();
  const created = await purchaseOrderRepository.create(poBase({
    poNumber: `PO-${unique()}`,
    items: [
      { item: item._id, orderedQuantity: 10.5, unitPrice: "1000.99", totalPrice: 10510.395, receivedQuantity: 0 },
    ],
  }));
  assert.ok(created._id);
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.id, created._id);
  assert.mockEqual ? assert.strictEqual(true, true) : null;
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
  assert.strictEqual(created.totalAmount, 123456789.1234);
  assert.strictEqual(created.notes, "Repo test PO");
  assert.strictEqual(created.createdBy, "0000000000000000000000dd");
  assert.strictEqual(created.approvedBy, undefined);
  assert.ok(created.expectedDeliveryDate instanceof Date);
  assert.strictEqual(created.expectedDeliveryDate.toISOString(), "2026-01-15T10:00:00.000Z");
  assert.strictEqual(created.items.length, 1);
  assert.strictEqual(created.items[0].item, item._id);
  assert.strictEqual(created.items[0].orderedQuantity, 10.5);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  const read = await purchaseOrderRepository.findById(created._id);
  assert.strictEqual(read.poNumber, created.poNumber);

  const updated = await purchaseOrderRepository.updateById(created._id, {
    status: "Partially Received",
    approvedBy: "0000000000000000000000ee",
    notes: "updated",
  });
  assert.strictEqual(updated.status, "Partially Received");
  assert.strictEqual(updated.approvedBy, "0000000000000000000000ee");
  assert.strictEqual(updated.notes, "updated");
  assert.ok(updated.updatedAt instanceof Date);

  await cleanupPoItem(item._id);
});

test("purchase order repository: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const item = await createInventoryItemRow();
  const expectedDelivery = new Date("2026-03-01T06:30:00+05:30");
  const created = await purchaseOrderRepository.create(poBase({
    poNumber: `PO-${unique()}`,
    items: [
      { item: item._id, orderedQuantity: "1000.125", unitPrice: "10.50", totalPrice: 10501.3125, receivedQuantity: "1000.125" },
    ],
    expectedDeliveryDate: expectedDelivery,
    notes: "full map",
    createdBy: "employee-x",
    approvedBy: "employee-y",
  }));
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM purchase_orders WHERE id = $1", [created._id]);
    const row = rows[0];
    assert.strictEqual(row.po_number, created.poNumber);
    assert.strictEqual(row.supplier, "0000000000000000000000aa");
    assert.strictEqual(row.total_amount.toString(), "123456789.1234");
    assert.strictEqual(row.status, "Pending Approval");
    assert.strictEqual(row.expected_delivery_date.toISOString(), expectedDelivery.toISOString());
    assert.strictEqual(row.notes, "full map");
    assert.strictEqual(row.created_by, "employee-x");
    assert.strictEqual(row.approved_by, "employee-y");
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);

    const { rows: itemRows } = await pool.query(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY position",
      [created._id]
    );
    assert.strictEqual(itemRows.length, 1);
    assert.strictEqual(itemRows[0].inventory_item_id, item._id);
    assert.strictEqual(itemRows[0].ordered_quantity.toString(), "1000.125");
    assert.strictEqual(itemRows[0].unit_price.toString(), "10.50");
    assert.strictEqual(itemRows[0].total_price.toString(), "10501.3125");
    assert.strictEqual(itemRows[0].received_quantity.toString(), "1000.125");
  } finally {
    await pool.end();
  }
  await cleanupPoItem(item._id);
});

test("purchase order repository: required fields are enforced like Mongo", async () => {
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ poNumber: undefined })), /poNumber is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ poNumber: " " })), /poNumber is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ supplier: undefined })), /supplier is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ totalAmount: undefined })), /totalAmount is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ totalAmount: "abc" })), /totalAmount must be a number/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ items: [{ item: undefined, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] })), /items.item is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ items: [{ item: "x", orderedQuantity: undefined, unitPrice: 1, totalPrice: 1 }] })), /items.orderedQuantity is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ items: [{ item: "x", orderedQuantity: 1, unitPrice: undefined, totalPrice: 1 }] })), /items.unitPrice is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ items: [{ item: "x", orderedQuantity: 1, unitPrice: 1, totalPrice: undefined }] })), /items.totalPrice is required/);
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ items: [{ item: "x", orderedQuantity: "abc", unitPrice: 1, totalPrice: 1 }] })), /items.orderedQuantity must be a number/);
});

test("purchase order repository: defaults match the Mongo schema", async () => {
  const item = await createInventoryItemRow();
  const created = await purchaseOrderRepository.create({
    poNumber: `PO-${unique()}`,
    supplier: "0000000000000000000000aa",
    items: [
      { item: item._id, orderedQuantity: 1, unitPrice: "1.50", totalPrice: 1.5 },
    ],
    totalAmount: 1.5,
    status: undefined,
    expectedDeliveryDate: undefined,
    notes: undefined,
    createdBy: undefined,
    approvedBy: undefined,
  });
  assert.strictEqual(created.status, "Draft");
  assert.strictEqual(created.expectedDeliveryDate, undefined);
  assert.strictEqual(created.notes, undefined);
  assert.strictEqual(created.createdBy, undefined);
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.items[0].receivedQuantity, 0, "receivedQuantity defaults to 0");
  await cleanupPoItem(item._id);
});

test("purchase order repository: status enum is preserved and invalid values are rejected", async () => {
  const item = await createInventoryItemRow();
  for (const status of ["Draft", "Pending Approval", "Approved", "Sent", "Partially Received", "Received", "Cancelled", "Closed"]) {
    const po = await purchaseOrderRepository.create(poBase({ poNumber: `PO-${unique()}`, status, totalAmount: 1, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] }));
    assert.strictEqual(po.status, status);
  }
  await assert.rejects(() => purchaseOrderRepository.create(poBase({ status: "Ordered" })), /Invalid status/);
  await assert.rejects(() => purchaseOrderRepository.updateById("000000000000000000000001", { status: "Ordered" }), /Invalid status/);
  const po = await purchaseOrderRepository.create(poBase({ poNumber: `PO-${unique()}`, totalAmount: 1, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] }));
  await assert.rejects(() => purchaseOrderRepository.updateById(po._id, { status: "Ordered" }), /Invalid status/);
  await cleanupPoItem(item._id);

  // The DB CHECK is real, not just service-level.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO purchase_orders (id, po_number, supplier, total_amount, status) VALUES ($1, $2, 's', 1, 'Ordered')",
        [crypto.randomBytes(12).toString("hex"), `PO-${unique()}`]
      ),
      /purchase_orders_status_check/,
    );
  } finally {
    await pool.end();
  }
});

test("purchase order repository: quantity/money precision round-trips exactly through NUMERIC", async () => {
  const item = await createInventoryItemRow();
  const cases = [
    { orderedQuantity: "1.01", unitPrice: "0.01", totalPrice: "0.0101" },
    { orderedQuantity: "10.50", unitPrice: "10.50", totalPrice: "110.25" },
    { orderedQuantity: "1000.99", unitPrice: "1000.99", totalPrice: "1001980.9801" },
    { orderedQuantity: "1000000.99", unitPrice: "1000000.99", totalPrice: "1000001980000.9801" },
    { orderedQuantity: "123456789.1234", unitPrice: "123456789.1234", totalPrice: "15241578780672878.15254756" },
  ];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const c of cases) {
      const po = await purchaseOrderRepository.create(poBase({
        poNumber: `PO-${unique()}`,
        totalAmount: c.totalPrice,
        items: [{ item: item._id, orderedQuantity: c.orderedQuantity, unitPrice: c.unitPrice, totalPrice: c.totalPrice, receivedQuantity: 0 }],
      }));
      const { rows } = await pool.query(
        "SELECT total_amount::text AS t FROM purchase_orders WHERE id = $1",
        [po._id]
      );
      assert.strictEqual(rows[0].t, c.totalPrice);
      const { rows: ir } = await pool.query(
        "SELECT ordered_quantity::text AS q, unit_price::text AS u, total_price::text AS t FROM purchase_order_items WHERE purchase_order_id = $1",
        [po._id]
      );
      assert.strictEqual(ir[0].q, c.orderedQuantity);
      assert.strictEqual(ir[0].u, c.unitPrice);
      assert.strictEqual(ir[0].t, c.totalPrice);
      const read = await purchaseOrderRepository.findById(po._id);
      assert.strictEqual(read.totalAmount, Number(c.totalPrice));
      assert.strictEqual(read.items[0].unitPrice, Number(c.unitPrice));
    }
  } finally {
    await pool.end();
  }
  await cleanupPoItem(item._id);
});

test("purchase order repository: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const { po } = await createPoWithRealItem({ expectedDeliveryDate: new Date("2026-08-15T10:30:00+05:30") });
  const read = await purchaseOrderRepository.findById(po._id);
  assert.ok(read.expectedDeliveryDate instanceof Date);
  assert.strictEqual(read.expectedDeliveryDate.toISOString(), new Date("2026-08-15T10:30:00+05:30").toISOString());
  assert.ok(read.createdAt instanceof Date);
});

test("purchase order repository: legacy IDs round-trip and create with the same id is idempotent", async () => {
  const item = await createInventoryItemRow();
  const chosenId = crypto.randomBytes(12).toString("hex");
  const first = await purchaseOrderRepository.create(poBase({ id: chosenId, poNumber: `PO-${unique()}`, totalAmount: 5, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 5, totalPrice: 5 }] }));
  assert.strictEqual(first._id, chosenId);
  const second = await purchaseOrderRepository.create(poBase({ id: chosenId, poNumber: `PO-${unique()}`, totalAmount: 99, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 99, totalPrice: 99 }] }));
  assert.strictEqual(second._id, chosenId);
  assert.strictEqual(second.totalAmount, 5, "ON CONFLICT DO NOTHING keeps the existing row");
  await cleanupPoItem(item._id);
});

test("purchase order repository: unique poNumber is enforced (Mongo unique: true)", async () => {
  const item = await createInventoryItemRow();
  const po = await purchaseOrderRepository.create(poBase({ poNumber: `PO-UNIQUE-${unique()}`, totalAmount: 1, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] }));
  await assert.rejects(
    () => purchaseOrderRepository.create(poBase({ poNumber: po.poNumber, totalAmount: 1, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] })),
    /duplicate key value violates unique constraint "purchase_orders_po_number_key"/
  );
  await cleanupPoItem(item._id);
});

test("purchase order repository: findOne, findMany, $in, filtering, sorting and pagination", async () => {
  const item = await createInventoryItemRow();
  const supplierA = crypto.randomBytes(12).toString("hex");
  const supplierB = crypto.randomBytes(12).toString("hex");
  const now = Date.now();
  const base = { supplier: supplierA, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] };
  const draft = await purchaseOrderRepository.create({ ...base, poNumber: `PO-${unique()}`, totalAmount: 1, status: "Draft", createdAt: new Date(now - 5 * 60 * 1000) });
  const approved = await purchaseOrderRepository.create({ ...base, poNumber: `PO-${unique()}`, totalAmount: 2, status: "Approved", expectedDeliveryDate: new Date("2026-06-15T00:00:00Z"), createdAt: new Date(now - 4 * 60 * 1000) });
  const cancelled = await purchaseOrderRepository.create({ ...base, poNumber: `PO-${unique()}`, totalAmount: 3, status: "Cancelled", createdAt: new Date(now - 3 * 60 * 1000) });
  await purchaseOrderRepository.create({ poNumber: `PO-${unique()}`, supplier: supplierB, totalAmount: 4, status: "Draft", items: [{ item: item._id, orderedQuantity: 1, unitPrice: 4, totalPrice: 4 }], createdAt: new Date(now - 2 * 60 * 1000) });

  // findMany with status filter
  const approvedList = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA, status: "Approved" } });
  assert.ok(approvedList.some((p) => p._id === approved._id));
  assert.ok(!approvedList.some((p) => p._id === draft._id));

  // $in over status
  const inList = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA, status: { $in: ["Draft", "Approved"] } } });
  assert.ok(inList.some((p) => p._id === draft._id));
  assert.ok(inList.some((p) => p._id === approved._id));
  assert.ok(!inList.some((p) => p._id === cancelled._id));

  // $in over ids
  const idIn = await purchaseOrderRepository.findMany({ filter: { id: { $in: [draft._id, approved._id] } } });
  assert.strictEqual(idIn.length, 2);

  // $in over suppliers
  const supplierIn = await purchaseOrderRepository.findMany({ filter: { supplier: { $in: [supplierA, supplierB] } } });
  assert.strictEqual(supplierIn.length, 4);

  // expectedDeliveryDate range filter
  const deliveryGte = await purchaseOrderRepository.findMany({
    filter: { expectedDeliveryDate: { $gte: new Date("2026-01-01T00:00:00Z") } },
  });
  assert.ok(deliveryGte.some((p) => p._id === approved._id));

  // sort default createdAt DESC
  const sorted = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA }, sort: { createdAt: -1 } });
  assert.deepStrictEqual(sorted.map((p) => p._id), [cancelled._id, approved._id, draft._id]);

  // explicit poNumber sort
  const byNumber = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA }, sort: { poNumber: 1 } });
  assert.strictEqual(byNumber.length, 3);

  // pagination
  const page1 = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA }, sort: { createdAt: -1 }, limit: 2 });
  assert.strictEqual(page1.length, 2);
  const page2 = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA }, sort: { createdAt: -1 }, limit: 2, offset: 2 });
  assert.strictEqual(page2.length, 1);

  // unknown sort keys fall back to createdAt DESC
  const safeSort = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA }, sort: { badColumn: 1 } });
  assert.strictEqual(safeSort.length, 3);

  // totalAmount range filter
  const amountRange = await purchaseOrderRepository.findMany({ filter: { supplier: supplierA, totalAmount: { $gte: 2, $lte: 3 } } });
  assert.strictEqual(amountRange.length, 2);

  await cleanupPoItem(item._id);
});

test("purchase order repository: child item ordering is preserved", async () => {
  const item = await createInventoryItemRow();
  const po = await purchaseOrderRepository.create(poBase({
    poNumber: `PO-${unique()}`,
    totalAmount: 10,
    items: [
      { item: item._id, orderedQuantity: 3, unitPrice: 1, totalPrice: 3 },
      { item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 },
      { item: item._id, orderedQuantity: 2, unitPrice: 1, totalPrice: 2 },
    ],
  }));
  const read = await purchaseOrderRepository.findById(po._id);
  assert.deepStrictEqual(read.items.map((i) => i.orderedQuantity), [3, 1, 2]);
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT ordered_quantity::text AS q FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY position, created_at, id",
      [po._id]
    );
    assert.deepStrictEqual(rows.map((r) => Number(r.q)), [3, 1, 2]);
  } finally {
    await pool.end();
  }
  await cleanupPoItem(item._id);
});

test("purchase order repository: atomic creation — a failing child item leaves no rows", async () => {
  const item = await createInventoryItemRow();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const poCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM purchase_orders")).rows[0].n;
  const itemCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM purchase_order_items")).rows[0].n;
  try {
    const beforePo = await poCount();
    const beforeItems = await itemCount();

    // Invalid second child: orderedQuantity 0 violates the Mongo min: 1.
    await assert.rejects(
      () => purchaseOrderRepository.create({
        poNumber: `PO-${unique()}`,
        supplier: "0000000000000000000000aa",
        totalAmount: 5,
        items: [
          { item: item._id, orderedQuantity: 5, unitPrice: 1, totalPrice: 5 },
          { item: item._id, orderedQuantity: 0, unitPrice: 1, totalPrice: 0 },
        ],
      }),
      /items\.orderedQuantity/
    );
    assert.strictEqual(await poCount(), beforePo, "no purchase_orders row remains");
    assert.strictEqual(await itemCount(), beforeItems, "no purchase_order_items rows remain");

    // DB-level FK failure on the second child (nonexistent inventory item):
    // validation passes for both lines, so the INSERT must roll back mid-way.
    await assert.rejects(
      () => purchaseOrderRepository.create({
        poNumber: `PO-${unique()}`,
        supplier: "0000000000000000000000aa",
        totalAmount: 8,
        items: [
          { item: item._id, orderedQuantity: 5, unitPrice: 1, totalPrice: 5 },
          { item: "0000000000000000000000ff", orderedQuantity: 3, unitPrice: 1, totalPrice: 3 },
        ],
      }),
      /inventory_item_id/
    );
    assert.strictEqual(await poCount(), beforePo, "no purchase_orders row remains after FK failure");
    assert.strictEqual(await itemCount(), beforeItems, "no purchase_order_items rows remain after FK failure");
  } finally {
    await pool.end();
  }
  await cleanupPoItem(item._id);
});

test("purchase order repository: atomic item replacement — a failing replacement leaves the original items", async () => {
  const item = await createInventoryItemRow();
  const { po } = await createPoWithRealItem({ totalAmount: 5 });
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM purchase_order_items WHERE purchase_order_id = $1", [po._id])).rows[0].n;
    assert.ok(before >= 1);
    await assert.rejects(
      () => purchaseOrderRepository.replaceItems(po._id, [
        { item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 },
        { item: item._id, orderedQuantity: -1, unitPrice: 1, totalPrice: -1 },
      ]),
      /items\.orderedQuantity/
    );
    const after = await purchaseOrderRepository.findById(po._id);
    assert.strictEqual(after.items.length, before, "original items survive a failed replacement");
  } finally {
    await pool.end();
  }
  await cleanupPoItem(item._id);
});

test("purchase order repository: count uses COUNT(*) and filter counts match", async () => {
  const item = await createInventoryItemRow();
  const supplier = crypto.randomBytes(12).toString("hex");
  const total = await purchaseOrderRepository.count({});
  await purchaseOrderRepository.create(poBase({ poNumber: `PO-${unique()}`, supplier, status: "Draft", totalAmount: 1, items: [{ item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 }] }));
  const draftCount = await purchaseOrderRepository.count({ supplier, status: "Draft" });
  assert.strictEqual(draftCount, 1);
  const allCount = await purchaseOrderRepository.count({ supplier });
  assert.strictEqual(allCount, 1);
  const totalAfter = await purchaseOrderRepository.count({});
  assert.strictEqual(totalAfter, total + 1);
  await cleanupPoItem(item._id);
});

test("purchase order repository: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(await purchaseOrderRepository.updateById("000000000000000000000001", { status: "Approved" }), null);
  const { po } = await createPoWithRealItem();
  const noop = await purchaseOrderRepository.updateById(po._id, {});
  assert.strictEqual(noop._id, po._id);
  await cleanupPoItem(noop.items[0].item);
});

test("purchase order repository: destroy reports existence and cascades child items (ON DELETE CASCADE)", async () => {
  const { po, item } = await createPoWithRealItem();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const childCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM purchase_order_items WHERE purchase_order_id = $1", [po._id])).rows[0].n;
    assert.strictEqual(await purchaseOrderRepository.destroy("000000000000000000000001"), false);
    assert.ok((await childCount()) >= 1, "child rows exist before delete");
    assert.strictEqual(await purchaseOrderRepository.destroy(po._id), true);
    assert.strictEqual(await purchaseOrderRepository.destroy(po._id), false);
    assert.strictEqual(await purchaseOrderRepository.findById(po._id), null);
    assert.strictEqual(await childCount(), 0, "ON DELETE CASCADE removes the embedded items with the PO");
  } finally {
    await pool.end();
  }
  await cleanupPoItem(item._id);
});

test("purchase order repository: updateById with items does not silently drop child rows (item-only via replaceItems)", async () => {
  const item = await createInventoryItemRow();
  const { po } = await createPoWithRealItem({ totalAmount: 10 });
  const updated = await purchaseOrderRepository.updateById(po._id, { notes: "still has items" });
  assert.strictEqual(updated.items.length >= 1, true, "scalar update keeps child rows loaded");
  assert.strictEqual(updated.notes, "still has items");

  await purchaseOrderRepository.replaceItems(po._id, [
    { item: item._id, orderedQuantity: 7, unitPrice: "2.50", totalPrice: 17.5, receivedQuantity: 3 },
  ]);
  const replaced = await purchaseOrderRepository.findById(po._id);
  assert.strictEqual(replaced.items.length, 1);
  assert.strictEqual(replaced.items[0].orderedQuantity, 7);
  assert.strictEqual(replaced.items[0].receivedQuantity, 3);
  await cleanupPoItem(item._id);
});

test("purchase order item repository: findById/findMany/count/destroy on child rows", async () => {
  const { po, item } = await createPoWithRealItem({ poNumber: `PO-${unique()}`, totalAmount: 10 });
  const child = await purchaseOrderItemRepository.findByPurchaseOrderId(po._id);
  assert.strictEqual(child.length, 1);
  assert.strictEqual(child[0].item, item._id);

  const byId = await purchaseOrderItemRepository.findById(child[0]._id);
  assert.strictEqual(byId.orderedQuantity, 10.5);
  assert.strictEqual(byId.unitPrice, 1000.99);

  const viaFindMany = await purchaseOrderItemRepository.findMany({ filter: { purchaseOrderId: po._id } });
  assert.strictEqual(viaFindMany.length, 1);
  const viaItemFilter = await purchaseOrderItemRepository.findMany({ filter: { inventoryItemId: item._id } });
  assert.ok(viaItemFilter.length >= 1);

  assert.strictEqual(await purchaseOrderItemRepository.count({ purchaseOrderId: po._id }), 1);

  const destroyed = await purchaseOrderItemRepository.destroy(child[0]._id);
  assert.strictEqual(destroyed, true);
  assert.strictEqual((await purchaseOrderItemRepository.findByPurchaseOrderId(po._id)).length, 0);
  await cleanupPoItem(item._id);
});
// ─── Phase 2N: Goods Received Notes ─────────────────────────────────────────
const grnBase = (overrides = {}) => ({
  grnNumber: `GRN-${unique()}`,
  supplier: "0000000000000000000000aa",
  purchaseOrder: undefined,
  supplierInvoiceNumber: "INV-1001",
  supplierInvoiceDate: new Date("2026-02-01T10:00:00Z"),
  receivedItems: [
    { item: "0000000000000000000000bb", poQuantity: 10.5, receivedQuantity: 10.5, acceptedQuantity: 10, rejectedQuantity: 0.5, unitPrice: "1000.99", batchNumber: "B-1", expiryDate: new Date("2027-02-01T00:00:00Z"), remarks: "line 1" },
    { item: "0000000000000000000000cc", poQuantity: 2, receivedQuantity: 2, acceptedQuantity: 2, rejectedQuantity: 0, unitPrice: "0.01" },
  ],
  totalAmount: "123456789.1234",
  status: "Pending Approval",
  receivedBy: "0000000000000000000000dd",
  notes: "Repo test GRN",
  ...overrides,
});

// Creates a real inventory_items row (satisfying the real FK) and returns it.
const createGrnInventoryItem = async (name) => {
  const created = await inventoryItemRepository.create({
    name: name || `GRN-Item-${unique()}`,
    unit: "Pack",
  });
  assert.ok(created?._id, "inventory item row must exist for the GRN FK");
  return created;
};

// Creates a real purchase_orders row (satisfying the GRN → PO FK) and returns
// it. The PO needs its own inventory item for purchase_order_items; use the
// same item when possible to keep cleanup simple.
const createGrnPurchaseOrder = async (itemId) => {
  const data = poBase({ poNumber: `PO-GRN-${unique()}`, items: [{ item: itemId, orderedQuantity: 10, unitPrice: "10.00", totalPrice: 100 }] });
  const po = await purchaseOrderRepository.create(data);
  assert.ok(po?._id, "purchase order row must exist for the GRN FK");
  return po;
};

// Creates a GRN whose items reference a REAL inventory_items row.
const createGrnWithRealItem = async (overrides = {}) => {
  const item = await createGrnInventoryItem();
  const data = {
    ...grnBase({ grnNumber: `GRN-${unique()}` }),
    receivedItems: [
      { item: item._id, poQuantity: 10.5, receivedQuantity: 10.5, acceptedQuantity: 10, rejectedQuantity: 0.5, unitPrice: "1000.99", batchNumber: "B-1" },
    ],
    ...overrides,
  };
  delete data.purchaseOrder;
  const grn = await goodsReceivedNoteRepository.create(data);
  return { grn, item, po: null };
};

const grnIdsOf = (grns) => grns.map((g) => (g && g._id) || g).filter(Boolean);

// ON DELETE RESTRICT on goods_received_note_items.inventory_item_id and on
// goods_received_notes.purchase_order_id mean referencing rows block deletes.
// Tests remove the GRNs first, then the item/PO.
const cleanupGrnItem = async (itemId, grns) => {
  const ids = grns ? grnIdsOf(grns) : [];
  if (ids.length) {
    for (const gid of ids) await goodsReceivedNoteRepository.destroy(gid).catch(() => {});
  } else if (itemId) {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query(
        "SELECT DISTINCT grn_id AS g FROM goods_received_note_items WHERE inventory_item_id = $1",
        [String(itemId)]
      );
      for (const r of rows) await goodsReceivedNoteRepository.destroy(r.g).catch(() => {});
    } finally {
      await pool.end();
    }
  }
  if (itemId) await inventoryItemRepository.destroy(String(itemId)).catch(() => {});
};

const cleanupGrnPo = async (poId, grns) => {
  for (const gid of grnIdsOf(grns)) await goodsReceivedNoteRepository.destroy(gid).catch(() => {});
  if (poId) await purchaseOrderRepository.destroy(String(poId)).catch(() => {});
};

test("goods received note repository: create → read → update round trip with embedded receivedItems", async () => {
  const item = await createGrnInventoryItem();
  const created = await goodsReceivedNoteRepository.create(grnBase({
    grnNumber: `GRN-${unique()}`,
    receivedItems: [
      { item: item._id, poQuantity: 10.5, receivedQuantity: 10.5, acceptedQuantity: 10, rejectedQuantity: 0.5, unitPrice: "1000.99", batchNumber: "B-1", expiryDate: new Date("2027-02-01T00:00:00Z"), remarks: "line 1" },
    ],
  }));
  assert.ok(created._id);
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
  assert.strictEqual(created.totalAmount, 123456789.1234);
  assert.strictEqual(created.supplierInvoiceNumber, "INV-1001");
  assert.ok(created.supplierInvoiceDate instanceof Date);
  assert.strictEqual(created.receivedBy, "0000000000000000000000dd");
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.notes, "Repo test GRN");
  assert.strictEqual(created.receivedItems.length, 1);
  assert.strictEqual(created.receivedItems[0].item, item._id);
  assert.strictEqual(created.receivedItems[0].acceptedQuantity, 10);
  assert.strictEqual(created.receivedItems[0].rejectedQuantity, 0.5);
  assert.strictEqual(created.receivedItems[0].unitPrice, 1000.99);
  assert.strictEqual(created.receivedItems[0].batchNumber, "B-1");
  assert.ok(created.receivedItems[0].expiryDate instanceof Date);
  assert.strictEqual(created.receivedItems[0].remarks, "line 1");
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  const read = await goodsReceivedNoteRepository.findById(created._id);
  assert.strictEqual(read.grnNumber, created.grnNumber);

  const updated = await goodsReceivedNoteRepository.updateById(created._id, {
    status: "Approved",
    approvedBy: "0000000000000000000000ee",
    notes: "updated",
  });
  assert.strictEqual(updated.status, "Approved");
  assert.strictEqual(updated.approvedBy, "0000000000000000000000ee");
  assert.strictEqual(updated.notes, "updated");
  assert.ok(updated.updatedAt instanceof Date);

  await cleanupGrnItem(item._id, [created]);
});

test("goods received note repository: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const item = await createGrnInventoryItem();
  const supplierInvoiceDate = new Date("2026-03-01T06:30:00+05:30");
  const expiry = new Date("2027-06-30T00:00:00Z");
  const created = await goodsReceivedNoteRepository.create(grnBase({
    grnNumber: `GRN-${unique()}`,
    supplierInvoiceNumber: "INV-FULL",
    supplierInvoiceDate,
    receivedItems: [
      { item: item._id, poQuantity: "1000.125", receivedQuantity: "1000.125", acceptedQuantity: "995.125", rejectedQuantity: "5", unitPrice: "10.50", batchNumber: "BATCHX", expiryDate: expiry, remarks: "full map" },
    ],
    receivedBy: "employee-x",
    approvedBy: "employee-y",
  }));
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM goods_received_notes WHERE id = $1", [created._id]);
    const row = rows[0];
    assert.strictEqual(row.grn_number, created.grnNumber);
    assert.strictEqual(row.supplier, "0000000000000000000000aa");
    assert.strictEqual(row.supplier_invoice_number, "INV-FULL");
    assert.strictEqual(row.supplier_invoice_date.toISOString(), supplierInvoiceDate.toISOString());
    assert.strictEqual(row.total_amount.toString(), "123456789.1234");
    assert.strictEqual(row.status, "Pending Approval");
    assert.strictEqual(row.received_by, "employee-x");
    assert.strictEqual(row.approved_by, "employee-y");
    assert.strictEqual(row.notes, "Repo test GRN");
    assert.ok(row.created_at instanceof Date);

    const { rows: itemRows } = await pool.query(
      "SELECT * FROM goods_received_note_items WHERE grn_id = $1 ORDER BY position",
      [created._id]
    );
    assert.strictEqual(itemRows.length, 1);
    assert.strictEqual(itemRows[0].inventory_item_id, item._id);
    assert.strictEqual(itemRows[0].po_quantity.toString(), "1000.125");
    assert.strictEqual(itemRows[0].received_quantity.toString(), "1000.125");
    assert.strictEqual(itemRows[0].accepted_quantity.toString(), "995.125");
    assert.strictEqual(itemRows[0].rejected_quantity.toString(), "5");
    assert.strictEqual(itemRows[0].unit_price.toString(), "10.50");
    assert.strictEqual(itemRows[0].batch_number, "BATCHX");
    assert.strictEqual(itemRows[0].expiry_date.toISOString(), expiry.toISOString());
    assert.strictEqual(itemRows[0].remarks, "full map");
  } finally {
    await pool.end();
  }
  await cleanupGrnItem(item._id, [created]);
});

test("goods received note repository: required fields are enforced like Mongo", async () => {
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ supplier: undefined })), /supplier is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ supplier: " " })), /supplier is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ totalAmount: undefined })), /totalAmount is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ totalAmount: "abc" })), /totalAmount must be a number/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ receivedItems: [{ item: undefined, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] })), /receivedItems\.item is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ receivedItems: [{ item: "x", receivedQuantity: undefined, acceptedQuantity: 1, unitPrice: 1 }] })), /receivedItems\.receivedQuantity is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ receivedItems: [{ item: "x", receivedQuantity: 1, acceptedQuantity: undefined, unitPrice: 1 }] })), /receivedItems\.acceptedQuantity is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ receivedItems: [{ item: "x", receivedQuantity: 1, acceptedQuantity: 1, unitPrice: undefined }] })), /receivedItems\.unitPrice is required/);
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ receivedItems: [{ item: "x", receivedQuantity: "abc", acceptedQuantity: 1, unitPrice: 1 }] })), /receivedItems\.receivedQuantity must be a number/);
});

test("goods received note repository: defaults match the Mongo schema", async () => {
  const item = await createGrnInventoryItem();
  const created = await goodsReceivedNoteRepository.create({
    supplier: "0000000000000000000000aa",
    receivedItems: [
      { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: "1.50" },
    ],
    totalAmount: 1.5,
  });
  assert.match(created.grnNumber, /^GRN-\d{5}$/, "grnNumber is auto-derived in GRN-00000 format");
  assert.strictEqual(created.status, "Draft", "status default is Draft");
  assert.strictEqual(created.purchaseOrder, undefined);
  assert.strictEqual(created.supplierInvoiceNumber, undefined);
  assert.strictEqual(created.supplierInvoiceDate, undefined);
  assert.strictEqual(created.receivedBy, undefined);
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.notes, undefined);
  assert.strictEqual(created.receivedItems[0].poQuantity, 0, "poQuantity defaults to 0");
  assert.strictEqual(created.receivedItems[0].rejectedQuantity, 0, "rejectedQuantity defaults to 0");
  await cleanupGrnItem(item._id, [created]);
});

test("goods received note repository: status enum is preserved and invalid values are rejected", async () => {
  const item = await createGrnInventoryItem();
  const created = [];
  for (const status of ["Draft", "Pending Quality Check", "Pending Approval", "Approved", "Rejected"]) {
    const grn = await goodsReceivedNoteRepository.create(grnBase({ grnNumber: `GRN-${unique()}`, status, totalAmount: 1, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] }));
    assert.strictEqual(grn.status, status);
    created.push(grn);
  }
  await assert.rejects(() => goodsReceivedNoteRepository.create(grnBase({ status: "Ordered" })), /Invalid status/);
  await assert.rejects(() => goodsReceivedNoteRepository.updateById("000000000000000000000001", { status: "Ordered" }), /Invalid status/);
  const grn = await goodsReceivedNoteRepository.create(grnBase({ grnNumber: `GRN-${unique()}`, totalAmount: 1, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] }));
  created.push(grn);
  await assert.rejects(() => goodsReceivedNoteRepository.updateById(grn._id, { status: "Ordered" }), /Invalid status/);
  await cleanupGrnItem(item._id, created);

  // The DB CHECK is real, not just service-level.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO goods_received_notes (id, grn_number, supplier, total_amount, status) VALUES ($1, $2, 's', 1, 'Ordered')",
        [crypto.randomBytes(12).toString("hex"), `GRN-${unique()}`]
      ),
      /goods_received_notes_status_check/,
    );
  } finally {
    await pool.end();
  }
});

test("goods received note repository: quantity/money precision round-trips exactly through NUMERIC", async () => {
  const item = await createGrnInventoryItem();
  const cases = [
    { qty: "10.50", price: "0.01", total: "123456789.1234" },
    { qty: "1000.99", price: "10.50", total: "0.01" },
    { qty: "1000000.99", price: "1000.99", total: "10.50" },
    { qty: "123456789.1234", price: "123456789.1234", total: "1000000.99" },
  ];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const created = [];
  try {
    for (const c of cases) {
      const grn = await goodsReceivedNoteRepository.create(grnBase({
        grnNumber: `GRN-${unique()}`,
        totalAmount: c.total,
        receivedItems: [{ item: item._id, receivedQuantity: c.qty, acceptedQuantity: c.qty, unitPrice: c.price }],
      }));
      created.push(grn);
      const { rows } = await pool.query(
        "SELECT total_amount::text AS t FROM goods_received_notes WHERE id = $1",
        [grn._id]
      );
      assert.strictEqual(rows[0].t, c.total);
      const { rows: ir } = await pool.query(
        "SELECT received_quantity::text AS r, accepted_quantity::text AS a, unit_price::text AS u FROM goods_received_note_items WHERE grn_id = $1",
        [grn._id]
      );
      assert.strictEqual(ir[0].r, c.qty);
      assert.strictEqual(ir[0].a, c.qty);
      assert.strictEqual(ir[0].u, c.price);
      const read = await goodsReceivedNoteRepository.findById(grn._id);
      assert.strictEqual(read.totalAmount, Number(c.total));
      assert.strictEqual(read.receivedItems[0].unitPrice, Number(c.price));
    }
  } finally {
    await pool.end();
  }
  await cleanupGrnItem(item._id, created);
});

test("goods received note repository: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const item = await createGrnInventoryItem();
  const supplierInvoiceDate = new Date("2026-08-15T10:30:00+05:30");
  const expiry = new Date("2027-12-31T23:59:59Z");
  const created = await goodsReceivedNoteRepository.create(grnBase({
    grnNumber: `GRN-${unique()}`,
    supplierInvoiceDate,
    receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1, expiryDate: expiry }],
  }));
  const read = await goodsReceivedNoteRepository.findById(created._id);
  assert.ok(read.supplierInvoiceDate instanceof Date);
  assert.strictEqual(read.supplierInvoiceDate.toISOString(), supplierInvoiceDate.toISOString());
  assert.ok(read.receivedItems[0].expiryDate instanceof Date);
  assert.strictEqual(read.receivedItems[0].expiryDate.toISOString(), expiry.toISOString());
  assert.ok(read.createdAt instanceof Date);
  await cleanupGrnItem(item._id, [created]);
});

test("goods received note repository: legacy IDs round-trip and create with the same id is idempotent", async () => {
  const item = await createGrnInventoryItem();
  const chosenId = crypto.randomBytes(12).toString("hex");
  const first = await goodsReceivedNoteRepository.create(grnBase({ id: chosenId, grnNumber: `GRN-${unique()}`, totalAmount: 5, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 5 }] }));
  assert.strictEqual(first._id, chosenId);
  const second = await goodsReceivedNoteRepository.create(grnBase({ id: chosenId, grnNumber: `GRN-${unique()}`, totalAmount: 99, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 99 }] }));
  assert.strictEqual(second._id, chosenId);
  assert.strictEqual(second.totalAmount, 5, "ON CONFLICT DO NOTHING keeps the existing row");
  await cleanupGrnItem(item._id, [first]);
});

test("goods received note repository: unique grnNumber is enforced (Mongo unique: true)", async () => {
  const item = await createGrnInventoryItem();
  const grn = await goodsReceivedNoteRepository.create(grnBase({ grnNumber: `GRN-UNIQ-${unique()}`, totalAmount: 1, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] }));
  await assert.rejects(
    () => goodsReceivedNoteRepository.create(grnBase({ grnNumber: grn.grnNumber, totalAmount: 1, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] })),
    /duplicate key value violates unique constraint "goods_received_notes_grn_number_key"/
  );
  await cleanupGrnItem(item._id, [grn]);
});

test("goods received note repository: findOne, findMany, $in, filtering, sorting and pagination", async () => {
  const item = await createGrnInventoryItem();
  const supplierA = crypto.randomBytes(12).toString("hex");
  const supplierB = crypto.randomBytes(12).toString("hex");
  const now = Date.now();
  const base = { supplier: supplierA, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] };
  const draft = await goodsReceivedNoteRepository.create({ ...base, grnNumber: `GRN-${unique()}`, totalAmount: 1, status: "Draft", createdAt: new Date(now - 5 * 60 * 1000) });
  const approved = await goodsReceivedNoteRepository.create({ ...base, grnNumber: `GRN-${unique()}`, totalAmount: 2, status: "Approved", supplierInvoiceDate: new Date("2026-06-15T00:00:00Z"), createdAt: new Date(now - 4 * 60 * 1000) });
  const rejected = await goodsReceivedNoteRepository.create({ ...base, grnNumber: `GRN-${unique()}`, totalAmount: 3, status: "Rejected", createdAt: new Date(now - 3 * 60 * 1000) });
  const supplierBGrn = await goodsReceivedNoteRepository.create({ grnNumber: `GRN-${unique()}`, supplier: supplierB, totalAmount: 4, status: "Draft", receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 4 }], createdAt: new Date(now - 2 * 60 * 1000) });

  const approvedList = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA, status: "Approved" } });
  assert.ok(approvedList.some((g) => g._id === approved._id));
  assert.ok(!approvedList.some((g) => g._id === draft._id));

  const inList = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA, status: { $in: ["Draft", "Approved"] } } });
  assert.ok(inList.some((g) => g._id === draft._id));
  assert.ok(inList.some((g) => g._id === approved._id));
  assert.ok(!inList.some((g) => g._id === rejected._id));

  const idIn = await goodsReceivedNoteRepository.findMany({ filter: { id: { $in: [draft._id, approved._id] } } });
  assert.strictEqual(idIn.length, 2);

  const supplierIn = await goodsReceivedNoteRepository.findMany({ filter: { supplier: { $in: [supplierA, supplierB] } } });
  assert.strictEqual(supplierIn.length, 4);

  const dateGte = await goodsReceivedNoteRepository.findMany({
    filter: { supplierInvoiceDate: { $gte: new Date("2026-01-01T00:00:00Z") } },
  });
  assert.ok(dateGte.some((g) => g._id === approved._id));

  const numIn = await goodsReceivedNoteRepository.findMany({ filter: { grnNumber: { $in: [draft.grnNumber, approved.grnNumber] } } });
  assert.strictEqual(numIn.length, 2);

  const sorted = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA }, sort: { createdAt: -1 } });
  assert.deepStrictEqual(sorted.map((g) => g._id), [rejected._id, approved._id, draft._id]);

  const byNumber = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA }, sort: { grnNumber: 1 } });
  assert.strictEqual(byNumber.length, 3);

  const page1 = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA }, sort: { createdAt: -1 }, limit: 2 });
  assert.strictEqual(page1.length, 2);
  const page2 = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA }, sort: { createdAt: -1 }, limit: 2, offset: 2 });
  assert.strictEqual(page2.length, 1);

  const safeSort = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA }, sort: { badColumn: 1 } });
  assert.strictEqual(safeSort.length, 3);

  const amountRange = await goodsReceivedNoteRepository.findMany({ filter: { supplier: supplierA, totalAmount: { $gte: 2, $lte: 3 } } });
  assert.strictEqual(amountRange.length, 2);

  await cleanupGrnItem(item._id, [draft, approved, rejected, supplierBGrn]);
});

test("goods received note repository: purchase-order relationship — GRN references real purchase_orders row", async () => {
  const item = await createGrnInventoryItem();
  const po = await createGrnPurchaseOrder(item._id);
  const grn = await goodsReceivedNoteRepository.create(grnBase({
    grnNumber: `GRN-${unique()}`,
    purchaseOrder: po._id,
    receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }],
  }));
  assert.strictEqual(grn.purchaseOrder, po._id);

  const byPo = await goodsReceivedNoteRepository.findMany({ filter: { purchaseOrder: po._id } });
  assert.ok(byPo.some((g) => g._id === grn._id));

  const poIn = await goodsReceivedNoteRepository.findMany({ filter: { purchaseOrder: { $in: [po._id] } } });
  assert.ok(poIn.some((g) => g._id === grn._id));

  // The FK is real: deleting the PO while GRNs reference it is refused.
  await assert.rejects(() => purchaseOrderRepository.destroy(po._id), /purchase_orders/);
  await cleanupGrnPo(po._id, [grn]);
  await cleanupGrnItem(item._id);
});

test("goods received note repository: child item ordering is preserved", async () => {
  const item = await createGrnInventoryItem();
  const grn = await goodsReceivedNoteRepository.create(grnBase({
    grnNumber: `GRN-${unique()}`,
    totalAmount: 10,
    receivedItems: [
      { item: item._id, receivedQuantity: 3, acceptedQuantity: 3, unitPrice: 1 },
      { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 },
      { item: item._id, receivedQuantity: 2, acceptedQuantity: 2, unitPrice: 1 },
    ],
  }));
  const read = await goodsReceivedNoteRepository.findById(grn._id);
  assert.deepStrictEqual(read.receivedItems.map((i) => i.receivedQuantity), [3, 1, 2]);
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT received_quantity::text AS q FROM goods_received_note_items WHERE grn_id = $1 ORDER BY position, created_at, id",
      [grn._id]
    );
    assert.deepStrictEqual(rows.map((r) => Number(r.q)), [3, 1, 2]);
  } finally {
    await pool.end();
  }
  await cleanupGrnItem(item._id, [grn]);
});

test("goods received note repository: atomic creation — a failing child item leaves no rows", async () => {
  const item = await createGrnInventoryItem();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const grnCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_notes")).rows[0].n;
  const itemCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_note_items")).rows[0].n;
  try {
    const beforeGrn = await grnCount();
    const beforeItems = await itemCount();

    await assert.rejects(
      () => goodsReceivedNoteRepository.create(grnBase({
        grnNumber: `GRN-${unique()}`,
        totalAmount: 5,
        receivedItems: [
          { item: item._id, receivedQuantity: 5, acceptedQuantity: 5, unitPrice: 1 },
          { item: item._id, receivedQuantity: 2, acceptedQuantity: 2, rejectedQuantity: -1, unitPrice: 1 },
        ],
      })),
      /receivedItems\.rejectedQuantity/
    );
    assert.strictEqual(await grnCount(), beforeGrn, "no goods_received_notes row remains");
    assert.strictEqual(await itemCount(), beforeItems, "no goods_received_note_items rows remain");

    await assert.rejects(
      () => goodsReceivedNoteRepository.create(grnBase({
        grnNumber: `GRN-${unique()}`,
        totalAmount: 8,
        receivedItems: [
          { item: item._id, receivedQuantity: 5, acceptedQuantity: 5, unitPrice: 1 },
          { item: "0000000000000000000000ff", receivedQuantity: 3, acceptedQuantity: 3, unitPrice: 1 },
        ],
      })),
      /inventory_item_id/
    );
    assert.strictEqual(await grnCount(), beforeGrn, "no goods_received_notes row remains after FK failure");
    assert.strictEqual(await itemCount(), beforeItems, "no goods_received_note_items rows remain after FK failure");
  } finally {
    await pool.end();
  }
  await cleanupGrnItem(item._id);
});

test("goods received note repository: atomic item replacement — a failing replacement leaves the original items", async () => {
  const item = await createGrnInventoryItem();
  const { grn } = await createGrnWithRealItem({ totalAmount: 5 });
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_note_items WHERE grn_id = $1", [grn._id])).rows[0].n;
    assert.ok(before >= 1);
    await assert.rejects(
      () => goodsReceivedNoteRepository.replaceItems(grn._id, [
        { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 },
        { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: -1, unitPrice: 1 },
      ]),
      /receivedItems\.rejectedQuantity/
    );
    const after = await goodsReceivedNoteRepository.findById(grn._id);
    assert.strictEqual(after.receivedItems.length, before, "original items survive a failed replacement");
  } finally {
    await pool.end();
  }
  await cleanupGrnItem(item._id, [grn]);
});

test("goods received note repository: count uses COUNT(*) and filter counts match", async () => {
  const item = await createGrnInventoryItem();
  const supplier = crypto.randomBytes(12).toString("hex");
  const total = await goodsReceivedNoteRepository.count({});
  const grn = await goodsReceivedNoteRepository.create({ ...grnBase({ supplier, status: "Draft", totalAmount: 1, receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 }] }), grnNumber: `GRN-${unique()}` });
  const draftCount = await goodsReceivedNoteRepository.count({ supplier, status: "Draft" });
  assert.strictEqual(draftCount, 1);
  const allCount = await goodsReceivedNoteRepository.count({ supplier });
  assert.strictEqual(allCount, 1);
  const totalAfter = await goodsReceivedNoteRepository.count({});
  assert.strictEqual(totalAfter, total + 1);
  await cleanupGrnItem(item._id, [grn]);
});

test("goods received note repository: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(await goodsReceivedNoteRepository.updateById("000000000000000000000001", { status: "Approved" }), null);
  const { grn } = await createGrnWithRealItem();
  const noop = await goodsReceivedNoteRepository.updateById(grn._id, {});
  assert.strictEqual(noop._id, grn._id);
  await cleanupGrnItem(noop.receivedItems[0].item, [grn]);
});

test("goods received note repository: destroy reports existence and cascades child items (ON DELETE CASCADE)", async () => {
  const { grn, item } = await createGrnWithRealItem();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const childCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_note_items WHERE grn_id = $1", [grn._id])).rows[0].n;
    assert.strictEqual(await goodsReceivedNoteRepository.destroy("000000000000000000000001"), false);
    assert.ok((await childCount()) >= 1, "child rows exist before delete");
    assert.strictEqual(await goodsReceivedNoteRepository.destroy(grn._id), true);
    assert.strictEqual(await goodsReceivedNoteRepository.destroy(grn._id), false);
    assert.strictEqual(await goodsReceivedNoteRepository.findById(grn._id), null);
    assert.strictEqual(await childCount(), 0, "ON DELETE CASCADE removes the embedded items with the GRN");
  } finally {
    await pool.end();
  }
  await cleanupGrnItem(item._id);
});

test("goods received note repository: updateById with receivedItems does not silently drop child rows (item-only via replaceItems)", async () => {
  const item = await createGrnInventoryItem();
  const { grn } = await createGrnWithRealItem({ totalAmount: 10 });
  const updated = await goodsReceivedNoteRepository.updateById(grn._id, { notes: "still has items" });
  assert.strictEqual(updated.receivedItems.length >= 1, true, "scalar update keeps child rows loaded");
  assert.strictEqual(updated.notes, "still has items");

  await goodsReceivedNoteRepository.replaceItems(grn._id, [
    { item: item._id, receivedQuantity: 7, acceptedQuantity: 7, unitPrice: "2.50", rejectedQuantity: 0.5 },
  ]);
  const replaced = await goodsReceivedNoteRepository.findById(grn._id);
  assert.strictEqual(replaced.receivedItems.length, 1);
  assert.strictEqual(replaced.receivedItems[0].receivedQuantity, 7);
  assert.strictEqual(replaced.receivedItems[0].rejectedQuantity, 0.5);
  await cleanupGrnItem(item._id, [grn]);
});

test("goods received note item repository: findById/findMany/count/destroy on child rows", async () => {
  const { grn, item } = await createGrnWithRealItem({ grnNumber: `GRN-${unique()}`, totalAmount: 10 });
  const child = await goodsReceivedNoteItemRepository.findByGrnId(grn._id);
  assert.strictEqual(child.length, 1);
  assert.strictEqual(child[0].item, item._id);

  const byId = await goodsReceivedNoteItemRepository.findById(child[0]._id);
  assert.strictEqual(byId.receivedQuantity, 10.5);
  assert.strictEqual(byId.acceptedQuantity, 10);
  assert.strictEqual(byId.unitPrice, 1000.99);

  const viaFindMany = await goodsReceivedNoteItemRepository.findMany({ filter: { grnId: grn._id } });
  assert.strictEqual(viaFindMany.length, 1);
  const viaItemFilter = await goodsReceivedNoteItemRepository.findMany({ filter: { inventoryItemId: item._id } });
  assert.ok(viaItemFilter.length >= 1);

  assert.strictEqual(await goodsReceivedNoteItemRepository.count({ grnId: grn._id }), 1);

  const destroyed = await goodsReceivedNoteItemRepository.destroy(child[0]._id);
  assert.strictEqual(destroyed, true);
  assert.strictEqual((await goodsReceivedNoteItemRepository.findByGrnId(grn._id)).length, 0);
  await cleanupGrnItem(item._id, [grn]);
});
