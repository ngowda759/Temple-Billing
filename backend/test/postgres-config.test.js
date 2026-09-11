const test = require("node:test");
const assert = require("node:assert");
const { hasPostgresConfig } = require("../src/config/postgres");

const PG_VARS = [
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "POSTGRES_SSL",
  "PG_CONNECT_TIMEOUT_MS",
  "PGSSLMODE",
];

const clearEnv = () => {
  for (const name of PG_VARS) delete process.env[name];
};

test("hasPostgresConfig: DATABASE_URL alone enables PostgreSQL", () => {
  clearEnv();
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
  assert.strictEqual(hasPostgresConfig(), true);
  delete process.env.DATABASE_URL;
  clearEnv();
});

test("hasPostgresConfig: individual PG* variables enable PostgreSQL", () => {
  clearEnv();
  process.env.PGHOST = "localhost";
  process.env.PGPORT = "5432";
  process.env.PGDATABASE = "temple_billing";
  process.env.PGUSER = "u";
  process.env.PGPASSWORD = "p";
  assert.strictEqual(hasPostgresConfig(), true);
  clearEnv();
});

test("hasPostgresConfig: no connection config means skipped", () => {
  clearEnv();
  assert.strictEqual(hasPostgresConfig(), false);
});

test("hasPostgresConfig: POSTGRES_SSL alone does not enable PostgreSQL", () => {
  clearEnv();
  process.env.POSTGRES_SSL = "true";
  assert.strictEqual(hasPostgresConfig(), false);
  delete process.env.POSTGRES_SSL;
  clearEnv();
});

test("hasPostgresConfig: PG_CONNECT_TIMEOUT_MS alone does not enable PostgreSQL", () => {
  clearEnv();
  process.env.PG_CONNECT_TIMEOUT_MS = "3000";
  assert.strictEqual(hasPostgresConfig(), false);
  delete process.env.PG_CONNECT_TIMEOUT_MS;
  clearEnv();
});

test("hasPostgresConfig: PGSSLMODE alone does not enable PostgreSQL", () => {
  clearEnv();
  process.env.PGSSLMODE = "require";
  assert.strictEqual(hasPostgresConfig(), false);
  delete process.env.PGSSLMODE;

  clearEnv();
});