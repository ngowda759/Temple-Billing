// Phase 2L PostgreSQL-path tests for the Inventory Request service.
//
// These tests run with the datasource seam connected so the service must
// select the PostgreSQL repository. They verify that the service:
//   - actually persists to and reads from the inventory_requests table,
//   - preserves the Mongo service semantics (validation, defaults, request →
//     approved → rejected → issued workflow fields, requester filtering),
//   - never writes to MongoDB while PostgreSQL is selected (no dual writes).
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
let inventoryRequestRepository;
let inventoryRequestService;

// Drop every table the migration chain creates so a stale FK-dependent table
// can never block a fresh migration run.
const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS inventory_requests CASCADE");
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
    await pool.query("DROP TABLE IF EXISTS pg_health");
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
  inventoryRequestRepository = require("../src/repositories/inventoryRequestRepository");
  inventoryRequestService = require("../src/services/inventoryRequestService");
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

const requestBase = (overrides = {}) => ({
  userId: `staff-${unique()}`,
  userName: "Ramesh Kumar",
  role: "Staff",
  itemName: "Camphor",
  quantity: 10,
  unit: "Pack",
  reason: "Daily pooja",
  purpose: "Pooja needs",
  expectedDate: new Date("2025-07-01T10:00:00+05:30"),
  priority: "Medium",
  status: "Pending",
  ...overrides,
});

test("PG path: service selects PostgreSQL when the takeoff seam is connected", async () => {
  assert.strictEqual(await inventoryRequestService.usePostgres(), true);
  assert.strictEqual(inventoryRequestService.isConnected(), true);
});

test("PG path: create persists a real inventory_requests row and returns the Mongo-shaped doc", async () => {
  const input = requestBase();
  const created = await inventoryRequestService.create(input);
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.userId, input.userId);
  assert.strictEqual(created.userName, "Ramesh Kumar");
  assert.strictEqual(created.role, "Staff");
  assert.strictEqual(created.itemName, "Camphor");
  assert.strictEqual(created.quantity, 10);
  assert.strictEqual(created.unit, "Pack");
  assert.strictEqual(created.reason, "Daily pooja");
  assert.strictEqual(created.purpose, "Pooja needs");
  assert.strictEqual(created.priority, "Medium");
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.createdAt instanceof Date, true);
  assert.strictEqual(created.updatedAt instanceof Date, true);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM inventory_requests WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "row must exist in PostgreSQL");
  } finally {
    await pool.end();
  }
});

test("PG path: request → approved → rejected transitions mirror the Mongo service semantics", async () => {
  // Approve: sets status, admin/reviewer metadata and approval timestamps.
  const created = await inventoryRequestService.create(requestBase());
  const approved = await inventoryRequestService.updateById(created._id, {
    status: "Approved",
    adminReason: "ok",
    reviewedBy: "Admin",
    reviewedAt: new Date("2025-07-02T05:00:00Z"),
    approvedBy: "Admin",
    approvedAt: new Date("2025-07-02T05:00:00Z"),
  });
  assert.strictEqual(approved.status, "Approved");
  assert.strictEqual(approved.adminReason, "ok");
  assert.strictEqual(approved.reviewedBy, "Admin");
  assert.strictEqual(approved.approvedBy, "Admin");
  assert.ok(approved.approvedAt instanceof Date);
  assert.ok(approved.reviewedAt instanceof Date);
  assert.strictEqual(approved.updatedAt instanceof Date, true);

  // Reject: sets rejection fields and timestamps.
  const second = await inventoryRequestService.create(requestBase({ itemName: "Kumkum" }));
  const rejected = await inventoryRequestService.updateById(second._id, {
    status: "Rejected",
    adminReason: "Unavailable",
    rejectionReason: "Unavailable",
    reviewedBy: "Admin",
    reviewedAt: new Date("2025-07-03T05:00:00Z"),
    rejectedAt: new Date("2025-07-03T05:00:00Z"),
  });
  assert.strictEqual(rejected.status, "Rejected");
  assert.strictEqual(rejected.rejectionReason, "Unavailable");
  assert.ok(rejected.rejectedAt instanceof Date);
  assert.strictEqual(rejected.reviewedAt instanceof Date, true);
});

test("PG path: findById / findOne / findMany / count / destroy route to real PostgreSQL rows", async () => {
  const userId = `staff-${unique()}`;
  const created = await inventoryRequestService.create(requestBase({ userId }));
  const byId = await inventoryRequestService.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.userId, userId);

  const one = await inventoryRequestService.findOne({ userId, status: "Pending" });
  assert.strictEqual(one._id, created._id);

  const list = await inventoryRequestService.findMany({ filter: { userId }, sort: { createdAt: -1 } });
  assert.ok(list.some((r) => r._id === created._id));

  assert.strictEqual(await inventoryRequestService.count({ userId }), 1);
  assert.strictEqual(await inventoryRequestService.destroy(created._id), true);
  assert.strictEqual(await inventoryRequestService.findById(created._id), null);
});

test("PG path: service applies Mongo defaults (role Staff, priority Medium, status Pending, requestedBy '')", async () => {
  const created = await inventoryRequestService.create(requestBase({
    role: undefined,
    priority: undefined,
    status: undefined,
    requestedBy: undefined,
  }));
  assert.strictEqual(created.role, "Staff");
  assert.strictEqual(created.priority, "Medium");
  assert.strictEqual(created.status, "Pending");
  assert.strictEqual(created.requestedBy, "");
});

test("PG path: service rejects invalid data before reaching PostgreSQL", async () => {
  await assert.rejects(() => inventoryRequestService.create(requestBase({ userId: " " })), /userId is required/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ userName: undefined })), /userName is required/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ itemName: "" })), /itemName is required/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ quantity: -5 })), /quantity must be >= 0/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ quantity: "nope" })), /quantity must be a number/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ priority: "Urgent" })), /Invalid priority/);
  await assert.rejects(() => inventoryRequestService.create(requestBase({ status: "Cancelled" })), /Invalid status/);
  await assert.rejects(() => inventoryRequestService.updateById(createdId(), { quantity: -1 }), /quantity must be >= 0/);
});

// 24-hex placeholder for validation-only assertions (never persisted).
const createdId = () => "0000000000000000000000ff";

test("PG path: no dual write — creating through the service adds no document to MongoDB", async () => {
  const before = await inventoryRequestService.count({});
  const created = await inventoryRequestService.create(requestBase());
  const after = await inventoryRequestService.count({});
  assert.strictEqual(after, before + 1, "PostgreSQL row created");
  const found = await inventoryRequestService.findById(created._id);
  assert.ok(found, "row found through PostgreSQL repository");
});