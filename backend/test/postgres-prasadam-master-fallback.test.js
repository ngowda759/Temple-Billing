// Phase 2Z Mongo/Mongoose fallback tests for the Prasadam master repository
// and service.
//
// These tests pin the datasource seam to "disconnected" so the repository and
// service must select the existing Mongoose path. They verify that:
//   - the service reports MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - every repository operation routes to the exact Mongoose call the
//     controllers used before this phase,
//   - the fallback needs no PostgreSQL table at all,
//   - a single write reaches exactly one datasource (no dual writes),
//   - the datasource seam is read at call time, so flipping it in-process
//     takes effect on already-loaded modules (a require-time destructure would
//     fail the flip assertions).
//
// Named "-master-" so it cannot be confused with postgres-prasadam-fallback
// .test.js, which covers the already-migrated Prasadam ORDER ledger (Phase 2G).
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const dbConfig = require("../src/config/db");
const Prasadam = require("../src/models/Prasadam");
const { closePostgres } = require("../src/config/postgres");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");
const nameFor = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let prasadamService;
let prasadamRepository;

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

// The datasource seam: production reads mongoose.connection.readyState, the
// tests pin the function instead so the fallback branch is deterministic.
const pinMongoFallback = () => {
  dbConfig.isDbConnected = () => false;
};

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  pinMongoFallback();
  // The fallback path must not need the prasadams table, but the "no PostgreSQL
  // row was written" assertions below do, so the schema is ensured up front.
  runMigrate();
  prasadamService = require("../src/services/prasadamService");
  prasadamRepository = require("../src/repositories/prasadamRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const withStubs = async (stubs, fn) => {
  const originals = {};
  for (const [name, impl] of Object.entries(stubs)) {
    originals[name] = Prasadam[name];
    Prasadam[name] = impl;
  }
  try {
    return await fn();
  } finally {
    Object.assign(Prasadam, originals);
  }
};

// ─── Datasource selection ──────────────────────────────────────────────────
test("prasadams master fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(prasadamService.isConnected(), false);
  assert.strictEqual(await prasadamService.usePostgres(), false);
});

test("prasadams master fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await prasadamService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
  }
});

// ─── Every operation routes to Mongoose ────────────────────────────────────
test("prasadams master fallback: create routes to Prasadam.create", async () => {
  const payload = { name: nameFor("FbCreate"), price: 42, availableQuantity: 3, minimumStock: 1 };
  let received = null;
  await withStubs(
    { create: async (data) => { received = data; return { ...data, _id: "mongo1" }; } },
    async () => {
      const doc = await prasadamService.create(payload);
      assert.strictEqual(doc._id, "mongo1");
    }
  );
  assert.deepStrictEqual(received, payload);
});

test("prasadams master fallback: findMany routes to Prasadam.find().sort()", async () => {
  let usedSort = null;
  await withStubs(
    {
      find: (filter) => {
        assert.deepStrictEqual(filter, {});
        return { sort: (sort) => { usedSort = sort; return Promise.resolve([]); } };
      },
    },
    async () => {
      await prasadamService.findMany({ sort: { name: 1 } });
    }
  );
  assert.deepStrictEqual(usedSort, { name: 1 });
});

test("prasadams master fallback: findById routes to Prasadam.findById", async () => {
  let arg = null;
  await withStubs(
    { findById: async (id) => { arg = id; return null; } },
    async () => {
      assert.strictEqual(await prasadamService.findById("abc"), null);
    }
  );
  assert.strictEqual(arg, "abc");
});

test("prasadams master fallback: the case-insensitive lookup stays a /^name$/i regex", async () => {
  let filter = null;
  await withStubs(
    { findOne: async (f) => { filter = f; return null; } },
    async () => {
      await prasadamService.findOneByName("Laddu Prasadam", { caseInsensitive: true });
    }
  );
  assert.ok(filter.name.$regex instanceof RegExp);
  assert.strictEqual(filter.name.$regex.source, "^Laddu Prasadam$");
  assert.strictEqual(filter.name.$regex.flags, "i");
});

test("prasadams master fallback: the exact lookup stays findOne({ name })", async () => {
  let filter = null;
  await withStubs(
    { findOne: async (f) => { filter = f; return null; } },
    async () => {
      await prasadamService.findOneByName("Laddu Prasadam", { caseInsensitive: false });
    }
  );
  assert.deepStrictEqual(filter, { name: "Laddu Prasadam" });
});

test("prasadams master fallback: updateById routes to findByIdAndUpdate without runValidators", async () => {
  let args = null;
  await withStubs(
    { findByIdAndUpdate: async (...a) => { args = a; return { _id: a[0] }; } },
    async () => {
      await prasadamService.updateById("id1", { price: 5 });
    }
  );
  assert.strictEqual(args[0], "id1");
  assert.deepStrictEqual(args[1], { price: 5 });
  // prasadamController.updatePrasadam does not pass runValidators today.
  assert.deepStrictEqual(args[2], { new: true });
});

test("prasadams master fallback: the restock/order movement is findById → save()", async () => {
  const saved = [];
  await withStubs(
    {
      findById: async () => ({
        availableQuantity: 10,
        save: async function () { saved.push(this.availableQuantity); return this; },
      }),
    },
    async () => {
      const doc = await prasadamService.incrementById("id1", 5);
      assert.strictEqual(doc.availableQuantity, 15);
    }
  );
  assert.deepStrictEqual(saved, [15]);

  // The clamped variant mirrors Math.max(0, …).
  await withStubs(
    {
      findById: async () => ({
        availableQuantity: 3,
        save: async function () { return this; },
      }),
    },
    async () => {
      const doc = await prasadamService.incrementById("id1", -10, { clampAtZero: true });
      assert.strictEqual(doc.availableQuantity, 0);
    }
  );
});

test("prasadams master fallback: a movement on a missing document is a no-op", async () => {
  await withStubs(
    { findById: async () => null },
    async () => {
      assert.strictEqual(await prasadamService.incrementById("missing", 5), null);
    }
  );
});

test("prasadams master fallback: destroy routes to findByIdAndDelete", async () => {
  let arg = null;
  await withStubs(
    { findByIdAndDelete: async (id) => { arg = id; return { _id: id }; } },
    async () => {
      const doc = await prasadamService.destroy("del1");
      assert.strictEqual(doc._id, "del1");
    }
  );
  assert.strictEqual(arg, "del1");
});

// ─── The fallback needs no PostgreSQL table ────────────────────────────────
test("prasadams master fallback: operations succeed without the prasadams table", async () => {
  await pgQuery("DROP TABLE IF EXISTS prasadams CASCADE");
  // Also forget the migration so the restore below actually recreates the table
  // (migrate is idempotent and would otherwise report nothing pending).
  await pgQuery("DELETE FROM schema_migrations WHERE name = '027_create_prasadams.sql'");
  try {
    await withStubs(
      {
        create: async (data) => ({ ...data, _id: "m1" }),
        findById: async (id) => ({ _id: id, name: "n", price: 1, availableQuantity: 0, minimumStock: 0 }),
        find: () => ({ sort: () => Promise.resolve([]) }),
      },
      async () => {
        const created = await prasadamService.create({ name: nameFor("NoTable"), price: 1 });
        assert.strictEqual(created._id, "m1");
        const found = await prasadamService.findById("m1");
        assert.strictEqual(found._id, "m1");
        const list = await prasadamService.findMany({ sort: { name: 1 } });
        assert.deepStrictEqual(list, []);
      }
    );
  } finally {
    // Restore the schema for the remaining tests.
    runMigrate();
  }
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("prasadams master fallback: no MongoDB operation writes a PostgreSQL row", async () => {
  const name = nameFor("FbNoDual");

  await withStubs(
    {
      create: async (data) => ({ ...data, _id: unique() }),
      findByIdAndUpdate: async (id, updates) => ({ _id: id, ...updates }),
      findByIdAndDelete: async (id) => ({ _id: id }),
    },
    async () => {
      const created = await prasadamService.create({ name, price: 7, availableQuantity: 1, minimumStock: 0 });
      await prasadamService.updateById(created._id, { price: 8 });
      await prasadamService.destroy(created._id);
    }
  );

  // Nothing reached PostgreSQL: the fallback never opens the PG path at all.
  const rows = await pgQuery("SELECT id FROM prasadams WHERE name = $1", [name]);
  assert.strictEqual(rows.length, 0, "the Mongo fallback must not write PostgreSQL");
});

// ─── Dynamic datasource switching ──────────────────────────────────────────
test("prasadams master: the datasource is read at call time, not at module load", async () => {
  // The modules are already loaded above. Flipping the seam now must take
  // effect immediately — a require-time destructure would keep reporting false.
  assert.strictEqual(await prasadamService.usePostgres(), false);

  dbConfig.isDbConnected = () => true;
  try {
    assert.strictEqual(prasadamService.isConnected(), true);
    assert.strictEqual(await prasadamService.usePostgres(), true);
  } finally {
    pinMongoFallback();
  }

  // And back again, in the same process, with no reload.
  assert.strictEqual(await prasadamService.usePostgres(), false);
});

test("prasadams master: a full PostgreSQL → MongoDB → PostgreSQL switch round-trip works in one process", async () => {
  const name = nameFor("Switch");

  // 1) PostgreSQL.
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await prasadamService.usePostgres(), true);
  const inPg = await prasadamService.create({ name, price: 11, availableQuantity: 2, minimumStock: 0 });
  const pgRows = await pgQuery("SELECT id FROM prasadams WHERE id = $1", [inPg._id]);
  assert.strictEqual(pgRows.length, 1);

  // 2) MongoDB fallback.
  pinMongoFallback();
  assert.strictEqual(await prasadamService.usePostgres(), false);
  const mongoId = unique();
  let mongoTouched = false;
  await withStubs(
    {
      create: async (data) => { mongoTouched = true; return { ...data, _id: mongoId }; },
      findById: async (id) => (id === mongoId ? { _id: mongoId, name, price: 11, availableQuantity: 2, minimumStock: 0 } : null),
    },
    async () => {
      const doc = await prasadamService.create({ name: `${name}-mongo`, price: 11, availableQuantity: 2, minimumStock: 0 });
      assert.strictEqual(doc._id, mongoId);
      const found = await prasadamService.findById(mongoId);
      assert.strictEqual(found._id, mongoId);
    }
  );
  assert.strictEqual(mongoTouched, true, "the Mongoose path must be used while the seam is disconnected");
  // The Mongo write must not have created a PostgreSQL row for that name.
  const notInPg = await pgQuery("SELECT id FROM prasadams WHERE name = $1", [`${name}-mongo`]);
  assert.strictEqual(notInPg.length, 0, "the Mongo fallback must not write PostgreSQL");

  // 3) Back to PostgreSQL, no restart.
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await prasadamService.usePostgres(), true);
  const afterSwitch = await prasadamService.findById(inPg._id);
  assert.ok(afterSwitch, "the earlier PostgreSQL row is still readable after the round-trip");
  assert.strictEqual(afterSwitch.name, name);
});
