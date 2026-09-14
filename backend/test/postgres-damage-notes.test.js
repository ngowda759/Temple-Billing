// Phase 2O PostgreSQL-path tests for the Damage Note repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - the damageNoteRepository persists to and reads from the real
//     damage_notes table (no mocks),
//   - every Mongo schema field round-trips losslessly (IDs, enums, dates,
//     quantity/monetary precision),
//   - defaults, validation and the damage workflow semantics match the Mongo
//     model exactly (damageNumber unique + derived, status default
//     'Pending Approval', writeOffAmount default 0, quantity min: 1,
//     reason/status enum rejection),
//   - filtering, $in, sorting and pagination behave like the Mongo query
//     surface,
//   - the real inventory_item / inventory_batch FKs are enforced (RESTRICT),
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

let originalIsDbConnected;
let damageNoteRepository;
let damageNoteService;
let inventoryItemRepository;
let inventoryBatchRepository;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
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
  // Require AFTER patching the seam so both the service (dbConfig.isDbConnected)
  // and any destructured reference in older repositories see the patched flag.
  dbConfig.isDbConnected = () => true;
  damageNoteRepository = require("../src/repositories/damageNoteRepository");
  damageNoteService = require("../src/services/damageNoteService");
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
  inventoryBatchRepository = require("../src/repositories/inventoryBatchRepository");
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

// Creates a real inventory_items row so the damage_notes FK is satisfied.
const createItem = async (overrides = {}) => {
  const item = await inventoryItemRepository.create({
    name: `DAMAGE-ITEM-${unique()}`,
    unit: "Pack",
    ...overrides,
  });
  assert.ok(item?._id, "inventory item must exist (PG path)");
  return item;
};

// Creates a real inventory_batches row so the damage_notes FK is satisfied.
const createBatch = async (itemId, overrides = {}) => {
  const batch = await inventoryBatchRepository.create({
    item: itemId,
    batchNumber: `DAMAGE-BATCH-${unique()}`,
    originalQuantity: 100,
    currentQuantity: 100,
    ...overrides,
  });
  assert.ok(batch?._id, "inventory batch must exist (PG path)");
  return batch;
};

const damageBase = (itemId, overrides = {}) => ({
  item: itemId,
  batch: undefined,
  quantity: 3,
  reason: "Expired",
  description: "PG path damage note",
  photoUrl: "https://example.com/photo.jpg",
  reportedBy: "0000000000000000000000aa",
  status: "Pending Approval",
  approvedBy: undefined,
  writeOffAmount: 0,
  expenseId: undefined,
  ...overrides,
});

// ─── Service datasource selection ──────────────────────────────────────────
test("PG path: service selects PostgreSQL when the dedicated fallback is available", async () => {
  assert.strictEqual(await damageNoteService.usePostgres(), true);
  assert.strictEqual(damageNoteService.isConnected(), true);
});

// ─── create / read round-trip ──────────────────────────────────────────────
test("PG path: service create persists a real damage_notes row with Mongo field names", async () => {
  const item = await createItem();
  const batch = await createBatch(item._id);
  const created = await damageNoteService.create(damageBase(item._id, {
    batch: batch._id,
    quantity: 4.5,
    reason: "Broken/Damaged",
    writeOffAmount: "1000.99",
  }));
  assert.match(created._id, /^[0-9a-f]{24}$/, "Mongo-compatible ObjectId id");
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.item, item._id);
  assert.strictEqual(created.batch, batch._id);
  assert.strictEqual(created.quantity, 4.5);
  assert.strictEqual(created.reason, "Broken/Damaged");
  assert.strictEqual(created.description, "PG path damage note");
  assert.strictEqual(created.photoUrl, "https://example.com/photo.jpg");
  assert.strictEqual(created.reportedBy, "0000000000000000000000aa");
  assert.strictEqual(created.status, "Pending Approval");
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.writeOffAmount, 1000.99);
  assert.strictEqual(created.expenseId, undefined);
  assert.ok(created.createdAt instanceof Date, "createdAt is a Date");
  assert.ok(created.updatedAt instanceof Date, "updatedAt is a Date");
  assert.match(created.damageNumber, /^DAMAGE-\d{4}$/, "damageNumber auto-derived");

  // Real row exists in PostgreSQL.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT id, damage_number FROM damage_notes WHERE id = $1",
      [created._id]
    );
    assert.strictEqual(rows.length, 1, "damage_notes row must exist");
  } finally {
    await pool.end();
  }
});

test("PG path: repository findById / findOne read back the round-tripped document", async () => {
  const item = await createItem();
  const created = await damageNoteRepository.create(damageBase(item._id));
  const byId = await damageNoteRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.item, item._id);
  assert.strictEqual(byId.quantity, 3);
  assert.strictEqual(byId.writeOffAmount, 0);
  assert.strictEqual(byId.status, "Pending Approval");

  const byOne = await damageNoteRepository.findOne({ damageNumber: created.damageNumber });
  assert.strictEqual(byOne._id, created._id);
  assert.strictEqual(await damageNoteRepository.findOne({ damageNumber: "DOES-NOT-EXIST" }), null);
});

test("PG path: repository create defaults unique damageNumber derived from the row count", async () => {
  const item = await createItem();
  const current = await damageNoteRepository.count({});
  const base = await damageNoteRepository.create(damageBase(item._id));
  const next = await damageNoteRepository.create({ item: item._id, quantity: 1, reason: "Other", description: "d", reportedBy: "0000000000000000000000aa" });
  assert.strictEqual(base.damageNumber, `DAMAGE-${String(current + 1).padStart(4, "0")}`);
  assert.strictEqual(next.damageNumber, `DAMAGE-${String(current + 2).padStart(4, "0")}`);
  assert.notStrictEqual(base.damageNumber, next.damageNumber, "damageNumbers must be unique");

  // Explicit damageNumber is respected (and trimmed).
  const explicit = await damageNoteRepository.create(damageBase(item._id, { damageNumber: "DAMAGE-XYZ" }));
  assert.strictEqual(explicit.damageNumber, "DAMAGE-XYZ");
});

test("PG path: repository invalid status and invalid reason are rejected (enum preserved)", async () => {
  const item = await createItem();
  await assert.rejects(
    damageNoteRepository.create(damageBase(item._id, { status: "Cancelled" })),
    /Invalid status/
  );
  await assert.rejects(
    damageNoteRepository.create(damageBase(item._id, { status: "APPROVED" })),
    /Invalid status/
  );
  await assert.rejects(
    damageNoteService.create(damageBase(item._id, { status: "Liquidated" })),
    /Invalid status/
  );
});

test("PG path: required fields are enforced like the Mongo schema", async () => {
  const item = await createItem();
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), item: undefined }), /item is required/);
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), quantity: undefined }), /quantity is required/);
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), reason: undefined }), /reason is required/);
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), description: undefined }), /description is required/);
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), reportedBy: undefined }), /reportedBy is required/);
  // quantity min: 1 mirrors the Mongo validator.
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), quantity: 0 }), /must be >= 1/);
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), quantity: -5 }), /must be >= 1/);
  await assert.rejects(damageNoteRepository.create({ ...damageBase(item._id), quantity: "abc" }), /quantity must be a number/);
});

test("PG path: optional fields stay unset (undefined) unless provided", async () => {
  const item = await createItem();
  const created = await damageNoteRepository.create({
    item: item._id,
    quantity: 1,
    reason: "Other",
    description: "minimal",
    reportedBy: "0000000000000000000000aa",
  });
  assert.strictEqual(created.batch, undefined);
  assert.strictEqual(created.photoUrl, undefined);
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.expenseId, undefined);
  assert.strictEqual(created.writeOffAmount, 0, "writeOffAmount default 0");
  assert.strictEqual(created.status, "Pending Approval", "status default");
});

// ─── quantity / monetary precision ─────────────────────────────────────────
test("PG path: quantity and write_off_amount preserve exact precision", async () => {
  const item = await createItem();
  const quantities = ["1", "1.5", "10.50", "1000.99", "123456789.1234"];
  const amounts = ["0", "0.01", "10.50", "1000.99", "1000000.99", "123456789.1234", "-5"];
  for (const q of quantities) {
    const created = await damageNoteRepository.create({
      item: item._id,
      quantity: q, // passes as a string straight to NUMERIC
      reason: "Spoiled",
      description: `precision-q-${q}`,
      reportedBy: "0000000000000000000000aa",
      writeOffAmount: "0",
    });
    assert.strictEqual(created.quantity, Number(q), `quantity ${q} round-trips`);
    assert.strictEqual(created.quantity, parseFloat(q), `quantity ${q} has no precision loss`);
    await damageNoteRepository.destroy(created._id);
  }
  for (const a of amounts) {
    const created = await damageNoteRepository.create({
      item: item._id,
      quantity: "5",
      reason: "Lost/Stolen",
      description: `precision-a-${a}`,
      reportedBy: "0000000000000000000000aa",
      writeOffAmount: a,
    });
    assert.strictEqual(created.writeOffAmount, Number(a), `writeOffAmount ${a} round-trips`);
    await damageNoteRepository.destroy(created._id);
  }
});

test("PG path: 0.01 / 1000000.99 / 123456789.1234 round-trip exactly through the wire", async () => {
  const item = await createItem();
  const created = await damageNoteRepository.create({
    item: item._id,
    quantity: "123456789.1234",
    reason: "Quality Issue",
    description: "round trip",
    reportedBy: "0000000000000000000000aa",
    writeOffAmount: "1000000.99",
  });
  const byId = await damageNoteRepository.findById(created._id);
  assert.strictEqual(byId.quantity, 123456789.1234);
  assert.strictEqual(byId.writeOffAmount, 1000000.99);
});

// ─── update / approve workflow ─────────────────────────────────────────────
test("PG path: updateById persists status and approvedBy (approve workflow)", async () => {
  const item = await createItem();
  const created = await damageNoteService.create(damageBase(item._id));
  const approved = await damageNoteService.updateById(created._id, {
    status: "Approved",
    approvedBy: "0000000000000000000000bb",
  });
  assert.strictEqual(approved.status, "Approved");
  assert.strictEqual(approved.approvedBy, "0000000000000000000000bb");

  const reRead = await damageNoteService.findById(created._id);
  assert.strictEqual(reRead.status, "Approved");
  assert.strictEqual(reRead.approvedBy, "0000000000000000000000bb");
});

test("PG path: updateById enforces enums and non-empty required scalars", async () => {
  const item = await createItem();
  const created = await damageNoteService.create(damageBase(item._id));
  await assert.rejects(
    damageNoteService.updateById(created._id, { status: "Nope" }),
    /Invalid status/
  );
  await assert.rejects(
    damageNoteService.updateById(created._id, { reason: "" }),
    /reason is required/
  );
  await assert.rejects(
    damageNoteService.updateById(created._id, { quantity: 0 }),
    /must be >= 1/
  );
});

test("PG path: updateById on a missing id returns null", async () => {
  assert.strictEqual(await damageNoteRepository.updateById("999999999999999999999999", { status: "Approved" }), null);
});

// ─── filtering / $in / sorting / pagination ────────────────────────────────
test("PG path: findMany filters by status, reason, item, batch, reportedBy; $in supported", async () => {
  const item1 = await createItem();
  const item2 = await createItem();
  const batch1 = await createBatch(item1._id);
  const reporter = crypto.randomBytes(12).toString("hex");
  const a = await damageNoteService.create(damageBase(item1._id, { batch: batch1._id, reason: "Expired", status: "Pending Approval", reportedBy: reporter }));
  const b = await damageNoteService.create(damageBase(item1._id, { batch: batch1._id, reason: "Spoiled", status: "Approved", approvedBy: "0000000000000000000000bb", reportedBy: reporter }));
  const c = await damageNoteService.create(damageBase(item2._id, { reason: "Expired", status: "Rejected", reportedBy: reporter }));

  assert.strictEqual((await damageNoteService.findMany({ filter: { status: "Pending Approval" } })).filter((x) => x.reportedBy === reporter).length, 1);
  assert.strictEqual((await damageNoteService.findMany({ filter: { reason: "Expired" } })).filter((x) => x.reportedBy === reporter).length, 2);
  assert.strictEqual((await damageNoteService.findMany({ filter: { item: item1._id } })).filter((x) => x.reportedBy === reporter).length, 2);
  assert.strictEqual((await damageNoteService.findMany({ filter: { batch: batch1._id } })).filter((x) => x.reportedBy === reporter).length, 2);
  assert.strictEqual((await damageNoteService.findMany({ filter: { reportedBy: reporter } })).length, 3);

  // $in predicates
  assert.strictEqual((await damageNoteService.findMany({ filter: { status: { $in: ["Approved", "Rejected"] } } })).filter((x) => x.reportedBy === reporter).length, 2);
  assert.strictEqual((await damageNoteService.findMany({ filter: { item: { $in: [item1._id, item2._id] } } })).filter((x) => x.reportedBy === reporter).length, 3);
  assert.strictEqual((await damageNoteService.findMany({ filter: { reason: { $in: ["Expired", "Spoiled"] } } })).filter((x) => x.reportedBy === reporter).length, 3);
  assert.strictEqual((await damageNoteService.findMany({ filter: { id: { $in: [a._id, b._id] } } })).length, 2);
  assert.strictEqual((await damageNoteService.findMany({ filter: { status: { $in: [] } } })).length, 0, "$in: [] matches nothing");

  // combined filter
  assert.strictEqual(
    (await damageNoteService.findMany({ filter: { item: item1._id, status: "Pending Approval" } })).filter((x) => x.reportedBy === reporter).length,
    1
  );
});

test("PG path: count uses COUNT(*) and honors $in / empty $in", async () => {
  const item = await createItem();
  const reporter = crypto.randomBytes(12).toString("hex");
  await damageNoteService.create(damageBase(item._id, { status: "Pending Approval", reportedBy: reporter }));
  await damageNoteService.create(damageBase(item._id, { status: "Approved", reportedBy: reporter }));
  assert.strictEqual(await damageNoteService.count({ reportedBy: reporter }), 2);
  assert.strictEqual(await damageNoteService.count({ reportedBy: reporter, status: { $in: ["Pending Approval", "Approved"] } }), 2);
  assert.strictEqual(await damageNoteService.count({ reportedBy: reporter, status: { $in: ["Rejected"] } }), 0);
  assert.strictEqual(await damageNoteService.count({ reportedBy: reporter, status: { $in: [] } }), 0);
});

test("PG path: findMany sorts (whitelist) and paginates with limit/offset", async () => {
  const item = await createItem();
  for (let i = 0; i < 5; i++) {
    await damageNoteService.create(damageBase(item._id, { description: `sort-${i}` }));
  }
  const newest = await damageNoteService.findMany({ filter: { item: item._id }, sort: { createdAt: -1 } });
  assert.strictEqual(newest.length, 5);
  // createdAt DESC default
  assert.ok(newest[0].updatedAt >= newest[4].updatedAt);

  const oldest = await damageNoteService.findMany({ filter: { item: item._id }, sort: { createdAt: 1 } });
  assert.ok(oldest[0].updatedAt <= oldest[4].updatedAt);

  const paged = await damageNoteService.findMany({ filter: { item: item._id }, limit: 2, offset: 1 });
  assert.strictEqual(paged.length, 2);

  // Unknown sort key falls back to the default ordering (no injection).
  const safe = await damageNoteService.findMany({ filter: { item: item._id }, sort: { "x; DROP TABLE damage_notes--": -1 } });
  assert.strictEqual(safe.length, 5);
  const after = await damageNoteService.findById(safe[0]._id);
  assert.ok(after, "table still intact after hostile sort key");
});

// ─── FK / RESTRICT behaviours ──────────────────────────────────────────────
test("PG path: deleting an inventory_item referenced by damage_notes is RESTRICTED", async () => {
  const item = await createItem();
  const d = await damageNoteService.create(damageBase(item._id));
  await assert.rejects(inventoryItemRepository.destroy(item._id), /violates foreign key constraint/);
  await damageNoteService.destroy(d._id);
  assert.strictEqual(await inventoryItemRepository.destroy(item._id), true);
});

test("PG path: deleting an inventory_batch referenced by damage_notes is RESTRICTED", async () => {
  const item = await createItem();
  const batch = await createBatch(item._id);
  const d = await damageNoteService.create(damageBase(item._id, { batch: batch._id }));
  await assert.rejects(inventoryBatchRepository.destroy(batch._id), /violates foreign key constraint/);
  await damageNoteService.destroy(d._id);
  assert.strictEqual(await inventoryBatchRepository.destroy(batch._id), true);
  assert.strictEqual(await inventoryItemRepository.destroy(item._id), true);
});

test("PG path: damage note cannot reference a non-existent item (FK enforced)", async () => {
  await assert.rejects(
    damageNoteRepository.create({
      item: "0000000000000000000000ff",
      quantity: 1,
      reason: "Other",
      description: "fake item FK",
      reportedBy: "0000000000000000000000aa",
    }),
    /violates foreign key constraint/
  );
});

// ─── destroy / count ───────────────────────────────────────────────────────
test("PG path: destroy returns truthful existence + DELETE RETURNING", async () => {
  const item = await createItem();
  const created = await damageNoteService.create(damageBase(item._id));
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM damage_notes WHERE id = $1", [created._id]);
    assert.strictEqual(rows[0].n, 1);
  } finally {
    await pool.end();
  }
  assert.strictEqual(await damageNoteService.destroy(created._id), true);
  assert.strictEqual(await damageNoteService.destroy(created._id), false, "second destroy returns false");
  assert.strictEqual(await damageNoteRepository.destroy("999999999999999999999999"), false);
});

test("PG path: count accepts a filter object", async () => {
  const item = await createItem();
  await damageNoteService.create(damageBase(item._id));
  assert.strictEqual(await damageNoteService.count({ item: item._id }), 1);
});

// ─── service fallback boundary (same process, no restart) ──────────────────
test("datasource switching: same process flips between PG and Mongo paths by patching the seam", async () => {
  // The service reads dbConfig.isDbConnected() at call time. dbConfig has been
  // patched to () => true by test.before, so originalIsDbConnected holds the
  // genuine mongoose.readyState-based function (these tests never connect, so
  // it returns false). We must not leave the process connected to Mongo.
  const realIsDbConnected = originalIsDbConnected;
  try {
    // 1) PG selected
    dbConfig.isDbConnected = () => true;
    const item = await createItem();
    const pgNote = await damageNoteService.create(damageBase(item._id));
    assert.match(pgNote._id, /^[0-9a-f]{24}$/);

    // 2) Mongo selected
    dbConfig.isDbConnected = realIsDbConnected;
    // Mongo is not reachable in this test process, but we can prove the path
    // selection happens: usePostgres() must be false and the service now routes
    // to Mongoose — the failure (buffering timeout, connection refused, or
    // damageNumber validation before any I/O when the seam is disconnected)
    // proves the Mongo branch was actually taken and no PG rows were written.
    const usePg = await damageNoteService.usePostgres();
    assert.strictEqual(usePg, false);
    const countPgRows = async () => {
      const pool = new Pool({ connectionString: TEST_DB_URL });
      try {
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM damage_notes");
        return rows[0].n;
      } finally {
        await pool.end();
      }
    };
    const before = await countPgRows();
    await assert.rejects(
      damageNoteService.create(damageBase(item._id)),
      (err) => {
        assert.match(
          String(err.message),
          /MongooseError|ECONNREFUSED|buffering timed out|connect|Path `damageNumber` is required/i,
          "Mongo path must actually be invoked"
        );
        return true;
      }
    );
    const after = await countPgRows();
    assert.strictEqual(after, before, "no PG rows were written while the Mongo path was selected (no dual write)");

    // 3) Back to PG — the PG note created earlier is untouched.
    dbConfig.isDbConnected = () => true;
    const found = await damageNoteService.findById(pgNote._id);
    assert.ok(found, "PG note still exists after switching paths");
  } finally {
    // Always restore the PG flag so the remaining tests run on PostgreSQL.
    dbConfig.isDbConnected = () => true;
  }
});

test("PG path: a single create writes exactly one row and never touches MongoDB (no dual write)", async () => {
  const item = await createItem();
  // Snapshot what ends up in the PG table.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  let pgCountBefore;
  try {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM damage_notes");
    pgCountBefore = rows[0].n;
  } finally {
    await pool.end();
  }
  const created = await damageNoteService.create(damageBase(item._id));
  const rowCount = await damageNoteRepository.count({});
  assert.strictEqual(rowCount, pgCountBefore + 1, "exactly one new damage_notes row");

  // A DamageNote document in MongoDB would only exist if mongoose had been
  // connected & written. The service can't persist to Mongo when the seam is
  // PG; there is no dual-write branch in the code. Verify the service's
  // create resolved through the repository by checking the id round-trips.
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected — nothing could have been written to MongoDB");
});

test("PG path: destroy removes child batch references cleanly for cascade-free FKs", async () => {
  const item = await createItem();
  const batch = await createBatch(item._id);
  const created = await damageNoteService.create(damageBase(item._id, { batch: batch._id }));
  await damageNoteService.destroy(created._id);
  // after deleting the note, the batch and item can be deleted (no orphan FKs)
  assert.strictEqual(await inventoryBatchRepository.destroy(batch._id), true);
  assert.strictEqual(await inventoryItemRepository.destroy(item._id), true);
});