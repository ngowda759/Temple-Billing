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
let inventoryRequestService;
let inventoryRequestRepository;
let inventoryRequestController;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_requests CASCADE");
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
    await pool.query("DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_tickets CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_requests CASCADE");
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
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;

  inventoryRequestService = require("../src/services/inventoryRequestService");
  inventoryRequestRepository = require("../src/repositories/inventoryRequestRepository");
  inventoryRequestController = require("../src/controllers/inventoryRequestController");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

const requestBase = (overrides = {}) => ({
  userId: `u-${unique()}`,
  userName: "Issue Tester",
  role: "Staff",
  itemName: `IssueItem-${unique()}`,
  quantity: 2,
  unit: "Pack",
  reason: "Phase 2AG issue path test",
  purpose: "Kitchen needs",
  status: "Approved",
  ...overrides,
});

// ─── PG-selected path: the issue operation is refused, never half-performed ──
test("PG path: issuing a PostgreSQL-backed request returns 409 with an explicit limitation", async () => {
  const request = await inventoryRequestRepository.create(requestBase({ status: "Approved" }));
  assert.ok(request._id, "request persisted to PostgreSQL");

  const res = createMockRes();
  await inventoryRequestController.issueInventoryRequest({ params: { id: request._id } }, res);

  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /not yet available for requests stored in PostgreSQL/);
});

test("PG path: the 409 refusal leaves the request status and stock untouched (no partial state)", async () => {
  const itemName = `IssueItem-${unique()}`;
  const inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
  const item = await inventoryItemRepository.create({
    name: itemName,
    unit: "Pack",
    availableStock: 50,
    issuedStock: 0,
  });

  const request = await inventoryRequestRepository.create(
    requestBase({ itemName, quantity: 5, status: "Approved" })
  );

  const res = createMockRes();
  await inventoryRequestController.issueInventoryRequest({ params: { id: request._id } }, res);
  assert.strictEqual(res.statusCode, 409);

  const rereadRequest = await inventoryRequestRepository.findById(request._id);
  assert.strictEqual(rereadRequest.status, "Approved", "request status was not advanced to Issued");

  const rereadItem = await inventoryItemRepository.findById(item._id);
  assert.strictEqual(Number(rereadItem.availableStock), 50, "available stock was not decremented");
  assert.strictEqual(Number(rereadItem.issuedStock), 0, "issued stock was not incremented");

  // No inventory_issues table exists in PostgreSQL, so nothing could have been
  // written there either — the operation is genuinely all-or-nothing.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_issues') AS exists"
    );
    assert.strictEqual(rows[0].exists, false, "inventory_issues still has no PostgreSQL table");
  } finally {
    await pool.end();
  }
});

// ─── Mongo fallback: the whole issue operation stays on one datasource ───────
test("fallback: issuing performs the full operation inside one Mongo transaction and writes no PostgreSQL rows", async () => {
  const mongoose = require("mongoose");
  const InventoryRequestModel = require("../src/models/InventoryRequest");
  const InventoryItemModel = require("../src/models/InventoryItem");
  const InventoryIssueModel = require("../src/models/InventoryIssue");
  const notificationPersistenceService = require("../src/services/notificationPersistenceService");
  const fileNotificationStore = require("../src/store/fileNotificationStore");

  const originals = {
    startSession: mongoose.startSession,
    reqFindById: InventoryRequestModel.findById,
    itemFind: InventoryItemModel.find,
    issueCreate: InventoryIssueModel.create,
    persistNotify: notificationPersistenceService.create,
    fileNotify: fileNotificationStore.createNotification,
  };

  const transactionCalls = [];
  let notifications = 0;

  const inventoryItem = {
    _id: "item-1",
    name: "Ghee",
    unit: "Litre",
    availableStock: 10,
    issuedStock: 0,
    minimumStock: 1,
    save: async () => {
      transactionCalls.push("inventoryItem.save");
    },
  };

  const request = {
    _id: "req-1",
    itemName: "Ghee",
    quantity: 3,
    unit: "Litre",
    userId: "u-1",
    userName: "Fallback User",
    role: "Staff",
    purpose: "Kitchen",
    status: "Approved",
    save: async () => {
      transactionCalls.push("request.save");
    },
  };

  mongoose.startSession = async () => {
    const session = {
      withTransaction: async (fn) => {
        transactionCalls.push("begin");
        await fn();
        transactionCalls.push("commit");
      },
      endSession: () => {},
    };
    return session;
  };

  const sessionable = (value) => ({ session: async () => value });
  InventoryRequestModel.findById = () => sessionable(request);
  InventoryItemModel.find = () => sessionable([inventoryItem]);
  InventoryIssueModel.create = async () => {
    transactionCalls.push("issue.create");
    return [{ _id: "issue-1", issuedQuantity: 3 }];
  };
  notificationPersistenceService.create = async () => {
    notifications += 1;
    return { _id: "notification-1" };
  };
  fileNotificationStore.createNotification = async () => {
    notifications += 1;
    return { _id: "notification-file-1" };
  };

  const pool = new Pool({ connectionString: TEST_DB_URL });
  const countRequests = async () => {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM inventory_requests");
    return rows[0].n;
  };

  dbConfig.isDbConnected = () => false;
  try {
    const before = await countRequests();
    const res = createMockRes();
    await inventoryRequestController.issueInventoryRequest({ params: { id: "req-1" } }, res);

    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.success, true);

    // Every write happened inside the single Mongo transaction, in order.
    assert.deepStrictEqual(transactionCalls, [
      "begin",
      "inventoryItem.save",
      "request.save",
      "issue.create",
      "commit",
    ]);
    assert.strictEqual(request.status, "Issued");
    assert.strictEqual(inventoryItem.availableStock, 7);
    assert.strictEqual(inventoryItem.issuedStock, 3);
    assert.ok(notifications >= 1, "an issue notification was dispatched");

    const after = await countRequests();
    assert.strictEqual(after, before, "the Mongo path wrote no PostgreSQL rows");
  } finally {
    dbConfig.isDbConnected = () => true;
    mongoose.startSession = originals.startSession;
    InventoryRequestModel.findById = originals.reqFindById;
    InventoryItemModel.find = originals.itemFind;
    InventoryIssueModel.create = originals.issueCreate;
    notificationPersistenceService.create = originals.persistNotify;
    fileNotificationStore.createNotification = originals.fileNotify;
    await pool.end();
  }
});

test("fallback: the issue handler never dual-writes across PostgreSQL and MongoDB", async () => {
  const request = await inventoryRequestRepository.create(requestBase({ status: "Approved" }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  const countRequests = async () => {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM inventory_requests");
    return rows[0].n;
  };

  try {
    const before = await countRequests();
    const res = createMockRes();
    await inventoryRequestController.issueInventoryRequest({ params: { id: request._id } }, res);
    const after = await countRequests();
    assert.strictEqual(after, before, "no extra PostgreSQL write on the refused issue path");
  } finally {
    await pool.end();
  }
});