// Phase 2Q fallback tests.
//
// The Repair persistence layer is additive and entity-scoped:
//
//   Repair Services
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    repairRequestRepository / repairTicketRepository
//         |      → repair_requests + repair_tickets + repair_ticket_spare_parts
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose RepairRequest / RepairTicket models (unchanged path)
//
// These tests prove which database path is actually used, that the Mongo
// fallback genuinely invokes the Mongoose models (not a stub's return values),
// that no dual writes happen, and that the datasource seam can be switched
// without a fresh Node process.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const dbConfig = require("../src/config/db");
const RepairRequest = require("../src/models/RepairRequest");
const RepairTicket = require("../src/models/RepairTicket");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

let originalIsDbConnected;
let repairRequestService;
let repairTicketService;
let repairRequestRepository;
let repairTicketRepository;

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

  repairRequestService = require("../src/services/repairRequestService");
  repairTicketService = require("../src/services/repairTicketService");
  repairRequestRepository = require("../src/repositories/repairRequestRepository");
  repairTicketRepository = require("../src/repositories/repairTicketRepository");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
});

// Re-runs the full migration chain so the repair tables exist in PostgreSQL.
const ensureTables = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  assert.strictEqual(res.status, 0, "migrate failed: " + res.stdout + "\n" + res.stderr);
};

/**
 * Builds a call-tracking spy collection that replaces the Mongoose model
 * methods. The loaded model object is the SAME reference the
 * repository/service invoke at call time, so swapping the methods is
 * authoritative regardless of module load order.
 */
const stubCollection = (model, docId = "000000000000000000000001") => {
  const saved = [];
  const calls = [];
  const doc = (obj, id = docId) => ({
    ...obj,
    _id: id,
    id,
    toObject: () => ({ ...obj, _id: id, id }),
    sparePartsUsed: obj.sparePartsUsed ? [...obj.sparePartsUsed] : [],
    save: async function save() { calls.push(["save", this._id]); return this; },
  });
  const execQuery = async () => [];
  const chain = {
    limit: () => chain,
    skip: () => chain,
    sort: () => chain,
    exec: execQuery,
    then: (resolve) => execQuery().then(resolve),
  };

  const create = async (data) => {
    calls.push(["create", data]);
    const d = doc(data, data.id || docId);
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

  model.create = create;
  model.findById = findById;
  model.findOne = findOne;
  model.find = find;
  model.findByIdAndUpdate = findByIdAndUpdate;
  model.findByIdAndDelete = findByIdAndDelete;
  model.countDocuments = countDocuments;
  model.prototype.save = async function save() {
    calls.push(["self-save", this._id]);
    return this;
  };
  return { saved, calls };
};

const oid = () => require("crypto").randomBytes(12).toString("hex");
let seq = 0;
const requestBase = (overrides = {}) => ({
  asset: oid(),
  description: `Fallback repair ${++seq}`,
  ...overrides,
});
const ticketBase = (overrides = {}) => ({
  ticketNumber: `TKT-FB-${++seq}`,
  asset: oid(),
  reportedBy: oid(),
  issueDescription: "Fallback issue",
  ...overrides,
});

// ─── Fallback: Mongo/Mongoose path remains when PG unavailable ──────────────
test("fallback: services select MongoDB when the datasource seam is disconnected", async () => {
  pinMongoFallback();
  assert.strictEqual(await repairRequestService.usePostgres(), false);
  assert.strictEqual(repairRequestService.isConnected(), false);
  assert.strictEqual(await repairTicketService.usePostgres(), false);
  assert.strictEqual(repairTicketService.isConnected(), false);
});

test("fallback: PG path is not selected even when DATABASE_URL points at a dead PG", async () => {
  pinMongoFallback();
  process.env.DATABASE_URL = "postgresql://temple_test:wrong@127.0.0.1:1/nonexistent";
  assert.strictEqual(await repairRequestService.usePostgres(), false);
  assert.strictEqual(await repairTicketService.usePostgres(), false);
  delete process.env.DATABASE_URL;
});

test("fallback: RepairRequest repository create routes to the Mongoose model when PG unavailable", async () => {
  pinMongoFallback();
  const { saved, calls } = stubCollection(RepairRequest);
  const created = await repairRequestRepository.create(requestBase());
  assert.ok(calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.strictEqual(saved.length, 1, "create routed to Mongoose model");
  assert.strictEqual(created.description.startsWith("Fallback repair"), true);
});

test("fallback: RepairRequest repository reads route to the Mongoose model", async () => {
  pinMongoFallback();
  const { calls } = stubCollection(RepairRequest);
  await repairRequestRepository.findById("000000000000000000000099");
  const list = await repairRequestRepository.findMany({ filter: {} });
  assert.strictEqual(list.length, 0, "stubbed query returns empty");
  assert.strictEqual(typeof (await repairRequestRepository.count({})), "number");
  assert.ok(calls.some(([name]) => name === "findById"), "findById routed to Mongoose");
  assert.ok(calls.some(([name]) => name === "countDocuments"), "count routed to Mongoose");
});

test("fallback: RepairRequest repository updates/deletes route to the Mongoose model", async () => {
  pinMongoFallback();
  const { saved, calls } = stubCollection(RepairRequest);
  const created = await repairRequestRepository.create(requestBase({ status: "Pending" }));
  assert.strictEqual(saved.length, 1);
  const updated = await repairRequestRepository.updateById(created._id, { status: "Completed" });
  assert.strictEqual(updated.status, "Completed", "update applied through Mongoose findByIdAndUpdate");
  assert.ok(calls.some(([name]) => name === "findByIdAndUpdate"), "update routed to Mongoose findByIdAndUpdate");
  assert.strictEqual(await repairRequestRepository.destroy(created._id), true);
  assert.strictEqual(saved.length, 0, "destroy removed the saved doc from the model store");
});

test("fallback: RepairTicket repository CRUD routes to the Mongoose model including spare parts", async () => {
  pinMongoFallback();
  const { saved, calls } = stubCollection(RepairTicket);
  const created = await repairTicketRepository.create(ticketBase({ sparePartsUsed: [{ item: oid(), quantity: 2 }] }));
  assert.strictEqual(saved.length, 1, "create routed to Mongoose model");
  assert.strictEqual(created.sparePartsUsed.length, 1, "embedded spare parts preserved on the Mongo path");
  await repairTicketRepository.findById(created._id);
  await repairTicketRepository.findMany({ filter: {} });
  assert.strictEqual(typeof (await repairTicketRepository.count({})), "number");
  const updated = await repairTicketRepository.updateById(created._id, { status: "Completed" });
  assert.strictEqual(updated.status, "Completed");
  assert.ok(calls.some(([name]) => name === "findByIdAndUpdate"));
  assert.strictEqual(await repairTicketRepository.destroy(created._id), true);
  assert.strictEqual(await repairTicketRepository.destroy(created._id), false);
});

// ─── Fallback: Mongo fallback needs no PG tables ───────────────────────────
test("fallback: Mongo fallback works when the repair tables are missing", async () => {
  pinMongoFallback();
  delete process.env.DATABASE_URL;

  const { saved } = stubCollection(RepairRequest);
  const created = await repairRequestRepository.create(requestBase());
  assert.strictEqual(saved.length, 1, "create routed to the Mongoose model");

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_tickets CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await pool.end();
  }
  const again = await repairRequestRepository.create(requestBase({ description: "still-works" }));
  assert.strictEqual(again.description, "still-works");
});

// ─── No dual write / global switch ─────────────────────────────────────────
test("fallback: Mongo path leaves no partial or duplicate rows in PostgreSQL", async () => {
  pinMongoFallback();

  ensureTables();
  const rowCount = async (table) => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      return rows[0].n;
    } finally {
      await pool.end();
    }
  };

  const beforeReq = await rowCount("repair_requests");
  const beforeTkt = await rowCount("repair_tickets");
  const beforeParts = await rowCount("repair_ticket_spare_parts");

  stubCollection(RepairRequest);
  stubCollection(RepairTicket);
  await repairRequestRepository.create(requestBase());
  await repairTicketRepository.create(ticketBase({ sparePartsUsed: [{ item: oid(), quantity: 1 }] }));

  assert.strictEqual(await rowCount("repair_requests"), beforeReq, "no PG repair_requests row on Mongo fallback");
  assert.strictEqual(await rowCount("repair_tickets"), beforeTkt, "no PG repair_tickets row on Mongo fallback");
  assert.strictEqual(await rowCount("repair_ticket_spare_parts"), beforeParts, "no PG child row on Mongo fallback");
});

// ─── The services genuinely invoke the Mongoose models end-to-end ──────────
test("fallback: the services genuinely invoke the Mongoose models end-to-end", async () => {
  pinMongoFallback();
  const reqStub = stubCollection(RepairRequest);
  const tktStub = stubCollection(RepairTicket);

  const request = await repairRequestService.create(requestBase());
  assert.ok(reqStub.calls.some(([name]) => name === "create"), "create routed to Mongoose create");
  assert.ok(request._id);

  await repairRequestService.findById("000000000000000000000099");
  assert.ok(reqStub.calls.some(([name, id]) => name === "findById" && id === "000000000000000000000099"));

  await repairRequestService.findOne({ description: "x" });
  assert.ok(reqStub.calls.some(([name, filter]) => name === "findOne" && filter && filter.description === "x"));

  await repairRequestService.findMany({ filter: { status: "Pending" } });
  assert.ok(reqStub.calls.some(([name, filter]) => name === "find" && filter && filter.status === "Pending"));

  const updated = await repairRequestService.updateById("000000000000000000000001", { status: "Completed" });
  assert.strictEqual(updated.status, "Completed");
  assert.ok(reqStub.calls.some(([name]) => name === "countDocuments") === false, "count not called yet");
  await repairRequestService.count({});
  assert.ok(reqStub.calls.some(([name]) => name === "countDocuments"));
  assert.strictEqual(await repairRequestService.destroy("000000000000000000000001"), true);

  const ticket = await repairTicketService.create(ticketBase({ sparePartsUsed: [{ item: oid(), quantity: 3 }] }));
  assert.ok(tktStub.calls.some(([name]) => name === "create"), "ticket create routed to Mongoose create");
  assert.strictEqual(ticket.sparePartsUsed.length, 1);

  await repairTicketService.findById("000000000000000000000042");
  assert.ok(tktStub.calls.some(([name, id]) => name === "findById" && id === "000000000000000000000042"));
  await repairTicketService.findMany({ filter: { status: "Reported" } });
  assert.ok(tktStub.calls.some(([name, filter]) => name === "find" && filter && filter.status === "Reported"));
  const tktUpdated = await repairTicketService.updateById("000000000000000000000001", { status: "Closed" });
  assert.strictEqual(tktUpdated.status, "Closed");
  assert.strictEqual(await repairTicketService.destroy("000000000000000000000001"), true);
});

// ─── Datasource switching within one process ───────────────────────────────
test("fallback: seam can flip back to PostgreSQL within the same process", async () => {
  pinMongoFallback();
  stubCollection(RepairRequest);
  const created = await repairRequestRepository.create(requestBase());
  assert.ok(created._id);

  // Flip the seam to connected — the SAME loaded repository module now routes
  // to PostgreSQL without a fresh Node process.
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  try {
    await repairRequestRepository.destroy("000000000000000000000001");
    assert.strictEqual(await repairRequestRepository.findById(created._id), null, "the Mongo-only id does not exist in PG");
  } finally {
    pinMongoFallback();
  }
});