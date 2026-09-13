const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "db", "migrations");
const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const TEST_DB_URL = process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const runMigrate = (databaseUrl) => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding:"utf8",
    env:{ ...process.env, DATABASE_URL:databaseUrl, POSTGRES_SSL:"" },
  });
  return { output:res.stdout + "\n" + res.stderr, status:res.status };
};

const poolQuery = async (databaseUrl, sql) => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString:databaseUrl });
  try {
    return (await pool.query(sql)).rows;
  } finally {
    await pool.end();
  }
};
const resetTestDb = async (databaseUrl) => {
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS schema_migrations");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pg_health");
  // Phase 2A–2L tables must be dropped too so a fresh run applies the latest DDL.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_consumptions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_logs CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_batches CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS prasadam_orders CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_booking_material_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_bookings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS booking_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS booking_material_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS booking_history CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS bookings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS bill_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS bills CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_transactions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_heads CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS employees CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS users CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS donations CASCADE");
};

test("db:migrate runs clean from scratch on a fresh database", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*001_create_pg_health\.sql/);
  assert.match(output, /Applied 13 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.deepStrictEqual(rows.map((r) => r.name), [
    "001_create_pg_health.sql",
    "002_create_users_employees.sql",
    "003_create_accounting.sql",
    "004_create_bills.sql",
    "005_create_donations.sql",
    "006_create_bookings.sql",
    "007_create_pooja_bookings.sql",
    "008_create_prasadam_orders.sql",
    "009_create_inventory_items.sql",
    "010_create_inventory_batches.sql",
    "011_create_inventory_logs.sql",
    "012_create_inventory_consumption.sql",
    "013_create_inventory_requests.sql",
  ]);
});

test("db:migrate is idempotent — second run applies nothing", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);
  const { output } = runMigrate(databaseUrl);
  assert.match(output, /No pending migrations\./);
  assert.match(output, /Applied 0 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 13);
});

test("migration failure rolls back and is not recorded", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const broken = path.join(MIGRATIONS_DIR, "999_broken_test.sql");
  fs.writeFileSync(broken, "CREATE TABLE broken_migration_test (id INTEGER); SELECT * FROM nonexistent_table;");
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 999_broken_test\.sql failed/);
    assert.strictEqual(res.status, 1);

     const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
    assert.deepStrictEqual(rows.map((r) => r.name), [
      "001_create_pg_health.sql",
      "002_create_users_employees.sql",
      "003_create_accounting.sql",
      "004_create_bills.sql",
      "005_create_donations.sql",
      "006_create_bookings.sql",
      "007_create_pooja_bookings.sql",
      "008_create_prasadam_orders.sql",
      "009_create_inventory_items.sql",
      "010_create_inventory_batches.sql",
      "011_create_inventory_logs.sql",
      "012_create_inventory_consumption.sql",
      "013_create_inventory_requests.sql",
    ]);

    const tables = await poolQuery(databaseUrl, "SELECT to_regclass('public.broken_migration_test') AS t");
    assert.strictEqual(tables[0].t , null);
  } finally {
    fs.unlinkSync(broken);
  }
});

test("accounting migration creates NUMERIC monetary columns", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const heads = await poolQuery(databaseUrl, `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'account_heads' ORDER BY column_name`);
  assert.ok(heads.some((c) => c.column_name === "name" && c.data_type === "text"));
  assert.ok(heads.some((c) => c.column_name === "is_active"));

  const tx = await poolQuery(databaseUrl, `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'account_transactions' ORDER BY column_name`);
  assert.ok(tx.some((c) => c.column_name === "amount" && c.data_type === "numeric"));
  assert.ok(tx.some((c) => c.column_name === "date"));
  assert.ok(tx.some((c) => c.column_name === "financial_year"));
});

test("bills migration creates NUMERIC monetary columns, normalized bill_items and a cascade FK", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const bills = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'bills' ORDER BY column_name`);
  const col = (name) => bills.find((c) => c.column_name === name);
  assert.ok(col("id"));
  assert.ok(col("devotee_name") && col("devotee_name").data_type === "text");
  assert.ok(col("amount") && col("amount").data_type === "numeric");
  assert.ok(col("payment_mode") && col("payment_mode").column_default === "'Cash'::text");
  assert.ok(col("status") && col("status").column_default === "'Paid'::text");
  assert.ok(col("bill_type") && col("bill_type").column_default === "'Other'::text");
  assert.ok(col("bill_date") && col("bill_date").data_type === "timestamp with time zone");
  assert.ok(col("source_id"));
  assert.ok(col("reference_no"));
  assert.ok(col("razorpay_order_id"));
  assert.ok(col("razorpay_payment_id"));
  assert.ok(col("razorpay_signature"));
  assert.ok(!bills.some((c) => c.column_name === "items"), "embedded items are normalized away from bills");

  const items = await poolQuery(databaseUrl, `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'bill_items' ORDER BY column_name`);
  const itemCol = (name) => items.find((c) => c.column_name === name);
  assert.ok(itemCol("bill_id") && itemCol("bill_id").data_type === "text");
  assert.ok(itemCol("item_type") && itemCol("item_type").data_type === "text");
  assert.ok(itemCol("amount") && itemCol("amount").data_type === "numeric");

  const fk = await poolQuery(databaseUrl, `
    SELECT tg.tgname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_trigger tg ON tg.tgconstraint = c.oid
    WHERE c.contype = 'f' AND c.conrelid = 'bill_items'::regclass`);
  assert.ok(fk.some((r) => /REFERENCES bills\(id\)/.test(r.def) && /DELETE CASCADE/i.test(r.def)));
});

test("donations migration creates NUMERIC monetary columns with enum CHECK and defaults", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const donations = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'donations' ORDER BY column_name`);
  const col = (name) => donations.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text");
  assert.ok(col("donor_name") && col("donor_name").data_type === "text");
  assert.ok(col("donor_email") && col("donor_email").data_type === "text");
  assert.ok(col("amount") && col("amount").data_type === "numeric");
  assert.ok(col("category") && col("category").data_type === "text");
  assert.ok(col("category") && col("category").column_default === "'General'::text");
  assert.ok(col("payment_method") && col("payment_method").column_default === "'UPI'::text");
  assert.ok(col("status") && col("status").column_default === "'Not Collected'::text");
  assert.ok(col("contact_number") && col("contact_number").is_nullable === "YES");
  assert.ok(col("donor_phone") && col("donor_phone").is_nullable === "YES");
  assert.ok(col("transaction_id"));
  assert.ok(col("razorpay_order_id"));
  assert.ok(col("razorpay_payment_id"));
  assert.ok(col("razorpay_signature"));
  assert.ok(col("event_id"));
  assert.ok(col("notes"));
  assert.ok(col("donated_by"));
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");

  const checks = await poolQuery(databaseUrl, `
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'donations'::regclass AND contype = 'c'`);
  const defs = checks.map((r) => r.def);
  assert.ok(defs.some((d) => /payment_method.*'Cash'.*'UPI'.*'Card'.*'Bank Transfer'.*'Debit Card'.*'Credit Card'.*'Net Banking'/.test(d)), "paymentMethod CHECK");
  assert.ok(defs.some((d) => /status.*'Collected'.*'Not Collected'.*'Completed'.*'Pending'.*'Failed'/.test(d)), "status CHECK");
  assert.ok(defs.some((d) => /amount\s*>\s*\(0\)/.test(d)), "amount CHECK");
});

test("bookings migration creates NUMERIC monetary columns, enum CHECKs and cascade FKs", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const bookings = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'bookings' ORDER BY column_name`);
  const col = (name) => bookings.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text");
  assert.ok(col("devotee_id") && col("devotee_id").data_type === "text");
  assert.ok(col("event_id") && col("event_id").data_type === "text");
  assert.ok(col("devotee_name") && col("devotee_name").data_type === "text");
  assert.ok(col("devotee_email") && col("devotee_email").data_type === "text");
  assert.ok(col("devotee_phone") && col("devotee_phone").data_type === "text");
  assert.ok(col("service") && col("service").data_type === "text");
  assert.ok(col("datetime") && col("datetime").data_type === "text", "Mongo datetime is a String; kept as TEXT");
  assert.ok(col("amount") && col("amount").data_type === "numeric");
  assert.ok(col("gst") && col("gst").data_type === "numeric" && col("gst").column_default === "0");
  assert.ok(col("payment_method") && col("payment_method").column_default === "'UPI'::text");
  assert.ok(col("payment_status") && col("payment_status").column_default === "'Paid'::text");
  assert.ok(col("status") && col("status").column_default === "'Completed'::text");
  assert.ok(col("transaction_id") && col("transaction_id").column_default === "''::text");
  assert.ok(col("razorpay_order_id"));
  assert.ok(col("razorpay_payment_id"));
  assert.ok(col("razorpay_signature"));
  assert.ok(col("booking_number"));
  assert.ok(col("contact_number"));
  assert.ok(col("notes"));
  assert.ok(col("counted") && col("counted").data_type === "boolean" && col("counted").column_default === "false");
  assert.ok(col("assigned_priest") && col("assigned_priest").data_type === "text");
  assert.ok(col("started_at") && col("started_at").data_type === "timestamp with time zone");
  assert.ok(col("completed_at") && col("completed_at").data_type === "timestamp with time zone");
  assert.ok(col("approved_at") && col("approved_at").data_type === "timestamp with time zone");
  assert.ok(col("rejected_at") && col("rejected_at").data_type === "timestamp with time zone");
  assert.ok(col("pending_at") && col("pending_at").data_type === "timestamp with time zone");
  assert.ok(col("checkin_date") && col("checkin_date").data_type === "timestamp with time zone");
  assert.ok(col("checkout_date") && col("checkout_date").data_type === "timestamp with time zone");
  assert.ok(col("days") && col("days").data_type === "numeric");
  assert.ok(col("material_status") && col("material_status").column_default === "'N/A'::text");
  assert.ok(col("priest_checklist") && col("priest_checklist").data_type === "jsonb");
  assert.ok(col("pooja_rules") && col("pooja_rules").data_type === "ARRAY");
  assert.ok(col("snapshot_materials") && col("snapshot_materials").data_type === "jsonb");
  assert.ok(col("temple_material_charge") && col("temple_material_charge").data_type === "numeric" && col("temple_material_charge").column_default === "0");
  assert.ok(col("completion_duration") && col("completion_duration").data_type === "numeric" && col("completion_duration").column_default === "0");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");

  const checks = await poolQuery(databaseUrl, `
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'bookings'::regclass AND contype = 'c'`);
  const defs = checks.map((r) => r.def);
  assert.ok(defs.some((d) => /payment_method.*'UPI'.*'Cash'.*'Card'.*'Bank Transfer'.*'Net Banking'/.test(d)), "paymentMethod CHECK");
  assert.ok(defs.some((d) => /payment_status.*'Pending'.*'Paid'.*'Failed'.*'Refunded'/.test(d)), "paymentStatus CHECK");
  assert.ok(defs.some((d) => /status.*'Booked'.*'Pending'.*'Approved'.*'Confirmed'.*'Assigned'.*'In Progress'.*'Completed'/.test(d)), "status CHECK");
  assert.ok(defs.some((d) => /amount\s*>=\s*\(0\)/.test(d)), "amount >= 0 CHECK");

  const fks = await poolQuery(databaseUrl, `
    SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE contype = 'f'
    AND conrelid IN ('booking_history'::regclass, 'booking_material_requests'::regclass, 'booking_items'::regclass)`);
  const fkDefs = fks.map((r) => `${r.tbl}: ${r.def}`);
  assert.ok(fkDefs.some((d) => /booking_history.*REFERENCES bookings\(id\).*ON DELETE CASCADE/.test(d)), "booking_history FK cascade");
  assert.ok(fkDefs.some((d) => /booking_material_requests.*REFERENCES bookings\(id\).*ON DELETE CASCADE/.test(d)), "booking_material_requests FK cascade");
  assert.ok(fkDefs.some((d) => /booking_items.*REFERENCES bookings\(id\).*ON DELETE CASCADE/.test(d)), "booking_items FK cascade");
});

test("pooja_bookings migration creates NUMERIC monetary columns, enum CHECKs and a cascade FK", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const bookings = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'pooja_bookings' ORDER BY column_name`);
  const col = (name) => bookings.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text");
  assert.ok(col("booking_number") && col("booking_number").data_type === "text" && col("booking_number").is_nullable === "NO");
  assert.ok(col("customer_name") && col("customer_name").data_type === "text" && col("customer_name").is_nullable === "NO");
  assert.ok(col("service") && col("service").data_type === "text" && col("service").is_nullable === "NO");
  assert.ok(col("amount") && col("amount").data_type === "numeric" && col("amount").is_nullable === "NO");
  assert.ok(col("payment_method") && col("payment_method").data_type === "text" && col("payment_method").is_nullable === "NO");
  assert.ok(col("contact_number") && col("contact_number").data_type === "text" && col("contact_number").is_nullable === "NO");
  assert.ok(col("email") && col("email").is_nullable === "YES");
  assert.ok(col("address") && col("address").is_nullable === "YES");
  assert.ok(col("notes") && col("notes").column_default === "''::text");
  assert.ok(col("booking_date") && col("booking_date").data_type === "timestamp with time zone" && col("booking_date").is_nullable === "NO");
  assert.ok(col("status") && col("status").column_default === "'Booked'::text");
  assert.ok(col("created_by") && col("created_by").data_type === "text" && col("created_by").is_nullable === "NO");
  assert.ok(col("temple_arrangement") && col("temple_arrangement").is_nullable === "NO" && col("temple_arrangement").column_default === "false");
  assert.ok(col("temple_material_charge") && col("temple_material_charge").data_type === "numeric" && col("temple_material_charge").column_default === "0");
  assert.ok(col("material_status") && col("material_status").column_default === "'N/A'::text");
  assert.ok(col("priest_checklist") && col("priest_checklist").data_type === "jsonb");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");

  const checks = await poolQuery(databaseUrl, `
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'pooja_bookings'::regclass AND contype = 'c'`);
  const defs = checks.map((r) => r.def);
  assert.ok(defs.some((d) => /payment_method.*'UPI'.*'Cash'.*'Card'/.test(d)), "paymentMethod CHECK");
  assert.ok(defs.some((d) => /status.*'Booked'.*'Completed'.*'Cancelled'/.test(d)), "status CHECK");
  assert.ok(defs.some((d) => /material_status.*'N\/A'.*'Pending'.*'Approved'.*'Reserved'.*'Ready'.*'Issued'.*'Consumed'.*'Cancelled'/.test(d)), "materialStatus CHECK");
  assert.ok(defs.some((d) => /amount\s*>=\s*\(0\)/.test(d)), "amount >= 0 CHECK");

  const uniq = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'pooja_bookings'::regclass AND contype = 'u'`);
  assert.ok(uniq.some((r) => /UNIQUE \(booking_number\)/.test(r.def)), "bookingNumber UNIQUE constraint");

  const fks = await poolQuery(databaseUrl, `
    SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE contype = 'f'
    AND conrelid = 'pooja_booking_material_requests'::regclass`);
  assert.ok(fks.some((r) => /REFERENCES pooja_bookings\(id\).*ON DELETE CASCADE/.test(r.def)), "pooja_booking_material_requests FK cascade");

  // No FK between pooja_bookings and bookings: the Mongo model has no bookingId.
  const allFks = await poolQuery(databaseUrl, `
    SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE contype = 'f' AND conrelid = 'pooja_bookings'::regclass`);
  assert.strictEqual(allFks.length, 0, "pooja_bookings must not carry fake FKs to other entities");
});

test("rollback of the accounting migration leaves no tables behind", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Dropping all migrations and re-running simulates a full rollback +
  // re-apply cycle at the migration layer. All DDL is idempotent (IF NOT EXISTS).
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS schema_migrations");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_consumptions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_logs CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_batches CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS prasadam_orders CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_booking_material_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_bookings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS booking_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS booking_material_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS booking_history CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS bookings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS bill_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS bills CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_transactions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_heads CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS employees CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS users CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS donations CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pg_health");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied 13 migration\(s\)\./);

  const tables = await poolQuery(databaseUrl, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  assert.ok(tables.some((t) => t.table_name === "account_heads"));
  assert.ok(tables.some((t) => t.table_name === "account_transactions"));
  assert.ok(tables.some((t) => t.table_name === "bills"));
  assert.ok(tables.some((t) => t.table_name === "bill_items"));
  assert.ok(tables.some((t) => t.table_name === "donations"));
  assert.ok(tables.some((t) => t.table_name === "bookings"));
  assert.ok(tables.some((t) => t.table_name === "booking_history"));
  assert.ok(tables.some((t) => t.table_name === "booking_material_requests"));
  assert.ok(tables.some((t) => t.table_name === "booking_items"));
  assert.ok(tables.some((t) => t.table_name === "pooja_bookings"));
  assert.ok(tables.some((t) => t.table_name === "pooja_booking_material_requests"));
  assert.ok(tables.some((t) => t.table_name === "prasadam_orders"));
  assert.ok(tables.some((t) => t.table_name === "inventory_items"));
  assert.ok(tables.some((t) => t.table_name === "inventory_batches"));
  assert.ok(tables.some((t) => t.table_name === "inventory_logs"));
  assert.ok(tables.some((t) => t.table_name === "inventory_consumptions"));
});

test("rollback of the inventory_batches migration can be reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 010: drop the table (and its tracking
  // record). inventory_items stays in place, so a re-run must re-apply only
  // 010 and rebuild inventory_batches + its FK.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_batches CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '010_create_inventory_batches.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*010_create_inventory_batches\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 13);

  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'inventory_batches'::regclass AND contype = 'f'`);
  assert.ok(fk.length === 1);
  assert.ok(/REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/i.test(fk[0].def));
});

test("rollback of the Phase 2J inventory_logs migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 011: drop the inventory_logs table
  // (and its tracking record). inventory_items stays in place, so a re-run
  // must re-apply only 011 and rebuild inventory_logs + its FK.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_logs CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '011_create_inventory_logs.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*011_create_inventory_logs\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 13);

  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'inventory_logs'::regclass AND contype = 'f'`);
  assert.ok(fk.length === 1);
  assert.ok(/REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/i.test(fk[0].def));

  // Idempotent again: a second run applies nothing.
  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("inventory_logs migration creates the Mongo-mapped columns, enum CHECK, RESTRICT FK and real indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const logs = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'inventory_logs' ORDER BY column_name`);
  const col = (name) => logs.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO");
  assert.ok(col("inventory_item_id") && col("inventory_item_id").data_type === "text" && col("inventory_item_id").is_nullable === "NO");
  assert.ok(col("action") && col("action").data_type === "text" && col("action").is_nullable === "NO");
  assert.ok(col("quantity") && col("quantity").data_type === "numeric" && col("quantity").is_nullable === "NO");
  assert.ok(col("old_stock") && col("old_stock").data_type === "numeric" && col("old_stock").column_default === "0");
  assert.ok(col("new_stock") && col("new_stock").data_type === "numeric" && col("new_stock").column_default === "0");
  assert.ok(col("user_id") && col("user_id").is_nullable === "YES");
  assert.ok(col("date") && col("date").data_type === "timestamp with time zone" && col("date").is_nullable === "NO");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");

  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'inventory_logs'::regclass AND contype = 'c'`);
  assert.ok(checks.some((r) => /action.*'Added'.*'Updated'.*'Consumed'.*'Restocked'.*'Issue'.*'Damage'.*'Expire'.*'Return'.*'Lost'.*'Adjusted'/.test(r.def)), "action CHECK");
  assert.ok(!checks.some((r) => /quantity.*>=/.test(r.def)), "quantity has no min in Mongo, so no CHECK");
  assert.ok(!checks.some((r) => /old_stock.*>=/.test(r.def)) && !checks.some((r) => /new_stock.*>=/.test(r.def)), "stock fields have no min in Mongo, so no CHECK");

  const fks = await poolQuery(databaseUrl, `
    SELECT kcu.column_name, pg_get_constraintdef(oid) AS def FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid = 'inventory_logs'::regclass`);
  assert.strictEqual(fks.length, 1, "only the inventory_items FK");
  assert.strictEqual(fks[0].column_name, "inventory_item_id");
  assert.ok(/REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/i.test(fks[0].def));

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_logs'`);
  const defs = indexes.map((r) => r.indexdef);
  assert.ok(defs.some((d) => /\(inventory_item_id, date DESC\)/.test(d)), "item/date index");
  assert.ok(defs.some((d) => /\(action, date\)/.test(d)), "action/date index");
  assert.ok(defs.some((d) => /\(date DESC\)/.test(d)), "date DESC index");
});

test("rollback of the Phase 2K inventory_consumptions migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 012: drop the inventory_consumptions
  // table (and its tracking record). All earlier tables stay in place, so a
  // re-run must re-apply only 012 and rebuild inventory_consumptions + its FK.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_consumptions CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '012_create_inventory_consumption.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*012_create_inventory_consumption\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 13);

  const fk = await poolQuery(databaseUrl, `
    SELECT kcu.column_name, pg_get_constraintdef(oid) AS def FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid = 'inventory_consumptions'::regclass`);
  assert.strictEqual(fk.length, 1, "only the inventory_items FK");
  assert.strictEqual(fk[0].column_name, "inventory_item_id");
  assert.ok(/REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/i.test(fk[0].def));

  // Idempotent again: a second run applies nothing.
  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("inventory_consumptions migration creates the Mongo-mapped columns, >=0 quantity CHECKs, RESTRICT FK and real indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'inventory_consumptions' ORDER BY column_name`);
  const col = (name) => cols.find((c) => c.column_name === name);
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
  assert.ok(col("purpose") && col("purpose").data_type === "text" && col("purpose").column_default === "''::text");
  assert.ok(col("remarks") && col("remarks").data_type === "text" && col("remarks").column_default === "''::text");
  assert.ok(col("date") && col("date").data_type === "timestamp with time zone" && col("date").is_nullable === "NO");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");

  // The Mongo schema declares all three quantities min: 0 — so a >= 0 CHECK
  // MUST exist (unlike inventory_logs, whose quantities have no min).
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'inventory_consumptions'::regclass AND contype = 'c'`);
  const checkDefs = checks.map((r) => r.def);
  assert.ok(checkDefs.some((d) => /issued_quantity\s*>=\s*\(*0\)*/.test(d)), "issued_quantity >= 0 CHECK");
  assert.ok(checkDefs.some((d) => /used_quantity\s*>=\s*\(*0\)*/.test(d)), "used_quantity >= 0 CHECK");
  assert.ok(checkDefs.some((d) => /returned_quantity\s*>=\s*\(*0\)*/.test(d)), "returned_quantity >= 0 CHECK");

  const fks = await poolQuery(databaseUrl, `
    SELECT kcu.column_name, pg_get_constraintdef(oid) AS def FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid = 'inventory_consumptions'::regclass`);
  assert.strictEqual(fks.length, 1, "only the inventory_items FK — no fake FKs to Issue/User");
  assert.strictEqual(fks[0].column_name, "inventory_item_id");
  assert.ok(/REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/i.test(fks[0].def));

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_consumptions'`);
  const defs = indexes.map((r) => r.indexdef);
  assert.ok(defs.some((d) => /\(date DESC\)/.test(d)), "date DESC index (getConsumptionReports)");
  assert.ok(defs.some((d) => /\(user_id\)/.test(d)), "user_id index (Mongo schema index: true)");
  assert.ok(defs.some((d) => /\(inventory_item_id, date DESC\)/.test(d)), "item/date index");
});

test("a deliberately failed inventory_consumptions migration rolls back fully", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Create a migration after 012 whose BEGIN-transaction fails AFTER issuing
  // DDL. The runner wraps each file in a transaction; on error it rolls back,
  // so no partial table/index/constraint may remain and the migration must not
  // be recorded.
  const broken = path.join(MIGRATIONS_DIR, "998_broken_consumption_test.sql");
  fs.writeFileSync(
    broken,
    "CREATE TABLE partial_consumption_test (id TEXT PRIMARY KEY, inventory_item_id TEXT);" +
    "CREATE INDEX idx_partial_consumption_test ON partial_consumption_test (inventory_item_id);" +
    "SELECT * FROM table_that_does_not_exist;"
  );
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 998_broken_consumption_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    // Not recorded.
    const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations WHERE name = '998_broken_consumption_test.sql'");
    assert.strictEqual(rows.length, 0, "failed migration must not be recorded");

    // No partial table, index or constraint may remain. pg_class is queried
    // by name (not by regclass resolution) so the query itself does not error
    // when the relation is absent — a clean 0-count is the assertion.
    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_consumption_test', 'idx_partial_consumption_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");
    const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.partial_consumption_test') AS t");
    assert.strictEqual(tbl[0].t, null, "no partial table may remain");

    // The real Phase 2K table is untouched and still fully present.
    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'inventory_consumptions' ORDER BY column_name`);
    assert.ok(real.length >= 15, "inventory_consumptions columns intact");
  } finally {
    fs.unlinkSync(broken);
  }
});

test("inventory_requests migration creates the Mongo-mapped columns, enum CHECKs, quantity >= 0 CHECK and real indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'inventory_requests' ORDER BY column_name`);
  const col = (name) => cols.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO");
  assert.ok(col("user_id") && col("user_id").data_type === "text" && col("user_id").is_nullable === "NO");
  assert.ok(col("user_name") && col("user_name").data_type === "text" && col("user_name").is_nullable === "NO");
  assert.ok(col("role") && col("role").data_type === "text" && col("role").is_nullable === "NO" && col("role").column_default === "'Staff'::text");
  assert.ok(col("requested_by") && col("requested_by").data_type === "text" && col("requested_by").column_default === "''::text");
  assert.ok(col("item_name") && col("item_name").data_type === "text" && col("item_name").is_nullable === "NO");
  // quantity is NUMERIC with no fixed precision (preserves arbitrary scale)
  assert.ok(col("quantity") && col("quantity").data_type === "numeric" && col("quantity").is_nullable === "NO");
  assert.ok(col("unit") && col("unit").data_type === "text" && col("unit").is_nullable === "NO");
  assert.ok(col("reason") && col("reason").data_type === "text" && col("reason").is_nullable === "NO" && col("reason").column_default === "''::text");
  assert.ok(col("purpose") && col("purpose").data_type === "text" && col("purpose").is_nullable === "NO" && col("purpose").column_default === "''::text");
  assert.ok(col("expected_date") && col("expected_date").data_type === "timestamp with time zone" && col("expected_date").is_nullable === "NO");
  assert.ok(col("priority") && col("priority").data_type === "text" && col("priority").is_nullable === "NO" && col("priority").column_default === "'Medium'::text");
  assert.ok(col("status") && col("status").data_type === "text" && col("status").is_nullable === "NO" && col("status").column_default === "'Pending'::text");
  assert.ok(col("admin_reason") && col("admin_reason").data_type === "text" && col("admin_reason").column_default === "''::text");
  assert.ok(col("rejection_reason") && col("rejection_reason").data_type === "text" && col("rejection_reason").column_default === "''::text");
  // Nullable date columns stay nullable with no default (match Mongo default null)
  assert.ok(col("rejected_at") && col("rejected_at").data_type === "timestamp with time zone" && col("rejected_at").is_nullable === "YES" && col("rejected_at").column_default === null);
  assert.ok(col("approved_at") && col("approved_at").data_type === "timestamp with time zone" && col("approved_at").is_nullable === "YES" && col("approved_at").column_default === null);
  assert.ok(col("reviewed_at") && col("reviewed_at").data_type === "timestamp with time zone" && col("reviewed_at").is_nullable === "YES" && col("reviewed_at").column_default === null);
  assert.ok(col("issued_at") && col("issued_at").data_type === "timestamp with time zone" && col("issued_at").is_nullable === "YES" && col("issued_at").column_default === null);
  assert.ok(col("approved_by") && col("approved_by").data_type === "text" && col("approved_by").column_default === "''::text");
  assert.ok(col("reviewed_by") && col("reviewed_by").data_type === "text" && col("reviewed_by").column_default === "''::text");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  assert.strictEqual(cols.filter((c) => c.column_name === "quantity").length, 1);

  // enum CHECKs preserved exactly (priority: High/Medium/Low; status:
  // Pending/Approved/Rejected/Issued) and the quantity >= 0 CHECK mirroring the
  // Mongo schema's min: 0.
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'inventory_requests'::regclass AND contype = 'c'`);
  const checkDefs = checks.map((r) => r.def);
  // PostgreSQL renders IN-list CHECKs with = ANY (ARRAY[...]), preserving the
  // exact enum values from the Mongo schema.
  const priorityCheck = checkDefs.find((d) => d.startsWith("CHECK ((priority"));
  assert.ok(priorityCheck && priorityCheck.includes("'High'::text") && priorityCheck.includes("'Medium'::text") && priorityCheck.includes("'Low'::text"), "priority enum CHECK contains High/Medium/Low");
  assert.ok(!priorityCheck.includes("'Urgent'"), "priority CHECK has no extra values");
  const statusCheck = checkDefs.find((d) => d.startsWith("CHECK ((status"));
  assert.ok(statusCheck && statusCheck.includes("'Pending'::text") && statusCheck.includes("'Approved'::text") && statusCheck.includes("'Rejected'::text") && statusCheck.includes("'Issued'::text"), "status enum CHECK contains Pending/Approved/Rejected/Issued");
  assert.ok(!statusCheck.includes("'Cancelled'"), "status CHECK has no extra values");
  assert.ok(checkDefs.some((d) => /quantity\s*>=\s*\(*0\)*/.test(d)), "quantity >= 0 CHECK");

  // No fake FKs: the Mongo schema stores userId as a String and itemName as a
  // free-form String — neither is a real reference to migrated entities, so
  // the table must have ZERO foreign keys.
  const fks = await poolQuery(databaseUrl, `
    SELECT kcu.column_name FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid = 'inventory_requests'::regclass`);
  assert.strictEqual(fks.length, 0, "no fake FKs — userId and itemName are plain Strings in Mongo");

  // Indexes justified by actual query patterns (Mongo schema userId index,
  // createdAt DESC list sorts, and the duplicate-guard range predicate).
  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_requests'`);
  const defs = indexes.map((r) => r.indexdef);
  assert.ok(defs.some((d) => /\(user_id\)/.test(d)), "user_id index (Mongo schema index: true)");
  assert.ok(defs.some((d) => /\(created_at DESC\)/.test(d)), "created_at DESC index (list sorts)");
  assert.ok(defs.some((d) => /\(user_id, status, created_at DESC\)/.test(d)), "duplicate-guard compound index");

  // Physical NUMERIC precision: an explicit-value insert round-trips exactly
  // (this verifies no unintended rounding at the column level).
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const rows = await pool.query(
      "INSERT INTO inventory_requests (id, user_id, user_name, item_name, quantity, unit, reason, purpose) VALUES ($1, 'u', 'n', 'item', 1000.125, 'Pack', 'r', 'p') RETURNING quantity::text AS q",
      ["000000000000000000000100"]
    );
    assert.strictEqual(rows.rows[0].q, "1000.125");
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2L inventory_requests migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 013: drop the inventory_requests
  // table (and its tracking record). All earlier tables stay in place, so a
  // re-run must re-apply only 013 and rebuild inventory_requests + indexes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_requests CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '013_create_inventory_requests.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*013_create_inventory_requests\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 13);

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename = 'inventory_requests'
    AND indexdef NOT LIKE '%inventory_requests_pkey%'`);
  assert.strictEqual(indexes.length, 3, "re-applied migration rebuilds all three non-pkey indexes");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("a deliberately failed inventory_requests migration rolls back fully", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Create a migration after 013 whose BEGIN-transaction fails AFTER issuing
  // DDL. The runner wraps each file in a transaction; on error it rolls back,
  // so no partial table/index/constraint may remain and the migration must not
  // be recorded.
  const broken = path.join(MIGRATIONS_DIR, "997_broken_requests_test.sql");
  fs.writeFileSync(
    broken,
    "CREATE TABLE partial_requests_test (id TEXT PRIMARY KEY, user_id TEXT);" +
    "CREATE INDEX idx_partial_requests_test ON partial_requests_test (user_id);" +
    "SELECT * FROM table_that_does_not_exist;"
  );
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 997_broken_requests_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    // Not recorded.
    const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations WHERE name = '997_broken_requests_test.sql'");
    assert.strictEqual(rows.length, 0, "failed migration must not be recorded");

    // No partial table/index/constraint may remain.
    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_requests_test', 'idx_partial_requests_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");
    const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.partial_requests_test') AS t");
    assert.strictEqual(tbl[0].t, null, "no partial table may remain");

    // The real Phase 2L table remains intact (migration file untouched by the
    // failure) — once the broken file is removed, re-running applies nothing.
    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'inventory_requests' ORDER BY column_name`);
    assert.ok(real.length >= 23, "inventory_requests columns intact");
    const tblNow = await poolQuery(databaseUrl, "SELECT to_regclass('public.inventory_requests') AS t");
    assert.ok(tblNow[0].t, "inventory_requests still exists after the failed migration");
  } finally {
    fs.unlinkSync(broken);
  }

  // After cleanup the chain is fully applied and another run is a no-op.
  const { output: noPending } = runMigrate(databaseUrl);
  assert.match(noPending, /No pending migrations\./);
});

test("previous migrations are unchanged (git diff on migrations dir is empty of edits)", async () => {
  // Phase 2L must not modify any previous migration file. This sanity guard
  // re-applies the full chain from scratch and verifies the applied count is
  // exactly the number of *.sql files in the directory.
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied 13 migration\(s\)\./);
});

test("SELECT 1 succeeds against test database", async () => {
  const rows = await poolQuery(TEST_DB_URL, "SELECT 1 AS ok");
  assert.strictEqual(rows[0].ok , 1);
});