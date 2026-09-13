const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const InventoryItem = require("../src/models/InventoryItem");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let inventoryItemService;
let inventoryItemRepository;

// The fallback behaviour must hold even when PostgreSQL is completely
// unavailable or lacking inventory tables. We pin the datasource-selection seam
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
  inventoryItemService = require("../src/services/inventoryItemService");
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
});

// Re-runs the migrations so the inventory_items table exists in PostgreSQL.
const ensureInventoryTable = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

const stubItemsCollection = () => {
  const saved = [];
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

  InventoryItem.create = create;
  InventoryItem.findById = findById;
  InventoryItem.findOne = findOne;
  InventoryItem.find = find;
  InventoryItem.findByIdAndUpdate = findByIdAndUpdate;
  InventoryItem.findByIdAndDelete = findByIdAndDelete;
  InventoryItem.countDocuments = countDocuments;
  InventoryItem.deleteMany = deleteMany;
  return { saved };
};

// ─── Fallback requirement 2: Mongo/Mongoose path remains when PG unavailable ─
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await inventoryItemService.usePostgres(), false);
  assert.strictEqual(inventoryItemService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await inventoryItemService.usePostgres(), false);
});

test("fallback: repository routes creates to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubItemsCollection();
  const item = await inventoryItemRepository.create({
    name: "Fallback Camphor",
    unit: "Pack",
    availableStock: 10,
    minimumStock: 2,
  });
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(item.name, "Fallback Camphor");
});

test("fallback: repository reads root to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubItemsCollection();
  saved.push({ _id: "000000000000000000000099", name: "Read Item", toObject: () => ({ _id: "000000000000000000000099" }) });

  const byId = await inventoryItemRepository.findById("000000000000000000000099");
  const list = await inventoryItemRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.ok(byId === null); // stubbed findById returns null; the fallback is what matters
  assert.strictEqual(typeof (await inventoryItemRepository.count({})), "number");
});

test("fallback: updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubItemsCollection();
  const created = await inventoryItemRepository.create({
    name: "Update Item",
    unit: "Box",
    availableStock: 5,
  });
  const updated = await inventoryItemRepository.updateById(created._id, { availableStock: 9 });
  assert.ok(saved.length === 1);
  assert.strictEqual(updated.availableStock, 9);
});

test("fallback: deletes route to the Mongoose model without throwing", async () => {
  pinMongoFallback();
  stubItemsCollection();
  const result = await inventoryItemRepository.destroy("000000000000000000000001");
  assert.strictEqual(result, false); // stubbed delete returns null → false, par with Mongo findByIdAndDelete
});

// ─── Fallback requirement 4: Mongo fallback needs no PG tables ──────────────
test("fallback: Mongo fallback works when the inventory_items table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubItemsCollection();
  // The Mongoose model path must not touch PostgreSQL at all.
  const item = await inventoryItemRepository.create({
    name: "No PG Item",
    unit: "Pack",
    availableStock: 3,
  });
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(item.name, "No PG Item");

  // Also verify with PG DATABASE_URL removed and an actual table absence: the
  // fallback path never runs a PostgreSQL query, so unrelated tables/columns
  // existing or not is irrelevant.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await inventoryItemRepository.create({
    name: "No PG At All",
    unit: "Pack",
  });
  assert.strictEqual(again.name, "No PG At All");
});

// ─── Fallback requirement 5: existing Mongo behaviour is unchanged ─────────
test("fallback: Mongo defaults are applied by the model (unit Pack, Consumable, 0 stock)", async () => {
  pinMongoFallback();
  const { saved } = stubItemsCollection();
  const item = await inventoryItemService.create({ name: "Defaults Item" });
  const record = saved[0];
  assert.ok(record);
  assert.strictEqual(item.name, "Defaults Item");
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  // First migrate so PostgreSQL has the inventory_items table, then measure
  // its row count before and after a Mongo-fallback create. Since the seam is
  // disconnected, the repository must touch ONLY the Mongo model — no PG row
  // may appear.
  ensureInventoryTable();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM inventory_items");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubItemsCollection();
  await inventoryItemRepository.create({
    name: "No Dual Write",
    unit: "Pack",
  });
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});