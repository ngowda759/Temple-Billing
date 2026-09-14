// Phase 2O fallback tests.
//
// The DamageNote persistence layer is additive and entity-scoped:
//
//   DamageNote Service
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    damageNoteRepository → damage_notes
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose DamageNote model (unchanged Phase 1 Mongo path)
//
// These tests prove which database path is actually used, that the Mongo
// fallback genuinely invokes the Mongoose model (not a stub's return values),
// that no dual writes happen, and that the datasource seam can be switched
// without a fresh Node process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const DamageNote = require("../src/models/DamageNote");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let damageNoteService;
let damageNoteRepository;

const pinMongoFallback = () => {
  dbConfig.isDbConnected = () => false;
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  pinMongoFallback();
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;

  damageNoteService = require("../src/services/damageNoteService");
  damageNoteRepository = require("../src/repositories/damageNoteRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

// Re-runs the full migration chain so the damage_notes table exists in
// PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

/**
 * Replaces the DamageNote Mongoose model with call-tracking spies so tests can
 * prove the Mongo path is genuinely invoked on the fallback branch. The loaded
 * model object is the SAME reference the repository/service invoke at call
 * time, so swapping the methods is authoritative regardless of module load
 * order.
 */
const stubDamageCollection = () => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = "000000000000000000000001") => ({
    ...obj,
    _id: id,
    id,
    toObject: () => ({ ...obj, _id: id, id }),
    save: async function save() { calls.push(["save", this._id]); return this; },
  });
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    select: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
    catch: (reject) => execQuery().catch(reject),
  };

  const create = async (data) => {
    calls.push(["create", data]);
    const d = doc(data, data.id || "000000000000000000000001");
    saved.push(d);
    return d;
  };
  const findById = async (id) => {
    calls.push(["findById", id]);
    return saved.find((d) => String(d._id) === String(id)) || null;
  };
  const findOne = async (filter) => {
    calls.push(["findOne", filter]);
    if (filter && filter._id) {
      return saved.find((d) => String(d._id) === String(filter._id)) || null;
    }
    return saved[0] || null;
  };
  const find = (filter) => {
    calls.push(["find", filter]);
    return { ...chain, exec: async () => [] };
  };
  const findByIdAndUpdate = async (id, updates) => {
    calls.push(["findByIdAndUpdate", id, updates]);
    const existing = saved.find((d) => String(d._id) === String(id));
    if (!existing) return null;
    Object.assign(existing, updates);
    existing.id = existing._id;
    existing.save = async function save() { calls.push(["save", this._id]); return this; };
    return existing;
  };
  const findByIdAndDelete = async (id) => {
    calls.push(["findByIdAndDelete", id]);
    const idx = saved.findIndex((d) => String(d._id) === String(id));
    if (idx === -1) return null;
    const [removed] = saved.splice(idx, 1);
    return removed;
  };
  const countDocuments = async () => {
    calls.push(["countDocuments"]);
    return saved.length;
  };

  DamageNote.create = create;
  DamageNote.findById = findById;
  DamageNote.findOne = findOne;
  DamageNote.find = find;
  DamageNote.findByIdAndUpdate = findByIdAndUpdate;
  DamageNote.findByIdAndDelete = findByIdAndDelete;
  DamageNote.countDocuments = countDocuments;
  DamageNote.prototype.save = async function save() {
    calls.push(["self-save", this._id]);
    return this;
  };
  return { saved, calls };
};

const damageNoteBase = (overrides = {}) => ({
  item: "0000000000000000000000bb",
  quantity: 3,
  reason: "Expired",
  description: "fallback test damage note",
  reportedBy: "0000000000000000000000aa",
  status: "Pending Approval",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await damageNoteService.usePostgres(), false);
  assert.strictEqual(damageNoteService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await damageNoteService.usePostgres(), false);
});

test("fallback: repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved } = stubDamageCollection();
  const created = await damageNoteRepository.create(damageNoteBase());
  assert.strictEqual(saved.length, 1, "create routed to Mongoose model");
  assert.strictEqual(created.item, "0000000000000000000000bb");
  assert.strictEqual(created.status, "Pending Approval");
});

test("fallback: repository reads route to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  stubDamageCollection();
  await damageNoteRepository.findById("000000000000000000000099");
  const list = await damageNoteRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0, "stubbed query returns empty");
  assert.strictEqual(typeof (await damageNoteRepository.count({})), "number");
});

test("fallback: repository updates route to the Mongoose model (findByIdAndUpdate)", async () => {
  pinMongoFallback();
  const { saved } = stubDamageCollection();
  const created = await damageNoteRepository.create(damageNoteBase());
  assert.strictEqual(saved.length, 1);
  const updated = await damageNoteRepository.updateById(created._id, { status: "Approved" });
  assert.strictEqual(updated.status, "Approved", "update applied through Mongoose findByIdAndUpdate");
});

test("fallback: repository deletes route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved } = stubDamageCollection();
  const created = await damageNoteRepository.create(damageNoteBase());
  assert.strictEqual(await damageNoteRepository.destroy(created._id), true);
  assert.strictEqual(await damageNoteRepository.destroy(created._id), false);
  assert.strictEqual(saved.length, 0, "destroy removed the saved doc from the model store");
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the damage_notes table is missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubDamageCollection();
  const note = await damageNoteRepository.create(damageNoteBase({ description: "no-table" }));
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");
  assert.strictEqual(note.description, "no-table");

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS damage_notes CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await damageNoteRepository.create(damageNoteBase({ description: "still-works" }));
  assert.strictEqual(again.description, "still-works");
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM damage_notes");
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const before = await rowCount();
  const { saved } = stubDamageCollection();
  await damageNoteRepository.create(damageNoteBase());
  assert.strictEqual(saved.length, 1, "create went to the Mongo model");
  const after = await rowCount();
  assert.strictEqual(after, before, "no partial/duplicate PG row on Mongo fallback");
});

// ─── The service genuinely invokes the Mongoose model end-to-end ───────────
test("fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  pinMongoFallback();
  const { calls } = stubDamageCollection();

  const note = await damageNoteService.create(damageNoteBase({ description: "svc-fallback" }));
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(note.description, "svc-fallback");

  await damageNoteService.findById("000000000000000000000099");
  assert.ok(calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"), "findById routed to Mongoose findById spy");

  await damageNoteService.findOne({ id: "000000000000000000000099" });
  assert.ok(calls.some(([name, filter]) => name === "findOne"), "findOne routed to Mongoose findOne spy");

  await damageNoteService.findMany({ filter: { status: "Pending Approval" } });
  assert.ok(calls.some(([name, filter]) => name === "find" && filter && filter.status === "Pending Approval"), "findMany routed to Mongoose find spy");

  const updated = await damageNoteService.updateById("000000000000000000000001", { status: "Rejected" });
  assert.strictEqual(updated.status, "Rejected", "updateById applied through Mongoose findByIdAndUpdate");

  await damageNoteService.count({});
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose countDocuments spy");
  assert.strictEqual(await damageNoteService.destroy("000000000000000000000001"), true, "destroy routed to Mongoose findByIdAndDelete spy");
});

// ─── Datasource switching within one process ───────────────────────────────
test("fallback: seam can flip back to PostgreSQL within the same process", async () => {
  pinMongoFallback();
  stubDamageCollection();
  const created = await damageNoteRepository.create(damageNoteBase());
  assert.ok(created._id);

  // Flip the seam to connected — the SAME loaded repository module now routes
  // to PostgreSQL without a fresh Node process.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    assert.strictEqual(await damageNoteRepository.destroy(created._id), false, "the Mongo id does not exist in PG");
  } finally {
    pinMongoFallback();
  }
});