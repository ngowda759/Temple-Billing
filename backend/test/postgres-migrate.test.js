const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

// Parameterized variant used by the Phase 2W notification tests below, which
// need to pass values rather than interpolate them into the SQL text.
const pgQuery = async (databaseUrl, sql, params = []) => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return (await pool.query(sql, params)).rows;
  } finally {
    await pool.end();
  }
};
const resetTestDb = async (databaseUrl) => {
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS schema_migrations");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS priest_settings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS attendance_settings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pg_health");
  // Phase 2A–2X tables must be dropped too so a fresh run applies the latest DDL.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS audit_logs CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_material_requirement_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_material_requirements CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_required_materials CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS poojas CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS events CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS notifications CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS payroll_records CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS shifts CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS leaves CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS attendance CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS rooms CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS assets CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS damage_notes CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS purchase_order_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS purchase_orders CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_note_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_notes CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_consumptions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_logs CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_batches CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS prasadams CASCADE");
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
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_tickets CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS donations CASCADE");
};

test("db:migrate runs clean from scratch on a fresh database", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*001_create_pg_health\.sql/);
  assert.match(output, /Applied 29 migration\(s\)\./);

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
    "014_create_purchase_orders.sql",
    "015_create_goods_received_notes.sql",
    "016_create_damage_notes.sql",
    "017_create_assets.sql",
    "018_create_repairs.sql",
    "019_create_rooms.sql",
    "020_create_attendance.sql",
    "021_create_leaves.sql",
    "022_create_shifts.sql",
    "023_create_payroll_records.sql",
    "024_create_notifications.sql",
    "025_create_events.sql",
"026_create_poojas.sql",
    "027_create_prasadams.sql",
    "028_create_settings.sql",
    "029_create_audit_logs.sql",
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
  assert.strictEqual(rows.length, 29);
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
      "014_create_purchase_orders.sql",
      "015_create_goods_received_notes.sql",
      "016_create_damage_notes.sql",
      "017_create_assets.sql",
      "018_create_repairs.sql",
      "019_create_rooms.sql",
      "020_create_attendance.sql",
      "021_create_leaves.sql",
      "022_create_shifts.sql",
    "023_create_payroll_records.sql",
      "024_create_notifications.sql",
      "025_create_events.sql",
      "026_create_poojas.sql",
      "027_create_prasadams.sql",
    "028_create_settings.sql",
    "029_create_audit_logs.sql",
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
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS priest_settings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS attendance_settings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS purchase_order_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS purchase_orders CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_note_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_notes CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_consumptions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_logs CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_batches CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS inventory_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS prasadams CASCADE");
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
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_tickets CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_requests CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS donations CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pg_health");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied 29 migration\(s\)\./);

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
  assert.ok(tables.some((t) => t.table_name === "purchase_orders"));
  assert.ok(tables.some((t) => t.table_name === "purchase_order_items"));
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
  assert.strictEqual(rows.length, 29);

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
  assert.strictEqual(rows.length, 29);

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
  assert.strictEqual(rows.length, 29);

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
  assert.strictEqual(rows.length, 29);

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
  assert.match(output, /Applied 29 migration\(s\)\./);
});

test("Phase 2M purchase_orders migration creates the Mongo-mapped columns, enum CHECK, constraints and real FKs", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'purchase_orders' ORDER BY column_name`);
  const col = (name) => cols.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO", "id is TEXT PK");
  assert.ok(col("po_number") && col("po_number").data_type === "text" && col("po_number").is_nullable === "NO", "po_number NOT NULL");
  assert.ok(col("supplier") && col("supplier").data_type === "text" && col("supplier").is_nullable === "NO", "supplier NOT NULL");
  assert.ok(col("total_amount") && col("total_amount").data_type === "numeric" && col("total_amount").is_nullable === "NO", "total_amount NUMERIC NOT NULL");
  assert.ok(col("status") && col("status").data_type === "text" && col("status").column_default === "'Draft'::text", "status TEXT default 'Draft'");
  assert.ok(col("expected_delivery_date") && col("expected_delivery_date").data_type === "timestamp with time zone" && col("expected_delivery_date").is_nullable === "YES", "expected_delivery_date TIMESTAMPTZ nullable");
  assert.ok(col("notes") && col("notes").is_nullable === "YES", "notes nullable");
  assert.ok(col("created_by") && col("created_by").is_nullable === "YES", "created_by nullable");
  assert.ok(col("approved_by") && col("approved_by").is_nullable === "YES", "approved_by nullable");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone" && col("created_at").column_default === "now()", "created_at TIMESTAMPTZ default now()");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone", "updated_at TIMESTAMPTZ");

  const icols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'purchase_order_items' ORDER BY column_name`);
  const icol = (name) => icols.find((c) => c.column_name === name);
  assert.ok(icol("id") && icol("id").data_type === "text" && icol("id").is_nullable === "NO", "item id TEXT PK");
  assert.ok(icol("purchase_order_id") && icol("purchase_order_id").is_nullable === "NO", "purchase_order_id NOT NULL");
  assert.ok(icol("inventory_item_id") && icol("inventory_item_id").is_nullable === "NO", "inventory_item_id NOT NULL");
  assert.ok(icol("ordered_quantity") && icol("ordered_quantity").data_type === "numeric", "ordered_quantity NUMERIC");
  assert.ok(icol("unit_price") && icol("unit_price").data_type === "numeric", "unit_price NUMERIC");
  assert.ok(icol("total_price") && icol("total_price").data_type === "numeric", "total_price NUMERIC");
  assert.ok(icol("received_quantity") && icol("received_quantity").data_type === "numeric" && icol("received_quantity").column_default === "0", "received_quantity NUMERIC default 0");
  assert.ok(icol("position") && icol("position").data_type === "integer" && icol("position").column_default === "0", "position INT default 0");

  // Enum CHECK over the exact 8 Mongo status values.
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'purchase_orders'::regclass AND contype = 'c'`);
  const checkDefs = checks.map((r) => r.def);
  assert.ok(checkDefs.some((d) => /status.*'Draft'.*'Pending Approval'.*'Approved'.*'Sent'.*'Partially Received'.*'Received'.*'Cancelled'.*'Closed'/.test(d)), "status CHECK with exact 8 enum values");
  assert.ok(!checkDefs.some((d) => /'Ordered'/.test(d)), "no invented 'Ordered' status");

  const itemChecks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'purchase_order_items'::regclass AND contype = 'c'`);
  const itemCheckDefs = itemChecks.map((r) => r.def);
  assert.ok(itemCheckDefs.some((d) => /ordered_quantity\s*>=\s*\(*1\)*/.test(d)), "ordered_quantity >= 1 CHECK (Mongo min: 1)");
  assert.ok(itemCheckDefs.some((d) => /unit_price\s*>=\s*\(*0\)*/.test(d)), "unit_price >= 0 CHECK (Mongo min: 0)");
  assert.ok(itemCheckDefs.some((d) => /total_price\s*>=\s*\(*0\)*/.test(d)), "total_price >= 0 CHECK (Mongo min: 0)");
  assert.ok(itemCheckDefs.some((d) => /received_quantity\s*>=\s*\(*0\)*/.test(d)), "received_quantity >= 0 CHECK (Mongo min: 0)");

  // FKs: exactly two real ones — line → inventory_items RESTRICT and line →
  // purchase_orders CASCADE. No supplier/created_by/approved_by FKs.
  const fks = await poolQuery(databaseUrl, `
    SELECT kcu.column_name, pg_get_constraintdef(oid) AS def FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid IN ('purchase_orders'::regclass, 'purchase_order_items'::regclass)`);
  const fkColumns = fks.map((f) => f.column_name);
  assert.strictEqual(fks.length, 2, "exactly two real FKs");
  assert.ok(fkColumns.includes("purchase_order_id") && fkColumns.includes("inventory_item_id"));
  assert.ok(fks.some((f) => f.column_name === "purchase_order_id" && /REFERENCES purchase_orders\(id\).*ON DELETE CASCADE/.test(f.def)), "child FK CASCADE");
  assert.ok(fks.some((f) => f.column_name === "inventory_item_id" && /REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/.test(f.def)), "inventory item FK RESTRICT");

  // Unique po_number (Mongo unique: true).
  const uniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'purchase_orders'::regclass AND contype = 'u'`);
  assert.ok(uniques.some((r) => /UNIQUE \(po_number\)/.test(r.def)), "po_number unique constraint");

  // Indexes justified by real queries.
  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename IN ('purchase_orders', 'purchase_order_items')
    AND indexdef NOT LIKE '%pkey%' AND indexdef NOT LIKE '%po_number_key%'`);
  const defs = indexes.map((r) => r.indexdef);
  assert.ok(defs.some((d) => /\(status\)/.test(d)), "status index (status filtering)");
  assert.ok(defs.some((d) => /\(expected_delivery_date\)/.test(d)), "expected_delivery_date index (delivery lists)");
  assert.ok(defs.some((d) => /\(created_at DESC\)/.test(d)), "created_at DESC index (list sorts)");
  assert.ok(defs.some((d) => /\(purchase_order_id,\s*"?position"?\)/.test(d)), "purchase_order_id + position index (child load order)");
  assert.ok(defs.some((d) => /\(inventory_item_id\)/.test(d)), "inventory_item_id index (per-item history)");

  // Physical NUMERIC precision round-trips (Mongo money/quantity type parity).
  // The item insert needs a real inventory_items row for its FK.
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "INSERT INTO inventory_items (id, name, unit) VALUES ('000000000000000000000003', 'Mig-PO-Item', 'Pack')"
    );
    const r = await pool.query(
      "INSERT INTO purchase_orders (id, po_number, supplier, total_amount) VALUES ($1, 'N1', 's', 123456789.1234) RETURNING total_amount::text AS t",
      ["000000000000000000000001"]
    );
    assert.strictEqual(r.rows[0].t, "123456789.1234");
    const ir = await pool.query(
      "INSERT INTO purchase_order_items (id, purchase_order_id, inventory_item_id, ordered_quantity, unit_price, total_price) VALUES ($1, $2, $3, 10.5, 1000.99, 10510.395) RETURNING ordered_quantity::text AS q, unit_price::text AS u, total_price::text AS t",
      ["000000000000000000000002", "000000000000000000000001", "000000000000000000000003"]
    );
    assert.strictEqual(ir.rows[0].q, "10.5");
    assert.strictEqual(ir.rows[0].u, "1000.99");
    assert.strictEqual(ir.rows[0].t, "10510.395");
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2M purchase_orders migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 014: drop both PO tables (and the
  // tracking record). All earlier tables stay in place, so a re-run must
  // re-apply only 014 and rebuild purchase_orders + purchase_order_items.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS purchase_order_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS purchase_orders CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_note_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_notes CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '014_create_purchase_orders.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*014_create_purchase_orders\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'purchase_order_items'::regclass AND contype = 'f'`);
  assert.strictEqual(fk.length, 2, "re-applied migration rebuilds both FKs");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("a deliberately failed Phase 2M purchase_orders migration rolls back fully", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const broken = path.join(MIGRATIONS_DIR, "996_broken_purchase_orders_test.sql");
  fs.writeFileSync(
    broken,
    "CREATE TABLE partial_purchase_orders_test (id TEXT PRIMARY KEY, po_number TEXT);" +
    "CREATE INDEX idx_partial_purchase_orders_test ON partial_purchase_orders_test (po_number);" +
    "SELECT * FROM table_that_does_not_exist;"
  );
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 996_broken_purchase_orders_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations WHERE name = '996_broken_purchase_orders_test.sql'");
    assert.strictEqual(rows.length, 0, "failed migration must not be recorded");

    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_purchase_orders_test', 'idx_partial_purchase_orders_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");
    const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.partial_purchase_orders_test') AS t");
    assert.strictEqual(tbl[0].t, null, "no partial table may remain");

    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'purchase_orders' ORDER BY column_name`);
    assert.strictEqual(real.length, 11, "purchase_orders columns intact after failure");
    const tblNow = await poolQuery(databaseUrl, "SELECT to_regclass('public.purchase_orders') AS t");
    assert.ok(tblNow[0].t, "purchase_orders still exists after the failed migration");
  } finally {
    fs.unlinkSync(broken);
  }

  const { output: noPending } = runMigrate(databaseUrl);
  assert.match(noPending, /No pending migrations\./);
});
test("Phase 2N goods_received_notes migration creates Mongo-mapped columns, enum CHECK, constraints and real FKs", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'goods_received_notes' ORDER BY column_name`);
  const col = (name) => cols.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text" && col("id").is_nullable === "NO", "id is TEXT PK");
  assert.ok(col("grn_number") && col("grn_number").data_type === "text" && col("grn_number").is_nullable === "NO", "grn_number NOT NULL");
  assert.ok(col("purchase_order_id") && col("purchase_order_id").is_nullable === "YES", "purchase_order_id nullable");
  assert.ok(col("supplier") && col("supplier").data_type === "text" && col("supplier").is_nullable === "NO", "supplier NOT NULL");
  assert.ok(col("supplier_invoice_number") && col("supplier_invoice_number").is_nullable === "YES", "supplier_invoice_number nullable");
  assert.ok(col("supplier_invoice_date") && col("supplier_invoice_date").data_type === "timestamp with time zone" && col("supplier_invoice_date").is_nullable === "YES", "supplier_invoice_date TIMESTAMPTZ nullable");
  assert.ok(col("total_amount") && col("total_amount").data_type === "numeric" && col("total_amount").is_nullable === "NO", "total_amount NUMERIC NOT NULL");
  assert.ok(col("status") && col("status").data_type === "text" && col("status").column_default === "'Draft'::text", "status TEXT default 'Draft'");
  assert.ok(col("received_by") && col("received_by").is_nullable === "YES", "received_by nullable");
  assert.ok(col("approved_by") && col("approved_by").is_nullable === "YES", "approved_by nullable");
  assert.ok(col("notes") && col("notes").is_nullable === "YES", "notes nullable");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone" && col("created_at").column_default === "now()", "created_at TIMESTAMPTZ default now()");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone", "updated_at TIMESTAMPTZ");

  const icols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'goods_received_note_items' ORDER BY column_name`);
  const icol = (name) => icols.find((c) => c.column_name === name);
  assert.ok(icol("id") && icol("id").data_type === "text" && icol("id").is_nullable === "NO", "item id TEXT PK");
  assert.ok(icol("grn_id") && icol("grn_id").is_nullable === "NO", "grn_id NOT NULL");
  assert.ok(icol("inventory_item_id") && icol("inventory_item_id").is_nullable === "NO", "inventory_item_id NOT NULL");
  assert.ok(icol("po_quantity") && icol("po_quantity").data_type === "numeric" && icol("po_quantity").column_default === "0", "po_quantity NUMERIC default 0");
  assert.ok(icol("received_quantity") && icol("received_quantity").data_type === "numeric", "received_quantity NUMERIC");
  assert.ok(icol("accepted_quantity") && icol("accepted_quantity").data_type === "numeric", "accepted_quantity NUMERIC");
  assert.ok(icol("rejected_quantity") && icol("rejected_quantity").data_type === "numeric" && icol("rejected_quantity").column_default === "0", "rejected_quantity NUMERIC default 0");
  assert.ok(icol("unit_price") && icol("unit_price").data_type === "numeric", "unit_price NUMERIC");
  assert.ok(icol("batch_number") && icol("batch_number").is_nullable === "YES", "batch_number nullable");
  assert.ok(icol("expiry_date") && icol("expiry_date").data_type === "timestamp with time zone" && icol("expiry_date").is_nullable === "YES", "expiry_date TIMESTAMPTZ nullable");
  assert.ok(icol("remarks") && icol("remarks").is_nullable === "YES", "remarks nullable");
  assert.ok(icol("position") && icol("position").data_type === "integer" && icol("position").column_default === "0", "position INT default 0");

  // Enum CHECK over the exact 5 Mongo status values.
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'goods_received_notes'::regclass AND contype = 'c'`);
  const checkDefs = checks.map((r) => r.def);
  assert.ok(checkDefs.some((d) => /status.*'Draft'.*'Pending Quality Check'.*'Pending Approval'.*'Approved'.*'Rejected'/.test(d)), "status CHECK with exact 5 enum values");
  assert.ok(!checkDefs.some((d) => /'Partially Received'/.test(d)), "no invented PO status leak");

  const itemChecks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'goods_received_note_items'::regclass AND contype = 'c'`);
  const itemCheckDefs = itemChecks.map((r) => r.def);
  assert.ok(itemCheckDefs.some((d) => /received_quantity\s*>=\s*\(*0\)*/.test(d)), "received_quantity >= 0 CHECK (Mongo min: 0)");
  assert.ok(itemCheckDefs.some((d) => /accepted_quantity\s*>=\s*\(*0\)*/.test(d)), "accepted_quantity >= 0 CHECK (Mongo min: 0)");
  assert.ok(itemCheckDefs.some((d) => /rejected_quantity\s*>=\s*\(*0\)*/.test(d)), "rejected_quantity >= 0 CHECK (Mongo min: 0)");
  assert.ok(itemCheckDefs.some((d) => /unit_price\s*>=\s*\(*0\)*/.test(d)), "unit_price >= 0 CHECK (Mongo min: 0)");
  // poQuantity has NO min in Mongo — no CHECK invented for it.
  assert.ok(!itemCheckDefs.some((d) => /po_quantity\s*>=\s*\(*0\)*/.test(d)), "no invented po_quantity >= 0 CHECK (Mongo has no min on poQuantity)");

  // FKs: exactly three real ones — line → inventory_items RESTRICT, line →
  // goods_received_notes CASCADE, GRN → purchase_orders RESTRICT. No supplier
  // / received_by / approved_by FKs.
  const fks = await poolQuery(databaseUrl, `
    SELECT kcu.column_name, pg_get_constraintdef(oid) AS def FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid IN ('goods_received_notes'::regclass, 'goods_received_note_items'::regclass)`);
  const fkColumns = fks.map((f) => f.column_name);
  assert.strictEqual(fks.length, 3, "exactly three real FKs");
  assert.ok(fkColumns.includes("grn_id") && fkColumns.includes("inventory_item_id") && fkColumns.includes("purchase_order_id"));
  assert.ok(fks.some((f) => f.column_name === "grn_id" && /REFERENCES goods_received_notes\(id\).*ON DELETE CASCADE/.test(f.def)), "child FK CASCADE");
  assert.ok(fks.some((f) => f.column_name === "inventory_item_id" && /REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/.test(f.def)), "inventory item FK RESTRICT");
  assert.ok(fks.some((f) => f.column_name === "purchase_order_id" && /REFERENCES purchase_orders\(id\).*ON DELETE RESTRICT/.test(f.def)), "purchase order FK RESTRICT");

  // Unique grn_number (Mongo unique: true).
  const uniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'goods_received_notes'::regclass AND contype = 'u'`);
  assert.ok(uniques.some((r) => /UNIQUE \(grn_number\)/.test(r.def)), "grn_number unique constraint");

  // Indexes justified by real queries.
  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename IN ('goods_received_notes', 'goods_received_note_items')
    AND indexdef NOT LIKE '%pkey%' AND indexdef NOT LIKE '%grn_number_key%'`);
  const defs = indexes.map((r) => r.indexdef);
  assert.ok(defs.some((d) => /\(grn_number\)/.test(d)), "grn_number index (number lookups)");
  assert.ok(defs.some((d) => /\(status\)/.test(d)), "status index (status filtering)");
  assert.ok(defs.some((d) => /\(purchase_order_id\)/.test(d)), "purchase_order_id index (per-PO receipt history)");
  assert.ok(defs.some((d) => /\(created_at DESC\)/.test(d)), "created_at DESC index (list sorts)");
  assert.ok(defs.some((d) => /\(grn_id,\s*"?position"?\)/.test(d)), "grn_id + position index (child load order)");
  assert.ok(defs.some((d) => /\(inventory_item_id\)/.test(d)), "inventory_item_id index (per-item history)");

  // Physical NUMERIC precision round-trips (Mongo money/quantity type parity).
  // The item insert needs a real inventory_items row and the GRN insert a real
  // purchase_orders row for their FKs.
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "INSERT INTO inventory_items (id, name, unit) VALUES ('000000000000000000000013', 'Mig-GRN-Item', 'Pack')"
    );
    await pool.query(
      "INSERT INTO purchase_orders (id, po_number, supplier, total_amount) VALUES ('000000000000000000000011', 'MIGPO1', 's', 10)"
    );
    const r = await pool.query(
      "INSERT INTO goods_received_notes (id, grn_number, purchase_order_id, supplier, total_amount) VALUES ($1, 'GRN-MIG-1', $2, 's', 123456789.1234) RETURNING total_amount::text AS t",
      ["000000000000000000000012", "000000000000000000000011"]
    );
    assert.strictEqual(r.rows[0].t, "123456789.1234");
    const ir = await pool.query(
      "INSERT INTO goods_received_note_items (id, grn_id, inventory_item_id, po_quantity, received_quantity, accepted_quantity, rejected_quantity, unit_price) VALUES ($1, $2, $3, 10.5, 10.5, 1000.99, 0.5, 0.01) RETURNING po_quantity::text AS p, received_quantity::text AS r, accepted_quantity::text AS a, unit_price::text AS u",
      ["000000000000000000000014", "000000000000000000000012", "000000000000000000000013"]
    );
    assert.strictEqual(ir.rows[0].p, "10.5");
    assert.strictEqual(ir.rows[0].r, "10.5");
    assert.strictEqual(ir.rows[0].a, "1000.99");
    assert.strictEqual(ir.rows[0].u, "0.01");
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2N goods_received_notes migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 015: drop both GRN tables (and the
  // tracking record). All earlier tables stay in place, so a re-run must
  // re-apply only 015 and rebuild goods_received_notes +
  // goods_received_note_items.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_note_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS goods_received_notes CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '015_create_goods_received_notes.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*015_create_goods_received_notes\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'goods_received_note_items'::regclass AND contype = 'f'`);
  assert.strictEqual(fk.length, 2, "re-applied migration rebuilds both child FKs");
  const grnFk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'goods_received_notes'::regclass AND contype = 'f'`);
  assert.strictEqual(grnFk.length, 1, "re-applied migration rebuilds the PO FK");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("a deliberately failed Phase 2N goods_received_notes migration rolls back fully", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const broken = path.join(MIGRATIONS_DIR, "995_broken_grn_test.sql");
  fs.writeFileSync(
    broken,
    "CREATE TABLE partial_grn_test (id TEXT PRIMARY KEY, grn_number TEXT);" +
    "CREATE INDEX idx_partial_grn_test ON partial_grn_test (grn_number);" +
    "SELECT * FROM table_that_does_not_exist;"
  );
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 995_broken_grn_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations WHERE name = '995_broken_grn_test.sql'");
    assert.strictEqual(rows.length, 0, "failed migration must not be recorded");

    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_grn_test', 'idx_partial_grn_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");
    const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.partial_grn_test') AS t");
    assert.strictEqual(tbl[0].t, null, "no partial table may remain");

    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'goods_received_notes' ORDER BY column_name`);
    assert.strictEqual(real.length, 13, "goods_received_notes columns intact after failure");
    const tblNow = await poolQuery(databaseUrl, "SELECT to_regclass('public.goods_received_notes') AS t");
    assert.ok(tblNow[0].t, "goods_received_notes still exists after the failed migration");
  } finally {
    fs.unlinkSync(broken);
  }

  const { output: noPending } = runMigrate(databaseUrl);
  assert.match(noPending, /No pending migrations\./);
});

// ─── Phase 2O: damage_notes ────────────────────────────────────────────────
test("damage notes migration creates NUMERIC quantity, enum CHECKs, defaults and RESTRICT FKs", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'damage_notes' ORDER BY column_name`);
  const col = (name) => cols.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text");
  assert.ok(col("damage_number") && col("damage_number").data_type === "text" && col("damage_number").is_nullable === "NO");
  assert.ok(col("inventory_item_id") && col("inventory_item_id").data_type === "text" && col("inventory_item_id").is_nullable === "NO");
  assert.ok(col("inventory_batch_id") && col("inventory_batch_id").data_type === "text" && col("inventory_batch_id").is_nullable === "YES");
  assert.ok(col("quantity") && col("quantity").data_type === "numeric" && col("quantity").is_nullable === "NO");
  assert.ok(col("reason") && col("reason").data_type === "text" && col("reason").is_nullable === "NO");
  assert.ok(col("description") && col("description").data_type === "text" && col("description").is_nullable === "NO");
  assert.ok(col("photo_url") && col("photo_url").is_nullable === "YES");
  assert.ok(col("reported_by") && col("reported_by").data_type === "text" && col("reported_by").is_nullable === "NO");
  assert.ok(col("status") && col("status").column_default === "'Pending Approval'::text");
  assert.ok(col("approved_by") && col("approved_by").is_nullable === "YES");
  assert.ok(col("write_off_amount") && col("write_off_amount").data_type === "numeric" && col("write_off_amount").column_default === "0");
  assert.ok(col("expense_id") && col("expense_id").is_nullable === "YES");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  assert.strictEqual(cols.length, 15, "15 columns — every persisted Mongo field mapped, nothing invented");

  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'damage_notes'::regclass AND contype = 'c'`);
  const defs = checks.map((r) => r.def);
  assert.ok(defs.some((d) => /quantity\s*>=\s*\(1\)/.test(d)), "quantity >= 1 CHECK mirrors Mongo min: 1");
  assert.ok(defs.some((d) => /'Expired'.*'Broken\/Damaged'.*'Lost\/Stolen'.*'Spoiled'.*'Quality Issue'.*'Other'/.test(d)), "6-value reason enum preserved exactly");
  assert.ok(defs.some((d) => /'Pending Approval'.*'Approved'.*'Rejected'/.test(d)), "3-value status enum preserved exactly");
  // write_off_amount deliberately has NO CHECK: the Mongo schema has no min.

  const uniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'damage_notes'::regclass AND contype = 'u'`);
  assert.ok(uniques.some((r) => /UNIQUE \(damage_number\)/.test(r.def)), "damageNumber unique constraint");

  // Exactly two real FKs: item → inventory_items (RESTRICT), batch →
  // inventory_batches (RESTRICT). reported_by/approved_by/expense_id stay
  // plain TEXT with no FK.
  const fks = await poolQuery(databaseUrl, `
    SELECT kcu.column_name, pg_get_constraintdef(oid) AS def FROM pg_constraint c
    JOIN information_schema.key_column_usage kcu ON c.conname = kcu.constraint_name
    WHERE c.contype = 'f' AND c.conrelid = 'damage_notes'::regclass`);
  assert.strictEqual(fks.length, 2, "exactly two real FKs");
  const fkColumns = fks.map((f) => f.column_name);
  assert.ok(fkColumns.includes("inventory_item_id") && fkColumns.includes("inventory_batch_id"));
  assert.ok(fks.some((f) => f.column_name === "inventory_item_id" && /REFERENCES inventory_items\(id\).*ON DELETE RESTRICT/.test(f.def)), "item FK RESTRICT");
  assert.ok(fks.some((f) => f.column_name === "inventory_batch_id" && /REFERENCES inventory_batches\(id\).*ON DELETE RESTRICT/.test(f.def)), "batch FK RESTRICT");

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename = 'damage_notes'
    AND indexdef NOT LIKE '%pkey%' AND indexdef NOT LIKE '%damage_number_key%'`);
  const idxDefs = indexes.map((r) => r.indexdef);
  assert.ok(idxDefs.some((d) => /\(status\)/.test(d)), "status index (status filtering / pending review list)");
  assert.ok(idxDefs.some((d) => /\(inventory_item_id\)/.test(d)), "inventory_item_id index (per-item write-off history)");
  assert.ok(idxDefs.some((d) => /\(inventory_batch_id\)/.test(d)), "inventory_batch_id index (per-batch write-off history)");
  assert.ok(idxDefs.some((d) => /\(created_at DESC\)/.test(d)), "created_at DESC index (list sorts)");

  // Physical NUMERIC precision round-trips (quantity must be >= 1 per the
  // Mongo min; write_off_amount preserves arbitrary scale).
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "INSERT INTO inventory_items (id, name, unit) VALUES ('000000000000000000000021', 'Mig-Damage-Item', 'Pack')"
    );
    await pool.query(
      "INSERT INTO inventory_batches (id, inventory_item_id, batch_number, original_quantity, current_quantity) VALUES ('000000000000000000000022', '000000000000000000000021', 'MIGB', 100, 100)"
    );
    const r = await pool.query(
      "INSERT INTO damage_notes (id, damage_number, inventory_item_id, inventory_batch_id, quantity, reason, description, reported_by, write_off_amount) VALUES ('000000000000000000000023', 'DAMAGE-MIG-1', '000000000000000000000021', '000000000000000000000022', 123456789.1234, 'Expired', 'migration precision test', '000000000000000000000024', 1000.99) RETURNING quantity::text AS q, write_off_amount::text AS w",
    );
    assert.strictEqual(r.rows[0].q, "123456789.1234");
    assert.strictEqual(r.rows[0].w, "1000.99");
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2O damage_notes migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 016: drop the damage_notes table
  // (and the tracking record). All earlier tables stay in place, so a re-run
  // must re-apply only 016 and rebuild damage_notes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS damage_notes CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '016_create_damage_notes.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*016_create_damage_notes\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  // Re-apply regenerates the table, both real FKs, the enum CHECKs, the
  // unique damage_number and the justified indexes.
  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.damage_notes') AS t");
  assert.ok(tbl[0].t, "damage_notes rebuilt after re-run");
  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'damage_notes'::regclass AND contype = 'f'`);
  assert.strictEqual(fk.length, 2, "re-applied migration rebuilds both FKs");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("a deliberately failed Phase 2O damage_notes migration rolls back fully", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const broken = path.join(MIGRATIONS_DIR, "996_broken_damage_test.sql");
  fs.writeFileSync(
    broken,
    "CREATE TABLE partial_damage_test (id TEXT PRIMARY KEY, damage_number TEXT);" +
    "CREATE INDEX idx_partial_damage_test ON partial_damage_test (damage_number);" +
    "SELECT * FROM table_that_does_not_exist;"
  );
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 996_broken_damage_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations WHERE name = '996_broken_damage_test.sql'");
    assert.strictEqual(rows.length, 0, "failed migration must not be recorded");

    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_damage_test', 'idx_partial_damage_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");
    const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.partial_damage_test') AS t");
    assert.strictEqual(tbl[0].t, null, "no partial table may remain");

    // The 016 damage_notes table from the successful baseline run is untouched.
    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'damage_notes' ORDER BY column_name`);
    assert.strictEqual(real.length, 15, "damage_notes columns intact after failure");
    const tblNow = await poolQuery(databaseUrl, "SELECT to_regclass('public.damage_notes') AS t");
    assert.ok(tblNow[0].t, "damage_notes still exists after the failed migration");
  } finally {
    fs.unlinkSync(broken);
  }

  const { output: noPending } = runMigrate(databaseUrl);
  assert.match(noPending, /No pending migrations\./);
});

test("assets migration creates NUMERIC monetary columns, enum CHECKs, unique asset_id and cascade FK", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const assets = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'assets' ORDER BY column_name`);
  const col = (name) => assets.find((c) => c.column_name === name);
  assert.ok(col("id") && col("id").data_type === "text", "id TEXT PK (Mongo-compatible ObjectId)");
  assert.ok(col("asset_id") && col("asset_id").data_type === "text" && col("asset_id").is_nullable === "NO", "assetId required");
  assert.ok(col("name") && col("name").data_type === "text" && col("name").is_nullable === "NO", "name required");
  assert.ok(col("category") && col("category").column_default === "'Other'::text", "category default 'Other'");
  assert.ok(col("qr_code") && col("qr_code").column_default === "''::text", "qrCode default ''");
  assert.ok(col("purchase_date") && col("purchase_date").data_type === "timestamp with time zone", "purchaseDate TIMESTAMPTZ");
  assert.ok(col("purchase_date").is_nullable === "YES", "purchaseDate nullable (Mongo default null)");
  assert.ok(col("supplier") && col("supplier").is_nullable === "YES", "supplier nullable and Mongo-backed");
  assert.ok(col("invoice_number") && col("invoice_number").column_default === "''::text", "invoiceNumber default ''");
  assert.ok(col("warranty") && col("warranty").column_default === "''::text", "warranty default '' (String, not Date)");
  assert.ok(col("assigned_location") && col("assigned_location").column_default === "'Main Temple'::text", "assignedLocation default 'Main Temple'");
  assert.ok(col("status") && col("status").column_default === "'Active'::text", "status default 'Active'");
  assert.ok(col("purchase_cost") && col("purchase_cost").data_type === "numeric" && col("purchase_cost").column_default === "0", "purchaseCost NUMERIC default 0, NO min CHECK");
  assert.ok(col("serial_number") && col("serial_number").column_default === "''::text", "serialNumber default ''");
  assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone");
  assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone");
  assert.ok(!assets.some((c) => c.column_name === "maintenancehistory"),
    "embedded maintenanceHistory normalized away from assets — no JSONB column");

  const uniqueIdx = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'assets' AND indexname = 'assets_asset_id_key'`);
  assert.ok(uniqueIdx[0] && /UNIQUE/.test(uniqueIdx[0].indexdef), "asset_id unique (Mongo assetId unique: true)");
  assert.ok(!uniqueIdx[0].indexdef.includes("serial_number"), "serialNumber is NOT unique (no Mongo unique index)");

  const checks = await poolQuery(databaseUrl, `
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'assets'::regclass AND contype = 'c'`);
  const defs = checks.map((r) => r.def);
  assert.ok(defs.some((d) => /category.*'Electrical'.*'Furniture'.*'Electronics'.*'Utensils'.*'Machinery'.*'Other'/.test(d)), "category CHECK over the 6 Mongo values");
  assert.ok(defs.some((d) => /status.*'Active'.*'Under Repair'.*'Retired'/.test(d)), "status CHECK over the 3 Mongo values");
  assert.ok(!defs.some((d) => /purchase_cost\s*>=/.test(d)), "no invented monetary min CHECK on purchase_cost");

  const mh = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'asset_maintenance_history' ORDER BY column_name`);
  const mhCol = (name) => mh.find((c) => c.column_name === name);
  assert.ok(mhCol("id") && mhCol("id").data_type === "text", "maintenance entry id TEXT PK");
  assert.ok(mhCol("asset_id") && mhCol("asset_id").is_nullable === "NO", "child asset_id required");
  assert.ok(mhCol("position") && mhCol("position").data_type === "integer" && (mhCol("position").column_default === "0" || mhCol("position").column_default === "0::integer"), "position INTEGER preserves array order");
  assert.ok(mhCol("repair_date") && mhCol("repair_date").data_type === "timestamp with time zone", "repairDate TIMESTAMPTZ");
  assert.ok(mhCol("description") && mhCol("description").is_nullable === "YES");
  assert.ok(mhCol("cost") && mhCol("cost").data_type === "numeric", "maintenance cost NUMERIC");
  assert.ok(mhCol("vendor") && mhCol("vendor").is_nullable === "YES");

  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'asset_maintenance_history'::regclass AND contype = 'f'`);
  assert.strictEqual(fk.length, 1, "asset_maintenance_history has exactly one FK");
  assert.ok(/REFERENCES assets\(id\)/.test(fk[0].def) && /DELETE CASCADE/i.test(fk[0].def),
    "child FK → assets(id) ON DELETE CASCADE matches the Mongo embedded-array lifecycle");

  const assetsFk = await poolQuery(databaseUrl, `
    SELECT count(*)::int AS c FROM pg_constraint
    WHERE conrelid = 'assets'::regclass AND contype = 'f'`);
  assert.strictEqual(assetsFk[0].c, 0, "assets has NO FK to suppliers (suppliers stay Mongo-backed)");

  const idx = await poolQuery(databaseUrl, `
    SELECT indexname FROM pg_indexes WHERE tablename = 'assets' ORDER BY indexname`);
  const idxNames = idx.map((r) => r.indexname);
  for (const expected of ["idx_assets_name", "idx_assets_status", "idx_assets_category", "idx_assets_assigned_location", "idx_assets_purchase_date", "idx_assets_created_at"]) {
    assert.ok(idxNames.includes(expected), `index ${expected} present`);
  }
  const mhIdx = await poolQuery(databaseUrl, `
    SELECT indexname FROM pg_indexes WHERE tablename = 'asset_maintenance_history' ORDER BY indexname`);
  assert.ok(mhIdx.map((r) => r.indexname).includes("idx_asset_maintenance_history_asset_id"),
    "maintenance history per-asset index present");
});

test("assets NUMERIC columns round-trip monetary precision exactly", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const v of ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"]) {
      const r = await pool.query(
        `INSERT INTO assets (id, asset_id, name, purchase_cost)
         VALUES ($1, $2, $3, $4)
         RETURNING purchase_cost::text AS c`,
        [crypto.randomBytes(12).toString("hex"), `AST-MIG-${v}`, "Precision", v]
      );
      assert.strictEqual(r.rows[0].c, v, `purchase_cost ${v} round-trips exactly`);
    }
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2P assets migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 017: drop the assets tables (and the
  // tracking record). All earlier tables stay in place, so a re-run must
  // re-apply only 017 and rebuild both assets + asset_maintenance_history.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS assets CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '017_create_assets.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*017_create_assets\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.assets') AS t");
  assert.ok(tbl[0].t, "assets rebuilt after re-run");
  const child = await poolQuery(databaseUrl, "SELECT to_regclass('public.asset_maintenance_history') AS t");
  assert.ok(child[0].t, "asset_maintenance_history rebuilt after re-run");
  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'asset_maintenance_history'::regclass AND contype = 'f'`);
  assert.strictEqual(fk.length, 1, "re-applied migration rebuilds the child FK");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("failed Phase 2P migration rolls back cleanly — no partial assets table, indexes or constraints", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const assetsIdx = await poolQuery(databaseUrl, `
    SELECT count(*)::int AS c FROM pg_indexes WHERE tablename = 'assets'`);
  assert.ok(assetsIdx[0].c > 0, "assets indexes present in the successful baseline");

  const broken = path.join(MIGRATIONS_DIR, "998_broken_assets_test.sql");
  fs.writeFileSync(broken, `
    CREATE TABLE partial_assets_test (id TEXT PRIMARY KEY);
    CREATE INDEX idx_partial_assets_test ON partial_assets_test (id);
    ALTER TABLE partial_assets_test SET SCHEMA public;
    SELECT * FROM nonexistent_assets_table;`);
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 998_broken_assets_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_assets_test', 'idx_partial_assets_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");
    const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.partial_assets_test') AS t");
    assert.strictEqual(tbl[0].t, null, "no partial table may remain");

    // The real 017 assets tables from the successful baseline run are untouched.
    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'assets' ORDER BY column_name`);
    assert.strictEqual(real.length, 15, "assets columns intact after failure");
    const realChild = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'asset_maintenance_history' ORDER BY column_name`);
    assert.strictEqual(realChild.length, 9, "asset_maintenance_history columns intact after failure");
    const tblNow = await poolQuery(databaseUrl, "SELECT to_regclass('public.assets') AS t");
    assert.ok(tblNow[0].t, "assets still exists after the failed migration");
    const idxNow = await poolQuery(databaseUrl, `
      SELECT count(*)::int AS c FROM pg_indexes WHERE tablename = 'assets'`);
    assert.strictEqual(idxNow[0].c, assetsIdx[0].c, "no extra/removed indexes on assets after failure");
  } finally {
    fs.unlinkSync(broken);
  }

  const { output: noPending } = runMigrate(databaseUrl);
  assert.match(noPending, /No pending migrations\./);
});

// ─── Phase 2Q: repairs ─────────────────────────────────────────────────────
test("Phase 2Q repairs migration creates Mongo-mapped columns, enum CHECKs, unique ticket_number and the cascade child FK", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // repair_requests — every persisted RepairRequest field, nothing invented.
  const reqCols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'repair_requests' ORDER BY column_name`);
  const reqCol = (name) => reqCols.find((c) => c.column_name === name);
  assert.ok(reqCol("id") && reqCol("id").data_type === "text" && reqCol("id").is_nullable === "NO", "id TEXT PK");
  assert.ok(reqCol("asset_id") && reqCol("asset_id").data_type === "text" && reqCol("asset_id").is_nullable === "YES", "asset ref plain TEXT, no invented NOT NULL");
  assert.ok(reqCol("description") && reqCol("description").data_type === "text" && reqCol("description").is_nullable === "NO", "description required");
  assert.ok(reqCol("vendor") && reqCol("vendor").column_default === "''::text", "vendor default ''");
  assert.ok(reqCol("cost") && reqCol("cost").data_type === "numeric" && reqCol("cost").column_default === "0", "cost NUMERIC default 0");
  assert.ok(reqCol("invoice_number") && reqCol("invoice_number").column_default === "''::text", "invoiceNumber default ''");
  assert.ok(reqCol("status") && reqCol("status").column_default === "'Pending'::text", "status default 'Pending'");
  assert.ok(reqCol("completion_date") && reqCol("completion_date").data_type === "timestamp with time zone" && reqCol("completion_date").is_nullable === "YES", "completionDate TIMESTAMPTZ nullable");
  assert.ok(reqCol("created_by") && reqCol("created_by").data_type === "text" && reqCol("created_by").is_nullable === "YES", "createdBy plain TEXT (Mongo String, not an ObjectId ref)");
  assert.ok(reqCol("created_at") && reqCol("created_at").data_type === "timestamp with time zone" && reqCol("created_at").column_default === "now()");
  assert.ok(reqCol("updated_at") && reqCol("updated_at").data_type === "timestamp with time zone");
  assert.strictEqual(reqCols.length, 11, "11 columns — every persisted RepairRequest field mapped");

  const reqChecks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'repair_requests'::regclass AND contype = 'c'`);
  const reqDefs = reqChecks.map((r) => r.def);
  assert.ok(reqDefs.some((d) => /'Pending'.*'In Progress'.*'Completed'.*'Cancelled'/.test(d)), "4-value status enum preserved exactly");
  assert.ok(!reqDefs.some((d) => /cost\s*>=/.test(d)), "cost has no min in Mongo — no invented CHECK");

  // RepairRequest declares no unique index in Mongo — none invented.
  const reqUniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'repair_requests'::regclass AND contype = 'u'`);
  assert.strictEqual(reqUniques.length, 0, "repair_requests has no invented unique constraint");

  // repair_tickets — every persisted RepairTicket field.
  const tktCols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'repair_tickets' ORDER BY column_name`);
  const tktCol = (name) => tktCols.find((c) => c.column_name === name);
  assert.ok(tktCol("id") && tktCol("id").data_type === "text" && tktCol("id").is_nullable === "NO");
  assert.ok(tktCol("ticket_number") && tktCol("ticket_number").data_type === "text" && tktCol("ticket_number").is_nullable === "NO", "ticketNumber required");
  assert.ok(tktCol("asset_id") && tktCol("asset_id").data_type === "text" && tktCol("asset_id").is_nullable === "NO", "asset required");
  assert.ok(tktCol("reported_by") && tktCol("reported_by").data_type === "text" && tktCol("reported_by").is_nullable === "NO", "reportedBy required");
  assert.ok(tktCol("issue_description") && tktCol("issue_description").is_nullable === "NO", "issueDescription required");
  assert.ok(tktCol("status") && tktCol("status").column_default === "'Reported'::text");
  assert.ok(tktCol("priority") && tktCol("priority").column_default === "'Medium'::text");
  assert.ok(tktCol("vendor") && tktCol("vendor").is_nullable === "YES", "vendor optional (Mongo-backed supplier ref)");
  assert.ok(tktCol("vendor_bill_amount") && tktCol("vendor_bill_amount").data_type === "numeric" && tktCol("vendor_bill_amount").column_default === "0");
  assert.ok(tktCol("vendor_bill_photo") && tktCol("vendor_bill_photo").is_nullable === "YES");
  assert.ok(tktCol("repair_expense_id") && tktCol("repair_expense_id").is_nullable === "YES", "repairExpenseId plain TEXT, no FK");
  assert.ok(tktCol("approved_by") && tktCol("approved_by").is_nullable === "YES");
  assert.ok(tktCol("resolution_notes") && tktCol("resolution_notes").is_nullable === "YES");
  assert.ok(tktCol("created_at") && tktCol("created_at").data_type === "timestamp with time zone");
  assert.ok(tktCol("updated_at") && tktCol("updated_at").data_type === "timestamp with time zone");
  assert.strictEqual(tktCols.length, 15, "15 columns — every persisted RepairTicket field mapped");
  assert.ok(!tktCols.some((c) => c.column_name === "sparepartsused"),
    "embedded sparePartsUsed normalized away from repair_tickets — no JSONB column");

  const tktChecks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'repair_tickets'::regclass AND contype = 'c'`);
  const tktDefs = tktChecks.map((r) => r.def);
  assert.ok(tktDefs.some((d) => /'Reported'.*'Pending Approval'.*'Approved'.*'In Progress'.*'Completed'.*'Rejected'.*'Closed'/.test(d)), "7-value status enum preserved exactly");
  assert.ok(tktDefs.some((d) => /'Low'.*'Medium'.*'High'.*'Critical'/.test(d)), "4-value priority enum preserved exactly");
  assert.ok(!tktDefs.some((d) => /vendor_bill_amount\s*>=/.test(d)), "no invented monetary min CHECK");

  const tktUniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'repair_tickets'::regclass AND contype = 'u'`);
  assert.ok(tktUniques.some((r) => /UNIQUE \(ticket_number\)/.test(r.def)), "ticketNumber unique (Mongo unique: true)");

  // repair_ticket_spare_parts — the normalized embedded array.
  const partCols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'repair_ticket_spare_parts' ORDER BY column_name`);
  const partCol = (name) => partCols.find((c) => c.column_name === name);
  assert.ok(partCol("id") && partCol("id").data_type === "text" && partCol("id").is_nullable === "NO");
  assert.ok(partCol("ticket_id") && partCol("ticket_id").is_nullable === "NO", "owning ticket required");
  assert.ok(partCol("position") && partCol("position").data_type === "integer" && partCol("position").column_default === "0", "position preserves array order");
  assert.ok(partCol("inventory_item_id") && partCol("inventory_item_id").is_nullable === "YES", "embedded item ref optional, plain TEXT");
  assert.ok(partCol("quantity") && partCol("quantity").data_type === "numeric" && partCol("quantity").column_default === "1", "quantity NUMERIC default 1");
  assert.strictEqual(partCols.length, 7, "7 columns — every persisted embedded field mapped");

  // FKs: exactly ONE real FK in the whole phase — the child parent link.
  const fks = await poolQuery(databaseUrl, `
    SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN ('repair_requests'::regclass, 'repair_tickets'::regclass, 'repair_ticket_spare_parts'::regclass)`);
  assert.strictEqual(fks.length, 1, "exactly one real FK — no fake/speculative FKs");
  assert.strictEqual(fks[0].tbl, "repair_ticket_spare_parts");
  assert.ok(/REFERENCES repair_tickets\(id\).*ON DELETE CASCADE/.test(fks[0].def), "child FK CASCADE mirrors the embedded-array lifecycle");

  // Indexes justified by real queries.
  const idx = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename IN ('repair_requests', 'repair_tickets', 'repair_ticket_spare_parts')
      AND indexdef NOT LIKE '%pkey%' AND indexdef NOT LIKE '%ticket_number_key%'`);
  const idxDefs = idx.map((r) => r.indexdef);
  assert.ok(idxDefs.some((d) => /repair_requests.*\(asset_id\)/.test(d)), "per-asset request lookups");
  assert.ok(idxDefs.some((d) => /repair_requests.*\(status\)/.test(d)), "status filtering");
  assert.ok(idxDefs.some((d) => /repair_requests.*\(created_at DESC\)/.test(d)), "getAllRepairs sort");
  assert.ok(idxDefs.some((d) => /repair_tickets.*\(asset_id\)/.test(d)), "public per-asset maintenance history");
  assert.ok(idxDefs.some((d) => /repair_tickets.*\(status\)/.test(d)));
  assert.ok(idxDefs.some((d) => /repair_tickets.*\(priority\)/.test(d)));
  assert.ok(idxDefs.some((d) => /repair_tickets.*\(reported_by\)/.test(d)));
  assert.ok(idxDefs.some((d) => /repair_tickets.*\(created_at DESC\)/.test(d)));
  assert.ok(idxDefs.some((d) => /repair_ticket_spare_parts.*\(ticket_id,\s*"?position"?\)/.test(d)), "child load order");

  // NUMERIC precision round-trips at the physical layer (no floats).
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const v of ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"]) {
      const r = await pool.query(
        "INSERT INTO repair_requests (id, asset_id, description, cost) VALUES ($1, $2, 'p', $3) RETURNING cost::text AS c",
        [crypto.randomBytes(12).toString("hex"), crypto.randomBytes(12).toString("hex"), v]
      );
      assert.strictEqual(r.rows[0].c, v, `cost ${v} round-trips exactly`);
    }
    const t = await pool.query(
      `INSERT INTO repair_tickets (id, ticket_number, asset_id, reported_by, issue_description, vendor_bill_amount)
       VALUES ($1, 'TKT-MIG-1', $2, $3, 'p', $4) RETURNING vendor_bill_amount::text AS c`,
      [crypto.randomBytes(12).toString("hex"), crypto.randomBytes(12).toString("hex"), crypto.randomBytes(12).toString("hex"), "123456789.1234"]
    );
    assert.strictEqual(t.rows[0].c, "123456789.1234");
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2Q repairs migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 018: drop the repair tables (and the
  // tracking record). All earlier tables stay in place, so a re-run must
  // re-apply only 018 and rebuild all three tables + the child FK.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_tickets CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS repair_requests CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '018_create_repairs.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*018_create_repairs\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  for (const table of ["repair_requests", "repair_tickets", "repair_ticket_spare_parts"]) {
    const tbl = await poolQuery(databaseUrl, `SELECT to_regclass('public.${table}') AS t`);
    assert.ok(tbl[0].t, `${table} rebuilt after re-run`);
  }
  const fk = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'repair_ticket_spare_parts'::regclass AND contype = 'f'`);
  assert.strictEqual(fk.length, 1, "re-applied migration rebuilds the child FK");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("a deliberately failed Phase 2Q repairs migration rolls back fully", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const broken = path.join(MIGRATIONS_DIR, "994_broken_repairs_test.sql");
  fs.writeFileSync(
    broken,
    "CREATE TABLE partial_repairs_test (id TEXT PRIMARY KEY, ticket_number TEXT);" +
    "CREATE INDEX idx_partial_repairs_test ON partial_repairs_test (ticket_number);" +
    "SELECT * FROM table_that_does_not_exist;"
  );
  try {
    const res = runMigrate(databaseUrl);
    assert.match(res.output, /Migration 994_broken_repairs_test\.sql failed/);
    assert.strictEqual(res.status, 1);

    const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations WHERE name = '994_broken_repairs_test.sql'");
    assert.strictEqual(rows.length, 0, "failed migration must not be recorded");

    const objs = await poolQuery(databaseUrl, `
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('partial_repairs_test', 'idx_partial_repairs_test')`);
    assert.strictEqual(objs.length, 0, "no partial table/index may remain");

    // The real 018 tables from the successful baseline run are untouched.
    const real = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'repair_requests' ORDER BY column_name`);
    assert.strictEqual(real.length, 11, "repair_requests columns intact after failure");
    const realChild = await poolQuery(databaseUrl, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'repair_ticket_spare_parts' ORDER BY column_name`);
    assert.strictEqual(realChild.length, 7, "repair_ticket_spare_parts columns intact after failure");
    const tblNow = await poolQuery(databaseUrl, "SELECT to_regclass('public.repair_tickets') AS t");
    assert.ok(tblNow[0].t, "repair_tickets still exists after the failed migration");
  } finally {
    fs.unlinkSync(broken);
  }

  const { output: noPending } = runMigrate(databaseUrl);
  assert.match(noPending, /No pending migrations\./);
});

test("Phase 2Q repair_ticket_spare_parts FK enforces valid/invalid references and CASCADE delete", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const ticketId = crypto.randomBytes(12).toString("hex");
  const partId = crypto.randomBytes(12).toString("hex");
  try {
    await pool.query(
      `INSERT INTO repair_tickets (id, ticket_number, asset_id, reported_by, issue_description)
       VALUES ($1, 'TKT-FK-1', $2, $3, 'fk test')`,
      [ticketId, crypto.randomBytes(12).toString("hex"), crypto.randomBytes(12).toString("hex")]
    );
    await pool.query(
      `INSERT INTO repair_ticket_spare_parts (id, ticket_id, position, inventory_item_id, quantity)
       VALUES ($1, $2, 0, $3, 2)`,
      [partId, ticketId, crypto.randomBytes(12).toString("hex")]
    );

    // An invalid parent reference must fail (real FK, not a loose TEXT column).
    await assert.rejects(
      pool.query(
        `INSERT INTO repair_ticket_spare_parts (id, ticket_id, position, quantity)
         VALUES ($1, 'does-not-exist', 0, 1)`,
        [crypto.randomBytes(12).toString("hex")]
      ),
      /violates foreign key constraint/
    );

    // repair_requests.asset_id / repair_tickets.asset_id intentionally carry NO
    // FK, so a non-existent asset reference is accepted (Mongo keeps the repair
    // when the asset is gone) — no destructive cascade is introduced.
    await pool.query(
      `INSERT INTO repair_requests (id, asset_id, description) VALUES ($1, 'ghost-asset', 'no fk')`,
      [crypto.randomBytes(12).toString("hex")]
    );

    // Deleting the ticket cascades exactly the child rows.
    await pool.query("DELETE FROM repair_tickets WHERE id = $1", [ticketId]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM repair_ticket_spare_parts WHERE ticket_id = $1", [ticketId]);
    assert.strictEqual(rows[0].n, 0, "child rows removed with the parent");
  } finally {
    await pool.end();
  }
});

test("rollback of the Phase 2R rooms migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 019: drop the rooms table (and its
  // tracking record). Every earlier table stays in place, so a re-run must
  // re-apply only 019 and rebuild rooms with its constraint and indexes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS rooms CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '019_create_rooms.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*019_create_rooms\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.rooms') AS t");
  assert.ok(tbl[0].t, "rooms rebuilt after re-run");

  const uniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND contype = 'u'`);
  assert.strictEqual(uniques.length, 1, "re-applied migration rebuilds the unique constraint");
  assert.match(uniques[0].def, /UNIQUE \(number\)/);

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("rooms migration creates the Mongo-mapped columns, CHECKs, UNIQUE and real indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'rooms' ORDER BY column_name`);
  const col = (name) => cols.find((c) => c.column_name === name);

  // Every persisted Mongo Room field has an explicit column.
  for (const name of ["id", "number", "type", "block", "floor", "price", "capacity",
    "bed_type", "amenities", "status", "devotee", "phone", "days", "pay_mode",
    "checkin_date", "checkout_date", "created_at", "updated_at"]) {
    assert.ok(col(name), `rooms.${name} exists`);
  }
  assert.strictEqual(cols.length, 18, "no invented columns beyond the mapped fields");

  // Types.
  assert.strictEqual(col("id").data_type, "text");
  assert.strictEqual(col("id").is_nullable, "NO");
  assert.strictEqual(col("number").data_type, "text");
  assert.strictEqual(col("number").is_nullable, "NO");
  assert.strictEqual(col("type").data_type, "text");
  assert.strictEqual(col("type").is_nullable, "NO");
  assert.strictEqual(col("block").is_nullable, "YES");
  assert.strictEqual(col("floor").is_nullable, "YES");
  assert.strictEqual(col("price").data_type, "numeric");
  assert.strictEqual(col("price").is_nullable, "NO");
  assert.strictEqual(col("capacity").data_type, "numeric");
  assert.strictEqual(col("capacity").column_default, "2");
  assert.strictEqual(col("bed_type").column_default, "'Double'::text");
  assert.strictEqual(col("amenities").data_type, "ARRAY");
  assert.strictEqual(col("status").column_default, "'Available'::text");
  assert.strictEqual(col("devotee").is_nullable, "YES");
  assert.strictEqual(col("phone").is_nullable, "YES");
  assert.strictEqual(col("checkin_date").data_type, "timestamp with time zone");
  assert.strictEqual(col("checkin_date").is_nullable, "YES");
  assert.strictEqual(col("checkout_date").data_type, "timestamp with time zone");
  assert.strictEqual(col("checkout_date").is_nullable, "YES");
  assert.strictEqual(col("created_at").data_type, "timestamp with time zone");
  assert.strictEqual(col("updated_at").data_type, "timestamp with time zone");

  // No monetary column may use float/real/double precision.
  const floats = await poolQuery(databaseUrl, `
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'rooms' AND data_type IN ('real', 'double precision')`);
  assert.strictEqual(floats.length, 0, "no floating-point columns");

  // CHECKs: status enum + price >= 0 only (capacity/days have no min in Mongo).
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND contype = 'c'`);
  assert.ok(checks.some((r) => /status.*'Available'.*'Occupied'.*'Maintenance'/.test(r.def)), "status CHECK");
  // PostgreSQL renders this as CHECK ((price >= (0)::numeric)).
  assert.ok(checks.some((r) => /price >= \(?0\)?/.test(r.def)), "price >= 0 CHECK");
  assert.strictEqual(checks.length, 2, "only the two Mongo-derived CHECKs");
  assert.ok(!checks.some((r) => /capacity.*>=/.test(r.def)), "capacity has no min in Mongo, so no CHECK");
  assert.ok(!checks.some((r) => /days.*>=/.test(r.def)), "days has no min in Mongo, so no CHECK");

  // Exactly one UNIQUE constraint, on number.
  const uniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND contype = 'u'`);
  assert.strictEqual(uniques.length, 1);
  assert.match(uniques[0].def, /UNIQUE \(number\)/);

  // No foreign keys at all — Rooms references no PostgreSQL row.
  const fks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND contype = 'f'`);
  assert.strictEqual(fks.length, 0, "rooms has no foreign keys");

  // Indexes justified by real query patterns.
  const indexes = await poolQuery(databaseUrl, `
    SELECT indexdef FROM pg_indexes WHERE tablename = 'rooms'`);
  const defs = indexes.map((r) => r.indexdef);
  assert.ok(defs.some((d) => /UNIQUE INDEX.*\(number\)/.test(d)), "unique number index");
  assert.ok(defs.some((d) => /\(status\)/.test(d)), "status index");
  assert.ok(defs.some((d) => /\(checkin_date\)/.test(d)), "checkin_date index");
  assert.ok(defs.some((d) => /\(checkout_date\)/.test(d)), "checkout_date index");
  assert.ok(defs.some((d) => /\(created_at DESC\)/.test(d)), "created_at DESC index");
  // Exactly the primary key, the unique number index and the four justified
  // non-unique indexes — no speculative index exists.
  assert.strictEqual(defs.length, 6, "only the justified indexes (PK + 1 unique + 4 non-unique)");
  assert.ok(defs.some((d) => /CREATE UNIQUE INDEX rooms_pkey ON public\.rooms USING btree \(id\)/.test(d)), "primary key index");
});

test("rooms unique constraint and CHECKs reject invalid rows on the PostgreSQL layer", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const id = () => crypto.randomBytes(12).toString("hex");
  try {
    await pool.query(
      "INSERT INTO rooms (id, number, type, price) VALUES ($1, 'R-UNIQ', 'Std', 100)",
      [id()]
    );
    await assert.rejects(
      pool.query("INSERT INTO rooms (id, number, type, price) VALUES ($1, 'R-UNIQ', 'Std', 100)", [id()]),
      /rooms_number_key/
    );
    await assert.rejects(
      pool.query("INSERT INTO rooms (id, number, type, price) VALUES ($1, 'R-NEG', 'Std', -1)", [id()]),
      /rooms_price_check/
    );
    await assert.rejects(
      pool.query("INSERT INTO rooms (id, number, type, price, status) VALUES ($1, 'R-STS', 'Std', 1, 'Free')", [id()]),
      /rooms_status_check/
    );

    // Defaults applied by the column definitions.
    const { rows } = await pool.query("SELECT capacity, bed_type, amenities, status FROM rooms WHERE number = 'R-UNIQ'");
    assert.strictEqual(Number(rows[0].capacity), 2);
    assert.strictEqual(rows[0].bed_type, "Double");
    assert.deepStrictEqual(rows[0].amenities, []);
    assert.strictEqual(rows[0].status, "Available");

    // price keeps exact NUMERIC scale (no float rounding).
    await pool.query("INSERT INTO rooms (id, number, type, price) VALUES ($1, 'R-SCALE', 'Std', 123456.7891)", [id()]);
    const scale = await pool.query("SELECT price::text AS p FROM rooms WHERE number = 'R-SCALE'");
    assert.strictEqual(Number(scale.rows[0].p), 123456.7891);
  } finally {
    await pool.end();
  }
});

test("SELECT 1 succeeds against test database", async () => {
  const rows = await poolQuery(TEST_DB_URL, "SELECT 1 AS ok");
  assert.strictEqual(rows[0].ok , 1);
});

// ─── Phase 2S: attendance migration ────────────────────────────────────────
// Every test below opens its own pg Pool (the file has no shared import).
test("rollback of the Phase 2S attendance migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 020: drop the attendance table (and
  // its tracking record). Every earlier table stays in place, so a re-run must
  // re-apply only 020 and rebuild attendance with its constraints and indexes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS attendance CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '020_create_attendance.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*020_create_attendance\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.attendance') AS t");
  assert.ok(tbl[0].t, "attendance rebuilt after re-run");

  const uniques = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'attendance'::regclass AND contype = 'u'`);
  assert.strictEqual(uniques.length, 1, "re-applied migration rebuilds the unique constraint");
  assert.match(uniques[0].def, /UNIQUE \(staff_id, date_key\)/);

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("attendance migration creates the Mongo-mapped columns, CHECKs, UNIQUE and real indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'attendance' ORDER BY column_name`);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));

    // The exact projection: id + the 37 Mongo schema fields + the two timestamps.
    assert.strictEqual(cols.rows.length, 40, "exactly 40 mapped columns");

    const expected = {
      id: ["text", "NO"],
      staff_id: ["text", "NO"],
      staff_name: ["text", "NO"],
      employee_id: ["text", "YES"],
      staff_email: ["text", "YES"],
      date_key: ["text", "NO"],
      check_in: ["text", "NO"],
      check_out: ["text", "NO"],
      check_in_at: ["timestamp with time zone", "YES"],
      check_out_at: ["timestamp with time zone", "YES"],
      shift: ["text", "NO"],
      shift_start_time: ["text", "NO"],
      shift_end_time: ["text", "NO"],
      assignment_type: ["text", "NO"],
      duty_name: ["text", "NO"],
      duty_area: ["text", "NO"],
      status: ["text", "NO"],
      is_late_check_in: ["boolean", "NO"],
      working_minutes: ["numeric", "NO"],
      working_hours: ["text", "NO"],
      overtime_minutes: ["numeric", "NO"],
      overtime_hours: ["text", "NO"],
      is_overtime: ["boolean", "NO"],
      note: ["text", "NO"],
      source: ["text", "NO"],
      corrected_by: ["text", "NO"],
      correction_date: ["timestamp with time zone", "YES"],
      correction_reason: ["text", "NO"],
      latitude: ["numeric", "YES"],
      longitude: ["numeric", "YES"],
      location_verified: ["boolean", "NO"],
      face_verified: ["boolean", "NO"],
      distance_from_temple: ["numeric", "YES"],
      device_info: ["text", "NO"],
      browser: ["text", "NO"],
      ip_address: ["text", "NO"],
      check_in_photo: ["text", "NO"],
      check_out_photo: ["text", "NO"],
      created_at: ["timestamp with time zone", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    };
    for (const [name, [type, nullable]] of Object.entries(expected)) {
      assert.ok(byName[name], `attendance.${name} exists`);
      assert.strictEqual(byName[name].data_type, type, `attendance.${name} type`);
      assert.strictEqual(byName[name].is_nullable, nullable, `attendance.${name} nullability`);
    }

    // date_key stays a timezone-free TEXT calendar key (never DATE/TIMESTAMPTZ).
    assert.strictEqual(byName.date_key.data_type, "text");
    assert.ok(
      !/date|timestamp/i.test(byName.date_key.data_type),
      "date_key must not become a date/timestamp column"
    );

    // No duration/coordinate column is a binary float — exact values only.
    const floats = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'attendance' AND data_type IN ('real', 'double precision')`);
    assert.strictEqual(floats.rows.length, 0, "no float columns on attendance");

    // CHECK constraints: exactly the status enum and the date_key shape.
    const checks = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'attendance'::regclass AND contype = 'c'`);
    assert.strictEqual(checks.rows.length, 2, "exactly two CHECK constraints");
    const statusCheck = checks.rows.find((c) => c.conname === "attendance_status_check");
    assert.ok(statusCheck, "status CHECK exists");
    for (const value of ["Present", "Absent", "Half Day", "Leave", "Pending",
      "Working", "Holiday", "Late", "Weekly Off", "Compensatory Off"]) {
      assert.ok(statusCheck.def.includes(`'${value}'`), `status enum keeps ${value}`);
    }
    assert.ok(checks.rows.some((c) => c.conname === "attendance_date_key_check"), "date_key shape CHECK exists");

    // Exactly one UNIQUE constraint: (staff_id, date_key), mirroring the Mongo
    // unique index. employeeId/staffEmail composites stay non-unique.
    const uniques = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'attendance'::regclass AND contype = 'u'`);
    assert.strictEqual(uniques.rows.length, 1, "exactly one UNIQUE constraint");
    assert.match(uniques.rows[0].def, /UNIQUE \(staff_id, date_key\)/);

    // No foreign keys are invented for this phase.
    const fks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'attendance'::regclass AND contype = 'f'`);
    assert.strictEqual(fks.rows.length, 0, "attendance has no foreign keys");

    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'attendance' ORDER BY indexname`);
    const names = indexes.rows.map((r) => r.indexname);
    assert.deepStrictEqual(names, [
      "attendance_pkey",
      "attendance_staff_id_date_key_key",
      "idx_attendance_date_key",
      "idx_attendance_date_key_created_at",
      "idx_attendance_employee_id_date_key",
      "idx_attendance_staff_email_date_key",
    ]);
  } finally {
    await pool.end();
  }
});

test("attendance unique constraint, CHECKs and defaults behave as the Mongo schema declares", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const id = () => crypto.randomBytes(12).toString("hex");
  try {
    // Defaults match the Mongoose schema defaults exactly.
    await pool.query(
      "INSERT INTO attendance (id, staff_id, staff_name, date_key) VALUES ($1, 'S-1', 'Ram', '2026-01-05')",
      [id()]
    );
    const { rows } = await pool.query(
      "SELECT check_in, check_out, shift, status, is_late_check_in, working_minutes, working_hours, overtime_minutes, overtime_hours, is_overtime, note, source, corrected_by, correction_reason, location_verified, face_verified, device_info, browser, ip_address, check_in_photo, check_out_photo, check_in_at, check_out_at, correction_date, latitude, longitude, distance_from_temple FROM attendance WHERE staff_id = 'S-1'"
    );
    assert.strictEqual(rows[0].check_in, "--");
    assert.strictEqual(rows[0].check_out, "--");
    assert.strictEqual(rows[0].shift, "Morning");
    assert.strictEqual(rows[0].status, "Absent");
    assert.strictEqual(rows[0].is_late_check_in, false);
    assert.strictEqual(Number(rows[0].working_minutes), 0);
    assert.strictEqual(rows[0].working_hours, "--");
    assert.strictEqual(Number(rows[0].overtime_minutes), 0);
    assert.strictEqual(rows[0].overtime_hours, "--");
    assert.strictEqual(rows[0].is_overtime, false);
    assert.strictEqual(rows[0].note, "");
    assert.strictEqual(rows[0].source, "manual");
    assert.strictEqual(rows[0].corrected_by, "");
    assert.strictEqual(rows[0].correction_reason, "");
    assert.strictEqual(rows[0].location_verified, false);
    assert.strictEqual(rows[0].face_verified, false);
    assert.strictEqual(rows[0].device_info, "");
    assert.strictEqual(rows[0].browser, "");
    assert.strictEqual(rows[0].ip_address, "");
    assert.strictEqual(rows[0].check_in_photo, "");
    assert.strictEqual(rows[0].check_out_photo, "");
    for (const col of ["check_in_at", "check_out_at", "correction_date", "latitude", "longitude", "distance_from_temple"]) {
      assert.strictEqual(rows[0][col], null, `${col} defaults to null`);
    }

    // Unique (staff_id, date_key): the duplicate fails, a different employee or
    // a different day succeeds.
    await assert.rejects(
      pool.query("INSERT INTO attendance (id, staff_id, staff_name, date_key) VALUES ($1, 'S-1', 'Ram', '2026-01-05')", [id()]),
      /attendance_staff_id_date_key_key/
    );
    await pool.query("INSERT INTO attendance (id, staff_id, staff_name, date_key) VALUES ($1, 'S-1', 'Ram', '2026-01-06')", [id()]);
    await pool.query("INSERT INTO attendance (id, staff_id, staff_name, date_key) VALUES ($1, 'S-2', 'Sita', '2026-01-05')", [id()]);

    // A different employeeId/staffEmail on the same day is allowed — those
    // composites are deliberately non-unique in Mongo too.
    await pool.query(
      "INSERT INTO attendance (id, staff_id, staff_name, employee_id, staff_email, date_key) VALUES ($1, 'S-3', 'Lakshman', 'EMP-3', 'a@b.com', '2026-01-05')",
      [id()]
    );

    // Status enum rejects a value Mongo does not declare.
    await assert.rejects(
      pool.query("INSERT INTO attendance (id, staff_id, staff_name, date_key, status) VALUES ($1, 'S-4', 'X', '2026-01-05', 'Vacation')", [id()]),
      /attendance_status_check/
    );

    // date_key shape is pinned to the 'YYYY-MM-DD' calendar key.
    await assert.rejects(
      pool.query("INSERT INTO attendance (id, staff_id, staff_name, date_key) VALUES ($1, 'S-5', 'X', '05/01/2026')", [id()]),
      /attendance_date_key_check/
    );

    // NUMERIC keeps exact duration/coordinate values (no float rounding).
    await pool.query(
      "INSERT INTO attendance (id, staff_id, staff_name, date_key, working_minutes, overtime_minutes, latitude, longitude, distance_from_temple) VALUES ($1, 'S-6', 'X', '2026-01-05', 465, 90.5, 12.9715987, 77.5945627, 1234.56789)",
      [id()]
    );
    const numeric = await pool.query(
      "SELECT working_minutes::text AS w, overtime_minutes::text AS o, latitude::text AS lat, distance_from_temple::text AS d FROM attendance WHERE staff_id = 'S-6'"
    );
    assert.strictEqual(Number(numeric.rows[0].w), 465);
    assert.strictEqual(Number(numeric.rows[0].o), 90.5);
    assert.strictEqual(numeric.rows[0].lat, "12.9715987");
    assert.strictEqual(numeric.rows[0].d, "1234.56789");
  } finally {
    await pool.end();
  }
});

// ─── Phase 2T: leaves migration ────────────────────────────────────────────
test("rollback of the Phase 2T leaves migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 021: drop the leaves table (and its
  // tracking record). Every earlier table stays in place, so a re-run must
  // re-apply only 021 and rebuild leaves with its constraints and indexes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS leaves CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '021_create_leaves.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*021_create_leaves\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.leaves') AS t");
  assert.ok(tbl[0].t, "leaves rebuilt after re-run");

  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'leaves'::regclass AND contype = 'c'`);
  assert.strictEqual(checks.length, 1, "re-applied migration rebuilds the status CHECK");
  assert.match(checks[0].def, /status/);

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexname FROM pg_indexes WHERE tablename = 'leaves' ORDER BY indexname`);
  assert.strictEqual(indexes.length, 6, "re-applied migration rebuilds the pkey and 5 indexes");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("leaves migration creates the Mongo-mapped columns, CHECK and indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'leaves' ORDER BY column_name`);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));

    // The exact projection: id + the 10 Mongo schema fields + the two timestamps.
    assert.strictEqual(cols.rows.length, 13, "exactly 13 mapped columns");

    const expected = {
      // id is the Mongoose ObjectId as TEXT (the project convention).
      id: ["text", "NO"],
      staff_id: ["text", "NO"],
      staff_name: ["text", "NO"],
      reason: ["text", "NO"],
      leave_type: ["text", "NO"],
      // Calendar-only business dates: TEXT 'YYYY-MM-DD' keys, never DATE/TIMESTAMPTZ.
      from_date: ["text", "NO"],
      to_date: ["text", "NO"],
      status: ["text", "NO"],
      admin_reason: ["text", "NO"],
      reviewed_by: ["text", "NO"],
      // A real instant.
      reviewed_at: ["timestamp with time zone", "YES"],
      created_at: ["timestamp with time zone", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    };
    for (const [name, [type, nullable]] of Object.entries(expected)) {
      assert.ok(byName[name], `leaves.${name} exists`);
      assert.strictEqual(byName[name].data_type, type, `leaves.${name} type`);
      assert.strictEqual(byName[name].is_nullable, nullable, `leaves.${name} nullability`);
    }

    // The calendar dates must stay timezone-free TEXT keys, matching the string
    // comparisons the application already relies on.
    for (const col of ["from_date", "to_date"]) {
      assert.strictEqual(byName[col].data_type, "text", `leaves.${col} stays TEXT`);
      assert.ok(!/date|timestamp/i.test(byName[col].data_type),
        `leaves.${col} must not become a date/timestamp column`);
    }

    // reviewed_at is the only nullable instant; created_at/updated_at are NOT NULL.
    assert.strictEqual(byName.reviewed_at.is_nullable, "YES");

    // Exactly one CHECK constraint: the status enum. No invented date-ordering or
    // calendar-shape CHECKs — Mongo declares neither.
    const checks = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'leaves'::regclass AND contype = 'c'`);
    assert.strictEqual(checks.rows.length, 1, "exactly one CHECK constraint");
    const statusCheck = checks.rows.find((c) => c.conname === "leaves_status_check");
    assert.ok(statusCheck, "status CHECK exists");
    for (const value of ["Pending", "Approved", "Rejected"]) {
      assert.ok(statusCheck.def.includes(`'${value}'`), `status enum keeps ${value}`);
    }
    assert.ok(!statusCheck.def.includes("Cancelled"), "no invented Cancelled status");

    // No UNIQUE constraint: the Leave schema declares no unique index. Overlap is
    // a service-layer rule and must NOT become a database constraint.
    const uniques = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'leaves'::regclass AND contype = 'u'`);
    assert.strictEqual(uniques.rows.length, 0, "leaves has no UNIQUE constraint");

    // No foreign keys: staffId is an untyped identifier in Mongo with no ref.
    const fks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'leaves'::regclass AND contype = 'f'`);
    assert.strictEqual(fks.rows.length, 0, "leaves has no foreign keys");

    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'leaves' ORDER BY indexname`);
    assert.deepStrictEqual(indexes.rows.map((r) => r.indexname), [
      "idx_leaves_from_date_created_at",
      "idx_leaves_staff_id",
      "idx_leaves_staff_id_created_at",
      "idx_leaves_staff_id_dates",
      "idx_leaves_status_dates",
      "leaves_pkey",
    ]);
  } finally {
    await pool.end();
  }
});

test("leaves status CHECK and defaults behave as the Mongo schema declares", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const id = () => crypto.randomBytes(12).toString("hex");
  try {
    // Defaults match the Mongoose schema defaults exactly.
    await pool.query(
      "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date) VALUES ($1, 'S-1', 'Ram', 'Family function', '2026-03-05', '2026-03-07')",
      [id()]
    );
    const { rows } = await pool.query(
      "SELECT leave_type, status, admin_reason, reviewed_by, reviewed_at FROM leaves WHERE staff_id = 'S-1'"
    );
    assert.strictEqual(rows[0].leave_type, "General");
    assert.strictEqual(rows[0].status, "Pending");
    assert.strictEqual(rows[0].admin_reason, "");
    assert.strictEqual(rows[0].reviewed_by, "");
    assert.strictEqual(rows[0].reviewed_at, null);

    // created_at/updated_at default to now().
    const stamps = await pool.query(
      "SELECT created_at, updated_at FROM leaves WHERE staff_id = 'S-1'"
    );
    assert.ok(stamps.rows[0].created_at instanceof Date);
    assert.ok(stamps.rows[0].updated_at instanceof Date);

    // Every status in the Mongo enum is accepted.
    for (const [i, status] of ["Pending", "Approved", "Rejected"].entries()) {
      await pool.query(
        "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date, status) VALUES ($1, $2, 'X', 'Reason', '2026-03-05', '2026-03-05', $3)",
        [id(), `S-ENUM-${i}`, status]
      );
    }

    // A status Mongo does not declare is rejected by the CHECK.
    await assert.rejects(
      pool.query("INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date, status) VALUES ($1, 'S-4', 'X', 'Reason', '2026-03-05', '2026-03-05', 'Cancelled')", [id()]),
      /leaves_status_check/
    );

    // leave_type is free text in Mongo — the database must not constrain it.
    await pool.query(
      "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date, leave_type) VALUES ($1, 'S-5', 'X', 'Reason', '2026-03-05', '2026-03-05', 'Compensatory Off')",
      [id()]
    );

    // Overlapping leaves are ALLOWED at the database level: the application is
    // the only thing preventing them, and Rejected/Pending rows legitimately
    // coexist on the same days. A unique/overlap constraint here would change
    // existing behavior.
    await pool.query(
      "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date) VALUES ($1, 'S-6', 'X', 'First', '2026-04-01', '2026-04-05')",
      [id()]
    );
    await pool.query(
      "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date) VALUES ($1, 'S-6', 'X', 'Overlapping', '2026-04-03', '2026-04-08')",
      [id()]
    );
    const dupes = await pool.query("SELECT COUNT(*)::int AS n FROM leaves WHERE staff_id = 'S-6'");
    assert.strictEqual(dupes.rows[0].n, 2, "overlapping leave rows coexist, exactly like Mongo");

    // No date-ordering CHECK exists, so a reverse range is storable at the SQL
    // layer just as it is in Mongo (the controller, not the schema, guards it).
    await pool.query(
      "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date) VALUES ($1, 'S-7', 'X', 'Reason', '2026-05-10', '2026-05-05')",
      [id()]
    );

    // Nullability mirrors the schema's required fields.
    await pool.query(
      "INSERT INTO leaves (id, staff_id, staff_name, reason, from_date, to_date) VALUES ($1, 'S-8', 'X', 'R', '2026-06-01', '2026-06-01')",
      [id()]
    );
    for (const col of ["staff_id", "staff_name", "reason", "from_date", "to_date"]) {
      await assert.rejects(
        pool.query(`UPDATE leaves SET ${col} = NULL WHERE staff_id = 'S-8'`),
        /null value in column/,
        `leaves.${col} rejects NULL`
      );
    }
  } finally {
    await pool.end();
  }
});

// ─ Phase 2U: shifts migration ────────────────────────────────────────────
test("rollback of the Phase 2U shifts migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 022: drop the shifts table (and its
  // tracking record). Every earlier table stays in place, so a re-run must
  // re-apply only 022 and rebuild shifts with its indexes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS shifts CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '022_create_shifts.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*022_create_shifts\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.shifts') AS t");
  assert.ok(tbl[0].t, "shifts rebuilt after re-run");

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexname FROM pg_indexes WHERE tablename = 'shifts' ORDER BY indexname`);
  assert.strictEqual(indexes.length, 6, "re-applied migration rebuilds the pkey and 5 indexes");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("shifts migration creates the Mongo-mapped columns and real indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'shifts' ORDER BY column_name`);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));

    // The exact projection: id + the 7 Mongo schema fields + the two timestamps.
    assert.strictEqual(cols.rows.length, 10, "exactly 10 mapped columns");

    const expected = {
      // id is the Mongoose ObjectId as TEXT (the project convention).
      id: ["text", "NO"],
      shift_name: ["text", "NO"],
      // Time-of-day values stay TEXT so the 12-hour meridiem display strings
      // ("9:00 AM") round-trip verbatim and keep the existing API contract.
      start_time: ["text", "NO"],
      end_time: ["text", "NO"],
      category: ["text", "NO"],
      // Mongo Number with no min — NUMERIC, never an integer cast.
      required_staff: ["numeric", "NO"],
      active: ["boolean", "NO"],
      notes: ["text", "NO"],
      // The only two real instants.
      created_at: ["timestamp with time zone", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    };
    for (const [name, [type, nullable]] of Object.entries(expected)) {
      assert.ok(byName[name], `shifts.${name} exists`);
      assert.strictEqual(byName[name].data_type, type, `shifts.${name} type`);
      assert.strictEqual(byName[name].is_nullable, nullable, `shifts.${name} nullability`);
    }

    // start_time / end_time must NOT become TIME or TIMESTAMPTZ: the application
    // stores and returns 12-hour meridiem strings and parses them with a regex.
    for (const col of ["start_time", "end_time"]) {
      assert.strictEqual(byName[col].data_type, "text", `shifts.${col} stays TEXT`);
      assert.ok(!/time|timestamp/i.test(byName[col].data_type),
        `shifts.${col} must not become a TIME/timestamp column`);
    }

    // The only constraint is the primary key: the Shift schema declares no
    // unique index and no validation beyond `required`.
    const checks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'shifts'::regclass AND contype = 'c'`);
    assert.strictEqual(checks.rows.length, 0, "shifts has no CHECK constraint");

    // shiftName is NOT unique in Mongo — duplicates are stored happily, so no
    // UNIQUE constraint may be invented here.
    const uniques = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'shifts'::regclass AND contype = 'u'`);
    assert.strictEqual(uniques.rows.length, 0, "shifts has no UNIQUE constraint");

    // No foreign keys: Shift references no collection and nothing references it
    // by id (Employee matches shift names, Attendance has no shiftId, and the
    // Task table does not exist yet).
    const fks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'shifts'::regclass AND contype = 'f'`);
    assert.strictEqual(fks.rows.length, 0, "shifts has no foreign keys");

    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'shifts' ORDER BY indexname`);
    assert.deepStrictEqual(indexes.rows.map((r) => r.indexname), [
      "idx_shifts_active",
      "idx_shifts_active_created_at",
      "idx_shifts_active_updated_at_created_at",
      "idx_shifts_created_at",
      "idx_shifts_shift_name_lower",
      "shifts_pkey",
    ]);
  } finally {
    await pool.end();
  }
});

test("shifts defaults and nullability behave as the Mongo schema declares", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const id = () => crypto.randomBytes(12).toString("hex");
  try {
    // Defaults match the Mongoose schema defaults exactly.
    await pool.query(
      "INSERT INTO shifts (id, shift_name, start_time, end_time) VALUES ($1, 'Morning', '9:00 AM', '5:00 PM')",
      [id()]
    );
    const { rows } = await pool.query(
      "SELECT category, required_staff::text AS staff, active, notes FROM shifts WHERE shift_name = 'Morning'"
    );
    assert.strictEqual(rows[0].category, "General");
    assert.strictEqual(Number(rows[0].staff), 1);
    assert.strictEqual(rows[0].active, true);
    assert.strictEqual(rows[0].notes, "");

    const stamps = await pool.query(
      "SELECT created_at, updated_at FROM shifts WHERE shift_name = 'Morning'"
    );
    assert.ok(stamps.rows[0].created_at instanceof Date);
    assert.ok(stamps.rows[0].updated_at instanceof Date);

    // Duplicate shift names are ALLOWED: the schema declares no unique index and
    // no controller path rejects a duplicate, so PostgreSQL must not either.
    await pool.query(
      "INSERT INTO shifts (id, shift_name, start_time, end_time) VALUES ($1, 'Morning', '10:00 AM', '6:00 PM')",
      [id()]
    );
    const dupes = await pool.query("SELECT COUNT(*)::int AS n FROM shifts WHERE shift_name = 'Morning'");
    assert.strictEqual(dupes.rows[0].n, 2, "duplicate shift names coexist, exactly like Mongo");

    // category is free text in Mongo — the database must not constrain it.
    await pool.query(
      "INSERT INTO shifts (id, shift_name, start_time, end_time, category) VALUES ($1, 'Night', '10:00 PM', '6:00 AM', 'Security')",
      [id()]
    );

    // An overnight shift (end earlier than start) is a legal value: the schema
    // has no ordering rule and the wraparound lives in normalizeRange.
    await pool.query(
      "INSERT INTO shifts (id, shift_name, start_time, end_time) VALUES ($1, 'Overnight', '10:00 PM', '6:00 AM')",
      [id()]
    );

    // requiredStaff has no min in Mongo: fractional values are storable, so no
    // CHECK may reject them.
    await pool.query(
      "INSERT INTO shifts (id, shift_name, start_time, end_time, required_staff) VALUES ($1, 'Fractional', '9:00 AM', '5:00 PM', 1.5)",
      [id()]
    );

    // Nullability mirrors the schema's required fields.
    for (const col of ["shift_name", "start_time", "end_time"]) {
      await assert.rejects(
        pool.query(`UPDATE shifts SET ${col} = NULL WHERE shift_name = 'Night'`),
        /null value in column/,
        `shifts.${col} rejects NULL`
      );
    }
  } finally {
    await pool.end();
  }
});

// ─ Phase 2V: payroll_records migration ───────────────────────────────────
test("rollback of the Phase 2V payroll_records migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Simulate rolling back only migration 023: drop the payroll_records table
  // (and its tracking record). Every earlier table stays in place, so a re-run
  // must re-apply only 023 and rebuild payroll_records with its indexes.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS payroll_records CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '023_create_payroll_records.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*023_create_payroll_records\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.strictEqual(rows.length, 29);

  const tbl = await poolQuery(databaseUrl, "SELECT to_regclass('public.payroll_records') AS t");
  assert.ok(tbl[0].t, "payroll_records rebuilt after re-run");

  const indexes = await poolQuery(databaseUrl, `
    SELECT indexname FROM pg_indexes WHERE tablename = 'payroll_records' ORDER BY indexname`);
  assert.strictEqual(indexes.length, 6, "re-applied migration rebuilds the pkey, the UNIQUE index and 4 indexes");

  const { output: second } = runMigrate(databaseUrl);
  assert.match(second, /No pending migrations\./);
});

test("payroll_records migration creates the Mongo-mapped columns, NUMERIC money, constraints and indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'payroll_records' ORDER BY column_name`);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));

    // The exact projection: id + the 26 Mongo schema fields + the two timestamps.
    assert.strictEqual(cols.rows.length, 29, "exactly 29 mapped columns");

    const expected = {
      id: ["text", "NO"],
      employee_id: ["text", "NO"],
      employee_name: ["text", "NO"],
      department: ["text", "NO"],
      role: ["text", "NO"],
      month_key: ["text", "NO"],
      // Every monetary path is NUMERIC — never float/real/double precision.
      base_salary: ["numeric", "NO"],
      present_days: ["numeric", "NO"],
      absent_days: ["numeric", "NO"],
      leave_days: ["numeric", "NO"],
      half_days: ["numeric", "NO"],
      late_days: ["numeric", "NO"],
      extra_duty_days: ["numeric", "NO"],
      overtime_hours: ["numeric", "NO"],
      deduction: ["numeric", "NO"],
      extra_duty_pay: ["numeric", "NO"],
      bonus: ["numeric", "NO"],
      net_salary: ["numeric", "NO"],
      status: ["text", "NO"],
      payment_method: ["text", "NO"],
      transaction_id: ["text", "NO"],
      // paid_at is the schema's explicit `default: null`, so it is the one
      // nullable timestamp.
      paid_at: ["timestamp with time zone", "YES"],
      paid_by: ["text", "NO"],
      notes: ["text", "NO"],
      // razorpayOrderId / razorpayPaymentId / razorpaySignature declare no
      // default in the schema, so they are absent until the Razorpay flow runs.
      razorpay_order_id: ["text", "YES"],
      razorpay_payment_id: ["text", "YES"],
      razorpay_signature: ["text", "YES"],
      created_at: ["timestamp with time zone", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    };
    for (const [name, [type, nullable]] of Object.entries(expected)) {
      assert.ok(byName[name], `payroll_records.${name} exists`);
      assert.strictEqual(byName[name].data_type, type, `payroll_records.${name} type`);
      assert.strictEqual(byName[name].is_nullable, nullable, `payroll_records.${name} nullability`);
    }

    // No column may be a floating-point type — money must never lose precision.
    for (const [name, row] of Object.entries(byName)) {
      assert.ok(
        !/^(real|double precision)$/.test(row.data_type),
        `payroll_records.${name} must not be a floating-point type (got ${row.data_type})`
      );
    }
    for (const col of ["base_salary", "deduction", "extra_duty_pay", "bonus", "net_salary", "overtime_hours"]) {
      assert.strictEqual(byName[col].data_type, "numeric", `payroll_records.${col} is NUMERIC`);
    }

    // Defaults mirror the Mongoose schema defaults exactly.
    const defaults = {
      department: "''::text",
      role: "''::text",
      present_days: "0",
      absent_days: "0",
      leave_days: "0",
      half_days: "0",
      late_days: "0",
      extra_duty_days: "0",
      overtime_hours: "0",
      deduction: "0",
      extra_duty_pay: "0",
      bonus: "0",
      status: "'Pending'::text",
      payment_method: "'Bank Transfer'::text",
      transaction_id: "''::text",
      paid_by: "''::text",
      notes: "''::text",
    };
    for (const [col, def] of Object.entries(defaults)) {
      assert.strictEqual(byName[col].column_default, def, `payroll_records.${col} default`);
    }
    for (const col of ["paid_at", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]) {
      assert.strictEqual(byName[col].column_default, null, `payroll_records.${col} has no default`);
    }
    assert.match(byName.created_at.column_default, /now\(\)/);
    assert.match(byName.updated_at.column_default, /now\(\)/);

    // The unique index from the Mongo schema, exactly.
    const uniques = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'payroll_records'::regclass AND contype = 'u'`);
    assert.strictEqual(uniques.rows.length, 1, "one UNIQUE constraint");
    assert.match(
      uniques.rows[0].def,
      /UNIQUE \(employee_id, month_key\)/,
      "the Mongo compound unique index is reproduced verbatim"
    );

    // The two enums, exactly as declared.
    const checks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'payroll_records'::regclass AND contype = 'c'`);
    const defs = checks.rows.map((r) => r.def).sort();
    assert.ok(defs.some((d) => /status = ANY \(ARRAY\['Pending'::text, 'Paid'::text\]\)/.test(d)),
      "status CHECK mirrors the 2-value enum");
    assert.ok(defs.some((d) => /payment_method = ANY/.test(d) && /'Bank Transfer'::text/.test(d)
      && /'Net Banking'::text/.test(d)), "paymentMethod CHECK mirrors the 6-value enum");
    for (const col of ["base_salary", "net_salary", "present_days", "absent_days", "leave_days",
      "half_days", "late_days", "extra_duty_days", "overtime_hours", "deduction", "extra_duty_pay", "bonus"]) {
      assert.ok(defs.some((d) => d.includes(`${col} >= (0)::numeric`)),
        `payroll_records.${col} has the min: 0 CHECK`);
    }
    assert.ok(defs.some((d) => d.includes("month_key ~ '^[0-9]{4}-[0-9]{2}$'")),
      "month_key CHECK pins the YYYY-MM period shape");

    // No foreign keys, deliberately: employee_id points at an employees table
    // the live write path never populates, so an FK would reject writes Mongo
    // accepts (same decision as Phase 2S attendance and Phase 2T leaves).
    const fks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'payroll_records'::regclass AND contype = 'f'`);
    assert.strictEqual(fks.rows.length, 0, "payroll_records has no foreign keys");

    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'payroll_records' ORDER BY indexname`);
    assert.deepStrictEqual(indexes.rows.map((r) => r.indexname), [
      "idx_payroll_records_created_at",
      "idx_payroll_records_month_key",
      "idx_payroll_records_razorpay_order_id",
      "idx_payroll_records_status_month_key",
      "payroll_records_employee_id_month_key_key",
      "payroll_records_pkey",
    ]);
  } finally {
    await pool.end();
  }
});

test("payroll_records defaults, period semantics and money precision behave as the Mongo schema declares", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const id = () => crypto.randomBytes(12).toString("hex");
  const employeeA = id();
  const employeeB = id();
  try {
    // Defaults match the Mongoose schema defaults exactly.
    await pool.query(
      "INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary) VALUES ($1, $2, 'Asha', '2026-07', 30000, 30000)",
      [id(), employeeA]
    );
    const { rows } = await pool.query(
      `SELECT department, role, present_days::text AS present, status, payment_method,
              transaction_id, paid_at, paid_by, notes, extra_duty_pay::text AS extra
       FROM payroll_records WHERE employee_id = $1`,
      [employeeA]
    );
    assert.strictEqual(rows[0].department, "");
    assert.strictEqual(rows[0].role, "");
    assert.strictEqual(Number(rows[0].present), 0);
    assert.strictEqual(rows[0].status, "Pending");
    assert.strictEqual(rows[0].payment_method, "Bank Transfer");
    assert.strictEqual(rows[0].transaction_id, "");
    assert.strictEqual(rows[0].paid_at, null, "paidAt defaults to null");
    assert.strictEqual(rows[0].paid_by, "");
    assert.strictEqual(rows[0].notes, "");
    assert.strictEqual(Number(rows[0].extra), 0);

    // Money round-trips exactly — zero, integers, decimals and a large value.
    // Comparing NUMERIC::text avoids floating-point arithmetic entirely.
    const money = ["0", "1", "0.01", "1234.5678", "9999999999.99", "30000"];
    for (const amount of money) {
      const eid = id();
      await pool.query(
        `INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary,
          deduction, extra_duty_pay, bonus, net_salary, overtime_hours)
         VALUES ($1, $2, 'Money', '2026-08', $3, $3, $3, $3, $3, $3)`,
        [id(), eid, amount]
      );
      const back = await pool.query(
        `SELECT base_salary::text AS b, deduction::text AS d, extra_duty_pay::text AS e,
                bonus::text AS bo, net_salary::text AS n, overtime_hours::text AS o
         FROM payroll_records WHERE employee_id = $1`,
        [eid]
      );
      const r = back.rows[0];
      assert.strictEqual(Number(r.b), Number(amount), `base_salary round-trips ${amount}`);
      assert.strictEqual(Number(r.d), Number(amount), `deduction round-trips ${amount}`);
      assert.strictEqual(Number(r.e), Number(amount), `extra_duty_pay round-trips ${amount}`);
      assert.strictEqual(Number(r.bo), Number(amount), `bonus round-trips ${amount}`);
      assert.strictEqual(Number(r.n), Number(amount), `net_salary round-trips ${amount}`);
      assert.strictEqual(Number(r.o), Number(amount), `overtime_hours round-trips ${amount}`);
      // No silent rounding or truncation: the stored scale is preserved.
      assert.strictEqual(r.b, String(Number(amount)), `base_salary stored without truncation (${amount})`);
    }

    // The payroll period is the 'YYYY-MM' month key — one record per employee
    // per period, enforced exactly like the Mongo compound unique index.
    await assert.rejects(
      pool.query(
        "INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary) VALUES ($1, $2, 'Asha', '2026-07', 30000, 30000)",
        [id(), employeeA]
      ),
      /duplicate key value violates unique constraint "payroll_records_employee_id_month_key_key"/,
      "the same employee + period is rejected"
    );

    // A different employee in the same period is fine.
    await pool.query(
      "INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary) VALUES ($1, $2, 'Bilal', '2026-07', 25000, 25000)",
      [id(), employeeB]
    );
    // A different period for the same employee is fine — including across year
    // boundaries and the December / January edges.
    for (const month of ["2026-06", "2026-08", "2025-12", "2027-01"]) {
      await pool.query(
        "INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary) VALUES ($1, $2, 'Asha', $3, 30000, 30000)",
        [id(), employeeA, month]
      );
    }
    const periods = await pool.query(
      "SELECT month_key FROM payroll_records WHERE employee_id = $1 ORDER BY month_key",
      [employeeA]
    );
    assert.deepStrictEqual(periods.rows.map((r) => r.month_key),
      ["2025-12", "2026-06", "2026-07", "2026-08", "2027-01"]);

    // month_key stays TEXT so lexicographic comparison and $in membership behave
    // exactly as they do against the stored Mongo Strings.
    const inRange = await pool.query(
      "SELECT COUNT(*)::int AS n FROM payroll_records WHERE employee_id = $1 AND month_key >= '2026-01' AND month_key <= '2026-12'",
      [employeeA]
    );
    assert.strictEqual(inRange.rows[0].n, 3, "text range comparison matches the Mongo string semantics");

    // A malformed period is rejected — the shape payEmployeePayroll already
    // enforces with a 400 before it reaches a datasource.
    for (const bad of ["2026-7", "202607", "2026-13x", ""]) {
      await assert.rejects(
        pool.query(
          "INSERT INTO payroll_records (id, employee_id, employee_name, month_key, base_salary, net_salary) VALUES ($1, $2, 'Bad', $3, 1, 1)",
          [id(), id(), bad]
        ),
        /payroll_records_month_key_check|check constraint/,
        `month_key ${JSON.stringify(bad)} is rejected`
      );
    }

    // The enums are enforced.
    await assert.rejects(
      pool.query("UPDATE payroll_records SET status = 'Approved' WHERE employee_id = $1", [employeeA]),
      /payroll_records_status_check/,
      "only the two real statuses are storable"
    );
    await assert.rejects(
      pool.query("UPDATE payroll_records SET payment_method = 'Bitcoin' WHERE employee_id = $1", [employeeA]),
      /payroll_records_payment_method_check/,
      "only the six real payment methods are storable"
    );

    // min: 0 is enforced on the money and counter paths, exactly as Mongoose
    // rejects a negative value on create.
    await assert.rejects(
      pool.query("UPDATE payroll_records SET base_salary = -1 WHERE employee_id = $1", [employeeA]),
      /payroll_records_base_salary_check/,
      "negative base_salary is rejected"
    );
    await assert.rejects(
      pool.query("UPDATE payroll_records SET net_salary = -1 WHERE employee_id = $1", [employeeA]),
      /payroll_records_net_salary_check/,
      "negative net_salary is rejected"
    );

    // Nullability mirrors the schema's required fields.
    for (const col of ["employee_id", "employee_name", "month_key", "base_salary", "net_salary"]) {
      await assert.rejects(
        pool.query(`UPDATE payroll_records SET ${col} = NULL WHERE employee_id = $1`, [employeeB]),
        /null value in column/,
        `payroll_records.${col} rejects NULL`
      );
    }

    // paid_at is the one column that legitimately clears (the Razorpay branch
    // writes null).
    await pool.query("UPDATE payroll_records SET paid_at = NULL WHERE employee_id = $1", [employeeB]);
    const cleared = await pool.query(
      "SELECT paid_at FROM payroll_records WHERE employee_id = $1",
      [employeeB]
    );
    assert.strictEqual(cleared.rows[0].paid_at, null);
  } finally {
    await pool.end();
  }
});

// ─── Phase 2W: notifications ────────────────────────────────────────────────
test("rollback of the Phase 2W notifications migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);
  assert.match((await poolQuery(databaseUrl,
    "SELECT to_regclass('public.notifications') AS t"))[0].t || "", /notifications/);

  // Simulate rolling back only migration 024: drop the table and forget it.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS notifications CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '024_create_notifications.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*024_create_notifications\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);
});

test("notifications migration creates the Mongo-mapped columns, constraints and indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
    ORDER BY ordinal_position`);

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

  // Every persisted Mongoose field must have a column.
  for (const name of [
    "id", "title", "message", "audience_id", "audience_email", "audience_role",
    "category", "date", "viewed", "viewed_at", "read", "read_at", "attachment",
    "email_sent", "email_sent_at", "email_recipient", "created_at", "updated_at",
  ]) {
    assert.ok(byName[name], `missing column ${name}`);
  }

  // The Mongoose schema marks title/message required; everything else optional.
  assert.strictEqual(byName.title.is_nullable, "NO");
  assert.strictEqual(byName.message.is_nullable, "NO");
  for (const optional of [
    "audience_id", "audience_email", "audience_role", "category", "attachment",
    "email_recipient", "viewed_at", "read_at", "email_sent_at",
  ]) {
    assert.strictEqual(byName[optional].is_nullable, "YES", `${optional} should be nullable`);
  }

  // Mongoose booleans default to false.
  for (const flag of ["viewed", "read", "email_sent"]) {
    assert.strictEqual(byName[flag].data_type, "boolean");
    assert.strictEqual(byName[flag].is_nullable, "NO");
    assert.match(byName[flag].column_default, /false/);
  }

  // `date` defaults to Date.now in the schema.
  assert.strictEqual(byName.date.data_type, "timestamp with time zone");
  assert.match(byName.date.column_default, /now\(\)/);

  const indexes = await poolQuery(databaseUrl,
    "SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'");
  const idx = indexes.map((r) => r.indexname);
  // The four Mongoose indexes plus the primary key.
  assert.ok(idx.includes("notifications_pkey"), "primary key missing");
  assert.ok(idx.some((n) => /created_at/.test(n)), "createdAt index missing");
  assert.ok(idx.some((n) => /date/.test(n)), "date index missing");
  assert.ok(idx.some((n) => /audience_email/.test(n)), "audienceEmail index missing");
  assert.ok(idx.some((n) => /audience_role/.test(n)), "audienceRole index missing");
});

test("notifications defaults, nullability and read/viewed state behave as the Mongo schema declares", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const id = crypto.randomBytes(12).toString("hex");
  const inserted = await pgQuery(databaseUrl,
    `INSERT INTO notifications (id, title, message) VALUES ($1, 'T', 'M')
     RETURNING read, viewed, email_sent, read_at, viewed_at, date, created_at`,
    [id]);
  const row = inserted[0];

  // Schema defaults on a bare insert.
  assert.strictEqual(row.read, false);
  assert.strictEqual(row.viewed, false);
  assert.strictEqual(row.email_sent, false);
  assert.strictEqual(row.read_at, null);
  assert.strictEqual(row.viewed_at, null);
  assert.ok(row.date);
  assert.ok(row.created_at);

  // title/message are required — the NOT NULL guard rejects a missing message.
  await assert.rejects(
    () => pgQuery(databaseUrl, "INSERT INTO notifications (id, title) VALUES ($1, 'No message')", [id + "x"]),
    /null value in column "message"|not-null/,
  );
});

test("notifications read/readAt pair round-trips and supports unread-count queries", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const recipient = "unread-" + crypto.randomBytes(6).toString("hex") + "@example.com";
  for (let i = 0; i < 3; i += 1) {
    await pgQuery(databaseUrl,
      `INSERT INTO notifications (id, title, message, audience_email, audience_role)
       VALUES ($1, $2, 'M', $3, 'staff')`,
      [crypto.randomBytes(12).toString("hex"), `N${i}`, recipient]);
  }

  let count = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM notifications WHERE audience_email = $1 AND read = false", [recipient]);
  assert.strictEqual(count[0].c, 3);

  const readAt = new Date();
  await pgQuery(databaseUrl,
    "UPDATE notifications SET read = true, read_at = $2 WHERE audience_email = $1 AND title = 'N0'",
    [recipient, readAt]);

  count = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM notifications WHERE audience_email = $1 AND read = false", [recipient]);
  assert.strictEqual(count[0].c, 2);

  const marked = await pgQuery(databaseUrl,
    "SELECT read, read_at FROM notifications WHERE audience_email = $1 AND title = 'N0'", [recipient]);
  assert.strictEqual(marked[0].read, true);
  assert.ok(marked[0].read_at);
});

// ─── Phase 2X: events ───────────────────────────────────────────────────────
test("rollback of the Phase 2X events migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const before = await poolQuery(databaseUrl, "SELECT to_regclass('public.events') AS t");
  assert.match(before[0].t || "", /events/);

  // Simulate rolling back only migration 025: drop the table and forget it.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS events CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '025_create_events.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*025_create_events\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const after = await poolQuery(databaseUrl, "SELECT to_regclass('public.events') AS t");
  assert.match(after[0].t || "", /events/);
});

// ─── Phase 2Z: prasadams ────────────────────────────────────────────────────
test("rollback of the Phase 2Z prasadams migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const before = await poolQuery(databaseUrl, "SELECT to_regclass('public.prasadams') AS t");
  assert.match(before[0].t || "", /prasadams/);

  // Simulate rolling back only migration 027: drop the table and forget it.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS prasadams CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '027_create_prasadams.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*027_create_prasadams\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const after = await poolQuery(databaseUrl, "SELECT to_regclass('public.prasadams') AS t");
  assert.match(after[0].t || "", /prasadams/);
});

test("prasadams migration creates the Mongo-mapped columns, constraints and unique name", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prasadams'
    ORDER BY ordinal_position`);

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

  // Exactly the 7 mapped columns: id + the 4 schema fields + the 2 timestamps.
  // The `status` virtual is computed, not stored, so it is deliberately absent.
  assert.deepStrictEqual(cols.map((c) => c.column_name), [
    "id", "name", "price", "available_quantity", "minimum_stock", "created_at", "updated_at",
  ]);

  assert.strictEqual(byName.id.data_type, "text");
  assert.strictEqual(byName.id.is_nullable, "NO");

  // name is required non-empty TEXT.
  assert.strictEqual(byName.name.data_type, "text");
  assert.strictEqual(byName.name.is_nullable, "NO");

  // price is money → NUMERIC, never float/double, NOT NULL.
  assert.strictEqual(byName.price.data_type, "numeric");
  assert.strictEqual(byName.price.is_nullable, "NO");

  // The two quantities keep Mongo's bare-Number semantics (no integer cast)
  // and the schema's own `default: 0`.
  for (const name of ["available_quantity", "minimum_stock"]) {
    assert.strictEqual(byName[name].data_type, "numeric");
    assert.strictEqual(byName[name].is_nullable, "NO");
    assert.match(String(byName[name].column_default), /0/);
  }

  assert.strictEqual(byName.created_at.data_type, "timestamp with time zone");
  assert.match(String(byName.created_at.column_default), /now\(\)/);
  assert.strictEqual(byName.updated_at.data_type, "timestamp with time zone");
  assert.match(String(byName.updated_at.column_default), /now\(\)/);

  // `name unique: true` is preserved as a UNIQUE constraint.
  const unique = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'prasadams'::regclass AND contype = 'u'`);
  assert.ok(unique.length === 1, "exactly one UNIQUE constraint");
  assert.match(unique[0].def, /\(name\)/);

  // The only CHECK is the empty-name guard. The schema's `min: 0` ranges are
  // NOT constraints — see the divergence note in the migration: a negative
  // value is reachable through PUT /api/prasadam/:id today.
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'prasadams'::regclass AND contype = 'c'
    ORDER BY def`);
  assert.strictEqual(checks.length, 1, "only one CHECK constraint");
  assert.match(checks[0].def, /name <> ''::text/);

  const fks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'prasadams'::regclass AND contype = 'f'`);
  assert.strictEqual(fks.length, 0, "no foreign key on prasadams");

  // A duplicate name raises a unique violation (23505) — the constraint the
  // controller's 409 branch depends on.
  const idA = crypto.randomBytes(12).toString("hex");
  const idB = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO prasadams (id, name, price, available_quantity, minimum_stock) VALUES ($1, 'Laddu', 151, 10, 2)",
    [idA]);
  await assert.rejects(
    () => pgQuery(databaseUrl,
      "INSERT INTO prasadams (id, name, price, available_quantity, minimum_stock) VALUES ($1, 'Laddu', 20, 0, 0)",
      [idB]),
    /duplicate key value|23505/
  );

  // Money and fractional quantities round-trip exactly (NUMERIC, not float).
  // Comparisons are NUMERIC-value based (not textual scale): a JS number has no
  // trailing-zero scale, so the driver sends 25.5 and NUMERIC stores 25.5
  // exactly. What matters is that the value is preserved, not its display.
  const idC = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO prasadams (id, name, price, available_quantity, minimum_stock) VALUES ($1, 'Pongal', 25.50, 1000.125, 0.5)",
    [idC]);
  const exact = await pgQuery(databaseUrl,
    `SELECT price::text AS p, available_quantity::text AS q, minimum_stock::text AS m,
            price = 25.5::numeric AS p_eq,
            available_quantity = 1000.125::numeric AS q_eq,
            minimum_stock = 0.5::numeric AS m_eq
     FROM prasadams WHERE id = $1`,
    [idC]);
  assert.strictEqual(exact[0].p_eq, true);
  assert.strictEqual(exact[0].q_eq, true);
  assert.strictEqual(exact[0].m_eq, true);

  // A classic floating-point value (0.1 + 0.2) stays exact under NUMERIC, which
  // is the whole reason money is not stored as float/double.
  const idD = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO prasadams (id, name, price, available_quantity, minimum_stock) VALUES ($1, 'Float', 0.1, 0.3, 0)",
    [idD]);
  const floaty = await pgQuery(databaseUrl,
    "SELECT price = 0.1::numeric AS p, price::text AS p_text, available_quantity::text AS q FROM prasadams WHERE id = $1",
    [idD]);
  assert.strictEqual(floaty[0].p, true);
  assert.strictEqual(floaty[0].p_text, "0.1");
  assert.strictEqual(floaty[0].q, "0.3");
});

test("events migration creates the Mongo-mapped columns, constraints and indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
    ORDER BY ordinal_position`);

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

  // Exactly the 13 mapped columns: id + the 10 schema fields + the 2 timestamps.
  assert.deepStrictEqual(cols.map((c) => c.column_name), [
    "id", "title", "date", "end_date", "location", "description", "image",
    "slots", "registrations", "collection", "status", "created_at", "updated_at",
  ]);

  // date / endDate are absolute instants, never DATE and never TIME.
  assert.strictEqual(byName.date.data_type, "timestamp with time zone");
  assert.strictEqual(byName.date.is_nullable, "NO");
  assert.strictEqual(byName.end_date.data_type, "timestamp with time zone");
  assert.strictEqual(byName.end_date.is_nullable, "YES");

  // title / location are required non-empty TEXT.
  assert.strictEqual(byName.title.data_type, "text");
  assert.strictEqual(byName.title.is_nullable, "NO");
  assert.strictEqual(byName.location.is_nullable, "NO");

  // Optional text paths stay nullable.
  assert.strictEqual(byName.description.is_nullable, "YES");
  assert.strictEqual(byName.image.is_nullable, "YES");

  // The counters keep Mongo's bare-Number semantics (no integer cast).
  for (const name of ["slots", "registrations", "collection"]) {
    assert.strictEqual(byName[name].data_type, "numeric");
    assert.strictEqual(byName[name].is_nullable, "NO");
    assert.match(String(byName[name].column_default), /0/);
  }

  // status is NOT NULL with the schema default.
  assert.strictEqual(byName.status.is_nullable, "NO");
  assert.match(String(byName.status.column_default), /'Upcoming'/);

  assert.ok(byName.created_at);
  assert.ok(byName.updated_at);

  // The enum CHECK and the two non-empty CHECKs.
  const checks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'events'::regclass AND contype = 'c'`);
  const defs = checks.map((c) => c.def).join(" \n ");
  assert.match(defs, /status\s*= ANY \(ARRAY\['Upcoming'::text, 'Active'::text, 'Completed'::text, 'Cancelled'::text\]\)/i);
  assert.match(defs, /title <> ''::text/);
  assert.match(defs, /location <> ''::text/);

  // No foreign key is created on events (Event has no outbound reference).
  const fks = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'events'::regclass AND contype = 'f'`);
  assert.strictEqual(fks.length, 0, "events must declare no foreign key");

  const idx = (await poolQuery(databaseUrl,
    "SELECT indexname FROM pg_indexes WHERE tablename = 'events'")).map((r) => r.indexname);
  assert.ok(idx.includes("events_pkey"), "primary key missing");
  assert.ok(idx.includes("idx_events_date"), "date index missing");
  assert.ok(idx.includes("idx_events_status_date"), "status/date index missing");
});

test("events defaults, nullability and the status enum behave as the Mongo schema declares", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const id = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    `INSERT INTO events (id, title, date, location) VALUES ($1, 'T', $2, 'L')`,
    [id, new Date("2026-05-20T00:00:00Z")]);

  const rows = await pgQuery(databaseUrl,
    "SELECT status, slots, registrations, collection, end_date, description, image FROM events WHERE id = $1", [id]);
  assert.strictEqual(rows[0].status, "Upcoming");
  assert.strictEqual(Number(rows[0].slots), 0);
  assert.strictEqual(Number(rows[0].registrations), 0);
  assert.strictEqual(Number(rows[0].collection), 0);
  assert.strictEqual(rows[0].end_date, null);
  assert.strictEqual(rows[0].description, null);
  assert.strictEqual(rows[0].image, null);

  // The enum CHECK rejects an invented status.
  await assert.rejects(
    () => pgQuery(databaseUrl,
      "INSERT INTO events (id, title, date, location, status) VALUES ($1, 'T', now(), 'L', 'Published')",
      [id + "a"]),
    /events_status_check|violates check constraint/,
  );

  // title and location are required non-empty.
  await assert.rejects(
    () => pgQuery(databaseUrl, "INSERT INTO events (id, title, date, location) VALUES ($1, '', now(), 'L')", [id + "b"]),
    /events_title_check|violates check constraint/,
  );
  await assert.rejects(
    () => pgQuery(databaseUrl, "INSERT INTO events (id, title, date, location) VALUES ($1, 'T', now(), '')", [id + "c"]),
    /events_location_check|violates check constraint/,
  );
  await assert.rejects(
    () => pgQuery(databaseUrl, "INSERT INTO events (id, title, location) VALUES ($1, 'T', 'L')", [id + "d"]),
    /null value in column "date"|not-null/,
  );
});

test("events date ranges support the auto-complete and festival-overview predicates", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const insert = async (title, iso, status) => {
    const id = crypto.randomBytes(12).toString("hex");
    await pgQuery(databaseUrl,
      "INSERT INTO events (id, title, date, location, status) VALUES ($1, $2, $3, 'L', $4)",
      [id, title, new Date(iso), status]);
    return id;
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const nextMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 1);

  await insert("past-upcoming", "2020-01-05T00:00:00Z", "Upcoming");
  await insert("past-active", "2020-02-05T00:00:00Z", "Active");
  await insert("past-completed", "2020-03-05T00:00:00Z", "Completed");
  await insert("future", "2099-01-05T00:00:00Z", "Upcoming");

  // Auto-complete: { date: { $lt: todayStart }, status: { $in: ['Upcoming','Active'] } }
  const completed = await pgQuery(databaseUrl,
    `UPDATE events SET status = 'Completed'
      WHERE date < $1 AND status IN ('Upcoming', 'Active') RETURNING id`,
    [todayStart]);
  assert.strictEqual(completed.length, 2);

  const remainingUpcomingActive = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM events WHERE status IN ('Upcoming', 'Active')");
  assert.strictEqual(remainingUpcomingActive[0].c, 1);

  // Upcoming count: { date: { $gte: todayStart }, status: { $nin: [...] } }
  const upcoming = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM events WHERE date >= $1 AND (status IS NULL OR status NOT IN ('Completed','Cancelled'))",
    [todayStart]);
  assert.strictEqual(upcoming[0].c, 1);

  // Today's events: { date: { $gte: todayStart, $lt: tomorrowStart } }
  const todays = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM events WHERE date >= $1 AND date < $2",
    [todayStart, tomorrowStart]);
  assert.strictEqual(todays[0].c, 0);

  // Current month: { date: { $gte: monthStart, $lt: nextMonthStart } }
  const month = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM events WHERE date >= $1 AND date < $2",
    [monthStart, nextMonthStart]);
  assert.strictEqual(month[0].c, 0);

  // The two $group $sum aggregates the overview runs.
  const totals = await pgQuery(databaseUrl,
    "SELECT COALESCE(SUM(registrations),0)::text AS r, COALESCE(SUM(collection),0)::text AS c FROM events");
  assert.strictEqual(Number(totals[0].r), 0);
  assert.strictEqual(Number(totals[0].c), 0);
});

test("events timestamps round-trip the instant they were written with", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // UTC midnight (the create paths hand Mongoose the raw request string).
  const utcId = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO events (id, title, date, end_date, location) VALUES ($1, 'UTC', $2, $3, 'L')",
    [utcId, new Date("2026-05-20T00:00:00.000Z"), new Date("2026-05-22T00:00:00.000Z")]);
  const utc = await pgQuery(databaseUrl, "SELECT date, end_date FROM events WHERE id = $1", [utcId]);
  assert.strictEqual(utc[0].date.toISOString(), "2026-05-20T00:00:00.000Z");
  assert.strictEqual(utc[0].end_date.toISOString(), "2026-05-22T00:00:00.000Z");

  // Local midnight (devoteeController.updateEvent's setHours(0,0,0,0) branch).
  const local = new Date("2026-06-15T00:00:00");
  const localId = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO events (id, title, date, location) VALUES ($1, 'LOCAL', $2, 'L')",
    [localId, local]);
  const back = await pgQuery(databaseUrl, "SELECT date FROM events WHERE id = $1", [localId]);
  assert.strictEqual(back[0].date.getTime(), local.getTime());
});

// ─── Phase 2Y: poojas ───────────────────────────────────────────────────────
test("rollback of the Phase 2Y poojas migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const before = await poolQuery(databaseUrl, "SELECT to_regclass('public.poojas') AS t");
  assert.match(before[0].t || "", /poojas/);

  // Simulate rolling back only migration 026: drop the tables and forget them.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_required_materials CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS poojas CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_material_requirement_items CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pooja_material_requirements CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '026_create_poojas.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*026_create_poojas\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const after = await poolQuery(databaseUrl, "SELECT to_regclass('public.poojas') AS t");
  assert.match(after[0].t || "", /poojas/);
});

test("poojas migration creates the Mongo-mapped columns, constraints and indexes", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const cols = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'poojas'
    ORDER BY ordinal_position`);

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

  // Exactly the 17 mapped columns: id + the 15 schema fields + 2 timestamps.
  assert.deepStrictEqual(cols.map((c) => c.column_name), [
    "id", "name", "description", "price", "duration", "available_days",
    "available_dates", "available_start_time", "available_end_time",
    "minimum_advance_booking_days", "strict_advance_preparation", "rules",
    "instructions", "dress_code", "status", "created_at", "updated_at",
  ]);

  // price is money: bare NUMERIC (the repo convention — exact round-trip).
  assert.strictEqual(byName.price.data_type, "numeric");
  assert.strictEqual(byName.price.is_nullable, "NO");

  // availableDates is a [String] of "YYYY-MM-DD" calendar days, NOT a date
  // column, and availableDays/rules/instructions are [String] arrays.
  assert.strictEqual(byName.available_dates.data_type, "ARRAY");
  assert.strictEqual(byName.available_days.data_type, "ARRAY");
  assert.strictEqual(byName.rules.data_type, "ARRAY");
  assert.strictEqual(byName.instructions.data_type, "ARRAY");

  // availableStartTime / availableEndTime are plain "HH:mm" strings, never TIME.
  assert.strictEqual(byName.available_start_time.data_type, "text");
  assert.strictEqual(byName.available_end_time.data_type, "text");

  // Timestamps are instants.
  assert.strictEqual(byName.created_at.data_type, "timestamp with time zone");
  assert.strictEqual(byName.updated_at.data_type, "timestamp with time zone");

  // name is the only unique path; status carries the 2-value enum.
  const uniques = await poolQuery(databaseUrl, `
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'poojas'::regclass AND contype IN ('u','p')`);
  assert.ok(uniques.some((c) => c.conname === "poojas_name_key"), "name is UNIQUE");

  const checks = await poolQuery(databaseUrl, `
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'poojas'::regclass AND contype = 'c'`);
  // pg_get_constraintdef renders the literal as (price >= (0)::numeric) and the
  // enum as status = ANY (ARRAY['Active'::text, 'Inactive'::text]).
  assert.ok(checks.some((c) => /price >= \(?0\)?::numeric/.test(c.def) || /price >= 0/.test(c.def)), "price CHECK");
  assert.ok(checks.some((c) => c.def.includes("Active") && c.def.includes("Inactive")), "status CHECK");
});

test("poojas migration keeps the embedded material arrays as CASCADE children only", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // The two child tables carry the ONLY foreign keys introduced by 026, and
  // both are intra-migration ON DELETE CASCADE (embedded arrays of the parent).
  const childFks = await poolQuery(databaseUrl, `
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'pooja_required_materials'::regclass AND contype = 'f'`);
  assert.strictEqual(childFks.length, 1);
  assert.match(childFks[0].def, /REFERENCES poojas\(id\) ON DELETE CASCADE/);

  // No outbound FK to inventory_items: the Pooja sub-path is optional and a FK
  // would let a pooja row block an inventory item delete, which Mongo allows.
  const outbound = await poolQuery(databaseUrl, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'poojas'::regclass AND contype = 'f'`);
  assert.strictEqual(outbound.length, 0);

  // Deleting the parent removes its embedded rows (Mongo sub-document semantics).
  const poojaId = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO poojas (id, name, price) VALUES ($1, 'CascadeCheck', 10)", [poojaId]);
  await pgQuery(databaseUrl,
    `INSERT INTO pooja_required_materials (id, pooja_id, position, item_name, qty, unit)
     VALUES ($1, $2, 0, 'Camphor', 1, 'kg')`, [crypto.randomBytes(12).toString("hex"), poojaId]);

  await pgQuery(databaseUrl, "DELETE FROM poojas WHERE id = $1", [poojaId]);
  const orphans = await pgQuery(databaseUrl,
    "SELECT count(*)::int AS c FROM pooja_required_materials WHERE pooja_id = $1", [poojaId]);
  assert.strictEqual(orphans[0].c, 0);
});
// ─── Phase 2AA: settings (attendance_settings + priest_settings) ────────────
test("rollback of the Phase 2AA settings migration can be removed and reapplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const before = await poolQuery(databaseUrl, `
    SELECT to_regclass('public.attendance_settings') AS a, to_regclass('public.priest_settings') AS p`);
  assert.match(before[0].a || "", /attendance_settings/);
  assert.match(before[0].p || "", /priest_settings/);

  // Simulate rolling back only migration 028: drop both tables and forget it.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS priest_settings CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS attendance_settings CASCADE");
  await poolQuery(databaseUrl, "DELETE FROM schema_migrations WHERE name = '028_create_settings.sql'");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*028_create_settings\.sql/);
  assert.match(output, /Applied 1 migration\(s\)\./);

  const after = await poolQuery(databaseUrl, `
    SELECT to_regclass('public.attendance_settings') AS a, to_regclass('public.priest_settings') AS p`);
  assert.match(after[0].a || "", /attendance_settings/);
  assert.match(after[0].p || "", /priest_settings/);
});

test("settings migration creates the Mongo-mapped columns with the schema types and defaults", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const attendance = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_settings'
    ORDER BY ordinal_position`);
  const att = Object.fromEntries(attendance.map((c) => [c.column_name, c]));

  // Exactly the 8 mapped columns: id + the 5 schema fields + 2 timestamps.
  assert.deepStrictEqual(attendance.map((c) => c.column_name), [
    "id", "temple_latitude", "temple_longitude", "allowed_radius",
    "late_threshold", "early_check_in_window", "created_at", "updated_at",
  ]);

  // Every numeric path is bare NUMERIC (exact round-trip), never float/real.
  for (const name of ["temple_latitude", "temple_longitude", "allowed_radius", "late_threshold", "early_check_in_window"]) {
    assert.strictEqual(att[name].data_type, "numeric", `${name} must be numeric`);
    assert.strictEqual(att[name].is_nullable, "NO", `${name} must be NOT NULL`);
  }
  assert.match(String(att.temple_latitude.column_default), /0/);
  assert.match(String(att.allowed_radius.column_default), /100/);
  assert.match(String(att.late_threshold.column_default), /15/);
  assert.match(String(att.early_check_in_window.column_default), /30/);

  // Timestamps are real instants.
  assert.strictEqual(att.created_at.data_type, "timestamp with time zone");
  assert.strictEqual(att.updated_at.data_type, "timestamp with time zone");

  const priest = await poolQuery(databaseUrl, `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'priest_settings'
    ORDER BY ordinal_position`);
  const pr = Object.fromEntries(priest.map((c) => [c.column_name, c]));

  // Exactly the 8 mapped columns: id + priestId + the 4 toggles + 2 timestamps.
  assert.deepStrictEqual(priest.map((c) => c.column_name), [
    "id", "priest_id", "sms_notifications", "duty_reminders",
    "calendar_widget", "agama_reference_module", "created_at", "updated_at",
  ]);

  assert.strictEqual(pr.priest_id.data_type, "text");
  assert.strictEqual(pr.priest_id.is_nullable, "NO");

  // The four toggles are genuine BOOLEANs with the schema's asymmetric defaults.
  for (const name of ["sms_notifications", "duty_reminders", "calendar_widget"]) {
    assert.strictEqual(pr[name].data_type, "boolean", `${name} must be boolean`);
    assert.strictEqual(pr[name].is_nullable, "NO");
    assert.match(String(pr[name].column_default), /true/i);
  }
  assert.strictEqual(pr.agama_reference_module.data_type, "boolean");
  assert.match(String(pr.agama_reference_module.column_default), /false/i);
});

test("settings migration carries the priestId unique constraint and no foreign keys", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // attendance_settings declares NO unique constraint: the Mongo schema has no
  // unique index and the singleton is an application convention (findOne), so
  // inventing one here would reject a second row MongoDB accepts.
  const attUniques = await poolQuery(databaseUrl, `
    SELECT conname, contype FROM pg_constraint
    WHERE conrelid = 'attendance_settings'::regclass AND contype IN ('u','f')`);
  assert.deepStrictEqual(attUniques, [], "attendance_settings must declare no UNIQUE and no FK");

  // priest_settings reproduces Mongo's `unique: true` on priestId — and that is
  // the ONLY extra constraint. No foreign key (the Employee row is routinely
  // absent from PostgreSQL; see the migration's identity note).
  const prUniques = await poolQuery(databaseUrl, `
    SELECT conname, contype FROM pg_constraint
    WHERE conrelid = 'priest_settings'::regclass AND contype IN ('u','f')`);
  assert.strictEqual(prUniques.length, 1);
  assert.strictEqual(prUniques[0].contype, "u");
  assert.strictEqual(prUniques[0].conname, "priest_settings_priest_id_key");

  // No CHECK constraints on either table (neither schema declares an enum/min).
  const checks = await poolQuery(databaseUrl, `
    SELECT conrelid::regclass::text AS t FROM pg_constraint
    WHERE contype = 'c' AND conrelid IN ('attendance_settings'::regclass, 'priest_settings'::regclass)`);
  assert.deepStrictEqual(checks, [], "neither settings table declares a CHECK");

  // The three indexes the phase is responsible for, and nothing more.
  const idx = (await poolQuery(databaseUrl, `
    SELECT tablename, indexname FROM pg_indexes
    WHERE tablename IN ('attendance_settings', 'priest_settings')
    ORDER BY tablename, indexname`)).map((r) => `${r.tablename}.${r.indexname}`);
  assert.deepStrictEqual(idx, [
    "attendance_settings.attendance_settings_pkey",
    "priest_settings.priest_settings_pkey",
    "priest_settings.priest_settings_priest_id_key",
  ]);
});

test("settings tables reject NULL where the Mongo schema declares a non-null field", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  await assert.rejects(
    () => pgQuery(databaseUrl,
      "INSERT INTO attendance_settings (id, temple_latitude, temple_longitude, allowed_radius, late_threshold, early_check_in_window) VALUES ($1, NULL, 0, 100, 15, 30)",
      [crypto.randomBytes(12).toString("hex")]),
    /null value in column "temple_latitude"|not-null/,
  );

  await assert.rejects(
    () => pgQuery(databaseUrl,
      "INSERT INTO priest_settings (id, priest_id, sms_notifications, duty_reminders, calendar_widget, agama_reference_module) VALUES ($1, NULL, true, true, true, false)",
      [crypto.randomBytes(12).toString("hex")]),
    /null value in column "priest_id"|not-null/,
  );
});

test("settings defaults apply when only the primary key is supplied", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const attId = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl, "INSERT INTO attendance_settings (id) VALUES ($1)", [attId]);
  const att = await pgQuery(databaseUrl, `
    SELECT temple_latitude, temple_longitude, allowed_radius, late_threshold, early_check_in_window
    FROM attendance_settings WHERE id = $1`, [attId]);
  assert.strictEqual(Number(att[0].temple_latitude), 0);
  assert.strictEqual(Number(att[0].temple_longitude), 0);
  assert.strictEqual(Number(att[0].allowed_radius), 100);
  assert.strictEqual(Number(att[0].late_threshold), 15);
  assert.strictEqual(Number(att[0].early_check_in_window), 30);

  const priestId = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl, "INSERT INTO priest_settings (id, priest_id) VALUES ($1, $2)",
    [crypto.randomBytes(12).toString("hex"), priestId]);
  const pr = await pgQuery(databaseUrl, `
    SELECT sms_notifications, duty_reminders, calendar_widget, agama_reference_module
    FROM priest_settings WHERE priest_id = $1`, [priestId]);
  assert.strictEqual(pr[0].sms_notifications, true);
  assert.strictEqual(pr[0].duty_reminders, true);
  assert.strictEqual(pr[0].calendar_widget, true);
  assert.strictEqual(pr[0].agama_reference_module, false);
});

test("priest_settings enforces one settings document per priest", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const priestId = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl, "INSERT INTO priest_settings (id, priest_id) VALUES ($1, $2)",
    [crypto.randomBytes(12).toString("hex"), priestId]);
  await assert.rejects(
    () => pgQuery(databaseUrl, "INSERT INTO priest_settings (id, priest_id) VALUES ($1, $2)",
      [crypto.randomBytes(12).toString("hex"), priestId]),
    /priest_settings_priest_id_key|duplicate key value/,
  );

  // attendance_settings deliberately allows more than one row: the Mongo schema
  // declares no unique index, so a second insert must succeed here too.
  await pgQuery(databaseUrl, "INSERT INTO attendance_settings (id) VALUES ($1)",
    [crypto.randomBytes(12).toString("hex")]);
  await pgQuery(databaseUrl, "INSERT INTO attendance_settings (id) VALUES ($1)",
    [crypto.randomBytes(12).toString("hex")]);
  const count = await pgQuery(databaseUrl, "SELECT count(*)::int AS c FROM attendance_settings");
  assert.ok(count[0].c >= 2);
});

test("settings numeric columns round-trip decimal geofence coordinates exactly", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  const id = crypto.randomBytes(12).toString("hex");
  await pgQuery(databaseUrl,
    "INSERT INTO attendance_settings (id, temple_latitude, temple_longitude, allowed_radius, late_threshold, early_check_in_window) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, "17.385044", "78.486671", "150.5", "12.25", "45.75"]);
  const rows = await pgQuery(databaseUrl, `
    SELECT temple_latitude, temple_longitude, allowed_radius, late_threshold, early_check_in_window
    FROM attendance_settings WHERE id = $1`, [id]);
  // NUMERIC text round-trip — no floating point drift on the coordinates.
  assert.strictEqual(String(rows[0].temple_latitude), "17.385044");
  assert.strictEqual(String(rows[0].temple_longitude), "78.486671");
  assert.strictEqual(String(rows[0].allowed_radius), "150.5");
  assert.strictEqual(String(rows[0].late_threshold), "12.25");
  assert.strictEqual(String(rows[0].early_check_in_window), "45.75");
});
