// Phase 2M PostgreSQL-path tests for the Purchase Order service.
//
// These tests run with the datasource seam connected so the service must
// select the PostgreSQL repository. They verify that the service:
//   - actually persists to and reads from the purchase_orders /
//     purchase_order_items tables,
//   - preserves the Mongo service semantics (validation, defaults, status
//     enum, embedded items),
//   - never writes to MongoDB while PostgreSQL is selected (no dual writes).
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let purchaseOrderRepository;
let purchaseOrderService;
let inventoryItemRepository;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
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
  purchaseOrderRepository = require("../src/repositories/purchaseOrderRepository");
  purchaseOrderService = require("../src/services/purchaseOrderService");
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
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

// Creates a real inventory_items row so the purchase_order_items FK is
// satisfied. Returns the item document.
const createInventoryItem = async () => {
  const item = await inventoryItemRepository.create({
    name: `PO-PG-${unique()}`,
    unit: "Pack",
  });
  assert.ok(item?._id, "inventory item must exist (PG path)");
  return item;
};

const poBase = (itemId, overrides = {}) => ({
  poNumber: `PO-${unique()}`,
  supplier: "0000000000000000000000aa",
  items: [
    { item: itemId, orderedQuantity: 10.5, unitPrice: "1000.99", totalPrice: 10510.395, receivedQuantity: 0 },
    { item: itemId, orderedQuantity: 2, unitPrice: "0.01", totalPrice: 0.02, receivedQuantity: 0 },
  ],
  totalAmount: "123456789.1234",
  status: "Pending Approval",
  expectedDeliveryDate: new Date("2026-01-15T10:00:00Z"),
  notes: "PG path service PO",
  createdBy: "0000000000000000000000dd",
  ...overrides,
});

test("PG path: service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(await purchaseOrderService.usePostgres(), true);
  assert.strictEqual(purchaseOrderService.isConnected(), true);
});

test("PG path: service create persists a real purchase_orders + purchase_order_items row pair", async () => {
  const item = await createInventoryItem();
  const created = await purchaseOrderService.create(poBase(item._id));
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.poNumber, created.poNumber);
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
  assert.strictEqual(created.totalAmount, 123456789.1234);
  assert.strictEqual(created.expectedDeliveryDate instanceof Date, true);
  assert.strictEqual(created.notes, "PG path service PO");
  assert.strictEqual(created.createdAt instanceof Date, true);
  assert.strictEqual(created.updatedAt instanceof Date, true);
  assert.strictEqual(created.items.length, 2);
  assert.strictEqual(created.items[0].item, item._id);
  assert.strictEqual(created.items[0].orderedQuantity, 10.5);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM purchase_orders WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "purchase_orders row must exist");
    const { rows: itemRows } = await pool.query(
      "SELECT id FROM purchase_order_items WHERE purchase_order_id = $1",
      [created._id]
    );
    assert.strictEqual(itemRows.length, 2, "purchase_order_items rows must exist");
  } finally {
    await pool.end();
  }

  // Cleanup the inventory item (its referencing POs must be removed first).
  await purchaseOrderService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service preserves status enum, defaults and validation", async () => {
  const item = await createInventoryItem();
  const draft = await purchaseOrderService.create({
    poNumber: `PO-${unique()}`,
    supplier: "0000000000000000000000aa",
    totalAmount: 120.5,
    items: [{ item: item._id, orderedQuantity: 2, unitPrice: "1.25", totalPrice: 2.5 }],
  });
  assert.strictEqual(draft.status, "Draft", "status default is Draft");
  assert.strictEqual(draft.items[0].receivedQuantity, 0, "receivedQuantity defaults to 0");
  assert.strictEqual(draft.expectedDeliveryDate, undefined);
  assert.strictEqual(draft.notes, undefined);
  assert.strictEqual(draft.approvedBy, undefined);

  await assert.rejects(() => purchaseOrderService.create({
    poNumber: `PO-${unique()}`, supplier: "s", totalAmount: 1, status: "Ordered",
  }), /Invalid status/);
  await assert.rejects(() => purchaseOrderService.create({
    poNumber: undefined, supplier: "s", totalAmount: 1,
  }), /poNumber is required/);
  await assert.rejects(() => purchaseOrderService.create({
    poNumber: `PO-${unique()}`, supplier: "s", totalAmount: -1,
  }), /totalAmount must be >= 0/);
  await assert.rejects(() => purchaseOrderService.create({
    poNumber: `PO-${unique()}`, supplier: "s", totalAmount: 1,
    items: [{ item: item._id, orderedQuantity: 0, unitPrice: 1, totalPrice: 0 }],
  }), /items\.orderedQuantity/);

  await purchaseOrderService.destroy(draft._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service findById/findOne/findMany/count round-trip real rows", async () => {
  const item = await createInventoryItem();
  const created = await purchaseOrderService.create(poBase(item._id, {
    poNumber: `PO-${unique()}`,
    status: "Approved",
    expectedDeliveryDate: new Date("2026-06-01T00:00:00Z"),
  }));

  const byId = await purchaseOrderService.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.status, "Approved");

  const one = await purchaseOrderService.findOne({ poNumber: created.poNumber });
  assert.strictEqual(one._id, created._id);

  const many = await purchaseOrderService.findMany({ filter: { status: "Approved" } });
  assert.ok(many.some((p) => p._id === created._id));

  const oneCount = await purchaseOrderService.count({ status: "Approved" });
  assert.ok(oneCount >= 1);
  const filteredCount = await purchaseOrderService.count({ status: "Approved", supplier: created.supplier });
  assert.ok(filteredCount >= 1);

  await purchaseOrderService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service updateById flips status exactly like the createGRN integration", async () => {
  const item = await createInventoryItem();
  const created = await purchaseOrderService.create(poBase(item._id));
  const updated = await purchaseOrderService.updateById(created._id, { status: "Partially Received" });
  assert.strictEqual(updated.status, "Partially Received");
  const read = await purchaseOrderService.findById(created._id);
  assert.strictEqual(read.status, "Partially Received");

  await purchaseOrderService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service replaceItems atomically replaces the embedded items", async () => {
  const item = await createInventoryItem();
  const created = await purchaseOrderService.create(poBase(item._id));
  assert.strictEqual(created.items.length, 2);

  await purchaseOrderService.replaceItems(created._id, [
    { item: item._id, orderedQuantity: 5, unitPrice: "3.50", totalPrice: 17.5 },
  ]);
  const replaced = await purchaseOrderService.findById(created._id);
  assert.strictEqual(replaced.items.length, 1);
  assert.strictEqual(replaced.items[0].orderedQuantity, 5);

  // A failing replacement (invalid quantity) must not change the persisted set.
  await assert.rejects(
    () => purchaseOrderService.replaceItems(created._id, [
      { item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 },
      { item: item._id, orderedQuantity: 0, unitPrice: 1, totalPrice: 0 },
    ]),
    /items\.orderedQuantity/
  );
  const unchanged = await purchaseOrderService.findById(created._id);
  assert.strictEqual(unchanged.items.length, 1, "failed replacement leaves original items");

  await purchaseOrderService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: no dual write — the Mongo model is never touched while PostgreSQL persists", async () => {
  const item = await createInventoryItem();
  const PurchaseOrder = require("../src/models/PurchaseOrder");

  // Spy on the Mongoose model. If the service did ANY dual write, at least one
  // model method would fire. The PG path must complete without a single call.
  const calls = [];
  const saved = {};
  for (const method of ["create", "findById", "findOne", "find", "findByIdAndUpdate", "findByIdAndDelete", "countDocuments", "findOneAndUpdate"]) {
    saved[method] = PurchaseOrder[method];
    PurchaseOrder[method] = (...args) => { calls.push([method, args]); return Promise.resolve(null); };
  }
  try {
    const created = await purchaseOrderService.create(poBase(item._id));
    assert.ok(created._id, "PG create returned a Mongo-shaped doc");
    await purchaseOrderService.findById(created._id);
    await purchaseOrderService.findOne({ poNumber: created.poNumber });
    await purchaseOrderService.findMany({ filter: { status: "Approved" } });
    await purchaseOrderService.count({});
    await purchaseOrderService.updateById(created._id, { status: "Received" });
    await purchaseOrderService.destroy(created._id);
    assert.strictEqual(calls.length, 0, "the Mongoose model must not be called on the PG path");
  } finally {
    Object.assign(PurchaseOrder, saved);
    await inventoryItemRepository.destroy(item._id).catch(() => {});
  }
});

test("PG path: atomic create — invalid child item rolls back the whole order", async () => {
  const item = await createInventoryItem();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM purchase_orders")).rows[0].n;
    await assert.rejects(
      () => purchaseOrderService.create(poBase(item._id, { items: [
        { item: item._id, orderedQuantity: 1, unitPrice: 1, totalPrice: 1 },
        { item: item._id, orderedQuantity: 0, unitPrice: 1, totalPrice: 0 },
      ] })),
      /items\.orderedQuantity/
    );
    const after = (await pool.query("SELECT COUNT(*)::int AS n FROM purchase_orders")).rows[0].n;
    assert.strictEqual(after, before, "no partial purchase_orders row after failed create");
  } finally {
    await pool.end();
  }
  await inventoryItemRepository.destroy(item._id);
});