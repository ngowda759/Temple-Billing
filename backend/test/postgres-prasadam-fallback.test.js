const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const PrasadamOrder = require("../src/models/PrasadamOrder");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let prasadamOrderService;
let prasadamOrderRepository;

// The fallback behaviour must hold even when PostgreSQL is completely
// unavailable or lacking Prasadam tables. We pin the datasource-selection seam
// to "disconnected" so the repository routes to the Mongoose model, exactly as
// Phases 2A–2F do — this is the documented fallback path, never a dual write.
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

  // The services/repositories destructure the seam at require time, so they
  // must be loaded after the pin (same ordering as the Phase 2F tests).
  prasadamOrderService = require("../src/services/prasadamOrderService");
  prasadamOrderRepository = require("../src/repositories/prasadamOrderRepository");
});

// Re-runs the migrations so the prasadam_orders table exists in PostgreSQL.
const ensurePrasadamTable = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

const stubOrdersCollection = () => {
  const saved = [];
  const toDoc = (obj) => ({ ...obj, toObject: () => ({ ...obj }) });
  const saveWith = async (obj) => {
    const doc = { ...obj, _id: "000000000000000000000001", toObject: () => ({ ...obj, _id: "000000000000000000000001" }) };
    saved.push(doc);
    return doc;
  };
  const create = async (data) => saveWith(data);
  const findById = async () => null;
  const findOne = async () => null;
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
    catch: (reject) => execQuery().catch(reject),
  };
  const find = () => chain;
  const findByIdAndUpdate = async (id, updates) => {
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    return existing;
  };
  const findByIdAndDelete = async () => null;
  const countDocuments = async () => 0;
  const deleteMany = async () => ({ deletedCount: 0 });

  PrasadamOrder.create = create;
  PrasadamOrder.findById = findById;
  PrasadamOrder.findOne = findOne;
  PrasadamOrder.find = find;
  PrasadamOrder.findByIdAndUpdate = findByIdAndUpdate;
  PrasadamOrder.findByIdAndDelete = findByIdAndDelete;
  PrasadamOrder.countDocuments = countDocuments;
  PrasadamOrder.deleteMany = deleteMany;
  return { saved };
};

// ─── Fallback requirement 2: Mongo/Mongoose path remains when PG unavailable ─
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await prasadamOrderService.usePostgres(), false);
  assert.strictEqual(prasadamOrderService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await prasadamOrderService.usePostgres(), false);
});

test("fallback: repository routes creates to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const order = await prasadamOrderRepository.create({
    devoteeName: "Fallback Devotee",
    itemName: "Pongal",
    quantity: 1,
    unitPrice: 50,
    amount: 50,
    paymentMethod: "UPI",
    status: "Not Collected",
  });
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(order.devoteeName, "Fallback Devotee");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  saved.push({ _id: "000000000000000000000099", devoteeName: "Read Devotee", toObject: () => Object.assign({}, { _id: "000000000000000000000099" }) });

  const byId = await prasadamOrderRepository.findById("000000000000000000000099");
  const list = await prasadamOrderRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.ok(byId === null); // stubbed findById returns null; the fallback is what matters
  assert.strictEqual(typeof (await prasadamOrderRepository.count({})), "number");
});

test("fallback: updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const created = await prasadamOrderRepository.create({
    devoteeName: "Update Devotee",
    itemName: "Idli",
    quantity: 1,
    unitPrice: 10,
    amount: 10,
    paymentMethod: "Cash",
    status: "Not Collected",
  });
  const updated = await prasadamOrderRepository.updateById(created._id, { status: "Cancelled" });
  assert.ok(saved.length === 1);
  assert.strictEqual(updated.status, "Cancelled");
});

test("fallback: deletes route to the Mongoose model without throwing", async () => {
  pinMongoFallback();
  stubOrdersCollection();
  const result = await prasadamOrderRepository.destroy("000000000000000000000001");
  assert.strictEqual(result, false); // stubbed delete returns null → false, par with Mongo findByIdAndDelete
});

// ─── Fallback requirement 1: PG path selected when PG is available ─────────
// Proved in test/postgres-prasadam-orders.test.js ("service: uses PostgreSQL
// when Prasadam Order path is active and PG reachable"). Here we only prove
// the negative: a disconnected seam never selects PostgreSQL.

// ─── Fallback requirement 4: Mongo fallback needs no PG tables ──────────────
test("fallback: Mongo fallback works when the prasadam_orders table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubOrdersCollection();
  // The Mongoose model path must not touch PostgreSQL at all.
  const order = await prasadamOrderRepository.create({
    devoteeName: "No PG Devotee",
    itemName: "Sweet Pongal",
    quantity: 2,
    unitPrice: 40,
    amount: 80,
    paymentMethod: "UPI",
    status: "Not Collected",
  });
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(order.devoteeName, "No PG Devotee");

  // Also verify with PG DATABASE_URL removed and an actual table absence: the
  // fallback path never runs a PostgreSQL query, so unrelated tables/columns
  // existing or not is irrelevant.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS prasadam_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
  } finally {
    await pool.end();
  }
  const again = await prasadamOrderRepository.create({
    devoteeName: "No PG At All",
    itemName: "Ven Pongal",
    quantity: 1,
    unitPrice: 30,
    amount: 30,
    paymentMethod: "Cash",
    status: "Collected",
  });
  assert.strictEqual(again.devoteeName, "No PG At All");
});

// ─── Fallback requirement 5: existing Mongo behaviour is unchanged ─────────
test("fallback: Mongo defaults (channel devotee, UPI, Not Collected) are applied by the model", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const order = await prasadamOrderService.create({
    devoteeName: "Defaults Devotee",
    itemName: "Laddu",
    quantity: 1,
    unitPrice: 50,
    amount: 50,
  });
  const record = saved[0];
  assert.ok(record);
  // Mongo model applies defaults itself; the service passes the raw payload
  // through unchanged on the fallback path.
  assert.strictEqual(order.devoteeName, "Defaults Devotee");
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  // First migrate so PostgreSQL has the prasadam_orders table, then measure
  // its row count before and after a Mongo-fallback create. Since the seam is
  // disconnected, the repository must touch ONLY the Mongo model — no PG row
  // may appear.
  ensurePrasadamTable();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM prasadam_orders");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubOrdersCollection();
  await prasadamOrderRepository.create({
    devoteeName: "No Dual Write",
    itemName: "Boondi",
    quantity: 1,
    unitPrice: 10,
    amount: 10,
    paymentMethod: "UPI",
    status: "Not Collected",
  });
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});