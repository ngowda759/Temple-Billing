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
const emailFor = (tag) => `${tag}-${unique()}@example.com`;

let originalIsDbConnected;
let prasadamOrderRepository;
let prasadamOrderService;

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
  // The repositories/services gate on mongoose's connectivity flag as the
  // datasource-selection seam (see test/postgres-repositories.test.js). We pin
  // it to "connected" so the PostgreSQL branch is exercised deterministically.
  dbConfig.isDbConnected = () => true;
  prasadamOrderRepository = require("../src/repositories/prasadamOrderRepository");
  prasadamOrderService = require("../src/services/prasadamOrderService");
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

const orderBase = (overrides = {}) => ({
  channel: "devotee",
  devoteeId: undefined,
  devoteeName: `Radha ${unique()}`,
  email: emailFor("prasadam"),
  phone: "9876543210",
  address: "Temple Street",
  itemName: "Pongal Prasadam",
  quantity: 2,
  unitPrice: 25.5,
  amount: 51,
  paymentMethod: "UPI",
  status: "Not Collected",
  ...overrides,
});

// ─── PostgreSQL path: repository and service round trips ───────────────────
test("service: uses PostgreSQL when Prasadam Order path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await prasadamOrderService.usePostgres(), true);
  assert.strictEqual(prasadamOrderService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const input = orderBase();
  const order = await prasadamOrderService.create(input);

  assert.ok(order._id);
  assert.match(order._id, /^[0-9a-f]{24}$/); // same shape Mongoose would return
  assert.strictEqual(order.devoteeName, input.devoteeName);
  assert.strictEqual(order.email, input.email);
  assert.strictEqual(order.itemName, "Pongal Prasadam");
  assert.strictEqual(Number(order.quantity), 2);
  assert.strictEqual(Number(order.unitPrice), 25.5);
  assert.strictEqual(Number(order.amount), 51);
  assert.strictEqual(order.paymentMethod, "UPI");
  assert.strictEqual(order.status, "Not Collected");
  assert.strictEqual(order.channel, "devotee");
  assert.ok(order.createdAt instanceof Date, "createdAt is a Date");

  const read = await prasadamOrderService.findById(order._id);
  assert.strictEqual(read._id, order._id);
  assert.strictEqual(read.devoteeName, input.devoteeName);
  assert.strictEqual(read.email, input.email);
});

test("PG path: amount/unitPrice keep their decimal scale in the database", async () => {
  const created = await prasadamOrderRepository.create(orderBase({ amount: "10.50", unitPrice: "5.25" }));
  const row = await prasadamOrderService.findById(created._id);
  assert.strictEqual(Number(row.amount), 10.5);
  assert.strictEqual(Number(row.unitPrice), 5.25);
});

test("PG path: create validates model enums and required fields", async () => {
  await assert.rejects(() => prasadamOrderService.create(orderBase({ devoteeName: "" })), /devoteeName is required/);
  await assert.rejects(() => prasadamOrderService.create(orderBase({ itemName: "  " })), /itemName is required/);
  await assert.rejects(() => prasadamOrderService.create(orderBase({ quantity: 0 })), /Quantity must be >= 1/);
  await assert.rejects(() => prasadamOrderService.create(orderBase({ unitPrice: -1 })), /unitPrice.*\bmust be >= 0/i);
  await assert.rejects(() => prasadamOrderService.create(orderBase({ paymentMethod: "Cheque" })), /Invalid paymentMethod/);
  await assert.rejects(() => prasadamOrderService.create(orderBase({ channel: "admin" })), /Invalid channel/);
});

test("PG path: update via service persists and re-reads the changed values", async () => {
  const order = await prasadamOrderService.create(orderBase());
  const updated = await prasadamOrderService.updateById(order._id, {
    status: "Placed",
    razorpayOrderId: "order_" + unique(),
    razorpayPaymentId: "pay_" + unique(),
    amount: "60.00",
  });

  assert.strictEqual(updated.status, "Placed");
  assert.strictEqual(updated.razorpayOrderId, updated.razorpayOrderId);
  assert.match(updated.razorpayOrderId, /^order_/);
  assert.strictEqual(Number(updated.amount), 60);

  const reread = await prasadamOrderService.findById(order._id);
  assert.strictEqual(reread.status, "Placed");
  assert.strictEqual(Number(reread.amount), 60);
});

test("PG path: delete removes the row", async () => {
  const order = await prasadamOrderService.create(orderBase());
  assert.strictEqual(await prasadamOrderService.destroy(order._id), true);
  assert.strictEqual(await prasadamOrderService.findById(order._id), null);
});

test("PG path: admin-style filter — channel devotee + status list + date window + search", async () => {
  const marker = `kheer-${unique()}`;
  const older = await prasadamOrderService.create(orderBase({ itemName: marker, amount: 100 }));
  const newer = await prasadamOrderService.create(orderBase({ itemName: marker, amount: 200, status: "Completed" }));
  await prasadamOrderService.create(orderBase({ itemName: "different-" + unique() }));

  const filter = {
    channel: "devotee",
    status: { $in: ["Not Collected", "Completed"] },
    search: marker,
  };
  const rows = await prasadamOrderService.findMany({ filter, sort: { createdAt: -1 }, limit: 10 });
  const ids = rows.map((r) => r._id);
  assert.ok(ids.includes(older._id));
  assert.ok(ids.includes(newer._id));
  assert.strictEqual(rows.length, 2);

  const total = await prasadamOrderService.count(filter);
  assert.strictEqual(total, 2);
});

test("PG path: devotee-portal filter — channel $in list plus $or email/devoteeId", async () => {
  const email = emailFor("portal");
  const order = await prasadamOrderService.create(orderBase({ email }));
  await prasadamOrderService.create(orderBase({ itemName: "other-" + unique() }));

  // Mirrors devoteeController.getPrasadamOrders when it selects the PG path.
  const filter = {
    $or: [{ email }, { devoteeId: "000000000000000000000000" }],
    channel: { $in: ["devotee", ""] },
  };
  const rows = await prasadamOrderService.findMany({ filter, sort: { createdAt: -1 } });
  const ids = rows.map((r) => r._id);
  assert.ok(ids.includes(order._id));
  assert.strictEqual(rows.length, 1);
});

test("PG path: count/filter do not require unrelated PG tables (fallback requirement 4)", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    // Prasadam Orders only need prasadam_orders; the other PG tables are not
    // queried by this path.
    await pool.query("DROP TABLE IF EXISTS bills CASCADE");
    await pool.query("DROP TABLE IF EXISTS bill_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_heads CASCADE");
    await pool.query("DROP TABLE IF EXISTS account_transactions CASCADE");
    await pool.query("DROP TABLE IF EXISTS bookings CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS booking_material_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS pooja_bookings CASCADE");
    await pool.query("DROP TABLE IF EXISTS pooja_booking_material_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS donations CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
    await pool.query("DROP TABLE IF EXISTS employees CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");

    const marker = `coconut-${unique()}`;
    const created = await prasadamOrderService.create(orderBase({ itemName: marker }));
    assert.ok(created._id);
    // Filter by search string (unique marker) instead of a broad channel filter,
    // since other tests have already inserted devotee-channel orders.
    assert.strictEqual(await prasadamOrderService.count({ channel: "devotee", search: marker }), 1);
    assert.strictEqual((await prasadamOrderService.findById(created._id)).itemName, marker);
  } finally {
    await pool.end();
  }
});

// ─── Cross-database boundaries ──────────────────────────────────────────────
test("PG path: a create failure does not leave a partial order (fallback requirement 3)", async () => {
  const before = await prasadamOrderService.count({});
  // quantity=0 and a bad channel both violate Prasadam Order validation; the
  // INSERT is atomic, so whatever is thrown must leave the table untouched.
  await assert.rejects(() => prasadamOrderRepository.create(orderBase({ quantity: 0 })), /Quantity must be >= 1/);
  await assert.rejects(() => prasadamOrderRepository.create(orderBase({ channel: "admin" })), /Invalid channel/);
  const after = await prasadamOrderService.count({});
  assert.strictEqual(after, before);
});

test("PG path: prasadam_orders has no FK to unrelated tables (no cross-db FK)", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'prasadam_orders'
          AND tc.constraint_type = 'FOREIGN KEY'`
    );
    assert.deepStrictEqual(rows, [], "prasadam_orders must not reference other PG tables");
  } finally {
    await pool.end();
  }
});

test("PG path: findOneByRazorpayOrderId resolves via the active path", async () => {
  const rzpId = "rzp_order_" + unique();
  const order = await prasadamOrderService.create(orderBase());
  await prasadamOrderService.updateById(order._id, { razorpayOrderId: rzpId });
  const found = await prasadamOrderService.findOneByRazorpayOrderId(rzpId);
  assert.ok(found);
  assert.strictEqual(found._id, order._id);
});

test("PG path: updateById on unknown id returns null", async () => {
  assert.strictEqual(await prasadamOrderService.updateById(crypto.randomBytes(12).toString("hex"), { status: "Collected" }), null);
});
// ─── Phase 2AG: report/aggregate reads go through the repository seam ───────
// aggregateSalesTotals / aggregateTopSelling reproduce the Mongo aggregation
// pipelines exactly, so a sales report reads one datasource only.
const reportBase = (overrides = {}) => orderBase(overrides);

test("report: aggregateSalesTotals sums revenue and counts orders inside the date range", async () => {
  const from = new Date();
  const before = await prasadamOrderService.aggregateSalesTotals(from);
  assert.strictEqual(typeof before.totalRevenue, "number");
  assert.strictEqual(typeof before.totalOrders, "number");

  await prasadamOrderService.create(reportBase({ amount: 100.5, quantity: 1 }));
  await prasadamOrderService.create(reportBase({ amount: 49.5, quantity: 1 }));

  const after = await prasadamOrderService.aggregateSalesTotals(from);
  assert.strictEqual(after.totalOrders, before.totalOrders + 2);
  assert.strictEqual(after.totalRevenue, Number((before.totalRevenue + 150).toFixed(2)));
});

test("report: aggregateSalesTotals includes rows after the boundary and excludes rows before it", async () => {
  const itemName = `Bound-${unique()}`;
  const old = await prasadamOrderService.create(
    reportBase({ itemName, amount: 777, createdAt: new Date("2020-01-01T00:00:00Z") })
  );
  assert.ok(old._id);

  const excluded = await prasadamOrderService.aggregateSalesTotals(new Date("2024-01-01T00:00:00Z"));
  const included = await prasadamOrderService.aggregateSalesTotals(new Date("2019-01-01T00:00:00Z"));

  // The 777 row is the only quantity-1 order with this amount in the fixture
  // set, so the widened window must be exactly 777 richer.
  assert.strictEqual(
    Number((included.totalRevenue - excluded.totalRevenue).toFixed(2)),
    777,
    "the pre-boundary row is counted only by the wider range"
  );
  assert.strictEqual(included.totalOrders, excluded.totalOrders + 1);
});

test("report: aggregateSalesTotals returns zeros for a range with no orders", async () => {
  const empty = await prasadamOrderService.aggregateSalesTotals(new Date("2099-01-01T00:00:00Z"));
  assert.strictEqual(empty.totalRevenue, 0);
  assert.strictEqual(empty.totalOrders, 0);
});

test("report: aggregateTopSelling groups by item name, sums quantity and orders desc", async () => {
  const from = new Date();
  const itemA = `Top-A-${unique()}`;
  const itemB = `Top-B-${unique()}`;

  // Same item name across rows: quantities must be summed.
  await prasadamOrderService.create(reportBase({ itemName: itemA, quantity: 3, amount: 30 }));
  await prasadamOrderService.create(reportBase({ itemName: itemA, quantity: 4, amount: 40 }));
  await prasadamOrderService.create(reportBase({ itemName: itemB, quantity: 2, amount: 20 }));

  const top = await prasadamOrderService.aggregateTopSelling(from, 5);
  const bucketA = top.find((row) => row._id === itemA);
  const bucketB = top.find((row) => row._id === itemB);

  assert.ok(bucketA, "item A aggregated");
  assert.strictEqual(bucketA.totalQuantity, 7, "quantities summed across rows");
  assert.ok(bucketB);
  assert.strictEqual(bucketB.totalQuantity, 2);

  // Ordering is descending by total quantity.
  const quantities = top.map((row) => row.totalQuantity);
  const sorted = [...quantities].sort((a, b) => b - a);
  assert.deepStrictEqual(quantities, sorted, "top sellers are sorted descending");
});

test("report: aggregateTopSelling honours the limit", async () => {
  const from = new Date();
  for (let i = 0; i < 3; i += 1) {
    await prasadamOrderService.create(reportBase({ itemName: `Limit-${unique()}`, quantity: i + 1 }));
  }
  const top = await prasadamOrderService.aggregateTopSelling(from, 2);
  assert.strictEqual(top.length, 2);
});

test("report: aggregateTopSelling sums multiple rows for one item", async () => {
  const from = new Date();
  const itemName = `Sum-${unique()}`;
  await prasadamOrderService.create(reportBase({ itemName, quantity: 1 }));
  await prasadamOrderService.create(reportBase({ itemName, quantity: 2 }));
  const top = await prasadamOrderService.aggregateTopSelling(from, 5);
  const bucket = top.find((row) => row._id === itemName);
  assert.strictEqual(bucket.totalQuantity, 3);
});

test("report: aggregateTopSelling returns an empty array for a range with no orders", async () => {
  const top = await prasadamOrderService.aggregateTopSelling(new Date("2099-01-01T00:00:00Z"), 5);
  assert.deepStrictEqual(top, []);
});

test("report: the repository exposes both aggregate methods; the controller no longer aggregates directly", async () => {
  assert.strictEqual(typeof prasadamOrderRepository.aggregateSalesTotals, "function");
  assert.strictEqual(typeof prasadamOrderRepository.aggregateTopSelling, "function");
  assert.strictEqual(typeof prasadamOrderService.aggregateSalesTotals, "function");
  assert.strictEqual(typeof prasadamOrderService.aggregateTopSelling, "function");

  const fs = require("fs");
  const path = require("path");
  const controllerSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", "prasadamController.js"),
    "utf8"
  );
  assert.ok(
    !/PrasadamOrder\.aggregate/.test(controllerSource),
    "the controller no longer runs a Mongo aggregation directly"
  );
  assert.ok(
    !/FROM prasadam_orders/.test(controllerSource),
    "the controller no longer embeds raw PostgreSQL aggregate SQL"
  );
});

test("report: getSalesReports keeps the response shape and reads through the service", async () => {
  const prasadamController = require("../src/controllers/prasadamController");
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

  const itemName = `Shape-${unique()}`;
  await prasadamOrderService.create(reportBase({ itemName, quantity: 9, amount: 90 }));

  await prasadamController.getSalesReports({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.reports.today);
  assert.ok(res.body.reports.monthly);
  assert.ok(Array.isArray(res.body.reports.topSelling));
  assert.strictEqual(typeof res.body.reports.today.totalRevenue, "number");
  assert.strictEqual(typeof res.body.reports.today.totalOrders, "number");
  const bucket = res.body.reports.topSelling.find((row) => row._id === itemName);
  assert.ok(bucket, "the new order appears in top selling");
  assert.strictEqual(bucket.totalQuantity, 9);
});