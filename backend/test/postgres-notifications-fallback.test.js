// Phase 2W Mongo/Mongoose fallback tests for the Notification repository and
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
const Notification = require("../src/models/Notification");
const { closePostgres } = require("../src/config/postgres");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let notificationService;
let notificationRepository;

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

// migrate.js is idempotent, so recreating a dropped table also needs the 024
// bookkeeping row removed — otherwise the DDL is skipped as "already applied".
const restoreNotificationsTable = async () => {
  await pgQuery("DROP TABLE IF EXISTS notifications CASCADE");
  await pgQuery("DELETE FROM schema_migrations WHERE name = '024_create_notifications.sql'");
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
  notificationService = require("../src/services/notificationPersistenceService");
  notificationRepository = require("../src/repositories/notificationRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const withStubs = async (stubs, fn) => {
  const originals = {};
  for (const [name, impl] of Object.entries(stubs)) {
    originals[name] = Notification[name];
    Notification[name] = impl;
  }
  try {
    return await fn();
  } finally {
    Object.assign(Notification, originals);
  }
};

// ─── Datasource selection ──────────────────────────────────────────────────
test("notifications fallback: service selects MongoDB when the datasource seam is disconnected", async () => {
  assert.strictEqual(notificationService.isConnected(), false);
  assert.strictEqual(await notificationService.usePostgres(), false);
});

test("notifications fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  // The seam is disconnected, so the reachability probe must not even be needed.
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nope";
  try {
    await closePostgres();
    assert.strictEqual(await notificationService.usePostgres(), false);
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
  }
});

// ─── Repository routing ────────────────────────────────────────────────────
test("notifications fallback: repository create routes to the Mongoose model", async () => {
  let received;
  await withStubs(
    { create: async (payload) => { received = payload; return { _id: "m1", ...payload }; } },
    async () => {
      const doc = await notificationRepository.create({ title: "T", message: "M" });
      assert.strictEqual(doc._id, "m1");
      assert.deepStrictEqual(received, { title: "T", message: "M" });
    }
  );
});

test("notifications fallback: repository reads route to the Mongoose model", async () => {
  const calls = [];
  await withStubs(
    {
      findById: async (id) => { calls.push(["findById", id]); return { _id: id }; },
      find: (filter) => {
        calls.push(["find", filter]);
        const chain = {
          sort: (sort) => { calls.push(["sort", sort]); return chain; },
          limit: (n) => { calls.push(["limit", n]); return chain; },
          skip: (n) => { calls.push(["skip", n]); return chain; },
          then: (resolve) => resolve([]),
        };
        return chain;
      },
      countDocuments: async (filter) => { calls.push(["countDocuments", filter]); return 4; },
    },
    async () => {
      await notificationRepository.findById("abc");
      await notificationRepository.findMany({ filter: { read: false }, sort: { createdAt: -1 }, limit: 10, offset: 20 });
      const count = await notificationRepository.countDocuments({ read: false });

      assert.deepStrictEqual(calls[0], ["findById", "abc"]);
      assert.ok(calls.some((c) => c[0] === "find"));
      assert.ok(calls.some((c) => c[0] === "sort"));
      assert.ok(calls.some((c) => c[0] === "limit" && c[1] === 10));
      assert.ok(calls.some((c) => c[0] === "skip" && c[1] === 20));
      assert.strictEqual(count, 4);
    }
  );
});

test("notifications fallback: repository updates route to the Mongoose model", async () => {
  const calls = [];
  await withStubs(
    {
      findByIdAndUpdate: async (id, updates, options) => {
        calls.push(["findByIdAndUpdate", id, updates, options]);
        return { _id: id, ...updates };
      },
      updateMany: async (filter, updates) => {
        calls.push(["updateMany", filter, updates]);
        return { modifiedCount: 2 };
      },
    },
    async () => {
      const updated = await notificationRepository.findByIdAndUpdate("abc", { read: true });
      assert.strictEqual(updated.read, true);
      // { new: true } must be preserved, as the controllers relied on it.
      assert.deepStrictEqual(calls[0], ["findByIdAndUpdate", "abc", { read: true }, { new: true }]);

      const res = await notificationRepository.updateMany({ read: false }, { read: true });
      assert.strictEqual(res.modifiedCount, 2);
      assert.deepStrictEqual(calls[1], ["updateMany", { read: false }, { read: true }]);
    }
  );
});

test("notifications fallback: create validation mirrors Mongoose on the fallback branch too", async () => {
  await assert.rejects(
    () => notificationService.create({ message: "M" }),
    /title is required/,
  );
  await assert.rejects(
    () => notificationService.create({ title: "T" }),
    /message is required/,
  );
});

// ─── No table needed, no stray PG rows ─────────────────────────────────────
test("notifications fallback: the Mongo path works when the notifications table is missing", async () => {
  await pgQuery("DROP TABLE IF EXISTS notifications CASCADE");
  try {
    await withStubs(
      { create: async (payload) => ({ _id: "m2", ...payload }) },
      async () => {
        const doc = await notificationRepository.create({ title: "T", message: "M" });
        assert.strictEqual(doc._id, "m2");
      }
    );
  } finally {
    await restoreNotificationsTable();
  }
});

test("notifications fallback: the Mongo path leaves no rows in PostgreSQL", async () => {
  await restoreNotificationsTable();
  const before = await pgQuery("SELECT count(*)::int AS c FROM notifications");

  await withStubs(
    { create: async (payload) => ({ _id: "m3", ...payload }) },
    async () => {
      await notificationService.create({ title: "Only Mongo", message: "M" });
    }
  );

  const after = await pgQuery("SELECT count(*)::int AS c FROM notifications");
  assert.strictEqual(after[0].c, before[0].c, "no PostgreSQL row was written on the Mongo path");
});

test("notifications fallback: a single write never reaches both datasources", async () => {
  let mongoWrites = 0;
  await withStubs(
    { create: async (payload) => { mongoWrites += 1; return { _id: "m4", ...payload }; } },
    async () => {
      await notificationService.create({ title: "T", message: "M" });
    }
  );
  assert.strictEqual(mongoWrites, 1, "exactly one write, to Mongo");
});

// ─── Seam is read at call time ─────────────────────────────────────────────
test("notifications fallback: seam can flip to PostgreSQL within the same process without a stale reference", async () => {
  // Already-loaded module: the flip must take effect immediately, which only
  // works because the service reads dbConfig.isDbConnected() at call time.
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await notificationService.usePostgres(), true);
  dbConfig.isDbConnected = () => false;
  assert.strictEqual(await notificationService.usePostgres(), false);
});

test("notifications fallback: flipping the seam back and forth always honours the current value", async () => {
  for (let i = 0; i < 3; i += 1) {
    dbConfig.isDbConnected = () => true;
    assert.strictEqual(await notificationService.usePostgres(), true, `iteration ${i}: connected`);
    dbConfig.isDbConnected = () => false;
    assert.strictEqual(await notificationService.usePostgres(), false, `iteration ${i}: disconnected`);
  }
});

test("notifications fallback: the service genuinely invokes the Mongoose model end-to-end", async () => {
  let invoked = false;
  await withStubs(
    { create: async (payload) => { invoked = true; return { _id: "m5", ...payload }; } },
    async () => {
      const doc = await notificationService.create({ title: "End to end", message: "M" });
      assert.strictEqual(doc._id, "m5");
    }
  );
  assert.strictEqual(invoked, true, "Mongoose create really ran");
});

test("notifications fallback: a broadcast array is delegated to Mongoose as one call", async () => {
  let received;
  await withStubs(
    { create: async (payload) => { received = payload; return payload.map((p, i) => ({ _id: `b${i}`, ...p })); } },
    async () => {
      const docs = await notificationService.create([
        { title: "T", message: "M", audienceRole: "staff" },
        { title: "T", message: "M", audienceRole: "staff" },
      ]);
      assert.strictEqual(docs.length, 2);
    }
  );
  assert.ok(Array.isArray(received), "the array reached Mongoose intact");
  assert.strictEqual(received.length, 2);
});

test("notifications fallback: unique ids come from Mongo, not the repository generator", async () => {
  // On the fallback branch the repository must not mint its own 24-hex id.
  await withStubs(
    { create: async (payload) => ({ _id: "mongo-objectid", ...payload }) },
    async () => {
      const doc = await notificationRepository.create({ title: "T", message: "M" });
      assert.strictEqual(doc._id, "mongo-objectid");
    }
  );
  void unique;
});
