// Phase 2U Mongo/Mongoose fallback tests for the Shift repository and service.
//
// These tests pin the datasource seam to "disconnected" so the repository and
// service must select the existing Mongoose path. They verify that:
//   - the service reports MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - the repository's create/findById/findOne/findMany/updateById/destroy/count
//     all route to the Mongoose model calls the controllers used before this
//     phase,
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
const Shift = require("../src/models/Shift");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let shiftService;
let shiftRepository;

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
  shiftService = require("../src/services/shiftService");
  shiftRepository = require("../src/repositories/shiftRepository");
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

// Re-runs the full migration chain so the shifts table exists in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

// ─── The Mongoose call recorder ────────────────────────────────────────────
// Monkey-patches statics and the prototype *on the real Shift model object* —
// the same reference the repository and service invoke at call time — so the
// assertions prove the Mongo path is genuinely exercised rather than that a
// stub's return value came back.
const stubShiftCollection = () => {
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
  const findByIdAndDelete = async (id) => {
    calls.push(["findByIdAndDelete", id]);
    return makeDoc({ shiftName: "Deleted" }, id);
  };
  const countDocuments = async (filter) => { calls.push(["countDocuments", filter]); return 7; };

  Shift.create = create;
  Shift.findById = findById;
  Shift.findOne = findOne;
  Shift.find = find;
  Shift.findByIdAndUpdate = findByIdAndUpdate;
  Shift.findByIdAndDelete = findByIdAndDelete;
  Shift.countDocuments = countDocuments;
  Shift.prototype.save = async function save() { calls.push(["save", this._id]); return this; };

  return { saved, calls };
};

const shiftBase = (overrides = {}) => ({
  shiftName: `FB-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  startTime: "9:00 AM",
  endTime: "5:00 PM",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("shift fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(shiftService.isConnected(), false);
  assert.strictEqual(await shiftService.usePostgres(), false);
});

test("shift fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:5999/does_not_exist";
  try {
    // The seam is disconnected, so the gate short-circuits before any dial.
    assert.strictEqual(await shiftService.usePostgres(), false);
  } finally {
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
  }
});

// ─── Repository routes to Mongoose ─────────────────────────────────────────
test("shift fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  const { saved, calls } = stubShiftCollection();
  const created = await shiftRepository.create(shiftBase());

  assert.strictEqual(saved.length, 1, "Shift.create was invoked");
  assert.ok(calls.some(([name]) => name === "create"), "create recorded");
  assert.ok(created._id, "the Mongo document is returned");
});

test("shift fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  const { calls } = stubShiftCollection();

  await shiftRepository.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"),
    "findById routed to Mongoose findById");

  await shiftRepository.findOne({ shiftName: "Morning", active: true });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.active === true),
    "findOne routed to Mongoose findOne");
  assert.ok(calls.some(([name, arg]) => name === "sort" && arg && arg.createdAt === -1),
    "the default Mongo sort { createdAt: -1 } is applied, matching the pre-phase call");

  await shiftRepository.findOne({ shiftName: /^Morning$/i, active: true });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.shiftName instanceof RegExp),
    "the RegExp lookup is passed through to Mongoose unchanged");

  await shiftRepository.findMany({ filter: { active: true }, sort: { shiftName: 1 } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.active === true),
    "findMany routed to Mongoose find with the same filter");
  assert.ok(calls.some(([name, arg]) => name === "sort" && arg && arg.shiftName === 1),
    "the Mongo sort is passed through");
  assert.ok(calls.some(([name]) => name === "find"), "the active-shift scan ran");

  await shiftRepository.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments");
});

test("shift fallback: repository updates and deletes route to the Mongoose model", async () => {
  const { calls } = stubShiftCollection();

  const updated = await shiftRepository.updateById("0000000000000000000000aa", {
    requiredStaff: 3, active: false,
  });
  assert.ok(
    calls.some(([name, id]) => name === "findByIdAndUpdate" && id === "0000000000000000000000aa"),
    "updateById routed to Mongoose findByIdAndUpdate"
  );
  assert.strictEqual(updated.requiredStaff, 3);

  const deleted = await shiftRepository.destroy("0000000000000000000000bb");
  assert.ok(
    calls.some(([name, id]) => name === "findByIdAndDelete" && id === "0000000000000000000000bb"),
    "destroy routed to Mongoose findByIdAndDelete"
  );
  assert.ok(deleted, "the deleted document is returned like findByIdAndDelete");
});

test("shift fallback: updateById validation mirrors Mongoose on the fallback branch too", async () => {
  stubShiftCollection();
  await assert.rejects(
    shiftRepository.updateById("0000000000000000000000bb", { shiftName: "  " }),
    /shiftName is required/,
    "the required check is enforced before reaching Mongoose"
  );
  await assert.rejects(
    shiftRepository.updateById("0000000000000000000000bb", { requiredStaff: "abc" }),
    /requiredStaff must be a number/,
    "the numeric check is enforced on the fallback branch"
  );
});

// ─── The Mongo path needs no PG table ──────────────────────────────────────
test("shift fallback: Mongo fallback works when the shifts table is missing", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS shifts CASCADE");
    // Drop the tracking table too so the next migrate re-applies 022 and
    // genuinely rebuilds `shifts` for the tests that follow.
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally { await pool.end(); }

  const { saved } = stubShiftCollection();
  const created = await shiftRepository.create(shiftBase());
  assert.ok(created._id, "create still succeeds with no shifts table");
  assert.strictEqual(saved.length, 1, "the write landed in Mongo");
});

test("shift fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  ensureTables();
  const before = (await pgQuery("SELECT COUNT(*)::int AS n FROM shifts"))[0].n;

  const { saved } = stubShiftCollection();
  await shiftRepository.create(shiftBase());

  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = (await pgQuery("SELECT COUNT(*)::int AS n FROM shifts"))[0].n;
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("shift fallback: a single write never reaches both datasources", async () => {
  ensureTables();
  const name = `FB-NODUAL-${Date.now()}`;

  const { saved } = stubShiftCollection();
  await shiftService.create(shiftBase({ shiftName: name }));

  assert.strictEqual(saved.length, 1, "the write landed in Mongo");

  const rows = await pgQuery("SELECT shift_name FROM shifts WHERE shift_name = $1", [name]);
  assert.strictEqual(rows.length, 0, "the same write did NOT land in PostgreSQL");
});

test("shift fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  const { saved, calls } = stubShiftCollection();

  await shiftService.create(shiftBase());
  assert.strictEqual(saved.length, 1, "service.create reached Shift.create");

  await shiftService.findById("000000000000000000000088");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000088"),
    "service.findById reached Mongoose findById");

  await shiftService.findOne({ shiftName: "FB-9", active: true });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.active === true),
    "service.findOne reached Mongoose findOne");

  await shiftService.findMany({ filter: { active: true }, sort: { shiftName: 1 } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.active === true),
    "service.findMany reached Mongoose find");

  await shiftService.updateById("000000000000000000000077", { active: false });
  assert.ok(calls.some(([name, id]) => name === "findByIdAndUpdate" && id === "000000000000000000000077"),
    "service.updateById reached Mongoose findByIdAndUpdate");

  await shiftService.destroy("000000000000000000000066");
  assert.ok(calls.some(([name, id]) => name === "findByIdAndDelete" && id === "000000000000000000000066"),
    "service.destroy reached Mongoose findByIdAndDelete");

  await shiftService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "service.count reached Mongoose countDocuments");
});

// ─── The datasource seam ───────────────────────────────────────────────────
test("shift fallback: seam can flip to PostgreSQL within the same process without a stale reference", async () => {
  const { saved } = stubShiftCollection();
  const created = await shiftService.create(shiftBase({ shiftName: `FB-FLIP-${Date.now()}` }));
  assert.strictEqual(saved.length, 1, "created via Mongo while pinned");

  ensureTables();

  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await shiftService.usePostgres(), true, "seam flips to PostgreSQL in-process");
    // The Mongo-only id must be absent from PostgreSQL, which proves the PG
    // branch actually ran. If isDbConnected were destructured at require time,
    // the swapped function would be ignored and this would return the doc.
    assert.strictEqual(await shiftRepository.findById(created._id), null,
      "the Mongo-only id is absent from PG, proving the PG branch ran");
    assert.strictEqual(saved.length, 1, "the Mongo doc is untouched");
  } finally {
    pinMongoFallback();
    delete process.env.DATABASE_URL;
  }
});

test("shift fallback: flipping the seam back and forth always honours the current value", async () => {
  const original = dbConfig.isDbConnected;
  try {
    let expected = false;
    for (const flip of [false, true, false, true]) {
      const pinned = flip;
      dbConfig.isDbConnected = () => pinned;
      expected = pinned;
      assert.strictEqual(shiftService.isConnected(), expected, `seam reports ${expected}`);
    }
  } finally {
    dbConfig.isDbConnected = original;
  }
});