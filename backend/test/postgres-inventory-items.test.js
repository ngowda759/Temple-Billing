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
let inventoryItemRepository;
let inventoryItemService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
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
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
  inventoryItemService = require("../src/services/inventoryItemService");
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

const itemBase = (overrides = {}) => ({
  name: `Item-${unique()}`,
  unit: "Kg",
  availableStock: 10,
  minimumStock: 2,
  category: "Pooja Items",
  ...overrides,
});

// ─── PostgreSQL path: service selects PG and round trips ───────────────────
test("PG path: service uses PostgreSQL when Inventory path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await inventoryItemService.usePostgres(), true);
  assert.strictEqual(inventoryItemService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const input = itemBase({ availableStock: 7.5, minimumStock: 1.5 });
  const item = await inventoryItemService.create(input);

  assert.ok(item._id);
  assert.match(item._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(item.name, input.name);
  assert.strictEqual(item.unit, "Kg");
  assert.strictEqual(Number(item.availableStock), 7.5);
  assert.strictEqual(Number(item.minimumStock), 1.5);
  assert.strictEqual(item.category, "Pooja Items");
  assert.strictEqual(item.type, "Consumable");
  assert.strictEqual(item.isActive, true);
  assert.strictEqual(item.description, "");
  assert.strictEqual(item.status, "Healthy");
  assert.ok(item.createdAt instanceof Date);
  assert.ok(item.updatedAt instanceof Date);

  const read = await inventoryItemService.findById(item._id);
  assert.strictEqual(read._id, item._id);
  assert.strictEqual(read.name, input.name);
});

test("PG path: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const randomId = crypto.randomBytes(12).toString("hex");
  const item = await inventoryItemRepository.create({
    name: "Full Field Item " + unique(),
    itemCode: "SKU-" + unique(),
    barcode: "89012345",
    qrCode: "QR-001",
    type: "Raw Material",
    unit: "Box",
    availableStock: 12.5,
    reservedStock: 3,
    issuedStock: 4,
    consumedStock: 5,
    damagedStock: 1,
    expiredStock: 2,
    returnedStock: 0.5,
    minimumStock: 2,
    reorderLevel: 3,
    maximumStock: 100,
    batchRequired: true,
    expiryRequired: true,
    shelfLifeDays: 30,
    purchasePrice: 50.25,
    sellingPrice: 75.5,
    gstRate: 18,
    preferredSupplier: randomId,
    expenseHead: randomId,
    incomeHead: randomId,
    inventoryAccount: randomId,
    category: "Cooking / Annaprasada",
    description: "A full mapping item",
    isActive: false,
    expiryDate: new Date("2027-01-15T00:00:00Z"),
    lastPurchaseDate: new Date("2026-01-10T00:00:00Z"),
    lastPurchasePrice: 49.99,
    lastSupplier: "Supplier A",
  });

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_items WHERE id = $1", [item._id]);
    const row = rows[0];
    assert.strictEqual(row.name, item.name);
    assert.strictEqual(row.item_code, item.itemCode);
    assert.strictEqual(row.barcode, "89012345");
    assert.strictEqual(row.qr_code, "QR-001");
    assert.strictEqual(row.type, "Raw Material");
    assert.strictEqual(row.unit, "Box");
    assert.strictEqual(row.available_stock.toString(), "12.5");
    assert.strictEqual(row.reserved_stock.toString(), "3");
    assert.strictEqual(row.issued_stock.toString(), "4");
    assert.strictEqual(row.consumed_stock.toString(), "5");
    assert.strictEqual(row.damaged_stock.toString(), "1");
    assert.strictEqual(row.expired_stock.toString(), "2");
    assert.strictEqual(row.returned_stock.toString(), "0.5");
    assert.strictEqual(row.minimum_stock.toString(), "2");
    assert.strictEqual(row.reorder_level.toString(), "3");
    assert.strictEqual(row.maximum_stock.toString(), "100");
    assert.strictEqual(row.batch_required, true);
    assert.strictEqual(row.expiry_required, true);
    assert.strictEqual(row.shelf_life_days.toString(), "30");
    assert.strictEqual(row.purchase_price.toString(), "50.25");
    assert.strictEqual(row.selling_price.toString(), "75.5");
    assert.strictEqual(row.gst_rate.toString(), "18");
    assert.strictEqual(row.preferred_supplier, randomId);
    assert.strictEqual(row.expense_head, randomId);
    assert.strictEqual(row.income_head, randomId);
    assert.strictEqual(row.inventory_account, randomId);
    assert.strictEqual(row.category, "Cooking / Annaprasada");
    assert.strictEqual(row.description, "A full mapping item");
    assert.strictEqual(row.is_active, false);
    assert.strictEqual(row.expiry_date.toISOString(), "2027-01-15T00:00:00.000Z");
    assert.strictEqual(row.last_purchase_date.toISOString(), "2026-01-10T00:00:00.000Z");
    assert.strictEqual(row.last_purchase_price.toString(), "49.99");
    assert.strictEqual(row.last_supplier, "Supplier A");
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
  } finally {
    await pool.end();
  }

  const read = await inventoryItemRepository.findById(item._id);
  assert.strictEqual(read.itemCode, item.itemCode);
  assert.strictEqual(read.preferredSupplier, randomId);
  assert.strictEqual(read.shelfLifeDays, 30);
  assert.strictEqual(read.expiryDate.toISOString(), "2027-01-15T00:00:00.000Z");
  assert.strictEqual(read.isActive, false);
  assert.strictEqual(read.status, "Healthy"); // 12.5 > minimum 2 → Healthy
});

test("PG path: monetary values keep their exact decimal scale", async () => {
  const prices = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const price of prices) {
      const created = await inventoryItemRepository.create(itemBase({ purchasePrice: price, sellingPrice: price }));
      const { rows } = await pool.query("SELECT purchase_price::text AS pp, selling_price::text AS sp FROM inventory_items WHERE id = $1", [created._id]);
      assert.strictEqual(rows[0].pp, price);
      assert.strictEqual(rows[0].sp, price);
      const read = await inventoryItemRepository.findById(created._id);
      assert.strictEqual(read.purchasePrice, Number(price));
    }
  } finally {
    await pool.end();
  }
});

test("PG path: fractional quantities round trip exactly", async () => {
  const created = await inventoryItemRepository.create(itemBase({ availableStock: "0.25", consumedStock: "1.75", reorderLevel: "0.5" }));
  const read = await inventoryItemRepository.findById(created._id);
  assert.strictEqual(read.availableStock, 0.25);
  assert.strictEqual(read.consumedStock, 1.75);
  assert.strictEqual(read.reorderLevel, 0.5);
});

test("PG path: required and optional fields behave like Mongo", async () => {
  // name required.
  await assert.rejects(() => inventoryItemRepository.create({ name: "  " }), /name is required/);
  // defaults applied.
  const minimal = await inventoryItemRepository.create({ name: "Minimal " + unique() });
  assert.strictEqual(minimal.unit, "Pack");
  assert.strictEqual(minimal.type, "Consumable");
  assert.strictEqual(minimal.category, "Miscellaneous Items");
  assert.strictEqual(minimal.availableStock, 0);
  assert.strictEqual(minimal.minimumStock, 0);
  assert.strictEqual(minimal.isActive, true);
  assert.strictEqual(minimal.purchasePrice, 0);
  assert.strictEqual(minimal.description, "");
  assert.strictEqual(minimal.itemCode, undefined);
  assert.strictEqual(minimal.barcode, undefined);
  assert.strictEqual(minimal.expiryDate, undefined);
  assert.strictEqual(minimal.preferredSupplier, undefined);
});

test("PG path: enum values are preserved and invalid values rejected", async () => {
  for (const type of ["Raw Material", "Finished Good", "Asset", "Consumable", "Other"]) {
    const created = await inventoryItemRepository.create(itemBase({ type, name: `type-${type}-${unique()}` }));
    assert.strictEqual((await inventoryItemRepository.findById(created._id)).type, type);
  }
  for (const category of ["Pooja Items", "Prasadam Ingredients", "Cleaning Materials", "Office & Stationery", "Electrical & Maintenance", "Festival Materials", "Miscellaneous Items", "Cooking / Annaprasada"]) {
    const created = await inventoryItemRepository.create(itemBase({ category, name: `cat-${unique()}` }));
    assert.strictEqual((await inventoryItemRepository.findById(created._id)).category, category);
  }
  for (const unit of ["Piece (Pc)", "Number (Nos)", "Unit", "Pair", "Set", "Bundle", "Packet", "Pack", "Box", "Carton", "Roll", "Dozen", "Tray", "Sack", "Bag", "Pieces", "Gram (g)", "Kilogram (kg)", "Kg", "Quintal", "Ton", "Millilitre (ml)", "Litre (L)", "Liter", "Can", "Drum", "Barrel", "Bottle", "Jar", "Tin", "Container", "Bucket", "Cylinder", "Meter", "Feet", "Square Feet", "Square Meter"]) {
    const created = await inventoryItemRepository.create(itemBase({ unit, name: `unit-${unique()}` }));
    assert.strictEqual((await inventoryItemRepository.findById(created._id)).unit, unit);
  }

  await assert.rejects(() => inventoryItemRepository.create(itemBase({ type: "Edible" })), /Invalid type|check constraint/);
  await assert.rejects(() => inventoryItemRepository.create(itemBase({ category: "Nope" })), /Invalid category|check constraint/);
  await assert.rejects(() => inventoryItemRepository.create(itemBase({ unit: "Litre (l)" })), /Invalid unit|check constraint/); // case-sensitive
});

test("PG path: the ten Mongo min-0 stock counters reject negatives", async () => {
  // These are the fields the Mongo schema declares with min: 0. shelfLifeDays
  // is deliberately absent (no min in Mongo) and is covered by the next test.
  for (const key of ["availableStock", "minimumStock", "reorderLevel", "maximumStock", "reservedStock", "issuedStock", "consumedStock", "damagedStock", "expiredStock", "returnedStock"]) {
    await assert.rejects(
      () => inventoryItemRepository.create(itemBase({ [key]: -1 })),
      new RegExp(`${key} must be a number >= 0`),
    );
  }
  // zero is valid.
  const zero = await inventoryItemRepository.create(itemBase({ availableStock: 0 }));
  assert.strictEqual(zero.status, "Out Of Stock");
});

test("PG path: shelfLifeDays and monetary fields permit negatives exactly like Mongo", async () => {
  // The Mongo schema has NO min on shelfLifeDays / purchasePrice / sellingPrice
  // / gstRate / lastPurchasePrice, so PostgreSQL must accept negatives too.
  for (const key of ["shelfLifeDays", "purchasePrice", "sellingPrice", "gstRate", "lastPurchasePrice"]) {
    const created = await inventoryItemRepository.create(itemBase({ [key]: -12.5 }));
    assert.ok(created?._id);
    const read = await inventoryItemRepository.findById(created._id);
    assert.strictEqual(read[key], -12.5);
  }
  // Non-numeric values are still rejected (Number coercion would make them NaN).
  await assert.rejects(
    () => inventoryItemRepository.create(itemBase({ shelfLifeDays: "abc" })),
    /shelfLifeDays must be a number/,
  );
  await assert.rejects(
    () => inventoryItemRepository.create(itemBase({ purchasePrice: "NaN" })),
    /purchasePrice must be a number/,
  );
});

test("PG path: no >= 0 CHECK constraints exist on the five no-min fields", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'inventory_items'::regclass
         AND contype = 'c'
         AND conname IN (
           'inventory_items_shelf_life_days_check',
           'inventory_items_purchase_price_check',
           'inventory_items_selling_price_check',
           'inventory_items_gst_rate_check',
           'inventory_items_last_purchase_price_check'
         )`,
    );
    assert.strictEqual(rows.length, 0);
  } finally {
    await pool.end();
  }
});

test("PG path: duplicate name+category violates the unique constraint (sparse itemCode allows NULLs)", async () => {
  const name = `Dup-${unique()}`;
  const category = "Pooja Items";
  const first = await inventoryItemRepository.create({ name, unit: "Pack", category });
  assert.ok(first?._id);

  await assert.rejects(
    () => inventoryItemRepository.create({ name, unit: "Pack", category }),
    /duplicate key|unique constraint|23505/,
  );

  // Same name in a DIFFERENT category is allowed (the unique is the pair).
  const other = await inventoryItemRepository.create({ name, unit: "Pack", category: "Office & Stationery" });
  assert.ok(other?._id);

  // Multiple NULL itemCodes are allowed (sparse semantics).
  const withNullCode = await inventoryItemRepository.create({ name: `code-null-${unique()}`, unit: "Pack", category });
  assert.strictEqual(withNullCode.itemCode, undefined);
  await inventoryItemRepository.create({ name: `code-null-2-${unique()}`, unit: "Pack", category: "Festival Materials" });

  // A duplicated itemCode is rejected (sparse unique).
  const code = "SKU-DUP-" + unique();
  await inventoryItemRepository.create({ name: `code-1-${unique()}`, unit: "Pack", category, itemCode: code });
  await assert.rejects(
    () => inventoryItemRepository.create({ name: `code-2-${unique()}`, unit: "Pack", category, itemCode: code }),
    /duplicate key|unique constraint|23505/,
  );
});

test("PG path: update persists and re-reads changed values", async () => {
  const item = await inventoryItemService.create(itemBase({ availableStock: 10, minimumStock: 2 }));
  const updated = await inventoryItemService.updateById(item._id, {
    name: "Renamed " + unique(),
    unit: "Box",
    availableStock: 40,
    minimumStock: 5,
    isActive: false,
    category: "Cleaning Materials",
  });

  assert.strictEqual(updated.name, updated.name);
  assert.strictEqual(updated.unit, "Box");
  assert.strictEqual(Number(updated.availableStock), 40);
  assert.strictEqual(Number(updated.minimumStock), 5);
  assert.strictEqual(updated.isActive, false);
  assert.strictEqual(updated.category, "Cleaning Materials");
  assert.strictEqual(updated.status, "Healthy");

  const reread = await inventoryItemService.findById(item._id);
  assert.strictEqual(reread.name, updated.name);
  assert.strictEqual(Number(reread.availableStock), 40);
});

test("PG path: update enforces enums and stock counters", async () => {
  const item = await inventoryItemService.create(itemBase());
  await assert.rejects(() => inventoryItemService.updateById(item._id, { availableStock: -5 }), /availableStock must be a number >= 0/);
  await assert.rejects(() => inventoryItemService.updateById(item._id, { unit: "Nope" }), /Invalid unit/);
  await assert.rejects(() => inventoryItemService.updateById(item._id, { type: "Bad" }), /Invalid type/);
});

test("PG path: update permits negative shelfLifeDays and prices (no min in Mongo)", async () => {
  const item = await inventoryItemService.create(itemBase());
  const updated = await inventoryItemService.updateById(item._id, {
    shelfLifeDays: -30,
    sellingPrice: -99.5,
    gstRate: -8,
  });
  assert.strictEqual(updated.shelfLifeDays, -30);
  assert.strictEqual(updated.sellingPrice, -99.5);
  assert.strictEqual(updated.gstRate, -8);
});

test("PG path: update on a missing id returns null", async () => {
  assert.strictEqual(
    await inventoryItemRepository.updateById("000000000000000000000000", { availableStock: 10 }),
    null,
  );
});

test("PG path: findMany honors filters, sorts and pagination (incl $in and search)", async () => {
  const marker = unique().slice(-6);
  const a = await inventoryItemRepository.create(itemBase({ name: `AA-${marker}-first`, availableStock: 50 }));
  const b = await inventoryItemRepository.create(itemBase({ name: `BB-${marker}-second`, availableStock: 1 }));

  // category filter (valid enum value).
  const byCat = await inventoryItemRepository.findMany({ filter: { category: "Pooja Items", name: { $in: [a.name, b.name] } } });
  assert.ok(byCat.some((i) => i._id === a._id));
  assert.ok(byCat.some((i) => i._id === b._id));

  // $in filter across categories.
  const inCat = await inventoryItemRepository.findMany({ filter: { category: { $in: ["Pooja Items", "Festival Materials"] }, name: { $in: [a.name, b.name] } } });
  assert.ok(inCat.some((i) => i._id === a._id));

  // name $in filter.
  const nameIn = await inventoryItemRepository.findMany({ filter: { name: { $in: [a.name, b.name] } } });
  assert.strictEqual(nameIn.length, 2);

  // search substring matches name.
  const searched = await inventoryItemRepository.findMany({ filter: { search: marker } });
  assert.ok(searched.some((i) => i._id === a._id));

  // sort by name ASC (default) and pagination.
  const sorted = await inventoryItemRepository.findMany({ filter: { name: { $in: [a.name, b.name] } }, sort: { name: 1 } });
  assert.deepStrictEqual(sorted.map((i) => i._id), [a._id, b._id]);

  const page1 = await inventoryItemRepository.findMany({ filter: { name: { $in: [a.name, b.name] } }, sort: { name: 1 }, limit: 1, offset: 0 });
  const page2 = await inventoryItemRepository.findMany({ filter: { name: { $in: [a.name, b.name] } }, sort: { name: 1 }, limit: 1, offset: 1 });
  assert.strictEqual(page1.length, 1);
  assert.strictEqual(page2.length, 1);
  assert.notStrictEqual(page1[0]._id, page2[0]._id);

  // Invalid sort falls back to name ASC, never throws.
  const badSort = await inventoryItemRepository.findMany({ filter: { name: { $in: [a.name, b.name] } }, sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((i) => i._id === a._id));
});

test("PG path: active/inactive and low-stock filters", async () => {
  const marker = unique().slice(-6);
  const active = await inventoryItemRepository.create(itemBase({ name: `active-${marker}`, isActive: true, availableStock: 100 }));
  const inactive = await inventoryItemRepository.create(itemBase({ name: `inactive-${marker}`, isActive: false, availableStock: 100 }));

  const actives = await inventoryItemRepository.findMany({ filter: { isActive: true, name: { $in: [active.name, inactive.name] } } });
  assert.deepStrictEqual(actives.map((i) => i._id), [active._id]);

  // availableStock $lte matches the low/out-of-stock set.
  const low = await inventoryItemRepository.findMany({ filter: { name: { $in: [active.name, inactive.name] }, availableStock: { $lte: 5 } } });
  assert.strictEqual(low.length, 0);
  const high = await inventoryItemRepository.findMany({ filter: { name: { $in: [active.name, inactive.name] }, availableStock: { $gte: 50 } } });
  assert.strictEqual(high.length, 2);
});

test("PG path: status virtual reflects stock thresholds (Healthy / Low Stock / Out Of Stock)", async () => {
  const out = await inventoryItemRepository.create(itemBase({ availableStock: 0, minimumStock: 2 }));
  assert.strictEqual(out.status, "Out Of Stock");
  const low = await inventoryItemRepository.create(itemBase({ availableStock: 2, minimumStock: 2 }));
  assert.strictEqual(low.status, "Low Stock");
  const healthy = await inventoryItemRepository.create(itemBase({ availableStock: 3, minimumStock: 2 }));
  assert.strictEqual(healthy.status, "Healthy");

  // ReorderLevel takes precedence over minimumStock in the live controllers;
  // the virtual mirrors the Mongo model (availableStock <= minimumStock).
  const reorderBelow = await inventoryItemRepository.create(itemBase({ availableStock: 2, minimumStock: 10, reorderLevel: 5 }));
  assert.strictEqual(reorderBelow.status, "Low Stock");
});

test("PG path: findOne returns a single match and null otherwise", async () => {
  const marker = unique().slice(-6);
  await inventoryItemRepository.create(itemBase({ name: `one-${marker}`, category: "Pooja Items" }));
  const found = await inventoryItemRepository.findOne({ category: "Pooja Items", name: `one-${marker}` });
  assert.ok(found);
  assert.strictEqual(found.name, `one-${marker}`);
  assert.strictEqual(await inventoryItemRepository.findOne({ category: "Pooja Items", name: "does-not-exist-" + marker }), null);
});

test("PG path: findByName matches case-insensitively like issueInventoryRequest", async () => {
  const name = `Betel ${unique()}`;
  await inventoryItemRepository.create(itemBase({ name, category: "Pooja Items" }));
  const direct = await inventoryItemRepository.findByName(name.toLowerCase());
  assert.ok(direct.some((i) => i.name === name));
  const mixed = await inventoryItemRepository.findByName(`BeTeL ${name.split(" ")[1]}`);
  assert.ok(mixed.some((i) => i.name === name));
  assert.strictEqual((await inventoryItemRepository.findByName("missing-" + unique())).length, 0);
});

test("PG path: count uses COUNT(*) and honors filters", async () => {
  const marker = unique().slice(-6);
  const a = await inventoryItemRepository.create(itemBase({ name: `c1-${marker}`, category: "Pooja Items" }));
  const b = await inventoryItemRepository.create(itemBase({ name: `c2-${marker}`, category: "Pooja Items", isActive: false }));
  assert.strictEqual(await inventoryItemRepository.count({ name: { $in: [a.name, b.name] } }), 2);
  assert.strictEqual(await inventoryItemRepository.count({ name: { $in: [a.name, b.name] }, isActive: true }), 1);
  assert.strictEqual(await inventoryItemRepository.count({ name: "missing-" + marker }), 0);
  assert.strictEqual(typeof (await inventoryItemRepository.count({})), "number");
});

test("PG path: destroy reports existence and removes the row", async () => {
  const item = await inventoryItemRepository.create(itemBase());
  assert.strictEqual(await inventoryItemRepository.destroy(item._id), true);
  assert.strictEqual(await inventoryItemRepository.findById(item._id), null);
  assert.strictEqual(await inventoryItemRepository.destroy(item._id), false);
  assert.strictEqual(await inventoryItemRepository.destroy("000000000000000000000000"), false);
});

test("PG path: legacy (24-hex) IDs round trip and create with the same id is idempotent", async () => {
  const id = crypto.randomBytes(12).toString("hex");
  const first = await inventoryItemRepository.create(itemBase({ id }));
  const second = await inventoryItemRepository.create({ ...itemBase({ name: "Other" + unique() }), id });
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await inventoryItemRepository.findById(id))._id, id);
});

test("PG path: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const expiry = new Date("2025-08-15T10:30:00+05:30");
  const item = await inventoryItemRepository.create(itemBase({ expiryDate: expiry, lastPurchaseDate: expiry }));
  const read = await inventoryItemRepository.findById(item._id);
  assert.ok(read.expiryDate instanceof Date);
  assert.strictEqual(read.expiryDate.toISOString(), expiry.toISOString());
  assert.strictEqual(read.lastPurchaseDate.toISOString(), expiry.toISOString());
});

test("PG path: inventory_items has no FK to unrelated or future tables", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'inventory_items'
          AND tc.constraint_type = 'FOREIGN KEY'`,
    );
    assert.deepStrictEqual(rows, [], "inventory_items must not reference other PG tables");
  } finally {
    await pool.end();
  }
});

test("PG path: a create failure does not leave a partial row", async () => {
  const before = await inventoryItemService.count({});
  await assert.rejects(() => inventoryItemRepository.create(itemBase({ availableStock: -1 })), /availableStock must be a number >= 0/);
  await assert.rejects(() => inventoryItemRepository.create(itemBase({ type: "Bad" })), /Invalid type/);
  const after = await inventoryItemService.count({});
  assert.strictEqual(after, before);
});

test("PG path: MongoDB model is never touched when PG is selected", async () => {
  const InventoryItem = require("../src/models/InventoryItem");

  const originalCreate = InventoryItem.create;
  const originalFindById = InventoryItem.findById;
  const originalFind = InventoryItem.find;
  const originalFindOne = InventoryItem.findOne;
  const originalFindByIdAndUpdate = InventoryItem.findByIdAndUpdate;
  const originalFindByIdAndDelete = InventoryItem.findByIdAndDelete;
  const originalCountDocuments = InventoryItem.countDocuments;

  const mongoTouched = [];
  InventoryItem.create = async (...args) => { mongoTouched.push("create"); return originalCreate.apply(this, args); };
  InventoryItem.findById = async (...args) => { mongoTouched.push("findById"); return originalFindById.apply(this, args); };
  InventoryItem.find = async (...args) => { mongoTouched.push("find"); return originalFind.apply(this, args); };
  InventoryItem.findOne = async (...args) => { mongoTouched.push("findOne"); return originalFindOne.apply(this, args); };
  InventoryItem.findByIdAndUpdate = async (...args) => { mongoTouched.push("findByIdAndUpdate"); return originalFindByIdAndUpdate.apply(this, args); };
  InventoryItem.findByIdAndDelete = async (...args) => { mongoTouched.push("findByIdAndDelete"); return originalFindByIdAndDelete.apply(this, args); };
  InventoryItem.countDocuments = async (...args) => { mongoTouched.push("countDocuments"); return originalCountDocuments.apply(this, args); };

  try {
    const created = await inventoryItemService.create(itemBase());
    await inventoryItemService.updateById(created._id, { availableStock: 20 });
    await inventoryItemService.findById(created._id);
    await inventoryItemService.findMany({});
    await inventoryItemService.count({});
    await inventoryItemService.destroy(created._id);

    assert.deepStrictEqual(mongoTouched, [], "Mongo model must not be invoked on the PG path");
  } finally {
    InventoryItem.create = originalCreate;
    InventoryItem.findById = originalFindById;
    InventoryItem.find = originalFind;
    InventoryItem.findOne = originalFindOne;
    InventoryItem.findByIdAndUpdate = originalFindByIdAndUpdate;
    InventoryItem.findByIdAndDelete = originalFindByIdAndDelete;
    InventoryItem.countDocuments = originalCountDocuments;
  }
});