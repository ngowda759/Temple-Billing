// Phase 2P fallback tests.
//
// The Asset persistence layer is additive and entity-scoped:
//
//   Asset Service
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    assetRepository → assets + asset_maintenance_history
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose Asset model (unchanged Phase 1 Mongo path)
//
// These tests prove which database path is actually used, that the Mongo
// fallback genuinely invokes the Mongoose model (not a stub's return values),
// that no dual writes happen, and that the datasource seam can be switched
// without a fresh Node process.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const dbConfig = require("../src/config/db");
const Asset = require("../src/models/Asset");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let assetService;
let assetRepository;

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

  assetService = require("../src/services/assetService");
  assetRepository = require("../src/repositories/assetRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

// Re-runs the full migration chain so the assets table exists in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

/**
 * Replaces the Asset Mongoose model with call-tracking spies so tests can prove
 * the Mongo path is genuinely invoked on the fallback branch. The loaded model
 * object is the SAME reference the repository/service invoke at call time, so
 * swapping the methods is authoritative regardless of module load order.
 */
const stubAssetCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    id,
    toObject: () => ({ ...obj, _id: id, id }),
    maintenanceHistory: obj.maintenanceHistory ? [...obj.maintenanceHistory] : [],
    save: async function save() { calls.push(["save", this._id]); return this; },
  });
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
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
    return saved[0] || null;
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
    existing.save = async function save() { calls.push(["save", this._id]); return this; };
    return existing;
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

  Asset.create = create;
  Asset.findById = findById;
  Asset.findOne = findOne;
  Asset.find = find;
  Asset.findByIdAndUpdate = findByIdAndUpdate;
  Asset.findByIdAndDelete = findByIdAndDelete;
  Asset.countDocuments = countDocuments;
  Asset.prototype.save = async function save() {
    calls.push(["self-save", this._id]);
    return this;
  };
  return { saved, calls };
};

const assetBase = (overrides = {}) => ({
  assetId: "AST-FALLBACK-1",
  name: "Fallback Asset",
  category: "Electrical",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await assetService.usePostgres(), false);
  assert.strictEqual(assetService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await assetService.usePostgres(), false);
});

test("fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubAssetCollection();
  const created = await assetRepository.create(assetBase());
  assert.strictEqual(saved.length, 1, "create routed to Mongoose model");
  assert.strictEqual(created.assetId, "AST-FALLBACK-1");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  stubAssetCollection();
  await assetRepository.findById("000000000000000000000099");
  const list = await assetRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0, "stubbed query returns empty");
  assert.strictEqual(typeof (await assetRepository.count({})), "number");
});

test("fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubAssetCollection();
  const created = await assetRepository.create(assetBase());
  assert.strictEqual(saved.length, 1);
  const updated = await assetRepository.updateById(created._id, { status: "Under Repair" });
  assert.strictEqual(updated.status, "Under Repair", "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: repository deletes route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubAssetCollection();
  const created = await assetRepository.create(assetBase());
  assert.strictEqual(await assetRepository.destroy(created._id), true);
  assert.strictEqual(await assetRepository.destroy(created._id), false);
  assert.strictEqual(saved.length, 0, "destroy removed the saved doc from the model store");
});

test("fallback: service addMaintenanceRecord pushes to the Mongoose document and saves it", async () => {
  pinMongoFallback();
  const { saved, calls } = stubAssetCollection();
  const created = await assetRepository.create(assetBase());
  const entry = await assetService.addMaintenanceRecord(created._id, {
    repairDate: new Date("2025-03-01T00:00:00.000Z"),
    description: "Fan replaced",
    cost: 750.25,
    vendor: "Electrician Shop",
  });
  assert.ok(calls.some(([name]) => name === "findById"), "addMaintenanceRecord loaded the asset via Mongoose findById");
  assert.ok(calls.some(([name]) => name === "save"), "asset saved through the Mongoose document save");
  assert.strictEqual(saved[0].maintenanceHistory.length, 1);
  assert.strictEqual(entry.description, "Fan replaced");
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the assets table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubAssetCollection();
  const created = await assetRepository.create(assetBase({ description: "no-table" }));
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");
  assert.strictEqual(created.name, "Fallback Asset");

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await assetRepository.create(assetBase({ name: "still-works" }));
  assert.strictEqual(again.name, "still-works");
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM assets");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubAssetCollection();
  await assetRepository.create(assetBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { calls } = stubAssetCollection();

  const asset = await assetService.create(assetBase({ description: "svc-fallback" }));
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(asset.assetId, "AST-FALLBACK-1");

  await assetService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  await assetService.findOne({ assetId: "AST-FALLBACK-1" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.assetId === "AST-FALLBACK-1"), "findOne routed to Mongoose findOne spy");

  await assetService.findMany({ filter: { status: "Active" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Active"), "findMany routed to Mongoose find spy");

  const updated = await assetService.updateById("000000000000000000000001", { status: "Retired" });
  assert.strictEqual(updated.status, "Retired", "updateById applied through Mongoose findByIdAndUpdate");

  await assetService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");
  assert.strictEqual(await assetService.destroy("000000000000000000000001"), true, "destroy routed to Mongoose findByIdAndDelete spy");
});

// ─── Datasource switching within one process ───────────────────────────────
test("fallback: seam can flip back to PostgreSQL within the same process", async () => {
  pinMongoFallback();
  stubAssetCollection();
  const created = await assetRepository.create(assetBase());
  assert.ok(created._id);

  // Flip the seam to connected — the SAME loaded repository module now routes
  // to PostgreSQL without a fresh Node process.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await assetRepository.destroy(created._id), false, "the Mongo id does not exist in PG");
  } finally {
    pinMongoFallback();
  }
});