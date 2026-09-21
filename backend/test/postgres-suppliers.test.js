// Phase 2AH PostgreSQL-path tests for the Supplier repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - supplierRepository / supplierService persist to and read from the real
//     suppliers table (no mocks),
//   - every migrated Mongo schema field round-trips losslessly,
//   - defaults, validation and null semantics match the Mongo model exactly
//     (name required; address/phone/email/gst optional default '' but accept an
//     explicit null),
//   - findMany mirrors Supplier.find().sort({ name: 1 }) and supports the
//     whitelisted sorts and pagination,
//   - create / updateById / destroy / count behave like their Mongoose
//     counterparts, including the controller's no-runValidators update,
//   - the table carries exactly the approved shape — one primary key, one name
//     index, NO unique constraint, NO CHECK, NO foreign key,
//   - `itemsSupplied` is deliberately NOT persisted, and
//   - the service never writes to MongoDB while PostgreSQL is selected
//     (no dual writes) and can switch datasources in-process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Supplier = require("../src/models/Supplier");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const hex24 = () => crypto.randomBytes(12).toString("hex");

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const row of rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    }
  } finally {
    await pool.end();
  }
};

let originalIsDbConnected;
let supplierRepository;
let supplierService;

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
  dbConfig.isDbConnected = () => true;
  supplierRepository = require("../src/repositories/supplierRepository");
  supplierService = require("../src/services/supplierService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const supplierBase = (overrides = {}) => ({
  name: `Supplier ${unique()}`,
  address: "12 Temple Road",
  phone: "9876543210",
  email: "supplier@example.com",
  gst: "29ABCDE1234F1Z5",
  ...overrides,
});

// ─── Round trip ───────────────────────────────────────────────────────────
test("PG path: create persists one row and returns the Mongoose-shaped document", async () => {
  const payload = supplierBase();
  const created = await supplierService.create(payload);

  assert.ok(created._id, "an _id is returned");
  assert.strictEqual(created._id.length, 24, "the id is a 24-char Mongo-compatible hex string");
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.name, payload.name);
  assert.strictEqual(created.address, payload.address);
  assert.strictEqual(created.phone, payload.phone);
  assert.strictEqual(created.email, payload.email);
  assert.strictEqual(created.gst, payload.gst);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  const raw = await poolQuery("SELECT id, name, address, phone, email, gst FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw.length, 1, "exactly one row written");
  assert.strictEqual(raw[0].name, payload.name);
  assert.strictEqual(raw[0].gst, payload.gst);

  const read = await supplierService.findById(created._id);
  assert.strictEqual(read._id, created._id);
  assert.strictEqual(read.name, payload.name);
  assert.strictEqual(read.email, payload.email);
});

test("PG path: id values are ObjectId-compatible and stable", async () => {
  const created = await supplierService.create(supplierBase());
  // A 24-char hex string is a valid Mongo ObjectId representation, so an id
  // minted by PostgreSQL can be handed back to the Mongo path unchanged.
  const asObjectId = await poolQuery("SELECT id::text AS id FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(asObjectId[0].id, created._id);
  assert.ok(/^[0-9a-f]{24}$/.test(asObjectId[0].id));
});

test("PG path: a caller-supplied id is honored", async () => {
  const id = hex24();
  const created = await supplierRepository.create({ ...supplierBase(), id });
  assert.strictEqual(created._id, id);
});

// ─── Required / default semantics mirror Mongoose exactly ──────────────────
test("PG path: name is required like Mongo", async () => {
  await assert.rejects(
    () => supplierService.create(supplierBase({ name: undefined })),
    /name is required/
  );
  await assert.rejects(
    () => supplierService.create(supplierBase({ name: "" })),
    /name is required/
  );
  await assert.rejects(
    () => supplierService.create(supplierBase({ name: "   " })),
    /name is required/,
    "whitespace-only collapses to '' under trim and fails, exactly as Mongoose does"
  );
});

test("PG path: name is trimmed on write", async () => {
  const created = await supplierService.create(supplierBase({ name: "  Trimmed Supplier  " }));
  assert.strictEqual(created.name, "Trimmed Supplier");
  const raw = await poolQuery("SELECT name FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].name, "Trimmed Supplier");
});

test("PG path: optional fields default to empty string when omitted", async () => {
  const created = await supplierService.create({ name: `Only Name ${unique()}` });
  // Mongoose's `default: ''` fires on an omitted path and the value is
  // persisted, so reading it back yields '' — not undefined/null.
  assert.strictEqual(created.address, "");
  assert.strictEqual(created.phone, "");
  assert.strictEqual(created.email, "");
  assert.strictEqual(created.gst, "");

  const raw = await poolQuery("SELECT address, phone, email, gst FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].address, "");
  assert.strictEqual(raw[0].phone, "");
  assert.strictEqual(raw[0].email, "");
  assert.strictEqual(raw[0].gst, "");
});

test("PG path: optional fields accept an explicit null, as Mongo does", async () => {
  // `default` fires only on an omitted value, so `address: null` validates and
  // persists as null under Mongoose. The columns must be nullable to accept it.
  const created = await supplierService.create(supplierBase({
    address: null, phone: null, email: null, gst: null,
  }));
  const raw = await poolQuery("SELECT address, phone, email, gst FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].address, null);
  assert.strictEqual(raw[0].phone, null);
  assert.strictEqual(raw[0].email, null);
  assert.strictEqual(raw[0].gst, null);
});

test("PG path: optional fields are trimmed, and blank stores empty rather than null-on-create", async () => {
  const created = await supplierService.create(supplierBase({ address: "  Padded  ", phone: "  " }));
  assert.strictEqual(created.address, "Padded");
  // A whitespace-only value trims to '', which is what Mongoose stores.
  assert.strictEqual(created.phone, "");
  const raw = await poolQuery("SELECT address, phone FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].address, "Padded");
  assert.strictEqual(raw[0].phone, "");
});

test("PG path: an empty-string optional field stores empty, as Mongo does", async () => {
  const created = await supplierService.create(supplierBase({ address: "", gst: "" }));
  const raw = await poolQuery("SELECT address, gst FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].address, "");
  assert.strictEqual(raw[0].gst, "");
});

test("PG path: a non-string optional value is cast to its String form, as Mongoose does", async () => {
  // Mongoose casts a Number supplied to a String path (gst: 12345 -> '12345').
  // No format CHECK exists, so the same payload must be accepted here.
  const created = await supplierService.create(supplierBase({ gst: 12345 }));
  assert.strictEqual(created.gst, "12345");
  const raw = await poolQuery("SELECT gst FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].gst, "12345");
});

test("PG path: no uniqueness is enforced — duplicate names persist, exactly like Mongo", async () => {
  const name = `Duplicate ${unique()}`;
  const first = await supplierService.create(supplierBase({ name }));
  const second = await supplierService.create(supplierBase({ name }));

  assert.notStrictEqual(first._id, second._id);
  const count = await supplierService.count({ name });
  assert.strictEqual(count, 2, "two suppliers may share a name; the schema declares no unique index");
});

test("PG path: itemsSupplied is deliberately not persisted", async () => {
  // The field is unused across the application and is intentionally NOT part of
  // the PostgreSQL migration. Supplying it must not fail and must not add a
  // column: the Mongo schema stays the only place it exists.
  const created = await supplierService.create(supplierBase({ itemsSupplied: ["Rice", "Oil"] }));
  assert.strictEqual(created._id.length, 24);

  const cols = await poolQuery(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'suppliers'`
  );
  const names = cols.map((c) => c.column_name);
  assert.ok(!names.includes("items_supplied"), "no items_supplied column was invented");
  assert.ok(!names.includes("itemsSupplied"));
});

// ─── Query surface ─────────────────────────────────────────────────────────
test("PG path: findMany mirrors Supplier.find().sort({ name: 1 })", async () => {
  const tag = unique();
  await supplierService.create(supplierBase({ name: `Zeta ${tag}` }));
  await supplierService.create(supplierBase({ name: `Alpha ${tag}` }));
  await supplierService.create(supplierBase({ name: `Mu ${tag}` }));

  const rows = await supplierService.findMany({ sort: { name: 1 } });
  const mine = rows.filter((r) => r.name.endsWith(tag)).map((r) => r.name);
  assert.deepStrictEqual(mine, [`Alpha ${tag}`, `Mu ${tag}`, `Zeta ${tag}`], "ascending by name");
});

test("PG path: the default sort is name ASC when no sort is given", async () => {
  const tag = unique();
  await supplierService.create(supplierBase({ name: `Beta ${tag}` }));
  await supplierService.create(supplierBase({ name: `Alpha ${tag}` }));
  const rows = await supplierRepository.findMany({});
  const mine = rows.filter((r) => r.name.endsWith(tag)).map((r) => r.name);
  assert.deepStrictEqual(mine, [`Alpha ${tag}`, `Beta ${tag}`]);
});

test("PG path: findMany supports the whitelisted sorts and ignores unknown ones", async () => {
  const tag = unique();
  await supplierService.create(supplierBase({ name: `Srt ${tag}`, email: `b_${tag}@x.com` }));
  await supplierService.create(supplierBase({ name: `Srt ${tag}`, email: `a_${tag}@x.com` }));

  const byEmail = await supplierRepository.findMany({ filter: { name: `Srt ${tag}` }, sort: { email: 1 } });
  assert.deepStrictEqual(byEmail.map((r) => r.email).sort(), [`a_${tag}@x.com`, `b_${tag}@x.com`]);
  assert.strictEqual(byEmail[0].email, `a_${tag}@x.com`);

  // An unknown sort key falls back to the default rather than injecting SQL.
  const unknown = await supplierRepository.findMany({ filter: { name: `Srt ${tag}` }, sort: { "name; DROP TABLE suppliers": 1 } });
  assert.strictEqual(unknown.length, 2);
});

test("PG path: findMany paginates with limit/offset", async () => {
  const tag = unique();
  for (const n of ["A", "B", "C"]) await supplierService.create(supplierBase({ name: `${n} ${tag}` }));
  const page = await supplierRepository.findMany({ filter: { name: { $regex: tag } }, sort: { name: 1 }, limit: 2, offset: 1 });
  assert.deepStrictEqual(page.map((r) => r.name), [`B ${tag}`, `C ${tag}`]);
});

test("PG path: filters honor $in (including an empty list) and $regex", async () => {
  const tag = unique();
  const a = await supplierService.create(supplierBase({ name: `In A ${tag}` }));
  const b = await supplierService.create(supplierBase({ name: `In B ${tag}` }));

  const found = await supplierRepository.findMany({ filter: { id: { $in: [a._id, b._id] } } });
  assert.strictEqual(found.length, 2);

  const empty = await supplierRepository.findMany({ filter: { id: { $in: [] } } });
  assert.strictEqual(empty.length, 0, "an empty $in matches nothing, as in Mongo");

  const regex = await supplierRepository.findMany({ filter: { name: { $regex: `In [AB] ${tag}` } } });
  assert.strictEqual(regex.length, 2);
});

test("PG path: findOne returns the first row or null", async () => {
  const created = await supplierService.create(supplierBase());
  const found = await supplierService.findOne({ name: created.name });
  assert.strictEqual(found._id, created._id);

  const missing = await supplierService.findOne({ name: `Nope ${unique()}` });
  assert.strictEqual(missing, null);
});

test("PG path: findById returns null for an unknown or malformed id", async () => {
  assert.strictEqual(await supplierService.findById(hex24()), null);
  assert.strictEqual(await supplierService.findById("not-an-object-id"), null);
});

test("PG path: count honors filters", async () => {
  const tag = unique();
  assert.strictEqual(await supplierService.count({ name: { $regex: tag } }), 0);
  await supplierService.create(supplierBase({ name: `Cnt ${tag}` }));
  assert.strictEqual(await supplierService.count({ name: `Cnt ${tag}` }), 1);
  assert.strictEqual(await supplierService.count({ name: { $regex: tag } }), 1);
});

// ─── Update / delete ───────────────────────────────────────────────────────
test("PG path: updateById writes every controller-owned field and returns the new document", async () => {
  const created = await supplierService.create(supplierBase());
  const updated = await supplierService.updateById(created._id, {
    name: "  Updated Name  ",
    address: " New Address ",
    phone: " 111 ",
    email: " new@example.com ",
    gst: " NEWGST ",
  });

  assert.strictEqual(updated.name, "Updated Name");
  assert.strictEqual(updated.address, "New Address");
  assert.strictEqual(updated.phone, "111");
  assert.strictEqual(updated.email, "new@example.com");
  assert.strictEqual(updated.gst, "NEWGST");

  const read = await supplierService.findById(created._id);
  assert.strictEqual(read.name, "Updated Name");
  assert.strictEqual(read.gst, "NEWGST");
});

test("PG path: updateById does NOT validate name (the controller sends none)", async () => {
  // updateSupplier's Mongoose call passes no runValidators, so Mongo applies an
  // empty name verbatim. PostgreSQL must not turn that accepted write into an
  // error — this preserves the pre-migration behaviour exactly.
  const created = await supplierService.create(supplierBase());
  const updated = await supplierService.updateById(created._id, { name: "" });
  assert.strictEqual(updated.name, "");
  const raw = await poolQuery("SELECT name FROM suppliers WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].name, "");
});

test("PG path: updateById refreshes updated_at", async () => {
  const created = await supplierService.create(supplierBase());
  const before = await poolQuery("SELECT updated_at FROM suppliers WHERE id = $1", [created._id]);
  await supplierService.updateById(created._id, { name: "Touched" });
  const after = await poolQuery("SELECT updated_at FROM suppliers WHERE id = $1", [created._id]);
  assert.ok(after[0].updated_at.getTime() >= before[0].updated_at.getTime());
});

test("PG path: updateById ignores id and timestamps supplied by a caller", async () => {
  const created = await supplierService.create(supplierBase());
  const otherId = hex24();
  const updated = await supplierService.updateById(created._id, {
    id: otherId, createdAt: new Date(0), updatedAt: new Date(0), name: "Kept",
  });
  assert.strictEqual(updated._id, created._id, "the row id cannot be reassigned");
  assert.strictEqual(updated.name, "Kept");
  const raw = await poolQuery("SELECT created_at FROM suppliers WHERE id = $1", [created._id]);
  assert.ok(raw[0].created_at.getTime() !== 0, "created_at is not caller-writable");
});

test("PG path: updateById returns null for an unknown id", async () => {
  assert.strictEqual(await supplierService.updateById(hex24(), { name: "X" }), null);
});

test("PG path: destroy removes the row and returns the deleted document", async () => {
  const created = await supplierService.create(supplierBase());
  const deleted = await supplierService.destroy(created._id);
  assert.strictEqual(deleted._id, created._id);
  assert.strictEqual(await supplierService.findById(created._id), null);
  assert.strictEqual(await supplierService.destroy(created._id), null, "a second delete matches nothing");
});

// ─── Service gate behaviour ────────────────────────────────────────────────
test("PG path: isConnected() and usePostgres() follow the datasource seam", async () => {
  assert.strictEqual(supplierService.isConnected(), true);
  assert.strictEqual(await supplierService.usePostgres(), true);
});

test("PG path: a single service create writes exactly one row and never touches MongoDB (no dual write)", async () => {
  const originalCreate = Supplier.create;
  const originalFind = Supplier.find;
  let mongoCreates = 0;
  let mongoFind = 0;
  Supplier.create = async () => { mongoCreates += 1; throw new Error("Mongo must not be written on the PG path"); };
  Supplier.find = () => { mongoFind += 1; throw new Error("Mongo must not be read on the PG path"); };
  try {
    const created = await supplierService.create(supplierBase());
    const rows = await supplierService.findMany({ filter: { id: created._id } });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(mongoCreates, 0, "no dual write to Mongo");
    assert.strictEqual(mongoFind, 0, "no Mongo read on the PG path");
  } finally {
    Supplier.create = originalCreate;
    Supplier.find = originalFind;
  }
});

// ─── SQL schema assertions ─────────────────────────────────────────────────
test("PG path: suppliers table has the exact Mongo field mapping", async () => {
  const cols = await poolQuery(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'suppliers' AND table_schema = 'public'
     ORDER BY ordinal_position`
  );
  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  const expected = ["id", "name", "address", "phone", "email", "gst", "created_at", "updated_at"];
  // exactly 8 columns = id + 5 schema fields + 2 timestamps. No itemsSupplied,
  // no contactPerson, no bank details, no payment terms, no active flag.
  assert.strictEqual(cols.length, 8, "exactly 8 mapped columns");
  assert.deepStrictEqual(cols.map((c) => c.column_name), expected);
  for (const name of expected) assert.ok(byName[name], `${name} exists`);
  assert.strictEqual(byName.items_supplied, undefined, "itemsSupplied is deliberately not migrated");
  assert.strictEqual(byName.active, undefined, "no invented active column");
  assert.strictEqual(byName.payment_terms, undefined, "no invented payment_terms column");
  assert.strictEqual(byName.bank_details, undefined, "no invented bank_details column");

  assert.strictEqual(byName.id.is_nullable, "NO");
  assert.strictEqual(byName.name.is_nullable, "NO", "name required, no default");
  assert.strictEqual(byName.name.column_default, null, "name has NO default");
  assert.strictEqual(byName.address.is_nullable, "YES", "address has a default but accepts an explicit null");
  assert.strictEqual(byName.phone.is_nullable, "YES");
  assert.strictEqual(byName.email.is_nullable, "YES");
  assert.strictEqual(byName.gst.is_nullable, "YES");
  assert.strictEqual(byName.created_at.is_nullable, "NO");
  assert.strictEqual(byName.updated_at.is_nullable, "NO");
  assert.match(String(byName.address.column_default), /^''/);
  assert.match(String(byName.gst.column_default), /^''/);
  assert.match(String(byName.created_at.column_default), /now\(\)/);
  assert.match(String(byName.updated_at.column_default), /now\(\)/);
});

test("PG path: every supplier column is TEXT — no NUMERIC conversion of gst", async () => {
  const cols = await poolQuery(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'suppliers' AND table_schema = 'public'`
  );
  for (const c of cols) {
    if (c.column_name === "created_at" || c.column_name === "updated_at") {
      assert.strictEqual(c.data_type, "timestamp with time zone", `${c.column_name} is TIMESTAMPTZ`);
    } else {
      assert.strictEqual(c.data_type, "text", `${c.column_name} is TEXT`);
    }
  }
});

test("PG path: the only non-primary index is on name", async () => {
  const idx = await poolQuery(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'suppliers' AND schemaname = 'public' ORDER BY indexname`
  );
  const names = idx.map((r) => r.indexname);
  assert.ok(names.includes("idx_suppliers_name"), "name index exists");
  const def = (n) => idx.find((r) => r.indexname === n).indexdef;
  assert.match(def("idx_suppliers_name"), /\(name\)/);
  const nonPk = idx.filter((r) => r.indexname !== "suppliers_pkey");
  assert.strictEqual(nonPk.length, 1, "exactly one approved non-primary index");
});

test("PG path: NO unique constraint beyond the primary key", async () => {
  // The Mongo schema declares no unique index, so PostgreSQL must not either:
  // two suppliers may share a name, phone, email or GST number.
  const idx = await poolQuery(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'suppliers' AND schemaname = 'public'`
  );
  const unique = idx.filter((r) => /CREATE UNIQUE INDEX/.test(r.indexdef));
  assert.strictEqual(unique.length, 1, "exactly one UNIQUE index (the primary key)");
  assert.match(unique[0].indexdef, /\(id\)/);

  const cons = await poolQuery(
    `SELECT conname, contype FROM pg_constraint
     WHERE conrelid = 'public.suppliers'::regclass ORDER BY contype`
  );
  assert.deepStrictEqual(cons.map((c) => c.contype), ["p"], "only a primary key constraint");
});

test("PG path: NO CHECK constraint and NO foreign key were introduced", async () => {
  const checks = await poolQuery(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.suppliers'::regclass AND contype = 'c'`
  );
  assert.deepStrictEqual(checks, [], "no CHECK constraint (no enum, no format rule)");

  const fks = await poolQuery(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.suppliers'::regclass AND contype = 'f'`
  );
  assert.deepStrictEqual(fks, [], "suppliers carries no foreign key");
});

test("PG path: NO existing table gained a foreign key to suppliers", async () => {
  // This phase deliberately adds no FK from Purchase Orders, GRNs, Inventory,
  // Assets, Repairs or anything else. Those domains store opaque, unvalidated
  // supplier strings (including non-ObjectId values such as 'S' or 'Vendor A'),
  // so a FK would reject rows the application already persists.
  const fks = await poolQuery(
    `SELECT conrelid::regclass::text AS tbl, conname, confrelid::regclass::text AS ref
     FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'public.suppliers'::regclass`
  );
  assert.deepStrictEqual(fks, [], "no table references suppliers");
});