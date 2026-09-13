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
let bookingRepository;
let billRepository;
let accountTransactionRepository;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
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
  bookingRepository = require("../src/repositories/bookingRepository");
  billRepository = require("../src/repositories/billRepository");
  accountTransactionRepository = require("../src/repositories/accountTransactionRepository");
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

const bookingBase = (overrides = {}) => ({
  devoteeName: `Deepthi ${unique()}`,
  devoteeEmail: emailFor("booking"),
  service: "Archana",
  datetime: "2026-09-20T06:30:00.000Z",
  amount: 1250.5,
  paymentMethod: "UPI",
  paymentStatus: "Paid",
  status: "Confirmed",
  ...overrides,
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

test("booking repository: create → read → update round trip", async () => {
  const created = await bookingRepository.create(bookingBase());
  assert.ok(created?._id);
  assert.strictEqual(created.devoteeName.startsWith("Deepthi "), true);
  assert.strictEqual(created.amount, 1250.5);
  assert.strictEqual(created.service, "Archana");
  assert.strictEqual(created.datetime, "2026-09-20T06:30:00.000Z");
  assert.strictEqual(created.paymentMethod, "UPI");
  assert.strictEqual(created.paymentStatus, "Paid");
  assert.strictEqual(created.status, "Confirmed");
  assert.ok(created.createdAt instanceof Date);

  const byId = await bookingRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.devoteeEmail, created.devoteeEmail.toLowerCase());

  const updated = await bookingRepository.updateById(created._id, {
    status: "Completed",
    completedAt: new Date("2026-09-20T08:00:00.000Z"),
    completionRemarks: "Done",
    paymentMethod: "Cash",
  });
  assert.strictEqual(updated.status, "Completed");
  assert.strictEqual(updated.paymentMethod, "Cash");
  assert.strictEqual(updated.completionRemarks, "Done");
  assert.ok(updated.completedAt instanceof Date);

  const after = await bookingRepository.findById(created._id);
  assert.strictEqual(after.status, "Completed");
  assert.strictEqual(after.completedAt.toISOString(), "2026-09-20T08:00:00.000Z");
});

test("booking repository: normalized children round-trip (history, materials, items)", async () => {
  const created = await bookingRepository.create(bookingBase({
    bookingHistory: [
      { previousStatus: null, newStatus: "Confirmed", updatedBy: "admin", note: "created" },
      { previousStatus: "Confirmed", newStatus: "Assigned", updatedBy: "admin", note: "priest assigned" },
    ],
    templeMaterialRequests: [
      { item: "a".repeat(24), itemName: "Coconut", qty: "2 No" },
      { item: "b".repeat(24), itemName: "Banana", qty: "3 Nos" },
    ],
    items: [
      { type: "pooja", name: "Archana", price: 500, quantity: 2, selectedTempleMaterials: ["m1"] },
      { type: "prasadam", name: "Laddu", description: "Prasadam item", amount: 100 },
    ],
  }));

  const read = await bookingRepository.findById(created._id);
  assert.strictEqual(read.bookingHistory.length, 2);
  assert.strictEqual(read.bookingHistory[0].newStatus, "Confirmed");
  assert.strictEqual(read.bookingHistory[1].newStatus, "Assigned");
  assert.strictEqual(read.bookingHistory[0].updatedBy, "admin");
  assert.strictEqual(read.bookingHistory[0].note, "created");

  assert.strictEqual(read.templeMaterialRequests.length, 2);
  assert.strictEqual(read.templeMaterialRequests[0].itemName, "Coconut");
  assert.strictEqual(read.templeMaterialRequests[0].qty, "2 No");
  assert.strictEqual(read.templeMaterialRequests[1].itemName, "Banana");

  // PoojaManagement / receipt generator depend on items[] preserving order and
  // the Mongo-ish fields (type, name, description, quantity, price, amount).
  assert.strictEqual(read.items.length, 2);
  assert.strictEqual(read.items[0].type, "pooja");
  assert.strictEqual(read.items[0].name, "Archana");
  assert.strictEqual(read.items[0].price, 500);
  assert.strictEqual(read.items[0].quantity, 2);
  assert.deepStrictEqual(read.items[0].selectedTempleMaterials, ["m1"]);
  assert.strictEqual(read.items[1].type, "prasadam");
  assert.strictEqual(read.items[1].name, "Laddu");
  assert.strictEqual(read.items[1].description, "Prasadam item");
  assert.strictEqual(read.items[1].amount, 100);

  // Array order is preserved even after an update that rewrites the children.
  const updated = await bookingRepository.updateById(created._id, {
    bookingHistory: read.bookingHistory,
    items: read.items,
  });
  assert.strictEqual(updated.bookingHistory[0].newStatus, "Confirmed");
  assert.strictEqual(updated.items[1].name, "Laddu");
});

// ---------------------------------------------------------------------------
// Legacy Mongo field mapping
// ---------------------------------------------------------------------------

test("booking repository: legacy Mongo field mapping round-trips every persisted field", async () => {
  const devoteeId = "f".repeat(24);
  const eventId = "e".repeat(24);
  const assignedPriest = "p".repeat(24);
  const completedAt = new Date("2026-09-21T05:00:00.000Z");
  const checkin = new Date("2026-09-22T06:00:00.000Z");
  const checkout = new Date("2026-09-24T06:00:00.000Z");

  const created = await bookingRepository.create(bookingBase({
    devoteeId,
    eventId,
    devoteeName: "  Field Mapping Devotee  ",
    devoteeEmail: "  MiXeD@ExAmPlE.COM  ",
    devoteePhone: " +91-90000-00001 ",
    service: "  Rudrabhishekam  ",
    datetime: " 2026-10-01T07:30:00.000Z ",
    amount: "12345.67",
    gst: 18.5,
    paymentMethod: "Bank Transfer",
    paymentStatus: "Pending",
    transactionId: "TXN127",
    razorpayOrderId: "order_BK",
    razorpayPaymentId: "pay_BK",
    razorpaySignature: "sig_BK",
    bookingNumber: "PB5555",
    status: "Pending",
    contactNumber: "+91-90000-00002",
    notes: "some notes",
    counted: true,
    assignedPriest,
    priestName: "Priest One",
    startedAt: new Date("2026-10-01T07:00:00.000Z"),
    completedAt,
    completionRemarks: "completed",
    completionDuration: 45,
    approvedAt: new Date("2026-09-30T10:00:00.000Z"),
    rejectedAt: new Date("2026-09-30T11:00:00.000Z"),
    rejectionReason: "not ready",
    pendingReason: "waiting",
    pendingAt: new Date("2026-09-29T10:00:00.000Z"),
    templeApprovalRequired: true,
    days: 3,
    checkinDate: checkin,
    checkoutDate: checkout,
    templeArrangement: true,
    templeMaterialCharge: 150.5,
    materialStatus: "Issued",
    preparationAcknowledged: true,
    priestChecklist: { devoteeArrived: true, templeMaterialsReceived: false },
    poojaDuration: "1h",
    poojaRules: ["Rule A", "Rule B"],
    poojaDressCode: "Yellow",
    priestInstructions: "Line1\nLine2",
    snapshotMaterials: [{ itemName: "M1", qty: "1", unit: "Kg", responsibilityType: "TEMPLE_PROVIDES" }],
    completedBy: "Priest One",
    isCombined: true,
    items: [{ type: "pooja", name: "Test", quantity: 1 }],
  }));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT * FROM bookings WHERE id = $1", [created._id]);
    const row = rows[0];
    assert.strictEqual(row.devotee_id, devoteeId);
    assert.strictEqual(row.event_id, eventId);
    assert.strictEqual(row.devotee_name, "Field Mapping Devotee");
    assert.strictEqual(row.devotee_email, "mixed@example.com");
    assert.strictEqual(row.devotee_phone, "+91-90000-00001");
    assert.strictEqual(row.service, "Rudrabhishekam");
    assert.strictEqual(row.datetime, "2026-10-01T07:30:00.000Z");
    assert.strictEqual(row.amount.toString(), "12345.67");
    assert.strictEqual(row.gst.toString(), "18.5");
    assert.strictEqual(row.payment_method, "Bank Transfer");
    assert.strictEqual(row.payment_status, "Pending");
    assert.strictEqual(row.transaction_id, "TXN127");
    assert.strictEqual(row.razorpay_order_id, "order_BK");
    assert.strictEqual(row.razorpay_payment_id, "pay_BK");
    assert.strictEqual(row.razorpay_signature, "sig_BK");
    assert.strictEqual(row.booking_number, "PB5555");
    assert.strictEqual(row.status, "Pending");
    assert.strictEqual(row.contact_number, "+91-90000-00002");
    assert.strictEqual(row.notes, "some notes");
    assert.strictEqual(row.counted, true);
    assert.strictEqual(row.assigned_priest, assignedPriest);
    assert.strictEqual(row.priest_name, "Priest One");
    assert.strictEqual(row.started_at.toISOString(), "2026-10-01T07:00:00.000Z");
    assert.strictEqual(row.completed_at.toISOString(), completedAt.toISOString());
    assert.strictEqual(row.completion_remarks, "completed");
    assert.strictEqual(row.completion_duration.toString(), "45");
    assert.strictEqual(row.approved_at.toISOString(), "2026-09-30T10:00:00.000Z");
    assert.strictEqual(row.rejected_at.toISOString(), "2026-09-30T11:00:00.000Z");
    assert.strictEqual(row.rejection_reason, "not ready");
    assert.strictEqual(row.pending_reason, "waiting");
    assert.strictEqual(row.pending_at.toISOString(), "2026-09-29T10:00:00.000Z");
    assert.strictEqual(row.temple_approval_required, true);
    assert.strictEqual(row.days.toString(), "3");
    assert.strictEqual(row.checkin_date.toISOString(), checkin.toISOString());
    assert.strictEqual(row.checkout_date.toISOString(), checkout.toISOString());
    assert.strictEqual(row.temple_arrangement, true);
    assert.strictEqual(row.temple_material_charge.toString(), "150.5");
    assert.strictEqual(row.material_status, "Issued");
    assert.strictEqual(row.preparation_acknowledged, true);
    assert.deepStrictEqual(row.priest_checklist, { devoteeArrived: true, templeMaterialsReceived: false });
    assert.strictEqual(row.pooja_duration, "1h");
    assert.deepStrictEqual(row.pooja_rules, ["Rule A", "Rule B"]);
    assert.strictEqual(row.pooja_dress_code, "Yellow");
    assert.strictEqual(row.priest_instructions, "Line1\nLine2");
    assert.deepStrictEqual(row.snapshot_materials, [{ itemName: "M1", qty: "1", unit: "Kg", responsibilityType: "TEMPLE_PROVIDES" }]);
    assert.strictEqual(row.completed_by, "Priest One");
    assert.strictEqual(row.is_combined, true);
  } finally {
    await pool.end();
  }

  const read = await bookingRepository.findById(created._id);
  assert.strictEqual(read.devoteeId, devoteeId);
  assert.strictEqual(read.eventId, eventId);
  assert.strictEqual(read.devoteeEmail, "mixed@example.com");
  assert.strictEqual(read.datetime, "2026-10-01T07:30:00.000Z");
  assert.strictEqual(read.amount, 12345.67);
  assert.strictEqual(read.assignedPriest, assignedPriest);
  assert.deepStrictEqual(read.priestChecklist, { devoteeArrived: true, templeMaterialsReceived: false });
  assert.deepStrictEqual(read.poojaRules, ["Rule A", "Rule B"]);
  assert.strictEqual(read.priestInstructions, "Line1\nLine2");
  assert.strictEqual(read.completedAt.toISOString(), completedAt.toISOString());
  assert.strictEqual(read.checkinDate.toISOString(), checkin.toISOString());
});

test("booking repository: optional and null fields stay null-ish like Mongo", async () => {
  const created = await bookingRepository.create({
    devoteeName: "Minimal Booking",
    service: "Archana",
    datetime: "2026-09-20T06:30:00.000Z",
    amount: 100,
  });
  assert.strictEqual(created.devoteeId, undefined);
  assert.strictEqual(created.eventId, undefined);
  assert.strictEqual(created.devoteeEmail, undefined);
  assert.strictEqual(created.devoteePhone, undefined);
  // The Mongo schema declares transactionId with default "" (no undefined).
  assert.strictEqual(created.transactionId, "");
  assert.strictEqual(created.razorpayOrderId, undefined);
  assert.strictEqual(created.razorpayPaymentId, undefined);
  assert.strictEqual(created.razorpaySignature, undefined);
  assert.strictEqual(created.bookingNumber, undefined);
  assert.strictEqual(created.contactNumber, undefined);
  assert.strictEqual(created.notes, undefined);
  assert.strictEqual(created.assignedPriest, undefined);
  assert.strictEqual(created.completedAt, undefined);
  assert.strictEqual(created.days, undefined);
  assert.strictEqual(created.checkinDate, undefined);
  assert.strictEqual(created.checkoutDate, undefined);
  assert.strictEqual(created.pendingReason, undefined);
  assert.strictEqual(created.pendingAt, undefined);
  assert.deepStrictEqual(created.priestChecklist, {});
  assert.deepStrictEqual(created.snapshotMaterials, []);
  assert.deepStrictEqual(created.poojaRules, []);
  assert.strictEqual(created.materialStatus, "N/A");
  assert.strictEqual(created.paymentMethod, "UPI");
  assert.strictEqual(created.paymentStatus, "Paid");
  assert.strictEqual(created.status, "Completed");
  assert.strictEqual(created.counted, false);
  assert.strictEqual(created.gst, 0);
  assert.strictEqual(created.templeMaterialCharge, 0);
  assert.strictEqual(created.completionDuration, 0);
  assert.ok(created.createdAt instanceof Date);
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("booking repository: monetary precision round-trips through NUMERIC exactly", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const amounts = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"];
  try {
    for (const amount of amounts) {
      const created = await bookingRepository.create(bookingBase({
        amount,
        gst: "0.01",
        templeMaterialCharge: "10.50",
      }));
      const fetched = await bookingRepository.findById(created._id);
      assert.strictEqual(fetched.amount, Number(amount));
      const { rows } = await pool.query(
        "SELECT amount::text AS amount, gst::text AS gst, temple_material_charge::text AS tmc FROM bookings WHERE id = $1",
        [created._id]
      );
      assert.strictEqual(rows[0].amount, amount);
      assert.strictEqual(rows[0].gst, "0.01");
      assert.strictEqual(rows[0].tmc, "10.50");
    }
    // Child item amounts also preserve scale.
    const itemCreated = await bookingRepository.create(bookingBase({
      items: [{ type: "pooja", name: "Precision", price: "1234.5678", quantity: 1 }],
    }));
    const fetched = await bookingRepository.findById(itemCreated._id);
    assert.strictEqual(fetched.items[0].price, 1234.5678);
    const { rows } = await pool.query(
      "SELECT price::text AS price FROM booking_items WHERE id = $1",
      [fetched.items[0].id]
    );
    assert.strictEqual(rows[0].price, "1234.5678");
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// IDs / enums / validation
// ---------------------------------------------------------------------------

test("booking repository: legacy IDs round-trip and create with the same id is idempotent", async () => {
  const id = unique();
  const first = await bookingRepository.create(bookingBase({ id }));
  const second = await bookingRepository.create(bookingBase({ id, devoteeName: "Other" }));
  assert.strictEqual(second._id, first._id);
  assert.strictEqual((await bookingRepository.findById(id))._id, id);
});

test("booking repository: enum values are preserved and invalid values are rejected", async () => {
  for (const mode of ["UPI", "Cash", "Card", "Bank Transfer", "Net Banking"]) {
    const created = await bookingRepository.create(bookingBase({ paymentMethod: mode }));
    assert.strictEqual((await bookingRepository.findById(created._id)).paymentMethod, mode);
  }
  for (const status of [
    "Booked", "Pending", "Approved", "Confirmed", "Assigned", "In Progress",
    "Completed", "Rejected", "Cancelled", "Upcoming", "Transfer Requested", "Transferred",
  ]) {
    const created = await bookingRepository.create(bookingBase({ status }));
    assert.strictEqual((await bookingRepository.findById(created._id)).status, status);
  }
  for (const pStatus of ["Pending", "Paid", "Failed", "Refunded"]) {
    const created = await bookingRepository.create(bookingBase({ paymentStatus: pStatus }));
    assert.strictEqual((await bookingRepository.findById(created._id)).paymentStatus, pStatus);
  }
  for (const mStatus of [
    "N/A", "Pending Approval", "Approved", "Ready for Collection", "Issued",
    "Acknowledged", "Consumed", "Cancelled", "Pending", "Reserved", "Ready",
  ]) {
    const created = await bookingRepository.create(bookingBase({ materialStatus: mStatus }));
    assert.strictEqual((await bookingRepository.findById(created._id)).materialStatus, mStatus);
  }

  await assert.rejects(
    () => bookingRepository.create(bookingBase({ paymentMethod: "Gold" })),
    /Invalid paymentMethod|check constraint/
  );
  await assert.rejects(
    () => bookingRepository.create(bookingBase({ paymentStatus: "Part Paid" })),
    /Invalid paymentStatus|check constraint/
  );
  await assert.rejects(
    () => bookingRepository.create(bookingBase({ status: "Refunded" })),
    /Invalid status|check constraint/
  );
  await assert.rejects(
    () => bookingRepository.create(bookingBase({ materialStatus: "Delivered" })),
    /Invalid materialStatus|check constraint/
  );
  await assert.rejects(
    () => bookingRepository.create(bookingBase({ amount: -10 })),
    /Invalid amount|check constraint/
  );
});

test("booking repository: required fields are enforced like Mongo", async () => {
  await assert.rejects(
    () => bookingRepository.create({ service: "X", datetime: "2026-09-20T06:30:00.000Z", amount: 10 }),
    /not-null|not null|devoteeName/
  );
  await assert.rejects(
    () => bookingRepository.create({ devoteeName: "No service", datetime: "2026-09-20T06:30:00.000Z", amount: 10 }),
    /not-null|not null|service/
  );
  await assert.rejects(
    () => bookingRepository.create({ devoteeName: "No datetime", service: "Archana", amount: 10 }),
    /not-null|not null|datetime/
  );
  await assert.rejects(
    () => bookingRepository.create({ devoteeName: "No amount", service: "Archana", datetime: "2026-09-20T06:30:00.000Z" }),
    /Invalid amount|not-null|amount/
  );
});

// ---------------------------------------------------------------------------
// Dates / time
// ---------------------------------------------------------------------------

test("booking repository: dates round-trip correctly through TIMESTAMPTZ", async () => {
  const completedAt = new Date("2025-08-15T10:30:00+05:30");
  const created = await bookingRepository.create(bookingBase({ completedAt }));
  const read = await bookingRepository.findById(created._id);
  assert.ok(read.completedAt instanceof Date);
  // TIMESTAMPTZ preserves the instant; the same UTC moment comes back.
  assert.strictEqual(read.completedAt.toISOString(), completedAt.toISOString());
  assert.strictEqual(read.completedAt.toISOString(), "2025-08-15T05:00:00.000Z");
});

// ---------------------------------------------------------------------------
// Filters / sorting / pagination / count
// ---------------------------------------------------------------------------

test("booking repository: findOne and findMany honor filters, sorts and pagination", async () => {
  const priestId = unique();
  const created = await bookingRepository.create(bookingBase({
    assignedPriest: priestId,
    status: "Assigned",
    paymentMethod: "Cash",
    service: "Abhishekam",
  }));

  const byPriest = await bookingRepository.findOne({ assignedPriest: priestId });
  assert.strictEqual(byPriest._id, created._id);

  const many = await bookingRepository.findMany({ filter: { assignedPriest: priestId } });
  assert.ok(many.some((b) => b._id === created._id));

  const filtered = await bookingRepository.findMany({
    filter: { status: "Assigned", paymentMethod: "Cash", service: "Abhishekam" },
  });
  assert.ok(filtered.some((b) => b._id === created._id));

  // Mongo-style { status: { $in: [...] } }.
  const statusIn = await bookingRepository.findMany({ filter: { status: { $in: ["Assigned", "Completed"] } } });
  assert.ok(statusIn.some((b) => b._id === created._id));

  const page = await bookingRepository.findMany({ filter: {}, sort: { createdAt: -1 }, limit: 1, offset: 0 });
  assert.strictEqual(page.length, 1);

  // Invalid sort fields fall back to created_at DESC and never throw.
  const badSort = await bookingRepository.findMany({ sort: { definitelyNotAColumn: -1 } });
  assert.ok(badSort.some((b) => b._id === created._id));

  // createdAt range filter ($gte/$lte).
  const ranged = await bookingRepository.findMany({
    filter: { createdAt: { $gte: "2020-01-01T00:00:00Z", $lte: new Date(Date.now() + 86400000) } },
  });
  assert.ok(ranged.some((b) => b._id === created._id));

  // completedAt range filter (priest completed-services history).
  const completed = await bookingRepository.create(bookingBase({
    status: "Completed",
    completedAt: new Date("2026-05-10T10:00:00.000Z"),
  }));
  const completedRanged = await bookingRepository.findMany({
    filter: { completedAt: { $gte: "2026-05-01T00:00:00Z", $lte: "2026-05-31T23:59:59Z" } },
  });
  assert.ok(completedRanged.some((b) => b._id === completed._id));

  // datetime text sort (priest getAssignedPoojas sorts { datetime: 1 }).
  const byDatetime = await bookingRepository.findMany({ filter: {}, sort: { datetime: 1 } });
  assert.ok(byDatetime.some((b) => b._id === created._id));
});

test("booking repository: search filter matches devoteeName/service/phone/bookingNumber/id", async () => {
  const created = await bookingRepository.create(bookingBase({
    devoteeName: "Alphonso Booking",
    service: "Satyanarayana Vrata",
    devoteePhone: "+91-9876500000",
    bookingNumber: `PB-${unique().slice(0, 5)}`,
  }));
  const byName = await bookingRepository.findMany({ filter: { search: "Alphonso" } });
  assert.ok(byName.some((b) => b._id === created._id));
  const byService = await bookingRepository.findMany({ filter: { search: "Satyanarayana" } });
  assert.ok(byService.some((b) => b._id === created._id));
  const byPhone = await bookingRepository.findMany({ filter: { search: "9876500000" } });
  assert.ok(byPhone.some((b) => b._id === created._id));
  const byId = await bookingRepository.findMany({ filter: { search: created._id } });
  assert.ok(byId.some((b) => b._id === created._id));
});

test("booking repository: devoteeEmail $in filter mirrors buildEmailLookup aliases", async () => {
  const created = await bookingRepository.create(bookingBase({ devoteeEmail: "alias@gmail.com" }));
  const byIn = await bookingRepository.findMany({
    filter: { devoteeEmail: { $in: ["alias@gmail.com", "alias@temple.local"] } },
  });
  assert.ok(byIn.some((b) => b._id === created._id));
});

test("booking repository: count uses COUNT(*) and filter counts match", async () => {
  const priestId = unique();
  await bookingRepository.create(bookingBase({ assignedPriest: priestId, status: "Assigned" }));
  await bookingRepository.create(bookingBase({ assignedPriest: priestId, status: "Completed" }));
  const all = await bookingRepository.count({});
  const byPriest = await bookingRepository.count({ assignedPriest: priestId });
  assert.strictEqual(typeof all, "number");
  assert.strictEqual(byPriest, 2);
  const byStatus = await bookingRepository.count({ status: { $in: ["Assigned", "Completed"] } });
  assert.ok(byStatus >= 2);
});

test("booking repository: updateById on a missing id returns null and empty updates are no-ops", async () => {
  assert.strictEqual(
    await bookingRepository.updateById("000000000000000000000000", { status: "Completed" }),
    null
  );
  const created = await bookingRepository.create(bookingBase({}));
  const noop = await bookingRepository.updateById(created._id, {});
  assert.strictEqual(noop._id, created._id);
});

// ---------------------------------------------------------------------------
// Delete & transactions
// ---------------------------------------------------------------------------

test("booking repository: destroy reports existence and drops children via the FK", async () => {
  const created = await bookingRepository.create(bookingBase({
    bookingHistory: [{ previousStatus: null, newStatus: "Confirmed", updatedBy: "admin", note: "x" }],
    templeMaterialRequests: [{ itemName: "Coconut", qty: "1" }],
    items: [{ type: "pooja", name: "Pooja", quantity: 1 }],
  }));
  assert.ok(created.bookingHistory.length > 0);

  assert.strictEqual(await bookingRepository.destroy(created._id), true);
  assert.strictEqual(await bookingRepository.findById(created._id), null);
  assert.strictEqual(await bookingRepository.destroy(created._id), false);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows: history } = await pool.query("SELECT COUNT(*)::int AS c FROM booking_history WHERE booking_id = $1", [created._id]);
    const { rows: materials } = await pool.query("SELECT COUNT(*)::int AS c FROM booking_material_requests WHERE booking_id = $1", [created._id]);
    const { rows: items } = await pool.query("SELECT COUNT(*)::int AS c FROM booking_items WHERE booking_id = $1", [created._id]);
    assert.strictEqual(history[0].c, 0, "no orphan booking_history rows");
    assert.strictEqual(materials[0].c, 0, "no orphan booking_material_requests rows");
    assert.strictEqual(items[0].c, 0, "no orphan booking_items rows");
  } finally {
    await pool.end();
  }
});

test("booking repository: transaction rollback leaves no partial booking when a child insert fails", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    // priest_checklist is a JSONB column with a "must be an object" CHECK
    // constraint. Passing a non-object passes the repository's JS validation
    // (it only defaults) but fails at the SQL layer inside the transaction, so
    // the booking row must also be rolled back.
    await assert.rejects(
      () => bookingRepository.create(bookingBase({ priestChecklist: "not-an-object" })),
      /check constraint|priest_checklist/
    );
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE devotee_name LIKE 'Deepthi %'"
    );
    const before = rows[0].c;
    await assert.rejects(
      () => bookingRepository.create(bookingBase({ priestChecklist: 42 })),
      /check constraint|priest_checklist/
    );
    const { rows: after } = await pool.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE devotee_name LIKE 'Deepthi %'"
    );
    assert.strictEqual(after[0].c, before, "failed booking create must not leave a row behind");
  } finally {
    await pool.end();
  }
});

test("booking repository: child FK prevents an orphan child row", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO booking_history (id, booking_id, new_status, updated_by, note) VALUES ($1, $2, $3, $4, $5)",
        [unique(), "000000000000000000000000", "Confirmed", "admin", "orphan"]
      ),
      /foreign key/
    );
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

test("booking repository: booking → Bill.sourceId relationship round-trips", async () => {
  // Mirrors devoteeController.createBooking: a booking persists, then a ledger
  // bill is created with sourceId = booking._id (billType 'Pooja Booking').
  // bills.source_id stays polymorphic TEXT (it also references prasadam orders),
  // so no FK exists; the relationship is verified through the migrated bill repo.
  const booking = await bookingRepository.create(bookingBase({ status: "Completed" }));
  const bill = await billRepository.create({
    devoteeName: booking.devoteeName,
    sevaType: booking.service,
    amount: booking.amount,
    paymentMode: booking.paymentMethod,
    billType: "Pooja Booking",
    referenceNo: `BK-${String(booking._id).slice(-6).toUpperCase()}`,
    sourceId: booking._id,
    notes: booking.notes || "",
    status: "Paid",
  });
  assert.strictEqual(bill.sourceId, booking._id);

  const bySource = await billRepository.findManyBySourceId(booking._id);
  assert.ok(bySource.some((b) => b._id === bill._id));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT source_id FROM bills WHERE id = $1", [bill._id]);
    assert.strictEqual(rows[0].source_id, booking._id);
  } finally {
    await pool.end();
  }
});

test("booking repository: booking → AccountTransaction.referenceId relationship round-trips", async () => {
  // Mirrors bookingController.updateBookingStatus recording an account
  // transaction with referenceId = booking._id and referenceModel = 'Booking'.
  // account_transactions.reference_id stays polymorphic TEXT.
  const booking = await bookingRepository.create(bookingBase({ status: "Completed" }));
  const tx = await accountTransactionRepository.create({
    transactionType: "Credit",
    source: "Pooja Booking",
    category: "Pooja Income",
    amount: booking.amount,
    financialYear: "2026-2027",
    paymentMethod: booking.paymentMethod,
    status: "Completed",
    description: `Pooja booking by ${booking.devoteeName}`,
    referenceId: booking._id,
    referenceModel: "Booking",
  });
  assert.strictEqual(tx.referenceId, booking._id);
  assert.strictEqual(tx.referenceModel, "Booking");

  const byRef = await accountTransactionRepository.findMany({
    filter: { referenceId: booking._id, referenceModel: "Booking" },
  });
  assert.ok(byRef.some((t) => t._id === tx._id));
});

test("booking repository: status transition history pattern (ALLOWED_TRANSITIONS) preserved", async () => {
  // Mirrors bookingController.updateBookingStatus: it validates against
  // ALLOWED_TRANSITIONS, sets new status + timestamp, and appends a history
  // entry. The repository's updateById with a full bookingHistory array replays
  // that in a single transaction.
  const created = await bookingRepository.create(bookingBase({
    status: "Pending",
    bookingHistory: [
      { previousStatus: null, newStatus: "Pending", updatedBy: "Admin", note: "Booking created" },
    ],
  }));

  const next = await bookingRepository.updateById(created._id, {
    status: "Approved",
    approvedAt: new Date("2026-09-20T07:00:00.000Z"),
    bookingHistory: [
      { previousStatus: null, newStatus: "Pending", updatedBy: "Admin", note: "Booking created" },
      { previousStatus: "Pending", newStatus: "Approved", updatedBy: "Admin", note: "Temple approved" },
    ],
  });
  assert.strictEqual(next.status, "Approved");
  assert.strictEqual(next.bookingHistory.length, 2);
  assert.strictEqual(next.bookingHistory[1].previousStatus, "Pending");
  assert.strictEqual(next.bookingHistory[1].newStatus, "Approved");
  assert.ok(next.approvedAt instanceof Date);
});

test("booking repository: material request inventoryRequestId round-trips", async () => {
  // Mirrors the inventory flow that attaches an inventoryRequestId to an
  // existing templeMaterialRequests entry in place (via booking.save()).
  const created = await bookingRepository.create(bookingBase({
    templeMaterialRequests: [{ item: "a".repeat(24), itemName: "Coconut", qty: "2 No", inventoryRequestId: "r".repeat(24) }],
  }));
  const read = await bookingRepository.findById(created._id);
  assert.strictEqual(read.templeMaterialRequests[0].inventoryRequestId, "r".repeat(24));
});