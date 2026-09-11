require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getPool } = require("../config/postgres");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
// App-specific advisory lock key (fixed constant) so concurrent runners exclude each other.
const MIGRATE_LOCK_KEY = 727271701;

const ensureTrackingTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const appliedNames = async (client) => {
  const result = await client.query("SELECT name FROM schema_migrations");
  return new Set(result.rows.map((row) => row.name));
};

const listMigrationFiles = () =>
  fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

const runPendingMigrations = async () => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Serialize migration runs across processes; released in the finally below.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);

    await client.query("BEGIN");
    await ensureTrackingTable(client);
    await client.query("COMMIT");

    const applied = await appliedNames(client);
    const files = listMigrationFiles();
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log("No pending migrations.");
      return { applied: 0 };
    }

    const results = [];

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied: ${file}`);
        results.push({ file, status: "applied" });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`Migration failed: ${file}`);
        console.error(error.message);
        results.push({ file, status: "failed", error: error.message });
        throw new Error(`Migration ${file} failed — ${error.message}`);
      }
    }

    return { applied: results.length, results };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {});
    client.release();
  }
};

const main = async () => {
  try {
    const summary = await runPendingMigrations();
    console.log(`Migrations complete. Applied ${summary.applied} migration(s).`);
  } catch (error) {
    console.error("db:migrate failed:");
    console.error(error);
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = { runPendingMigrations };
