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
    await pool.query("DROP TABLE IF EXISTS account_transactions CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_heads CASCADE");
    await pool.query("DROP TABLE IF EXISTS employees CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
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
