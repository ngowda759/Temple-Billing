const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const CashClosing = require("../src/models/CashClosing");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const hex24 = () => crypto.randomBytes(12).toString("hex");

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    return (await pool.query(sql, params)).rows;
  } finally {
    await pool.end();
  }
};

// Every table this file touches, dropped in FK-safe order so a stale dependency
// can never block a fresh migration run.
const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS cash_closings CASCADE");
    await pool.query("DROP TABLE IF EXISTS users CASCADE");
  } finally {
    await pool.end();
  }
};

let originalIsDbConnected;
let cashClosingRepository;
let cashClosingService;

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
  cashClosingRepository = require("../src/repositories/cashClosingRepository");
  cashClosingService = require("../src/services/cashClosingService");
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

// A real users row, so the populate LEFT JOINs have something to resolve.
const makeUser = async (role = "cashier") => {
  const id = hex24();
  await poolQuery(
    "INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)",
    [id, `Cashier ${unique()}`, `${unique()}@temple.test`, "not-a-real-hash", role]
  );
  return id;
};

// The exact payload submitCashClosing builds after its calculation.
const closingBase = (overrides = {}) => ({
  date: new Date("2025-06-01T00:00:00.000Z"),
  openingCash: 1000,
  cashCollected: 500,
  upiCollected: 250,
  cardCollected: 0,
  bankTransferCollected: 0,
  totalSystemCollection: 750,
  cashDeposited: 0,
  closingCash: 1500,
  discrepancy: 0,
  notes: "Shift closed",
  recordedBy: hex24(),
  status: "Pending Verification",
  ...overrides,
});

// ─── PostgreSQL path: service selects PG and round trips ───────────────────
test("PG path: service uses PostgreSQL when the Cash Closing path is active and PG reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await cashClosingService.usePostgres(), true);
  assert.strictEqual(cashClosingService.isConnected(), true);
});

test("PG path: create → read round trip mirrors Mongo field names", async () => {
  const userId = hex24();
  const when = new Date("2025-06-01T00:00:00.000Z");
  const closing = await cashClosingService.create(closingBase({
    recordedBy: userId,
    date: when,
    notes: "Round trip",
  }));

  assert.ok(closing._id);
  assert.match(closing._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(closing.recordedBy, userId);
  assert.strictEqual(closing.openingCash, 1000);
  assert.strictEqual(closing.cashCollected, 500);
  assert.strictEqual(closing.upiCollected, 250);
  assert.strictEqual(closing.cardCollected, 0);
  assert.strictEqual(closing.bankTransferCollected, 0);
  assert.strictEqual(closing.totalSystemCollection, 750);
  assert.strictEqual(closing.cashDeposited, 0);
  assert.strictEqual(closing.closingCash, 1500);
  assert.strictEqual(closing.discrepancy, 0);
  assert.strictEqual(closing.notes, "Round trip");
  assert.strictEqual(closing.status, "Pending Verification");
  assert.ok(closing.date instanceof Date);
  assert.strictEqual(closing.date.toISOString(), when.toISOString());
  assert.ok(closing.createdAt instanceof Date);
  assert.ok(closing.updatedAt instanceof Date);

  const read = await cashClosingService.findById(closing._id);
  assert.strictEqual(read._id, closing._id);
  assert.strictEqual(read.closingCash, 1500);
  assert.strictEqual(read.recordedBy, userId);
});

test("PG path: money round trips as NUMERIC without truncation", async () => {
  // Plain NUMERIC (no scale) must not round a fractional amount the
  // application computed. NUMERIC(12,2) would store 1234.56 and silently
  // truncate the rest.
  const closing = await cashClosingService.create(closingBase({
    openingCash: 1234.56789,
    cashCollected: 0.1,
    closingCash: 1234.66789,
  }));

  const raw = await poolQuery("SELECT opening_cash::text AS o, cash_collected::text AS c FROM cash_closings WHERE id = $1", [closing._id]);
  assert.strictEqual(raw[0].o, "1234.56789", "no scale truncation on opening_cash");
  assert.strictEqual(raw[0].c, "0.1", "no scale truncation on cash_collected");

  const read = await cashClosingService.findById(closing._id);
  assert.strictEqual(read.openingCash, 1234.56789);
  assert.strictEqual(read.cashCollected, 0.1);
});

test("PG path: a negative discrepancy is stored (signed, no CHECK)", async () => {
  const closing = await cashClosingService.create(closingBase({
    discrepancy: -250.75,
  }));
  const read = await cashClosingService.findById(closing._id);
  assert.strictEqual(read.discrepancy, -250.75);
});

test("PG path: timestamps are populated like the Mongo timestamps option", async () => {
  const closing = await cashClosingService.create(closingBase());
  const raw = await poolQuery("SELECT created_at, updated_at FROM cash_closings WHERE id = $1", [closing._id]);
  assert.ok(raw[0].created_at instanceof Date);
  assert.ok(raw[0].updated_at instanceof Date);
});

test("PG path: verify transition sets status and verifiedBy", async () => {
  const cashier = await makeUser("cashier");
  const accountant = await makeUser("accountant");
  const closing = await cashClosingService.create(closingBase({ recordedBy: cashier }));

  const updated = await cashClosingService.updateById(closing._id, {
    status: "Verified",
    verifiedBy: accountant,
  });
  assert.strictEqual(updated.status, "Verified");
  assert.strictEqual(updated.verifiedBy, accountant);

  // A second transition to Disputed (the controller can send either).
  const disputed = await cashClosingService.updateById(closing._id, {
    status: "Disputed",
    verifiedBy: accountant,
  });
  assert.strictEqual(disputed.status, "Disputed");
});

test("PG path: updateById does not re-derive any amount", async () => {
  const closing = await cashClosingService.create(closingBase({ cashCollected: 500, totalSystemCollection: 750 }));
  const updated = await cashClosingService.updateById(closing._id, {
    status: "Verified",
    verifiedBy: hex24(),
  });
  assert.strictEqual(updated.cashCollected, 500, "stored calculation is untouched by a status update");
  assert.strictEqual(updated.totalSystemCollection, 750);
  assert.strictEqual(updated.openingCash, 1000);
});

// ─── Required / default semantics mirror Mongoose exactly ──────────────────
test("PG path: required fields are enforced like Mongo", async () => {
  const base = closingBase();

  await assert.rejects(
    () => cashClosingService.create({ ...base, date: undefined }),
    /date is required/
  );
  await assert.rejects(
    () => cashClosingService.create({ ...base, openingCash: undefined }),
    /openingCash is required/
  );
  await assert.rejects(
    () => cashClosingService.create({ ...base, cashCollected: undefined }),
    /cashCollected is required/
  );
  await assert.rejects(
    () => cashClosingService.create({ ...base, closingCash: undefined }),
    /closingCash is required/
  );
  await assert.rejects(
    () => cashClosingService.create({ ...base, recordedBy: undefined }),
    /recordedBy is required/
  );
});

test("PG path: zero is a legal money value and is never treated as missing", async () => {
  const closing = await cashClosingService.create(closingBase({
    openingCash: 0,
    cashCollected: 0,
    closingCash: 0,
    discrepancy: 0,
  }));
  const read = await cashClosingService.findById(closing._id);
  assert.strictEqual(read.openingCash, 0);
  assert.strictEqual(read.cashCollected, 0);
  assert.strictEqual(read.closingCash, 0);
  assert.strictEqual(read.discrepancy, 0);
});

test("PG path: optional money paths keep an explicit NULL (Mongo accepts null there)", async () => {
  // upiCollected/cardCollected/bankTransferCollected/totalSystemCollection/
  // cashDeposited/discrepancy carry `default: 0` but are NOT required, so
  // Mongoose accepts an explicit null and stores null. These columns are
  // therefore NULLABLE and must round trip null rather than coercing to 0.
  const closing = await cashClosingService.create(closingBase({
    upiCollected: null,
    cardCollected: null,
    bankTransferCollected: null,
    totalSystemCollection: null,
    cashDeposited: null,
    discrepancy: null,
  }));
  const raw = await poolQuery(
    "SELECT upi_collected, card_collected, bank_transfer_collected, total_system_collection, cash_deposited, discrepancy FROM cash_closings WHERE id = $1",
    [closing._id]
  );
  assert.strictEqual(raw[0].upi_collected, null);
  assert.strictEqual(raw[0].card_collected, null);
  assert.strictEqual(raw[0].bank_transfer_collected, null);
  assert.strictEqual(raw[0].total_system_collection, null);
  assert.strictEqual(raw[0].cash_deposited, null);
  assert.strictEqual(raw[0].discrepancy, null);
});

test("PG path: optional money paths default to 0 when omitted", async () => {
  const closing = await cashClosingService.create({
    date: new Date("2025-06-02T00:00:00.000Z"),
    openingCash: 10,
    cashCollected: 20,
    closingCash: 30,
    recordedBy: hex24(),
  });
  const read = await cashClosingService.findById(closing._id);
  assert.strictEqual(read.upiCollected, 0);
  assert.strictEqual(read.cardCollected, 0);
  assert.strictEqual(read.bankTransferCollected, 0);
  assert.strictEqual(read.totalSystemCollection, 0);
  assert.strictEqual(read.cashDeposited, 0);
  assert.strictEqual(read.discrepancy, 0);
  assert.strictEqual(read.status, "Pending Verification");
});

test("PG path: an empty-string optional money value stores NULL, as Mongo does", async () => {
  // The cashier form posts "" for untouched fields. Mongoose casts "" to null
  // for an optional Number path; the repository must not coerce it to 0.
  const closing = await cashClosingService.create(closingBase({
    cashDeposited: "",
    upiCollected: "",
  }));
  const raw = await poolQuery("SELECT cash_deposited, upi_collected FROM cash_closings WHERE id = $1", [closing._id]);
  assert.strictEqual(raw[0].cash_deposited, null);
  assert.strictEqual(raw[0].upi_collected, null);
});

test("PG path: notes is trimmed, and an absent notes stays NULL", async () => {
  const trimmed = await cashClosingService.create(closingBase({ notes: "  padded note  " }));
  assert.strictEqual(trimmed.notes, "padded note");

  const absent = await cashClosingService.create(closingBase({ notes: undefined }));
  const raw = await poolQuery("SELECT notes FROM cash_closings WHERE id = $1", [absent._id]);
  assert.strictEqual(raw[0].notes, null);
  // An unset notes is exposed as undefined (Mongo document semantics), not null.
  assert.strictEqual(absent.notes, undefined);
});

test("PG path: status enum is enforced like Mongo", async () => {
  await assert.rejects(
    () => cashClosingService.create(closingBase({ status: "Bogus" })),
    /status_check|violates check constraint/i
  );
});

test("PG path: an explicit null status is stored, matching Mongoose", async () => {
  // Mongoose's `default` fires only on an omitted value, so `status: null`
  // validates and persists as null. The column must be nullable for the
  // PostgreSQL path to accept the same write. (A CHECK (status IN (...)) already
  // evaluates to NULL — i.e. passes — for a null value.)
  const closing = await cashClosingService.create(closingBase({ status: null }));
  const raw = await poolQuery("SELECT status FROM cash_closings WHERE id = $1", [closing._id]);
  assert.strictEqual(raw[0].status, null, "explicit null status is stored, not coerced");

  const read = await cashClosingService.findById(closing._id);
  assert.ok(read, "row is readable with a null status");
  assert.strictEqual(read.status, null);
});

test("PG path: an omitted status still defaults to Pending Verification", async () => {
  const closing = await cashClosingService.create(closingBase({ status: undefined }));
  const raw = await poolQuery("SELECT status FROM cash_closings WHERE id = $1", [closing._id]);
  assert.strictEqual(raw[0].status, "Pending Verification", "omitted status takes the default");
});

// ─── Populate shape ────────────────────────────────────────────────────────
test("PG path: populate returns the { _id, name } shape the frontend reads", async () => {
  const cashier = await makeUser("cashier");
  const accountant = await makeUser("accountant");
  const closing = await cashClosingService.create(closingBase({ recordedBy: cashier }));
  await cashClosingService.updateById(closing._id, { status: "Verified", verifiedBy: accountant });

  const rows = await cashClosingService.findMany({
    filter: { _id: closing._id },
    sort: { date: -1 },
    populate: true,
  });
  const found = rows.find((r) => r._id === closing._id);
  assert.ok(found, "populated row returned");
  assert.ok(found.recordedBy && typeof found.recordedBy === "object", "recordedBy is populated");
  assert.strictEqual(found.recordedBy._id, cashier);
  assert.match(found.recordedBy.name, /^Cashier /);
  assert.ok(found.verifiedBy && typeof found.verifiedBy === "object", "verifiedBy is populated");
  assert.strictEqual(found.verifiedBy._id, accountant);
});

test("PG path: populate keeps closings whose cashier no longer exists (LEFT JOIN, not INNER)", async () => {
  const missing = hex24();
  const closing = await cashClosingService.create(closingBase({ recordedBy: missing }));

  const rows = await cashClosingService.findMany({
    filter: { _id: closing._id },
    sort: { date: -1 },
    populate: true,
  });
  const found = rows.find((r) => r._id === closing._id);
  assert.ok(found, "financial history is NOT dropped when the cashier is missing");
  assert.strictEqual(found.recordedBy, null);
});

test("PG path: populate is off by default so the plain surface returns the id string", async () => {
  const cashier = hex24();
  const closing = await cashClosingService.create(closingBase({ recordedBy: cashier }));

  const rows = await cashClosingRepository.findMany({ filter: { id: closing._id } });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].recordedBy, cashier, "unpopulated recordedBy is the id string");
});

test("PG path: default sort is date DESC (the only sort the endpoint uses)", async () => {
  const older = await cashClosingService.create(closingBase({ date: new Date("2020-01-01T00:00:00.000Z") }));
  const newer = await cashClosingService.create(closingBase({ date: new Date("2030-01-01T00:00:00.000Z") }));

  const rows = await cashClosingService.findMany({ populate: false });
  const idxNewer = rows.findIndex((r) => r._id === newer._id);
  const idxOlder = rows.findIndex((r) => r._id === older._id);
  assert.ok(idxNewer < idxOlder, "newest closing is listed first");
});

// ─── SQL schema assertions ────────────────────────────────────────────────
test("PG path: cash_closings table has the exact Mongo field mapping", async () => {
  const cols = await poolQuery(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'cash_closings' AND table_schema = 'public'
     ORDER BY ordinal_position`
  );
  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  const expected = [
    "id", "date", "opening_cash", "cash_collected", "upi_collected",
    "card_collected", "bank_transfer_collected", "total_system_collection",
    "cash_deposited", "closing_cash", "discrepancy", "notes", "status",
    "recorded_by", "verified_by", "created_at", "updated_at",
  ];
  // exactly 17 columns = id + 14 schema fields + 2 timestamps. No expectedCash,
  // no variance, no cashierId (those names must never appear).
  assert.strictEqual(cols.length, 17, "exactly 17 mapped columns");
  assert.deepStrictEqual(cols.map((c) => c.column_name), expected);
  for (const name of expected) assert.ok(byName[name], `${name} exists`);
  assert.strictEqual(byName.expected_cash, undefined, "no invented expected_cash column");
  assert.strictEqual(byName.variance, undefined, "no invented variance column");
  assert.strictEqual(byName.cashier_id, undefined, "no cashier_id column (model has none)");

  // Nullability transcribed from the model's real validation behaviour.
  assert.strictEqual(byName.id.is_nullable, "NO");
  assert.strictEqual(byName.date.is_nullable, "NO", "date required");
  assert.strictEqual(byName.opening_cash.is_nullable, "NO", "openingCash required+default");
  assert.strictEqual(byName.cash_collected.is_nullable, "NO", "cashCollected required+default");
  assert.strictEqual(byName.closing_cash.is_nullable, "NO", "closingCash required, no default");
  assert.strictEqual(byName.recorded_by.is_nullable, "NO", "recordedBy required");
  // `default` fires only on an omitted value, so an explicit null — which
  // verifyCashClosing can pass straight from req.body — validates in Mongo and
  // is stored as null. NOT NULL here would turn that 200 into a 500.
  assert.strictEqual(byName.status.is_nullable, "YES", "status has a default but accepts an explicit null");
  assert.strictEqual(byName.upi_collected.is_nullable, "YES", "default-only paths accept null");
  assert.strictEqual(byName.card_collected.is_nullable, "YES");
  assert.strictEqual(byName.bank_transfer_collected.is_nullable, "YES");
  assert.strictEqual(byName.total_system_collection.is_nullable, "YES");
  assert.strictEqual(byName.cash_deposited.is_nullable, "YES");
  assert.strictEqual(byName.discrepancy.is_nullable, "YES");
  assert.strictEqual(byName.notes.is_nullable, "YES");
  assert.strictEqual(byName.verified_by.is_nullable, "YES");

  // closingCash is required with NO default: no DEFAULT on the column.
  assert.strictEqual(byName.closing_cash.column_default, null, "closing_cash has NO default");
  assert.strictEqual(byName.date.column_default, null, "date has NO default");
  assert.strictEqual(byName.recorded_by.column_default, null, "recorded_by has NO default");
  // Defaulted money/status columns carry DEFAULT 0 / 'Pending Verification'.
  assert.match(String(byName.opening_cash.column_default), /^0/);
  assert.match(String(byName.cash_collected.column_default), /^0/);
  assert.match(String(byName.upi_collected.column_default), /^0/);
  assert.match(String(byName.discrepancy.column_default), /^0/);
  assert.match(String(byName.status.column_default), /Pending Verification/);
});

test("PG path: every money column is plain NUMERIC — no precision and no scale", async () => {
  // NUMERIC(12,2) would impose a rounding rule and an overflow limit the
  // application does not have. numeric_precision IS NULL means "unconstrained".
  const cols = await poolQuery(
    `SELECT column_name, data_type, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_name = 'cash_closings' AND data_type = 'numeric'`
  );
  const money = [
    "opening_cash", "cash_collected", "upi_collected", "card_collected",
    "bank_transfer_collected", "total_system_collection", "cash_deposited",
    "closing_cash", "discrepancy",
  ];
  assert.deepStrictEqual(cols.map((c) => c.column_name).sort(), money.slice().sort());
  for (const c of cols) {
    assert.strictEqual(c.numeric_precision, null, `${c.column_name} has no fixed precision`);
    assert.strictEqual(c.numeric_scale, null, `${c.column_name} has no fixed scale`);
  }
});

test("PG path: the three approved indexes exist", async () => {
  const idx = await poolQuery(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'cash_closings' AND schemaname = 'public'
     ORDER BY indexname`
  );
  const names = idx.map((r) => r.indexname);
  assert.ok(names.includes("idx_cash_closings_date"), "date index exists");
  assert.ok(names.includes("idx_cash_closings_recorded_by"), "recorded_by index exists");
  assert.ok(names.includes("idx_cash_closings_date_status"), "date+status index exists");
  const def = (n) => idx.find((r) => r.indexname === n).indexdef;
  assert.match(def("idx_cash_closings_date"), /\(date DESC\)/);
  assert.match(def("idx_cash_closings_recorded_by"), /\(recorded_by\)/);
  assert.match(def("idx_cash_closings_date_status"), /\(date DESC, status\)/);
});

test("PG path: NO per-day uniqueness constraint was introduced", async () => {
  // The Mongo schema enforces no per-day uniqueness, so PostgreSQL must not
  // either. This is the single most important constraint assertion in this
  // file: the only UNIQUE index allowed is the primary key.
  const idx = await poolQuery(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'cash_closings' AND schemaname = 'public'`
  );
  const unique = idx.filter((r) => /CREATE UNIQUE INDEX/.test(r.indexdef));
  assert.strictEqual(unique.length, 1, "exactly one UNIQUE index (the primary key)");
  assert.match(unique[0].indexdef, /\(id\)/, "the only UNIQUE index is on id");

  for (const r of idx) {
    assert.ok(
      !/\(recorded_by, date\)/.test(r.indexdef) && !/\(date, recorded_by\)/.test(r.indexdef),
      "no UNIQUE(recorded_by, date) — that would be a new business rule"
    );
  }

  // Two closings for the same cashier on the same day must both persist.
  const cashier = hex24();
  const day = new Date("2025-07-15T00:00:00.000Z");
  const first = await cashClosingService.create(closingBase({ recordedBy: cashier, date: day }));
  const second = await cashClosingService.create(closingBase({ recordedBy: cashier, date: day }));
  assert.notStrictEqual(first._id, second._id);
  const count = await cashClosingService.count({ recordedBy: cashier });
  assert.strictEqual(count, 2, "same cashier + same day persists two rows, exactly like Mongo");
});

test("PG path: no foreign key — closing history survives cashier deletion", async () => {
  const fks = await poolQuery(
    `SELECT conname, contype FROM pg_constraint
     WHERE conrelid = 'cash_closings'::regclass AND contype = 'f'`
  );
  assert.strictEqual(fks.length, 0, "cash_closings must carry no foreign keys");

  const cashier = await makeUser("cashier");
  const closing = await cashClosingService.create(closingBase({ recordedBy: cashier }));
  await poolQuery("DELETE FROM users WHERE id = $1", [cashier]);

  const read = await cashClosingService.findById(closing._id);
  assert.ok(read, "closing row survives deletion of the referenced cashier");
  assert.strictEqual(read.recordedBy, cashier);
});

test("PG path: the only CHECK constraint is the status enum", async () => {
  const checks = await poolQuery(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'cash_closings'::regclass AND contype = 'c'`
  );
  assert.strictEqual(checks.length, 1, "exactly one CHECK constraint");
  assert.match(checks[0].def, /Pending Verification/);
  assert.match(checks[0].def, /Verified/);
  assert.match(checks[0].def, /Disputed/);
});

test("PG path: date is TIMESTAMPTZ, not DATE", async () => {
  // The controller derives the day with setHours(0,0,0,0) in the server's local
  // timezone; a DATE column would discard that instant.
  const col = await poolQuery(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'cash_closings' AND column_name = 'date'`
  );
  assert.strictEqual(col[0].data_type, "timestamp with time zone");
});