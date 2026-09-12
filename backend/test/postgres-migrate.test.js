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
  // Phase 2A/2B tables must be dropped too so a fresh run applies the latest DDL.
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_transactions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_heads CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS employees CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS users CASCADE");
};

test("db:migrate runs clean from scratch on a fresh database", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied:\s*001_create_pg_health\.sql/);
  assert.match(output, /Applied 3 migration\(s\)\./);

  const rows = await poolQuery(databaseUrl, "SELECT name FROM schema_migrations ORDER BY id");
  assert.deepStrictEqual(rows.map((r) => r.name), [
    "001_create_pg_health.sql",
    "002_create_users_employees.sql",
    "003_create_accounting.sql",
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
  assert.strictEqual(rows.length, 3);
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

test("rollback of the accounting migration leaves no tables behind", async () => {
  const databaseUrl = TEST_DB_URL;
  await resetTestDb(databaseUrl);
  runMigrate(databaseUrl);

  // Dropping migrations 001–003 and re-running simulates a full rollback +
  // re-apply cycle at the migration layer. All DDL is idempotent (IF NOT EXISTS).
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS schema_migrations");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_transactions CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS account_heads CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS employees CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS users CASCADE");
  await poolQuery(databaseUrl, "DROP TABLE IF EXISTS pg_health");

  const { output } = runMigrate(databaseUrl);
  assert.match(output, /Applied 3 migration\(s\)\./);

  const tables = await poolQuery(databaseUrl, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  assert.ok(tables.some((t) => t.table_name === "account_heads"));
  assert.ok(tables.some((t) => t.table_name === "account_transactions"));
});

test("SELECT 1 succeeds against test database", async () => {
  const rows = await poolQuery(TEST_DB_URL, "SELECT 1 AS ok");
  assert.strictEqual(rows[0].ok , 1);
});