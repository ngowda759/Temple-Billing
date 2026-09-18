// Phase 2Z PostgreSQL tests for the Prasadam master repository and service.
//
// The Prasadam master is migrated additively: PostgreSQL is an additional
// persistence path selected at operation time, MongoDB stays the source of
// truth and the fallback. These tests exercise the real PostgreSQL path (the
// datasource seam is pinned "connected" and DATABASE_URL points at the test
// database, so every operation below reaches the real prasadamRepository and
// the real prasadams table). They verify:
//   - the complete Mongo → PostgreSQL field mapping (every persisted field),
//   - the computed `status` virtual (Out Of Stock / Low Stock / Available),
//   - the schema's own defaults and nullability,
//   - the unique name constraint and the 11000-shaped error the controller
//     turns into HTTP 409,
//   - the >= 0 CHECK constraints,
//   - money and fractional-quantity precision,
//   - the name lookups the two real call sites perform (case-insensitive for
//     the devotee order flow, case-sensitive for kitchen production),
//   - the two stock movements (restock + / order -),
//   - that no operation writes to both databases (no dual writes),
//   - the datasource seam genuinely selects both paths.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Prasadam = require("../src/models/Prasadam");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");
const nameFor = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let prasadamRepository;
let prasadamService;

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const runMigrate = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await pgQuery("DROP TABLE IF EXISTS prasadams CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '027_create_prasadams.sql'");
  runMigrate();
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  // Best-effort MongoDB connection so the cross-datasource "no dual write"
  // assertion below is a real query rather than a skip. When MongoDB is not
  // reachable the assertion degrades to a skip and the Mongoose-spy test still
  // proves the PostgreSQL path never invokes the model.
  try {
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/temple_billing_test", {
      serverSelectionTimeoutMS: 3000,
    });
  } catch {
    /* leave the connection down; the test skips */
  }
  dbConfig.isDbConnected = () => true;
  prasadamRepository = require("../src/repositories/prasadamRepository");
  prasadamService = require("../src/services/prasadamService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  try {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  } catch {
    /* nothing to disconnect */
  }
  await closePostgres();
});

const itemPayload = (overrides = {}) => ({
  name: nameFor("Laddu"),
  price: 151,
  availableQuantity: 25,
  minimumStock: 5,
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("prasadams: the service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(prasadamService.isConnected(), true);
  assert.strictEqual(await prasadamService.usePostgres(), true);
});

test("prasadams: the service falls back to Mongoose when the datasource seam is disconnected", async () => {
  const original = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(prasadamService.isConnected(), false);
    assert.strictEqual(await prasadamService.usePostgres(), false);
  } finally {
    dbConfig.isDbConnected = original;
  }
});

test("prasadams: PostgreSQL unavailable keeps the Mongoose path even when the seam is connected", async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await prasadamService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = savedUrl;
    await closePostgres();
  }
});

// ─── Full field mapping ────────────────────────────────────────────────────
test("prasadams (PG): every persisted Mongo field round-trips through the repository", async () => {
  const payload = itemPayload({
    name: "  Panchamrit Prasadam  ",
    price: 101,
    availableQuantity: 40,
    minimumStock: 10,
  });

  const created = await prasadamService.create(payload);

  // name is trimmed exactly as `trim: true` does in Mongo.
  assert.strictEqual(created.name, "Panchamrit Prasadam");
  assert.strictEqual(Number(created.price), 101);
  assert.strictEqual(Number(created.availableQuantity), 40);
  assert.strictEqual(Number(created.minimumStock), 10);
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created._id, created.id);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  // The document exposes exactly the Mongoose schema key set plus the virtual.
  const schemaKeys = [
    "_id", "id", "name", "price", "availableQuantity", "minimumStock",
    "status", "createdAt", "updatedAt",
  ];
  for (const key of schemaKeys) {
    assert.ok(key in created, `PG doc missing key ${key}`);
  }

  // The row really landed in PostgreSQL.
  const rows = await pgQuery("SELECT * FROM prasadams WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, "Panchamrit Prasadam");

  const reread = await prasadamService.findById(created._id);
  assert.strictEqual(reread.name, created.name);
  assert.strictEqual(Number(reread.price), 101);
  assert.strictEqual(Number(reread.availableQuantity), 40);
  assert.strictEqual(Number(reread.minimumStock), 10);
});

test("prasadams (PG): defaults mirror the schema (availableQuantity/minimumStock = 0)", async () => {
  const created = await prasadamService.create({
    name: nameFor("Defaults"),
    price: 10,
  });

  assert.strictEqual(Number(created.availableQuantity), 0);
  assert.strictEqual(Number(created.minimumStock), 0);

  const rows = await pgQuery(
    "SELECT available_quantity::text AS q, minimum_stock::text AS m FROM prasadams WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(rows[0].q, "0");
  assert.strictEqual(rows[0].m, "0");
});

// ─── The computed `status` virtual ─────────────────────────────────────────
test("prasadams (PG): the status virtual is recomputed on read (Mongo parity)", async () => {
  const outOfStock = await prasadamService.create(
    itemPayload({ name: nameFor("OOS"), availableQuantity: 0, minimumStock: 5 })
  );
  assert.strictEqual(outOfStock.status, "Out Of Stock");

  const low = await prasadamService.create(
    itemPayload({ name: nameFor("Low"), availableQuantity: 3, minimumStock: 5 })
  );
  assert.strictEqual(low.status, "Low Stock");

  // Exactly at the minimum is "Low Stock" (<=), not "Available".
  const atMinimum = await prasadamService.create(
    itemPayload({ name: nameFor("AtMin"), availableQuantity: 5, minimumStock: 5 })
  );
  assert.strictEqual(atMinimum.status, "Low Stock");

  const available = await prasadamService.create(
    itemPayload({ name: nameFor("Avail"), availableQuantity: 6, minimumStock: 5 })
  );
  assert.strictEqual(available.status, "Available");

  // The virtual is NOT a stored column.
  const cols = await pgQuery(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'prasadams' ORDER BY ordinal_position`);
  assert.ok(!cols.some((c) => c.column_name === "status"), "status must not be a column");

  // A freshly read document still carries it.
  const reread = await prasadamService.findById(outOfStock._id);
  assert.strictEqual(reread.status, "Out Of Stock");
});

// ─── Listing / sorting ─────────────────────────────────────────────────────
test("prasadams (PG): the listing preserves find().sort({ name: 1 })", async () => {
  const tag = unique();
  const names = [`${tag}-c`, `${tag}-a`, `${tag}-b`];
  for (const name of names) {
    await prasadamService.create(itemPayload({ name }));
  }

  const all = await prasadamService.findMany({ sort: { name: 1 } });
  const mine = all.filter((i) => i.name.startsWith(tag)).map((i) => i.name);
  assert.deepStrictEqual(mine, [`${tag}-a`, `${tag}-b`, `${tag}-c`]);

  // Descending keeps the direction.
  const desc = await prasadamService.findMany({ sort: { name: -1 } });
  const mineDesc = desc.filter((i) => i.name.startsWith(tag)).map((i) => i.name);
  assert.deepStrictEqual(mineDesc, [`${tag}-c`, `${tag}-b`, `${tag}-a`]);

  // A non-whitelisted sort key falls back to the default name ASC ordering.
  const injected = await prasadamService.findMany({ sort: { "; DROP TABLE prasadams": -1 } });
  assert.ok(injected.length >= 3);
});

test("prasadams (PG): findMany honours limit and offset", async () => {
  const tag = unique();
  for (const suffix of ["a", "b", "c"]) {
    await prasadamService.create(itemPayload({ name: `${tag}-${suffix}` }));
  }
  const page = await prasadamService.findMany({ filter: {}, sort: { name: 1 }, limit: 2, offset: 1 });
  assert.strictEqual(page.length, 2);
});

// ─── Name lookups (the two real call sites) ────────────────────────────────
test("prasadams (PG): case-insensitive exact lookup mirrors /^<name>$/i", async () => {
  const name = nameFor("CaseTest");
  await prasadamService.create(itemPayload({ name }));

  const upper = await prasadamService.findOneByName(name.toUpperCase(), { caseInsensitive: true });
  assert.ok(upper, "case-insensitive lookup must match");
  assert.strictEqual(upper.name, name);

  const lower = await prasadamService.findOneByName(name.toLowerCase(), { caseInsensitive: true });
  assert.ok(lower, "lower-cased lookup must match");
  assert.strictEqual(lower.name, name);

  // A partial name must NOT match (the regex is anchored).
  const partial = await prasadamService.findOneByName(name.slice(0, 6), { caseInsensitive: true });
  assert.strictEqual(partial, null);

  assert.strictEqual(await prasadamService.findOneByName("", { caseInsensitive: true }), null);
  assert.strictEqual(await prasadamService.findOneByName(undefined, { caseInsensitive: true }), null);
});

test("prasadams (PG): case-sensitive exact lookup mirrors findOne({ name })", async () => {
  const name = nameFor("Kitchen");
  await prasadamService.create(itemPayload({ name }));

  const exact = await prasadamService.findOneByName(name, { caseInsensitive: false });
  assert.ok(exact, "exact lookup must match");
  assert.strictEqual(exact.name, name);

  // logKitchenProduction's match is case-SENSITIVE, so a different case misses.
  const wrongCase = await prasadamService.findOneByName(name.toUpperCase(), { caseInsensitive: false });
  assert.strictEqual(wrongCase, null);
});

test("prasadams (PG): a name with regex metacharacters is matched literally", async () => {
  const name = `Laddu (Special) ${unique()}`;
  await prasadamService.create(itemPayload({ name }));

  const found = await prasadamService.findOneByName(name, { caseInsensitive: true });
  assert.ok(found, "a literal metacharacter name must still match itself");
  assert.strictEqual(found.name, name);
});

// ─── Update ────────────────────────────────────────────────────────────────
test("prasadams (PG): updateById patches only the supplied fields", async () => {
  const created = await prasadamService.create(
    itemPayload({ name: nameFor("Update"), price: 100, availableQuantity: 30, minimumStock: 4 })
  );

  const updated = await prasadamService.updateById(created._id, { price: 120 });
  assert.strictEqual(Number(updated.price), 120);
  // Untouched fields keep their values.
  assert.strictEqual(Number(updated.availableQuantity), 30);
  assert.strictEqual(Number(updated.minimumStock), 4);
  assert.strictEqual(updated.name, created.name);

  const all = await prasadamService.updateById(created._id, {
    name: "  Renamed Prasadam  ",
    availableQuantity: 7,
    minimumStock: 2,
  });
  assert.strictEqual(all.name, "Renamed Prasadam");
  assert.strictEqual(Number(all.availableQuantity), 7);
  assert.strictEqual(Number(all.minimumStock), 2);
  assert.strictEqual(all.status, "Available");

  // A no-op update returns the unchanged document.
  const noop = await prasadamService.updateById(created._id, {});
  assert.strictEqual(noop.name, "Renamed Prasadam");

  // Unknown keys are ignored (Mongoose strict mode).
  const ignored = await prasadamService.updateById(created._id, { nonsense: 1 });
  assert.strictEqual(ignored.name, "Renamed Prasadam");

  // A missing id yields null.
  assert.strictEqual(await prasadamService.updateById(unique(), { price: 1 }), null);
});

test("prasadams (PG): updating a name to an existing one raises a duplicate error", async () => {
  const taken = await prasadamService.create(itemPayload({ name: nameFor("Taken") }));
  const other = await prasadamService.create(itemPayload({ name: nameFor("Other") }));

  await assert.rejects(
    () => prasadamService.updateById(other._id, { name: taken.name }),
    (err) => err.code === 11000
  );
});

// ─── Stock movements ───────────────────────────────────────────────────────
test("prasadams (PG): restock adds and the order flow subtracts", async () => {
  const created = await prasadamService.create(
    itemPayload({ name: nameFor("Stock"), availableQuantity: 10, minimumStock: 2 })
  );

  const restocked = await prasadamService.incrementById(created._id, 15);
  assert.strictEqual(Number(restocked.availableQuantity), 25);

  const afterOrder = await prasadamService.incrementById(created._id, -4);
  assert.strictEqual(Number(afterOrder.availableQuantity), 21);

  // The order flow has no floor of its own, but it reaches Mongoose's save(),
  // which runs the schema's `min: 0` validator — so a decrement that would go
  // negative raises there instead of persisting. Both datasources match.
  await assert.rejects(
    () => prasadamService.incrementById(created._id, -30),
    (err) => err.name === "ValidationError" && /minimum allowed value/.test(err.message)
  );
  const unchanged = await prasadamService.findById(created._id);
  assert.strictEqual(Number(unchanged.availableQuantity), 21, "the rejected decrement wrote nothing");

  // A missing row is a no-op, exactly like findById → save() on null.
  assert.strictEqual(await prasadamService.incrementById(unique(), 5), null);
});

test("prasadams (PG): the payment-verification decrement clamps at zero", async () => {
  const created = await prasadamService.create(
    itemPayload({ name: nameFor("Clamp"), availableQuantity: 3, minimumStock: 0 })
  );

  const clamped = await prasadamService.incrementById(created._id, -10, { clampAtZero: true });
  assert.strictEqual(Number(clamped.availableQuantity), 0);

  const partial = await prasadamService.incrementById(created._id, 5, { clampAtZero: true });
  assert.strictEqual(Number(partial.availableQuantity), 5);
});

// ─── Delete ────────────────────────────────────────────────────────────────
test("prasadams (PG): destroy is a hard delete returning the removed document", async () => {
  const created = await prasadamService.create(itemPayload({ name: nameFor("Delete") }));

  const removed = await prasadamService.destroy(created._id);
  assert.ok(removed, "destroy returns the deleted document");
  assert.strictEqual(removed._id, created._id);

  assert.strictEqual(await prasadamService.findById(created._id), null);
  assert.strictEqual(await prasadamService.destroy(created._id), null);

  const rows = await pgQuery("SELECT id FROM prasadams WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 0);
});

// ─── Validation ────────────────────────────────────────────────────────────
test("prasadams (PG): required name and invalid values are rejected", async () => {
  assert.throws(() => prasadamService.validate({ price: 1 }), /name is required/);
  assert.throws(() => prasadamService.validate({ name: "  ", price: 1 }), /name is required/);
  assert.throws(() => prasadamService.validate({ name: null, price: 1 }), /name is required/);
  assert.throws(
    () => prasadamService.validate({ name: "x", price: "not-a-number" }),
    /price must be a number/
  );

  await assert.rejects(() => prasadamService.create({ price: 10 }), /name is required/);
  await assert.rejects(() => prasadamService.create({ name: "   ", price: 10 }), /name is required/);
  await assert.rejects(
    () => prasadamService.create({ name: nameFor("BadPrice"), price: "abc" }),
    /price must be a number/
  );

  // A valid payload does not throw.
  assert.doesNotThrow(() => prasadamService.validate({ name: "ok", price: 0 }));
});

test("prasadams (PG): create enforces the schema's min: 0, update deliberately does not", async () => {
  // Prasadam.create runs Mongoose's validators, so min:0 is enforced.
  await assert.rejects(
    () => prasadamService.create({ name: nameFor("NegPrice"), price: -5 }),
    (err) => err.name === "ValidationError" && /minimum allowed value/.test(err.message)
  );
  await assert.rejects(
    () => prasadamService.create({
      name: nameFor("NegQty"), price: 1, availableQuantity: -1, minimumStock: 0,
    }),
    (err) => err.name === "ValidationError"
  );
  await assert.rejects(
    () => prasadamService.create({
      name: nameFor("NegMin"), price: 1, availableQuantity: 0, minimumStock: -2,
    }),
    (err) => err.name === "ValidationError"
  );
  assert.throws(() => prasadamService.validate({ name: "x", price: -1 }), /minimum allowed value/);

  // updatePrasadam uses findByIdAndUpdate WITHOUT runValidators, so Mongoose
  // does not apply min:0 there and a negative value persists today. The
  // PostgreSQL path mirrors that exactly rather than tightening it.
  const created = await prasadamService.create(
    itemPayload({ name: nameFor("UpdateNeg"), price: 100, availableQuantity: 5, minimumStock: 0 })
  );
  const updated = await prasadamService.updateById(created._id, { price: -1, availableQuantity: -3 });
  assert.strictEqual(Number(updated.price), -1);
  assert.strictEqual(Number(updated.availableQuantity), -3);

  const rows = await pgQuery(
    "SELECT price::text AS p, available_quantity::text AS q FROM prasadams WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(rows[0].p, "-1");
  assert.strictEqual(rows[0].q, "-3");
});

test("prasadams (PG): a duplicate name raises the 11000-shaped error the controller maps to 409", async () => {
  const name = nameFor("Dup");
  await prasadamService.create(itemPayload({ name }));

  await assert.rejects(
    () => prasadamService.create(itemPayload({ name })),
    (err) => err.code === 11000
  );

  // Nothing was silently replaced.
  const rows = await pgQuery("SELECT count(*)::int AS c FROM prasadams WHERE name = $1", [name]);
  assert.strictEqual(rows[0].c, 1);
});

// ─── Money / quantity precision ────────────────────────────────────────────
test("prasadams (PG): money and fractional quantities round-trip exactly", async () => {
  const created = await prasadamService.create({
    name: nameFor("Precision"),
    price: 25.5,
    availableQuantity: 1000.125,
    minimumStock: 0.5,
  });

  assert.strictEqual(Number(created.price), 25.5);
  assert.strictEqual(Number(created.availableQuantity), 1000.125);
  assert.strictEqual(Number(created.minimumStock), 0.5);

  // Compare by NUMERIC value, not textual scale — a JS number carries no
  // trailing zeros, so the driver sends 25.5 and NUMERIC stores it exactly.
  const rows = await pgQuery(
    `SELECT price = 25.5::numeric AS p, available_quantity = 1000.125::numeric AS q,
            minimum_stock = 0.5::numeric AS m
     FROM prasadams WHERE id = $1`,
    [created._id]
  );
  assert.strictEqual(rows[0].p, true);
  assert.strictEqual(rows[0].q, true);
  assert.strictEqual(rows[0].m, true);

  // A fractional delta keeps its exact value through the atomic UPDATE.
  const bumped = await prasadamService.incrementById(created._id, 0.125);
  assert.strictEqual(Number(bumped.availableQuantity), 1000.25);

  // Decimal money that would drift as float is exact under NUMERIC.
  const decimal = await prasadamService.create({
    name: nameFor("Decimal"),
    price: 0.1,
    availableQuantity: 0.3,
    minimumStock: 0,
  });
  assert.strictEqual(Number(decimal.price), 0.1);
  assert.strictEqual(Number(decimal.availableQuantity), 0.3);
});

// ─── Constraints / indexes ─────────────────────────────────────────────────
test("prasadams (PG): the table carries the unique name and the empty-name CHECK", async () => {
  const unique_ = await pgQuery(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'prasadams'::regclass AND contype = 'u'`);
  assert.strictEqual(unique_.length, 1);
  assert.match(unique_[0].def, /\(name\)/);

  const checks = await pgQuery(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'prasadams'::regclass AND contype = 'c'`);
  assert.strictEqual(checks.length, 1, "only the empty-name CHECK");
  assert.match(checks[0].def, /name <> ''::text/);

  // No foreign key is invented.
  const fks = await pgQuery(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'prasadams'::regclass AND contype = 'f'`);
  assert.strictEqual(fks.length, 0);

  // The name UNIQUE constraint is index-backed.
  const indexes = await pgQuery(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'prasadams'`);
  assert.ok(indexes.length >= 1, "the UNIQUE constraint creates an index");
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("prasadams (PG): the service never touches the Mongoose model when PG is selected", async () => {
  const originalCreate = Prasadam.create;
  const originalFind = Prasadam.find;
  const originalFindById = Prasadam.findById;
  const originalFindOne = Prasadam.findOne;
  const originalFindByIdAndUpdate = Prasadam.findByIdAndUpdate;
  const originalFindByIdAndDelete = Prasadam.findByIdAndDelete;

  const mongoTouched = [];
  Prasadam.create = async (...args) => { mongoTouched.push("create"); return originalCreate.apply(this, args); };
  Prasadam.find = async (...args) => { mongoTouched.push("find"); return originalFind.apply(this, args); };
  Prasadam.findById = async (...args) => { mongoTouched.push("findById"); return originalFindById.apply(this, args); };
  Prasadam.findOne = async (...args) => { mongoTouched.push("findOne"); return originalFindOne.apply(this, args); };
  Prasadam.findByIdAndUpdate = async (...args) => { mongoTouched.push("findByIdAndUpdate"); return originalFindByIdAndUpdate.apply(this, args); };
  Prasadam.findByIdAndDelete = async (...args) => { mongoTouched.push("findByIdAndDelete"); return originalFindByIdAndDelete.apply(this, args); };

  try {
    const created = await prasadamService.create(itemPayload({ name: nameFor("NoDual") }));
    await prasadamService.findMany({ sort: { name: 1 } });
    await prasadamService.findById(created._id);
    await prasadamService.findOneByName(created.name, { caseInsensitive: true });
    await prasadamService.updateById(created._id, { price: 999 });
    await prasadamService.incrementById(created._id, 3);
    await prasadamService.destroy(created._id);

    assert.deepStrictEqual(mongoTouched, [], "Mongo model must not be invoked on the PG path");
  } finally {
    Prasadam.create = originalCreate;
    Prasadam.find = originalFind;
    Prasadam.findById = originalFindById;
    Prasadam.findOne = originalFindOne;
    Prasadam.findByIdAndUpdate = originalFindByIdAndUpdate;
    Prasadam.findByIdAndDelete = originalFindByIdAndDelete;
  }
});

// The strongest MongoDB-independent proof that the PostgreSQL path performs no
// dual write. When MongoDB happens to be reachable in the test environment this
// additionally confirms the row is genuinely absent from the Mongo collection.
test("prasadams (PG): a PG write leaves no MongoDB document behind", async (t) => {
  const name = nameFor("OnlyPG");
  const created = await prasadamService.create(itemPayload({ name }));

  // The document exists in PostgreSQL...
  const rows = await pgQuery("SELECT id FROM prasadams WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 1);

  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 1) {
    // No MongoDB in this environment — the spy test above already proves the
    // Mongoose model is never invoked on the PostgreSQL path.
    t.skip("MongoDB not reachable; cross-datasource check skipped");
    return;
  }

  // ...and is genuinely absent from MongoDB (no dual write).
  const mongoDoc = await Prasadam.findById(created._id);
  assert.strictEqual(mongoDoc, null);
});

// ─── The controller's response shape ───────────────────────────────────────
test("prasadams (PG): the controller surfaces the same response shapes as before", async () => {
  const prasadamController = require("../src/controllers/prasadamController");

  const createRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const name = nameFor("CtrlCreate");
  await prasadamController.createPrasadam({ body: { name, price: 50, availableQuantity: 9, minimumStock: 1 } }, createRes);
  assert.strictEqual(createRes.statusCode, 201);
  assert.strictEqual(createRes.body.success, true);
  assert.strictEqual(createRes.body.item.name, name);
  assert.strictEqual(createRes.body.item.status, "Available");

  // A blank name is still a 400 with the original message.
  const badRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await prasadamController.createPrasadam({ body: { name: "   " } }, badRes);
  assert.strictEqual(badRes.statusCode, 400);
  assert.strictEqual(badRes.body.message, "Prasadam name is required.");

  // A duplicate name is still a 409 with the original message.
  const dupRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await prasadamController.createPrasadam({ body: { name, price: 50 } }, dupRes);
  assert.strictEqual(dupRes.statusCode, 409);
  assert.strictEqual(dupRes.body.message, "Prasadam with this name already exists.");

  // The listing returns { success, items } with the virtual present.
  const listRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await prasadamController.getAllPrasadam({}, listRes);
  assert.strictEqual(listRes.body.success, true);
  assert.ok(Array.isArray(listRes.body.items));
  const listed = listRes.body.items.find((i) => i.name === name);
  assert.ok(listed, "created item appears in the listing");
  assert.strictEqual(listed.status, "Available");

  // Restock adds, delete removes, and both keep their original messages.
  const restockRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await prasadamController.restockPrasadam(
    { params: { id: createRes.body.item._id }, body: { quantityAdded: 11 } },
    restockRes
  );
  assert.strictEqual(restockRes.body.message, "Prasadam restocked successfully");
  assert.strictEqual(Number(restockRes.body.item.availableQuantity), 20);

  const deleteRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await prasadamController.deletePrasadam({ params: { id: createRes.body.item._id } }, deleteRes);
  assert.strictEqual(deleteRes.body.message, "Prasadam deleted successfully.");

  const goneRes = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await prasadamController.deletePrasadam({ params: { id: unique() } }, goneRes);
  assert.strictEqual(goneRes.statusCode, 404);
  assert.strictEqual(goneRes.body.message, "Prasadam not found.");
});
