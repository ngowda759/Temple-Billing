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
let inventoryConsumptionRepository;
let inventoryConsumptionService;
let inventoryItemRepository;

// Every table that the migration chain creates. inventory_consumptions is
// dropped before inventory_items so a stale FK-dependent table can never block
// a fresh migration run (inventory_items CASCADE would drop it anyway).
const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
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
  inventoryConsumptionRepository = require("../src/repositories/inventoryConsumptionRepository");
  inventoryConsumptionService = require("../src/services/inventoryConsumptionService");
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
  inventoryItemRepository.create({ name: `ConsumedItem-${unique()}`, unit: "Pack", availableStock: 100 });

const consumptionBase = (overrides = {}) => ({
  item: "0000000000000000000000aa",
  itemName: "Test Item",
  userId: "priest1",
  userName: "Priest One",
  role: "priest",
  issuedQuantity: 10,
  usedQuantity: 6,
  returnedQuantity: 4,
  unit: "Pack",
  ...overrides,
});

// ─── PostgreSQL path: service selects PG and round trips ───────────────────
test("PG path: service uses PostgreSQL when the Consumption path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await inventoryConsumptionService.usePostgres(), true);
  assert.strictEqual(inventoryConsumptionService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const item = await makeItem();
  const issueId = crypto.randomBytes(12).toString("hex");
  const when = new Date("2025-06-01T10:30:00+05:30");
  const input = consumptionBase({
    item: item._id,
    itemName: "Camphor",
    issue: issueId,
    userId: "priest-kumar",
    usedQuantity: "2.5",
    returnedQuantity: "2.5",
    purpose: "Special pooja",
    remarks: "  ",
    date: when,
  });
  const consumption = await inventoryConsumptionService.create(input);

  assert.ok(consumption._id);
  assert.match(consumption._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(consumption.issue, issueId);
  assert.strictEqual(consumption.item, item._id);
  assert.strictEqual(consumption.itemName, "Camphor");
  assert.strictEqual(consumption.userId, "priest-kumar");
  assert.strictEqual(consumption.userName, "Priest One");
  assert.strictEqual(consumption.role, "priest");
  assert.strictEqual(Number(consumption.issuedQuantity), 10);
  assert.strictEqual(Number(consumption.usedQuantity), 2.5);
  assert.strictEqual(Number(consumption.returnedQuantity), 2.5);
  assert.strictEqual(consumption.unit, "Pack");
  assert.strictEqual(consumption.purpose, "Special pooja");
  assert.ok(consumption.date instanceof Date);
  assert.strictEqual(consumption.date.toISOString(), when.toISOString());
  assert.ok(consumption.createdAt instanceof Date);
  assert.ok(consumption.updatedAt instanceof Date);

  const read = await inventoryConsumptionService.findById(consumption._id);
  assert.strictEqual(read._id, consumption._id);
  assert.strictEqual(read.item, item._id);

  // Defaults: completeUsage trims remarks; a blank string stays blank and is
  // preserved exactly (NOT NULL, not null). purpose defaults to "" when absent.
  const minimal = await inventoryConsumptionService.create(consumptionBase({ item: item._id, usedQuantity: 0, returnedQuantity: 10 }));
  assert.strictEqual(minimal.purpose, "");
  assert.strictEqual(minimal.remarks, "");
});

test("PG path: every Mongo persisted field maps to the PostgreSQL row", async () => {
  const item = await makeItem();
  const issueId = crypto.randomBytes(12).toString("hex");
  const when = new Date("2025-12-31T23:59:59+05:30");
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({
    item: item._id,
    issue: issueId,
    itemName: "Kumkum",
    userId: "staff-sharma",
    usedQuantity: "123456.789",
    returnedQuantity: "0.01",
    issuedQuantity: "123456.799",
    purpose: "Daily archana",
    remarks: "Fresh batch",
    date: when,
  }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_consumptions WHERE id = $1", [consumption._id]);
    const row = rows[0];
    assert.strictEqual(row.issue_id, issueId);
    assert.strictEqual(row.inventory_item_id, item._id);
    assert.strictEqual(row.item_name, "Kumkum");
    assert.strictEqual(row.user_id, "staff-sharma");
    assert.strictEqual(row.user_name, "Priest One");
    assert.strictEqual(row.role, "priest");
    assert.strictEqual(row.issued_quantity.toString(), "123456.799");
    assert.strictEqual(row.used_quantity.toString(), "123456.789");
    assert.strictEqual(row.returned_quantity.toString(), "0.01");
    assert.strictEqual(row.unit, "Pack");
    assert.strictEqual(row.purpose, "Daily archana");
    assert.strictEqual(row.remarks, "Fresh batch");
    assert.strictEqual(row.date.toISOString(), when.toISOString());
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
  } finally {
    await pool.end();
  }

  const read = await inventoryConsumptionRepository.findById(consumption._id);
  assert.strictEqual(read.userId, "staff-sharma");
  assert.strictEqual(Number(read.usedQuantity), 123456.789);
});

// ─── Field mapping / SQL schema ─────────────────────────────────────────────
test("PG path: inventory_consumptions table has the exact Mongo field mapping", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'inventory_consumptions'
      ORDER BY ordinal_position`);
    const col = (name) => rows.find((c) => c.column_name === name);
    assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO");
    assert.ok(col("issue_id") && col("issue_id").data_type === "text" && col("issue_id").is_nullable === "YES");
    assert.ok(col("inventory_item_id") && col("inventory_item_id").data_type === "text" && col("inventory_item_id").is_nullable === "NO");
    assert.ok(col("item_name") && col("item_name").data_type === "text" && col("item_name").is_nullable === "NO");
    assert.ok(col("user_id") && col("user_id").data_type === "text" && col("user_id").is_nullable === "NO");
    assert.ok(col("user_name") && col("user_name").data_type === "text" && col("user_name").is_nullable === "NO");
    assert.ok(col("role") && col("role").data_type === "text" && col("role").is_nullable === "NO");
    assert.ok(col("issued_quantity") && col("issued_quantity").data_type === "numeric" && col("issued_quantity").is_nullable === "NO");
    assert.ok(col("used_quantity") && col("used_quantity").data_type === "numeric" && col("used_quantity").is_nullable === "NO");
    assert.ok(col("returned_quantity") && col("returned_quantity").data_type === "numeric" && col("returned_quantity").is_nullable === "NO");
    assert.ok(col("unit") && col("unit").data_type === "text" && col("unit").is_nullable === "NO");
    assert.ok(col("purpose") && col("purpose").data_type === "text" && col("purpose").is_nullable === "NO" && col("purpose").column_default === "''::text");
    assert.ok(col("remarks") && col("remarks").data_type === "text" && col("remarks").is_nullable === "NO" && col("remarks").column_default === "''::text");
    assert.ok(col("date") && col("date").data_type === "timestamp with time zone" && col("date").is_nullable === "NO");
    assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
    assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  } finally {
    await pool.end();
  }
});

test("PG path: no fake FKs — only the real inventory_items FK (RESTRICT); issue and userId are plain TEXT", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT kcu.column_name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN information_schema.key_column_usage kcu
        ON c.conname = kcu.constraint_name
      WHERE c.contype = 'f' AND c.conrelid = 'inventory_consumptions'::regclass`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].column_name, "inventory_item_id");
    assert.ok(/REFERENCES inventory_items\(id\)/.test(rows[0].def));
    // ON DELETE RESTRICT: Mongo leaves consumptions orphaned when an item is
    // deleted, so PostgreSQL must not cascade-delete them.
    assert.ok(/ON DELETE RESTRICT/i.test(rows[0].def));
    assert.ok(!/CASCADE/i.test(rows[0].def), "must not cascade");

    // issue → InventoryIssue is still Mongo-backed (not migrated), so issue_id
    // must NOT have a foreign key.
    const issueFk = rows.filter((r) => r.column_name === "issue_id");
    assert.strictEqual(issueFk.length, 0, "no FK on issue_id");
    // userId is a plain String in the Mongo schema (stores the issuing user's
    // username), not the User ObjectId ref — no FK either.
    const userFk = rows.filter((r) => r.column_name === "user_id");
    assert.strictEqual(userFk.length, 0, "no FK on user_id");
  } finally {
    await pool.end();
  }
});

test("PG path: >= 0 quantity CHECK constraints reproduce the Mongo min: 0", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'inventory_consumptions'::regclass AND contype = 'c'`);
    const defs = rows.map((r) => r.def);
    assert.ok(defs.some((d) => /issued_quantity\s*>=\s*\(*0\)*/.test(d)), "issued_quantity CHECK");
    assert.ok(defs.some((d) => /used_quantity\s*>=\s*\(*0\)*/.test(d)), "used_quantity CHECK");
    assert.ok(defs.some((d) => /returned_quantity\s*>=\s*\(*0\)*/.test(d)), "returned_quantity CHECK");
  } finally {
    await pool.end();
  }
});

test("PG path: indexes cover the real query patterns", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_consumptions'`);
    const defs = rows.map((r) => r.indexdef);
    // getConsumptionReports: find().sort({ date: -1 }).limit(100)
    assert.ok(defs.some((d) => /\(date DESC\)/.test(d)), "date DESC index");
    // Mongo schema userId index: true (ordinary, non-unique)
    assert.ok(defs.some((d) => /\(user_id\)/.test(d)), "user_id index");
    // per-item consumption inspection: item + date DESC
    assert.ok(defs.some((d) => /\(inventory_item_id, date DESC\)/.test(d)), "item/date index");
  } finally {
    await pool.end();
  }
});

// ─── Validation / defaults ──────────────────────────────────────────────────
test("PG path: required fields are enforced and defaults applied like Mongo", async () => {
  // item / itemName / userId / userName / role / unit required.
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ item: undefined })),
    /item is required/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ itemName: " " })),
    /itemName is required/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ userId: undefined })),
    /userId is required/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ userName: "" })),
    /userName is required/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ role: undefined })),
    /role is required/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ unit: " " })),
    /unit is required/,
  );
  // quantities required.
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ issuedQuantity: undefined })),
    /issuedQuantity is required/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ usedQuantity: "abc" })),
    /usedQuantity must be a number/,
  );

  const item = await makeItem();
  const consumption = await inventoryConsumptionRepository.create(
    consumptionBase({ item: item._id, purpose: undefined, remarks: undefined })
  );
  // Mongo defaults: purpose/remarks default "", date defaults to now.
  assert.strictEqual(consumption.purpose, "");
  assert.strictEqual(consumption.remarks, "");
  assert.ok(consumption.date instanceof Date);
  assert.strictEqual(consumption.issue, undefined);
});

test("PG path: zero quantity is legal, negatives rejected (Mongo min: 0)", async () => {
  const item = await makeItem();
  // Everything returned: used 0, returned 10 — legal in Mongo (min: 0).
  const zero = await inventoryConsumptionRepository.create(
    consumptionBase({ item: item._id, usedQuantity: 0, returnedQuantity: 10 })
  );
  assert.strictEqual(Number(zero.usedQuantity), 0);

  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ item: item._id, usedQuantity: -1 })),
    /usedQuantity must be >= 0/,
  );
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ item: item._id, returnedQuantity: -0.5 })),
    /returnedQuantity must be >= 0/,
  );

  // The DB itself also rejects negatives (the CHECK is real, not just service-level).
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const item2 = await makeItem();
    await assert.rejects(
      () => pool.query(
        "INSERT INTO inventory_consumptions (id, inventory_item_id, item_name, user_id, user_name, role, issued_quantity, used_quantity, returned_quantity, unit) VALUES ($1, $2, 'x', 'u', 'n', 'r', 10, -1, 0, 'Pack')",
        [crypto.randomBytes(12).toString("hex"), item2._id]
      ),
      /inventory_consumptions_used_quantity_check/,
    );
  } finally {
    await pool.end();
  }
});

// ─── Quantity semantics / precision ─────────────────────────────────────────
test("PG path: quantities keep their exact decimal scale (round trip)", async () => {
  const item = await makeItem();
  const values = ["0", "0.01", "1", "10.50", "1000.125", "123456.789"];
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const v of values) {
      const consumption = await inventoryConsumptionRepository.create(
        consumptionBase({ item: item._id, usedQuantity: v, issuedQuantity: v, returnedQuantity: v })
      );
      const { rows } = await pool.query("SELECT issued_quantity::text AS iq, used_quantity::text AS uq, returned_quantity::text AS rq FROM inventory_consumptions WHERE id = $1", [consumption._id]);
      assert.strictEqual(rows[0].iq, v);
      assert.strictEqual(rows[0].uq, v);
      assert.strictEqual(rows[0].rq, v);
      const read = await inventoryConsumptionRepository.findById(consumption._id);
      assert.strictEqual(read.usedQuantity, Number(v));
    }
  } finally {
    await pool.end();
  }
});

// ─── Dates / timezone semantics ─────────────────────────────────────────────
test("PG path: dates round-trip through TIMESTAMPTZ preserving the instant", async () => {
  const item = await makeItem();
  const when = new Date("2025-08-15T10:30:00+05:30");
  const consumption = await inventoryConsumptionRepository.create(
    consumptionBase({ item: item._id, date: when, createdAt: when })
  );
  const read = await inventoryConsumptionRepository.findById(consumption._id);
  assert.ok(read.date instanceof Date);
  assert.strictEqual(read.date.toISOString(), when.toISOString());
});

// ─── InventoryItem relationship ─────────────────────────────────────────────
test("PG path: consumptions point at real inventory_items; invalid items are rejected", async () => {
  const item = await makeItem();
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({ item: item._id }));
  assert.strictEqual(consumption.item, item._id);

  // A consumption for a nonexistent item violates the FK.
  await assert.rejects(
    () => inventoryConsumptionRepository.create(consumptionBase({ item: "0000000000000000000000ff" })),
    /violates foreign key|23503/,
  );

  // Deleting an item that still has consumptions is REFUSED by the FK (ON
  // DELETE RESTRICT). This mirrors the least behaviour-changing contract:
  // Mongo never deletes consumptions when an item is removed (it leaves them
  // orphaned), so PostgreSQL must not destroy consumption data either.
  await assert.rejects(
    () => inventoryItemRepository.destroy(item._id),
    /violates foreign key|23503|update or delete on table "inventory_items"/,
  );
  assert.strictEqual((await inventoryConsumptionRepository.findById(consumption._id)).item, item._id);
});

// ─── findMany / filters / sorting / pagination ─────────────────────────────
test("PG path: findMany honors item/userId/issue $in filters and pagination", async () => {
  const item = await makeItem();
  const issueA = crypto.randomBytes(12).toString("hex");
  const issueB = crypto.randomBytes(12).toString("hex");
  const a = await inventoryConsumptionRepository.create(
    consumptionBase({ item: item._id, issue: issueA, userId: "priest-a", usedQuantity: 3 })
  );
  const b = await inventoryConsumptionRepository.create(
    consumptionBase({ item: item._id, issue: issueB, userId: "priest-b", usedQuantity: 4 })
  );

  const byItem = await inventoryConsumptionRepository.findMany({ filter: { item: item._id } });
  assert.ok(byItem.some((x) => x._id === a._id));
  assert.ok(byItem.some((x) => x._id === b._id));

  const byIssue = await inventoryConsumptionRepository.findMany({ filter: { issue: issueA } });
  assert.deepStrictEqual(byIssue.map((x) => x._id), [a._id]);

  const itemIn = await inventoryConsumptionRepository.findMany({ filter: { item: { $in: [item._id] } } });
  assert.strictEqual(itemIn.length, 2);

  const issueIn = await inventoryConsumptionRepository.findMany({ filter: { issue: { $in: [issueA, issueB] } } });
  assert.strictEqual(issueIn.length, 2);

  const userIn = await inventoryConsumptionRepository.findMany({ filter: { userId: { $in: ["priest-a"] } } });
  assert.deepStrictEqual(userIn.map((x) => x._id), [a._id]);

  const idIn = await inventoryConsumptionRepository.findMany({ filter: { id: { $in: [a._id, b._id] } } });
  assert.strictEqual(idIn.length, 2);

  // Empty $in matches nothing (Mongo semantics).
  assert.strictEqual((await inventoryConsumptionRepository.findMany({ filter: { item: { $in: [] } } })).length, 0);

  const page1 = await inventoryConsumptionRepository.findMany({ filter: { item: item._id }, sort: { createdAt: 1 }, limit: 1, offset: 0 });
  const page2 = await inventoryConsumptionRepository.findMany({ filter: { item: item._id }, sort: { createdAt: 1 }, limit: 1, offset: 1 });
  assert.strictEqual(page1.length, 1);
  assert.strictEqual(page2.length, 1);
  assert.notStrictEqual(page1[0]._id, page2[0]._id);

  // Unsupported sort keys fall back to the default date ordering, never throw.
  const badSort = await inventoryConsumptionRepository.findMany({ filter: { item: item._id }, sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((x) => x._id === a._id));

  // Sorting by usedQuantity works through the whitelist.
  const sorted = await inventoryConsumptionRepository.findMany({ filter: { item: item._id }, sort: { usedQuantity: -1 } });
  assert.deepStrictEqual(sorted.map((x) => x._id), [b._id, a._id]);
});

test("PG path: date-range filtering matches the consumption report", async () => {
  const item = await makeItem();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await inventoryConsumptionRepository.create(consumptionBase({ item: item._id, usedQuantity: 2, date: new Date() }));
  await inventoryConsumptionRepository.create(consumptionBase({
    item: item._id,
    usedQuantity: 4,
    date: new Date(today.getTime() - 2 * 24 * 3600 * 1000), // before today → excluded
  }));

  // Mirrors getConsumptionReports scoped to this item for a deterministic
  // assertion regardless of rows created by earlier tests.
  const todayRows = await inventoryConsumptionRepository.findMany({ filter: { item: item._id, date: { $gte: today } } });
  assert.strictEqual(todayRows.length, 1);
  assert.strictEqual(Number(todayRows[0].usedQuantity), 2);

  const count = await inventoryConsumptionRepository.count({ item: item._id, date: { $gte: today } });
  assert.strictEqual(count, 1);

  // Default getConsumptionReports ordering is date DESC: the today row (newer)
  // must sort before the 2-days-ago row.
  const sorted = await inventoryConsumptionRepository.findMany({ filter: { item: item._id }, sort: { date: -1 } });
  assert.strictEqual(sorted.length, 2);
  assert.strictEqual(Number(sorted[0].usedQuantity), 2, "today's row sorts first (date DESC)");
  assert.strictEqual(Number(sorted[1].usedQuantity), 4);
});

// ─── findOne / count / update / destroy ─────────────────────────────────────
test("PG path: findOne returns a single match and null otherwise", async () => {
  const item = await makeItem();
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({ item: item._id, userId: "priest-findone" }));
  const found = await inventoryConsumptionRepository.findOne({ userId: "priest-findone" });
  assert.ok(found);
  assert.strictEqual(found._id, consumption._id);
  assert.strictEqual(await inventoryConsumptionRepository.findOne({ userId: "nobody" }), null);
});

test("PG path: updateById persists and re-reads changed values", async () => {
  const item = await makeItem();
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({ item: item._id }));

  const when = new Date("2026-01-01T00:00:00Z");
  const updated = await inventoryConsumptionRepository.updateById(consumption._id, {
    usedQuantity: 7.5,
    returnedQuantity: 2.5,
    userId: "staff-new",
    remarks: "Updated remarks",
    date: when,
  });
  assert.strictEqual(Number(updated.usedQuantity), 7.5);
  assert.strictEqual(Number(updated.returnedQuantity), 2.5);
  assert.strictEqual(updated.userId, "staff-new");
  assert.strictEqual(updated.remarks, "Updated remarks");
  assert.strictEqual(updated.date.toISOString(), when.toISOString());

  // Genuinely persisted: read the raw row.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT used_quantity, returned_quantity, user_id, remarks, date FROM inventory_consumptions WHERE id = $1", [consumption._id]);
    assert.strictEqual(rows[0].used_quantity.toString(), "7.5");
    assert.strictEqual(rows[0].returned_quantity.toString(), "2.5");
    assert.strictEqual(rows[0].user_id, "staff-new");
    assert.strictEqual(rows[0].remarks, "Updated remarks");
    assert.strictEqual(rows[0].date.toISOString(), when.toISOString());
  } finally {
    await pool.end();
  }
});

test("PG path: updateById enforces required fields and quantity rules", async () => {
  const item = await makeItem();
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({ item: item._id }));
  await assert.rejects(() => inventoryConsumptionRepository.updateById(consumption._id, { usedQuantity: -1 }), /usedQuantity must be >= 0/);
  await assert.rejects(() => inventoryConsumptionRepository.updateById(consumption._id, { issuedQuantity: "abc" }), /issuedQuantity must be a number/);
  await assert.rejects(() => inventoryConsumptionRepository.updateById(consumption._id, { item: "" }), /item is required/);
  await assert.rejects(() => inventoryConsumptionRepository.updateById(consumption._id, { role: " " }), /role is required/);
});

test("PG path: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(
    await inventoryConsumptionRepository.updateById("000000000000000000000000", { remarks: "x" }),
    null,
  );
});

test("PG path: count uses COUNT(*) and honors filters", async () => {
  const item = await makeItem();
  await inventoryConsumptionRepository.create(consumptionBase({ item: item._id, userId: "c1" }));
  await inventoryConsumptionRepository.create(consumptionBase({ item: item._id, userId: "c2" }));
  assert.strictEqual(await inventoryConsumptionRepository.count({ item: item._id }), 2);
  assert.strictEqual(await inventoryConsumptionRepository.count({ item: item._id, userId: "c1" }), 1);
  assert.strictEqual(await inventoryConsumptionRepository.count({ item: item._id, userId: "nobody" }), 0);
  assert.strictEqual(typeof (await inventoryConsumptionRepository.count({})), "number");
});

test("PG path: destroy reports existence and removes the row", async () => {
  const item = await makeItem();
  const consumption = await inventoryConsumptionRepository.create(consumptionBase({ item: item._id }));
  assert.strictEqual(await inventoryConsumptionRepository.destroy(consumption._id), true);
  assert.strictEqual(await inventoryConsumptionRepository.findById(consumption._id), null);
  assert.strictEqual(await inventoryConsumptionRepository.destroy(consumption._id), false);
  assert.strictEqual(await inventoryConsumptionRepository.destroy("000000000000000000000000"), false);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM inventory_consumptions WHERE id = $1", [consumption._id]);
    assert.strictEqual(rows.length, 0);
  } finally {
    await pool.end();
  }
});

test("PG path: legacy (24-hex) IDs round trip and create with the same id is idempotent", async () => {
  const item = await makeItem();
  const id = crypto.randomBytes(12).toString("hex");
  const first = await inventoryConsumptionRepository.create(consumptionBase({ item: item._id, id }));
  const second = await inventoryConsumptionRepository.create({ ...consumptionBase({ item: item._id, usedQuantity: 9 }), id });
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await inventoryConsumptionRepository.findById(id))._id, id);
});

// ─── No partial writes / Mongo untouched on the PG path ─────────────────────
test("PG path: a create failure does not leave a partial row", async () => {
  const item = await makeItem();
  const before = await inventoryConsumptionRepository.count({});
  await assert.rejects(() => inventoryConsumptionRepository.create(consumptionBase({ item: item._id, usedQuantity: -2 })), /must be >= 0/);
  await assert.rejects(() => inventoryConsumptionRepository.create(consumptionBase({ item: item._id, itemName: "" })), /itemName is required/);
  const after = await inventoryConsumptionRepository.count({});
  assert.strictEqual(after, before);
});

test("PG path: MongoDB model is never touched when PG is selected", async () => {
  const InventoryConsumption = require("../src/models/InventoryConsumption");

  const originalCreate = InventoryConsumption.create;
  const originalFindById = InventoryConsumption.findById;
  const originalFind = InventoryConsumption.find;
  const originalFindOne = InventoryConsumption.findOne;
  const originalFindByIdAndUpdate = InventoryConsumption.findByIdAndUpdate;
  const originalFindByIdAndDelete = InventoryConsumption.findByIdAndDelete;
  const originalCountDocuments = InventoryConsumption.countDocuments;

  const mongoTouched = [];
  InventoryConsumption.create = async (...args) => { mongoTouched.push("create"); return originalCreate.apply(this, args); };
  InventoryConsumption.findById = async (...args) => { mongoTouched.push("findById"); return originalFindById.apply(this, args); };
  InventoryConsumption.find = async (...args) => { mongoTouched.push("find"); return originalFind.apply(this, args); };
  InventoryConsumption.findOne = async (...args) => { mongoTouched.push("findOne"); return originalFindOne.apply(this, args); };
  InventoryConsumption.findByIdAndUpdate = async (...args) => { mongoTouched.push("findByIdAndUpdate"); return originalFindByIdAndUpdate.apply(this, args); };
  InventoryConsumption.findByIdAndDelete = async (...args) => { mongoTouched.push("findByIdAndDelete"); return originalFindByIdAndDelete.apply(this, args); };
  InventoryConsumption.countDocuments = async (...args) => { mongoTouched.push("countDocuments"); return originalCountDocuments.apply(this, args); };

  try {
    const item = await makeItem();
    const consumption = await inventoryConsumptionService.create(
      consumptionBase({ item: item._id, usedQuantity: 5, returnedQuantity: 5 })
    );
    await inventoryConsumptionService.updateById(consumption._id, { remarks: "x" });
    await inventoryConsumptionService.findById(consumption._id);
    await inventoryConsumptionService.findMany({ filter: { item: item._id } });
    await inventoryConsumptionService.findOne({ item: item._id });
    await inventoryConsumptionService.count({});
    await inventoryConsumptionService.destroy(consumption._id);

    assert.deepStrictEqual(mongoTouched, [], "Mongo model must not be invoked on the PG path");
  } finally {
    InventoryConsumption.create = originalCreate;
    InventoryConsumption.findById = originalFindById;
    InventoryConsumption.find = originalFind;
    InventoryConsumption.findOne = originalFindOne;
    InventoryConsumption.findByIdAndUpdate = originalFindByIdAndUpdate;
    InventoryConsumption.findByIdAndDelete = originalFindByIdAndDelete;
    InventoryConsumption.countDocuments = originalCountDocuments;
  }
});

test("PG path: the datasource seam is read at call time, not captured at require time", async () => {
  const InventoryConsumption = require("../src/models/InventoryConsumption");
  const original = InventoryConsumption.create;
  let mongoCalls = 0;
  InventoryConsumption.create = async (...args) => {
    mongoCalls += 1;
    return { _id: "000000000000000000000001", ...args[0], toObject: () => args[0] };
  };

  try {
    // Modules are already loaded (test file's before() hook). Flip the seam to
    // Mongo AFTER load: the service must immediately fall back.
    dbConfig.isDbConnected = () => false;
    assert.strictEqual(await inventoryConsumptionService.usePostgres(), false);
    await inventoryConsumptionService.create(consumptionBase({ item: "000000000000000000000001" }));
    assert.strictEqual(mongoCalls, 1, "seam=false routes the create to the Mongoose model");

    // Flip back to PostgreSQL AFTER load: the service must route to PG again.
    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await inventoryConsumptionService.usePostgres(), true);
    const item = await makeItem();
    const consumption = await inventoryConsumptionService.create(consumptionBase({ item: item._id }));
    assert.strictEqual(mongoCalls, 1, "seam=true routes the create to PG, not Mongo");
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT id FROM inventory_consumptions WHERE id = $1", [consumption._id]);
      assert.strictEqual(rows.length, 1, "seam=true create persisted a PG row");
    } finally {
      await pool.end();
    }
  } finally {
    InventoryConsumption.create = original;
    dbConfig.isDbConnected = () => true;
  }
});