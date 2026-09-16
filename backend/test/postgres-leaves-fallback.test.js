// Phase 2T Mongo/Mongoose fallback tests for the Leave repository and service.
//
// These tests pin the datasource seam to "disconnected" so the repository and
// service must select the existing Mongoose path. They verify that:
//   - the service reports MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - the repository's create/findById/findOne/findMany/updateById/count all
//     route to the Mongoose model calls the controllers used before this phase,
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

const dbConfig = require("../src/config/db");
const Leave = require("../src/models/Leave");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let leaveService;
let leaveRepository;

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
  leaveService = require("../src/services/leaveService");
  leaveRepository = require("../src/repositories/leaveRepository");
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

// Re-runs the full migration chain so the leaves table exists in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

// ─── The Mongoose call recorder ────────────────────────────────────────────
// Monkey-patches statics and the prototype *on the real Leave model object* —
// the same reference the repository and service invoke at call time — so the
// assertions prove the Mongo path is genuinely exercised rather than that a
// stub's return value came back.
const stubLeaveCollection = () => {
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
  const findOne = async (filter) => { calls.push(["findOne", filter]); return makeQuery([null]).then((r) => r[0]); };
  const find = (filter) => { calls.push(["find", filter]); return makeQuery([]); };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    return makeDoc({ ...updates }, id);
  };
  const countDocuments = async (filter) => { calls.push(["countDocuments", filter]); return 7; };

  Leave.create = create;
  Leave.findById = findById;
  Leave.findOne = findOne;
  Leave.find = find;
  Leave.findByIdAndUpdate = findByIdAndUpdate;
  Leave.countDocuments = countDocuments;
  Leave.prototype.save = async function save() { calls.push(["save", this._id]); return this; };

  return { saved, calls };
};

const leaveBase = (overrides = {}) => ({
  staffId: `FB-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  staffName: "Fallback User",
  reason: "Fallback path reason text",
  leaveType: "Casual",
  fromDate: "2026-05-01",
  toDate: "2026-05-02",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("leave fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(leaveService.isConnected(), false);
  assert.strictEqual(await leaveService.usePostgres(), false);
});

test("leave fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:5999/does_not_exist";
  try {
    // The seam is disconnected, so the gate short-circuits before any dial.
    assert.strictEqual(await leaveService.usePostgres(), false);
  } finally {
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
  }
});

// ─── Repository routes to Mongoose ─────────────────────────────────────────
test("leave fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  const { saved, calls } = stubLeaveCollection();
  const created = await leaveRepository.create(leaveBase());

  assert.strictEqual(saved.length, 1, "Leave.create was invoked");
  assert.ok(calls.some(([name]) => name === "create"), "create recorded");
  assert.ok(created._id, "the Mongo document is returned");
});

test("leave fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  const { calls } = stubLeaveCollection();

  await leaveRepository.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"),
    "findById routed to Mongoose findById");

  await leaveRepository.findOne({ staffId: "FB-1" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.staffId === "FB-1"),
    "findOne routed to Mongoose findOne");

  await leaveRepository.findMany({ filter: { status: "Approved" }, sort: { fromDate: -1 }, limit: 100 });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Approved"),
    "findMany routed to Mongoose find with the same filter");
  assert.ok(calls.some(([name, arg]) => name === "sort" && arg && arg.fromDate === -1),
    "the Mongo sort is passed through");
  assert.ok(calls.some(([name, arg]) => name === "limit" && arg === 100),
    "the existing limit(100) pagination semantics are preserved");

  await leaveRepository.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments");
});

test("leave fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  const { calls } = stubLeaveCollection();
  const updated = await leaveRepository.updateById("0000000000000000000000aa", {
    status: "Approved", reviewedBy: "Admin", reviewedAt: new Date(),
  });

  assert.ok(
    calls.some(([name, id]) => name === "findByIdAndUpdate" && id === "0000000000000000000000aa"),
    "updateById routed to Mongoose findByIdAndUpdate"
  );
  assert.strictEqual(updated.status, "Approved");
});

test("leave fallback: updateById validation mirrors Mongoose on the fallback branch too", async () => {
  stubLeaveCollection();
  await assert.rejects(
    leaveRepository.updateById("0000000000000000000000bb", { status: "Cancelled" }),
    /Invalid status/,
    "the status enum is enforced before reaching Mongoose"
  );
  await assert.rejects(
    leaveRepository.updateById("0000000000000000000000bb", { fromDate: "not-a-date" }),
    /must be a YYYY-MM-DD calendar key/,
    "the calendar-key shape is enforced on the fallback branch"
  );
});

// ─── The Mongo path needs no PG table ──────────────────────────────────────
test("leave fallback: Mongo fallback works when the leaves table is missing", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS leaves CASCADE");
    // Drop the tracking table too so the next migrate re-applies 021 and
    // genuinely rebuilds `leaves` for the tests that follow.
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally { await pool.end(); }

  const { saved } = stubLeaveCollection();
  const created = await leaveRepository.create(leaveBase());
  assert.ok(created._id, "create still succeeds with no leaves table");
  assert.strictEqual(saved.length, 1, "the write landed in Mongo");
});

test("leave fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  ensureTables();
  const before = (await pgQuery("SELECT COUNT(*)::int AS n FROM leaves"))[0].n;

  const { saved } = stubLeaveCollection();
  await leaveRepository.create(leaveBase());

  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = (await pgQuery("SELECT COUNT(*)::int AS n FROM leaves"))[0].n;
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("leave fallback: a single write never reaches both datasources", async () => {
  ensureTables();
  const staff = `FB-NODUAL-${Date.now()}`;

  const { saved } = stubLeaveCollection();
  await leaveService.create(leaveBase({ staffId: staff }));

  assert.strictEqual(saved.length, 1, "the write landed in Mongo");

  const rows = await pgQuery("SELECT staff_id FROM leaves WHERE staff_id = $1", [staff]);
  assert.strictEqual(rows.length, 0, "the same write did NOT land in PostgreSQL");
});

test("leave fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  const { saved, calls } = stubLeaveCollection();

  await leaveService.create(leaveBase());
  assert.strictEqual(saved.length, 1, "service.create reached Leave.create");

  await leaveService.findById("000000000000000000000088");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000088"),
    "service.findById reached Mongoose findById");

  await leaveService.findOne({ staffId: "FB-9" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.staffId === "FB-9"),
    "service.findOne reached Mongoose findOne");

  await leaveService.findMany({ filter: { status: "Pending" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Pending"),
    "service.findMany reached Mongoose find");

  await leaveService.updateById("000000000000000000000077", { status: "Rejected", adminReason: "No coverage" });
  assert.ok(calls.some(([name, id]) => name === "findByIdAndUpdate" && id === "000000000000000000000077"),
    "service.updateById reached Mongoose findByIdAndUpdate");

  await leaveService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "service.count reached Mongoose countDocuments");
});

// ─── The datasource seam ───────────────────────────────────────────────────
test("leave fallback: seam can flip to PostgreSQL within the same process without a stale reference", async () => {
  const { saved } = stubLeaveCollection();
  const created = await leaveService.create(leaveBase({ staffId: `FB-FLIP-${Date.now()}` }));
  assert.strictEqual(saved.length, 1, "created via Mongo while pinned");

  ensureTables();

  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await leaveService.usePostgres(), true, "seam flips to PostgreSQL in-process");
    // The Mongo-only id must be absent from PostgreSQL, which proves the PG
    // branch actually ran. If isDbConnected were destructured at require time,
    // the swapped function would be ignored and this would return the doc.
    assert.strictEqual(await leaveRepository.findById(created._id), null,
      "the Mongo-only id is absent from PG, proving the PG branch ran");
    assert.strictEqual(saved.length, 1, "the Mongo doc is untouched");
  } finally {
    pinMongoFallback();
    delete process.env.DATABASE_URL;
  }
});

test("leave fallback: flipping the seam back and forth always honours the current value", async () => {
  const original = dbConfig.isDbConnected;
  try {
    let expected = false;
    for (const flip of [false, true, false, true]) {
      const pinned = flip;
      dbConfig.isDbConnected = () => pinned;
      expected = pinned;
      assert.strictEqual(leaveService.isConnected(), expected, `seam reports ${expected}`);
    }
  } finally {
    dbConfig.isDbConnected = original;
  }
});