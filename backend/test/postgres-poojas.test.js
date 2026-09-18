// Phase 2Y PostgreSQL tests for the Pooja repository and persistence service.
//
// The Pooja domain is migrated additively: PostgreSQL is an additional
// persistence path selected at operation time, MongoDB stays the source of
// truth and the fallback. These tests exercise the real PostgreSQL path (the
// datasource seam is pinned "connected" and DATABASE_URL points at the test
// database, so every operation below reaches the real poojaRepository and the
// real poojas / pooja_required_materials tables). They verify:
//   - the complete Mongo → PostgreSQL field mapping (every persisted field,
//     including the embedded requiredMaterials[] sub-documents),
//   - nullability, defaults and the schema's own coercions,
//   - the 2-value status enum and the min:0 price rule,
//   - the name uniqueness constraint (PoojaMaterialRequirement.poojaName),
//   - date/time semantics: availableDates[] calendar days, the
//     availableStartTime/availableEndTime "HH:mm" strings and createdAt /
//     updatedAt instants,
//   - filtering, sorting, counting and the requiredMaterials[] ordering,
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
const Pooja = require("../src/models/Pooja");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");

let originalIsDbConnected;
let poojaRepository;
let poojaService;

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
  await pgQuery("DROP TABLE IF EXISTS pooja_required_materials CASCADE");
  await pgQuery("DROP TABLE IF EXISTS poojas CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '026_create_poojas.sql'");
  runMigrate();
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;
  poojaRepository = require("../src/repositories/poojaRepository");
  poojaService = require("../src/services/poojaService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// Every field the Pooja schema persists, populated with a distinct value so the
// mapping assertions below can prove each column is the one it claims to be.
const poojaPayload = (overrides = {}) => ({
  name: `Archana-${unique()}`,
  description: "Daily morning archana",
  price: 250.5,
  duration: "30 mins",
  availableDays: ["Monday", "Wednesday"],
  availableDates: ["2099-05-20", "2099-06-15"],
  availableStartTime: "06:00",
  availableEndTime: "11:30",
  minimumAdvanceBookingDays: 2,
  strictAdvancePreparation: true,
  requiredMaterials: [],
  rules: ["No leather items", "Bathed before entry"],
  instructions: ["Bring the prasadam container"],
  dressCode: "Traditional",
  status: "Active",
  ...overrides,
});

// A material item id: the column is plain TEXT (no FK — see the migration
// header), so any id-shaped string exercises the reference faithfully.
const materialItem = () => unique();

const materialPayload = (overrides = {}) => ({
  item: materialItem(),
  itemName: "Camphor",
  qty: 2.5,
  unit: "kg",
  responsibilityType: "DEVOTEE_MUST_BRING",
  materialSource: "TEMPLE_INVENTORY",
  mandatory: true,
  preparationDaysBeforePooja: 3,
  preparationInstructions: "Soak overnight",
  collectionInstructions: "Collect from the counter",
  requiresAdvanceCollection: true,
  templeCharge: 10.25,
  ...overrides,
});

// ─── Datasource selection ──────────────────────────────────────────────────
test("poojas: the service selects PostgreSQL when the datasource seam is connected", async () => {
  assert.strictEqual(poojaService.isConnected(), true);
  assert.strictEqual(await poojaService.usePostgres(), true);
});

test("poojas: the service falls back to Mongoose when the datasource seam is disconnected", async () => {
  const wasConnected = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(await poojaService.usePostgres(), false);
  } finally {
    dbConfig.isDbConnected = wasConnected;
  }
});

// ─── Field mapping ─────────────────────────────────────────────────────────
test("poojas (PG): every persisted Mongo field round-trips through the repository", async () => {
  const payload = poojaPayload({ requiredMaterials: [materialPayload(), materialPayload({ itemName: "Kumkum", unit: "g" })] });
  const created = await poojaRepository.create(payload);

  assert.strictEqual(created.name, payload.name);
  assert.strictEqual(created.description, payload.description);
  assert.strictEqual(created.price, 250.5);
  assert.strictEqual(created.duration, payload.duration);
  assert.deepStrictEqual(created.availableDays, ["Monday", "Wednesday"]);
  assert.strictEqual(created.availableStartTime, "06:00");
  assert.strictEqual(created.availableEndTime, "11:30");
  assert.strictEqual(created.minimumAdvanceBookingDays, 2);
  assert.strictEqual(created.strictAdvancePreparation, true);
  assert.deepStrictEqual(created.rules, ["No leather items", "Bathed before entry"]);
  assert.deepStrictEqual(created.instructions, ["Bring the prasadam container"]);
  assert.strictEqual(created.dressCode, "Traditional");
  assert.strictEqual(created.status, "Active");

  // availableDates is a calendar-day STRING list ("YYYY-MM-DD"), not instants —
  // poojaBookingController compares it against toISOString().split("T")[0].
  assert.deepStrictEqual(created.availableDates, ["2099-05-20", "2099-06-15"]);

  // createdAt/updatedAt are instants.
  assert.ok(created.createdAt instanceof Date || !Number.isNaN(new Date(created.createdAt).getTime()));
  assert.ok(created.updatedAt instanceof Date || !Number.isNaN(new Date(created.updatedAt).getTime()));

  // The embedded requiredMaterials[] round-trips field-for-field, in order.
  assert.strictEqual(created.requiredMaterials.length, 2);
  const first = created.requiredMaterials[0];
  assert.strictEqual(first.item, payload.requiredMaterials[0].item);
  assert.strictEqual(first.itemName, "Camphor");
  assert.strictEqual(first.qty, 2.5);
  assert.strictEqual(first.unit, "kg");
  assert.strictEqual(first.responsibilityType, "DEVOTEE_MUST_BRING");
  assert.strictEqual(first.materialSource, "TEMPLE_INVENTORY");
  assert.strictEqual(first.mandatory, true);
  assert.strictEqual(first.preparationDaysBeforePooja, 3);
  assert.strictEqual(first.preparationInstructions, "Soak overnight");
  assert.strictEqual(first.collectionInstructions, "Collect from the counter");
  assert.strictEqual(first.requiresAdvanceCollection, true);
  assert.strictEqual(first.templeCharge, 10.25);
  assert.strictEqual(created.requiredMaterials[1].itemName, "Kumkum");

  // The row is really in PostgreSQL.
  const rows = await pgQuery("SELECT name, price::text AS price, status FROM poojas WHERE id = $1", [created._id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, payload.name);
  // The repo convention is bare NUMERIC (no fixed scale), so the value
  // round-trips exactly rather than being padded to two decimals.
  assert.strictEqual(Number(rows[0].price), 250.5);
  assert.strictEqual(rows[0].status, "Active");

  const children = await pgQuery(
    "SELECT item_name, qty::text AS qty, temple_charge::text AS charge FROM pooja_required_materials WHERE pooja_id = $1 ORDER BY position",
    [created._id]
  );
  assert.strictEqual(children.length, 2);
  assert.strictEqual(children[0].item_name, "Camphor");
  assert.strictEqual(Number(children[0].qty), 2.5);
  assert.strictEqual(Number(children[0].charge), 10.25);
});

test("poojas (PG): schema defaults are applied on insert", async () => {
  const created = await poojaRepository.create({ name: `Minimal-${unique()}`, price: 100 });

  assert.strictEqual(created.status, "Active");
  assert.deepStrictEqual(created.availableDays, ["Everyday"]);
  assert.deepStrictEqual(created.availableDates, []);
  assert.deepStrictEqual(created.requiredMaterials, []);
  assert.deepStrictEqual(created.rules, []);
  assert.strictEqual(created.availableStartTime, "");
  assert.strictEqual(created.availableEndTime, "");
  assert.strictEqual(created.minimumAdvanceBookingDays, 0);
  assert.strictEqual(created.strictAdvancePreparation, false);
  assert.strictEqual(created.dressCode, "");
});

test("poojas (PG): a requiredMaterials sub-document gets the sub-schema defaults", async () => {
  const created = await poojaRepository.create({
    name: `MatDefaults-${unique()}`,
    price: 50,
    requiredMaterials: [{ itemName: "Milk", qty: 1, unit: "L" }],
  });
  const material = created.requiredMaterials[0];
  assert.strictEqual(material.materialSource, "TEMPLE_INVENTORY");
  assert.strictEqual(material.responsibilityType, "TEMPLE_PROVIDES");
  assert.strictEqual(material.preparationDaysBeforePooja, 0);
  assert.strictEqual(material.requiresAdvanceCollection, false);
  assert.strictEqual(material.mandatory, false);
  assert.strictEqual(material.templeCharge, 0);
  assert.strictEqual(material.preparationInstructions, "");
  assert.strictEqual(material.collectionInstructions, "");
  assert.strictEqual(material.item, undefined, "item is optional on the sub-schema");
});

test("poojas (PG): unknown body keys are discarded exactly as Mongoose strict mode does", async () => {
  const created = await poojaRepository.create({
    name: `Strict-${unique()}`,
    price: 10,
    totallyUnknown: "should not persist",
    status: "Active",
  });
  assert.strictEqual(created.totallyUnknown, undefined);
});

test("poojas (PG): description defaults to the schema's empty string", async () => {
  const blank = await poojaRepository.create({ name: `Blank-${unique()}`, price: 1, description: "" });
  assert.strictEqual(blank.description, "");

  // The schema declares default "", so an absent description is "" and not null.
  const absent = await poojaRepository.create({ name: `Absent-${unique()}`, price: 1 });
  assert.strictEqual(absent.description, "");
});

// ─── Read paths ────────────────────────────────────────────────────────────
test("poojas (PG): findById returns the row and null for a missing id", async () => {
  const created = await poojaRepository.create({ name: `ById-${unique()}`, price: 5 });
  const found = await poojaRepository.findById(created._id);
  assert.strictEqual(found._id, created._id);
  assert.strictEqual(found.name, created.name);

  const missing = await poojaRepository.findById("000000000000000000000000");
  assert.strictEqual(missing, null);
});

test("poojas (PG): findOne matches on name and returns null when absent", async () => {
  const created = await poojaRepository.create({ name: `ByName-${unique()}`, price: 7 });
  const found = await poojaRepository.findOne({ name: created.name });
  assert.strictEqual(found._id, created._id);
  assert.strictEqual(await poojaRepository.findOne({ name: "definitely-not-a-pooja" }), null);
});

test("poojas (PG): findMany returns the listing and supports pagination", async () => {
  const marker = `Page-${unique()}`;
  const names = [`${marker}-a`, `${marker}-b`, `${marker}-c`];
  for (const name of names) {
    await poojaRepository.create({ name, price: 1 });
  }
  const all = await poojaRepository.findMany({ filter: {} });
  assert.ok(all.length >= 3);

  const filtered = await poojaRepository.findMany({ filter: { name: { $in: names } } });
  assert.strictEqual(filtered.length, 3);

  // Default order is createdAt ASC, id ASC, so offset 1 skips the first created.
  const page = await poojaRepository.findMany({ filter: { name: { $in: names } }, limit: 2, offset: 1 });
  assert.strictEqual(page.length, 2);
  assert.deepStrictEqual(page.map((p) => p.name), [names[1], names[2]]);

  const beyond = await poojaRepository.findMany({ filter: { name: { $in: names } }, limit: 2, offset: 10 });
  assert.strictEqual(beyond.length, 0);
});

test("poojas (PG): count reproduces the Mongo countDocuments predicates", async () => {
  const marker = `Count-${unique()}`;
  const active = `${marker}-1`;
  const inactive = `${marker}-2`;
  await poojaRepository.create({ name: active, price: 1, status: "Active" });
  await poojaRepository.create({ name: inactive, price: 1, status: "Inactive" });

  assert.strictEqual(await poojaRepository.count({ name: { $in: [active, inactive] } }), 2);
  assert.strictEqual(await poojaRepository.count({ name: { $in: [active, inactive] }, status: "Inactive" }), 1);
});

test("poojas (PG): requiredMaterials keep their array order across reads", async () => {
  const created = await poojaRepository.create({
    name: `Order-${unique()}`,
    price: 1,
    requiredMaterials: [
      materialPayload({ itemName: "First" }),
      materialPayload({ itemName: "Second" }),
      materialPayload({ itemName: "Third" }),
    ],
  });
  const found = await poojaRepository.findById(created._id);
  assert.deepStrictEqual(found.requiredMaterials.map((m) => m.itemName), ["First", "Second", "Third"]);
});

// ─── Update / delete ───────────────────────────────────────────────────────
test("poojas (PG): updateById applies only the supplied fields", async () => {
  const created = await poojaRepository.create({
    name: `Update-${unique()}`,
    price: 20,
    description: "keep me",
    requiredMaterials: [materialPayload({ itemName: "Keep" })],
  });

  const updated = await poojaRepository.updateById(created._id, { price: 99.99, status: "Inactive" });
  assert.strictEqual(updated.price, 99.99);
  assert.strictEqual(updated.status, "Inactive");
  assert.strictEqual(updated.description, "keep me");
  assert.strictEqual(updated.requiredMaterials.length, 1);
  assert.strictEqual(updated.requiredMaterials[0].itemName, "Keep");
});

test("poojas (PG): updateById replaces requiredMaterials wholesale when supplied", async () => {
  const created = await poojaRepository.create({
    name: `Replace-${unique()}`,
    price: 20,
    requiredMaterials: [materialPayload({ itemName: "Old1" }), materialPayload({ itemName: "Old2" })],
  });

  const updated = await poojaRepository.updateById(created._id, {
    requiredMaterials: [materialPayload({ itemName: "NewOnly" })],
  });
  assert.strictEqual(updated.requiredMaterials.length, 1);
  assert.strictEqual(updated.requiredMaterials[0].itemName, "NewOnly");

  const children = await pgQuery("SELECT count(*)::int AS c FROM pooja_required_materials WHERE pooja_id = $1", [created._id]);
  assert.strictEqual(children[0].c, 1, "the replaced children were deleted");
});

test("poojas (PG): updateById returns null for a missing id", async () => {
  const updated = await poojaRepository.updateById("000000000000000000000000", { price: 1 });
  assert.strictEqual(updated, null);
});

test("poojas (PG): destroy removes the row and cascades to its materials", async () => {
  const created = await poojaRepository.create({
    name: `Delete-${unique()}`,
    price: 1,
    requiredMaterials: [materialPayload({ itemName: "Gone" })],
  });

  const deleted = await poojaRepository.destroy(created._id);
  assert.ok(deleted, "the deleted document is returned");
  assert.strictEqual(await poojaRepository.findById(created._id), null);

  const children = await pgQuery("SELECT count(*)::int AS c FROM pooja_required_materials WHERE pooja_id = $1", [created._id]);
  assert.strictEqual(children[0].c, 0);
});

test("poojas (PG): destroy returns null for a missing id", async () => {
  assert.strictEqual(await poojaRepository.destroy("000000000000000000000000"), null);
});

// ─── Enums / validation ────────────────────────────────────────────────────
test("poojas (PG): the two-value status enum round-trips and an invalid status is rejected", async () => {
  const active = await poojaRepository.create({ name: `EnumA-${unique()}`, price: 1, status: "Active" });
  assert.strictEqual(active.status, "Active");
  const inactive = await poojaRepository.create({ name: `EnumI-${unique()}`, price: 1, status: "Inactive" });
  assert.strictEqual(inactive.status, "Inactive");

  await assert.rejects(
    () => poojaRepository.create({ name: `EnumBad-${unique()}`, price: 1, status: "Bogus" }),
    /status/
  );
});

test("poojas (PG): the required fields and the min:0 price rule are enforced", async () => {
  await assert.rejects(() => poojaRepository.create({ price: 1 }), /name is required/);
  await assert.rejects(() => poojaRepository.create({ name: `NoPrice-${unique()}` }), /price is required/);
  await assert.rejects(() => poojaRepository.create({ name: `Neg-${unique()}`, price: -5 }), /price/);
});

test("poojas (PG): the name unique constraint is enforced", async () => {
  const name = `Unique-${unique()}`;
  await poojaRepository.create({ name, price: 1 });
  await assert.rejects(() => poojaRepository.create({ name, price: 1 }), /duplicate key|unique/i);
});

// ─── Date / time semantics ─────────────────────────────────────────────────
test("poojas (PG): availableDates keep their YYYY-MM-DD calendar strings", async () => {
  const created = await poojaRepository.create({
    name: `Dates-${unique()}`,
    price: 1,
    availableDates: ["2099-01-01", "2099-12-31"],
  });
  const found = await poojaRepository.findById(created._id);
  assert.deepStrictEqual(found.availableDates, ["2099-01-01", "2099-12-31"]);

  // The booking gate compares a date list entry against the ISO day part.
  const day = new Date("2099-12-31T00:00:00.000Z").toISOString().split("T")[0];
  assert.ok(found.availableDates.includes(day));
});

test("poojas (PG): availableStartTime/availableEndTime keep their HH:mm strings", async () => {
  const created = await poojaRepository.create({
    name: `Times-${unique()}`,
    price: 1,
    availableStartTime: "05:30",
    availableEndTime: "21:45",
  });
  const found = await poojaRepository.findById(created._id);
  assert.strictEqual(found.availableStartTime, "05:30");
  assert.strictEqual(found.availableEndTime, "21:45");
});

test("poojas (PG): updatedAt advances on update while createdAt is preserved", async () => {
  const created = await poojaRepository.create({ name: `Stamps-${unique()}`, price: 1 });
  const before = new Date(created.updatedAt).getTime();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const updated = await poojaRepository.updateById(created._id, { price: 2 });
  assert.strictEqual(new Date(updated.createdAt).getTime(), new Date(created.createdAt).getTime());
  assert.ok(new Date(updated.updatedAt).getTime() >= before);
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("poojas (PG): a PostgreSQL write never reaches MongoDB", async () => {
  const originalCreate = Pooja.create;
  let mongoWrites = 0;
  Pooja.create = async (...args) => { mongoWrites += 1; return originalCreate.apply(Pooja, args); };
  try {
    const created = await poojaService.create({ name: `NoDual-${unique()}`, price: 1 });
    assert.ok(created._id);
  } finally {
    Pooja.create = originalCreate;
  }
  assert.strictEqual(mongoWrites, 0, "the PostgreSQL path did not touch Mongoose");
});

// ─── Validation shared by both paths ───────────────────────────────────────
test("poojas: validation rejects the same payloads Mongo rejects", async () => {
  assert.throws(() => poojaService.validate({ price: 1 }), /name is required/);
  assert.throws(() => poojaService.validate({ name: "x" }), /price is required/);
  assert.throws(() => poojaService.validate({ name: "x", price: 1, status: "Nope" }), /status/);
  assert.throws(() => poojaService.validate({ name: "x", price: 1, requiredMaterials: [{ itemName: "a", qty: 1 }] }), /unit is required/);
});
