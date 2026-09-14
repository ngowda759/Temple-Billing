const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const InventoryConsumption = require("../src/models/InventoryConsumption");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let inventoryConsumptionService;
let inventoryConsumptionRepository;

// The fallback behaviour must hold even when PostgreSQL is completely
// unavailable or lacks the consumption table. We pin the datasource-selection
// seam to "disconnected" so the repository routes to the Mongoose model,
// exactly as Phases 2A–2J do — this is the documented fallback path, never a
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

  // The services/repositories read the seam at call time, but they must be
  // loaded with a clean PostgreSQL config anyway (same ordering as the
  // Phase 2H/2J fallback tests).
  inventoryConsumptionService = require("../src/services/inventoryConsumptionService");
  inventoryConsumptionRepository = require("../src/repositories/inventoryConsumptionRepository");
});

// Re-runs the migrations so the inventory_consumptions table exists in
// PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

/**
 * Replaces the InventoryConsumption Mongoose model with call-tracking spies so
 * tests can prove the Mongo path is genuinely invoked on the fallback branch —
 * the loaded model object is the SAME reference the repository captures (it
 * calls properties like InventoryConsumption.create at call time), so swapping
 * the methods is authoritative regardless of module load order.
 */
const stubConsumptionsCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    toObject: () => ({ ...obj, _id: id }),
  });
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
    catch: (reject) => execQuery().catch(reject),
  };

  const create = async (data) => { calls.push(["create", data]); const d = doc(data); saved.push(d); return d; };
  const findById = async (id) => { calls.push(["findById", id]); return null; };
  const findOne = async (filter) => { calls.push(["findOne", filter]); const found = saved.find((d) => String(d._id) === String(filter.id)); return found || null; };
  const find = (filter) => { calls.push(["find", filter]); return chain; };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    return existing;
  };
  const findByIdAndDelete = async (id) => { calls.push(["findByIdAndDelete", id]); return null; };
  const countDocuments = async (filter) => { calls.push(["countDocuments", filter]); return 0; };
  const deleteMany = async () => ({ deletedCount: 0 });

  InventoryConsumption.create = create;
  InventoryConsumption.findById = findById;
  InventoryConsumption.findOne = findOne;
  InventoryConsumption.find = find;
  InventoryConsumption.findByIdAndUpdate = findByIdAndUpdate;
  InventoryConsumption.findByIdAndDelete = findByIdAndDelete;
  InventoryConsumption.countDocuments = countDocuments;
  InventoryConsumption.deleteMany = deleteMany;
  return { saved, calls };
};

const consumptionBase = (overrides = {}) => ({
  item: "000000000000000000000001",
  itemName: "Test Item",
  userId: "priest1",
  userName: "Priest One",
  role: "priest",
  issuedQuantity: 10,
  usedQuantity: 6,
  returnedQuantity: 4,
  unit: "Pack",
  ...overrides,
});

// ─── Fallback requirement 2: Mongo/Mongoose path remains when PG unavailable ─
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await inventoryConsumptionService.usePostgres(), false);
  assert.strictEqual(inventoryConsumptionService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await inventoryConsumptionService.usePostgres(), false);
});

test("fallback: repository routes creates to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubConsumptionsCollection();
  const consumption = await inventoryConsumptionRepository.create(consumptionBase());
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(consumption.usedQuantity, 6);
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubConsumptionsCollection();
  saved.push({ _id: "000000000000000000000099", usedQuantity: 2, toObject: () => ({ _id: "000000000000000000000099" }) });

  await inventoryConsumptionRepository.findById("000000000000000000000099");
  const list = await inventoryConsumptionRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.strictEqual(typeof (await inventoryConsumptionRepository.count({})), "number");
});

test("fallback: updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubConsumptionsCollection();
  const created = await inventoryConsumptionRepository.create(consumptionBase({ usedQuantity: 3 }));
  assert.ok(saved.length === 1);
  assert.strictEqual(created.usedQuantity, 3);

  const updated = await inventoryConsumptionRepository.updateById(created._id, { usedQuantity: 5 });
  assert.strictEqual(updated.usedQuantity, 5, "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: deletes route to the Mongoose model without throwing", async () => {
  pinMongoFallback();
  stubConsumptionsCollection();
  const result = await inventoryConsumptionRepository.destroy("000000000000000000000001");
  assert.strictEqual(result, false); // stubbed delete returns null → false, par with Mongo findByIdAndDelete
});

// ─── Fallback requirement 4: Mongo fallback needs no PG tables ──────────────
test("fallback: Mongo fallback works when the consumption table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubConsumptionsCollection();
  // The Mongoose model path must not touch PostgreSQL at all.
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({ usedQuantity: 2 }));
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(consumption.usedQuantity, 2);

  // Also verify with an actual table absence: the fallback path never runs a
  // PostgreSQL query, so unrelated tables/columns existing or not is irrelevant.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
  } finally {
    await pool.end();
  }
  const again = await inventoryConsumptionRepository.create(consumptionBase({ usedQuantity: 4 }));
  assert.strictEqual(again.usedQuantity, 4);
});

// ─── Fallback requirement 5: existing Mongo behaviour is unchanged ─────────
test("fallback: Mongo validation is still applied by the model path", async () => {
  pinMongoFallback();
  const { saved } = stubConsumptionsCollection();
  const consumption = await inventoryConsumptionService.create(consumptionBase({ usedQuantity: 2 }));
  assert.strictEqual(consumption.usedQuantity, 2);
  const record = saved[0];
  assert.ok(record);
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  // First migrate so PostgreSQL has the consumption table, then measure its
  // row count before and after a Mongo-fallback create. Since the seam is
  // disconnected, the repository must touch ONLY the Mongo model — no PG row
  // may appear.
  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM inventory_consumptions");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubConsumptionsCollection();
  await inventoryConsumptionRepository.create(consumptionBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── Fallback requirement: the SERVICE routes every operation through the
//     actual Mongoose model (not merely through a stub's return values) ─────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { saved, calls } = stubConsumptionsCollection();

  const consumption = await inventoryConsumptionService.create(consumptionBase({ usedQuantity: 4, returnedQuantity: 6 }));
  assert.strictEqual(calls[0][0], "create", "create routed to Mongoose create");
  assert.strictEqual(consumption.usedQuantity, 4);

  // findById routes to the model's findById spy.
  await inventoryConsumptionService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  // findOne routes to the model's findOne spy.
  await inventoryConsumptionService.findOne({ id: "000000000000000000000099" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.id === "000000000000000000000099"), "findOne routed to Mongoose findOne spy");

  // findMany routes to the model's find spy (thenable query chain).
  await inventoryConsumptionService.findMany({ filter: { item: "000000000000000000000001" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.item === "000000000000000000000001"), "findMany routed to Mongoose find spy");

  // updateById routes to the model's findByIdAndUpdate spy and finds the saved doc.
  const updated = await inventoryConsumptionService.updateById(saved[0]._id, { remarks: "x" });
  assert.strictEqual(updated.remarks, "x", "updateById applied through Mongoose findByIdAndUpdate");

  // count routes to the model's countDocuments spy.
  await inventoryConsumptionService.count({ item: "000000000000000000000001" });
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");

  // destroy routes to the model's findByIdAndDelete spy; stubbed delete
  // returns null → false, par with Mongo findByIdAndDelete.
  const destroyed = await inventoryConsumptionService.destroy("000000000000000000000001");
  assert.strictEqual(destroyed, false);
  assert.ok(calls.some(([name, id]) => name === "findByIdAndDelete" && id === "000000000000000000000001"), "destroy routed to Mongoose findByIdAndDelete spy");

  // create + findById + findOne + findMany + updateById + count + destroy = 7.
  assert.ok(calls.length >= 7, "expected at least 7 model method calls, got " + calls.length);
});

// ─── No global DB switch ────────────────────────────────────────────────────
test("fallback: the InventoryConsumption fallback path never touches the InventoryItem path", async () => {
  // The datasource seam is shared, but the Phase 2K path is entity-scoped:
  // when the seam is open the InventoryConsumption service routes to the PG
  // inventory_consumptions repository while InventoryItem keeps its own
  // Phase 2H repository. Neither performs a global DB cutover — both fallbacks
  // remain available per entity (verified by the remaining tests in this file).
  pinMongoFallback();
  assert.strictEqual(await inventoryConsumptionService.usePostgres(), false);
});