const { Pool } = require("pg");

const DEFAULT_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_SSL_MODES = new Set([
  "require",
  "verify-ca",
  "verify-full",
]);

const parseSslModeFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("sslmode");
  } catch {
    return undefined;
  }
};

const resolveSsl = () => {
  const explicit = process.env.POSTGRES_SSL;
  if (explicit === "true" || explicit === "1") {
    return { rejectUnauthorized: false };
  }
  if (explicit === "false" || explicit === "0") {
    return undefined;
  }

  const sslMode = process.env.PGSSLMODE || parseSslModeFromUrl(process.env.DATABASE_URL);

  if (sslMode && sslMode !== "disable") {
    return DEFAULT_SSL_MODES.has(sslMode) && sslMode !== "require"
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }

  return undefined;
};

const resolveConfig = () => {
  const ssl = resolveSsl();
  const config = { connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS };

  if (process.env.PG_CONNECT_TIMEOUT_MS) {
    config.connectionTimeoutMillis = Number(process.env.PG_CONNECT_TIMEOUT_MS);
  }

  if (process.env.DATABASE_URL) {
    config.connectionString = process.env.DATABASE_URL;
  } else {
    config.host = process.env.PGHOST || "localhost";
    config.port = Number(process.env.PGPORT || 5432);
    config.database = process.env.PGDATABASE || "temple_billing";
    config.user = process.env.PGUSER;
    config.password = process.env.PGPASSWORD;
  }

  if (ssl) config.ssl = ssl;
  return config;
};

let pool = null;

const getPool = () => {
  if (pool) return pool;
  const config = resolveConfig();
  pool = new Pool(config);

  pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL pool error:", err);
  });

  return pool;
};

const hasPostgresConfig = () =>
  Boolean(
    process.env.DATABASE_URL ||
    process.env.PGHOST ||
    process.env.PGPORT ||
    process.env.PGDATABASE ||
    process.env.PGUSER ||
    process.env.PGPASSWORD
  );

const initPostgres = async () => {
  if (!hasPostgresConfig()) {
    console.log("PostgreSQL not configured; skipping connection.");
    return false;
  }
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
    return false;
  }
};

const isPostgresConnected = async () => {
  if (!hasPostgresConfig()) return false;
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};

const query = (text, params) => getPool().query(text, params);

// Runs `fn` inside ONE PostgreSQL transaction on a single pooled client.
// `fn` receives the client so every repository call in the unit of work shares
// the same connection. Repositories stay datasource-agnostic: they forward the
// optional client to `query` and never probe PostgreSQL themselves.
const runInTransaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const closePostgres = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = {
  getPool,
  initPostgres,
  isPostgresConnected,
  hasPostgresConfig,
  query,
  runInTransaction,
  closePostgres,
};