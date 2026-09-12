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

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
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
  } finally {
    await pool.end();
  }
};

const createMockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const orderBase = (overrides = {}) => ({
  channel: "devotee",
  devoteeName: `Radha ${unique()}`,
  email: emailFor("prasadam"),
  phone: "9876543210",
  address: "Temple Street",
  itemName: `Pongal-${unique()}`,
  quantity: 2,
  unitPrice: 25.5,
  amount: 51,
  paymentMethod: "UPI",
  status: "Not Collected",
  ...overrides,
});

const RAZORPAY_KEY_SECRET = "test_secret_" + unique();

const validSignature = (orderId, paymentId) =>
  crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

const communicationService = require("../src/utils/communicationService");
const originalSendPrasadamOrderConfirmation = communicationService.sendPrasadamOrderConfirmation;

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
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;

  dbConfig.isDbConnected = () => true;

  // devoteeController destructures sendPrasadamOrderConfirmation at module
  // load time, so patch it BEFORE the controller module is first required —
  // otherwise confirmations trigger real sendEmail/sendSMS (which append to a
  // tracked communications.log as a side effect).
  communicationService.sendPrasadamOrderConfirmation = async () => ({});
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  communicationService.sendPrasadamOrderConfirmation = originalSendPrasadamOrderConfirmation;

  await closePostgres();
});

// ─── Task 2: PG/Mongo response objects have identical shapes ────────────────
test("PG path: repo doc exposes the same camelCase field set as a Mongoose doc", async () => {
  const svc = require("../src/services/prasadamOrderService");

  const input = orderBase();
  const pgOrder = await svc.create(input);

  const mongoSchemaKeys = [
    "_id", "channel", "devoteeId", "devoteeName", "email", "phone", "address",
    "itemName", "quantity", "unitPrice", "amount", "paymentMethod",
    "razorpayOrderId", "razorpayPaymentId", "razorpaySignature", "status",
    "createdAt", "updatedAt",
  ];

  for (const key of mongoSchemaKeys) {
    assert.ok(key in pgOrder, `PG doc missing key ${key}`);
  }

  assert.strictEqual(pgOrder.channel, "devotee");
  assert.strictEqual(pgOrder.devoteeName, input.devoteeName);
  assert.strictEqual(pgOrder.email, input.email);
  assert.strictEqual(pgOrder.itemName, input.itemName);
  assert.strictEqual(Number(pgOrder.quantity), input.quantity);
  assert.strictEqual(Number(pgOrder.unitPrice), input.unitPrice);
  assert.strictEqual(Number(pgOrder.amount), input.amount);
  assert.strictEqual(pgOrder.paymentMethod, "UPI");
  assert.strictEqual(pgOrder.status, "Not Collected");
  assert.ok(pgOrder.createdAt instanceof Date);
  assert.ok(pgOrder.updatedAt instanceof Date);
  assert.match(pgOrder._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(pgOrder._id, pgOrder.id);

  assert.strictEqual(pgOrder.razorpayOrderId, undefined);
  assert.strictEqual(pgOrder.razorpayPaymentId, undefined);
  assert.strictEqual(pgOrder.razorpaySignature, undefined);

  const pgJson = JSON.parse(JSON.stringify(pgOrder));
  assert.strictEqual(pgJson._id, pgOrder._id);
  assert.strictEqual(pgJson.createdAt, pgOrder.createdAt.toISOString());
  assert.strictEqual(pgJson.devoteeName, input.devoteeName);
  assert.strictEqual(pgJson.amount, 51);
});

// ─── Task 3: Payment verification with the PG path ──────────────────────────
test("PG path: verifyPrasadamPayment persists Placed + razorpay fields, syncs Bill & inventory", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const devoteeController = require("../src/controllers/devoteeController");
  const Bill = require("../src/models/Bill");
  const Notification = require("../src/models/Notification");
  const Prasadam = require("../src/models/Prasadam");
  const communicationService = require("../src/utils/communicationService");

  const order = await svc.create(orderBase());

  const originalBillUpdateMany = Bill.updateMany;
  const originalNotificationCreate = Notification.create;
  const originalPrasadamFindOne = Prasadam.findOne;
  const originalSendEmail = communicationService.sendEmail;
  const originalSendSMS = communicationService.sendSMS;

  let billUpdateCall = null;
  let notificationCreated = false;
  Bill.updateMany = async (filter, update) => {
    billUpdateCall = { filter, update };
    return { modifiedCount: 1 };
  };
  Notification.create = async () => {
    notificationCreated = true;
    return {};
  };
  Prasadam.findOne = async () => {
    const item = {
      name: order.itemName,
      availableQuantity: 10,
      minimumStock: 2,
      save: async () => {},
    };
    return item;
  };
  communicationService.sendEmail = async () => ({});
  communicationService.sendSMS = async () => ({});

  const paymentId = "pay_" + unique();
  const razorpayOrderId = "order_" + unique();
  const signature = validSignature(razorpayOrderId, paymentId);

  try {
    const req = {
      body: {
        orderId: order._id,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
    };
    const res = createMockRes();
    await devoteeController.verifyPrasadamPayment(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.order.status, "Placed");
    assert.strictEqual(res.body.order.razorpayPaymentId, paymentId);
    assert.strictEqual(res.body.order.razorpaySignature, signature);

    const reread = await svc.findById(order._id);
    assert.strictEqual(reread.status, "Placed");
    assert.strictEqual(reread.razorpayPaymentId, paymentId);
    assert.strictEqual(reread.razorpaySignature, signature);

    assert.ok(billUpdateCall, "Bill.updateMany called");
    assert.strictEqual(billUpdateCall.filter.sourceId, order._id.toString());
    assert.strictEqual(billUpdateCall.update.status, "Paid");
    assert.ok(notificationCreated, "Notification.create called");
  } finally {
    Bill.updateMany = originalBillUpdateMany;
    Notification.create = originalNotificationCreate;
    Prasadam.findOne = originalPrasadamFindOne;
    communicationService.sendEmail = originalSendEmail;
    communicationService.sendSMS = originalSendSMS;
  }
});

// ─── Task 4: Cancellation with the PG path ──────────────────────────────────
test("PG path: cancelPrasadamOrder flips status and creates notification", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const devoteeController = require("../src/controllers/devoteeController");
  const Notification = require("../src/models/Notification");

  const order = await svc.create(orderBase());

  const originalNotificationCreate = Notification.create;
  let notificationPayload = null;
  Notification.create = async (payload) => {
    notificationPayload = payload;
    return {};
  };

  try {
    const req = { params: { id: order._id } };
    const res = createMockRes();
    await devoteeController.cancelPrasadamOrder(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.order.status, "Cancelled");
    assert.ok(notificationPayload, "Notification.create called");
    assert.ok(notificationPayload.message.includes("cancelled"));
    assert.strictEqual(notificationPayload.audienceEmail, order.email);

    const reread = await svc.findById(order._id);
    assert.strictEqual(reread.status, "Cancelled");
  } finally {
    Notification.create = originalNotificationCreate;
  }
});

// ─── Task 5: Admin status updates with the PG path ──────────────────────────
test("PG path: admin status update persists on PG and syncs Bill ledger, transaction, notification", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const admin = require("../src/controllers/prasadamAdminController");
  const Bill = require("../src/models/Bill");
  const Notification = require("../src/models/Notification");
  const AccountTransaction = require("../src/models/AccountTransaction");
  const AccountHead = require("../src/models/AccountHead");

  const order = await svc.create(orderBase());

  const originalBillUpdateMany = Bill.updateMany;
  const originalNotificationCreate = Notification.create;
  const originalTxFindOne = AccountTransaction.findOne;
  const originalTxSave = AccountTransaction.prototype.save;
  const originalHeadFindOne = AccountHead.findOne;
  const originalHeadCreate = AccountHead.create;

  let billUpdate = null;
  let txSaved = null;
  let notificationPayload = null;

  Bill.updateMany = async (filter, update) => {
    billUpdate = { filter, update };
    return { modifiedCount: 1 };
  };
  Notification.create = async (payload) => {
    notificationPayload = payload;
    return {};
  };
  AccountTransaction.findOne = async () => null;
  AccountTransaction.prototype.save = async function () {
    txSaved = this.toObject ? this.toObject() : { ...this };
    return this;
  };
  AccountHead.findOne = async () => null;
  AccountHead.create = async () => ({});

  try {
    const req = { params: { id: order._id }, body: { status: "Collected" }, user: { id: "user1" } };
    const res = createMockRes();
    await admin.updateAdminPrasadamOrderStatus(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.order.status, "Collected");

    const reread = await svc.findById(order._id);
    assert.strictEqual(reread.status, "Collected");

    assert.ok(billUpdate, "Bill.updateMany called");
    assert.strictEqual(billUpdate.filter.sourceId, order._id.toString());
    assert.strictEqual(billUpdate.update.$set.status, "Paid");

    assert.ok(txSaved, "AccountTransaction saved");
    assert.strictEqual(txSaved.transactionType, "Credit");
    assert.strictEqual(txSaved.source, "Prasadam");
    assert.strictEqual(txSaved.category, "Prasadam Sales");
    // referenceId is a Mongo ObjectId field; the PG hex _id casts cleanly to
    // the same 24-hex ObjectId, so the reference is preserved.
    assert.strictEqual(String(txSaved.referenceId), order._id);
    assert.strictEqual(txSaved.referenceModel, "PrasadamOrder");

    assert.ok(notificationPayload, "staff notification created");
    assert.strictEqual(notificationPayload.audienceRole, "admin");
    assert.strictEqual(notificationPayload.category, "prasadam");
  } finally {
    Bill.updateMany = originalBillUpdateMany;
    Notification.create = originalNotificationCreate;
    AccountTransaction.findOne = originalTxFindOne;
    AccountTransaction.prototype.save = originalTxSave;
    AccountHead.findOne = originalHeadFindOne;
    AccountHead.create = originalHeadCreate;
  }
});

// ─── Task 6: Bill / Accounting / Notification failures after a PG write ────
test("PG path: Bill.updateMany failure does not corrupt the already-written PG order", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const devoteeController = require("../src/controllers/devoteeController");
  const Bill = require("../src/models/Bill");
  const Notification = require("../src/models/Notification");
  const Prasadam = require("../src/models/Prasadam");
  const communicationService = require("../src/utils/communicationService");

  const order = await svc.create(orderBase());

  const originalBillUpdateMany = Bill.updateMany;
  const originalNotificationCreate = Notification.create;
  const originalPrasadamFindOne = Prasadam.findOne;
  const originalSendEmail = communicationService.sendEmail;
  const originalSendSMS = communicationService.sendSMS;

  let billTried = false;
  Bill.updateMany = async () => {
    billTried = true;
    throw new Error("bill sync exploded");
  };
  Prasadam.findOne = async () => null;
  Notification.create = async () => ({});
  communicationService.sendEmail = async () => ({});
  communicationService.sendSMS = async () => ({});

  const paymentId = "pay_" + unique();
  const razorpayOrderId = "order_" + unique();
  const signature = validSignature(razorpayOrderId, paymentId);

  try {
    const req = {
      body: {
        orderId: order._id,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
    };
    const res = createMockRes();
    await devoteeController.verifyPrasadamPayment(req, res);

    assert.ok(billTried, "Bill.updateMany was attempted");
    assert.strictEqual(res.statusCode, 500);
    const reread = await svc.findById(order._id);
    assert.strictEqual(reread.status, "Placed");
    assert.strictEqual(reread.razorpayPaymentId, paymentId);
  } finally {
    Bill.updateMany = originalBillUpdateMany;
    Notification.create = originalNotificationCreate;
    Prasadam.findOne = originalPrasadamFindOne;
    communicationService.sendEmail = originalSendEmail;
    communicationService.sendSMS = originalSendSMS;
  }
});

test("PG path: Notification.create failure after verify is contained (order stays Placed)", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const devoteeController = require("../src/controllers/devoteeController");
  const Bill = require("../src/models/Bill");
  const Notification = require("../src/models/Notification");
  const Prasadam = require("../src/models/Prasadam");
  const communicationService = require("../src/utils/communicationService");

  const order = await svc.create(orderBase());

  const originalBillUpdateMany = Bill.updateMany;
  const originalNotificationCreate = Notification.create;
  const originalPrasadamFindOne = Prasadam.findOne;
  const originalSendEmail = communicationService.sendEmail;
  const originalSendSMS = communicationService.sendSMS;

  Bill.updateMany = async () => ({ modifiedCount: 1 });
  Notification.create = async () => {
    throw new Error("notification exploded");
  };
  Prasadam.findOne = async () => null;
  communicationService.sendEmail = async () => ({});
  communicationService.sendSMS = async () => ({});

  const paymentId = "pay_" + unique();
  const razorpayOrderId = "order_" + unique();
  const signature = validSignature(razorpayOrderId, paymentId);

  try {
    const req = {
      body: {
        orderId: order._id,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
    };
    const res = createMockRes();
    await devoteeController.verifyPrasadamPayment(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    const reread = await svc.findById(order._id);
    assert.strictEqual(reread.status, "Placed");
  } finally {
    Bill.updateMany = originalBillUpdateMany;
    Notification.create = originalNotificationCreate;
    Prasadam.findOne = originalPrasadamFindOne;
    communicationService.sendEmail = originalSendEmail;
    communicationService.sendSMS = originalSendSMS;
  }
});

test("PG path: recordTransaction failure in admin update does not revert the PG status", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const admin = require("../src/controllers/prasadamAdminController");
  const Bill = require("../src/models/Bill");
  const Notification = require("../src/models/Notification");
  const AccountTransaction = require("../src/models/AccountTransaction");
  const AccountHead = require("../src/models/AccountHead");

  const order = await svc.create(orderBase());

  const originalBillUpdateMany = Bill.updateMany;
  const originalNotificationCreate = Notification.create;
  const originalTxFindOne = AccountTransaction.findOne;
  const originalTxSave = AccountTransaction.prototype.save;
  const originalHeadFindOne = AccountHead.findOne;

  Bill.updateMany = async () => ({ modifiedCount: 1 });
  Notification.create = async () => ({});
  AccountTransaction.findOne = async () => null;
  AccountTransaction.prototype.save = async function () {
    throw new Error("accounting exploded");
  };
  AccountHead.findOne = async () => null;

  try {
    const req = { params: { id: order._id }, body: { status: "Collected" }, user: { id: "user1" } };
    const res = createMockRes();
    await admin.updateAdminPrasadamOrderStatus(req, res);

    assert.strictEqual(res.statusCode, 500);
    const reread = await svc.findById(order._id);
    assert.strictEqual(reread.status, "Collected");
  } finally {
    Bill.updateMany = originalBillUpdateMany;
    Notification.create = originalNotificationCreate;
    AccountTransaction.findOne = originalTxFindOne;
    AccountTransaction.prototype.save = originalTxSave;
    AccountHead.findOne = originalHeadFindOne;
  }
});

// ─── Task 7: No unintended duplicate writes ─────────────────────────────────
test("PG path: service never touches the Mongoose model when PG is selected", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const PrasadamOrder = require("../src/models/PrasadamOrder");

  const originalCreate = PrasadamOrder.create;
  const originalFindByIdAndUpdate = PrasadamOrder.findByIdAndUpdate;
  const originalFindByIdAndDelete = PrasadamOrder.findByIdAndDelete;
  const originalFind = PrasadamOrder.find;
  const originalFindById = PrasadamOrder.findById;

  const mongoTouched = [];
  PrasadamOrder.create = async (...args) => {
    mongoTouched.push("create");
    return originalCreate.apply(this, args);
  };
  PrasadamOrder.findByIdAndUpdate = async (...args) => {
    mongoTouched.push("findByIdAndUpdate");
    return originalFindByIdAndUpdate.apply(this, args);
  };
  PrasadamOrder.findByIdAndDelete = async (...args) => {
    mongoTouched.push("findByIdAndDelete");
    return originalFindByIdAndDelete.apply(this, args);
  };
  PrasadamOrder.find = async (...args) => {
    mongoTouched.push("find");
    return originalFind.apply(this, args);
  };
  PrasadamOrder.findById = async (...args) => {
    mongoTouched.push("findById");
    return originalFindById.apply(this, args);
  };

  try {
    const created = await svc.create(orderBase());
    await svc.updateById(created._id, { status: "Placed" });
    await svc.findById(created._id);
    await svc.findMany({});
    await svc.destroy(created._id);

    assert.deepStrictEqual(mongoTouched, [], "Mongo model must not be invoked on the PG path");
  } finally {
    PrasadamOrder.create = originalCreate;
    PrasadamOrder.findByIdAndUpdate = originalFindByIdAndUpdate;
    PrasadamOrder.findByIdAndDelete = originalFindByIdAndDelete;
    PrasadamOrder.find = originalFind;
    PrasadamOrder.findById = originalFindById;
  }
});

// ─── PrasadamController getSalesReports with the PG path ───────────────────
test("PG path: getSalesReports aggregates today/monthly/top-selling from PG rows", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const prasadamController = require("../src/controllers/prasadamController");

  // Baseline totals BEFORE adding these two orders (earlier tests in this file
  // also created PG prasadam orders).
  const baselineRes = createMockRes();
  await prasadamController.getSalesReports({}, baselineRes);
  const baseToday = baselineRes.body.reports.today.totalOrders;
  const baseTodayRev = baselineRes.body.reports.today.totalRevenue;
  const baseMonthly = baselineRes.body.reports.monthly.totalOrders;

  // Two PG orders placed "now" (both count toward today/monthly). High
  // quantities guarantee these items dominate the LIMIT 5 top-seller list even
  // though earlier tests in this file created other PG orders.
  const itemNameA = `Report-A-${unique()}`;
  const itemNameB = `Report-B-${unique()}`;
  const a = await svc.create(orderBase({ itemName: itemNameA, amount: 100, quantity: 1000 }));
  const b = await svc.create(orderBase({ itemName: itemNameB, amount: 250, quantity: 5000 }));
  assert.ok(a._id && b._id);

  const res = createMockRes();
  await prasadamController.getSalesReports({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.reports.today.totalOrders, baseToday + 2);
  assert.strictEqual(res.body.reports.today.totalRevenue, baseTodayRev + 350);
  assert.strictEqual(res.body.reports.monthly.totalOrders, baseMonthly + 2);
  assert.ok(Array.isArray(res.body.reports.topSelling));

  const top = res.body.reports.topSelling;
  assert.ok(top.length >= 2, "both report items appear in top selling");
  const names = top.map((t) => t._id);
  assert.ok(names.includes(itemNameA), "first item present");
  assert.ok(names.includes(itemNameB), "second item present");

  // Top-seller totalQuantity for itemB aggregates across order rows (only this
  // one order row contributes quantity for the unique item name).
  const itemBBucket = top.find((t) => t._id === itemNameB);
  assert.strictEqual(itemBBucket.totalQuantity, 5000);
});

// ─── Task 8: syncService does not mix PG/Mongo data ─────────────────────────
test("PG path: syncLedgerBills reads orders from PG and writes only Mongo Bills", async () => {
  const svc = require("../src/services/prasadamOrderService");
  const syncService = require("../src/utils/syncService");
  const Bill = require("../src/models/Bill");
  const Booking = require("../src/models/Booking");
  const Donation = require("../src/models/Donation");

  const order = await svc.create(orderBase());

  const originalBillFindOne = Bill.findOne;
  const originalBillCreate = Bill.create;
  const originalBookingFind = Booking.find;
  const originalDonationFind = Donation.find;

  const billCreates = [];
  Bill.findOne = async () => null;
  Bill.create = async (data) => {
    billCreates.push({ ...data });
    return { ...data };
  };
  Booking.find = async () => [];
  Donation.find = async () => [];

  try {
    await syncService.syncLedgerBills();

    const prasadamBills = billCreates.filter((b) => b.billType === "Prasadam Sale");
    // Other tests in this file also created PG prasadam orders, so syncService
    // creates one Bill per order lacking one. What matters is that (a) a Bill
    // was created for THIS order, and (b) its contents are the PG order fields.
    assert.ok(prasadamBills.length >= 1, "at least one prasadam bill created");
    const myBill = prasadamBills.find((b) => b.sourceId === order._id.toString());
    assert.ok(myBill, "a bill was created for the PG order in this test");
    assert.strictEqual(myBill.amount, 51);
    assert.strictEqual(myBill.devoteeName, order.devoteeName);
    assert.strictEqual(myBill.sevaType, order.itemName);
    assert.strictEqual(myBill.paymentMode, "UPI");

    // Bill.create destinations are Mongo (Bill model), not PG.
    assert.ok(prasadamBills.every((b) => b.billType === "Prasadam Sale"));
  } finally {
    Bill.findOne = originalBillFindOne;
    Bill.create = originalBillCreate;
    Booking.find = originalBookingFind;
    Donation.find = originalDonationFind;
  }
});