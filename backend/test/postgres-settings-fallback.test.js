// Phase 2AA Mongo/Mongoose fallback tests for the AttendanceSetting and
// PriestSetting repositories and services.
//
// These tests pin the datasource seam to "disconnected" so the repositories and
// services must select the existing Mongoose path. They verify that:
//   - the services report MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - every operation routes to the exact Mongoose call the controllers used
//     before this phase,
//   - the fallback needs no PostgreSQL table at all,
//   - a single write reaches exactly one datasource (no dual writes),
//   - the datasource seam is read at call time, so flipping it in-process takes
//     effect on already-loaded modules (a require-time destructure would fail
//     the flip assertions),
//   - and a full PostgreSQL → MongoDB → PostgreSQL round-trip works without a
//     process restart.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const dbConfig = require("../src/config/db");
const AttendanceSetting = require("../src/models/AttendanceSetting");
const PriestSetting = require("../src/models/PriestSetting");
const { closePostgres } = require("../src/config/postgres");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(12).toString("hex");
const priestIdFor = (tag) => `${tag}-${unique()}`;

let originalIsDbConnected;
let attendanceSettingService;
let attendanceSettingRepository;
let priestSettingService;
let priestSettingRepository;

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
  // The fallback path must not need either table, but the "no PostgreSQL row
  // was written" assertions below do, so the schema is ensured up front.
  runMigrate();
  attendanceSettingService = require("../src/services/attendanceSettingService");
  attendanceSettingRepository = require("../src/repositories/attendanceSettingRepository");
  priestSettingService = require("../src/services/priestSettingService");
  priestSettingRepository = require("../src/repositories/priestSettingRepository");
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

// ── Datasource selection ──────────────────────────────────────────────────
test("settings fallback: the services select MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(attendanceSettingService.isConnected(), false);
  assert.strictEqual(await attendanceSettingService.usePostgres(), false);
  assert.strictEqual(priestSettingService.isConnected(), false);
  assert.strictEqual(await priestSettingService.usePostgres(), false);
});

test("settings fallback: the PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await attendanceSettingService.usePostgres(), false);
    assert.strictEqual(await priestSettingService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
  }
});

// ─── AttendanceSetting: every operation routes to Mongoose ─────────────────
test("settings fallback: attendance getOrCreate routes to findOne then create", async () => {
  const calls = [];
  await withStubs(AttendanceSetting, {
    findOne: async () => { calls.push("findOne"); return null; },
    create: async (data) => { calls.push(["create", data]); return { _id: "m1", ...data }; },
  }, async () => {
    const settings = await attendanceSettingService.getOrCreate();
    assert.strictEqual(settings._id, "m1");
  });
  assert.deepStrictEqual(calls, ["findOne", ["create", {}]]);
});

test("settings fallback: attendance getOrCreate reuses an existing document", async () => {
  let createCalled = false;
  await withStubs(AttendanceSetting, {
    findOne: async () => ({ _id: "existing", lateThreshold: 12 }),
    create: async () => { createCalled = true; return null; },
  }, async () => {
    const settings = await attendanceSettingService.getOrCreate();
    assert.strictEqual(settings._id, "existing");
  });
  assert.strictEqual(createCalled, false, "an existing singleton is never re-created");
});

test("settings fallback: attendance findOne and findById route to the model", async () => {
  let byId = null;
  await withStubs(AttendanceSetting, {
    findOne: async () => ({ _id: "one" }),
    findById: async (id) => { byId = id; return { _id: id }; },
  }, async () => {
    assert.strictEqual((await attendanceSettingService.findOne())._id, "one");
    assert.strictEqual((await attendanceSettingService.findById("abc"))._id, "abc");
  });
  assert.strictEqual(byId, "abc");
});

test("settings fallback: attendance updateSettings is findOne → assign → save", async () => {
  const saved = [];
  const doc = {
    _id: "s1",
    templeLatitude: 1,
    templeLongitude: 2,
    allowedRadius: 3,
    lateThreshold: 4,
    earlyCheckInWindow: 5,
    save: async function () { saved.push({ ...this }); return this; },
  };
  await withStubs(AttendanceSetting, {
    findOne: async () => doc,
    create: async () => { throw new Error("must not create when the singleton exists"); },
  }, async () => {
    const updated = await attendanceSettingService.updateSettings({ lateThreshold: 30 });
    assert.strictEqual(updated.lateThreshold, 30);
    assert.strictEqual(updated.allowedRadius, 3, "an unspecified field keeps its value");
  });
  assert.strictEqual(saved.length, 1, "save() is called exactly once");
  assert.strictEqual(saved[0].lateThreshold, 30);
  assert.strictEqual(saved[0].templeLatitude, 1);
});

test("settings fallback: attendance updateSettings creates from the body when absent", async () => {
  let received = null;
  await withStubs(AttendanceSetting, {
    findOne: async () => null,
    create: async (data) => { received = data; return { _id: "new", ...data }; },
  }, async () => {
    const settings = await attendanceSettingService.updateSettings({ lateThreshold: 9 });
    assert.strictEqual(settings._id, "new");
  });
  assert.deepStrictEqual(received, { lateThreshold: 9 });
});

test("settings fallback: the repository's attendance reads and writes stay on Mongoose", async () => {
  await withStubs(AttendanceSetting, {
    findOne: async () => ({ _id: "r1" }),
    findById: async (id) => ({ _id: id }),
    create: async (data) => ({ _id: "r2", ...data }),
    findByIdAndUpdate: async (id, updates, options) => ({ _id: id, ...updates, options }),
  }, async () => {
    assert.strictEqual((await attendanceSettingRepository.findOne())._id, "r1");
    assert.strictEqual((await attendanceSettingRepository.findOneOrCreate())._id, "r1");
    assert.strictEqual((await attendanceSettingRepository.findById("x"))._id, "x");
    const created = await attendanceSettingRepository.create({ lateThreshold: 8 });
    assert.strictEqual(created._id, "r2");
    const patched = await attendanceSettingRepository.updateById("x", { lateThreshold: 3 });
    assert.strictEqual(patched.lateThreshold, 3);
    assert.deepStrictEqual(patched.options, { new: true });
  });
});

// ─── PriestSetting: every operation routes to Mongoose ─────────────────────
test("settings fallback: priest getOrCreate routes to findOne({ priestId }) then create", async () => {
  const calls = [];
  await withStubs(PriestSetting, {
    findOne: async (filter) => { calls.push(["findOne", filter]); return null; },
    create: async (data) => { calls.push(["create", data]); return { _id: "p1", ...data }; },
  }, async () => {
    const settings = await priestSettingService.getOrCreate("emp1");
    assert.strictEqual(settings._id, "p1");
  });
  assert.deepStrictEqual(calls, [
    ["findOne", { priestId: "emp1" }],
    ["create", { priestId: "emp1" }],
  ]);
});

test("settings fallback: priest getOrCreate reuses an existing document", async () => {
  let createCalled = false;
  await withStubs(PriestSetting, {
    findOne: async () => ({ _id: "existing", priestId: "emp1" }),
    create: async () => { createCalled = true; return null; },
  }, async () => {
    assert.strictEqual((await priestSettingService.getOrCreate("emp1"))._id, "existing");
  });
  assert.strictEqual(createCalled, false);
});

test("settings fallback: priest updateSettings is findOne → assign → save", async () => {
  const saved = [];
  const doc = {
    _id: "p2",
    priestId: "emp2",
    smsNotifications: true,
    dutyReminders: true,
    calendarWidget: true,
    agamaReferenceModule: false,
    save: async function () { saved.push({ ...this }); return this; },
  };
  await withStubs(PriestSetting, {
    findOne: async () => doc,
  }, async () => {
    const updated = await priestSettingService.updateSettings("emp2", { smsNotifications: false });
    assert.strictEqual(updated.smsNotifications, false);
    assert.strictEqual(updated.dutyReminders, true, "an omitted toggle keeps its value");
  });
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].smsNotifications, false);
});

test("settings fallback: priest updateSettings builds a new document when absent", async () => {
  // Mirrors priestController: `new PriestSetting({ priestId })` then assign then
  // save(), so an absent document is persisted by save() rather than create().
  const constructed = [];
  let savedOnce = false;
  function FakePriestSetting(data) {
    Object.assign(this, {
      smsNotifications: true,
      dutyReminders: true,
      calendarWidget: true,
      agamaReferenceModule: false,
    }, data);
    constructed.push(this);
  }
  FakePriestSetting.findOne = async () => null;
  FakePriestSetting.create = async () => { throw new Error("the lazy branch must not call create"); };
  FakePriestSetting.findById = async () => null;
  FakePriestSetting.findByIdAndUpdate = async () => null;
  FakePriestSetting.prototype.save = async function () { savedOnce = true; return this; };

  // Swap the model module binding the service closes over with the fake, so the
  // lazy-create branch is exercised for real.
  const modelPath = require.resolve("../src/models/PriestSetting");
  const servicePath = require.resolve("../src/services/priestSettingService");
  const originalModel = require.cache[modelPath].exports;
  const originalService = require.cache[servicePath].exports;
  try {
    require.cache[modelPath].exports = FakePriestSetting;
    delete require.cache[servicePath];
    const freshService = require("../src/services/priestSettingService");
    // The seam is pinned to disconnected by test.before, so this is the
    // Mongoose branch.
    const doc = await freshService.updateSettings("emp3", { calendarWidget: false });

    assert.strictEqual(constructed.length, 1, "exactly one document is constructed");
    assert.strictEqual(doc.priestId, "emp3");
    assert.strictEqual(doc.calendarWidget, false);
    assert.strictEqual(doc.smsNotifications, true, "the other toggles keep their defaults");
    assert.strictEqual(savedOnce, true, "save() persists the built document");
  } finally {
    require.cache[modelPath].exports = originalModel;
    require.cache[servicePath].exports = originalService;
  }
});

test("settings fallback: the repository's priest reads and writes stay on Mongoose", async () => {
  await withStubs(PriestSetting, {
    findOne: async (filter) => ({ _id: "r1", priestId: filter.priestId }),
    findById: async (id) => ({ _id: id }),
    create: async (data) => ({ _id: "r2", ...data }),
    findByIdAndUpdate: async (id, updates, options) => ({ _id: id, ...updates, options }),
  }, async () => {
    assert.strictEqual((await priestSettingRepository.findOne({ priestId: "e" })).priestId, "e");
    assert.strictEqual((await priestSettingRepository.findOneOrCreate("e"))._id, "r1");
    assert.strictEqual((await priestSettingRepository.findById("y"))._id, "y");
    assert.strictEqual((await priestSettingRepository.create({ priestId: "e2" }))._id, "r2");
    const patched = await priestSettingRepository.updateById("y", { dutyReminders: false });
    assert.strictEqual(patched.dutyReminders, false);
    assert.deepStrictEqual(patched.options, { new: true });
  });
});

test("settings fallback: the repository preserves false rather than dropping it", async () => {
  // A `false` toggle must be sent to Mongoose; treating it as "absent" would
  // silently ignore the caller's intent.
  let received = null;
  await withStubs(PriestSetting, {
    findByIdAndUpdate: async (id, updates) => { received = updates; return { _id: id, ...updates }; },
  }, async () => {
    await priestSettingRepository.updateById("id1", { smsNotifications: false, dutyReminders: undefined });
  });
  assert.deepStrictEqual(received, { smsNotifications: false });
});

// ─── The fallback needs no PostgreSQL table ────────────────────────────────
test("settings fallback: operations succeed without the settings tables", async () => {
  // The fallback must not depend on the PostgreSQL schema at all. Rather than
  // dropping the shared tables (which would race other test files under
  // --test-concurrency), the PG query seam is made to fail loudly: any attempt
  // to reach PostgreSQL from the fallback path is a hard error.
  const postgresConfig = require("../src/config/postgres");
  const originalQuery = postgresConfig.query;
  postgresConfig.query = async () => {
    throw new Error("the MongoDB fallback must not query PostgreSQL");
  };
  try {
    await withStubs(AttendanceSetting, {
      findOne: async () => ({ _id: "nt1", lateThreshold: 15 }),
    }, async () => {
      assert.strictEqual((await attendanceSettingService.getOrCreate())._id, "nt1");
    });
    await withStubs(PriestSetting, {
      findOne: async () => ({ _id: "nt2", priestId: "e" }),
    }, async () => {
      assert.strictEqual((await priestSettingService.getOrCreate("e"))._id, "nt2");
    });
  } finally {
    postgresConfig.query = originalQuery;
  }
});

// ─── No dual writes ────────────────────────────────────────────────────────
test("settings fallback: no MongoDB operation writes a PostgreSQL row", async () => {
  const priestId = priestIdFor("FbNoDual");
  const attendanceMarker = unique();

  await withStubs(AttendanceSetting, {
    findOne: async () => null,
    create: async (data) => ({ _id: attendanceMarker, ...data }),
  }, async () => {
    await attendanceSettingService.getOrCreate();
  });
  await withStubs(PriestSetting, {
    findOne: async () => null,
    create: async (data) => ({ _id: unique(), ...data }),
  }, async () => {
    await priestSettingService.getOrCreate(priestId);
  });

  // Nothing reached PostgreSQL: the fallback never opens the PG path at all.
  const attRows = await pgQuery("SELECT id FROM attendance_settings WHERE id = $1", [attendanceMarker]);
  assert.strictEqual(attRows.length, 0, "the Mongo fallback must not write attendance_settings");
  const prRows = await pgQuery("SELECT id FROM priest_settings WHERE priest_id = $1", [priestId]);
  assert.strictEqual(prRows.length, 0, "the Mongo fallback must not write priest_settings");
});

// ─── Dynamic datasource switching ──────────────────────────────────────────
test("settings: a full PostgreSQL → MongoDB → PostgreSQL switch round-trip works in one process", async () => {
  const priestId = priestIdFor("Switch");

  // 1) PostgreSQL.
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await attendanceSettingService.usePostgres(), true);
  assert.strictEqual(await priestSettingService.usePostgres(), true);
  await pgQuery("DELETE FROM attendance_settings");
  const inPg = await priestSettingService.create({ priestId, smsNotifications: false });
  const pgRows = await pgQuery("SELECT id FROM priest_settings WHERE id = $1", [inPg._id]);
  assert.strictEqual(pgRows.length, 1);

  // 2) MongoDB fallback.
  pinMongoFallback();
  assert.strictEqual(await priestSettingService.usePostgres(), false);
  const mongoId = unique();
  let mongoTouched = false;
  await withStubs(PriestSetting, {
    findOne: async () => null,
    create: async (data) => { mongoTouched = true; return { _id: mongoId, ...data }; },
  }, async () => {
    const viaMongo = await priestSettingService.getOrCreate(priestIdFor("SwitchMongo"));
    assert.strictEqual(viaMongo._id, mongoId);
  });
  assert.strictEqual(mongoTouched, true, "the Mongoose path must be used while the seam is disconnected");

  // The Mongo write must not have created a PostgreSQL row for that priest.
  const notInPg = await pgQuery("SELECT id FROM priest_settings WHERE id = $1", [mongoId]);
  assert.strictEqual(notInPg.length, 0, "the Mongo fallback must not write PostgreSQL");

  // 3) Back to PostgreSQL, no restart.
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await priestSettingService.usePostgres(), true);
  const afterSwitch = await priestSettingService.findOne({ priestId });
  assert.ok(afterSwitch, "the earlier PostgreSQL row is still readable after the round-trip");
  assert.strictEqual(afterSwitch.smsNotifications, false);
});

test("settings: the attendance datasource also flips in-process", async () => {
  // Start from the fallback state (the round-trip above leaves the seam
  // connected).
  pinMongoFallback();
  assert.strictEqual(await attendanceSettingService.usePostgres(), false);

  dbConfig.isDbConnected = () => true;
  try {
    assert.strictEqual(attendanceSettingService.isConnected(), true);
    assert.strictEqual(await attendanceSettingService.usePostgres(), true);
  } finally {
    pinMongoFallback();
  }

  assert.strictEqual(await attendanceSettingService.usePostgres(), false);
});