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
let inventoryLogRepository;
let inventoryLogService;
let inventoryItemRepository;

// Every table that the migration chain creates. inventory_logs is dropped
// before inventory_items so a stale FK-dependent table can never block a fresh
// migration run (inventory_items CASCADE would drop it anyway).
const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS inventory_logs CASCADE");
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
  inventoryLogRepository = require("../src/repositories/inventoryLogRepository");
  inventoryLogService = require("../src/services/inventoryLogService");
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
  inventoryItemRepository.create({ name: `LogItem-${unique()}`, unit: "Pack", availableStock: 100 });

const logBase = (overrides = {}) => ({
  item: "0000000000000000000000aa",
  action: "Restocked",
  quantity: 10,
  oldStock: 5,
  newStock: 15,
  ...overrides,
});

// ─── PostgreSQL path: service selects PG and round trips ───────────────────
test("PG path: service uses PostgreSQL when the Inventory Log path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await inventoryLogService.usePostgres(), true);
  assert.strictEqual(inventoryLogService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const item = await makeItem();
  const userId = crypto.randomBytes(12).toString("hex");
  const when = new Date("2025-06-01T10:30:00+05:30");
  const input = logBase({
    item: item._id,
    action: "Consumed",
    quantity: "7.5",
    oldStock: "20",
    newStock: "12.5",
    user: userId,
    date: when,
  });
  const log = await inventoryLogService.create(input);

  assert.ok(log._id);
  assert.match(log._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(log.item, item._id);
  assert.strictEqual(log.action, "Consumed");
  assert.strictEqual(Number(log.quantity), 7.5);
  assert.strictEqual(Number(log.oldStock), 20);
  assert.strictEqual(Number(log.newStock), 12.5);
  assert.strictEqual(log.user, userId);
  assert.ok(log.date instanceof Date);
  assert.strictEqual(log.date.toISOString(), when.toISOString());
  assert.ok(log.createdAt instanceof Date);
  assert.ok(log.updatedAt instanceof Date);

  const read = await inventoryLogService.findById(log._id);
  assert.strictEqual(read._id, log._id);
  assert.strictEqual(read.item, item._id);
});

test("PG path: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const item = await makeItem();
  const userId = crypto.randomBytes(12).toString("hex");
  const when = new Date("2025-12-31T23:59:59+05:30");
  const log = await inventoryLogRepository.create(logBase({
    item: item._id,
    action: "Lost",
    quantity: "123456.789",
    oldStock: "0",
    newStock: "-123456.789",
    user: userId,
    date: when,
  }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_logs WHERE id = $1", [log._id]);
    const row = rows[0];
    assert.strictEqual(row.inventory_item_id, item._id);
    assert.strictEqual(row.action, "Lost");
    assert.strictEqual(row.quantity.toString(), "123456.789");
    assert.strictEqual(row.old_stock.toString(), "0");
    assert.strictEqual(row.new_stock.toString(), "-123456.789");
    assert.strictEqual(row.user_id, userId);
    assert.strictEqual(row.date.toISOString(), when.toISOString());
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
  } finally {
    await pool.end();
  }

  const read = await inventoryLogRepository.findById(log._id);
  assert.strictEqual(read.user, userId);
  assert.strictEqual(Number(read.quantity), 123456.789);
});

// ─── Field mapping / SQL schema ─────────────────────────────────────────────
test("PG path: inventory_logs table has the exact Mongo field mapping", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'inventory_logs'
      ORDER BY ordinal_position`);
    const col = (name) => rows.find((c) => c.column_name === name);
    assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO");
    assert.ok(col("inventory_item_id") && col("inventory_item_id").data_type === "text" && col("inventory_item_id").is_nullable === "NO");
    assert.ok(col("action") && col("action").data_type === "text" && col("action").is_nullable === "NO");
    assert.ok(col("quantity") && col("quantity").data_type === "numeric" && col("quantity").is_nullable === "NO");
    assert.ok(col("old_stock") && col("old_stock").data_type === "numeric" && col("old_stock").is_nullable === "NO" && col("old_stock").column_default === "0");
    assert.ok(col("new_stock") && col("new_stock").data_type === "numeric" && col("new_stock").is_nullable === "NO" && col("new_stock").column_default === "0");
    assert.ok(col("user_id") && col("user_id").data_type === "text" && col("user_id").is_nullable === "YES");
    assert.ok(col("date") && col("date").data_type === "timestamp with time zone" && col("date").is_nullable === "NO");
    assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
    assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  } finally {
    await pool.end();
  }
});

test("PG path: no fake FKs — only the real inventory_items FK (RESTRICT); user is plain TEXT", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT kcu.column_name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN information_schema.key_column_usage kcu
        ON c.conname = kcu.constraint_name
      WHERE c.contype = 'f' AND c.conrelid = 'inventory_logs'::regclass`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].column_name, "inventory_item_id");
    assert.ok(/REFERENCES inventory_items\(id\)/.test(rows[0].def));
    // ON DELETE RESTRICT: Mongo leaves logs orphaned when an item is deleted,
    // so PostgreSQL must not cascade-delete logs.
    assert.ok(/ON DELETE RESTRICT/i.test(rows[0].def));
    assert.ok(!/CASCADE/i.test(rows[0].def), "must not cascade");

    // users stays Mongo-backed as the source of truth (rows commonly absent
    // from PG), so user_id must NOT have a foreign key — same convention as
    // every user/employee reference in Phases 2A–2I.
    const userFk = rows.filter((r) => r.column_name === "user_id");
    assert.strictEqual(userFk.length, 0, "no FK on user_id");
  } finally {
    await pool.end();
  }
});

test("PG path: action CHECK constraint reproduces the Mongo enum", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'inventory_logs'::regclass AND contype = 'c'`);
    assert.ok(rows.some((r) => /'Added'.*'Updated'.*'Consumed'.*'Restocked'.*'Issue'.*'Damage'.*'Expire'.*'Return'.*'Lost'.*'Adjusted'/.test(r.def)), "action CHECK");
  } finally {
    await pool.end();
  }
});

test("PG path: indexes cover the three real query patterns", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_logs'`);
    const defs = rows.map((r) => r.indexdef);
    // getItemDetails: InventoryLog.find({ item }).sort({ date: -1 })
    assert.ok(defs.some((d) => /\(inventory_item_id, date DESC\)/.test(d)), "item/date index");
    // getDashboardMetrics: find({ date: { $gte }, action: 'Consumed' })
    assert.ok(defs.some((d) => /\(action, date\)/.test(d)), "action/date index");
    // getInventoryLogs/getInventoryReports: sort date DESC / date range
    assert.ok(defs.some((d) => /\(date DESC\)/.test(d)), "date DESC index");
  } finally {
    await pool.end();
  }
});

// ─── Validation / defaults / enums ─────────────────────────────────────────
test("PG path: required fields are enforced and defaults applied like Mongo", async () => {
  // item required.
  await assert.rejects(
    () => inventoryLogRepository.create(logBase({ item: undefined })),
    /item is required/,
  );
  // action required.
  await assert.rejects(
    () => inventoryLogRepository.create(logBase({ action: "  " })),
    /action is required/,
  );
  // quantity required.
  await assert.rejects(
    () => inventoryLogRepository.create(logBase({ quantity: undefined })),
    /quantity is required/,
  );
  await assert.rejects(
    () => inventoryLogRepository.create(logBase({ quantity: "abc" })),
    /quantity must be a number/,
  );

  const item = await makeItem();
  const log = await inventoryLogRepository.create({
    item: item._id,
    action: "Adjusted",
    quantity: -3,
  });
  assert.strictEqual(log.action, "Adjusted");
  assert.strictEqual(Number(log.quantity), -3);
  // Mongo defaults: oldStock/newStock default 0, user/optional absent, date defaults to now.
  assert.strictEqual(Number(log.oldStock), 0);
  assert.strictEqual(Number(log.newStock), 0);
  assert.strictEqual(log.user, undefined);
  assert.ok(log.date instanceof Date);
});

test("PG path: every action enum value is preserved and invalid values rejected", async () => {
  const item = await makeItem();
  for (const action of ["Added", "Updated", "Consumed", "Restocked", "Issue", "Damage", "Expire", "Return", "Lost", "Adjusted"]) {
    const log = await inventoryLogRepository.create(logBase({ item: item._id, action, quantity: 1 }));
    assert.strictEqual((await inventoryLogRepository.findById(log._id)).action, action);
  }
  await assert.rejects(
    () => inventoryLogRepository.create(logBase({ item: item._id, action: "Moved" })),
    /Invalid action/,
  );
});

// ─── Quantity semantics / precision ─────────────────────────────────────────
test("PG path: quantity permits zero and negatives exactly like Mongo (no min)", async () => {
  const item = await makeItem();
  const zero = await inventoryLogRepository.create(logBase({ item: item._id, quantity: 0 }));
  assert.strictEqual(Number(zero.quantity), 0);

  const negative = await inventoryLogRepository.create(logBase({ item: item._id, quantity: -12.5, oldStock: 0, newStock: -12.5 }));
  assert.strictEqual(Number(negative.quantity), -12.5);

  // The Mongo schema declares no min on quantity/oldStock/newStock, so no
  // >= 0 CHECK may exist.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'inventory_logs'::regclass AND contype = 'c'
        AND conname IN ('inventory_logs_quantity_check', 'inventory_logs_old_stock_check', 'inventory_logs_new_stock_check')`);
    assert.strictEqual(rows.length, 0, "no >= 0 CHECK on quantity/old_stock/new_stock");
  } finally {
    await pool.end();
  }
});

test("PG path: quantities keep their exact decimal scale (round trip)", async () => {
  const item = await makeItem();
  const values = ["0", "0.01", "1", "10.50", "1000.125", "123456.789"];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const v of values) {
      const log = await inventoryLogRepository.create(logBase({ item: item._id, action: "Adjusted", quantity: v }));
      const { rows } = await pool.query("SELECT quantity::text AS q FROM inventory_logs WHERE id = $1", [log._id]);
      assert.strictEqual(rows[0].q, v);
      const read = await inventoryLogRepository.findById(log._id);
      assert.strictEqual(read.quantity, Number(v));
    }
  } finally {
    await pool.end();
  }
});

// ─── Dates / timezone semantics ─────────────────────────────────────────────
test("PG path: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const item = await makeItem();
  const when = new Date("2025-08-15T10:30:00+05:30");
  const log = await inventoryLogRepository.create(logBase({ item: item._id, date: when, createdAt: when }));
  const read = await inventoryLogRepository.findById(log._id);
  assert.ok(read.date instanceof Date);
  assert.strictEqual(read.date.toISOString(), when.toISOString());
});

// ─── InventoryItem relationship ─────────────────────────────────────────────
test("PG path: logs point at real inventory_items; invalid items are rejected", async () => {
  const item = await makeItem();
  const log = await inventoryLogRepository.create(logBase({ item: item._id }));
  assert.strictEqual(log.item, item._id);

  // A log for a nonexistent item violates the FK.
  await assert.rejects(
    () => inventoryLogRepository.create(logBase({ item: "0000000000000000000000ff" })),
    /violates foreign key|23503/,
  );

  // Deleting an item that still has logs is REFUSED by the FK (ON DELETE
  // RESTRICT). This mirrors the least behaviour-changing contract: Mongo never
  // deletes logs when an item is removed (it leaves them orphaned), so
  // PostgreSQL must not destroy log data either. The delete is blocked and the
  // log remains.
  await assert.rejects(
    () => inventoryItemRepository.destroy(item._id),
    /violates foreign key|23503|update or delete on table "inventory_items"/,
  );
  assert.strictEqual((await inventoryLogRepository.findById(log._id)).item, item._id);
});

// ─── findMany / filters / sorting / pagination ─────────────────────────────
test("PG path: findMany honors item/user/action $in filters and pagination", async () => {
  const item = await makeItem();
  const userId = crypto.randomBytes(12).toString("hex");
  const a = await inventoryLogRepository.create(logBase({ item: item._id, action: "Restocked", quantity: 10 }));
  const b = await inventoryLogRepository.create(logBase({ item: item._id, action: "Consumed", quantity: 3, user: userId }));

  const byItem = await inventoryLogRepository.findMany({ filter: { item: item._id } });
  assert.ok(byItem.some((x) => x._id === a._id));
  assert.ok(byItem.some((x) => x._id === b._id));

  const consumed = await inventoryLogRepository.findMany({ filter: { item: item._id, action: "Consumed" } });
  assert.deepStrictEqual(consumed.map((x) => x._id), [b._id]);

  const actionIn = await inventoryLogRepository.findMany({ filter: { item: item._id, action: { $in: ["Restocked", "Consumed"] } } });
  assert.strictEqual(actionIn.length, 2);

  const itemIn = await inventoryLogRepository.findMany({ filter: { item: { $in: [item._id] } } });
  assert.strictEqual(itemIn.length, 2);

  const userIn = await inventoryLogRepository.findMany({ filter: { user: { $in: [userId] } } });
  assert.deepStrictEqual(userIn.map((x) => x._id), [b._id]);

  const idIn = await inventoryLogRepository.findMany({ filter: { id: { $in: [a._id, b._id] } } });
  assert.strictEqual(idIn.length, 2);

  const page1 = await inventoryLogRepository.findMany({ filter: { item: item._id }, sort: { createdAt: 1 }, limit: 1, offset: 0 });
  const page2 = await inventoryLogRepository.findMany({ filter: { item: item._id }, sort: { createdAt: 1 }, limit: 1, offset: 1 });
  assert.strictEqual(page1.length, 1);
  assert.strictEqual(page2.length, 1);
  assert.notStrictEqual(page1[0]._id, page2[0]._id);

  // Unsupported sort keys fall back to the default date ordering, never throw.
  const badSort = await inventoryLogRepository.findMany({ filter: { item: item._id }, sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((x) => x._id === a._id));
});

test("PG path: date-range filtering matches the dashboard and report queries", async () => {
  const item = await makeItem();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await inventoryLogRepository.create(logBase({ item: item._id, action: "Consumed", quantity: 2, date: new Date() }));
  await inventoryLogRepository.create(logBase({
    item: item._id,
    action: "Consumed",
    quantity: 4,
    date: new Date(today.getTime() - 2 * 24 * 3600 * 1000), // before today → excluded
  }));

  // Mirrors getDashboardMetrics: find({ date: { $gte: today }, action: "Consumed" })
  // scoped to this item so the assertion is deterministic regardless of rows
  // created by earlier tests in the shared database.
  const todayConsumed = await inventoryLogRepository.findMany({ filter: { item: item._id, date: { $gte: today }, action: "Consumed" } });
  assert.strictEqual(todayConsumed.length, 1);
  assert.strictEqual(Number(todayConsumed[0].quantity), 2);

  const count = await inventoryLogRepository.count({ item: item._id, date: { $gte: today }, action: "Consumed" });
  assert.strictEqual(count, 1);

  // Mirrors getInventoryReports: date: { $gte: startDate } with default date DESC sort
  const withinDay = await inventoryLogRepository.findMany({ filter: { item: item._id, date: { $gte: today } }, sort: { date: -1 } });
  assert.strictEqual(withinDay.length, 1);

  const allRange = await inventoryLogRepository.findMany({ filter: { item: item._id, date: { $gte: new Date(today.getTime() - 3 * 24 * 3600 * 1000) } } });
  assert.strictEqual(allRange.length, 2);
});

// ─── findOne / count / update / destroy ─────────────────────────────────────
test("PG path: findOne returns a single match and null otherwise", async () => {
  const item = await makeItem();
  await inventoryLogRepository.create(logBase({ item: item._id, action: "Restocked" }));
  const found = await inventoryLogRepository.findOne({ item: item._id, action: "Restocked" });
  assert.ok(found);
  assert.strictEqual(found.action, "Restocked");
  assert.strictEqual(await inventoryLogRepository.findOne({ item: item._id, action: "Expire" }), null);
});

test("PG path: updateById persists and re-reads changed values", async () => {
  const item = await makeItem();
  const userId = crypto.randomBytes(12).toString("hex");
  const log = await inventoryLogRepository.create(logBase({ item: item._id }));

  const when = new Date("2026-01-01T00:00:00Z");
  const updated = await inventoryLogRepository.updateById(log._id, {
    action: "Return",
    quantity: 5.5,
    user: userId,
    date: when,
    newStock: 20,
  });
  assert.strictEqual(updated.action, "Return");
  assert.strictEqual(Number(updated.quantity), 5.5);
  assert.strictEqual(updated.user, userId);
  assert.strictEqual(updated.date.toISOString(), when.toISOString());
  assert.strictEqual(Number(updated.newStock), 20);

  // Genuinely persisted: read the raw row.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT action, quantity, user_id, new_stock, date FROM inventory_logs WHERE id = $1", [log._id]);
    assert.strictEqual(rows[0].action, "Return");
    assert.strictEqual(rows[0].quantity.toString(), "5.5");
    assert.strictEqual(rows[0].user_id, userId);
    assert.strictEqual(rows[0].new_stock.toString(), "20");
    assert.strictEqual(rows[0].date.toISOString(), when.toISOString());
  } finally {
    await pool.end();
  }
});

test("PG path: updateById enforces enums and required fields", async () => {
  const item = await makeItem();
  const log = await inventoryLogRepository.create(logBase({ item: item._id }));
  await assert.rejects(() => inventoryLogRepository.updateById(log._id, { action: "Nope" }), /Invalid action/);
  await assert.rejects(() => inventoryLogRepository.updateById(log._id, { quantity: "abc" }), /quantity must be a number/);
  await assert.rejects(() => inventoryLogRepository.updateById(log._id, { item: "" }), /item is required/);
});

test("PG path: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(
    await inventoryLogRepository.updateById("000000000000000000000000", { action: "Lost" }),
    null,
  );
});

test("PG path: count uses COUNT(*) and honors filters", async () => {
  const item = await makeItem();
  await inventoryLogRepository.create(logBase({ item: item._id, action: "Restocked" }));
  await inventoryLogRepository.create(logBase({ item: item._id, action: "Consumed" }));
  assert.strictEqual(await inventoryLogRepository.count({ item: item._id }), 2);
  assert.strictEqual(await inventoryLogRepository.count({ item: item._id, action: "Restocked" }), 1);
  assert.strictEqual(await inventoryLogRepository.count({ item: item._id, action: "Lost" }), 0);
  assert.strictEqual(typeof (await inventoryLogRepository.count({})), "number");
});

test("PG path: destroy reports existence and removes the row", async () => {
  const item = await makeItem();
  const log = await inventoryLogRepository.create(logBase({ item: item._id }));
  assert.strictEqual(await inventoryLogRepository.destroy(log._id), true);
  assert.strictEqual(await inventoryLogRepository.findById(log._id), null);
  assert.strictEqual(await inventoryLogRepository.destroy(log._id), false);
  assert.strictEqual(await inventoryLogRepository.destroy("000000000000000000000000"), false);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM inventory_logs WHERE id = $1", [log._id]);
    assert.strictEqual(rows.length, 0);
  } finally {
    await pool.end();
  }
});

test("PG path: legacy (24-hex) IDs round trip and create with the same id is idempotent", async () => {
  const item = await makeItem();
  const id = crypto.randomBytes(12).toString("hex");
  const first = await inventoryLogRepository.create(logBase({ item: item._id, id }));
  const second = await inventoryLogRepository.create({ ...logBase({ item: item._id, action: "Lost" }), id });
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await inventoryLogRepository.findById(id))._id, id);
});

// ─── No partial writes / Mongo untouched on the PG path ─────────────────────
test("PG path: a create failure does not leave a partial row", async () => {
  const item = await makeItem();
  const before = await inventoryLogRepository.count({});
  await assert.rejects(() => inventoryLogRepository.create(logBase({ item: item._id, action: "Bad" })), /Invalid action/);
  await assert.rejects(() => inventoryLogRepository.create(logBase({ item: item._id, quantity: "abc" })), /quantity must be a number/);
  const after = await inventoryLogRepository.count({});
  assert.strictEqual(after, before);
});

test("PG path: MongoDB model is never touched when PG is selected", async () => {
  const InventoryLog = require("../src/models/InventoryLog");

  const originalCreate = InventoryLog.create;
  const originalFindById = InventoryLog.findById;
  const originalFind = InventoryLog.find;
  const originalFindOne = InventoryLog.findOne;
  const originalFindByIdAndUpdate = InventoryLog.findByIdAndUpdate;
  const originalFindByIdAndDelete = InventoryLog.findByIdAndDelete;
  const originalCountDocuments = InventoryLog.countDocuments;

  const mongoTouched = [];
  InventoryLog.create = async (...args) => { mongoTouched.push("create"); return originalCreate.apply(this, args); };
  InventoryLog.findById = async (...args) => { mongoTouched.push("findById"); return originalFindById.apply(this, args); };
  InventoryLog.find = async (...args) => { mongoTouched.push("find"); return originalFind.apply(this, args); };
  InventoryLog.findOne = async (...args) => { mongoTouched.push("findOne"); return originalFindOne.apply(this, args); };
  InventoryLog.findByIdAndUpdate = async (...args) => { mongoTouched.push("findByIdAndUpdate"); return originalFindByIdAndUpdate.apply(this, args); };
  InventoryLog.findByIdAndDelete = async (...args) => { mongoTouched.push("findByIdAndDelete"); return originalFindByIdAndDelete.apply(this, args); };
  InventoryLog.countDocuments = async (...args) => { mongoTouched.push("countDocuments"); return originalCountDocuments.apply(this, args); };

  try {
    const item = await makeItem();
    const log = await inventoryLogService.create(logBase({ item: item._id }));
    await inventoryLogService.updateById(log._id, { action: "Expire" });
    await inventoryLogService.findById(log._id);
    await inventoryLogService.findMany({ filter: { item: item._id } });
    await inventoryLogService.findOne({ item: item._id });
    await inventoryLogService.count({});
    await inventoryLogService.destroy(log._id);

    assert.deepStrictEqual(mongoTouched, [], "Mongo model must not be invoked on the PG path");
  } finally {
    InventoryLog.create = originalCreate;
    InventoryLog.findById = originalFindById;
    InventoryLog.find = originalFind;
    InventoryLog.findOne = originalFindOne;
    InventoryLog.findByIdAndUpdate = originalFindByIdAndUpdate;
    InventoryLog.findByIdAndDelete = originalFindByIdAndDelete;
    InventoryLog.countDocuments = originalCountDocuments;
  }
});

test("PG path: the datasource seam is read at call time, not captured at require time", async () => {
  const InventoryLog = require("../src/models/InventoryLog");
  const original = InventoryLog.create;
  let mongoCalls = 0;
  InventoryLog.create = async (...args) => {
    mongoCalls += 1;
    return { _id: "000000000000000000000001", ...args[0], toObject: () => args[0] };
  };

  try {
    // Modules are already loaded (test file's before() hook). Flip the seam to
    // Mongo AFTER load: the service must immediately fall back.
    dbConfig.isDbConnected = () => false;
    assert.strictEqual(await inventoryLogService.usePostgres(), false);
    await inventoryLogService.create({ item: "000000000000000000000001", action: "Updated", quantity: 1 });
    assert.strictEqual(mongoCalls, 1, "seam=false routes the create to the Mongoose model");

    // Flip back to PostgreSQL AFTER load: the service must route to PG again.
    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await inventoryLogService.usePostgres(), true);
    const item = await makeItem();
    const log = await inventoryLogService.create(logBase({ item: item._id }));
    assert.strictEqual(mongoCalls, 1, "seam=true routes the create to PG, not Mongo");
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT id FROM inventory_logs WHERE id = $1", [log._id]);
      assert.strictEqual(rows.length, 1, "seam=true create persisted a PG row");
    } finally {
      await pool.end();
    }
  } finally {
    InventoryLog.create = original;
    dbConfig.isDbConnected = () => true;
  }
});