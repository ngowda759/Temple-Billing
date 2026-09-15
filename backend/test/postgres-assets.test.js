// Phase 2P PostgreSQL-path tests for the Asset repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the assetRepository / assetService persist to and read from the real
//     assets + asset_maintenance_history tables (no mocks),
//   - every Mongo schema field round-trips losslessly (IDs, enums, dates,
//     purchaseCost/maintenance cost monetary precision),
//   - defaults, validation and the asset lifecycle semantics match the Mongo
//     model exactly (assetId unique + required, name required, category/status
//     enums, purchaseDate nullable, warranty a String not a Date),
//   - filtering, $in, sorting and pagination behave like the Mongo query
//     surface,
//   - the child asset_maintenance_history FK CASCADE mirrors the embedded-array
//     lifecycle,
//   - the service never writes to MongoDB while PostgreSQL is selected
//     (no dual writes) and can switch datasources in-process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let assetRepository;
let assetService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS damage_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_order_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_logs CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS prasadam_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS pooja_booking_material_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS pooja_bookings CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_material_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS bookings CASCADE");
    await pool.query("DROP TABLE IF EXISTS bill_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS bills CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_transactions CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_heads CASCADE");
    await pool.query("DROP TABLE IF EXISTS employees CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_tickets CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS donations CASCADE");
    await pool.query("DROP TABLE IF EXISTS pg_health");
  } finally {
    await pool.end();
  }
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await resetAllTables(TEST_DB_URL);
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  if (res.status !== 0) {
    throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);
  }
  dbConfig.isDbConnected = () => true;
  assetRepository = require("../src/repositories/assetRepository");
  assetService = require("../src/services/assetService");
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const assetBase = (overrides = {}) => ({
  assetId: `AST-${unique()}`,
  name: "PG Path Asset",
  purchaseDate: new Date("2024-05-15T10:30:00.000Z"),
  ...overrides,
});

const maintenanceBase = (overrides = {}) => ({
  repairDate: new Date("2025-03-01T00:00:00.000Z"),
  description: "serviced",
  cost: "750.25",
  vendor: "Electrician Shop",
  ...overrides,
});

// ─── Service datasource selection ──────────────────────────────────────────
test("PG path: service selects PostgreSQL when the dedicated fallback is available", async () => {
  assert.strictEqual(await assetService.usePostgres(), true);
  assert.strictEqual(assetService.isConnected(), true);
});

// ─── create / read round-trip ──────────────────────────────────────────────
test("PG path: service create persists a real assets row with Mongo field names", async () => {
  const created = await assetService.create(assetBase({
    assetId: "AST-SVC-PG",
    category: "Electronics",
    qrCode: "QR-42",
    supplier: "0000000000000000000000aa",
    invoiceNumber: "INV-101",
    warranty: "1 Year",
    assignedLocation: "Annexe",
    status: "Under Repair",
    purchaseCost: "1000.99",
    serialNumber: "SN-SVC-1",
    maintenanceHistory: [maintenanceBase()],
  }));
  assert.match(created._id, /^[0-9a-f]{24}$/, "Mongo-compatible ObjectId id");
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.assetId, "AST-SVC-PG");
  assert.strictEqual(created.name, "PG Path Asset");
  assert.strictEqual(created.category, "Electronics");
  assert.strictEqual(created.qrCode, "QR-42");
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.invoiceNumber, "INV-101");
  assert.strictEqual(created.warranty, "1 Year");
  assert.strictEqual(created.assignedLocation, "Annexe");
  assert.strictEqual(created.status, "Under Repair");
  assert.strictEqual(created.purchaseCost, 1000.99);
  assert.strictEqual(created.serialNumber, "SN-SVC-1");
  assert.ok(created.createdAt instanceof Date, "createdAt is a Date");
  assert.ok(created.updatedAt instanceof Date, "updatedAt is a Date");
  assert.strictEqual(created.maintenanceHistory.length, 1, "embedded maintenance history read back");
  assert.strictEqual(created.maintenanceHistory[0].cost, 750.25);
  assert.strictEqual(created.maintenanceHistory[0].vendor, "Electrician Shop");

  // Real rows exist in PostgreSQL (assets + child maintenance).
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id, asset_id FROM assets WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "assets row must exist");
    const { rows: child } = await pool.query(
      "SELECT id FROM asset_maintenance_history WHERE asset_id = $1",
      [created._id]
    );
    assert.strictEqual(child.length, 1, "asset_maintenance_history row must exist");
  } finally {
    await pool.end();
  }
  await assetRepository.destroy(created._id);
});

test("PG path: repository findById / findOne read back the round-tripped document", async () => {
  const created = await assetRepository.create(assetBase());
  const byId = await assetRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.assetId, created.assetId);
  assert.strictEqual(byId.name, "PG Path Asset");
  assert.strictEqual(byId.status, "Active");

  const byOne = await assetRepository.findOne({ assetId: created.assetId });
  assert.strictEqual(byOne._id, created._id);
  assert.strictEqual(await assetRepository.findOne({ assetId: "DOES-NOT-EXIST" }), null);
  await assetRepository.destroy(created._id);
});

test("PG path: repository create defaults match the Mongo schema", async () => {
  const created = await assetRepository.create({
    assetId: `AST-${unique()}`,
    name: "Defaults Asset",
  });
  assert.strictEqual(created.assetId, created.assetId);
  assert.strictEqual(created.category, "Other", "category default 'Other'");
  assert.strictEqual(created.qrCode, "", "qrCode default ''");
  assert.strictEqual(created.purchaseDate, undefined, "purchaseDate default null/absent");
  assert.strictEqual(created.supplier, undefined, "supplier default unset");
  assert.strictEqual(created.invoiceNumber, "", "invoiceNumber default ''");
  assert.strictEqual(created.warranty, "", "warranty default '' (String)");
  assert.strictEqual(created.assignedLocation, "Main Temple", "assignedLocation default 'Main Temple'");
  assert.strictEqual(created.status, "Active", "status default 'Active'");
  assert.strictEqual(created.purchaseCost, 0, "purchaseCost default 0");
  assert.strictEqual(created.serialNumber, "", "serialNumber default ''");
  assert.deepStrictEqual(created.maintenanceHistory, [], "maintenanceHistory default []");
  await assetRepository.destroy(created._id);
});

test("PG path: invalid enums and required fields are rejected like the Mongo schema", async () => {
  await assert.rejects(assetRepository.create(assetBase({ category: "Vehicles" })), /Invalid category: Vehicles/);
  await assert.rejects(assetRepository.create(assetBase({ status: "Scrapped" })), /Invalid status: Scrapped/);
  await assert.rejects(assetRepository.create(assetBase({ assetId: "" })), /assetId is required/);
  await assert.rejects(assetRepository.create(assetBase({ name: "  " })), /name is required/);
});

test("PG path: optional fields stay unset (undefined) unless provided", async () => {
  const created = await assetRepository.create({
    assetId: `AST-${unique()}`,
    name: "Optional Asset",
  });
  const reloaded = await assetRepository.findById(created._id);
  assert.strictEqual(reloaded.purchaseDate, undefined);
  assert.strictEqual(reloaded.supplier, undefined);
  assert.strictEqual(reloaded.maintenanceHistory.length, 0);
  await assetRepository.destroy(created._id);
});

// ─── Precision ─────────────────────────────────────────────────────────────
test("PG path: purchaseCost and maintenance cost preserve exact NUMERIC precision", async () => {
  const values = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"];
  for (const v of values) {
    const a = await assetRepository.create(assetBase({ purchaseCost: v }));
    const read = await assetRepository.findById(a._id);
    assert.strictEqual(read.purchaseCost, Number(v), `purchaseCost ${v} round-trips exactly`);
    const mh = await assetRepository.addMaintenanceRecord(a._id, { cost: v, description: "prec" });
    assert.strictEqual(mh.cost, Number(v), `maintenance cost ${v} round-trips exactly`);
    await assetRepository.destroy(a._id);
  }
});

// ─── update / delete workflow ──────────────────────────────────────────────
test("PG path: updateById persists scalar changes (status and location)", async () => {
  const created = await assetRepository.create(assetBase());
  const updated = await assetRepository.updateById(created._id, {
    status: "Under Repair",
    assignedLocation: "Store Room",
    purchaseCost: "2500.75",
  });
  assert.strictEqual(updated.status, "Under Repair");
  assert.strictEqual(updated.assignedLocation, "Store Room");
  assert.strictEqual(updated.purchaseCost, 2500.75);
  const reloaded = await assetRepository.findById(created._id);
  assert.strictEqual(reloaded.status, "Under Repair");
  await assetRepository.destroy(created._id);
});

test("PG path: updateById enforces enums and non-empty required scalars", async () => {
  const created = await assetRepository.create(assetBase());
  await assert.rejects(
    assetRepository.updateById(created._id, { status: "Scrapped" }),
    /Invalid status: Scrapped/
  );
  await assert.rejects(
    assetRepository.updateById(created._id, { category: "Vehicles" }),
    /Invalid category: Vehicles/
  );
  await assert.rejects(
    assetRepository.updateById(created._id, { assetId: "" }),
    /assetId is required/
  );
  await assert.rejects(
    assetRepository.updateById(created._id, { name: "" }),
    /name is required/
  );
  await assetRepository.destroy(created._id);
});

test("PG path: updateById on a missing id returns null", async () => {
  assert.strictEqual(await assetRepository.updateById("000000000000000000000001", { status: "Retired" }), null);
});

test("PG path: addMaintenanceRecord appends in array order and cascades on destroy", async () => {
  const created = await assetRepository.create(assetBase());
  await assetRepository.addMaintenanceRecord(created._id, maintenanceBase());
  await assetRepository.addMaintenanceRecord(created._id, { cost: "5.5", description: "second", repairDate: new Date("2026-01-01T00:00:00Z") });
  const reloaded = await assetRepository.findById(created._id);
  assert.strictEqual(reloaded.maintenanceHistory.length, 2, "appended in array order");
  assert.strictEqual(reloaded.maintenanceHistory[0].description, "serviced");
  assert.strictEqual(reloaded.maintenanceHistory[1].description, "second");
  assert.strictEqual(reloaded.maintenanceHistory[0].cost, 750.25);

  // Child rows exist and cascade when the parent is deleted.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM asset_maintenance_history WHERE asset_id = $1",
      [created._id]
    );
    assert.strictEqual(rows[0].n, 2, "child rows present");
  } finally {
    await pool.end();
  }

  assert.strictEqual(await assetRepository.destroy(created._id), true);
  assert.strictEqual(await assetRepository.destroy(created._id), false);
  const pool2 = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool2.query(
      "SELECT count(*)::int AS n FROM asset_maintenance_history WHERE asset_id = $1",
      [created._id]
    );
    assert.strictEqual(rows[0].n, 0, "child rows cascaded away with the parent");
  } finally {
    await pool2.end();
  }
});

// ─── filters / count / sort / pagination ───────────────────────────────────
test("PG path: findMany filters by status, category, supplier, assignedLocation, serialNumber; $in supported", async () => {
  const supplierId = crypto.randomBytes(12).toString("hex");
  const a = await assetRepository.create(assetBase({ category: "Electrical", status: "Active", assignedLocation: "Main Temple", supplier: supplierId }));
  const b = await assetRepository.create(assetBase({ category: "Furniture", status: "Under Repair", assignedLocation: "Store Room" }));
  const c = await assetRepository.create(assetBase({ category: "Electrical", status: "Retired", assignedLocation: "Annexe", serialNumber: "SN-C" }));

  // Filters are scoped to the exact ids created in this test, so any leftover
  // rows from earlier tests cannot skew the counts.
  const ids = [a._id, b._id, c._id];
  const byIds = (filter) => assetRepository.findMany({ filter: { id: { $in: ids }, ...filter } });

  assert.strictEqual((await byIds({ category: "Electrical" })).length, 2);
  assert.strictEqual((await byIds({ status: "Under Repair" })).length, 1);
  assert.strictEqual((await byIds({ status: "Active" })).length, 1);
  assert.strictEqual((await byIds({ status: "Retired" })).length, 1);
  assert.strictEqual((await byIds({ supplier: supplierId })).length, 1);
  assert.strictEqual((await byIds({ serialNumber: "SN-C" })).length, 1);
  assert.strictEqual((await byIds({ id: { $in: [a._id, b._id] } })).length, 2);
  assert.strictEqual((await byIds({ status: { $in: ["Active", "Retired"] } })).length, 2);
  assert.strictEqual((await byIds({ status: { $in: [] } })).length, 0);
  assert.strictEqual((await assetRepository.findMany({ filter: { status: { $in: [] } } })).length, 0, "$in: [] always matches nothing");

  await assetRepository.destroy(a._id);
  await assetRepository.destroy(b._id);
  await assetRepository.destroy(c._id);
});

test("PG path: count uses COUNT(*) and honors $in / empty $in", async () => {
  const base = await assetRepository.count({});
  const a = await assetRepository.create(assetBase({ status: "Active" }));
  const b = await assetRepository.create(assetBase({ status: "Under Repair" }));
  assert.strictEqual(await assetRepository.count({}), base + 2);
  assert.strictEqual(await assetRepository.count({ status: "Active" }), base + 1);
  assert.strictEqual(await assetRepository.count({ status: { $in: ["Active", "Under Repair"] } }), base + 2);
  assert.strictEqual(await assetRepository.count({ status: { $in: ["Retired"] } }), await assetRepository.count({ status: "Retired" }));
  assert.strictEqual(await assetRepository.count({ status: { $in: [] } }), 0);
  await assetRepository.destroy(a._id);
  await assetRepository.destroy(b._id);
});

test("PG path: findMany sorts (whitelist) and paginates with limit/offset", async () => {
  const assets = [];
  for (const name of ["zeta", "alpha", "mid"]) {
    assets.push(await assetRepository.create(assetBase({ name })));
  }
  // Scope to the created ids so leftover rows cannot disturb the sort order.
  const ids = assets.map((a) => a._id);
  const idFilter = { id: { $in: ids } };
  const sorted = await assetRepository.findMany({ filter: idFilter, sort: { name: 1 } });
  assert.deepStrictEqual(sorted.map((a) => a.name), ["alpha", "mid", "zeta"]);
  const paged = await assetRepository.findMany({ filter: idFilter, sort: { name: 1 }, limit: 2, offset: 1 });
  assert.deepStrictEqual(paged.map((a) => a.name), ["mid", "zeta"]);
  const hostile = await assetRepository.findMany({ filter: idFilter, sort: { "x; DROP TABLE assets--": -1 } });
  assert.strictEqual(hostile.length, 3, "hostile sort key falls back safely");
  for (const a of assets) await assetRepository.destroy(a._id);
});

// ─── duplicate key semantics ───────────────────────────────────────────────
test("PG path: duplicate assetId surfaces the same 409-style contract as Mongo 11000", async () => {
  const a = await assetRepository.create(assetBase({ assetId: "AST-DUP" }));
  await assert.rejects(
    assetRepository.create(assetBase({ assetId: "AST-DUP" })),
    /duplicate key value violates unique constraint "assets_asset_id_key"/
  );
  await assetRepository.destroy(a._id);
});

test("PG path: a single service create writes exactly one row and never touches MongoDB (no dual write)", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  let pgCountBefore;
  try {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM assets");
    pgCountBefore = rows[0].n;
  } finally {
    await pool.end();
  }

  const created = await assetService.create(assetBase());
  const rowCount = await assetRepository.count({});
  assert.strictEqual(rowCount, pgCountBefore + 1, "exactly one new assets row");

  // A document in MongoDB could only exist if mongoose had been connected &
  // written. The service can't persist to Mongo when the seam is PG; there is
  // no dual-write branch in the code. Verify the id round-trips and that
  // mongoose is not connected.
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected — nothing could have been written to MongoDB");
});

test("datasource switching: same process flips between PG and Mongo paths by patching the seam", async () => {
  const realIsDbConnected = originalIsDbConnected;
  try {
    // 1) PG selected
    dbConfig.isDbConnected = () => true;
    const pgAsset = await assetService.create(assetBase());
    assert.match(pgAsset._id, /^[0-9a-f]{24}$/);

    // 2) Mongo selected
    dbConfig.isDbConnected = realIsDbConnected;
    const usePg = await assetService.usePostgres();
    assert.strictEqual(usePg, false);
    const countPgRows = async () => {
      const pool = new Pool({ connectionString: TEST_DB_URL });
      try {
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM assets");
        return rows[0].n;
      } finally {
        await pool.end();
      }
    };
    const before = await countPgRows();
    await assert.rejects(
      assetService.create(assetBase()),
      (err) => {
        assert.match(
          String(err.message),
          /MongooseError|ECONNREFUSED|buffering timed out|connect|Path `assetId` is required/i,
          "Mongo path must actually be invoked"
        );
        return true;
      }
    );
    const after = await countPgRows();
    assert.strictEqual(after, before, "no PG rows were written while the Mongo path was selected (no dual write)");

    // 3) Back to PG — the asset created earlier is untouched.
    dbConfig.isDbConnected = () => true;
    const found = await assetService.findById(pgAsset._id);
    assert.ok(found, "PG asset still exists after switching paths");
  } finally {
    dbConfig.isDbConnected = () => true;
  }
});