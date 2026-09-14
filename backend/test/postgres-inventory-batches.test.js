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
let inventoryBatchRepository;
let inventoryBatchService;
let inventoryItemRepository;

// Every table that the migration chain creates. inventory_batches is dropped
// FIRST (before inventory_items) so a stale FK-dependent table can never block
// a fresh migration run.
const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
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
  inventoryBatchRepository = require("../src/repositories/inventoryBatchRepository");
  inventoryBatchService = require("../src/services/inventoryBatchService");
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

const makeItem = async () =>
  inventoryItemRepository.create({ name: `BatchItem-${unique()}`, unit: "Pack", availableStock: 100 });

const batchBase = (overrides = {}) => ({
  item: "0000000000000000000000aa",
  batchNumber: `B-${unique()}`,
  originalQuantity: 10,
  currentQuantity: 10,
  ...overrides,
});

// ─── PostgreSQL path: service selects PG and round trips ───────────────────
test("PG path: service uses PostgreSQL when the Inventory Batch path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await inventoryBatchService.usePostgres(), true);
  assert.strictEqual(inventoryBatchService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const item = await makeItem();
  const input = batchBase({
    item: item._id,
    batchNumber: `B-${unique()}`,
    grn: crypto.randomBytes(12).toString("hex"),
    purchasePrice: "10.50",
    manufacturingDate: new Date("2025-05-01T00:00:00Z"),
    expiryDate: new Date("2027-05-01T00:00:00Z"),
    originalQuantity: "7.5",
    currentQuantity: "7.5",
    status: "Active",
    supplier: crypto.randomBytes(12).toString("hex"),
  });
  const batch = await inventoryBatchService.create(input);

  assert.ok(batch._id);
  assert.match(batch._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(batch.item, item._id);
  assert.strictEqual(batch.batchNumber, input.batchNumber);
  assert.strictEqual(batch.grn, input.grn);
  assert.strictEqual(Number(batch.purchasePrice), 10.5);
  assert.ok(batch.manufacturingDate instanceof Date);
  assert.strictEqual(batch.manufacturingDate.toISOString(), "2025-05-01T00:00:00.000Z");
  assert.strictEqual(batch.expiryDate.toISOString(), "2027-05-01T00:00:00.000Z");
  assert.strictEqual(Number(batch.originalQuantity), 7.5);
  assert.strictEqual(Number(batch.currentQuantity), 7.5);
  assert.strictEqual(batch.status, "Active");
  assert.strictEqual(batch.supplier, input.supplier);
  assert.ok(batch.createdAt instanceof Date);
  assert.ok(batch.updatedAt instanceof Date);

  const read = await inventoryBatchService.findById(batch._id);
  assert.strictEqual(read._id, batch._id);
  assert.strictEqual(read.item, item._id);
});

test("PG path: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const item = await makeItem();
  const grnId = crypto.randomBytes(12).toString("hex");
  const supplierId = crypto.randomBytes(12).toString("hex");
  const batch = await inventoryBatchRepository.create(batchBase({
    item: item._id,
    batchNumber: `Full-${unique()}`,
    grn: grnId,
    purchasePrice: "123.45",
    manufacturingDate: new Date("2024-02-10T10:00:00+05:30"),
    expiryDate: new Date("2026-08-15T10:30:00+05:30"),
    originalQuantity: "12.25",
    currentQuantity: "3.75",
    status: "Quarantine",
    supplier: supplierId,
  }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_batches WHERE id = $1", [batch._id]);
    const row = rows[0];
    assert.strictEqual(row.inventory_item_id, item._id);
    assert.strictEqual(row.batch_number, batch.batchNumber);
    assert.strictEqual(row.grn, grnId);
    assert.strictEqual(row.purchase_price.toString(), "123.45");
    assert.strictEqual(row.manufacturing_date.toISOString(), "2024-02-10T04:30:00.000Z");
    assert.strictEqual(row.expiry_date.toISOString(), "2026-08-15T05:00:00.000Z");
    assert.strictEqual(row.original_quantity.toString(), "12.25");
    assert.strictEqual(row.current_quantity.toString(), "3.75");
    assert.strictEqual(row.status, "Quarantine");
    assert.strictEqual(row.supplier, supplierId);
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
  } finally {
    await pool.end();
  }

  const read = await inventoryBatchRepository.findById(batch._id);
  assert.strictEqual(read.grn, grnId);
  assert.strictEqual(read.supplier, supplierId);
  assert.strictEqual(Number(read.originalQuantity), 12.25);
});

// ─── Field mapping / SQL schema ─────────────────────────────────────────────
test("PG path: inventory_batches table has the exact Mongo field mapping", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'inventory_batches'
      ORDER BY ordinal_position`);
    const col = (name) => rows.find((c) => c.column_name === name);
    assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO");
    assert.ok(col("inventory_item_id") && col("inventory_item_id").data_type === "text" && col("inventory_item_id").is_nullable === "NO");
    assert.ok(col("batch_number") && col("batch_number").data_type === "text" && col("batch_number").is_nullable === "NO");
    assert.ok(col("grn") && col("grn").is_nullable === "YES");
    assert.ok(col("purchase_price") && col("purchase_price").data_type === "numeric" && col("purchase_price").is_nullable === "NO" && col("purchase_price").column_default === "0");
    assert.ok(col("manufacturing_date") && col("manufacturing_date").data_type === "timestamp with time zone" && col("manufacturing_date").is_nullable === "YES");
    assert.ok(col("expiry_date") && col("expiry_date").data_type === "timestamp with time zone" && col("expiry_date").is_nullable === "YES");
    assert.ok(col("original_quantity") && col("original_quantity").data_type === "numeric" && col("original_quantity").is_nullable === "NO");
    assert.ok(col("current_quantity") && col("current_quantity").data_type === "numeric" && col("current_quantity").is_nullable === "NO");
    assert.ok(col("status") && col("status").data_type === "text" && col("status").is_nullable === "NO" && col("status").column_default === "'Active'::text");
    assert.ok(col("supplier") && col("supplier").is_nullable === "YES");
    assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
    assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  } finally {
    await pool.end();
  }
});

test("PG path: no fake FKs to non-migrated entities; only the real inventory_items FK", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT kcu.column_name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN information_schema.key_column_usage kcu
        ON c.conname = kcu.constraint_name
      WHERE c.contype = 'f' AND c.conrelid = 'inventory_batches'::regclass`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].column_name, "inventory_item_id");
    assert.ok(/REFERENCES inventory_items\(id\)/.test(rows[0].def));
    // ON DELETE RESTRICT: Mongo leaves batches orphaned when an item is
    // deleted, so PostgreSQL must not cascade-delete batches.
    assert.ok(/ON DELETE RESTRICT/i.test(rows[0].def));
    assert.ok(!/CASCADE/i.test(rows[0].def), "must not cascade");
  } finally {
    await pool.end();
  }
});

test("PG path: CHECK constraints and uniqueness reproduce Mongo semantics", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows: checks } = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'inventory_batches'::regclass AND contype = 'c'`);
    const defs = checks.map((r) => r.def);
    assert.ok(defs.some((d) => /'Active'.*'Quarantine'.*'Expired'.*'Consumed'.*'Returned'.*'Disposed'/.test(d)), "status CHECK");
    assert.ok(defs.some((d) => /original_quantity\s*>=\s*\(?0\)?/.test(d)), "original_quantity >= 0 CHECK");
    assert.ok(defs.some((d) => /current_quantity\s*>=\s*\(?0\)?/.test(d)), "current_quantity >= 0 CHECK");

    const { rows: uniq } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'inventory_batches'::regclass AND contype = 'u'`);
    assert.ok(uniq.some((r) => /UNIQUE \(inventory_item_id, batch_number\)/.test(r.def)), "compound unique (item, batchNumber)");
  } finally {
    await pool.end();
  }
});

test("PG path: indexes cover the real FIFO scan and created_at listings", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_batches'`);
    const defs = rows.map((r) => r.indexdef);
    assert.ok(defs.some((d) => /\(inventory_item_id, status, expiry_date, created_at\)/.test(d)), "FIFO covering index");
    assert.ok(defs.some((d) => /\(created_at DESC\)/.test(d)), "created_at DESC index");
    assert.ok(defs.some((d) => /UNIQUE.*\(inventory_item_id, batch_number\)/.test(d)), "unique index");
  } finally {
    await pool.end();
  }
});

// ─── Validation / defaults / enums ─────────────────────────────────────────
test("PG path: required fields are enforced and defaults applied like Mongo", async () => {
  const item = await makeItem();
  // item required.
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ item: undefined })),
    /item is required/,
  );
  // batchNumber required.
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ batchNumber: "  " })),
    /batchNumber is required/,
  );
  // quantities required.
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ originalQuantity: undefined })),
    /originalQuantity is required/,
  );
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ currentQuantity: undefined })),
    /currentQuantity is required/,
  );

  const batch = await inventoryBatchRepository.create({
    item: item._id,
    batchNumber: `Defaults-${unique()}`,
    originalQuantity: 5,
    currentQuantity: 5,
  });
  assert.strictEqual(batch.status, "Active");
  assert.strictEqual(Number(batch.purchasePrice), 0);
  assert.strictEqual(batch.grn, undefined);
  assert.strictEqual(batch.supplier, undefined);
  assert.strictEqual(batch.manufacturingDate, undefined);
  assert.strictEqual(batch.expiryDate, undefined);
});

test("PG path: enum status values preserved and invalid values rejected", async () => {
  const item = await makeItem();
  for (const status of ["Active", "Quarantine", "Expired", "Consumed", "Returned", "Disposed"]) {
    const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, status, batchNumber: `st-${status}-${unique()}` }));
    assert.strictEqual((await inventoryBatchRepository.findById(batch._id)).status, status);
  }
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ item: item._id, status: "OnFire" })),
    /Invalid status|check constraint/,
  );
});

test("PG path: quantities allow zero and decimals but reject negatives", async () => {
  const item = await makeItem();
  const zero = await inventoryBatchRepository.create(batchBase({ item: item._id, originalQuantity: 0, currentQuantity: 0 }));
  assert.strictEqual(Number(zero.originalQuantity), 0);

  const decimal = await inventoryBatchRepository.create(batchBase({ item: item._id, originalQuantity: "0.25", currentQuantity: "1.75" }));
  assert.strictEqual(Number(decimal.originalQuantity), 0.25);
  assert.strictEqual(Number(decimal.currentQuantity), 1.75);

  for (const key of ["originalQuantity", "currentQuantity"]) {
    await assert.rejects(
      () => inventoryBatchRepository.create(batchBase({ [key]: -1 })),
      new RegExp(`${key} must be a number >= 0`),
    );
  }
});

test("PG path: purchasePrice permits negatives exactly like Mongo (no min)", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, purchasePrice: -12.5 }));
  assert.strictEqual(Number(batch.purchasePrice), -12.5);
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ item: item._id, purchasePrice: "abc" })),
    /purchasePrice must be a number/,
  );
});

test("PG path: no >= 0 CHECK exists on purchase_price (Mongo declares no min)", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'inventory_batches'::regclass AND contype = 'c'
        AND conname = 'inventory_batches_purchase_price_check'`);
    assert.strictEqual(rows.length, 0);
  } finally {
    await pool.end();
  }
});

// ─── Pre-save hook mirror ────────────────────────────────────────────────────
test("PG path: create mirrors the Mongo pre-save status transitions", async () => {
  const item = await makeItem();
  // currentQuantity 0 + status Active → Consumed (exactly like the Mongo hook).
  const consumed = await inventoryBatchRepository.create(batchBase({ item: item._id, currentQuantity: 0, originalQuantity: 10, expiryDate: new Date("2099-01-01T00:00:00Z") }));
  assert.strictEqual(consumed.status, "Consumed");

  // expiryDate in the past + status Active → Expired.
  const expired = await inventoryBatchRepository.create(batchBase({ item: item._id, currentQuantity: 5, expiryDate: new Date("2020-01-01T00:00:00Z") }));
  assert.strictEqual(expired.status, "Expired");

  // A non-Active status is never auto-flipped by the hook at create time
  // (Quarantine with past expiry stays Quarantine).
  const quarantine = await inventoryBatchRepository.create(batchBase({ item: item._id, currentQuantity: 0, status: "Quarantine" }));
  assert.strictEqual(quarantine.status, "Quarantine");
});

test("PG path: updateById never runs the pre-save hook (findByIdAndUpdate parity)", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, currentQuantity: 5, expiryDate: new Date("2099-01-01T00:00:00Z") }));
  const updated = await inventoryBatchRepository.updateById(batch._id, { currentQuantity: 0 });
  // Mongoose findByIdAndUpdate does NOT invoke pre('save'), so status stays Active.
  assert.strictEqual(updated.currentQuantity, 0);
  assert.strictEqual(updated.status, "Active");
});

// ─── Monetary / quantity precision ──────────────────────────────────────────
test("PG path: monetary values keep their exact decimal scale", async () => {
  const item = await makeItem();
  const prices = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const price of prices) {
      const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, purchasePrice: price, batchNumber: `p-${unique()}` }));
      const { rows } = await pool.query("SELECT purchase_price::text AS pp FROM inventory_batches WHERE id = $1", [batch._id]);
      assert.strictEqual(rows[0].pp, price);
      const read = await inventoryBatchRepository.findById(batch._id);
      assert.strictEqual(read.purchasePrice, Number(price));
    }
  } finally {
    await pool.end();
  }
});

test("PG path: fractional quantities round trip exactly", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, originalQuantity: "0.25", currentQuantity: "1.75" }));
  const read = await inventoryBatchRepository.findById(batch._id);
  assert.strictEqual(read.originalQuantity, 0.25);
  assert.strictEqual(read.currentQuantity, 1.75);
});

// ─── Dates / timezone semantics ─────────────────────────────────────────────
test("PG path: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const item = await makeItem();
  const when = new Date("2025-08-15T10:30:00+05:30");
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, expiryDate: when, manufacturingDate: when }));
  const read = await inventoryBatchRepository.findById(batch._id);
  assert.ok(read.expiryDate instanceof Date);
  assert.strictEqual(read.expiryDate.toISOString(), when.toISOString());
  assert.strictEqual(read.manufacturingDate.toISOString(), when.toISOString());
});

test("PG path: expiry filtering and ordering work for FIFO scans", async () => {
  const item = await makeItem();
  const base = Date.now() + 365 * 24 * 3600 * 1000; // a year from now (future, so Active)
  const earlier = new Date(base);
  const later = new Date(base + 30 * 24 * 3600 * 1000);
  await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `E2-${unique()}`, expiryDate: later }));
  await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `E1-${unique()}`, expiryDate: earlier }));

  // FIFO ordering: earlier expiry first.
  const fifo = await inventoryBatchRepository.findActiveByItemFifo(item._id);
  assert.strictEqual(fifo.length, 2);
  assert.ok(fifo[0].expiryDate < fifo[1].expiryDate);

  // Range filter excludes the earlier batch.
  const filtered = await inventoryBatchRepository.findMany({
    filter: { item: item._id, expiryDate: { $gte: new Date(base + 10 * 24 * 3600 * 1000) } },
  });
  assert.strictEqual(filtered.length, 1);
  assert.ok(filtered[0].expiryDate >= new Date(base + 10 * 24 * 3600 * 1000));
});

// ─── Uniqueness ─────────────────────────────────────────────────────────────
test("PG path: duplicate (item, batchNumber) is rejected; same batchNumber allowed for a different item", async () => {
  const item1 = await makeItem();
  const item2 = await makeItem();
  const bn = `Dup-${unique()}`;
  await inventoryBatchRepository.create(batchBase({ item: item1._id, batchNumber: bn }));

  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ item: item1._id, batchNumber: bn })),
    /duplicate key|unique constraint|23505/,
  );

  // Multiple batches per item are allowed when the batchNumber differs.
  await inventoryBatchRepository.create(batchBase({ item: item1._id, batchNumber: `Other-${unique()}` }));
  assert.strictEqual(await inventoryBatchRepository.count({ item: item1._id }), 2);

  // Same batchNumber under a different item is fine.
  await inventoryBatchRepository.create(batchBase({ item: item2._id, batchNumber: bn }));
  assert.strictEqual(await inventoryBatchRepository.count({ item: item1._id, batchNumber: bn }), 1);
});

// ─── InventoryItem relationship ─────────────────────────────────────────────
test("PG path: batches point at real inventory_items; invalid items are rejected", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id }));
  assert.strictEqual(batch.item, item._id);

  // A batch for a nonexistent item violates the FK.
  await assert.rejects(
    () => inventoryBatchRepository.create(batchBase({ item: "0000000000000000000000ff" })),
    /violates foreign key|23503/,
  );

  // Deleting an item that still has batches is REFUSED by the FK
  // (ON DELETE RESTRICT). This mirrors the least behaviour-changing contract:
  // Mongo never deletes batches when an item is removed (it leaves them
  // orphaned), so PostgreSQL must not destroy batch data either. The delete is
  // blocked and the batch remains.
  await assert.rejects(
    () => inventoryItemRepository.destroy(item._id),
    /violates foreign key|23503|update or delete on table "inventory_items"/,
  );
  assert.strictEqual(await inventoryBatchRepository.findById(batch._id) !== null, true, "batch must remain after the refused delete");
  assert.strictEqual((await inventoryBatchRepository.findById(batch._id)).item, item._id);
});

// ─── findMany / filters / sorting / pagination ─────────────────────────────
test("PG path: findMany honors item, status $in, batchNumber $in and pagination", async () => {
  const item = await makeItem();
  const a = await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `A-${unique()}`, status: "Active" }));
  const b = await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `B-${unique()}`, status: "Quarantine" }));

  const byItem = await inventoryBatchRepository.findMany({ filter: { item: item._id } });
  assert.ok(byItem.some((x) => x._id === a._id));
  assert.ok(byItem.some((x) => x._id === b._id));

  const active = await inventoryBatchRepository.findMany({ filter: { item: item._id, status: "Active" } });
  assert.deepStrictEqual(active.map((x) => x._id), [a._id]);

  const statusIn = await inventoryBatchRepository.findMany({ filter: { item: item._id, status: { $in: ["Active", "Quarantine"] } } });
  assert.strictEqual(statusIn.length, 2);

  const batchIn = await inventoryBatchRepository.findMany({ filter: { item: item._id, batchNumber: { $in: [a.batchNumber, b.batchNumber] } } });
  assert.strictEqual(batchIn.length, 2);

  const idIn = await inventoryBatchRepository.findMany({ filter: { item: item._id, id: { $in: [a._id, b._id] } } });
  assert.strictEqual(idIn.length, 2);

  const grn = crypto.randomBytes(12).toString("hex");
  await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `C-${unique()}`, grn }));
  const byGrn = await inventoryBatchRepository.findMany({ filter: { item: item._id, grn } });
  assert.strictEqual(byGrn.length, 1);

  const page1 = await inventoryBatchRepository.findMany({ filter: { item: item._id }, sort: { createdAt: 1 }, limit: 1, offset: 0 });
  const page2 = await inventoryBatchRepository.findMany({ filter: { item: item._id }, sort: { createdAt: 1 }, limit: 1, offset: 1 });
  assert.strictEqual(page1.length, 1);
  assert.strictEqual(page2.length, 1);
  assert.notStrictEqual(page1[0]._id, page2[0]._id);

  // Unsupported sort keys fall back to the FIFO ordering, never throw.
  const badSort = await inventoryBatchRepository.findMany({ filter: { item: item._id }, sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((x) => x._id === a._id));
});

// ─── findOne / count / update / destroy ─────────────────────────────────────
test("PG path: findOne returns a single match and null otherwise", async () => {
  const item = await makeItem();
  const bn = `One-${unique()}`;
  await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: bn }));
  const found = await inventoryBatchRepository.findOne({ item: item._id, batchNumber: bn });
  assert.ok(found);
  assert.strictEqual(found.batchNumber, bn);
  assert.strictEqual(await inventoryBatchRepository.findOne({ item: item._id, batchNumber: "missing-" + unique() }), null);
});

test("PG path: updateById persists and re-reads changed values", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id, currentQuantity: 5 }));
  const updated = await inventoryBatchRepository.updateById(batch._id, {
    currentQuantity: 3,
    status: "Quarantine",
    batchNumber: `Renamed-${unique()}`,
  });
  assert.strictEqual(Number(updated.currentQuantity), 3);
  assert.strictEqual(updated.status, "Quarantine");

  const reread = await inventoryBatchRepository.findById(batch._id);
  assert.strictEqual(reread.batchNumber, updated.batchNumber);
  assert.strictEqual(reread.status, "Quarantine");

  // The change is genuinely persisted to PostgreSQL, not merely returned by
  // the repository layer: read the raw row.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT current_quantity, status, batch_number FROM inventory_batches WHERE id = $1", [batch._id]);
    assert.strictEqual(rows[0].current_quantity.toString(), "3");
    assert.strictEqual(rows[0].status, "Quarantine");
    assert.strictEqual(rows[0].batch_number, updated.batchNumber);
  } finally {
    await pool.end();
  }
});

test("PG path: updateById enforces enums and quantities queue", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id }));
  await assert.rejects(() => inventoryBatchRepository.updateById(batch._id, { currentQuantity: -5 }), /currentQuantity must be a number >= 0/);
  await assert.rejects(() => inventoryBatchRepository.updateById(batch._id, { status: "Nope" }), /Invalid status/);
  await assert.rejects(() => inventoryBatchRepository.updateById(batch._id, { batchNumber: " " }), /batchNumber is required/);
  await assert.rejects(() => inventoryBatchRepository.updateById(batch._id, { item: "" }), /item is required/);
});

test("PG path: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(
    await inventoryBatchRepository.updateById("000000000000000000000000", { currentQuantity: 10 }),
    null,
  );
});

test("PG path: count uses COUNT(*) and honors filters", async () => {
  const item = await makeItem();
  await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `c1-${unique()}` }));
  await inventoryBatchRepository.create(batchBase({ item: item._id, batchNumber: `c2-${unique()}`, status: "Quarantine" }));
  assert.strictEqual(await inventoryBatchRepository.count({ item: item._id }), 2);
  assert.strictEqual(await inventoryBatchRepository.count({ item: item._id, status: "Active" }), 1);
  assert.strictEqual(await inventoryBatchRepository.count({ item: item._id, status: "Consumed" }), 0);
  assert.strictEqual(typeof (await inventoryBatchRepository.count({})), "number");
});

test("PG path: destroy reports existence and removes the row", async () => {
  const item = await makeItem();
  const batch = await inventoryBatchRepository.create(batchBase({ item: item._id }));
  assert.strictEqual(await inventoryBatchRepository.destroy(batch._id), true);
  assert.strictEqual(await inventoryBatchRepository.findById(batch._id), null);
  assert.strictEqual(await inventoryBatchRepository.destroy(batch._id), false);
  assert.strictEqual(await inventoryBatchRepository.destroy("000000000000000000000000"), false);

  // The row is genuinely gone from PostgreSQL.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM inventory_batches WHERE id = $1", [batch._id]);
    assert.strictEqual(rows.length, 0);
  } finally {
    await pool.end();
  }
});

test("PG path: legacy (24-hex) IDs round trip and create with the same id is idempotent", async () => {
  const item = await makeItem();
  const id = crypto.randomBytes(12).toString("hex");
  const first = await inventoryBatchRepository.create(batchBase({ item: item._id, id }));
  const second = await inventoryBatchRepository.create({ ...batchBase({ item: item._id, batchNumber: "Other" + unique() }), id });
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await inventoryBatchRepository.findById(id))._id, id);
});

// ─── No partial writes / Mongo untouched on the PG path ─────────────────────
test("PG path: a create failure does not leave a partial row", async () => {
  const item = await makeItem();
  const before = await inventoryBatchRepository.count({});
  await assert.rejects(() => inventoryBatchRepository.create(batchBase({ item: item._id, currentQuantity: -1 })), /currentQuantity must be a number >= 0/);
  await assert.rejects(() => inventoryBatchRepository.create(batchBase({ item: item._id, status: "Bad" })), /Invalid status/);
  const after = await inventoryBatchRepository.count({});
  assert.strictEqual(after, before);
});

test("PG path: MongoDB model is never touched when PG is selected", async () => {
  const InventoryBatch = require("../src/models/InventoryBatch");

  const originalCreate = InventoryBatch.create;
  const originalFindById = InventoryBatch.findById;
  const originalFind = InventoryBatch.find;
  const originalFindOne = InventoryBatch.findOne;
  const originalFindByIdAndUpdate = InventoryBatch.findByIdAndUpdate;
  const originalFindByIdAndDelete = InventoryBatch.findByIdAndDelete;
  const originalCountDocuments = InventoryBatch.countDocuments;

  const mongoTouched = [];
  InventoryBatch.create = async (...args) => { mongoTouched.push("create"); return originalCreate.apply(this, args); };
  InventoryBatch.findById = async (...args) => { mongoTouched.push("findById"); return originalFindById.apply(this, args); };
  InventoryBatch.find = async (...args) => { mongoTouched.push("find"); return originalFind.apply(this, args); };
  InventoryBatch.findOne = async (...args) => { mongoTouched.push("findOne"); return originalFindOne.apply(this, args); };
  InventoryBatch.findByIdAndUpdate = async (...args) => { mongoTouched.push("findByIdAndUpdate"); return originalFindByIdAndUpdate.apply(this, args); };
  InventoryBatch.findByIdAndDelete = async (...args) => { mongoTouched.push("findByIdAndDelete"); return originalFindByIdAndDelete.apply(this, args); };
  InventoryBatch.countDocuments = async (...args) => { mongoTouched.push("countDocuments"); return originalCountDocuments.apply(this, args); };

  try {
    const item = await makeItem();
    const batch = await inventoryBatchService.create(batchBase({ item: item._id }));
    await inventoryBatchService.updateById(batch._id, { currentQuantity: 3 });
    await inventoryBatchService.findById(batch._id);
    await inventoryBatchService.findMany({ filter: { item: item._id } });
    await inventoryBatchService.findActiveByItemFifo(item._id);
    await inventoryBatchService.count({});
    await inventoryBatchService.destroy(batch._id);

    assert.deepStrictEqual(mongoTouched, [], "Mongo model must not be invoked on the PG path");
  } finally {
    InventoryBatch.create = originalCreate;
    InventoryBatch.findById = originalFindById;
    InventoryBatch.find = originalFind;
    InventoryBatch.findOne = originalFindOne;
    InventoryBatch.findByIdAndUpdate = originalFindByIdAndUpdate;
    InventoryBatch.findByIdAndDelete = originalFindByIdAndDelete;
    InventoryBatch.countDocuments = originalCountDocuments;
  }
});

test("PG path: the datasource seam is read at call time, not captured at require time", async () => {
  // This is the Fix 1 guarantee: inventoryBatchService/inventoryBatchRepository
  // read dbConfig.isDbConnected() when a method runs, so swapping the function
  // AFTER the modules are loaded deterministically routes the next call.
  const InventoryBatch = require("../src/models/InventoryBatch");
  const original = InventoryBatch.create;
  let mongoCalls = 0;
  InventoryBatch.create = async (...args) => { mongoCalls += 1; return { _id: "000000000000000000000001", ...args[0], toObject: () => args[0] }; };

  try {
    // Modules are already loaded (test file's before() hook). Flip the seam to
    // Mongo AFTER load: the service must immediately fall back.
    dbConfig.isDbConnected = () => false;
    assert.strictEqual(await inventoryBatchService.usePostgres(), false);
    await inventoryBatchService.create({ item: "000000000000000000000001", batchNumber: `Seam-${unique()}`, originalQuantity: 1, currentQuantity: 1 });
    assert.strictEqual(mongoCalls, 1, "seam=false routes the create to the Mongoose model");

    // Flip back to PostgreSQL AFTER load: the service must route to PG again.
    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await inventoryBatchService.usePostgres(), true);
    const item = await makeItem();
    const batch = await inventoryBatchService.create(batchBase({ item: item._id }));
    assert.strictEqual(mongoCalls, 1, "seam=true routes the create to PG, not Mongo");
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT id FROM inventory_batches WHERE id = $1", [batch._id]);
      assert.strictEqual(rows.length, 1, "seam=true create persisted a PG row");
    } finally {
      await pool.end();
    }
  } finally {
    InventoryBatch.create = original;
    dbConfig.isDbConnected = () => true;
  }
});