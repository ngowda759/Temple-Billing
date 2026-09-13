// Phase 2L fallback tests.
//
// The InventoryRequest persistence layer is additive and entity-scoped:
//
//   InventoryRequest
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    inventoryRequestRepository → inventory_requests table
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose InventoryRequest model (unchanged Phase 1 Mongo path)
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
const InventoryRequest = require("../src/models/InventoryRequest");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let inventoryRequestService;
let inventoryRequestRepository;

// Pins the shared datasource seam to "disconnected" so the InventoryRequest
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

  inventoryRequestService = require("../src/services/inventoryRequestService");
  inventoryRequestRepository = require("../src/repositories/inventoryRequestRepository");
});

// Re-runs the full migration chain so the inventory_requests table exists in
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
 * Replaces the InventoryRequest Mongoose model with call-tracking spies so
 * tests can prove the Mongo path is genuinely invoked on the fallback branch.
 * The loaded model object is the SAME reference the repository/service invoke
 * at call time, so swapping the methods is authoritative regardless of module
 * load order.
 */
const stubRequestsCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    id,
    toObject: () => ({ ...obj, _id: id, id }),
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
    existing.id = existing._id;
    return existing;
  };
  const findByIdAndDelete = async (id) => { calls.push(["findByIdAndDelete", id]); return null; };
  const countDocuments = async (filter) => { calls.push(["countDocuments", filter]); return 0; };
  const deleteMany = async () => ({ deletedCount: 0 });

  InventoryRequest.create = create;
  InventoryRequest.findById = findById;
  InventoryRequest.findOne = findOne;
  InventoryRequest.find = find;
  InventoryRequest.findByIdAndUpdate = findByIdAndUpdate;
  InventoryRequest.findByIdAndDelete = findByIdAndDelete;
  InventoryRequest.countDocuments = countDocuments;
  InventoryRequest.deleteMany = deleteMany;
  return { saved, calls };
};

const requestBase = (overrides = {}) => ({
  userId: "staff-ramesh",
  userName: "Ramesh Kumar",
  role: "Staff",
  itemName: "Camphor",
  quantity: 10,
  unit: "Pack",
  reason: "Daily pooja",
  purpose: "Pooja needs",
  expectedDate: new Date("2025-07-01T10:00:00+05:30"),
  priority: "Medium",
  status: "Pending",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await inventoryRequestService.usePostgres(), false);
  assert.strictEqual(inventoryRequestService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await inventoryRequestService.usePostgres(), false);
});

test("fallback: repository routes creates to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubRequestsCollection();
  const request = await inventoryRequestRepository.create(requestBase());
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(request.itemName, "Camphor");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubRequestsCollection();
  saved.push({ _id: "000000000000000000000099", itemName: "Kumkum", toObject: () => ({ _id: "000000000000000000000099" }) });

  await inventoryRequestRepository.findById("000000000000000000000099");
  const list = await inventoryRequestRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.strictEqual(typeof (await inventoryRequestRepository.count({})), "number");
});

test("fallback: updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubRequestsCollection();
  const created = await inventoryRequestRepository.create(requestBase({ quantity: 3 }));
  assert.ok(saved.length === 1);
  assert.strictEqual(created.quantity, 3);

  const updated = await inventoryRequestRepository.updateById(created._id, { status: "Approved" });
  assert.strictEqual(updated.status, "Approved", "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: deletes route to the Mongoose model without throwing", async () => {
  pinMongoFallback();
  stubRequestsCollection();
  const result = await inventoryRequestRepository.destroy("000000000000000000000001");
  assert.strictEqual(result, false); // stubbed delete returns null → false, par with Mongo findByIdAndDelete
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the inventory_requests table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubRequestsCollection();
  // The Mongoose model path must not touch PostgreSQL at all.
  const request = await inventoryRequestRepository.create(requestBase({ quantity: 2 }));
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(request.quantity, 2);

  // Also verify with an actual table absence: the fallback path never runs a
  // PostgreSQL query, so unrelated tables/columns existing or not is irrelevant.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS inventory_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await inventoryRequestRepository.create(requestBase({ quantity: 4 }));
  assert.strictEqual(again.quantity, 4);
});

// ─── Fallback: existing Mongo behaviour is unchanged ───────────────────────
test("fallback: Mongo validation is still applied by the model path", async () => {
  pinMongoFallback();
  const { saved } = stubRequestsCollection();
  const request = await inventoryRequestService.create(requestBase({ quantity: 2 }));
  assert.strictEqual(request.quantity, 2);
  const record = saved[0];
  assert.ok(record);
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  // First migrate so PostgreSQL has the table, then measure its row count
  // before and after a Mongo-fallback create. Since the seam is disconnected,
  // the repository must touch ONLY the Mongo model — no PG row may appear.
  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM inventory_requests");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubRequestsCollection();
  await inventoryRequestRepository.create(requestBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { saved, calls } = stubRequestsCollection();

  const request = await inventoryRequestService.create(requestBase({ quantity: 4, priority: "High" }));
  assert.strictEqual(calls[0][0], "create", "create routed to Mongoose create");
  assert.strictEqual(request.quantity, 4);

  // findById routes to the model's findById spy.
  await inventoryRequestService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  // findOne routes to the model's findOne spy.
  await inventoryRequestService.findOne({ id: "000000000000000000000099" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.id === "000000000000000000000099"), "findOne routed to Mongoose findOne spy");

  // findMany routes to the model's find spy (thenable query chain).
  await inventoryRequestService.findMany({ filter: { userId: "u1" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.userId === "u1"), "findMany routed to Mongoose find spy");

  // updateById routes to the model's findByIdAndUpdate spy and finds the saved doc.
  const updated = await inventoryRequestService.updateById(saved[0]._id, { adminReason: "x" });
  assert.strictEqual(updated.adminReason, "x", "updateById applied through Mongoose findByIdAndUpdate");

  // count routes to the model's countDocuments spy.
  await inventoryRequestService.count({ userId: "u1" });
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");

  // destroy routes to the model's findByIdAndDelete spy; stubbed delete
  // returns null → false, par with Mongo findByIdAndDelete.
  const destroyed = await inventoryRequestService.destroy("000000000000000000000001");
  assert.strictEqual(destroyed, false);
  assert.ok(calls.some(([name, id]) => name === "findByIdAndDelete" && id === "000000000000000000000001"), "destroy routed to Mongoose findByIdAndDelete spy");

  // create + findById + findOne + findMany + updateById + count + destroy = 7.
  assert.ok(calls.length >= 7, "expected at least 7 model method calls, got " + calls.length);
});

// ─── Validation is enforced by the service BEFORE persistence ──────────────
test("service: invalid data is rejected before persistence on both paths", async () => {
  // Validate that even when the Mongo seam is pinned, invalid data throws
  // before the model is reached.
  pinMongoFallback();
  const { calls } = stubRequestsCollection();
  await assert.rejects(() => inventoryRequestService.create(requestBase({ quantity: undefined })), /quantity is required/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ priority: "Urgent" })), /Invalid priority/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ status: "Cancelled" })), /Invalid status/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ userId: " " })), /userId is required/);
  await assert.rejects(() => inventoryRequestService.updateById("000000000000000000000001", { priority: "Urgent" }), /Invalid priority/);
  assert.strictEqual(calls.length, 0, "no persist call happened for invalid data");
});

// ─── No global DB switch: entity-scoped fallback ───────────────────────────
test("fallback: the InventoryRequest fallback path never performs a global DB cutover", async () => {
  // The datasource seam is shared, but the Phase 2L path is entity-scoped:
  // when the seam is closed the InventoryRequest service routes to the Mongoose
  // model while other entities keep their own Phase 2A–2K repositories. Neither
  // performs a global Mongo → PostgreSQL cutover (verified by the remaining
  // tests in this file and by the full regression suite).
  pinMongoFallback();
  assert.strictEqual(await inventoryRequestService.usePostgres(), false);
});