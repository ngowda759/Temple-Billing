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
let poojaBookingRepository;
let poojaBookingService;
let billRepository;
let accountTransactionRepository;

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
  poojaBookingRepository = require("../src/repositories/poojaBookingRepository");
  poojaBookingService = require("../src/services/poojaBookingService");
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

const poojaBookingBase = (overrides = {}) => ({
  customerName: `Lakshmi ${unique()}`,
  service: "Sathyanarayana Vratam",
  amount: 1550.5,
  paymentMethod: "UPI",
  contactNumber: "+91-90000-00001",
  bookingDate: new Date("2026-10-10T09:30:00.000Z"),
  createdBy: "c".repeat(24),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test("pooja_bookings table schema matches the Mongo PoojaBooking model", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'pooja_bookings' ORDER BY ordinal_position`);
    const col = (name) => cols.find((c) => c.column_name === name);
    assert.ok(col("id") && col("id").data_type === "text", "id text PK");
    assert.ok(col("booking_number") && col("booking_number").is_nullable === "NO", "bookingNumber NOT NULL");
    assert.ok(col("customer_name") && col("customer_name").is_nullable === "NO", "customerName NOT NULL");
    assert.ok(col("service") && col("service").is_nullable === "NO", "service NOT NULL");
    assert.ok(col("amount") && col("amount").data_type === "numeric" && col("amount").is_nullable === "NO", "amount numeric NOT NULL");
    assert.ok(col("payment_method") && col("payment_method").is_nullable === "NO", "paymentMethod NOT NULL");
    assert.ok(col("contact_number") && col("contact_number").is_nullable === "NO", "contactNumber NOT NULL");
    assert.ok(col("email") && col("email").is_nullable === "YES", "email nullable");
    assert.ok(col("address") && col("address").is_nullable === "YES", "address nullable");
    assert.ok(col("notes") && col("notes").column_default === "''::text", "notes default ''");
    assert.ok(col("booking_date") && col("booking_date").data_type === "timestamp with time zone" && col("booking_date").is_nullable === "NO", "bookingDate timestamptz NOT NULL");
    assert.ok(col("status") && col("status").column_default === "'Booked'::text", "status default Booked");
    assert.ok(col("created_by") && col("created_by").is_nullable === "NO", "createdBy NOT NULL");
    assert.ok(col("temple_arrangement") && col("temple_arrangement").data_type === "boolean" && col("temple_arrangement").column_default === "false", "templeArrangement default false");
    assert.ok(col("temple_material_charge") && col("temple_material_charge").data_type === "numeric" && col("temple_material_charge").column_default === "0", "templeMaterialCharge numeric default 0");
    assert.ok(col("material_status") && col("material_status").column_default === "'N/A'::text", "materialStatus default N/A");
    assert.ok(col("priest_checklist") && col("priest_checklist").data_type === "jsonb", "priestChecklist jsonb");
    assert.ok(col("created_at") && col("created_at").data_type === "timestamp with time zone", "createdAt timestamptz");
    assert.ok(col("updated_at") && col("updated_at").data_type === "timestamp with time zone", "updatedAt timestamptz");

    const { rows: checks } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'pooja_bookings'::regclass AND contype = 'c'`);
    const defs = checks.map((r) => r.def);
    assert.ok(defs.some((d) => /payment_method.*'UPI'.*'Cash'.*'Card'/.test(d)), "paymentMethod CHECK");
    assert.ok(defs.some((d) => /status.*'Booked'.*'Completed'.*'Cancelled'/.test(d)), "status CHECK");
    assert.ok(defs.some((d) => /material_status.*'N\/A'.*'Pending'.*'Approved'.*'Reserved'.*'Ready'.*'Issued'.*'Consumed'.*'Cancelled'/.test(d)), "materialStatus CHECK");
    assert.ok(defs.some((d) => /amount\s*>=\s*\(0\)/.test(d)), "amount >= 0 CHECK");

    const { rows: uniq } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'pooja_bookings'::regclass AND contype = 'u'`);
    assert.ok(uniq.some((r) => /UNIQUE \(booking_number\)/.test(r.def)), "bookingNumber UNIQUE");

    const { rows: idx } = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pooja_bookings'`);
    const idxDefs = idx.map((r) => r.indexdef);
    assert.ok(idxDefs.some((d) => /idx_pooja_bookings_created_at/.test(d) && /DESC/.test(d)), "created_at DESC index");
    assert.ok(idxDefs.some((d) => /idx_pooja_bookings_created_by/.test(d)), "created_by index");
    assert.ok(idxDefs.some((d) => /idx_pooja_bookings_booking_date/.test(d)), "booking_date index");
    assert.ok(idxDefs.some((d) => /idx_pooja_bookings_status/.test(d)), "status index");
    assert.ok(idxDefs.some((d) => /idx_pooja_bookings_service/.test(d)), "service index");

    const { rows: children } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'pooja_booking_material_requests' ORDER BY ordinal_position`);
    const childCols = children.map((c) => c.column_name);
    for (const name of ["id", "pooja_booking_id", "position", "item", "item_name", "qty"]) {
      assert.ok(childCols.includes(name), `child column ${name}`);
    }
    assert.ok(!childCols.includes("unit"), "unit is not persisted on the Mongo PoojaBooking sub-schema");

    const { rows: fks } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'pooja_booking_material_requests'::regclass AND contype = 'f'`);
    assert.ok(fks.some((r) => /REFERENCES pooja_bookings\(id\).*ON DELETE CASCADE/.test(r.def)), "child FK cascade");
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

test("pooja booking repository: create → read → update round trip", async () => {
  const created = await poojaBookingRepository.create(poojaBookingBase());
  assert.ok(created._id);
  assert.strictEqual(created.customerName.startsWith("Lakshmi "), true);
  assert.strictEqual(created.amount, 1550.5);
  assert.strictEqual(created.service, "Sathyanarayana Vratam");
  assert.strictEqual(created.paymentMethod, "UPI");
  assert.strictEqual(created.status, "Booked");
  assert.strictEqual(created.materialStatus, "N/A");
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.bookingDate instanceof Date);
  assert.deepStrictEqual(created.priestChecklist, {});

  const byId = await poojaBookingRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.bookingNumber, created.bookingNumber);

  const updated = await poojaBookingRepository.updateById(created._id, {
    status: "Completed",
    materialStatus: "Consumed",
    notes: "Completed after vratam",
  });
  assert.strictEqual(updated.status, "Completed");
  assert.strictEqual(updated.materialStatus, "Consumed");
  assert.strictEqual(updated.notes, "Completed after vratam");
  assert.ok(updated.updatedAt instanceof Date);
});

test("pooja booking repository: normalized children round-trip (templeMaterialRequests)", async () => {
  const created = await poojaBookingRepository.create(poojaBookingBase({
    templeMaterialRequests: [
      { item: "a".repeat(24), itemName: "Coconut", qty: "2 No" },
      { item: "b".repeat(24), itemName: "Banana", qty: "3 Nos" },
    ],
  }));
  const read = await poojaBookingRepository.findById(created._id);
  assert.strictEqual(read.templeMaterialRequests.length, 2);
  assert.strictEqual(read.templeMaterialRequests[0].itemName, "Coconut");
  assert.strictEqual(read.templeMaterialRequests[0].qty, "2 No");
  assert.strictEqual(read.templeMaterialRequests[1].itemName, "Banana");

  // Array order is preserved even after an update that rewrites the children.
  const updated = await poojaBookingRepository.updateById(created._id, {
    templeArrangement: true,
    templeMaterialRequests: read.templeMaterialRequests,
  });
  assert.strictEqual(updated.templeArrangement, true);
  assert.strictEqual(updated.templeMaterialRequests.length, 2);
  assert.strictEqual(updated.templeMaterialRequests[0].itemName, "Coconut");
  assert.strictEqual(updated.templeMaterialRequests[1].itemName, "Banana");
});

// ---------------------------------------------------------------------------
// Legacy Mongo field mapping
// ---------------------------------------------------------------------------

test("pooja booking repository: legacy Mongo field mapping round-trips every persisted field", async () => {
  const createdBy = "e".repeat(24);
  const bookingDate = new Date("2026-11-01T06:15:00.000Z");
  const priestChecklist = {
    devoteeArrived: true,
    templeMaterialsReceived: false,
    devoteeMaterialsChecked: true,
    poojaStarted: false,
    poojaCompleted: false,
    inventoryConsumed: false,
  };
  const created = await poojaBookingRepository.create(poojaBookingBase({
    bookingNumber: "PB9999",
    customerName: "  Dev Priya  ",
    service: "  Rudrabhishekam  ",
    amount: "123456789.1234",
    paymentMethod: "Cash",
    contactNumber: "  +91-90000-00002  ",
    email: "  DevPriya@Example.com ",
    address: "  Temple Street, 1st Cross  ",
    notes: "Bring coconut",
    bookingDate,
    createdBy,
    templeArrangement: true,
    templeMaterialCharge: 250.75,
    materialStatus: "Pending",
    priestChecklist,
  }));

  // Trim + camelCase mapping (Mongo schema declares trim: true for strings).
  assert.strictEqual(created.customerName, "Dev Priya");
  assert.strictEqual(created.service, "Rudrabhishekam");
  assert.strictEqual(created.contactNumber, "+91-90000-00002");
  assert.strictEqual(created.email, "DevPriya@Example.com");
  assert.ok(created._id);
  assert.strictEqual(created.bookingNumber, "PB9999");
  assert.strictEqual(created.createdBy, createdBy);
  assert.strictEqual(created.templeArrangement, true);
  assert.strictEqual(created.templeMaterialCharge, 250.75);
  assert.strictEqual(created.materialStatus, "Pending");
  assert.deepStrictEqual(created.priestChecklist, priestChecklist);
  assert.strictEqual(created.bookingDate.toISOString(), "2026-11-01T06:15:00.000Z");

  // Monetary precision round-trips exactly through NUMERIC.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT amount::text AS amount, temple_material_charge::text AS charge FROM pooja_bookings WHERE id = $1", [created._id]);
    assert.strictEqual(rows[0].amount, "123456789.1234");
    assert.strictEqual(rows[0].charge, "250.75");
  } finally {
    await pool.end();
  }

  const noop = await poojaBookingRepository.updateById(created._id, {});
  assert.strictEqual(noop._id, created._id);
});

test("pooja booking repository: exact monetary precision for boundary values", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const values = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234"];
    for (const v of values) {
      const created = await poojaBookingRepository.create(poojaBookingBase({ amount: v, bookingNumber: `PB${Math.floor(Math.random() * 900000) + 100000}` }));
      const { rows } = await pool.query("SELECT amount::text AS amount FROM pooja_bookings WHERE id = $1", [created._id]);
      assert.strictEqual(rows[0].amount, v, `amount ${v} must round-trip exactly`);
    }
  } finally {
    await pool.end();
  }
});

test("pooja booking repository: 24-char hex Mongo ObjectId preserved verbatim", async () => {
  const id = "abcdef1234567890abcdef12";
  const created = await poojaBookingRepository.create(poojaBookingBase({ id }));
  assert.strictEqual(created._id, id);
  assert.strictEqual(created.id, id);
  const byId = await poojaBookingRepository.findById(id);
  assert.strictEqual(byId._id, id);
});

// ---------------------------------------------------------------------------
// Enums, validation, defaults
// ---------------------------------------------------------------------------

test("pooja booking repository: invalid enums are rejected", async () => {
  await assert.rejects(
    () => poojaBookingRepository.create(poojaBookingBase({ paymentMethod: "Cheque" })),
    /Invalid paymentMethod/
  );
  await assert.rejects(
    () => poojaBookingRepository.create(poojaBookingBase({ status: "Refunded" })),
    /Invalid status/
  );
  await assert.rejects(
    () => poojaBookingRepository.create(poojaBookingBase({ materialStatus: "Pending Approval" })),
    /Invalid materialStatus/
  );
});

test("pooja booking repository: mandatory fields are required", async () => {
  await assert.rejects(() => poojaBookingRepository.create(poojaBookingBase({ customerName: "" })), /customerName is required/);
  await assert.rejects(() => poojaBookingRepository.create(poojaBookingBase({ service: "  " })), /service is required/);
  await assert.rejects(() => poojaBookingRepository.create(poojaBookingBase({ amount: undefined })), /amount is required/);
  await assert.rejects(() => poojaBookingRepository.create(poojaBookingBase({ paymentMethod: "" })), /paymentMethod is required/);
  await assert.rejects(() => poojaBookingRepository.create(poojaBookingBase({ bookingDate: "not-a-date" })), /bookingDate is required/);
  await assert.rejects(() => poojaBookingRepository.create(poojaBookingBase({ createdBy: "" })), /createdBy is required/);
});

test("pooja booking repository: DB-level CHECK constraints reject invalid values", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO pooja_bookings (id, booking_number, customer_name, service, amount, payment_method, contact_number, booking_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [unique(), "PBCHK1", "X", "Pooja", 100, "Net Banking", "999", new Date(), "a".repeat(24)]
      ),
      /check constraint/
    );
    await assert.rejects(
      () => pool.query(
        "INSERT INTO pooja_bookings (id, booking_number, customer_name, service, amount, payment_method, contact_number, booking_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [unique(), "PBCHK2", "X", "Pooja", -5, "UPI", "999", new Date(), "a".repeat(24)]
      ),
      /check constraint/
    );
    // duplicate bookingNumber must be rejected by the UNIQUE constraint
    await pool.query(
      "INSERT INTO pooja_bookings (id, booking_number, customer_name, service, amount, payment_method, contact_number, booking_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [unique(), "PBUNIQ1", "X", "Pooja", 100, "UPI", "999", new Date(), "a".repeat(24)]
    );
    await assert.rejects(
      () => pool.query(
        "INSERT INTO pooja_bookings (id, booking_number, customer_name, service, amount, payment_method, contact_number, booking_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [unique(), "PBUNIQ1", "Y", "Pooja", 100, "UPI", "999", new Date(), "a".repeat(24)]
      ),
      /duplicate key/
    );
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Date / time behaviour
// ---------------------------------------------------------------------------

test("pooja booking repository: bookingDate TIMESTAMPTZ round-trips and filters by range", async () => {
  const booked = await poojaBookingRepository.create(poojaBookingBase({
    bookingDate: new Date("2026-12-25T10:00:00.000Z"),
    status: "Booked",
  }));
  const read = await poojaBookingRepository.findById(booked._id);
  assert.strictEqual(read.bookingDate.toISOString(), "2026-12-25T10:00:00.000Z");

  // Mirrors the app.js daily cron: status Booked, bookingDate in [$gte, $lt).
  const day = await poojaBookingRepository.findMany({
    filter: { status: "Booked", bookingDate: { $gte: new Date("2026-12-25T00:00:00.000Z"), $lt: new Date("2026-12-26T00:00:00.000Z") } },
  });
  assert.ok(day.some((b) => b._id === booked._id));
  const nextDay = await poojaBookingRepository.findMany({
    filter: { status: "Booked", bookingDate: { $gte: new Date("2026-12-26T00:00:00.000Z"), $lt: new Date("2026-12-27T00:00:00.000Z") } },
  });
  assert.ok(!nextDay.some((b) => b._id === booked._id));
});

// ---------------------------------------------------------------------------
// Filters, sorting, pagination, count
// ---------------------------------------------------------------------------

test("pooja booking repository: getMyBookings-style filters, search, sort and pagination", async () => {
  const createdBy = "f".repeat(24);
  const a = await poojaBookingRepository.create(poojaBookingBase({
    createdBy,
    customerName: "Alpha Kumar",
    service: "Sathyanarayana Vratam",
    bookingNumber: "PB8001",
  }));
  await poojaBookingRepository.create(poojaBookingBase({
    createdBy,
    customerName: "Beta Rao",
    service: "Rudrabhishekam",
    status: "Completed",
    bookingNumber: "PB8002",
  }));
  await poojaBookingRepository.create(poojaBookingBase({
    createdBy: "9".repeat(24),
    customerName: "Gamma Iyer",
    service: "Sathyanarayana Vratam",
    bookingNumber: "PB8003",
  }));

  const mine = await poojaBookingRepository.findMany({ filter: { createdBy } });
  assert.ok(mine.length >= 2);
  assert.ok(mine.every((b) => b.createdBy === createdBy));

  const filtered = await poojaBookingRepository.findMany({ filter: { createdBy, status: "Completed" } });
  assert.ok(filtered.every((b) => b.createdBy === createdBy && b.status === "Completed"));

  const searched = await poojaBookingRepository.findMany({ filter: { createdBy, search: "Beta" } });
  assert.strictEqual(searched.length, 1);
  assert.strictEqual(searched[0].customerName, "Beta Rao");

  const searchedService = await poojaBookingRepository.findMany({ filter: { search: "rudrabhish" } });
  assert.ok(searchedService.some((b) => b.service === "Rudrabhishekam"));

  const byService = await poojaBookingRepository.findMany({ filter: { service: "Sathyanarayana Vratam" } });
  assert.ok(byService.some((b) => b._id === a._id));

  // status $in (covers the getMyBookings optional status filter shape).
  const inStatus = await poojaBookingRepository.findMany({ filter: { status: { $in: ["Booked", "Completed"] } } });
  assert.ok(inStatus.length > 0);

  // Sorting + pagination (getMyBookings uses createdAt DESC + skip/limit).
  const page1 = await poojaBookingRepository.findMany({ filter: { createdBy }, sort: { createdAt: -1 }, limit: 1, offset: 0 });
  const page2 = await poojaBookingRepository.findMany({ filter: { createdBy }, sort: { createdAt: -1 }, limit: 1, offset: 1 });
  assert.strictEqual(page1.length, 1);
  assert.strictEqual(page2.length, 1);
  assert.notStrictEqual(page1[0]._id, page2[0]._id, "pagination must not repeat rows");

  // Explicit dynamic-sort whitelist.
  const byAmount = await poojaBookingRepository.findMany({ sort: "amount" });
  assert.ok(byAmount.length > 0);

  const total = await poojaBookingRepository.count({ createdBy });
  const totalAll = await poojaBookingRepository.count();
  assert.ok(total >= 2);
  assert.ok(totalAll >= total);
});

test("pooja booking repository: findOne and findOneByBookingNumber", async () => {
  const created = await poojaBookingRepository.create(poojaBookingBase({ bookingNumber: "PB7_" + unique() }));
  const one = await poojaBookingRepository.findOne({ bookingNumber: created.bookingNumber });
  assert.strictEqual(one._id, created._id);
  const byNum = await poojaBookingRepository.findOneByBookingNumber(created.bookingNumber);
  assert.strictEqual(byNum._id, created._id);
  assert.strictEqual(await poojaBookingRepository.findOne({ bookingNumber: "PB-DOES-NOT-EXIST" }), null);
});

// ---------------------------------------------------------------------------
// Delete & transactions
// ---------------------------------------------------------------------------

test("pooja booking repository: destroy reports existence and drops children via the FK", async () => {
  const created = await poojaBookingRepository.create(poojaBookingBase({
    templeMaterialRequests: [{ itemName: "Coconut", qty: "1" }],
  }));
  assert.ok(created.templeMaterialRequests.length > 0);

  assert.strictEqual(await poojaBookingRepository.destroy(created._id), true);
  assert.strictEqual(await poojaBookingRepository.findById(created._id), null);
  assert.strictEqual(await poojaBookingRepository.destroy(created._id), false);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM pooja_booking_material_requests WHERE pooja_booking_id = $1", [created._id]);
    assert.strictEqual(rows[0].c, 0, "no orphan pooja_booking_material_requests rows");
  } finally {
    await pool.end();
  }
});

test("pooja booking repository: transaction rollback leaves no partial pooja booking when a child insert fails", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    // priest_checklist is a JSONB column with a "must be an object" CHECK
    // constraint. Passing a non-object passes the repository's JS validation
    // (it only defaults) but fails at the SQL layer inside the transaction, so
    // the booking row must also be rolled back.
    const { rows: before } = await pool.query(
      "SELECT COUNT(*)::int AS c FROM pooja_bookings WHERE customer_name LIKE 'Lakshmi %'"
    );
    await assert.rejects(
      () => poojaBookingRepository.create(poojaBookingBase({ priestChecklist: "not-an-object" })),
      /check constraint|priest_checklist/
    );
    const { rows: after } = await pool.query(
      "SELECT COUNT(*)::int AS c FROM pooja_bookings WHERE customer_name LIKE 'Lakshmi %'"
    );
    assert.strictEqual(after[0].c, before[0].c, "failed pooja booking create must not leave a row behind");
  } finally {
    await pool.end();
  }
});

test("pooja booking repository: child FK prevents an orphan child row", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await assert.rejects(
      () => pool.query(
        "INSERT INTO pooja_booking_material_requests (id, pooja_booking_id, item_name, qty) VALUES ($1, $2, $3, $4)",
        [unique(), "000000000000000000000000", "Coconut", "1"]
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

test("pooja booking repository: pooja booking → Bill.sourceId relationship round-trips", async () => {
  // Mirrors the devoteeController/syncService pattern: a booking persists, then
  // a ledger bill may be created with sourceId = poojaBooking._id (billType
  // 'Pooja Booking'). bills.source_id stays polymorphic TEXT (it also
  // references bookings, donations and prasadam orders), so no FK exists; the
  // relationship is verified through the migrated bill repo.
  const poojaBooking = await poojaBookingRepository.create(poojaBookingBase());
  const bill = await billRepository.create({
    devoteeName: poojaBooking.customerName,
    sevaType: poojaBooking.service,
    amount: poojaBooking.amount,
    paymentMode: poojaBooking.paymentMethod,
    billType: "Pooja Booking",
    referenceNo: `PB-${String(poojaBooking._id).slice(-6).toUpperCase()}`,
    sourceId: poojaBooking._id,
    notes: poojaBooking.notes || "",
    status: "Paid",
  });
  assert.strictEqual(bill.sourceId, poojaBooking._id);

  const bySource = await billRepository.findManyBySourceId(poojaBooking._id);
  assert.ok(bySource.some((b) => b._id === bill._id));

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT source_id FROM bills WHERE id = $1", [bill._id]);
    assert.strictEqual(rows[0].source_id, poojaBooking._id);
  } finally {
    await pool.end();
  }
});

test("pooja booking repository: pooja booking → AccountTransaction.referenceId relationship round-trips", async () => {
  // Mirrors poojaBookingController.createBooking: recordTransaction is called
  // with referenceId = savedBooking._id and referenceModel = 'PoojaBooking'.
  // account_transactions.reference_id stays polymorphic TEXT.
  const poojaBooking = await poojaBookingRepository.create(poojaBookingBase());
  const tx = await accountTransactionRepository.create({
    transactionType: "Credit",
    source: "Pooja Booking",
    category: poojaBooking.service,
    amount: poojaBooking.amount,
    financialYear: "2026-2027",
    paymentMethod: poojaBooking.paymentMethod,
    status: "Completed",
    description: `Pooja Booking: ${poojaBooking.bookingNumber}`,
    referenceId: poojaBooking._id,
    referenceModel: "PoojaBooking",
    recordedBy: poojaBooking.createdBy,
  });
  assert.strictEqual(tx.referenceId, poojaBooking._id);
  assert.strictEqual(tx.referenceModel, "PoojaBooking");

  const byRef = await accountTransactionRepository.findMany({
    filter: { referenceId: poojaBooking._id, referenceModel: "PoojaBooking" },
  });
  assert.ok(byRef.some((t) => t._id === tx._id));
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

test("pooja booking service: validation and defaults mirror the Mongo schema", () => {
  assert.ok(poojaBookingService.isConnected());

  const normalized = poojaBookingService.create;
  assert.ok(normalized);

  // generateBookingNumber mirrors the Mongo pre-validate hook.
  assert.strictEqual(poojaBookingService.generateBookingNumber([], undefined), "PB1001");
  assert.strictEqual(poojaBookingService.generateBookingNumber(["PB1042"], undefined), "PB1043");
  assert.strictEqual(poojaBookingService.generateBookingNumber([], "PB2042"), "PB2043");

  // validate() enforces required fields + enums.
  assert.throws(() => poojaBookingService.validate({}), /customerName is required/);
  assert.throws(
    () => poojaBookingService.validate({ ...poojaBookingBase(), paymentMethod: "Cheque" }),
    /Invalid paymentMethod/
  );
  assert.throws(
    () => poojaBookingService.validate({ ...poojaBookingBase(), amount: -10 }),
    /Invalid amount/
  );
  assert.throws(
    () => poojaBookingService.validate({ ...poojaBookingBase(), materialStatus: "Pending Approval" }),
    /Invalid materialStatus/
  );
});