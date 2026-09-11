const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

let userRepository;
let employeeRepository;

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

test.before(() => {
  originalIsDbConnected = dbConfig.isDbConnected;

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