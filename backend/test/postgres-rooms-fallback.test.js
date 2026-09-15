// Phase 2R fallback tests.
//
// The Room persistence layer is additive and entity-scoped:
//
//   Room Service
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    roomRepository → rooms
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose Room model (unchanged Phase 1 Mongo path)
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
const Room = require("../src/models/Room");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let roomService;
let roomRepository;

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

  roomService = require("../src/services/roomService");
  roomRepository = require("../src/repositories/roomRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

// Re-runs the full migration chain so the rooms table exists in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

/**
 * Replaces the Room Mongoose model with call-tracking spies so tests can prove
 * the Mongo path is genuinely invoked on the fallback branch. The loaded model
 * object is the SAME reference the repository/service invoke at call time, so
 * swapping the methods is authoritative regardless of module load order.
 *
 * Room.find() is a Query in Mongoose (chainable/sortable/limitable) and
 * findOneAndDelete returns a query too, so the stubs mirror those shapes.
 */
const stubRoomCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    id,
    toObject: () => ({ ...obj, _id: id, id }),
    save: async function save() { calls.push(["doc-save", this._id]); return this; },
  });
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
    const d = doc(data, data.id || "000000000000000000000001");
    saved.push(d);
    return d;
  };
  const findById = async (id) => {
    calls.push(["findById", id]);
    return saved.find((d) => String(d._id) === String(id)) || null;
  };
  const findOne = async (filter) => {
    calls.push(["findOne", filter]);
    if (filter && filter._id) {
      return saved.find((d) => String(d._id) === String(filter._id)) || null;
    }
    if (filter && filter.number) {
      return saved.find((d) => d.number === filter.number) || null;
    }
    return saved[0] || null;
  };
  const find = (filter) => {
    calls.push(["find", filter]);
    return makeQuery([]);
  };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    return existing;
  };
  const findOneAndDelete = async (filter) => {
    calls.push(["findOneAndDelete", filter]);
    const idx = saved.findIndex((d) => d.number === (filter && filter.number));
    if (idx === -1) return null;
    const [removed] = saved.splice(idx, 1);
    return removed;
  };
  const findByIdAndDelete = async (id) => {
    calls.push(["findByIdAndDelete", id]);
    const idx = saved.findIndex((d) => String(d._id) === String(id));
    if (idx === -1) return null;
    const [removed] = saved.splice(idx, 1);
    return removed;
  };
  const countDocuments = async () => {
    calls.push(["countDocuments"]);
    return saved.length;
  };

  Room.create = create;
  Room.findById = findById;
  Room.findOne = findOne;
  Room.find = find;
  Room.findByIdAndUpdate = findByIdAndUpdate;
  Room.findOneAndDelete = findOneAndDelete;
  Room.findByIdAndDelete = findByIdAndDelete;
  Room.countDocuments = countDocuments;
  Room.prototype.save = async function save() {
    calls.push(["save", this._id]);
    return this;
  };
  return { saved, calls };
};

let seq = 0;
const roomBase = (overrides = {}) => ({
  number: `FB-${Date.now()}-${seq++}`,
  type: "Standard",
  price: "1000.50",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await roomService.usePostgres(), false);
  assert.strictEqual(roomService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await roomService.usePostgres(), false);
  delete process.env.DATABASE_URL;
});

test("fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubRoomCollection();
  const created = await roomRepository.create(roomBase());
  assert.strictEqual(saved.length, 1, "create routed to Mongoose model");
  assert.match(created.number, /^FB-/);
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  stubRoomCollection();
  await roomRepository.findById("000000000000000000000099");
  const list = await roomRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0, "stubbed query returns empty");
  assert.strictEqual(await roomRepository.count({}), 0);
});

test("fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubRoomCollection();
  const created = await roomRepository.create(roomBase());
  assert.strictEqual(saved.length, 1);
  const updated = await roomRepository.updateById(created._id, { status: "Maintenance" });
  assert.strictEqual(updated.status, "Maintenance", "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: repository deletes route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubRoomCollection();
  const created = await roomRepository.create(roomBase());
  assert.strictEqual(await roomRepository.destroy(created._id), true);
  assert.strictEqual(await roomRepository.destroy(created._id), false);
  assert.strictEqual(saved.length, 0, "destroy removed the saved doc from the model store");
});

test("fallback: repository release clears guest fields through the Mongoose document and saves it", async () => {
  pinMongoFallback();
  const { saved, calls } = stubRoomCollection();
  const created = await roomRepository.create(roomBase({
    status: "Occupied", devotee: "Ram", phone: "9999", days: 2, payMode: "UPI",
    checkinDate: new Date(), checkoutDate: new Date(),
  }));

  const released = await roomRepository.release(created._id);
  assert.ok(calls.some(([name]) => name === "findById"), "release loaded the room via Mongoose findById");
  assert.ok(calls.some(([name]) => name === "doc-save"), "room saved through the Mongoose document save");
  assert.strictEqual(saved[0].status, "Available");
  assert.strictEqual(saved[0].devotee, undefined, "guest field cleared");
  assert.strictEqual(saved[0].checkoutDate, undefined, "checkout date cleared");
  assert.strictEqual(released.status, "Available");
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the rooms table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubRoomCollection();
  const created = await roomRepository.create(roomBase());
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");
  assert.match(created.number, /^FB-/);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS rooms CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await roomRepository.create(roomBase());
  assert.match(again.number, /^FB-/, "still works without the rooms table");
});

// ─── No dual write ─────────────────────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM rooms");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubRoomCollection();
  await roomRepository.create(roomBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  assert.strictEqual(await rowCount(), before, "no partial/duplicate PG row on Mongo fallback");
});

test("fallback: a single write never reaches both datasources", async () => {
  pinMongoFallback();
  ensureTables();

  const pgNumbers = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT number FROM rooms");
      return rows.map((r) => r.number);
    } finally {
      await pool.end();
    }
  };

  const number = `FB-NODUAL-${Date.now()}`;
  const { saved } = stubRoomCollection();
  await roomService.create(roomBase({ number }));

  assert.strictEqual(saved.length, 1, "the write landed in Mongo");
  assert.ok(!(await pgNumbers()).includes(number), "the same write did NOT land in PostgreSQL");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { calls } = stubRoomCollection();

  const room = await roomService.create(roomBase({ number: "FB-SVC-1" }));
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(room.number, "FB-SVC-1");

  await roomService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  await roomService.findOne({ number: "FB-SVC-1" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.number === "FB-SVC-1"), "findOne routed to Mongoose findOne spy");

  await roomService.findMany({ filter: { status: "Available" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Available"), "findMany routed to Mongoose find spy");

  const updated = await roomService.updateById("000000000000000000000001", { status: "Occupied" });
  assert.strictEqual(updated.status, "Occupied", "updateById applied through Mongoose findByIdAndUpdate");

  await roomService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");
  assert.strictEqual(await roomService.destroy("000000000000000000000001"), true, "destroy routed to Mongoose findByIdAndDelete spy");
});

test("fallback: findOneAndDelete routes to the Mongoose findOneAndDelete spy", async () => {
  pinMongoFallback();
  const { calls } = stubRoomCollection();
  await roomService.create(roomBase({ number: "FB-DEL-1" }));

  const deleted = await roomService.findOneAndDelete({ number: "FB-DEL-1" });
  assert.ok(deleted, "the delete-by-number lookup found the room");
  assert.ok(calls.some(([name, filter]) => name === "findOneAndDelete" && filter && filter.number === "FB-DEL-1"),
    "findOneAndDelete routed to the Mongoose spy");
});

test("fallback: release routes to the Mongoose document (no repository release stub)", async () => {
  pinMongoFallback();
  const { calls } = stubRoomCollection();
  await roomService.create(roomBase({ number: "FB-REL-1", status: "Occupied" }));

  const released = await roomService.release("000000000000000000000001");
  assert.strictEqual(released.status, "Available");
  assert.ok(calls.some(([name]) => name === "findById"), "release used the Mongoose model");
  assert.ok(calls.some(([name]) => name === "doc-save"), "release saved through Mongoose");
});

// ─── Datasource switching within one process ───────────────────────────────
test("fallback: seam can flip to PostgreSQL within the same process without a stale reference", async () => {
  pinMongoFallback();
  ensureTables();
  const { saved } = stubRoomCollection();
  const created = await roomRepository.create(roomBase());

  // The seam is read at call time, so the SAME loaded repository/service
  // modules must now route to PostgreSQL. This is exactly the stale-capture
  // trap: if isDbConnected were destructured at require time, the swapped
  // function would be ignored and this assertion would fail.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await roomService.usePostgres(), true, "seam flips to PostgreSQL in-process");
    assert.strictEqual(await roomRepository.findById(created._id), null,
      "the Mongo-only id is absent from PG, proving the PG branch ran");
    assert.strictEqual(saved.length, 1, "the Mongo doc is untouched");
  } finally {
    pinMongoFallback();
    delete process.env.DATABASE_URL;
  }
});

test("fallback: flipping the seam back and forth always honours the current value", async () => {
  ensureTables();
  const pinned = dbConfig.isDbConnected;
  try {
    pinMongoFallback();
    assert.strictEqual(await roomService.usePostgres(), false);

    dbConfig.isDbConnected = () => true;
    process.env.DATABASE_URL = TEST_DB_URL;
    assert.strictEqual(await roomService.usePostgres(), true);

    pinMongoFallback();
    assert.strictEqual(await roomService.usePostgres(), false);

    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await roomService.usePostgres(), true);
  } finally {
    dbConfig.isDbConnected = pinned;
    delete process.env.DATABASE_URL;
  }
});
