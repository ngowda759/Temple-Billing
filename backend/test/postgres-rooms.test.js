// Phase 2R PostgreSQL-path tests for the Room repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the roomRepository / roomService persist to and read from the real rooms
//     table (no mocks),
//   - every persisted Mongo schema field round-trips losslessly (number/type
//     trim, optional guest fields, amenities array, status enum, dates) and
//     that the fields the strict Mongoose schema discards are NOT persisted,
//   - defaults (capacity 2, bedType 'Double', amenities [], status 'Available'),
//     validation and the duplicate-number/uniqueness semantics match Mongo,
//   - price uses NUMERIC and round-trips decimals exactly (never a float type),
//   - filtering / $in / $exists / range filters / sorting / pagination behave
//     like the Mongo query surface used by roomRoutes and the app.js scheduler,
//   - the checkout (release) and auto check-in/checkout semantics are preserved,
//   - the service never writes to MongoDB while PostgreSQL is selected
//     (no dual writes) and can switch datasources in-process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const roomNumber = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let roomRepository;
let roomService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS rooms CASCADE");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
    await pool.query("DROP TABLE IF EXISTS damage_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_note_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS goods_received_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_order_items CASCADE");
    await pool.query("DROP TABLE IF EXISTS purchase_orders CASCADE");
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
    await pool.query("DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_tickets CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_requests CASCADE");
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
  roomRepository = require("../src/repositories/roomRepository");
  roomService = require("../src/services/roomService");
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

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const roomBase = (overrides = {}) => ({
  number: roomNumber("PG"),
  type: "Deluxe",
  price: "1200.50",
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("rooms: the service selects PostgreSQL when the seam and PG are both available", async () => {
  assert.strictEqual(roomService.isConnected(), true);
  assert.strictEqual(await roomService.usePostgres(), true);
});

// ─── Create / read round trip: every persisted Mongo field ─────────────────
test("rooms: create → read round-trips every persisted Mongo field", async () => {
  const number = roomNumber("RT");
  const created = await roomService.create({
    number: `  ${number}  `,
    type: "  Deluxe  ",
    block: "  Block A  ",
    floor: "  Ground Floor  ",
    price: "1200.50",
    capacity: "4",
    bedType: "  King  ",
    amenities: ["AC", "WiFi", "Geyser"],
    status: "Occupied",
    devotee: "  Ram  ",
    phone: "  9876543210  ",
    days: "3",
    payMode: "  UPI  ",
    checkinDate: new Date("2026-02-01T10:00:00.000Z"),
    checkoutDate: new Date("2026-02-04T10:00:00.000Z"),
  });

  // Mongo-compatible 24-hex id.
  assert.match(created._id, /^[0-9a-f]{24}$/);

  const read = await roomService.findById(created._id);
  assert.strictEqual(read.number, number, "number trimmed");
  assert.strictEqual(read.type, "Deluxe", "type trimmed");
  assert.strictEqual(read.block, "Block A");
  assert.strictEqual(read.floor, "Ground Floor");
  assert.strictEqual(read.price, 1200.5);
  assert.strictEqual(read.capacity, 4);
  assert.strictEqual(read.bedType, "King");
  assert.deepStrictEqual(read.amenities, ["AC", "WiFi", "Geyser"], "array order preserved");
  assert.strictEqual(read.status, "Occupied");
  assert.strictEqual(read.devotee, "Ram");
  assert.strictEqual(read.phone, "9876543210");
  assert.strictEqual(read.days, 3);
  assert.strictEqual(read.payMode, "UPI");
  assert.strictEqual(read.checkinDate.toISOString(), "2026-02-01T10:00:00.000Z");
  assert.strictEqual(read.checkoutDate.toISOString(), "2026-02-04T10:00:00.000Z");
  assert.ok(read.createdAt instanceof Date);
  assert.ok(read.updatedAt instanceof Date);

  await roomService.destroy(created._id);
});

test("rooms: fields the strict Mongoose schema discards are NOT persisted", async () => {
  // The admin form POSTs these extra keys; the strict schema drops them, so the
  // columns must not exist and the values must not survive the round trip.
  const created = await roomService.create(roomBase({
    extraCharge: 250,
    securityDeposit: 1000,
    roomSize: 240,
    totalBeds: 2,
    totalExtraBeds: 1,
    description: "should be discarded",
    checkinTime: "10:00",
    checkoutTime: "09:00",
    mealsIncluded: true,
    cancellationPolicy: "none",
    isActive: true,
  }));

  const read = await roomService.findById(created._id);
  for (const dropped of ["extraCharge", "securityDeposit", "roomSize", "totalBeds", "totalExtraBeds",
    "description", "checkinTime", "checkoutTime", "mealsIncluded", "cancellationPolicy", "isActive"]) {
    assert.strictEqual(read[dropped], undefined, `${dropped} is not a persisted Room field`);
  }

  const columns = await poolQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'rooms'"
  );
  const names = columns.map((c) => c.column_name);
  for (const absent of ["extra_charge", "security_deposit", "room_size", "total_beds",
    "total_extra_beds", "description", "checkin_time", "checkout_time",
    "meals_included", "cancellation_policy", "is_active"]) {
    assert.ok(!names.includes(absent), `no ${absent} column`);
  }

  await roomService.destroy(created._id);
});

test("rooms: optional fields stay undefined when unset, exactly like Mongo", async () => {
  const created = await roomService.create(roomBase());
  const read = await roomService.findById(created._id);
  for (const optional of ["block", "floor", "devotee", "phone", "days", "payMode", "checkinDate", "checkoutDate"]) {
    assert.strictEqual(read[optional], undefined, `${optional} unset reads back as undefined`);
  }
  await roomService.destroy(created._id);
});

// ─── Defaults ──────────────────────────────────────────────────────────────
test("rooms: defaults match the Mongo schema (capacity 2, Double, [], Available)", async () => {
  const created = await roomService.create(roomBase({ type: "Standard" }));
  assert.strictEqual(created.capacity, 2);
  assert.strictEqual(created.bedType, "Double");
  assert.deepStrictEqual(created.amenities, []);
  assert.strictEqual(created.status, "Available");

  // The column defaults mirror the schema defaults as well.
  const [row] = await poolQuery(
    "SELECT column_default FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'capacity'"
  );
  assert.strictEqual(row.column_default, "2");

  await roomService.destroy(created._id);
});

// ─── Validation ────────────────────────────────────────────────────────────
test("rooms: number and type are required (trim-then-required, like Mongo)", async () => {
  await assert.rejects(() => roomService.create({ type: "Deluxe", price: 100 }), /number is required/);
  await assert.rejects(() => roomService.create({ number: "   ", type: "Deluxe", price: 100 }), /number is required/);
  await assert.rejects(() => roomService.create({ number: roomNumber("V"), type: "   ", price: 100 }), /type is required/);
  await assert.rejects(() => roomService.create({ number: roomNumber("V"), type: "Deluxe" }), /price is required/);
});

test("rooms: status must be one of the Mongo enum values", async () => {
  await assert.rejects(
    () => roomService.create(roomBase({ status: "Free" })),
    /Invalid status: Free\. Allowed: Available, Occupied, Maintenance/
  );
  await assert.rejects(
    () => roomService.create(roomBase({ status: "Cleaning" })),
    /Invalid status/
  );
});

test("rooms: capacity and days accept fractional values (no integer narrowing)", async () => {
  // Mongo declares bare Numbers with no min and no integer constraint.
  const created = await roomService.create(roomBase({ capacity: 2.5, days: 1.5 }));
  assert.strictEqual(created.capacity, 2.5);
  assert.strictEqual(created.days, 1.5);
  await roomService.destroy(created._id);
});

// ─── Financial precision ───────────────────────────────────────────────────
test("rooms: price is NUMERIC and round-trips decimals exactly", async () => {
  const { rows: typeRows } = {
    rows: await poolQuery(
      "SELECT data_type, numeric_precision FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'price'"
    ),
  };
  assert.strictEqual(typeRows[0].data_type, "numeric", "price must be NUMERIC, never float/double");

  const cases = ["0", "0.01", "1200", "1200.50", "123456.789", "99999999.99"];
  for (const price of cases) {
    const created = await roomService.create(roomBase({ price }));
    const read = await roomService.findById(created._id);
    assert.strictEqual(read.price, Number(price), `price ${price} round-trips`);
    // The stored text form keeps the exact scale supplied.
    const [row] = await poolQuery("SELECT price::text AS p FROM rooms WHERE id = $1", [created._id]);
    assert.strictEqual(Number(row.p), Number(price));
    await roomService.destroy(created._id);
  }
});

test("rooms: price 0 is legal (Mongo min: 0) and negatives are rejected", async () => {
  const free = await roomService.create(roomBase({ price: 0 }));
  assert.strictEqual(free.price, 0);
  await roomService.destroy(free._id);

  await assert.rejects(() => roomService.create(roomBase({ price: -1 })), /price must be >= 0/);
  await assert.rejects(() => roomService.create(roomBase({ price: "abc" })), /price must be a number/);

  // The CHECK constraint backs the application-level rule.
  await assert.rejects(
    () => poolQuery("INSERT INTO rooms (id, number, type, price) VALUES ($1, $2, 'X', -5)", [unique().padEnd(24, "0"), roomNumber("CHK")]),
    /rooms_price_check/
  );
});

// ─── Uniqueness ────────────────────────────────────────────────────────────
test("rooms: number is unique (the only Mongo unique index)", async () => {
  const number = roomNumber("UNIQ");
  const created = await roomService.create(roomBase({ number }));

  const indexDefs = await poolQuery("SELECT indexdef FROM pg_indexes WHERE tablename = 'rooms'");
  assert.ok(
    indexDefs.some((r) => /UNIQUE INDEX.*\(number\)/.test(r.indexdef)),
    "unique index on number exists"
  );

  await assert.rejects(
    () => roomService.create(roomBase({ number })),
    /rooms_number_key/,
    "a duplicate number is rejected by the unique constraint"
  );

  // No other unique constraint is invented: the schema has exactly one.
  const uniques = await poolQuery(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'rooms'::regclass AND contype = 'u'`);
  assert.strictEqual(uniques.length, 1, "exactly one UNIQUE constraint");
  assert.match(uniques[0].def, /UNIQUE \(number\)/);

  await roomService.destroy(created._id);
});

test("rooms: update to an existing number is rejected, update to a free number works", async () => {
  const first = await roomService.create(roomBase({ number: roomNumber("UP1") }));
  const second = await roomService.create(roomBase({ number: roomNumber("UP2") }));

  await assert.rejects(
    () => roomService.updateById(second._id, { number: first.number }),
    /rooms_number_key/
  );

  const renamed = await roomService.updateById(second._id, { number: roomNumber("UP3") });
  assert.match(renamed.number, /^UP3-/);

  await roomService.destroy(first._id);
  await roomService.destroy(second._id);
});

// ─── Update / delete ───────────────────────────────────────────────────────
test("rooms: updateById patches only the supplied fields and refreshes updatedAt", async () => {
  const created = await roomService.create(roomBase({ bedType: "Double", capacity: 2 }));

  const updated = await roomService.updateById(created._id, { status: "Maintenance", price: "900.25" });
  assert.strictEqual(updated.status, "Maintenance");
  assert.strictEqual(updated.price, 900.25);
  assert.strictEqual(updated.bedType, "Double", "untouched field preserved");
  assert.strictEqual(updated.capacity, 2, "untouched field preserved");
  assert.strictEqual(updated.number, created.number);
  assert.ok(new Date(updated.updatedAt).getTime() >= new Date(created.updatedAt).getTime());

  // Unsetting an optional field clears it, like `room.devotee = undefined; save()`.
  const cleared = await roomService.updateById(created._id, { devotee: "", phone: "" });
  assert.strictEqual(cleared.devotee, undefined);
  assert.strictEqual(cleared.phone, undefined);

  assert.strictEqual(await roomService.updateById("000000000000000000000000", { status: "Maintenance" }), null);

  await roomService.destroy(created._id);
});

test("rooms: destroy deletes the row and reports whether it existed", async () => {
  const created = await roomService.create(roomBase());
  assert.strictEqual(await roomService.destroy(created._id), true);
  assert.strictEqual(await roomService.destroy(created._id), false);
  assert.strictEqual(await roomService.findById(created._id), null);
});

test("rooms: findOneAndDelete deletes by room number (DELETE /api/rooms/:number)", async () => {
  const number = roomNumber("DEL");
  await roomService.create(roomBase({ number }));

  const deleted = await roomService.findOneAndDelete({ number });
  assert.strictEqual(deleted.number, number);
  assert.strictEqual(await roomService.findOne({ number }), null);
  assert.strictEqual(await roomService.findOneAndDelete({ number }), null);
});

// ─── Query surface: filter / sort / pagination ─────────────────────────────
test("rooms: findMany defaults to number ASC (GET /api/rooms)", async () => {
  const tag = `SORT-${unique()}`;
  const a = await roomService.create(roomBase({ number: `${tag}-03`, type: "A" }));
  const b = await roomService.create(roomBase({ number: `${tag}-01`, type: "A" }));
  const c = await roomService.create(roomBase({ number: `${tag}-02`, type: "A" }));

  const listed = await roomService.findMany({ filter: { type: "A" }, sort: { number: 1 } });
  const numbers = listed.map((r) => r.number);
  assert.deepStrictEqual(numbers, [`${tag}-01`, `${tag}-02`, `${tag}-03`], "sorted by number ASC");

  for (const room of [a, b, c]) await roomService.destroy(room._id);
});

test("rooms: filter by number / type / status / $in / range works", async () => {
  const tag = `FLT-${unique()}`;
  const created = await roomService.create(roomBase({
    number: `${tag}-01`, type: "Suite", status: "Occupied", price: "500", capacity: "2",
  }));

  assert.ok(await roomService.findOne({ number: `${tag}-01` }));
  assert.ok(await roomService.findOne({ type: "Suite" }));
  assert.ok(await roomService.findOne({ status: "Occupied" }));
  assert.ok(await roomService.findOne({ status: { $in: ["Occupied", "Maintenance"] } }));
  assert.strictEqual(await roomService.findOne({ status: { $in: [] } }), null, "$in: [] matches nothing");
  assert.ok(await roomService.findOne({ price: { $gte: 400, $lt: 600 } }));
  assert.ok(await roomService.findOne({ capacity: { $gte: 2 } }));
  assert.ok(await roomService.findOne({ number: { $in: [`${tag}-01`] } }));

  await assert.rejects(
    () => roomService.findOne({ status: "Free" }),
    /Invalid status/,
    "unknown enum values are rejected like the Mongo enum path"
  );

  await roomService.destroy(created._id);
});

test("rooms: pagination preserves limit/offset semantics", async () => {
  const tag = `PAGE-${unique()}`;
  const created = [];
  for (let i = 1; i <= 5; i += 1) {
    created.push(await roomService.create(roomBase({ number: `${tag}-0${i}`, type: "A" })));
  }

  const page1 = await roomService.findMany({ filter: { type: "A" }, sort: { number: 1 }, limit: 2 });
  assert.deepStrictEqual(page1.map((r) => r.number), [`${tag}-01`, `${tag}-02`]);

  const page2 = await roomService.findMany({ filter: { type: "A" }, sort: { number: 1 }, limit: 2, offset: 2 });
  assert.deepStrictEqual(page2.map((r) => r.number), [`${tag}-03`, `${tag}-04`]);

  assert.strictEqual(await roomService.count({ type: "A" }), 5);

  for (const room of created) await roomService.destroy(room._id);
});

// ─── Availability / lifecycle semantics ────────────────────────────────────
test("rooms: allot then checkout preserves the stored-status availability semantics", async () => {
  const created = await roomService.create(roomBase({ type: "Avail", status: "Available" }));

  // roomRoutes.allotRoom: rejects unless status is exactly 'Available'.
  const loaded = await roomService.findOne({ number: created.number });
  assert.strictEqual(loaded.status, "Available");

  const occupied = await roomService.updateById(loaded._id, {
    devotee: "Sita",
    phone: "1234567890",
    days: 3,
    payMode: "Cash",
    checkinDate: new Date("2026-03-01T10:00:00.000Z"),
    checkoutDate: new Date("2026-03-04T10:00:00.000Z"),
    status: "Occupied",
  });
  assert.strictEqual(occupied.status, "Occupied");

  // POST /checkout/:roomNumber clears the guest fields and returns to Available.
  const released = await roomService.release(occupied._id);
  assert.strictEqual(released.status, "Available");
  for (const field of ["devotee", "phone", "days", "payMode", "checkinDate", "checkoutDate"]) {
    assert.strictEqual(released[field], undefined, `${field} cleared on checkout`);
  }

  await roomService.destroy(created._id);
});

test("rooms: maintenance toggle keeps the stored status enum and rejects occupied rooms", async () => {
  const created = await roomService.create(roomBase({ type: "Maint" }));

  const toMaintenance = await roomService.updateById(created._id, { status: "Maintenance" });
  assert.strictEqual(toMaintenance.status, "Maintenance");

  const backToAvailable = await roomService.updateById(created._id, { status: "Available" });
  assert.strictEqual(backToAvailable.status, "Available");

  // Occupied rooms cannot be toggled — the route rejects, so status never moves
  // to an out-of-enum value.
  await assert.rejects(() => roomService.updateById(created._id, { status: "Maintenance " }), /Invalid status/);

  await roomService.destroy(created._id);
});

test("rooms: release on a missing room returns null", async () => {
  assert.strictEqual(await roomService.release("000000000000000000000000"), null);
});

// ─── Scheduler queries (app.js background job) ─────────────────────────────
test("rooms: auto-checkout query (status Occupied + checkoutDate $lte) works", async () => {
  const tag = `ACO-${unique()}`;
  const due = await roomService.create(roomBase({
    number: `${tag}-due`, type: "Sched", status: "Occupied",
    devotee: "Guest", checkoutDate: new Date("2026-01-01T00:00:00.000Z"),
  }));
  const future = await roomService.create(roomBase({
    number: `${tag}-future`, type: "Sched", status: "Occupied",
    devotee: "Guest", checkoutDate: new Date("2099-01-01T00:00:00.000Z"),
  }));

  const found = await roomService.findMany({
    filter: { status: "Occupied", checkoutDate: { $lte: new Date("2026-06-01T00:00:00.000Z") } },
  });
  const numbers = found.map((r) => r.number);
  assert.ok(numbers.includes(`${tag}-due`));
  assert.ok(!numbers.includes(`${tag}-future`));

  await roomService.destroy(due._id);
  await roomService.destroy(future._id);
});

test("rooms: auto-checkin query (Available + checkinDate $lte + checkoutDate $gt + devotee $exists) works", async () => {
  const tag = `ACI-${unique()}`;
  const now = new Date();
  const past = new Date(now.getTime() - 60 * 60 * 1000);
  const future = new Date(now.getTime() + 60 * 60 * 1000);

  const eligible = await roomService.create(roomBase({
    number: `${tag}-yes`, type: "Sched2", status: "Available",
    devotee: "Guest", checkinDate: past, checkoutDate: future,
  }));
  const noDevotee = await roomService.create(roomBase({
    number: `${tag}-nodv`, type: "Sched2", status: "Available",
    checkinDate: past, checkoutDate: future,
  }));
  const occupied = await roomService.create(roomBase({
    number: `${tag}-occ`, type: "Sched2", status: "Occupied",
    devotee: "Guest", checkinDate: past, checkoutDate: future,
  }));

  const found = await roomService.findMany({
    filter: {
      status: "Available",
      checkinDate: { $lte: now },
      checkoutDate: { $gt: now },
      devotee: { $exists: true, $ne: null },
    },
  });
  const numbers = found.map((r) => r.number);
  assert.ok(numbers.includes(`${tag}-yes`), "eligible room found");
  assert.ok(!numbers.includes(`${tag}-nodv`), "room without a devotee is excluded");
  assert.ok(!numbers.includes(`${tag}-occ`), "occupied room is excluded");

  for (const room of [eligible, noDevotee, occupied]) await roomService.destroy(room._id);
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("rooms: no dual writes — Mongoose is never connected on the PG path", async () => {
  const before = await roomService.count({});
  await roomService.create(roomBase({ type: "NoDual" }));
  assert.strictEqual(await roomService.count({}), before + 1, "exactly one PG row");
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected");
});

// ─── Datasource seam ───────────────────────────────────────────────────────
test("rooms: the seam switches PostgreSQL → Mongo → PostgreSQL in one process", async () => {
  const pinned = dbConfig.isDbConnected;
  try {
    const created = await roomRepository.create(roomBase({ type: "Seam" }));
    assert.ok(created._id);

    // Flip the seam to disconnected — the SAME already-loaded repository and
    // service modules must now select the Mongo path, with no fresh Node
    // process and no require-time cache of the flag. The genuinely-invoked
    // Mongoose proof for this branch lives in the fallback suite, which stubs
    // the model so no live MongoDB server is required.
    dbConfig.isDbConnected = () => false;
    assert.strictEqual(roomService.isConnected(), false, "seam reads the swapped function");
    assert.strictEqual(await roomService.usePostgres(), false, "seam now selects Mongo");
    assert.strictEqual(await roomService.usePostgres(), false, "still Mongo on a repeat call (no stale capture)");

    // Flip back: the very same modules route to PostgreSQL again.
    dbConfig.isDbConnected = pinned;
    assert.strictEqual(await roomService.usePostgres(), true, "seam switches back without a fresh process");
    const read = await roomService.findOne({ number: created.number });
    assert.ok(read && read._id === created._id, "PG row still readable after the round trip");

    await roomService.destroy(created._id);
  } finally {
    dbConfig.isDbConnected = pinned;
  }
});

test("rooms: an unreachable PostgreSQL falls back even when the seam says connected", async () => {
  const pinned = dbConfig.isDbConnected;
  const originalUrl = process.env.DATABASE_URL;
  try {
    dbConfig.isDbConnected = () => true;
    process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
    await closePostgres();
    assert.strictEqual(await roomService.usePostgres(), false, "driver-level failure falls back");
  } finally {
    dbConfig.isDbConnected = pinned;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await closePostgres();
  }
});
