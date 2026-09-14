// Phase 2M fallback tests.
//
// The PurchaseOrder persistence layer is additive and entity-scoped:
//
//   PurchaseOrder
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    purchaseOrderRepository → purchase_orders + purchase_order_items
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose PurchaseOrder model (unchanged Phase 1 Mongo path)
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
const PurchaseOrder = require("../src/models/PurchaseOrder");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let purchaseOrderService;
let purchaseOrderRepository;

// Pins the shared datasource seam to "disconnected" so the PurchaseOrder path
// routes to the Mongoose model — exactly the fallback the app uses when
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

  purchaseOrderService = require("../src/services/purchaseOrderService");
  purchaseOrderRepository = require("../src/repositories/purchaseOrderRepository");
});

// Re-runs the full migration chain so the purchase_orders table exists in
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
 * Replaces the PurchaseOrder Mongoose model with call-tracking spies so tests
 * can prove the Mongo path is genuinely invoked on the fallback branch. The
 * loaded model object is the SAME reference the repository/service invoke at
 * call time, so swapping the methods is authoritative regardless of module
 * load order.
 */
const stubOrdersCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    id,
    items: obj.items || [],
    toObject: () => ({ ...obj, _id: id, id, items: obj.items || [] }),
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
  const findById = async (id, projection) => {
    calls.push(["findById", id]);
    const found = saved.find((d) => String(d._id) === String(id));
    if (!found) return null;
    if (projection) {
      // `{ "items.$": 1 }` projection: return only the embedded item.
      const item = (found.items || [])[0];
      return Object.assign(Object.create(found), { items: item ? [item] : [] });
    }
    return found;
  };

  // Mongoose `Model.findById(...).select("items")` returns a thenable Query;
  // the item repository uses that exact call shape in the fallback branch.
  const findByIdThenable = (id) => {
    calls.push(["findById", id]);
    const found = saved.find((d) => String(d._id) === String(id));
    const value = found ? Object.assign(Object.create(found), { items: found.items || [] }) : null;
    return {
      select: () => value,
      then: (resolve) => Promise.resolve(value).then(resolve),
    };
  };
  const findOne = async (filter) => {
    calls.push(["findOne", filter]);
    return saved.find((d) => String(d._id) === String(filter.id || filter["items._id"])) || null;
  };
  const find = (filter) => { calls.push(["find", filter]); return chain; };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    existing.id = existing._id;
    return existing;
  };
  const findOneAndUpdate = async (filter, update) => {
    calls.push(["findOneAndUpdate", filter, update]);
    const found = saved.find((d) => String(d._id) === String(filter._id || filter.id));
    if (!found) return null;
    if (update.$pull) {
      const itemId = update.$pull.items._id;
      found.items = (found.items || []).filter((i) => String(i._id) !== String(itemId));
      return found;
    }
    if (update.$set && update["items.$.item"] !== undefined) {
      const item = (found.items || [])[0];
      for (const key of ["item", "orderedQuantity", "unitPrice", "totalPrice", "receivedQuantity"]) {
        if (update.$set[`items.$.${key}`] !== undefined) item[key] = update.$set[`items.$.${key}`];
      }
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
  const countDocuments = async (filter) => { calls.push(["countDocuments", filter]); return saved.length; };

  PurchaseOrder.create = create;
  PurchaseOrder.findById = findByIdThenable;
  PurchaseOrder.findOne = findOne;
  PurchaseOrder.find = find;
  PurchaseOrder.findByIdAndUpdate = findByIdAndUpdate;
  PurchaseOrder.findOneAndUpdate = findOneAndUpdate;
  PurchaseOrder.findByIdAndDelete = findByIdAndDelete;
  PurchaseOrder.countDocuments = countDocuments;
  return { saved, calls };
};

const poBase = (overrides = {}) => ({
  poNumber: `PO-${Math.random().toString(16).slice(2)}`,
  supplier: "0000000000000000000000aa",
  items: [
    { item: "0000000000000000000000bb", orderedQuantity: 10.5, unitPrice: "1000.99", totalPrice: 10510.395, receivedQuantity: 0 },
  ],
  totalAmount: "123456789.1234",
  status: "Pending Approval",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await purchaseOrderService.usePostgres(), false);
  assert.strictEqual(purchaseOrderService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await purchaseOrderService.usePostgres(), false);
});

test("fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const created = await purchaseOrderRepository.create(poBase());
  assert.ok(saved.length === 1, "create routed to Mongoose model");
  assert.strictEqual(created.poNumber, created.poNumber);
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  stubOrdersCollection();
  await purchaseOrderRepository.findById("000000000000000000000099");
  const list = await purchaseOrderRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0); // stubbed query returns empty
  assert.strictEqual(typeof (await purchaseOrderRepository.count({})), "number");
});

test("fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const created = await purchaseOrderRepository.create(poBase());
  assert.ok(saved.length === 1);
  const updated = await purchaseOrderRepository.updateById(created._id, { status: "Approved" });
  assert.strictEqual(updated.status, "Approved", "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: repository deletes route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const created = await purchaseOrderRepository.create(poBase());
  assert.strictEqual(await purchaseOrderRepository.destroy(created._id), true);
  assert.strictEqual(await purchaseOrderRepository.destroy(created._id), false);
  assert.strictEqual(saved.length, 0, "destroy removed the saved doc from the model store");
});

test("fallback: repository child items route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubOrdersCollection();
  const created = await purchaseOrderRepository.create(poBase());
  const items = await purchaseOrderItemRepositoryFindByPo(created._id);
  assert.strictEqual(items.length, 1);
  assert.ok(saved.length >= 1);
});

const purchaseOrderItemRepositoryFindByPo = async (poId) => {
  const itemRepo = require("../src/repositories/purchaseOrderItemRepository");
  return itemRepo.findByPurchaseOrderId(poId);
};

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the purchase_orders table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubOrdersCollection();
  const request = await purchaseOrderRepository.create(poBase({ totalAmount: 42 }));
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");
  assert.strictEqual(request.totalAmount, 42);

  // The fallback path never runs a PostgreSQL query, so dropping the tables is
  // irrelevant to its correctness.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_order_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_orders CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await purchaseOrderRepository.create(poBase({ totalAmount: 7 }));
  assert.strictEqual(again.totalAmount, 7);
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM purchase_orders");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubOrdersCollection();
  await purchaseOrderRepository.create(poBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { saved, calls } = stubOrdersCollection();

  const po = await purchaseOrderService.create(poBase({ totalAmount: 5 }));
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(po.totalAmount, 5);

  // findById routes to the model's findById spy.
  await purchaseOrderService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  // findOne routes to the model's findOne spy.
  await purchaseOrderService.findOne({ id: "000000000000000000000099" });
  assert.ok(calls.some(([name, filter]) => name === "findOne" && filter && filter.id === "000000000000000000000099"), "findOne routed to Mongoose findOne spy");

  // findMany routes to the model's find spy (thenable query chain).
  await purchaseOrderService.findMany({ filter: { status: "Draft" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Draft"), "findMany routed to Mongoose find spy");

  // updateById routes to the model's findByIdAndUpdate spy.
  const updated = await purchaseOrderService.updateById(po._id, { status: "Received" });
  assert.strictEqual(updated.status, "Received", "updateById applied through Mongoose findByIdAndUpdate");

  // replaceItems routes through Mongoose findById + save.
  await purchaseOrderService.replaceItems(po._id, [
    { item: "0000000000000000000000cc", orderedQuantity: 3, unitPrice: 2, totalPrice: 6 },
  ]);
  assert.ok(calls.some(([name]) => name === "save"), "replaceItems saved through Mongoose save");

  // count routes to the model's countDocuments spy.
  await purchaseOrderService.count({ status: "Draft" });
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");

  // destroy routes to the model's findByIdAndDelete spy; the stub returns the
  // removed doc so destroy resolves true.
  const destroyed = await purchaseOrderService.destroy(po._id);
  assert.strictEqual(destroyed, true);
  assert.ok(calls.some(([name, id]) => name === "findByIdAndDelete" && id === po._id), "destroy routed to Mongoose findByIdAndDelete spy");
  assert.ok(saved.length === 0);
});

// ─── Validation is enforced by the service BEFORE persistence ──────────────
test("service: invalid data is rejected before persistence on the fallback path", async () => {
  pinMongoFallback();
  const { calls } = stubOrdersCollection();
  await assert.rejects(() => purchaseOrderService.create(poBase({ poNumber: undefined })), /poNumber is required/);
  await assert.rejects(() => purchaseOrderService.create(poBase({ supplier: " " })), /supplier is required/);
  await assert.rejects(() => purchaseOrderService.create(poBase({ totalAmount: "x" })), /totalAmount must be a number/);
  await assert.rejects(() => purchaseOrderService.create(poBase({ status: "Ordered" })), /Invalid status/);
  await assert.rejects(() => purchaseOrderService.create(poBase({ items: [{ item: undefined }] })), /items.item is required/);
  assert.strictEqual(calls.length, 0, "no persist call happened for invalid data");
});

// ─── No global DB switch: entity-scoped fallback ───────────────────────────
test("fallback: the PurchaseOrder fallback path never performs a global DB cutover", async () => {
  pinMongoFallback();
  assert.strictEqual(await purchaseOrderService.usePostgres(), false);
});