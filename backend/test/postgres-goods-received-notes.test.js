// Phase 2N PostgreSQL-path tests for the Goods Received Note service.
//
// These tests run with the datasource seam connected so the service must
// select the PostgreSQL repository. They verify that the service:
//   - actually persists to and reads from the goods_received_notes /
//     goods_received_note_items tables,
//   - preserves the Mongo service semantics (validation, defaults, status
//     enum, embedded receivedItems),
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
let goodsReceivedNoteRepository;
let goodsReceivedNoteService;
let inventoryItemRepository;
let purchaseOrderRepository;

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
  goodsReceivedNoteRepository = require("../src/repositories/goodsReceivedNoteRepository");
  goodsReceivedNoteService = require("../src/services/goodsReceivedNoteService");
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
  purchaseOrderRepository = require("../src/repositories/purchaseOrderRepository");
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

// Creates a real inventory_items row so the goods_received_note_items FK is
// satisfied. Returns the item document.
const createInventoryItem = async () => {
  const item = await inventoryItemRepository.create({
    name: `GRN-ITEM-${unique()}`,
    unit: "Pack",
  });
  assert.ok(item?._id, "inventory item must exist (PG path)");
  return item;
};

const grnBase = (itemId, overrides = {}) => ({
  grnNumber: `GRN-${unique()}`,
  supplier: "0000000000000000000000aa",
  receivedItems: [
    { item: itemId, poQuantity: 10.5, receivedQuantity: 10.5, acceptedQuantity: 10, rejectedQuantity: 0.5, unitPrice: "1000.99", batchNumber: "B-1", expiryDate: new Date("2027-02-01T00:00:00Z"), remarks: "line 1" },
    { item: itemId, poQuantity: 2, receivedQuantity: 2, acceptedQuantity: 2, rejectedQuantity: 0, unitPrice: "0.01" },
  ],
  totalAmount: "123456789.1234",
  status: "Pending Approval",
  supplierInvoiceNumber: "INV-1001",
  supplierInvoiceDate: new Date("2026-02-01T10:00:00Z"),
  receivedBy: "0000000000000000000000dd",
  notes: "PG path service GRN",
  ...overrides,
});

test("PG path: service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(await goodsReceivedNoteService.usePostgres(), true);
  assert.strictEqual(goodsReceivedNoteService.isConnected(), true);
});

test("PG path: service create persists a real goods_received_notes + goods_received_note_items row pair", async () => {
  const item = await createInventoryItem();
  const created = await goodsReceivedNoteService.create(grnBase(item._id));
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.grnNumber, created.grnNumber);
  assert.strictEqual(created.supplier, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
  assert.strictEqual(created.totalAmount, 123456789.1234);
  assert.strictEqual(created.supplierInvoiceNumber, "INV-1001");
  assert.strictEqual(created.supplierInvoiceDate instanceof Date, true);
  assert.strictEqual(created.receivedBy, "0000000000000000000000dd");
  assert.strictEqual(created.notes, "PG path service GRN");
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.createdAt instanceof Date, true);
  assert.strictEqual(created.updatedAt instanceof Date, true);
  assert.strictEqual(created.receivedItems.length, 2);
  assert.strictEqual(created.receivedItems[0].item, item._id);
  assert.strictEqual(created.receivedItems[0].receivedQuantity, 10.5);
  assert.strictEqual(created.receivedItems[0].batchNumber, "B-1");
  assert.strictEqual(created.receivedItems[0].expiryDate instanceof Date, true);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM goods_received_notes WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "goods_received_notes row must exist");
    const { rows: itemRows } = await pool.query(
      "SELECT id FROM goods_received_note_items WHERE grn_id = $1",
      [created._id]
    );
    assert.strictEqual(itemRows.length, 2, "goods_received_note_items rows must exist");
  } finally {
    await pool.end();
  }

  // Cleanup the inventory item (its referencing GRNs must be removed first).
  await goodsReceivedNoteService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service preserves status enum, defaults and validation", async () => {
  const item = await createInventoryItem();
  const draft = await goodsReceivedNoteService.create({
    supplier: "0000000000000000000000aa",
    totalAmount: 120.5,
    receivedItems: [{ item: item._id, receivedQuantity: 2, acceptedQuantity: 2, unitPrice: "1.25" }],
  });
  assert.match(draft.grnNumber, /^GRN-\d{5}$/, "grnNumber auto-derived in GRN-00000 format");
  assert.strictEqual(draft.status, "Draft", "status default is Draft");
  assert.strictEqual(draft.receivedItems[0].poQuantity, 0, "poQuantity defaults to 0");
  assert.strictEqual(draft.receivedItems[0].rejectedQuantity, 0, "rejectedQuantity defaults to 0");
  assert.strictEqual(draft.supplierInvoiceNumber, undefined);
  assert.strictEqual(draft.receivedBy, undefined);
  assert.strictEqual(draft.approvedBy, undefined);
  assert.strictEqual(draft.notes, undefined);

  await assert.rejects(() => goodsReceivedNoteService.create({
    supplier: "0000000000000000000000aa", totalAmount: 1, status: "Ordered",
  }), /Invalid status/);
  await assert.rejects(() => goodsReceivedNoteService.create({
    supplier: "s", totalAmount: 1, receivedItems: [{ item: "x", receivedQuantity: "abc", acceptedQuantity: 1, unitPrice: 1 }],
  }), /receivedItems\.receivedQuantity must be a number/);
  await assert.rejects(() => goodsReceivedNoteService.create({
    supplier: "s", totalAmount: -1,
  }), /totalAmount must be >= 0/);
  await assert.rejects(() => goodsReceivedNoteService.create({
    supplier: undefined, totalAmount: 1,
  }), /supplier is required/);
  await assert.rejects(() => goodsReceivedNoteService.create({
    supplier: "s", totalAmount: 1,
    receivedItems: [{ item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: -1 }],
  }), /receivedItems\.unitPrice must be >= 0/);

  await goodsReceivedNoteService.destroy(draft._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service findById/findOne/findMany/count round-trip real rows", async () => {
  const item = await createInventoryItem();
  const created = await goodsReceivedNoteService.create(grnBase(item._id, {
    status: "Approved",
    supplierInvoiceDate: new Date("2026-06-01T00:00:00Z"),
  }));

  const byId = await goodsReceivedNoteService.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.status, "Approved");
  assert.strictEqual(byId.receivedItems.length, 2, "embedded receivedItems loaded");

  const byNum = await goodsReceivedNoteService.findOne({ grnNumber: created.grnNumber });
  assert.strictEqual(byNum._id, created._id);

  const list = await goodsReceivedNoteService.findMany({ filter: { status: "Approved" } });
  assert.ok(list.some((g) => g._id === created._id));

  const inList = await goodsReceivedNoteService.findMany({ filter: { status: { $in: ["Approved", "Draft"] } } });
  assert.ok(inList.some((g) => g._id === created._id));

  assert.ok((await goodsReceivedNoteService.count({ status: "Approved" })) >= 1);

  await goodsReceivedNoteService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: service updateById flips status and preserves the embedded items", async () => {
  const item = await createInventoryItem();
  const created = await goodsReceivedNoteService.create(grnBase(item._id));
  const updated = await goodsReceivedNoteService.updateById(created._id, {
    status: "Approved",
    approvedBy: "0000000000000000000000ee",
  });
  assert.strictEqual(updated.status, "Approved");
  assert.strictEqual(updated.approvedBy, "0000000000000000000000ee");
  assert.strictEqual(updated.receivedItems.length, 2, "scalar update keeps embedded items");

  await goodsReceivedNoteService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: precision is exact through NUMERIC (money and decimal quantities)", async () => {
  const item = await createInventoryItem();
  const cases = [
    { qty: "10.50", price: "0.01", total: "123456789.1234" },
    { qty: "0.01", price: "1000000.99", total: "10.50" },
    { qty: "1000.99", price: "123456789.1234", total: "0.01" },
    { qty: "1000000.99", price: "10.50", total: "1000000.99" },
  ];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const created = [];
  try {
    for (const c of cases) {
      const grn = await goodsReceivedNoteService.create(grnBase(item._id, {
        totalAmount: c.total,
        receivedItems: [{ item: item._id, receivedQuantity: c.qty, acceptedQuantity: c.qty, unitPrice: c.price }],
      }));
      created.push(grn);
      const { rows } = await pool.query(
        "SELECT total_amount::text AS t FROM goods_received_notes WHERE id = $1",
        [grn._id]
      );
      assert.strictEqual(rows[0].t, c.total, `total ${c.total} round-trips exactly`);
      const { rows: ir } = await pool.query(
        "SELECT received_quantity::text AS r, unit_price::text AS u FROM goods_received_note_items WHERE grn_id = $1",
        [grn._id]
      );
      assert.strictEqual(ir[0].r, c.qty, `quantity ${c.qty} round-trips exactly`);
      assert.strictEqual(ir[0].u, c.price, `unitPrice ${c.price} round-trips exactly`);
    }
  } finally {
    await pool.end();
  }
  for (const grn of created) await goodsReceivedNoteService.destroy(grn._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: purchase-order relationship — GRN references a real purchase_orders row", async () => {
  const item = await createInventoryItem();
  const po = await purchaseOrderRepository.create({
    poNumber: `PO-${unique()}`,
    supplier: "0000000000000000000000aa",
    items: [{ item: item._id, orderedQuantity: 10, unitPrice: "10.00", totalPrice: 100 }],
    totalAmount: 100,
  });
  assert.ok(po?._id, "purchase order must exist");
  const grn = await goodsReceivedNoteService.create(grnBase(item._id, { purchaseOrder: po._id }));
  assert.strictEqual(grn.purchaseOrder, po._id);

  const byPo = await goodsReceivedNoteService.findMany({ filter: { purchaseOrder: po._id } });
  assert.ok(byPo.some((g) => g._id === grn._id));

  // ON DELETE RESTRICT: deleting the referenced PO must be refused.
  await assert.rejects(() => purchaseOrderRepository.destroy(po._id), /purchase_orders/);

  await goodsReceivedNoteService.destroy(grn._id);
  await purchaseOrderRepository.destroy(po._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: no dual write — the Mongo model is never touched while PostgreSQL persists", async () => {
  const item = await createInventoryItem();
  const GoodsReceivedNote = require("../src/models/GoodsReceivedNote");

  // Spy on the Mongoose model. If the service did ANY dual write, at least one
  // model method would fire. The PG path must complete without a single call.
  const calls = [];
  const saved = {};
  for (const method of ["create", "findById", "findOne", "find", "findByIdAndUpdate", "findByIdAndDelete", "countDocuments", "findOneAndUpdate"]) {
    saved[method] = GoodsReceivedNote[method];
    GoodsReceivedNote[method] = (...args) => { calls.push([method, args]); return Promise.resolve(null); };
  }
  try {
    const created = await goodsReceivedNoteService.create(grnBase(item._id));
    assert.ok(created._id, "PG create returned a Mongo-shaped doc");
    await goodsReceivedNoteService.findById(created._id);
    await goodsReceivedNoteService.findOne({ grnNumber: created.grnNumber });
    await goodsReceivedNoteService.findMany({ filter: { status: "Approved" } });
    await goodsReceivedNoteService.count({});
    await goodsReceivedNoteService.updateById(created._id, { status: "Approved" });
    await goodsReceivedNoteService.destroy(created._id);
    assert.strictEqual(calls.length, 0, "the Mongoose model must not be called on the PG path");
  } finally {
    Object.assign(GoodsReceivedNote, saved);
    await inventoryItemRepository.destroy(item._id).catch(() => {});
  }
});

test("PG path: atomic create — invalid child item rolls back the whole note", async () => {
  const item = await createInventoryItem();
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_notes")).rows[0].n;
    await assert.rejects(
      () => goodsReceivedNoteService.create(grnBase(item._id, { receivedItems: [
        { item: item._id, receivedQuantity: 5, acceptedQuantity: 5, unitPrice: 1 },
        { item: item._id, receivedQuantity: 2, acceptedQuantity: 2, rejectedQuantity: -1, unitPrice: 1 },
      ] })),
      /receivedItems\.rejectedQuantity/
    );
    const after = (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_notes")).rows[0].n;
    assert.strictEqual(after, before, "no partial goods_received_notes row after failed create");
    const itemRowsAfter = (await pool.query("SELECT COUNT(*)::int AS n FROM goods_received_note_items")).rows[0].n;
    assert.strictEqual(itemRowsAfter, 0, "no goods_received_note_items rows after failed create");
  } finally {
    await pool.end();
  }
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: atomic item replacement — a failing replacement keeps the original embedded items", async () => {
  const item = await createInventoryItem();
  const created = await goodsReceivedNoteService.create(grnBase(item._id));
  const beforeItems = created.receivedItems.length;
  assert.ok(beforeItems >= 2);

  await assert.rejects(
    () => goodsReceivedNoteService.replaceItems(created._id, [
      { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 },
      { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: -1, unitPrice: 1 },
    ]),
    /receivedItems\.rejectedQuantity/
  );
  const after = await goodsReceivedNoteService.findById(created._id);
  assert.strictEqual(after.receivedItems.length, beforeItems, "original embedded items survive a failed replacement");

  // A valid replacement succeeds and replaces the whole embedded array.
  await goodsReceivedNoteService.replaceItems(created._id, [
    { item: item._id, receivedQuantity: 7, acceptedQuantity: 7, unitPrice: "2.50", rejectedQuantity: 0.5 },
  ]);
  const replaced = await goodsReceivedNoteService.findById(created._id);
  assert.strictEqual(replaced.receivedItems.length, 1);
  assert.strictEqual(replaced.receivedItems[0].receivedQuantity, 7);
  assert.strictEqual(replaced.receivedItems[0].rejectedQuantity, 0.5);

  await goodsReceivedNoteService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});

test("PG path: child items preserve embedded array order and are re-read in order", async () => {
  const item = await createInventoryItem();
  const created = await goodsReceivedNoteService.create(grnBase(item._id, {
    receivedItems: [
      { item: item._id, receivedQuantity: 3, acceptedQuantity: 3, unitPrice: 1 },
      { item: item._id, receivedQuantity: 1, acceptedQuantity: 1, unitPrice: 1 },
      { item: item._id, receivedQuantity: 2, acceptedQuantity: 2, unitPrice: 1 },
    ],
  }));
  const read = await goodsReceivedNoteService.findById(created._id);
  assert.deepStrictEqual(read.receivedItems.map((i) => i.receivedQuantity), [3, 1, 2]);

  await goodsReceivedNoteService.destroy(created._id);
  await inventoryItemRepository.destroy(item._id);
});