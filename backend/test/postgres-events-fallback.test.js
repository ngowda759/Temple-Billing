// Phase 2X Mongo/Mongoose fallback tests for the Event repository and
// persistence service.
//
// These tests pin the datasource seam to "disconnected" so the repository and
// service must select the existing Mongoose path. They verify that:
//   - the service reports MongoDB as the selected datasource (and never
//     PostgreSQL, even when DATABASE_URL points at a dead server),
//   - every repository operation routes to the exact Mongoose call the
//     controllers used before this phase,
//   - the fallback needs no PostgreSQL table at all,
//   - a single write reaches exactly one datasource (no dual writes),
//   - the datasource seam is read at call time, so flipping it in-process takes
//     effect on already-loaded modules (a require-time destructure would fail
//     the flip assertions).
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const dbConfig = require("../src/config/db");
const Event = require("../src/models/Event");
const { closePostgres } = require("../src/config/postgres");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let eventService;
let eventRepository;

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

// migrate.js is idempotent, so recreating a dropped table also needs the 025
// bookkeeping row removed — otherwise the DDL is skipped as "already applied".
const restoreEventsTable = async () => {
  await pgQuery("DROP TABLE IF EXISTS events CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '025_create_events.sql'");
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
  ensureSchema();
  eventService = require("../src/services/eventPersistenceService");
  eventRepository = require("../src/repositories/eventRepository");
});

// The fallback path must not need the events table, but the "no PostgreSQL row
// was written" assertions below do, so the schema is ensured up front.
function ensureSchema() {
  runMigrate();
}

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const withStubs = async (stubs, fn) => {
  const originals = {};
  for (const [name, impl] of Object.entries(stubs)) {
    originals[name] = Event[name];
    Event[name] = impl;
  }
  try {
    return await fn();
  } finally {
    Object.assign(Event, originals);
  }
};

// ─── Datasource selection ──────────────────────────────────────────────────
test("events fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(eventService.isConnected(), false);
  assert.strictEqual(await eventService.usePostgres(), false);
});

test("events fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await eventService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
  }
});

// ─── Repository routing ────────────────────────────────────────────────────
test("events fallback: repository create routes to the Mongoose model", async () => {
  let received;
  await withStubs(
    { create: async (payload) => { received = payload; return { _id: "m1", ...payload }; } },
    async () => {
      const doc = await eventRepository.create({ title: "T", date: new Date(), location: "L" });
      assert.strictEqual(doc._id, "m1");
      assert.strictEqual(received.title, "T");
      assert.strictEqual(received.location, "L");
    }
  );
});

test("events fallback: repository list/create/read/update/delete route to the Mongoose model", async () => {
  const calls = [];
  const createdAt = new Date();
  await withStubs(
    {
      findById: async (id) => { calls.push(["findById", id]); return { _id: id }; },
      find: (filter) => {
        calls.push(["find", filter]);
        const chain = {
          sort: (sort) => { calls.push(["sort", sort]); return chain; },
          limit: (n) => { calls.push(["limit", n]); return chain; },
          skip: (n) => { calls.push(["skip", n]); return chain; },
          then: (resolve) => resolve([{ _id: "e1" }]),
        };
        return chain;
      },
      countDocuments: async (filter) => { calls.push(["countDocuments", filter]); return 4; },
      findByIdAndUpdate: async (id, updates, options) => {
        calls.push(["findByIdAndUpdate", id, updates, options]);
        return { _id: id, ...updates };
      },
      updateMany: async (filter, updates) => {
        calls.push(["updateMany", filter, updates]);
        return { modifiedCount: 2 };
      },
      findByIdAndDelete: async (id) => { calls.push(["findByIdAndDelete", id]); return { _id: id }; },
      aggregate: async (pipeline) => {
        calls.push(["aggregate", pipeline]);
        return [{ _id: null, registrations: 3, collection: 12.5 }];
      },
    },
    async () => {
      await eventRepository.findById("abc");
      await eventRepository.findMany({ sort: { date: 1 }, limit: 10, offset: 20 });
      const count = await eventRepository.countDocuments({ status: "Upcoming" });
      await eventRepository.updateById("abc", { title: "New", slots: 5 });
      await eventRepository.incrementById("abc", { registrations: 1, collection: 100 });
      await eventRepository.updateMany({ status: "Upcoming" }, { $set: { status: "Completed" } });
      const totals = await eventRepository.sumTotals({});
      await eventRepository.findByIdAndDelete("abc");

      assert.deepStrictEqual(calls[0], ["findById", "abc"]);
      assert.ok(calls.some((c) => c[0] === "find"));
      assert.ok(calls.some((c) => c[0] === "sort"));
      assert.ok(calls.some((c) => c[0] === "limit" && c[1] === 10));
      assert.ok(calls.some((c) => c[0] === "skip" && c[1] === 20));
      assert.strictEqual(count, 4);

      // updateById must hand Mongoose only the supplied known fields, with
      // { new: true, runValidators: true } preserved from the old flow.
      const u = calls.find((c) => c[0] === "findByIdAndUpdate" && c[2].title === "New");
      assert.deepStrictEqual(u[2], { title: "New", slots: 5 });
      assert.deepStrictEqual(u[3], { new: true, runValidators: true });

      // incrementById must express the bump as $inc, exactly as the controllers did.
      const inc = calls.find((c) => c[0] === "findByIdAndUpdate" && c[2].$inc);
      assert.deepStrictEqual(inc[2], { $inc: { registrations: 1, collection: 100 } });
      assert.deepStrictEqual(inc[3], { new: true });

      const um = calls.find((c) => c[0] === "updateMany");
      assert.deepStrictEqual(um[1], { status: "Upcoming" });
      assert.deepStrictEqual(um[2], { $set: { status: "Completed" } });

      assert.strictEqual(totals.registrations, 3);
      assert.strictEqual(totals.collection, 12.5);
      assert.ok(calls.some((c) => c[0] === "findByIdAndDelete"));
    }
  );
});

test("events fallback: the service routes every operation through the Mongoose model", async () => {
  const calls = [];
  const originals = {};
  const stub = (name, impl) => { originals[name] = Event[name]; Event[name] = impl; };
  try {
    stub("create", async (payload) => { calls.push("create"); return { _id: "mongo-1", ...payload }; });
    stub("findById", async (id) => { calls.push("findById"); return { _id: id, title: "T" }; });
    stub("find", () => {
      calls.push("find");
      const chain = { sort: () => chain, limit: () => chain, skip: () => chain, then: (r) => r([]) };
      return chain;
    });
    stub("findByIdAndUpdate", async (id, updates) => { calls.push("findByIdAndUpdate"); return { _id: id, ...updates }; });
    stub("updateMany", async () => { calls.push("updateMany"); return { modifiedCount: 1 }; });
    stub("countDocuments", async () => { calls.push("countDocuments"); return 7; });
    stub("findByIdAndDelete", async (id) => { calls.push("findByIdAndDelete"); return { _id: id }; });
    stub("aggregate", async () => { calls.push("aggregate"); return [{ _id: null, registrations: 1, collection: 2 }]; });

    await eventService.create({ title: "T", date: new Date(), location: "L" });
    await eventService.findById("mongo-1");
    await eventService.findMany({ sort: { date: 1 } });
    await eventService.updateById("mongo-1", { status: "Active" });
    await eventService.incrementById("mongo-1", { collection: 5 });
    await eventService.updateMany({ status: "Upcoming" }, { $set: { status: "Completed" } });
    assert.strictEqual(await eventService.countDocuments({ status: "Upcoming" }), 7);
    await eventService.sumTotals({});
    await eventService.findByIdAndDelete("mongo-1");

    for (const name of ["create", "findById", "find", "findByIdAndUpdate", "updateMany", "countDocuments", "aggregate", "findByIdAndDelete"]) {
      assert.ok(calls.includes(name), `${name} used Mongoose`);
    }
  } finally {
    Object.assign(Event, originals);
  }
});

test("events fallback: create validation mirrors Mongoose on the fallback branch too", async () => {
  await assert.rejects(
    () => eventService.create({ date: new Date(), location: "L" }),
    /title is required/,
  );
  await assert.rejects(
    () => eventService.create({ title: "T", location: "L" }),
    /date is required/,
  );
});

// ─── No table needed, no stray PG rows ─────────────────────────────────────
test("events fallback: the Mongo path works when the events table is missing", async () => {
  await pgQuery("DROP TABLE IF EXISTS events CASCADE");
  try {
    await withStubs(
      { create: async (payload) => ({ _id: "m2", ...payload }) },
      async () => {
        const doc = await eventRepository.create({ title: "T", date: new Date(), location: "L" });
        assert.strictEqual(doc._id, "m2");
      }
    );
  } finally {
    await restoreEventsTable();
  }
});

test("events fallback: the Mongo path leaves no rows in PostgreSQL", async () => {
  await restoreEventsTable();
  const before = await pgQuery("SELECT count(*)::int AS c FROM events");

  await withStubs(
    { create: async (payload) => ({ _id: "m3", ...payload }) },
    async () => {
      await eventService.create({ title: "Only Mongo", date: new Date(), location: "L" });
    }
  );

  const after = await pgQuery("SELECT count(*)::int AS c FROM events");
  assert.strictEqual(after[0].c, before[0].c, "no PostgreSQL row was written on the Mongo path");
});

test("events fallback: a single write never reaches both datasources", async () => {
  let mongoWrites = 0;
  await withStubs(
    { create: async (payload) => { mongoWrites += 1; return { _id: "m4", ...payload }; } },
    async () => {
      await eventService.create({ title: "T", date: new Date(), location: "L" });
    }
  );
  assert.strictEqual(mongoWrites, 1, "exactly one Mongo write");

  const rows = await pgQuery("SELECT count(*)::int AS c FROM events");
  assert.strictEqual(rows[0].c, 0, "the PostgreSQL table stayed empty");
});

// ─── Datasource seam is read at call time ──────────────────────────────────
test("events fallback: flipping the datasource seam in-process takes effect immediately", async () => {
  const wasConnected = dbConfig.isDbConnected;

  // Disconnected → Mongoose.
  dbConfig.isDbConnected = () => false;
  assert.strictEqual(await eventService.usePostgres(), false);

  // Connected → PostgreSQL (the module was already loaded above, so a
  // require-time destructure of isDbConnected would have frozen the old value).
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await eventService.usePostgres(), true);

  dbConfig.isDbConnected = wasConnected;
});

test("events fallback: the repository itself honours the disconnected seam", async () => {
  const wasConnected = dbConfig.isDbConnected;
  dbConfig.isDbConnected = () => false;
  const originalFindById = Event.findById;
  let used = false;
  Event.findById = async () => {
    used = true;
    return { _id: "fallback" };
  };
  try {
    const doc = await eventRepository.findById("fallback");
    assert.strictEqual(used, true, "the repository delegated to Mongoose");
    assert.strictEqual(doc._id, "fallback");
  } finally {
    dbConfig.isDbConnected = wasConnected;
    Event.findById = originalFindById;
  }
});
