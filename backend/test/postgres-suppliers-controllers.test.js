// Phase 2AH controller-level tests for the Supplier endpoints.
//
// These drive the real inventorySupplierController handlers (not the service in
// isolation) so the API contract is verified end-to-end:
//   - getAllSuppliers / createSupplier / updateSupplier / deleteSupplier persist
//     and read through the PostgreSQL repository when the datasource seam
//     selects PostgreSQL,
//   - the same handlers fall back to Mongoose when the seam selects Mongo,
//   - a write reaches exactly one datasource (no dual persistence),
//   - the response shapes, status codes and the pre-existing `clean()` input
//     normalisation are unchanged from before the wiring.
//
// The Mongo model is stubbed (not a live MongoDB) because these tests must prove
// *which* datasource each handler selected and that the Mongo branch genuinely
// invokes the Mongoose model — the PG branch is exercised against the real
// PostgreSQL tables with no mocks.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Supplier = require("../src/models/Supplier");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const hex24 = () => crypto.randomBytes(12).toString("hex");
const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let originalFind;
let originalCreate;
let originalFindByIdAndUpdate;
let originalFindByIdAndDelete;
let supplierController;
let supplierService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const row of rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    }
  } finally {
    await pool.end();
  }
};

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const createMockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const pinConnected = () => { dbConfig.isDbConnected = () => true; };
const pinDisconnected = () => { dbConfig.isDbConnected = () => false; };

// Captures the Mongo reads/writes without touching real MongoDB, so a test can
// assert that the fallback branch really used the Mongoose model.
const stubMongo = () => {
  const calls = { finds: [], creates: [], updates: [], deletes: [] };
  Supplier.find = (filter) => {
    calls.finds.push(filter);
    const chain = {
      sort: (s) => { calls.finds.push(s); return Promise.resolve([]); },
      then: (resolve) => Promise.resolve([]).then(resolve),
    };
    return chain;
  };
  Supplier.create = async (data) => {
    calls.creates.push(data);
    return { ...data, _id: hex24() };
  };
  Supplier.findByIdAndUpdate = async (id, updates, options) => {
    calls.updates.push({ id, updates, options });
    return { _id: id, ...updates };
  };
  Supplier.findByIdAndDelete = async (id) => {
    calls.deletes.push(id);
    return { _id: id, name: "Deleted" };
  };
  return calls;
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  originalFind = Supplier.find;
  originalCreate = Supplier.create;
  originalFindByIdAndUpdate = Supplier.findByIdAndUpdate;
  originalFindByIdAndDelete = Supplier.findByIdAndDelete;

  await resetAllTables(TEST_DB_URL);
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  if (res.status !== 0) {
    throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);
  }

  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;

  supplierController = require("../src/controllers/inventorySupplierController");
  supplierService = require("../src/services/supplierService");
  pinConnected();
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  Supplier.find = originalFind;
  Supplier.create = originalCreate;
  Supplier.findByIdAndUpdate = originalFindByIdAndUpdate;
  Supplier.findByIdAndDelete = originalFindByIdAndDelete;
  await closePostgres();
});

// ─── PostgreSQL path ───────────────────────────────────────────────────────
test("supplier controller (PG): createSupplier persists one row and keeps the 201 shape", async () => {
  const calls = stubMongo();
  const res = createMockRes();
  await supplierController.createSupplier(
    { body: { name: "  PG Supplier  ", address: " 1 Road ", phone: " 999 ", email: " a@b.com ", gst: " GST1 " } },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.supplier.name, "PG Supplier", "the controller's clean() trimmed the name");
  assert.strictEqual(res.body.supplier.address, "1 Road");
  assert.strictEqual(res.body.supplier.phone, "999");
  assert.strictEqual(res.body.supplier.gst, "GST1");

  const rows = await pgQuery("SELECT name, address, gst FROM suppliers WHERE id = $1", [res.body.supplier._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, "PG Supplier");
  assert.strictEqual(rows[0].gst, "GST1");
  assert.strictEqual(calls.creates.length, 0, "no dual write to Mongo");
});

test("supplier controller (PG): getAllSuppliers lists from PostgreSQL sorted by name", async () => {
  const tag = unique();
  await supplierService.create({ name: `Ctrl B ${tag}` });
  await supplierService.create({ name: `Ctrl A ${tag}` });

  const res = createMockRes();
  await supplierController.getAllSuppliers({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  const mine = res.body.suppliers.filter((s) => s.name.endsWith(tag)).map((s) => s.name);
  assert.deepStrictEqual(mine, [`Ctrl A ${tag}`, `Ctrl B ${tag}`], "ascending by name, as Supplier.find().sort({name:1})");
});

test("supplier controller (PG): updateSupplier updates the row and returns it", async () => {
  const created = await supplierService.create({ name: `Before ${unique()}` });
  const res = createMockRes();
  await supplierController.updateSupplier(
    { params: { id: created._id }, body: { name: " After ", address: " New ", phone: " 1 ", email: " e@x.com ", gst: " G " } },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.supplier.name, "After");
  assert.strictEqual(res.body.supplier.address, "New");

  const rows = await pgQuery("SELECT name, address, phone, email, gst FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].name, "After");
  assert.strictEqual(rows[0].email, "e@x.com");
  assert.strictEqual(rows[0].gst, "G");
});

test("supplier controller (PG): updateSupplier with no body clears fields, as the Mongo call does", async () => {
  // updateSupplier sends all five cleaned fields, so an empty body writes ''
  // for each. The Mongoose call passes no runValidators, so this was already
  // accepted before the migration and must stay accepted.
  const created = await supplierService.create({ name: `Clear ${unique()}`, address: "Old" });
  const res = createMockRes();
  await supplierController.updateSupplier({ params: { id: created._id }, body: {} }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.supplier.name, "");
  const rows = await pgQuery("SELECT name, address FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(rows[0].name, "");
  assert.strictEqual(rows[0].address, "");
});

test("supplier controller (PG): updateSupplier 404s for an unknown id", async () => {
  const res = createMockRes();
  await supplierController.updateSupplier({ params: { id: hex24() }, body: { name: "X" } }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.success, false);
});

test("supplier controller (PG): deleteSupplier removes the row", async () => {
  const created = await supplierService.create({ name: `Del ${unique()}` });
  const res = createMockRes();
  await supplierController.deleteSupplier({ params: { id: created._id } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.message, "Supplier deleted");
  const rows = await pgQuery("SELECT id FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 0, "row removed from PostgreSQL");
});

test("supplier controller (PG): deleteSupplier 404s for an unknown id", async () => {
  const res = createMockRes();
  await supplierController.deleteSupplier({ params: { id: hex24() } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test("supplier controller (PG): createSupplier rejects a blank name with 400 before touching either datasource", async () => {
  const calls = stubMongo();
  const beforeIds = new Set((await pgQuery("SELECT id FROM suppliers")).map((r) => r.id));
  for (const name of [undefined, "", "   "]) {
    const res = createMockRes();
    await supplierController.createSupplier({ body: { name } }, res);
    assert.strictEqual(res.statusCode, 400, `name ${JSON.stringify(name)} is rejected`);
    assert.strictEqual(res.body.message, "Name is required");
  }
  assert.strictEqual(calls.creates.length, 0, "nothing was written to Mongo");
  // Compare id sets rather than a global count: sibling test files run
  // concurrently against the same database.
  const newRows = (await pgQuery("SELECT id FROM suppliers")).filter((r) => !beforeIds.has(r.id));
  assert.deepStrictEqual(newRows, [], "nothing was written to PostgreSQL");
});

// ─── Mongo fallback ────────────────────────────────────────────────────────
test("supplier controller (Mongo fallback): createSupplier writes through Mongoose", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const res = createMockRes();
  await supplierController.createSupplier({ body: { name: " Mongo Supplier ", phone: " 5 " } }, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(calls.creates.length, 1, "Mongoose create is the write path");
  assert.strictEqual(calls.creates[0].name, "Mongo Supplier");
  assert.strictEqual(calls.creates[0].phone, "5");

  // Nothing was written to PostgreSQL on the fallback branch (no dual write).
  const rows = await pgQuery("SELECT id FROM suppliers WHERE name = $1", ["Mongo Supplier"]);
  assert.strictEqual(rows.length, 0, "no dual write to PostgreSQL");
  pinConnected();
});

test("supplier controller (Mongo fallback): getAllSuppliers reads through Mongoose", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const res = createMockRes();
  await supplierController.getAllSuppliers({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.finds[0], {}, "Supplier.find({}) on the fallback path");
  assert.deepStrictEqual(calls.finds[1], { name: 1 }, "sorted by name, as before the migration");
  pinConnected();
});

test("supplier controller (Mongo fallback): updateSupplier keeps the findByIdAndUpdate contract", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const id = hex24();
  const res = createMockRes();
  await supplierController.updateSupplier({ params: { id }, body: { name: " Up ", gst: " G " } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.updates.length, 1);
  assert.strictEqual(calls.updates[0].id, id);
  assert.deepStrictEqual(calls.updates[0].options, { new: true }, "the { new: true } option is preserved");
  assert.strictEqual(calls.updates[0].updates.name, "Up");
  assert.strictEqual(calls.updates[0].updates.gst, "G");
  pinConnected();
});

test("supplier controller (Mongo fallback): deleteSupplier uses findByIdAndDelete", async () => {
  pinDisconnected();
  const calls = stubMongo();
  const id = hex24();
  const res = createMockRes();
  await supplierController.deleteSupplier({ params: { id } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.deletes, [id]);
  pinConnected();
});

// ─── Datasource switching ──────────────────────────────────────────────────
test("datasource switching: the same process flips between PG and Mongo by patching the seam", async () => {
  const tag = unique();

  // PG selected.
  pinConnected();
  assert.strictEqual(await supplierService.usePostgres(), true);
  const created = await supplierService.create({ name: `Switch ${tag}` });
  assert.strictEqual(created._id.length, 24);
  const pgRows = await pgQuery("SELECT id FROM suppliers WHERE name = $1", [`Switch ${tag}`]);
  assert.strictEqual(pgRows.length, 1, "row landed in PostgreSQL");

  // Mongo selected — the same service instance must route back to Mongoose.
  pinDisconnected();
  const calls = stubMongo();
  assert.strictEqual(await supplierService.usePostgres(), false);
  await supplierService.create({ name: `Switch Mongo ${tag}` });
  assert.strictEqual(calls.creates.length, 1, "Mongoose handled the write once the seam flipped");
  const stillOne = await pgQuery("SELECT id FROM suppliers WHERE name = $1", [`Switch Mongo ${tag}`]);
  assert.strictEqual(stillOne.length, 0, "no dual write while Mongo was selected");

  pinConnected();
});

test("datasource gate: PostgreSQL unreachable falls back to Mongo even when the seam is connected", async () => {
  const saved = process.env.DATABASE_URL;
  try {
    pinConnected();
    process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nope";
    await closePostgres();
    assert.strictEqual(await supplierService.usePostgres(), false, "the PG probe gates the path, not just the seam");
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
    pinConnected();
  }
});

// ─── Public asset route ────────────────────────────────────────────────────
test("public asset route: the supplier name resolves from PostgreSQL once suppliers are PG-backed", async () => {
  // publicAssetController.getPublicAssetDetails renders asset.supplier as a
  // NAME. Assets store the supplier id as TEXT, so the controller looks the
  // supplier up by id — and that lookup must follow the selected datasource,
  // otherwise a supplier created through the PG path (invisible to Mongo)
  // would render as 'N/A' on the public QR page.
  pinConnected();
  const publicAssetController = require("../src/controllers/publicAssetController");
  const supplier = await supplierService.create({ name: `Public ${unique()}` });

  const assetId = hex24();
  const assetService = require("../src/services/assetService");
  const repairTicketService = require("../src/services/repairTicketService");
  const originalAssetFindOne = assetService.findOne;
  const originalTickets = repairTicketService.findMany;
  assetService.findOne = async () => ({
    _id: assetId, assetId: `AST-${unique()}`, name: "Public Asset", category: "Equipment",
    supplier: supplier._id, // stored as the plain id string, as inventoryAssetController writes it
  });
  repairTicketService.findMany = async () => [];
  // The pre-fix controller read Supplier.findById directly; that path would
  // return 'N/A' here, which is exactly what this test guards against.
  const originalMongoFindById = Supplier.findById;
  Supplier.findById = async () => { throw new Error("the PG path must not fall back to the Mongoose model"); };
  try {
    const res = createMockRes();
    await publicAssetController.getPublicAssetDetails({ params: { assetId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.asset.supplier, supplier.name, "the PG-backed supplier name is rendered, not 'N/A'");
  } finally {
    assetService.findOne = originalAssetFindOne;
    repairTicketService.findMany = originalTickets;
    Supplier.findById = originalMongoFindById;
  }
});

test("public asset route: an unresolvable supplier still renders as 'N/A'", async () => {
  pinConnected();
  const publicAssetController = require("../src/controllers/publicAssetController");
  const assetId = hex24();
  const originalAssetFindOne = require("../src/services/assetService").findOne;
  const originalTickets = require("../src/services/repairTicketService").findMany;
  require("../src/services/assetService").findOne = async () => ({
    _id: assetId, assetId: `AST-${unique()}`, name: "Orphan Asset", category: "Equipment",
    supplier: hex24(), // no such supplier row
  });
  require("../src/services/repairTicketService").findMany = async () => [];
  try {
    const res = createMockRes();
    await publicAssetController.getPublicAssetDetails({ params: { assetId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.asset.supplier, "N/A");
  } finally {
    require("../src/services/assetService").findOne = originalAssetFindOne;
    require("../src/services/repairTicketService").findMany = originalTickets;
  }
});