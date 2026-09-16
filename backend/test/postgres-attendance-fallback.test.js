// Phase 2S fallback tests.
//
// The Attendance persistence layer is additive and entity-scoped:
//
//   Attendance Service
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    attendanceRepository → attendance
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose Attendance model (unchanged Phase 1 Mongo path)
//
// These tests prove which database path is actually used, that the Mongo
// fallback genuinely invokes the Mongoose model (not a stub's return values),
// that no dual writes happen, and that the datasource seam can be switched
// without a fresh Node process — including the stale-reference trap the
// migration pattern warns about (the seam function must be read at call time,
// never destructured at module load).
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const dbConfig = require("../src/config/db");
const Attendance = require("../src/models/Attendance");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let attendanceService;
let attendanceRepository;

const pinMongoFallback = () => {
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

  attendanceService = require("../src/services/attendanceService");
  attendanceRepository = require("../src/repositories/attendanceRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

// Re-runs the full migration chain so the attendance table exists in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

/**
 * Replaces the Attendance Mongoose model with call-tracking spies so tests can
 * prove the Mongo path is genuinely invoked on the fallback branch. The loaded
 * model object is the SAME reference the repository/service invoke at call
 * time, so swapping the methods is authoritative regardless of module load
 * order.
 *
 * Attendance.find() is a chainable Mongoose Query, and the check-out /
 * correction flows load a document and mutate it before save(), so the stubs
 * mirror both shapes (a chainable query and a saveable document).
 */
const stubAttendanceCollection = () => {
  const saved = [];
  const calls = [];
  const makeDoc = (obj, id) => {
    const d = { ...obj, _id: id, id };
    d.save = async function save() { calls.push(["doc-save", this._id]); return this; };
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
    const d = makeDoc(data, data.id || `00000000000000000000${String(saved.length + 1).padStart(4, "0")}`);
    saved.push(d);
    return d;
  };
  const findById = async (id) => {
    calls.push(["findById", id]);
    return saved.find((d) => String(d._id) === String(id)) || null;
  };
  const findOne = async (filter) => {
    calls.push(["findOne", filter]);
    if (filter && filter._id) return saved.find((d) => String(d._id) === String(filter._id)) || null;
    if (filter && filter.dateKey) return saved.find((d) => d.dateKey === filter.dateKey) || null;
    return saved[0] || null;
  };
  const find = (filter) => {
    calls.push(["find", filter]);
    return makeQuery(saved.slice());
  };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    return existing;
  };
  const findOneAndUpdate = async (filter, updates) => {
    calls.push(["findOneAndUpdate", filter, updates]);
    const existing = saved.find((d) => filter && d.dateKey === filter.dateKey);
    if (!existing) return create({ ...updates, ...filter });
    Object.assign(existing, updates);
    return existing;
  };
  const countDocuments = async (filter) => {
    calls.push(["countDocuments", filter]);
    return saved.length;
  };

  Attendance.create = create;
  Attendance.findById = findById;
  Attendance.findOne = findOne;
  Attendance.find = find;
  Attendance.findByIdAndUpdate = findByIdAndUpdate;
  Attendance.findOneAndUpdate = findOneAndUpdate;
  Attendance.countDocuments = countDocuments;
  Attendance.prototype.save = async function save() {
    calls.push(["save", this._id]);
    return this;
  };
  return { saved, calls };
};

let seq = 0;
const attendanceBase = (overrides = {}) => ({
  staffId: `FB-${Date.now()}-${seq++}`,
  staffName: "Fallback Staff",
  dateKey: "2026-05-01",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("attendance fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await attendanceService.usePostgres(), false);
  assert.strictEqual(attendanceService.isConnected(), false);
});

test("attendance fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await attendanceService.usePostgres(), false);
  delete process.env.DATABASE_URL;
});

test("attendance fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved, calls } = stubAttendanceCollection();
  const created = await attendanceRepository.create(attendanceBase());
  assert.strictEqual(saved.length, 1, "create routed to Mongoose model");
  assert.ok(calls.some(([name]) => name === "create"), "Mongoose create invoked");
  assert.match(created.staffId, /^FB-/);
});

test("attendance fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { calls } = stubAttendanceCollection();
  await attendanceRepository.findById("000000000000000000000099");
  const list = await attendanceRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0, "stubbed query returns the (empty) model store");
  assert.strictEqual(await attendanceRepository.count({}), 0);
  assert.ok(calls.some(([name]) => name === "findById"), "Mongoose findById invoked");
  assert.ok(calls.some(([name]) => name === "countDocuments"), "Mongoose countDocuments invoked");
});

test("attendance fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubAttendanceCollection();
  const created = await attendanceRepository.create(attendanceBase());
  assert.strictEqual(saved.length, 1);
  const updated = await attendanceRepository.updateById(created._id, { status: "Present" });
  assert.strictEqual(updated.status, "Present", "update applied through Mongoose findByIdAndUpdate");
});

test("attendance fallback: updateById validation mirrors Mongoose on the fallback branch too", async () => {
  pinMongoFallback();
  stubAttendanceCollection();
  await assert.rejects(attendanceRepository.updateById("000000000000000000000001", { status: "Vacation" }), /Invalid status/);
  await assert.rejects(attendanceRepository.updateById("000000000000000000000001", { dateKey: "not-a-date" }), /YYYY-MM-DD/);
});

// ─── Fallback: Mongo fallback needs no PG table ────────────────────────────
test("attendance fallback: Mongo fallback works when the attendance table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubAttendanceCollection();
  const created = await attendanceRepository.create(attendanceBase());
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");
  assert.match(created.staffId, /^FB-/);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS attendance CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await attendanceRepository.create(attendanceBase());
  assert.match(again.staffId, /^FB-/, "still works without the attendance table");
});

// ─── No dual write ─────────────────────────────────────────────────────────
test("attendance fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM attendance");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubAttendanceCollection();
  await attendanceRepository.create(attendanceBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  assert.strictEqual(await rowCount(), before, "no partial/duplicate PG row on Mongo fallback");
});

test("attendance fallback: a single write never reaches both datasources", async () => {
  pinMongoFallback();
  ensureTables();

  const pgStaffIds = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT staff_id FROM attendance");
      return rows.map((r) => r.staff_id);
    } finally {
      await pool.end();
    }
  };

  const staff = `FB-NODUAL-${Date.now()}`;
  const { saved } = stubAttendanceCollection();
  await attendanceService.create(attendanceBase({ staffId: staff }));

  assert.strictEqual(saved.length, 1, "the write landed in Mongo");
  assert.ok(!(await pgStaffIds()).includes(staff), "the same write did NOT land in PostgreSQL");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("attendance fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { calls } = stubAttendanceCollection();

  const created = await attendanceService.create(attendanceBase({ staffId: "FB-SVC-1" }));
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(created.staffId, "FB-SVC-1");

  await attendanceService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"),
    "findById routed to Mongoose findById spy");

  await attendanceService.findOne({ dateKey: "2026-05-01" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.dateKey === "2026-05-01"),
    "findOne routed to Mongoose findOne spy");

  await attendanceService.findMany({ filter: { status: "Present" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Present"),
    "findMany routed to Mongoose find spy");

  const updated = await attendanceService.updateById("000000000000000000000001", { status: "Leave" });
  assert.strictEqual(updated.status, "Leave", "updateById applied through Mongoose findByIdAndUpdate");

  await attendanceService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");
});

// ─── Datasource switching within one process ───────────────────────────────
test("attendance fallback: seam can flip to PostgreSQL within the same process without a stale reference", async () => {
  pinMongoFallback();
  ensureTables();
  const { saved } = stubAttendanceCollection();
  const created = await attendanceRepository.create(attendanceBase());

  // The seam is read at call time, so the SAME loaded repository/service modules
  // must now route to PostgreSQL. This is exactly the stale-capture trap: if
  // isDbConnected were destructured at require time, the swapped function would
  // be ignored and this assertion would fail.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await attendanceService.usePostgres(), true, "seam flips to PostgreSQL in-process");
    assert.strictEqual(await attendanceRepository.findById(created._id), null,
      "the Mongo-only id is absent from PG, proving the PG branch ran");
    assert.strictEqual(saved.length, 1, "the Mongo doc is untouched");
  } finally {
    pinMongoFallback();
    delete process.env.DATABASE_URL;
  }
});

test("attendance fallback: flipping the seam back and forth always honours the current value", async () => {
  ensureTables();
  const pinned = dbConfig.isDbConnected;
  try {
    pinMongoFallback();
    assert.strictEqual(await attendanceService.usePostgres(), false);

    dbConfig.isDbConnected = () => true;
    process.env.DATABASE_URL = TEST_DB_URL;
    assert.strictEqual(await attendanceService.usePostgres(), true);

    pinMongoFallback();
    assert.strictEqual(await attendanceService.usePostgres(), false);

    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await attendanceService.usePostgres(), true);
  } finally {
    dbConfig.isDbConnected = pinned;
    delete process.env.DATABASE_URL;
  }
});
