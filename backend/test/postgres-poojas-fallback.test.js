// Phase 2Y Mongo/Mongoose fallback tests for the Pooja repository and service.
//
// These tests pin the datasource seam to "disconnected" so the repository and
// service must select the existing Mongoose path. They verify that:
//   - the service reports MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - every operation routes to the exact Mongoose call the controllers used
//     before this phase,
//   - the fallback needs no PostgreSQL table at all,
//   - a single write reaches exactly one datasource (no dual writes),
//   - the datasource seam is read at call time, so flipping it in-process takes
//     effect on already-loaded modules (a require-time destructure would fail
//     the flip assertions), including PostgreSQL → MongoDB → PostgreSQL.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const dbConfig = require("../src/config/db");
const Pooja = require("../src/models/Pooja");
const PoojaMaterialRequirement = require("../src/models/PoojaMaterialRequirement");
const { closePostgres } = require("../src/config/postgres");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let poojaService;
let poojaMaterialRequirementService;
let poojaRepository;
let poojaMaterialRequirementRepository;

const unique = () => crypto.randomBytes(12).toString("hex");

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

// migrate.js is idempotent, so recreating dropped tables also needs the 026
// bookkeeping row removed — otherwise the DDL is skipped as "already applied".
const restorePoojaTables = async () => {
  await pgQuery("DROP TABLE IF EXISTS pooja_required_materials CASCADE");
  await pgQuery("DROP TABLE IF EXISTS poojas CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '026_create_poojas.sql'");
  runMigrate();
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
  runMigrate();
  poojaService = require("../src/services/poojaService");
  poojaMaterialRequirementService = require("../src/services/poojaMaterialRequirementService");
  poojaRepository = require("../src/repositories/poojaRepository");
  poojaMaterialRequirementRepository = require("../src/repositories/poojaMaterialRequirementRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const withStubs = async (model, stubs, fn) => {
  const originals = {};
  for (const [name, impl] of Object.entries(stubs)) {
    originals[name] = model[name];
    model[name] = impl;
  }
  try {
    return await fn();
  } finally {
    Object.assign(model, originals);
  }
};

// ─── Datasource selection ──────────────────────────────────────────────────
test("poojas fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(poojaService.isConnected(), false);
  assert.strictEqual(await poojaService.usePostgres(), false);
  assert.strictEqual(await poojaMaterialRequirementService.usePostgres(), false);
});

test("poojas fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await poojaService.usePostgres(), false);
    assert.strictEqual(await poojaMaterialRequirementService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
  }
});

// ─── Repository routing ────────────────────────────────────────────────────
test("poojas fallback: repository create routes to the Mongoose model", async () => {
  let received;
  await withStubs(Pooja, {
    create: async (payload) => { received = payload; return { _id: "m1", ...payload }; },
  }, async () => {
    const doc = await poojaRepository.create({ name: "Archana", price: 100, unknown: "drop" });
    assert.strictEqual(doc._id, "m1");
    assert.strictEqual(received.name, "Archana");
    // pickPersisted still narrows the payload on the Mongo branch, mirroring
    // the schema's strict mode.
    assert.strictEqual(received.unknown, undefined);
  });
});

test("poojas fallback: repository read/list/update/delete route to the Mongoose model", async () => {
  const calls = [];
  await withStubs(Pooja, {
    findById: async (id) => { calls.push(["findById", id]); return { _id: id }; },
    find: (filter) => {
      calls.push(["find", filter]);
      return { sort: () => ({ limit: () => ({ skip: async () => [] }) }) };
    },
    findOne: async (filter) => { calls.push(["findOne", filter]); return { _id: "one" }; },
    findByIdAndUpdate: async (id, updates, options) => {
      calls.push(["findByIdAndUpdate", id, updates, options]);
      return { _id: id, ...updates };
    },
    findByIdAndDelete: async (id) => { calls.push(["findByIdAndDelete", id]); return { _id: id }; },
    countDocuments: async (filter) => { calls.push(["countDocuments", filter]); return 7; },
  }, async () => {
    assert.strictEqual((await poojaRepository.findById("x"))._id, "x");
    await poojaRepository.findOne({ name: "N" });
    await poojaRepository.updateById("x", { price: 2 });
    assert.strictEqual((await poojaRepository.destroy("x"))._id, "x");
    assert.strictEqual(await poojaRepository.count({}), 7);

    const update = calls.find((c) => c[0] === "findByIdAndUpdate");
    assert.deepStrictEqual(update[3], { new: true, runValidators: true });
    assert.deepStrictEqual(calls.find((c) => c[0] === "findOne")[1], { name: "N" });
    assert.deepStrictEqual(calls.find((c) => c[0] === "countDocuments")[1], {});
  });
});

test("poojas fallback: the service routes every operation through the Mongoose model", async () => {
  const calls = [];
  await withStubs(Pooja, {
    create: async (payload) => { calls.push("create"); return { _id: "s1", ...payload }; },
    findById: async (id) => { calls.push("findById"); return { _id: id }; },
    findOne: async (filter) => { calls.push("findOne"); return { _id: "s2" }; },
    find: (filter) => {
      calls.push("find");
      return { sort: () => ({ limit: () => ({ skip: async () => [] }) }) };
    },
    findByIdAndUpdate: async (id, updates) => { calls.push("findByIdAndUpdate"); return { _id: id }; },
    findByIdAndDelete: async (id) => { calls.push("findByIdAndDelete"); return { _id: id }; },
    countDocuments: async () => { calls.push("countDocuments"); return 3; },
  }, async () => {
    await poojaService.create({ name: "S", price: 1 });
    await poojaService.findById("x");
    await poojaService.findOne({ name: "S" });
    await poojaService.findMany({ filter: {} });
    await poojaService.updateById("x", { price: 2 });
    await poojaService.destroy("x");
    await poojaService.count({});
  });
  assert.deepStrictEqual(calls, [
    "create", "findById", "findOne", "find", "findByIdAndUpdate", "findByIdAndDelete", "countDocuments",
  ]);
});

test("poojas fallback: the material-requirement service routes to its Mongoose model", async () => {
  const calls = [];
  await withStubs(PoojaMaterialRequirement, {
    find: (filter) => { calls.push("find"); return { sort: () => ({ limit: () => ({ skip: async () => [] }) }) }; },
    findOne: async (filter) => { calls.push("findOne"); return { _id: "r1", poojaName: filter.poojaName }; },
    findOneAndUpdate: async (filter, update, options) => {
      calls.push(["findOneAndUpdate", filter, update, options]);
      return { _id: "r1" };
    },
    countDocuments: async () => { calls.push("countDocuments"); return 2; },
  }, async () => {
    await poojaMaterialRequirementService.findMany({});
    const found = await poojaMaterialRequirementService.findOneByName("Ganapathi");
    assert.strictEqual(found._id, "r1");
    await poojaMaterialRequirementService.upsertByName("Ganapathi", [{ quantity: 1 }]);
    assert.strictEqual(await poojaMaterialRequirementService.count({}), 2);
  });

  // The upsert keeps the controller's trim() and its new/upsert options.
  const upsert = calls.find((c) => Array.isArray(c) && c[0] === "findOneAndUpdate");
  assert.deepStrictEqual(upsert[1], { poojaName: "Ganapathi" });
  assert.deepStrictEqual(upsert[2], { requiredMaterials: [{ quantity: 1 }] });
  assert.deepStrictEqual(upsert[3], { new: true, upsert: true });
});

test("poojas fallback: upsertByName trims the name and defaults a missing array, as the controller did", async () => {
  let received;
  await withStubs(PoojaMaterialRequirement, {
    findOneAndUpdate: async (filter, update) => { received = { filter, update }; return { _id: "r2" }; },
  }, async () => {
    await poojaMaterialRequirementRepository.upsertByName("  Ganapathi  ", undefined);
  });
  assert.deepStrictEqual(received.filter, { poojaName: "Ganapathi" });
  assert.deepStrictEqual(received.update, { requiredMaterials: [] });
});

// ─── Fallback needs no PostgreSQL schema ───────────────────────────────────
test("poojas fallback: the Mongo path works when the poojas table is missing", async () => {
  await pgQuery("DROP TABLE IF EXISTS pooja_required_materials CASCADE");
  await pgQuery("DROP TABLE IF EXISTS poojas CASCADE");
  try {
    await withStubs(Pooja, {
      create: async (payload) => ({ _id: "m2", ...payload }),
    }, async () => {
      const doc = await poojaRepository.create({ name: "T", price: 1 });
      assert.strictEqual(doc._id, "m2");
    });
  } finally {
    await restorePoojaTables();
  }
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("poojas fallback: the Mongo path leaves no rows in PostgreSQL", async () => {
  await restorePoojaTables();
  const before = await pgQuery("SELECT count(*)::int AS c FROM poojas");

  await withStubs(Pooja, {
    create: async (payload) => ({ _id: "m3", ...payload }),
  }, async () => {
    await poojaService.create({ name: "Only Mongo", price: 1 });
  });

  const after = await pgQuery("SELECT count(*)::int AS c FROM poojas");
  assert.strictEqual(after[0].c, before[0].c, "no PostgreSQL row was written on the Mongo path");
});

test("poojas fallback: a single write never reaches both datasources", async () => {
  let mongoWrites = 0;
  await withStubs(Pooja, {
    create: async (payload) => { mongoWrites += 1; return { _id: "m4", ...payload }; },
  }, async () => {
    await poojaService.create({ name: "One", price: 1 });
  });
  assert.strictEqual(mongoWrites, 1, "exactly one Mongo write");

  const rows = await pgQuery("SELECT count(*)::int AS c FROM poojas WHERE name = $1", ["One"]);
  assert.strictEqual(rows[0].c, 0, "the PostgreSQL table received no matching row");
});

// ─── Datasource seam is read at call time ──────────────────────────────────
test("poojas fallback: flipping the datasource seam in-process takes effect immediately", async () => {
  const wasConnected = dbConfig.isDbConnected;

  // Disconnected → Mongoose.
  dbConfig.isDbConnected = () => false;
  assert.strictEqual(await poojaService.usePostgres(), false);

  // Connected → PostgreSQL (the modules were already loaded above, so a
  // require-time destructure of isDbConnected would have frozen the old value).
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await poojaService.usePostgres(), true);

  // Back again — PostgreSQL → MongoDB → PostgreSQL in one process, no restart.
  dbConfig.isDbConnected = () => false;
  assert.strictEqual(await poojaService.usePostgres(), false);
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await poojaService.usePostgres(), true);

  dbConfig.isDbConnected = wasConnected;
});

test("poojas fallback: the repository itself honours the disconnected seam", async () => {
  const wasConnected = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  const originalFindById = Pooja.findById;
  let used = false;
  Pooja.findById = async () => {
    used = true;
    return { _id: "fallback" };
  };
  try {
    const doc = await poojaRepository.findById("fallback");
    assert.strictEqual(used, true, "the repository delegated to Mongoose");
    assert.strictEqual(doc._id, "fallback");
  } finally {
    Pooja.findById = originalFindById;
    dbConfig.isDbConnected = wasConnected;
  }
});

test("poojas fallback: switching datasource mid-process selects the matching write path", async () => {
  const wasConnected = dbConfig.isDbConnected;
  const originalCreate = Pooja.create;
  let mongoWrites = 0;
  Pooja.create = async (payload) => { mongoWrites += 1; return { _id: "mongo-created", ...payload }; };

  const mongoName = `SwitchMongo-${unique()}`;
  const pgName = `SwitchPg-${unique()}`;

  try {
    // PostgreSQL first.
    dbConfig.isDbConnected = () => true;
    const pgDoc = await poojaService.create({ name: pgName, price: 1 });
    assert.notStrictEqual(pgDoc._id, "mongo-created", "PostgreSQL handled the write");
    assert.strictEqual(mongoWrites, 0, "the PostgreSQL write did not reach Mongo");

    // Switch to MongoDB — the already-loaded service must notice.
    dbConfig.isDbConnected = () => false;
    const mongoDoc = await poojaService.create({ name: mongoName, price: 1 });
    assert.strictEqual(mongoDoc._id, "mongo-created", "MongoDB handled the write");
    assert.strictEqual(mongoWrites, 1);

    // Switch back to PostgreSQL — again without a restart.
    dbConfig.isDbConnected = () => true;
    const pgDoc2 = await poojaService.create({ name: `SwitchPg2-${unique()}`, price: 1 });
    assert.notStrictEqual(pgDoc2._id, "mongo-created");
    assert.strictEqual(mongoWrites, 1, "the second PostgreSQL write did not reach Mongo");
  } finally {
    Pooja.create = originalCreate;
    dbConfig.isDbConnected = wasConnected;
    await pgQuery("DELETE FROM poojas WHERE name = $1", [pgName]);
  }

  // The Mongo-path write left no PostgreSQL row.
  const rows = await pgQuery("SELECT count(*)::int AS c FROM poojas WHERE name = $1", [mongoName]);
  assert.strictEqual(rows[0].c, 0);
});

// ─── Validation on the fallback branch ─────────────────────────────────────
// The service validates before it reaches either datasource, so the fallback
// branch rejects the same payloads with the repository's messages — the same
// convention eventPersistenceService uses. Mongoose's own ValidationError
// wording differs ("name: Path `name` is required."), so the assertions pin the
// repository wording on both branches.
test("poojas fallback: create validation mirrors the PostgreSQL path on the fallback branch too", async () => {
  await assert.rejects(() => poojaService.create({ price: 1 }), /name is required/);
  await assert.rejects(() => poojaService.create({ name: "x" }), /price is required/);
  await assert.rejects(() => poojaService.create({ name: "x", price: 1, status: "Nope" }), /status/);
  await assert.rejects(() => poojaService.create({ name: "x", price: -1 }), /price/);
});
