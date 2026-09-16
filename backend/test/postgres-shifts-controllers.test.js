// Phase 2U controller-level tests for the Shift endpoints.
//
// These drive the real shiftController handlers (not the service in isolation)
// so the API contract is verified end-to-end:
//   - the PostgreSQL path persists through the controller and serializeShift
//     returns exactly the Mongo field set the frontend consumes,
//   - the Mongo fallback path routes the same handlers to the Mongoose model,
//   - deleteShift still performs the application-level Task.deleteMany cascade
//     on both datasources,
//   - a controller operation reaches exactly one datasource.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Task = require("../src/models/Task");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let shiftController;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS shifts CASCADE");
    await pool.query("DROP TABLE IF EXISTS leaves CASCADE");
    await pool.query("DROP TABLE IF EXISTS attendance CASCADE");
  } finally {
    await pool.end();
  }
};

const createMockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const pgQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
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
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;
  shiftController = require("../src/controllers/shiftController");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// ─── PostgreSQL path ───────────────────────────────────────────────────────
test("shift controller (PG): createShift persists and serializeShift keeps the Mongo field set", async () => {
  const res = createMockRes();
  await shiftController.createShift(
    {
      body: {
        shiftName: `Controller-${unique()}`,
        startTime: "9:00 AM",
        endTime: "5:00 PM",
        category: "Kitchen",
        requiredStaff: 2,
        notes: "  prepared in the kitchen  ",
      },
    },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.success, true);

  // Exactly the projection serializeShift produces — the frontend contract.
  assert.deepStrictEqual(
    Object.keys(res.body.shift).sort(),
    ["id", "shiftName", "startTime", "endTime", "category", "requiredStaff",
      "active", "notes", "createdAt", "updatedAt"].sort(),
    "serializeShift returns exactly the fields the frontend reads"
  );
  assert.strictEqual(res.body.shift.startTime, "9:00 AM", "the 12-hour string is returned verbatim");
  assert.strictEqual(res.body.shift.endTime, "5:00 PM");
  assert.strictEqual(res.body.shift.category, "Kitchen");
  assert.strictEqual(res.body.shift.requiredStaff, 2);
  assert.strictEqual(res.body.shift.active, true, "active defaults to true");
  assert.strictEqual(res.body.shift.notes, "prepared in the kitchen", "notes are trimmed");

  // It really landed in PostgreSQL.
  const rows = await pgQuery("SELECT shift_name FROM shifts WHERE id = $1", [res.body.shift.id]);
  assert.strictEqual(rows.length, 1, "the row exists in PostgreSQL");
});

test("shift controller (PG): createShift rejects a missing field with 400 like before", async () => {
  const res = createMockRes();
  await shiftController.createShift({ body: { shiftName: "No Times" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
});

test("shift controller (PG): getShifts returns the createdAt-descending list", async () => {
  const nameA = `List-${unique()}-A`;
  const nameB = `List-${unique()}-B`;

  const resA = createMockRes();
  await shiftController.createShift({ body: { shiftName: nameA, startTime: "9:00 AM", endTime: "5:00 PM" } }, resA);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const resB = createMockRes();
  await shiftController.createShift({ body: { shiftName: nameB, startTime: "6:00 AM", endTime: "2:00 PM" } }, resB);

  const res = createMockRes();
  await shiftController.getShifts({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);

  const ids = res.body.shifts.map((s) => s.id);
  assert.ok(ids.includes(resA.body.shift.id) && ids.includes(resB.body.shift.id));
  assert.ok(ids.indexOf(resB.body.shift.id) < ids.indexOf(resA.body.shift.id),
    "newest shift first, matching .sort({ createdAt: -1 })");
});

test("shift controller (PG): updateShift patches only the supplied fields", async () => {
  const created = createMockRes();
  await shiftController.createShift(
    { body: { shiftName: `Patch-${unique()}`, startTime: "9:00 AM", endTime: "5:00 PM", category: "Security" } },
    created
  );
  const id = created.body.shift.id;

  const res = createMockRes();
  await shiftController.updateShift(
    { params: { id }, body: { requiredStaff: 5, active: false } },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.shift.requiredStaff, 5, "requiredStaff was patched");
  assert.strictEqual(res.body.shift.active, false, "active was patched");
  assert.strictEqual(res.body.shift.startTime, "9:00 AM", "startTime is untouched");
  assert.strictEqual(res.body.shift.endTime, "5:00 PM", "endTime is untouched");
  assert.strictEqual(res.body.shift.category, "Security", "category is untouched");

  // A missing id still produces the pre-phase 404.
  const missing = createMockRes();
  await shiftController.updateShift({ params: { id: "0000000000000000000000ff" }, body: { active: false } }, missing);
  assert.strictEqual(missing.statusCode, 404);
});

test("shift controller (PG): deleteShift removes the shift and cascades onto Task", async () => {
  const created = createMockRes();
  await shiftController.createShift(
    { body: { shiftName: `Delete-${unique()}`, startTime: "9:00 AM", endTime: "5:00 PM" } },
    created
  );
  const id = created.body.shift.id;

  // Record the application-level cascade (deleteShift runs
  // Task.deleteMany({ shiftId })) without touching a real Mongo.
  const cascadeCalls = [];
  const originalDeleteMany = Task.deleteMany;
  Task.deleteMany = async (filter) => {
    cascadeCalls.push(filter);
    return { acknowledged: true, deletedCount: 0 };
  };

  try {
    const res = createMockRes();
    await shiftController.deleteShift({ params: { id } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.deepStrictEqual(cascadeCalls, [{ shiftId: id }],
      "the Task cascade still runs with the shift id");

    const rows = await pgQuery("SELECT id FROM shifts WHERE id = $1", [id]);
    assert.strictEqual(rows.length, 0, "the shift row is gone from PostgreSQL");
  } finally {
    Task.deleteMany = originalDeleteMany;
  }
});

test("shift controller (PG): deleteShift returns 404 for a missing shift", async () => {
  const res = createMockRes();
  await shiftController.deleteShift({ params: { id: "0000000000000000000000ff" } }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.success, false);
});

test("shift controller (PG): an operation reaches exactly one datasource", async () => {
  const before = (await pgQuery("SELECT COUNT(*)::int AS n FROM shifts"))[0].n;
  const res = createMockRes();
  await shiftController.createShift(
    { body: { shiftName: `OneWrite-${unique()}`, startTime: "9:00 AM", endTime: "5:00 PM" } },
    res
  );
  const after = (await pgQuery("SELECT COUNT(*)::int AS n FROM shifts"))[0].n;
  assert.strictEqual(after, before + 1, "exactly one PostgreSQL row was written");
});

// ─── Mongo fallback path ───────────────────────────────────────────────────
test("shift controller (Mongo fallback): the same handlers route to Mongoose", async () => {
  dbConfig.isDbConnected = () => false;
  try {
    const calls = [];
    const saved = [];
    const original = {
      create: Task.create,
      deleteMany: Task.deleteMany,
      ShiftCreate: require("../src/models/Shift").create,
      ShiftFindById: require("../src/models/Shift").findById,
    };

    const makeDoc = (obj, id) => {
      const d = {
        ...obj, _id: id, id,
        save: async function save() { calls.push(["save", this._id]); return this; },
      };
      return d;
    };

    const Shift = require("../src/models/Shift");
    Shift.create = async (data) => {
      calls.push(["create", data]);
      const doc = makeDoc(data, `mongo-ctrl-${saved.length + 1}`);
      saved.push(doc);
      return doc;
    };
    Shift.findById = async (id) => {
      calls.push(["findById", id]);
      return makeDoc({
        shiftName: "Fallback Shift", startTime: "9:00 AM", endTime: "5:00 PM",
        category: "General", requiredStaff: 1, active: true, notes: "",
        createdAt: new Date(), updatedAt: new Date(),
      }, id);
    };
    Shift.findByIdAndUpdate = async (id, updates) => {
      calls.push(["findByIdAndUpdate", id, updates]);
      return makeDoc({
        shiftName: "Fallback Shift", startTime: "9:00 AM", endTime: "5:00 PM",
        category: "General", requiredStaff: 4, active: true, notes: "",
        createdAt: new Date(), updatedAt: new Date(),
        ...updates,
      }, id);
    };
    Shift.findByIdAndDelete = async (id) => {
      calls.push(["findByIdAndDelete", id]);
      return makeDoc({ shiftName: "Deleted" }, id);
    };
    Shift.find = (filter) => {
      calls.push(["find", filter]);
      const q = {
        sort(arg) { calls.push(["sort", arg]); return q; },
        then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
      };
      return q;
    };
    Task.deleteMany = async (filter) => { calls.push(["taskDeleteMany", filter]); return { acknowledged: true }; };

    try {
      const created = createMockRes();
      await shiftController.createShift(
        { body: { shiftName: "Fallback Shift", startTime: "9:00 AM", endTime: "5:00 PM" } },
        created
      );
      assert.strictEqual(created.statusCode, 201);
      assert.ok(calls.some(([name]) => name === "create"), "createShift reached Shift.create");

      const listed = createMockRes();
      await shiftController.getShifts({}, listed);
      assert.ok(calls.some(([name]) => name === "find"), "getShifts reached Shift.find");
      assert.ok(calls.some(([name, arg]) => name === "sort" && arg && arg.createdAt === -1),
        "the createdAt-descending sort is preserved on the fallback");

      const updated = createMockRes();
      await shiftController.updateShift(
        { params: { id: "0000000000000000000000aa" }, body: { requiredStaff: 4 } },
        updated
      );
      assert.ok(calls.some(([name, id]) => name === "findById" && id === "0000000000000000000000aa"),
        "updateShift reached Shift.findById");
      // Only the supplied fields are patched, through the same findByIdAndUpdate
      // the pre-phase controller's save() produced.
      assert.ok(calls.some(([name, id, updates]) =>
        name === "findByIdAndUpdate" && id === "0000000000000000000000aa"
        && updates && updates.requiredStaff === 4 && updates.shiftName === undefined),
        "only the supplied fields are patched on the fallback");
      assert.strictEqual(updated.statusCode, 200);

      const deleted = createMockRes();
      await shiftController.deleteShift({ params: { id: "0000000000000000000000bb" } }, deleted);
      assert.ok(calls.some(([name, id]) => name === "findByIdAndDelete" && id === "0000000000000000000000bb"),
        "deleteShift reached Shift.findByIdAndDelete");
      assert.ok(calls.some(([name, filter]) => name === "taskDeleteMany" && filter && filter.shiftId === "0000000000000000000000bb"),
        "the Task cascade ran with the shift id");
      assert.strictEqual(deleted.statusCode, 200);
    } finally {
      Shift.create = original.ShiftCreate;
      Shift.findById = original.ShiftFindById;
      Task.create = original.create;
      Task.deleteMany = original.deleteMany;
    }
  } finally {
    dbConfig.isDbConnected = () => true;
  }
});
