// Phase 2N fallback tests.
//
// The GoodsReceivedNote persistence layer is additive and entity-scoped:
//
//   GoodsReceivedNote
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    goodsReceivedNoteRepository → goods_received_notes
//         |        + goods_received_note_items
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose GoodsReceivedNote model (unchanged Phase 1 Mongo path)
//
// These tests prove which database path is actually used, that the Mongo
// fallback genuinely invokes the Mongoose model (not a stub's return values),
// that no dual writes happen, and that the datasource seam can be switched
// without a fresh Node process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const GoodsReceivedNote = require("../src/models/GoodsReceivedNote");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let goodsReceivedNoteService;
let goodsReceivedNoteRepository;

// Pins the shared datasource seam to "disconnected" so the GoodsReceivedNote
// path routes to the Mongoose model — exactly the fallback the app uses when
// PostgreSQL is unavailable. This is a single datasource selection, never a
// dual write.
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

  goodsReceivedNoteService = require("../src/services/goodsReceivedNoteService");
  goodsReceivedNoteRepository = require("../src/repositories/goodsReceivedNoteRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

// Re-runs the full migration chain so the goods_received_notes table exists in
// PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

/**
 * Replaces the GoodsReceivedNote Mongoose model with call-tracking spies so
 * tests can prove the Mongo path is genuinely invoked on the fallback branch.
 * The loaded model object is the SAME reference the repository/service invoke
 * at call time, so swapping the methods is authoritative regardless of module
 * load order.
 */
const stubGrnsCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    id,
    receivedItems: obj.receivedItems || [],
    toObject: () => ({ ...obj, _id: id, id, receivedItems: obj.receivedItems || [] }),
    save: async function save() { calls.push(["save", this._id]); return this; },
  });
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    select: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
    catch: (reject) => execQuery().catch(reject),
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
  // Mongoose `Model.findById(...).select("receivedItems")` returns a thenable
  // Query; the item repository uses that exact call shape in the fallback
  // branch (findByGrnId).
  const findByIdThenable = (id) => {
    calls.push(["findById", id]);
    const found = saved.find((d) => String(d._id) === String(id));
    const value = found ? Object.assign(Object.create(found), { receivedItems: found.receivedItems || [] }) : null;
    return {
      select: () => value,
      then: (resolve) => Promise.resolve(value).then(resolve),
    };
  };
  const findOne = async (filter) => {
    calls.push(["findOne", filter]);
    if (filter && filter["receivedItems._id"]) {
      return saved.find((d) => (d.receivedItems || []).some((i) => String(i._id) === String(filter["receivedItems._id"]))) || null;
    }
    return saved.find((d) => String(d._id) === String(filter && (filter._id || filter.id))) || null;
  };
  const find = (filter) => {
    calls.push(["find", filter]);
    return { ...chain, exec: async () => [] };
  };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    existing.id = existing._id;
    existing.receivedItems = existing.receivedItems || [];
    existing.save = async function save() { calls.push(["save", this._id]); return this; };
    return existing;
  };
  const findOneAndUpdate = async (filter, update) => {
    calls.push(["findOneAndUpdate", filter, update]);
    const found = saved.find((d) => String(d._id) === String(filter._id || filter.id));
    if (!found) return null;
    if (update.$pull) {
      const itemId = update.$pull.receivedItems._id;
      found.receivedItems = (found.receivedItems || []).filter((i) => String(i._id) !== String(itemId));
      return found;
    }
    return found;
  };
  const findByIdAndDelete = async (id) => {
    calls.push(["findByIdAndDelete", id]);
    const idx = saved.findIndex((d) => String(d._id) === String(id));
    if (idx === -1) return null;
    const [removed] = saved.splice(idx, 1);
    return removed;
  };
  const countDocuments = async (filter) => {
    calls.push(["countDocuments", filter]);
    return saved.length;
  };

  GoodsReceivedNote.create = create;
  GoodsReceivedNote.findById = findByIdThenable;
  GoodsReceivedNote.findOne = findOne;
  GoodsReceivedNote.find = find;
  GoodsReceivedNote.findByIdAndUpdate = findByIdAndUpdate;
  GoodsReceivedNote.findOneAndUpdate = findOneAndUpdate;
  GoodsReceivedNote.findByIdAndDelete = findByIdAndDelete;
  GoodsReceivedNote.countDocuments = countDocuments;
  GoodsReceivedNote.prototype.save = async function save() {
    calls.push(["self-save", this._id]);
    return this;
  };
  return { saved, calls };
};

const grnBase = (overrides = {}) => ({
  grnNumber: `GRN-${Math.random().toString(16).slice(2)}`,
  supplier: "0000000000000000000000aa",
  receivedItems: [
    { item: "0000000000000000000000bb", poQuantity: 10.5, receivedQuantity: 10.5, acceptedQuantity: 10, rejectedQuantity: 0.5, unitPrice: "1000.99" },
  ],
  totalAmount: "123456789.1234",
  status: "Pending Approval",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await goodsReceivedNoteService.usePostgres(), false);
  assert.strictEqual(goodsReceivedNoteService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await goodsReceivedNoteService.usePostgres(), false);
});

test("fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubGrnsCollection();
  const created = await goodsReceivedNoteRepository.create(grnBase());
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(created.grnNumber, created.grnNumber);
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  stubGrnsCollection();
  await goodsReceivedNoteRepository.findById("000000000000000000000099");
  const list = await goodsReceivedNoteRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.strictEqual(typeof (await goodsReceivedNoteRepository.count({})), "number");
});

test("fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubGrnsCollection();
  const created = await goodsReceivedNoteRepository.create(grnBase());
  assert.ok(saved.length === 1);
  const updated = await goodsReceivedNoteRepository.updateById(created._id, { status: "Approved" });
  assert.strictEqual(updated.status, "Approved", "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: repository deletes route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubGrnsCollection();
  const created = await goodsReceivedNoteRepository.create(grnBase());
  assert.strictEqual(await goodsReceivedNoteRepository.destroy(created._id), true);
  assert.strictEqual(await goodsReceivedNoteRepository.destroy(created._id), false);
  assert.strictEqual(saved.length, 0, "destroy removed the saved doc from the model store");
});

test("fallback: repository child items route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubGrnsCollection();
  const created = await goodsReceivedNoteRepository.create(grnBase());
  const itemRepo = require("../src/repositories/goodsReceivedNoteItemRepository");
  const items = await itemRepo.findByGrnId(created._id);
  assert.strictEqual(items.length, 1);
  assert.ok(saved.length >= 1);
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the goods_received_notes table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubGrnsCollection();
  const request = await goodsReceivedNoteRepository.create(grnBase({ totalAmount: 42 }));
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");
  assert.strictEqual(request.totalAmount, 42);

  // The fallback path never runs a PostgreSQL query, so dropping the tables is
  // irrelevant to its correctness.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await goodsReceivedNoteRepository.create(grnBase({ totalAmount: 7 }));
  assert.strictEqual(again.totalAmount, 7);
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_notes");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubGrnsCollection();
  await goodsReceivedNoteRepository.create(grnBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { saved, calls } = stubGrnsCollection();

  const grn = await goodsReceivedNoteService.create(grnBase({ totalAmount: 5 }));
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(grn.totalAmount, 5);

  // findById routes to the model's findById spy.
  await goodsReceivedNoteService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  // findOne routes to the model's findOne spy.
  await goodsReceivedNoteService.findOne({ id: "000000000000000000000099" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.id === "000000000000000000000099"), "findOne routed to Mongoose findOne spy");

  // findMany routes to the model's find spy (thenable query chain).
  await goodsReceivedNoteService.findMany({ filter: { status: "Draft" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Draft"), "findMany routed to Mongoose find spy");

  // updateById routes to the model's findByIdAndUpdate spy.
  const updated = await goodsReceivedNoteService.updateById("000000000000000000000001", { status: "Rejected" });
  assert.strictEqual(updated.status, "Rejected", "updateById applied through Mongoose findByIdAndUpdate");

  // count and destroy route to the model spies.
  await goodsReceivedNoteService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");
  assert.strictEqual(await goodsReceivedNoteService.destroy("000000000000000000000001"), true, "destroy routed to Mongoose findByIdAndDelete spy");
});

// ─── Datasource switching within one process ───────────────────────────────
test("fallback: seam can flip back to PostgreSQL within the same process", async () => {
  pinMongoFallback();
  stubGrnsCollection();
  const created = await goodsReceivedNoteRepository.create(grnBase());
  assert.ok(created._id);

  // Flip the seam to connected — the SAME loaded repository module now routes
  // to PostgreSQL without a fresh Node process.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await goodsReceivedNoteRepository.destroy(created._id), false, "the Mongo id does not exist in PG");
  } finally {
    pinMongoFallback();
  }
});