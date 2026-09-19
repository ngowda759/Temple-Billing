// Phase 2AD — Datasource Seam Unification tests.
//
// Phase 2AC found 22 modules that captured the datasource seam at require time:
//
//   const { isDbConnected } = require("../config/db");
//
// `isDbConnected` itself reads live mongoose state, so production routing was
// unaffected — but reassigning `dbConfig.isDbConnected` (the test seam) was
// invisible to those modules once loaded. Datasource switching was therefore
// only testable for modules loaded *after* the pin.
//
// Phase 2AD replaces every such capture with a call-time read through the
// config module (`dbConfig.isDbConnected()`). These tests prove the seam is
// now read at call time on already-loaded modules, that PG reachability still
// gates the PostgreSQL path at the service layer, and that no dual writes are
// introduced.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const dbConfig = require("../src/config/db");
const { closePostgres } = require("../src/config/postgres");
const inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
const donationRepository = require("../src/repositories/donationRepository");
const InventoryItem = require("../src/models/InventoryItem");
const Donation = require("../src/models/Donation");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

// The 22 modules Phase 2AC flagged with a require-time destructure.
const PREVIOUSLY_STALE = [
  "src/controllers/authController.js",
  "src/controllers/devoteeController.js",
  "src/repositories/accountHeadRepository.js",
  "src/repositories/accountTransactionRepository.js",
  "src/repositories/billItemRepository.js",
  "src/repositories/billRepository.js",
  "src/repositories/bookingRepository.js",
  "src/repositories/donationRepository.js",
  "src/repositories/employeeRepository.js",
  "src/repositories/inventoryItemRepository.js",
  "src/repositories/poojaBookingRepository.js",
  "src/repositories/prasadamOrderRepository.js",
  "src/repositories/userRepository.js",
  "src/services/accountHeadService.js",
  "src/services/accountTransactionService.js",
  "src/services/billService.js",
  "src/services/bookingService.js",
  "src/services/donationService.js",
  "src/services/inventoryItemService.js",
  "src/services/poojaBookingService.js",
  "src/services/prasadamOrderService.js",
  "src/services/userEmployeeService.js",
];

const BACKEND_ROOT = path.join(__dirname, "..");

// The service-level datasource gate is authoritative (Phase 2AD decision:
// repository-level PostgreSQL probing is DEFERRED). These are the services that
// expose the gate and must follow it at call time.
const GATE_A_SERVICES = [
  "accountHeadService",
  "accountTransactionService",
  "billService",
  "bookingService",
  "donationService",
  "poojaBookingService",
  "userEmployeeService",
];

const GATE_B_SERVICES = ["inventoryItemService", "prasadamOrderService"];

let originalIsDbConnected;
let originalDatabaseUrl;
let services = {};

const pinConnected = () => { dbConfig.isDbConnected = () => true; };
const pinDisconnected = () => { dbConfig.isDbConnected = () => false; };

const runMigrate = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, `migrate failed: ${res.stdout}\n${res.stderr}`);
};

const rowCount = async (table) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    return rows[0].n;
  } finally {
    await pool.end();
  }
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  originalDatabaseUrl = process.env.DATABASE_URL;

  // Pin the seam to DISCONNECTED *before* loading every previously-stale module.
  // This is the trap: a require-time destructure freezes `false` here, so the
  // modules below would never observe a later flip.
  pinDisconnected();

  for (const name of [...GATE_A_SERVICES, ...GATE_B_SERVICES]) {
    services[name] = require(`../src/services/${name}`);
  }

  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;

  runMigrate();
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  await closePostgres();
});

// ─── Requirement: the 22 stale references are eliminated ───────────────────
test("seam: no module captures isDbConnected at require time", () => {
  const offenders = [];
  for (const rel of PREVIOUSLY_STALE) {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, rel), "utf8");
    if (/const\s*\{\s*isDbConnected\s*\}\s*=\s*require/.test(source)) offenders.push(rel);
  }
  assert.deepStrictEqual(offenders, [], `require-time destructures remain: ${offenders.join(", ")}`);
});

test("seam: every previously-stale module reads the seam through the config module", () => {
  for (const rel of PREVIOUSLY_STALE) {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, rel), "utf8");
    assert.match(source, /dbConfig\.isDbConnected\(\)/, `${rel} must read dbConfig.isDbConnected() at call time`);
  }
});

test("seam: no repository performs an independent PostgreSQL connectivity probe", () => {
  const repoDir = path.join(BACKEND_ROOT, "src", "repositories");
  const offenders = fs
    .readdirSync(repoDir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => /isPostgresConnected\s*\(/.test(fs.readFileSync(path.join(repoDir, f), "utf8")));
  assert.deepStrictEqual(offenders, [], `repositories must not probe PostgreSQL (deferred): ${offenders.join(", ")}`);
});

// ─── Scenario A: PostgreSQL available → PostgreSQL path used ───────────────
test("Scenario A: PostgreSQL available selects the PostgreSQL path", async () => {
  pinConnected();
  for (const name of GATE_A_SERVICES) {
    assert.strictEqual(services[name].isConnected(), true, `${name}.isConnected()`);
  }
  for (const name of GATE_B_SERVICES) {
    assert.strictEqual(await services[name].usePostgres(), true, `${name}.usePostgres()`);
    assert.strictEqual(services[name].isConnected(), true, `${name}.isConnected()`);
  }
});

// ─── Scenario B: PostgreSQL unavailable → MongoDB fallback ─────────────────
test("Scenario B: MongoDB fallback when PostgreSQL is unavailable", async () => {
  const saved = process.env.DATABASE_URL;
  try {
    // The seam says connected, but PostgreSQL is unreachable: a Gate-B service
    // must still fall back, so Mongo readiness is never treated as proof PG works.
    pinConnected();
    process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nope";
    await closePostgres();
    for (const name of GATE_B_SERVICES) {
      assert.strictEqual(await services[name].usePostgres(), false, `${name} falls back when PG unreachable`);
    }
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
  }

  // The seam itself drives the fallback too.
  pinDisconnected();
  for (const name of [...GATE_A_SERVICES, ...GATE_B_SERVICES]) {
    assert.strictEqual(services[name].isConnected(), false, `${name}.isConnected()`);
  }
  for (const name of GATE_B_SERVICES) {
    assert.strictEqual(await services[name].usePostgres(), false, `${name}.usePostgres()`);
  }
});

// ─── Scenario C: PostgreSQL → MongoDB → PostgreSQL without a restart ───────
test("Scenario C: switching datasource mid-process is reflected on already-loaded modules", async () => {
  pinDisconnected();
  assert.strictEqual(services.bookingService.isConnected(), false);
  assert.strictEqual(await services.inventoryItemService.usePostgres(), false);

  pinConnected();
  assert.strictEqual(services.bookingService.isConnected(), true);
  assert.strictEqual(await services.inventoryItemService.usePostgres(), true);

  pinDisconnected();
  assert.strictEqual(services.bookingService.isConnected(), false);
  assert.strictEqual(await services.inventoryItemService.usePostgres(), false);

  pinConnected();
  assert.strictEqual(services.bookingService.isConnected(), true);
  assert.strictEqual(await services.inventoryItemService.usePostgres(), true);
});

// ─── Scenario D: a stale module-load-time reference cannot win ─────────────
test("Scenario D: modules loaded while disconnected observe a later connection", () => {
  // Every module below was loaded in test.before() with the seam pinned
  // DISCONNECTED. A require-time destructure would still report false here.
  pinConnected();
  for (const name of [...GATE_A_SERVICES, ...GATE_B_SERVICES]) {
    assert.strictEqual(services[name].isConnected(), true, `${name} ignored the load-time pin`);
  }

  pinDisconnected();
  for (const name of [...GATE_A_SERVICES, ...GATE_B_SERVICES]) {
    assert.strictEqual(services[name].isConnected(), false, `${name} ignored the current pin`);
  }
});

test("Scenario D: a repository module loaded earlier switches datasource mid-process", async () => {
  // donationRepository was required at the top of this file, before any pin.
  // Without call-time reads it would have frozen that initial value and the
  // assertions below would fail.
  const originalFindById = Donation.findById;
  Donation.findById = async () => ({ _id: "seam-mongo-switch", donorName: "Mongo Path" });

  try {
    dbConfig.isDbConnected = () => true;
    assert.strictEqual(
      await donationRepository.findById("0000000000000000000000aa"),
      null,
      "the PostgreSQL branch ran (no such PG row) rather than the Mongo stub"
    );

    dbConfig.isDbConnected = () => false;
    const viaMongo = await donationRepository.findById("0000000000000000000000aa");
    assert.strictEqual(viaMongo._id, "seam-mongo-switch", "the same loaded repository now used MongoDB");

    dbConfig.isDbConnected = () => true;
    assert.strictEqual(
      await donationRepository.findById("0000000000000000000000aa"),
      null,
      "and back to PostgreSQL without a reload"
    );
  } finally {
    Donation.findById = originalFindById;
  }
});

// ─── Scenario E: PostgreSQL repositories depend on the service gate only ───
test("Scenario E: repositories follow the service gate and do not probe PostgreSQL themselves", () => {
  const repoDir = path.join(BACKEND_ROOT, "src", "repositories");
  for (const f of fs.readdirSync(repoDir).filter((n) => n.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(repoDir, f), "utf8");
    assert.doesNotMatch(source, /isPostgresConnected\s*\(/, `${f} must not probe PostgreSQL`);
    assert.match(source, /dbConfig\.isDbConnected\(\)/, `${f} must read the seam at call time`);
  }
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("no dual write: a PostgreSQL write reaches PostgreSQL and not MongoDB", async () => {
  const originalCreate = InventoryItem.create;
  let mongoWrites = 0;
  InventoryItem.create = async (...args) => { mongoWrites += 1; return originalCreate.apply(InventoryItem, args); };

  try {
    pinConnected();
    const before = await rowCount("inventory_items");
    const created = await inventoryItemRepository.create({
      name: `Seam-PG-${Date.now()}`,
      unit: "Pack",
      availableStock: 3,
      minimumStock: 0,
    });
    const after = await rowCount("inventory_items");
    assert.ok(created._id, "PostgreSQL returned a row");
    assert.strictEqual(after, before + 1, "exactly one PostgreSQL row written");
    assert.strictEqual(mongoWrites, 0, "MongoDB must not be written on the PostgreSQL path");
  } finally {
    InventoryItem.create = originalCreate;
  }
});

test("no dual write: the MongoDB fallback writes MongoDB and not PostgreSQL", async () => {
  const originalCreate = Donation.create;
  let mongoWrites = 0;
  Donation.create = async (payload) => { mongoWrites += 1; return { _id: "seam-mongo-1", ...payload }; };

  try {
    pinDisconnected();
    const before = await rowCount("donations");
    const created = await donationRepository.create({
      donorName: "Seam Fallback",
      amount: 11,
      category: "General",
      paymentMethod: "Cash",
      status: "Completed",
    });
    const after = await rowCount("donations");
    assert.strictEqual(created._id, "seam-mongo-1", "MongoDB handled the write");
    assert.strictEqual(mongoWrites, 1, "exactly one MongoDB write");
    assert.strictEqual(after, before, "the MongoDB fallback must not write PostgreSQL");
  } finally {
    Donation.create = originalCreate;
  }
});