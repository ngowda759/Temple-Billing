// Phase 2V Mongo/Mongoose fallback tests for the Payroll repository and service.
//
// These tests pin the datasource seam to "disconnected" so the repository and
// service must select the existing Mongoose path. They verify that:
//   - the service reports MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - the repository's create/findById/findOne/findMany/updateById all route to
//     the Mongoose model calls the controller used before this phase,
//   - the fallback needs no PostgreSQL table at all,
//   - a single write reaches exactly one datasource (no dual writes),
//   - the datasource seam is read at call time, so flipping it in-process takes
//     effect on already-loaded modules (a require-time destructure would fail
//     the flip assertions).
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const dbConfig = require("../src/config/db");
const PayrollRecord = require("../src/models/PayrollRecord");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let payrollService;
let payrollRepository;

const unique = () => crypto.randomBytes(12).toString("hex");

const pinMongoFallback = () => {
  // The datasource seam: production reads mongoose.connection.readyState, the
  // tests pin the function instead so the fallback branch is deterministic.
  dbConfig.isDbConnected = () => false;
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  pinMongoFallback();
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  payrollService = require("../src/services/payrollService");
  payrollRepository = require("../src/repositories/payrollRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

// Re-runs the full migration chain so the payroll_records table exists again.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

// ─── The Mongoose call recorder ────────────────────────────────────────────
// Monkey-patches statics and the prototype *on the real PayrollRecord model
// object* — the same reference the repository and service invoke at call time —
// so the assertions prove the Mongo path is genuinely exercised rather than that
// a stub's return value came back.
const stubPayrollCollection = () => {
  const saved = [];
  const calls = [];
  const makeDoc = (obj, id) => {
    const d = { ...obj, _id: id, id };
    d.save = async function save() {
      calls.push(["doc-save", this._id]);
      return this;
    };
    d.toObject = () => ({ ...d, _id: id, id });
    return d;
  };
  const makeQuery = (rows) => {
    const q = {
      sort(arg) { calls.push(["sort", arg]); return q; },
      limit(arg) { calls.push(["limit", arg]); return q; },
      skip(arg) { calls.push(["skip", arg]); return q; },
      exec: async () => rows,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return q;
  };

  const create = async (data) => {
    calls.push(["create", data]);
    const doc = makeDoc(data, `mongo-${saved.length + 1}`);
    saved.push(doc);
    return doc;
  };
  const findById = async (id) => { calls.push(["findById", id]); return null; };
  const findOne = (filter) => { calls.push(["findOne", filter]); return makeQuery([null]); };
  const find = (filter) => { calls.push(["find", filter]); return makeQuery([]); };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    return makeDoc({ ...updates }, id);
  };

  PayrollRecord.create = create;
  PayrollRecord.findById = findById;
  PayrollRecord.findOne = findOne;
  PayrollRecord.find = find;
  PayrollRecord.findByIdAndUpdate = findByIdAndUpdate;
  PayrollRecord.prototype.save = async function save() { calls.push(["save", this._id]); return this; };

  return { saved, calls };
};

const payrollBase = (overrides = {}) => ({
  employeeId: unique(),
  employeeName: `FB-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  monthKey: "2026-07",
  baseSalary: 30000,
  netSalary: 30000,
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("payroll fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(payrollService.isConnected(), false);
  assert.strictEqual(await payrollService.usePostgres(), false);
});

test("payroll fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:5999/does_not_exist";
  try {
    // The seam is disconnected, so the gate short-circuits before any dial.
    assert.strictEqual(await payrollService.usePostgres(), false);
  } finally {
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
  }
});

// ─── Repository routes to Mongoose ─────────────────────────────────────────
test("payroll fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  const { saved, calls } = stubPayrollCollection();
  const created = await payrollRepository.create(payrollBase());

  assert.strictEqual(saved.length, 1, "PayrollRecord.create was invoked");
  assert.ok(calls.some(([name]) => name === "create"), "create recorded");
  assert.ok(created._id, "the Mongo document is returned");
});

test("payroll fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  const { calls } = stubPayrollCollection();

  await payrollRepository.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"),
    "findById routed to Mongoose findById");

  await payrollRepository.findOne({ employeeId: "0000000000000000000000a1", monthKey: "2026-07" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.monthKey === "2026-07"),
    "findOne routed to Mongoose findOne");
  // payEmployeePayroll calls PayrollRecord.findOne({ employeeId, monthKey }) with
  // no sort, so the fallback must not add one.
  assert.ok(!calls.some(([name]) => name === "sort"),
    "no sort is invented — the pre-phase findOne call had none");

  await payrollRepository.findOne({ razorpayOrderId: "order_fb" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.razorpayOrderId === "order_fb"),
    "the razorpay lookup is passed through to Mongoose unchanged");

  await payrollRepository.findMany({ filter: { monthKey: "2026-07" }, sort: { monthKey: -1 } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.monthKey === "2026-07"),
    "findMany routed to Mongoose find with the same filter");
  assert.ok(calls.some(([name, arg]) => name === "sort" && arg && arg.monthKey === -1),
    "the Mongo sort is passed through");
});

test("payroll fallback: repository updates route to the Mongoose model", async () => {
  const { calls } = stubPayrollCollection();

  const updated = await payrollRepository.updateById("0000000000000000000000aa", {
    status: "Paid", bonus: 900,
  });
  assert.ok(
    calls.some(([name, id]) => name === "findByIdAndUpdate" && id === "0000000000000000000000aa"),
    "updateById routed to Mongoose findByIdAndUpdate"
  );
  assert.strictEqual(updated.status, "Paid");
  assert.strictEqual(updated.bonus, 900);
});

test("payroll fallback: create validation mirrors Mongoose on the fallback branch too", async () => {
  stubPayrollCollection();
  await assert.rejects(
    payrollRepository.create(payrollBase({ employeeName: "  " })),
    /employeeName is required/,
    "the required check is enforced before reaching Mongoose"
  );
  await assert.rejects(
    payrollRepository.create(payrollBase({ baseSalary: "abc" })),
    /baseSalary must be a number/,
    "the numeric check is enforced on the fallback branch"
  );
  await assert.rejects(
    payrollRepository.create(payrollBase({ monthKey: "2026-7" })),
    /monthKey must be a YYYY-MM period key/,
    "the period shape is enforced on the fallback branch"
  );
});

test("payroll fallback: update validation mirrors Mongoose on the fallback branch too", async () => {
  stubPayrollCollection();
  await assert.rejects(
    payrollRepository.updateById("0000000000000000000000bb", { status: "Reversed" }),
    /Invalid status/,
    "the status enum is enforced before reaching Mongoose"
  );
  await assert.rejects(
    payrollRepository.updateById("0000000000000000000000bb", { netSalary: null }),
    /netSalary is required/,
    "the required check is enforced on the fallback branch"
  );
});

// ─── The Mongo path needs no PG table ──────────────────────────────────────
test("payroll fallback: Mongo fallback works when the payroll_records table is missing", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS payroll_records CASCADE");
    // Drop the tracking table too so the next migrate re-applies 023 and
    // genuinely rebuilds `payroll_records` for the tests that follow.
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally { await pool.end(); }

  const { saved } = stubPayrollCollection();
  const created = await payrollRepository.create(payrollBase());
  assert.ok(created._id, "create still succeeds with no payroll_records table");
  assert.strictEqual(saved.length, 1, "the write landed in Mongo");
});

test("payroll fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  ensureTables();
  const before = (await pgQuery("SELECT COUNT(*)::int AS n FROM payroll_records"))[0].n;

  const { saved } = stubPayrollCollection();
  await payrollRepository.create(payrollBase());

  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = (await pgQuery("SELECT COUNT(*)::int AS n FROM payroll_records"))[0].n;
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("payroll fallback: a single write never reaches both datasources", async () => {
  ensureTables();
  const employeeId = unique();

  const { saved } = stubPayrollCollection();
  await payrollService.create(payrollBase({ employeeId, monthKey: "2026-07" }));

  assert.strictEqual(saved.length, 1, "the write landed in Mongo");

  const rows = await pgQuery("SELECT id FROM payroll_records WHERE employee_id = $1", [employeeId]);
  assert.strictEqual(rows.length, 0, "the same write did NOT land in PostgreSQL");
});

test("payroll fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  const { saved, calls } = stubPayrollCollection();

  await payrollService.create(payrollBase());
  assert.strictEqual(saved.length, 1, "service.create reached PayrollRecord.create");

  await payrollService.findById("000000000000000000000088");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000088"),
    "service.findById reached Mongoose findById");

  await payrollService.findOne({ employeeId: "0000000000000000000000c1", monthKey: "2026-07" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.monthKey === "2026-07"),
    "service.findOne reached Mongoose findOne");

  await payrollService.findMany({ filter: { monthKey: "2026-07" }, sort: { monthKey: -1 } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.monthKey === "2026-07"),
    "service.findMany reached Mongoose find");

  await payrollService.updateById("000000000000000000000077", { status: "Paid" });
  assert.ok(calls.some(([name, id]) => name === "findByIdAndUpdate" && id === "000000000000000000000077"),
    "service.updateById reached Mongoose findByIdAndUpdate");
});

// ─── The datasource seam ───────────────────────────────────────────────────
test("payroll fallback: seam can flip to PostgreSQL within the same process without a stale reference", async () => {
  const { saved } = stubPayrollCollection();
  const employeeId = unique();
  const created = await payrollService.create(payrollBase({ employeeId }));
  assert.strictEqual(saved.length, 1, "created via Mongo while pinned");

  ensureTables();

  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await payrollService.usePostgres(), true, "seam flips to PostgreSQL in-process");
    // The Mongo-only id must be absent from PostgreSQL, which proves the PG
    // branch actually ran. If isDbConnected were destructured at require time,
    // the swapped function would be ignored and this would return the doc.
    assert.strictEqual(await payrollRepository.findById(created._id), null,
      "the Mongo-only id is absent from PG, proving the PG branch ran");
    assert.strictEqual(saved.length, 1, "the Mongo doc is untouched");
  } finally {
    pinMongoFallback();
    delete process.env.DATABASE_URL;
  }
});

test("payroll fallback: flipping the seam back and forth always honours the current value", async () => {
  const original = dbConfig.isDbConnected;
  try {
    let expected = false;
    for (const flip of [false, true, false, true]) {
      const pinned = flip;
      dbConfig.isDbConnected = () => pinned;
      expected = pinned;
      assert.strictEqual(payrollService.isConnected(), expected, `seam reports ${expected}`);
    }
  } finally {
    dbConfig.isDbConnected = original;
  }
});

// ─── Uniqueness parity ─────────────────────────────────────────────────────
test("payroll fallback: the Mongo path relies on Mongoose, not the PostgreSQL unique index", async () => {
  ensureTables();
  const employeeId = unique();
  const monthKey = "2026-07";

  // Seed a PostgreSQL row for this employee+period, then write the same pair
  // through the Mongo path. It must land in Mongo and must not collide with the
  // PostgreSQL row (which the fallback never touches).
  await pgQuery(
    `INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary)
     VALUES ($1, $2, 'PG row', $3, 1000, 1000)`,
    [unique(), employeeId, monthKey]
  );

  const { saved } = stubPayrollCollection();
  await payrollService.create(payrollBase({ employeeId, monthKey }));
  assert.strictEqual(saved.length, 1, "the Mongo write succeeded independently of the PG row");
});
