// Phase 2Q PostgreSQL-path tests for the Repair repositories and services.
//
// These tests run with the datasource seam connected so the repositories and
// services must select the PostgreSQL path. They verify that:
//   - repairRequestRepository / repairTicketRepository / their services persist
//     to and read from the real repair_requests, repair_tickets and
//     repair_ticket_spare_parts tables (no mocks),
//   - every Mongo schema field round-trips losslessly (ids, enums, dates,
//     cost/vendorBillAmount/quantity monetary precision),
//   - defaults, validation and the repair lifecycle semantics match the Mongo
//     models exactly,
//   - filtering, $in, sorting and pagination behave like the Mongo query
//     surface,
//   - the child repair_ticket_spare_parts FK CASCADE mirrors the embedded-array
//     lifecycle and the parent+child writes are atomic,
//   - the services never write to MongoDB while PostgreSQL is selected (no
//     dual writes) and can switch datasources in-process.
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
const oid = () => crypto.randomBytes(12).toString("hex");

let originalIsDbConnected;
let repairRequestRepository;
let repairTicketRepository;
let repairRequestService;
let repairTicketService;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS repair_ticket_spare_parts CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_tickets CASCADE");
    await pool.query("DROP TABLE IF EXISTS repair_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS asset_maintenance_history CASCADE");
    await pool.query("DROP TABLE IF EXISTS assets CASCADE");
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
  dbConfig.isDbConnected = () => true;
  repairRequestRepository = require("../src/repositories/repairRequestRepository");
  repairTicketRepository = require("../src/repositories/repairTicketRepository");
  repairRequestService = require("../src/services/repairRequestService");
  repairTicketService = require("../src/services/repairTicketService");
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

const requestBase = (overrides = {}) => ({
  asset: oid(),
  description: `Repair ${unique()}`,
  vendor: "Electrician Shop",
  cost: "750.25",
  invoiceNumber: "INV-101",
  ...overrides,
});

const ticketBase = (overrides = {}) => ({
  ticketNumber: `TKT-${unique()}`,
  asset: oid(),
  reportedBy: oid(),
  issueDescription: "Fan not working",
  ...overrides,
});

const sparePart = (overrides = {}) => ({ item: oid(), quantity: 2, ...overrides });

// ─── Service datasource selection ──────────────────────────────────────────
test("PG path: repair services select PostgreSQL when the fallback is available", async () => {
  assert.strictEqual(await repairRequestService.usePostgres(), true);
  assert.strictEqual(repairRequestService.isConnected(), true);
  assert.strictEqual(await repairTicketService.usePostgres(), true);
  assert.strictEqual(repairTicketService.isConnected(), true);
});

// ─── RepairRequest create / read round-trip ────────────────────────────────
test("PG path: repair request create persists a real row with Mongo field names", async () => {
  const assetId = oid();
  const created = await repairRequestService.create(requestBase({
    asset: assetId,
    description: "Blown fuse replaced",
    vendor: "Electrician Shop",
    cost: "1500.75",
    invoiceNumber: "INV-RQ-1",
    status: "In Progress",
    completionDate: new Date("2025-06-01T10:00:00.000Z"),
    createdBy: "user-1",
  }));
  assert.match(created._id, /^[0-9a-f]{24}$/, "Mongo-compatible ObjectId id");
  assert.strictEqual(created.id, created._id);
  assert.strictEqual(created.asset, assetId);
  assert.strictEqual(created.description, "Blown fuse replaced");
  assert.strictEqual(created.vendor, "Electrician Shop");
  assert.strictEqual(created.cost, 1500.75);
  assert.strictEqual(created.invoiceNumber, "INV-RQ-1");
  assert.strictEqual(created.status, "In Progress");
  assert.ok(created.completionDate instanceof Date, "completionDate is a Date");
  assert.strictEqual(created.completionDate.toISOString(), "2025-06-01T10:00:00.000Z");
  assert.strictEqual(created.createdBy, "user-1");
  assert.ok(created.createdAt instanceof Date, "createdAt is a Date");
  assert.ok(created.updatedAt instanceof Date, "updatedAt is a Date");

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id, asset_id, cost::text AS cost FROM repair_requests WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "repair_requests row must exist");
    assert.strictEqual(rows[0].asset_id, assetId);
    assert.strictEqual(rows[0].cost, "1500.75", "NUMERIC preserves scale");
  } finally {
    await pool.end();
  }
  await repairRequestRepository.destroy(created._id);
});

test("PG path: repair request create defaults match the Mongo schema", async () => {
  const created = await repairRequestRepository.create({
    asset: oid(),
    description: "Defaults request",
  });
  assert.strictEqual(created.vendor, "", "vendor default ''");
  assert.strictEqual(created.cost, 0, "cost default 0");
  assert.strictEqual(created.invoiceNumber, "", "invoiceNumber default ''");
  assert.strictEqual(created.status, "Pending", "status default 'Pending'");
  assert.strictEqual(created.completionDate, undefined, "completionDate unset until completed");
  assert.strictEqual(created.createdBy, undefined, "createdBy optional/unset");
  await repairRequestRepository.destroy(created._id);
});

test("PG path: repair request findById / findOne read back the round-tripped document", async () => {
  const created = await repairRequestRepository.create(requestBase());
  const byId = await repairRequestRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.asset, created.asset);
  assert.strictEqual(byId.status, "Pending");

  const byOne = await repairRequestRepository.findOne({ asset: created.asset });
  assert.strictEqual(byOne._id, created._id);
  assert.strictEqual(await repairRequestRepository.findOne({ asset: "missing-asset" }), null);
  assert.strictEqual(await repairRequestRepository.findById("000000000000000000000001"), null);
  await repairRequestRepository.destroy(created._id);
});

test("PG path: repair request validation rejects invalid data like the Mongo schema", async () => {
  await assert.rejects(repairRequestRepository.create({ asset: oid() }), /description is required/);
  await assert.rejects(repairRequestRepository.create({ asset: oid(), description: "  " }), /description is required/);
  await assert.rejects(
    repairRequestRepository.create(requestBase({ status: "Done" })),
    /Invalid status: Done/
  );
  await assert.rejects(
    repairRequestRepository.create(requestBase({ cost: "not-a-number" })),
    /Invalid cost/
  );
});

test("PG path: repair request cost accepts the full Mongo enum and legal negatives", async () => {
  for (const status of ["Pending", "In Progress", "Completed", "Cancelled"]) {
    const created = await repairRequestRepository.create(requestBase({ status }));
    assert.strictEqual(created.status, status);
    await repairRequestRepository.destroy(created._id);
  }
  // cost has no min in Mongo, so negatives are legal.
  const negative = await repairRequestRepository.create(requestBase({ cost: "-12.5" }));
  assert.strictEqual(negative.cost, -12.5);
  await repairRequestRepository.destroy(negative._id);
});

// ─── RepairTicket create / read round-trip ─────────────────────────────────
test("PG path: repair ticket create persists parent + child rows with Mongo field names", async () => {
  const itemId = oid();
  const created = await repairTicketService.create(ticketBase({
    ticketNumber: "TKT-PG-1",
    issueDescription: "Motor overheating",
    status: "Approved",
    priority: "High",
    sparePartsUsed: [{ item: itemId, quantity: "1.5" }, { item: oid(), quantity: 3 }],
    vendor: oid(),
    vendorBillAmount: "2500.75",
    vendorBillPhoto: "https://example.com/bill.jpg",
    repairExpenseId: oid(),
    approvedBy: oid(),
    resolutionNotes: "Replaced bearing",
  }));
  assert.match(created._id, /^[0-9a-f]{24}$/, "Mongo-compatible ObjectId id");
  assert.strictEqual(created.ticketNumber, "TKT-PG-1");
  assert.strictEqual(created.issueDescription, "Motor overheating");
  assert.strictEqual(created.status, "Approved");
  assert.strictEqual(created.priority, "High");
  assert.strictEqual(created.vendorBillAmount, 2500.75);
  assert.strictEqual(created.vendorBillPhoto, "https://example.com/bill.jpg");
  assert.strictEqual(created.resolutionNotes, "Replaced bearing");
  assert.strictEqual(created.sparePartsUsed.length, 2, "embedded spare parts read back");
  assert.strictEqual(created.sparePartsUsed[0].item, itemId);
  assert.strictEqual(created.sparePartsUsed[0].quantity, 1.5);
  assert.strictEqual(created.sparePartsUsed[1].quantity, 3);
  assert.match(created.sparePartsUsed[0]._id, /^[0-9a-f]{24}$/, "child rows get their own Mongo-style id");

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query("SELECT id FROM repair_tickets WHERE id = $1", [created._id]);
    assert.strictEqual(rows.length, 1, "repair_tickets row must exist");
    const { rows: child } = await pool.query(
      "SELECT id, position FROM repair_ticket_spare_parts WHERE ticket_id = $1 ORDER BY position",
      [created._id]
    );
    assert.strictEqual(child.length, 2, "repair_ticket_spare_parts rows must exist");
    assert.deepStrictEqual(child.map((r) => r.position), [0, 1], "array order preserved");
  } finally {
    await pool.end();
  }
  await repairTicketRepository.destroy(created._id);
});

test("PG path: repair ticket create defaults match the Mongo schema", async () => {
  const created = await repairTicketRepository.create(ticketBase());
  assert.strictEqual(created.status, "Reported", "status default 'Reported'");
  assert.strictEqual(created.priority, "Medium", "priority default 'Medium'");
  assert.strictEqual(created.vendorBillAmount, 0, "vendorBillAmount default 0");
  assert.strictEqual(created.vendor, undefined, "vendor optional/unset");
  assert.strictEqual(created.vendorBillPhoto, undefined);
  assert.strictEqual(created.repairExpenseId, undefined);
  assert.strictEqual(created.approvedBy, undefined);
  assert.strictEqual(created.resolutionNotes, undefined);
  assert.deepStrictEqual(created.sparePartsUsed, [], "sparePartsUsed default []");
  await repairTicketRepository.destroy(created._id);
});

test("PG path: repair ticket validation rejects invalid data like the Mongo schema", async () => {
  await assert.rejects(repairTicketRepository.create(ticketBase({ ticketNumber: "" })), /ticketNumber is required/);
  await assert.rejects(repairTicketRepository.create(ticketBase({ asset: "" })), /asset is required/);
  await assert.rejects(repairTicketRepository.create(ticketBase({ reportedBy: "" })), /reportedBy is required/);
  await assert.rejects(repairTicketRepository.create(ticketBase({ issueDescription: " " })), /issueDescription is required/);
  await assert.rejects(repairTicketRepository.create(ticketBase({ status: "Done" })), /Invalid status: Done/);
  await assert.rejects(repairTicketRepository.create(ticketBase({ priority: "Urgent" })), /Invalid priority: Urgent/);
});

test("PG path: repair ticket accepts every Mongo status and priority enum value", async () => {
  for (const status of ["Reported", "Pending Approval", "Approved", "In Progress", "Completed", "Rejected", "Closed"]) {
    const created = await repairTicketRepository.create(ticketBase({ status }));
    assert.strictEqual(created.status, status);
    await repairTicketRepository.destroy(created._id);
  }
  for (const priority of ["Low", "Medium", "High", "Critical"]) {
    const created = await repairTicketRepository.create(ticketBase({ priority }));
    assert.strictEqual(created.priority, priority);
    await repairTicketRepository.destroy(created._id);
  }
});

test("PG path: repair ticket findById / findOne / findMany read back embedded spare parts", async () => {
  const created = await repairTicketRepository.create(ticketBase({ sparePartsUsed: [sparePart()] }));
  const byId = await repairTicketRepository.findById(created._id);
  assert.strictEqual(byId._id, created._id);
  assert.strictEqual(byId.sparePartsUsed.length, 1);

  const byOne = await repairTicketRepository.findOne({ ticketNumber: created.ticketNumber });
  assert.strictEqual(byOne._id, created._id);
  assert.strictEqual(await repairTicketRepository.findOne({ ticketNumber: "MISSING" }), null);
  assert.strictEqual(await repairTicketRepository.findById("000000000000000000000001"), null);

  const list = await repairTicketRepository.findMany({ filter: { id: created._id } });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].sparePartsUsed.length, 1, "findMany loads child rows");
  await repairTicketRepository.destroy(created._id);
});

// ─── Precision ─────────────────────────────────────────────────────────────
test("PG path: cost / vendorBillAmount / quantity preserve exact NUMERIC precision", async () => {
  const values = ["0.01", "10.50", "1000.99", "1000000.99", "123456789.1234", "0"];
  for (const v of values) {
    const req = await repairRequestRepository.create(requestBase({ cost: v }));
    const readReq = await repairRequestRepository.findById(req._id);
    assert.strictEqual(readReq.cost, Number(v), `request cost ${v} round-trips exactly`);
    await repairRequestRepository.destroy(req._id);

    const tkt = await repairTicketRepository.create(ticketBase({
      vendorBillAmount: v,
      sparePartsUsed: [{ item: oid(), quantity: v }],
    }));
    const readTkt = await repairTicketRepository.findById(tkt._id);
    assert.strictEqual(readTkt.vendorBillAmount, Number(v), `ticket vendorBillAmount ${v} round-trips exactly`);
    assert.strictEqual(readTkt.sparePartsUsed[0].quantity, Number(v), `spare part quantity ${v} round-trips exactly`);
    await repairTicketRepository.destroy(tkt._id);
  }
});

test("PG path: NULL-able money is never silently coerced (round-trip through raw SQL)", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    for (const v of ["0.01", "1000.99", "123456789.1234"]) {
      const r = await pool.query(
        `INSERT INTO repair_requests (id, asset_id, description, cost)
         VALUES ($1, $2, $3, $4) RETURNING cost::text AS c`,
        [oid(), oid(), "precision", v]
      );
      assert.strictEqual(r.rows[0].c, v, `raw NUMERIC ${v} round-trips exactly`);
    }
    const t = await pool.query(
      `INSERT INTO repair_tickets (id, ticket_number, asset_id, reported_by, issue_description, vendor_bill_amount)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING vendor_bill_amount::text AS c`,
      [oid(), `TKT-${unique()}`, oid(), oid(), "precision", "1000000.99"]
    );
    assert.strictEqual(t.rows[0].c, "1000000.99");
  } finally {
    await pool.end();
  }
});

// ─── update / delete workflow ──────────────────────────────────────────────
test("PG path: repair request updateById persists the completion workflow", async () => {
  const created = await repairRequestRepository.create(requestBase({ cost: 0 }));
  const completionDate = new Date("2025-07-04T08:30:00.000Z");
  const updated = await repairRequestRepository.updateById(created._id, {
    status: "Completed",
    completionDate,
    cost: "3000.5",
    invoiceNumber: "INV-DONE",
  });
  assert.strictEqual(updated.status, "Completed");
  assert.strictEqual(updated.cost, 3000.5);
  assert.strictEqual(updated.invoiceNumber, "INV-DONE");
  assert.strictEqual(updated.completionDate.toISOString(), completionDate.toISOString());

  const reloaded = await repairRequestRepository.findById(created._id);
  assert.strictEqual(reloaded.status, "Completed");
  assert.strictEqual(reloaded.cost, 3000.5);
  await repairRequestRepository.destroy(created._id);
});

test("PG path: repair request updateById enforces enums / required scalars and returns null for missing ids", async () => {
  const created = await repairRequestRepository.create(requestBase());
  await assert.rejects(repairRequestRepository.updateById(created._id, { status: "Done" }), /Invalid status: Done/);
  await assert.rejects(repairRequestRepository.updateById(created._id, { description: "" }), /description is required/);
  assert.strictEqual(await repairRequestRepository.updateById("000000000000000000000001", { status: "Completed" }), null);
  await repairRequestRepository.destroy(created._id);
});

test("PG path: repair ticket updateById persists the completeRepairTicket workflow", async () => {
  const created = await repairTicketRepository.create(ticketBase());
  const updated = await repairTicketRepository.updateById(created._id, {
    status: "Completed",
    vendorBillAmount: "4200.75",
    vendorBillPhoto: "https://example.com/x.jpg",
    resolutionNotes: "Replaced motor",
  });
  assert.strictEqual(updated.status, "Completed");
  assert.strictEqual(updated.vendorBillAmount, 4200.75);
  assert.strictEqual(updated.vendorBillPhoto, "https://example.com/x.jpg");
  assert.strictEqual(updated.resolutionNotes, "Replaced motor");

  const reloaded = await repairTicketRepository.findById(created._id);
  assert.strictEqual(reloaded.status, "Completed");
  assert.strictEqual(reloaded.vendorBillAmount, 4200.75);
  await repairTicketRepository.destroy(created._id);
});

test("PG path: optional repair ticket fields round-trip and stay unset when omitted", async () => {
  const created = await repairTicketRepository.create(ticketBase({
    vendor: oid(),
    vendorBillPhoto: "https://example.com/b.jpg",
    repairExpenseId: oid(),
    approvedBy: oid(),
    resolutionNotes: "notes",
  }));
  const loaded = await repairTicketRepository.findById(created._id);
  assert.strictEqual(loaded.vendor, created.vendor);
  assert.strictEqual(loaded.vendorBillPhoto, "https://example.com/b.jpg");
  assert.strictEqual(loaded.repairExpenseId, created.repairExpenseId);
  assert.strictEqual(loaded.approvedBy, created.approvedBy);
  assert.strictEqual(loaded.resolutionNotes, "notes");

  // Clearing an optional reference stores NULL, and the read maps it back to
  // undefined exactly like an unset Mongoose field.
  const cleared = await repairTicketRepository.updateById(created._id, { approvedBy: null, resolutionNotes: null });
  assert.strictEqual(cleared.approvedBy, undefined);
  assert.strictEqual(cleared.resolutionNotes, undefined);
  assert.strictEqual(cleared.vendor, created.vendor, "unrelated optional fields untouched");
  await repairTicketRepository.destroy(created._id);
});

test("PG path: repair ticket updateById enforces enums and returns null for missing ids", async () => {
  const created = await repairTicketRepository.create(ticketBase());
  await assert.rejects(repairTicketRepository.updateById(created._id, { status: "Done" }), /Invalid status: Done/);
  await assert.rejects(repairTicketRepository.updateById(created._id, { priority: "Urgent" }), /Invalid priority: Urgent/);
  await assert.rejects(repairTicketRepository.updateById(created._id, { ticketNumber: "" }), /ticketNumber is required/);
  assert.strictEqual(await repairTicketRepository.updateById("000000000000000000000001", { status: "Closed" }), null);
  await repairTicketRepository.destroy(created._id);
});

// ─── Child (spare parts) semantics + transactions ──────────────────────────
test("PG path: sparePartsUsed replacement is atomic and preserves array order", async () => {
  const created = await repairTicketRepository.create(ticketBase({
    sparePartsUsed: [sparePart({ quantity: 1 }), sparePart({ quantity: 2 })],
  }));
  assert.strictEqual(created.sparePartsUsed.length, 2);

  const updated = await repairTicketRepository.updateById(created._id, {
    sparePartsUsed: [sparePart({ quantity: 7 })],
  });
  assert.strictEqual(updated.sparePartsUsed.length, 1, "array replaced, not appended");
  assert.strictEqual(updated.sparePartsUsed[0].quantity, 7);

  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM repair_ticket_spare_parts WHERE ticket_id = $1",
      [created._id]
    );
    assert.strictEqual(rows[0].n, 1, "no orphaned child rows after replacement");
  } finally {
    await pool.end();
  }
  await repairTicketRepository.destroy(created._id);
});

test("PG path: a failed child insert rolls back the whole ticket (parent + child atomic)", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const countTickets = async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM repair_tickets");
    return rows[0].n;
  };
  try {
    // Occupy a spare-part primary key with a first ticket, then attempt a
    // second ticket whose child INSERT reuses that id. The child INSERT fails
    // inside the transaction, so the new parent repair_tickets row must roll
    // back with it.
    const takenPartId = oid();
    const blocker = await repairTicketRepository.create(ticketBase({
      sparePartsUsed: [{ id: takenPartId, item: oid(), quantity: 1 }],
    }));

    const before = await countTickets();
    await assert.rejects(
      repairTicketRepository.create(ticketBase({
        sparePartsUsed: [{ id: takenPartId, item: oid(), quantity: 2 }],
      })),
      /duplicate key value violates unique constraint "repair_ticket_spare_parts_pkey"/
    );
    assert.strictEqual(await countTickets(), before, "no partial parent row left behind");
    await repairTicketRepository.destroy(blocker._id);
  } finally {
    await pool.end();
  }
});

test("PG path: a failed child replacement rolls back the parent update too", async () => {
  const takenPartId = oid();
  const blocker = await repairTicketRepository.create(ticketBase({
    sparePartsUsed: [{ id: takenPartId, item: oid(), quantity: 1 }],
  }));
  const created = await repairTicketRepository.create(ticketBase({ status: "Reported" }));
  await assert.rejects(
    repairTicketRepository.updateById(created._id, {
      status: "Completed",
      sparePartsUsed: [{ id: takenPartId, item: oid(), quantity: 2 }],
    }),
    /duplicate key value violates unique constraint "repair_ticket_spare_parts_pkey"/
  );
  const reloaded = await repairTicketRepository.findById(created._id);
  assert.strictEqual(reloaded.status, "Reported", "parent update rolled back with the failed child insert");
  await repairTicketRepository.destroy(created._id);
  await repairTicketRepository.destroy(blocker._id);
});

test("PG path: spare parts cascade away when the parent ticket is deleted", async () => {
  const created = await repairTicketRepository.create(ticketBase({ sparePartsUsed: [sparePart(), sparePart()] }));
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const before = await pool.query(
      "SELECT count(*)::int AS n FROM repair_ticket_spare_parts WHERE ticket_id = $1",
      [created._id]
    );
    assert.strictEqual(before.rows[0].n, 2, "child rows present before delete");

    assert.strictEqual(await repairTicketRepository.destroy(created._id), true);
    assert.strictEqual(await repairTicketRepository.destroy(created._id), false, "second delete is a no-op");

    const after = await pool.query(
      "SELECT count(*)::int AS n FROM repair_ticket_spare_parts WHERE ticket_id = $1",
      [created._id]
    );
    assert.strictEqual(after.rows[0].n, 0, "child rows cascaded with the parent");
  } finally {
    await pool.end();
  }
});

test("PG path: repair request destroy reports existence and has no child rows to cascade", async () => {
  const created = await repairRequestRepository.create(requestBase());
  assert.strictEqual(await repairRequestRepository.destroy(created._id), true);
  assert.strictEqual(await repairRequestRepository.destroy(created._id), false);
});

// ─── duplicate key semantics ───────────────────────────────────────────────
test("PG path: duplicate ticketNumber surfaces a unique-violation like Mongo 11000", async () => {
  const first = await repairTicketRepository.create(ticketBase({ ticketNumber: "TKT-DUP" }));
  await assert.rejects(
    repairTicketRepository.create(ticketBase({ ticketNumber: "TKT-DUP" })),
    /duplicate key value violates unique constraint "repair_tickets_ticket_number_key"/
  );
  await repairTicketRepository.destroy(first._id);
});

test("PG path: repair_requests has no unique constraint (the Mongo model declares none)", async () => {
  const assetId = oid();
  const description = "duplicate-description";
  const a = await repairRequestRepository.create({ asset: assetId, description });
  const b = await repairRequestRepository.create({ asset: assetId, description });
  assert.notStrictEqual(a._id, b._id);
  await repairRequestRepository.destroy(a._id);
  await repairRequestRepository.destroy(b._id);
});

// ─── filters / count / sort / pagination ───────────────────────────────────
test("PG path: repair request findMany filters by asset/status/vendor/createdBy and supports $in", async () => {
  const assetId = oid();
  const a = await repairRequestRepository.create({ asset: assetId, description: "d1", status: "Pending", vendor: "V1", createdBy: "u1" });
  const b = await repairRequestRepository.create({ asset: assetId, description: "d2", status: "Completed", vendor: "V2" });
  const c = await repairRequestRepository.create({ asset: oid(), description: "d3", status: "Cancelled", vendor: "V1" });
  const ids = [a._id, b._id, c._id];
  const byIds = (filter) => repairRequestRepository.findMany({ filter: { id: { $in: ids }, ...filter } });

  assert.strictEqual((await byIds({ asset: assetId })).length, 2);
  assert.strictEqual((await byIds({ status: "Pending" })).length, 1);
  assert.strictEqual((await byIds({ status: { $in: ["Pending", "Completed"] } })).length, 2);
  assert.strictEqual((await byIds({ status: { $in: [] } })).length, 0, "$in: [] matches nothing");
  assert.strictEqual((await byIds({ vendor: "V1" })).length, 2);
  assert.strictEqual((await byIds({ createdBy: "u1" })).length, 1);
  assert.strictEqual((await repairRequestRepository.findMany({ filter: { status: { $in: [] } } })).length, 0);
  await assert.rejects(byIds({ status: "Done" }), /Invalid status: Done/);

  for (const id of ids) await repairRequestRepository.destroy(id);
});

test("PG path: repair request count honors filters and $in", async () => {
  const assetId = oid();
  const a = await repairRequestRepository.create({ asset: assetId, description: "c1", status: "Pending" });
  const b = await repairRequestRepository.create({ asset: assetId, description: "c2", status: "Completed" });
  assert.strictEqual(await repairRequestRepository.count({ asset: assetId }), 2);
  assert.strictEqual(await repairRequestRepository.count({ asset: assetId, status: "Pending" }), 1);
  assert.strictEqual(await repairRequestRepository.count({ asset: assetId, status: { $in: ["Pending", "Completed"] } }), 2);
  assert.strictEqual(await repairRequestRepository.count({ status: { $in: [] } }), 0);
  await repairRequestRepository.destroy(a._id);
  await repairRequestRepository.destroy(b._id);
});

test("PG path: repair request findMany sorts (whitelist) and paginates", async () => {
  const assetId = oid();
  const created = [];
  for (const cost of ["3", "1", "2"]) {
    created.push(await repairRequestRepository.create({ asset: assetId, description: `sort-${cost}`, cost }));
  }
  const idFilter = { id: { $in: created.map((r) => r._id) } };
  const sorted = await repairRequestRepository.findMany({ filter: idFilter, sort: { cost: 1 } });
  assert.deepStrictEqual(sorted.map((r) => r.cost), [1, 2, 3]);
  const paged = await repairRequestRepository.findMany({ filter: idFilter, sort: { cost: 1 }, limit: 2, offset: 1 });
  assert.deepStrictEqual(paged.map((r) => r.cost), [2, 3]);
  const hostile = await repairRequestRepository.findMany({ filter: idFilter, sort: { "x; DROP TABLE repair_requests--": -1 } });
  assert.strictEqual(hostile.length, 3, "hostile sort key falls back safely");
  for (const r of created) await repairRequestRepository.destroy(r._id);
});

test("PG path: repair ticket findMany filters by asset/status/priority/reportedBy/approvedBy", async () => {
  const assetId = oid();
  const reporter = oid();
  const approver = oid();
  const a = await repairTicketRepository.create(ticketBase({ asset: assetId, reportedBy: reporter, status: "Reported", priority: "High", approvedBy: approver }));
  const b = await repairTicketRepository.create(ticketBase({ asset: assetId, reportedBy: oid(), status: "Closed", priority: "Low" }));
  const c = await repairTicketRepository.create(ticketBase({ asset: oid(), status: "Approved", priority: "Critical" }));
  const ids = [a._id, b._id, c._id];
  const byIds = (filter) => repairTicketRepository.findMany({ filter: { id: { $in: ids }, ...filter } });

  assert.strictEqual((await byIds({ asset: assetId })).length, 2, "per-asset maintenance history filter");
  assert.strictEqual((await byIds({ reportedBy: reporter })).length, 1);
  assert.strictEqual((await byIds({ approvedBy: approver })).length, 1);
  assert.strictEqual((await byIds({ status: "Reported" })).length, 1);
  assert.strictEqual((await byIds({ status: { $in: ["Reported", "Closed"] } })).length, 2);
  assert.strictEqual((await byIds({ priority: "Critical" })).length, 1);
  assert.strictEqual((await byIds({ priority: { $in: ["High", "Critical"] } })).length, 2);
  assert.strictEqual((await byIds({ status: { $in: [] } })).length, 0);
  await assert.rejects(byIds({ priority: "Urgent" }), /Invalid priority: Urgent/);

  for (const id of ids) await repairTicketRepository.destroy(id);
});

test("PG path: repair ticket findMany sorts by createdAt DESC (public maintenance history) and paginates", async () => {
  const assetId = oid();
  const created = [];
  for (const n of ["a", "b", "c"]) {
    created.push(await repairTicketRepository.create(ticketBase({ asset: assetId, issueDescription: n })));
  }
  const idFilter = { id: { $in: created.map((r) => r._id) } };
  const sorted = await repairTicketRepository.findMany({ filter: idFilter, sort: { createdAt: -1 } });
  assert.deepStrictEqual(sorted.map((r) => r._id), [...created].reverse().map((r) => r._id));
  const paged = await repairTicketRepository.findMany({ filter: idFilter, sort: { createdAt: -1 }, limit: 2 });
  assert.strictEqual(paged.length, 2);
  const hostile = await repairTicketRepository.findMany({ filter: idFilter, sort: { "1=1; DROP TABLE repair_tickets": 1 } });
  assert.strictEqual(hostile.length, 3, "hostile sort key falls back safely");
  for (const r of created) await repairTicketRepository.destroy(r._id);
});

test("PG path: repair ticket count honors filters", async () => {
  const assetId = oid();
  const a = await repairTicketRepository.create(ticketBase({ asset: assetId, status: "Reported" }));
  const b = await repairTicketRepository.create(ticketBase({ asset: assetId, status: "Closed" }));
  assert.strictEqual(await repairTicketRepository.count({ asset: assetId }), 2);
  assert.strictEqual(await repairTicketRepository.count({ asset: assetId, status: "Reported" }), 1);
  assert.strictEqual(await repairTicketRepository.count({ asset: assetId, status: { $in: ["Reported", "Closed"] } }), 2);
  assert.strictEqual(await repairTicketRepository.count({ status: { $in: [] } }), 0);
  await repairTicketRepository.destroy(a._id);
  await repairTicketRepository.destroy(b._id);
});

// ─── no dual writes ────────────────────────────────────────────────────────
test("PG path: a single service create writes exactly one row and never touches MongoDB", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  let before;
  try {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM repair_requests");
    before = rows[0].n;
  } finally {
    await pool.end();
  }

  const created = await repairRequestService.create(requestBase());
  assert.strictEqual(await repairRequestRepository.count({}), before + 1, "exactly one new repair_requests row");
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected — nothing could have been written to MongoDB");
  await repairRequestRepository.destroy(created._id);
});

test("PG path: a single repair ticket create writes one parent + its children and never touches MongoDB", async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  let before;
  let childBefore;
  try {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM repair_tickets");
    before = rows[0].n;
    const { rows: c } = await pool.query("SELECT count(*)::int AS n FROM repair_ticket_spare_parts");
    childBefore = c[0].n;
  } finally {
    await pool.end();
  }

  const created = await repairTicketService.create(ticketBase({ sparePartsUsed: [sparePart(), sparePart()] }));
  assert.strictEqual(await repairTicketRepository.count({}), before + 1, "exactly one new repair_tickets row");
  const pool2 = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool2.query("SELECT count(*)::int AS n FROM repair_ticket_spare_parts");
    assert.strictEqual(rows[0].n, childBefore + 2, "exactly two new child rows");
  } finally {
    await pool2.end();
  }
  assert.strictEqual(mongoose.connection.readyState, 0, "mongoose never connected — no dual write");
  await repairTicketRepository.destroy(created._id);
});

// ─── datasource switching in one process ───────────────────────────────────
test("datasource switching: same process flips between PG and Mongo paths by patching the seam", async () => {
  const realIsDbConnected = originalIsDbConnected;
  try {
    dbConfig.isDbConnected = () => true;
    const pgRequest = await repairRequestService.create(requestBase());
    assert.match(pgRequest._id, /^[0-9a-f]{24}$/);

    // Flip to Mongo — the SAME loaded service module now routes to Mongoose.
    dbConfig.isDbConnected = realIsDbConnected;
    assert.strictEqual(await repairRequestService.usePostgres(), false);

    const countPgRows = async () => {
      const pool = new Pool({ connectionString: TEST_DB_URL });
      try {
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM repair_requests");
        return rows[0].n;
      } finally {
        await pool.end();
      }
    };
    const before = await countPgRows();
    await assert.rejects(
      repairRequestService.create(requestBase()),
      (err) => {
        assert.match(
          String(err.message),
          /MongooseError|ECONNREFUSED|buffering timed out|connect|Path `description` is required/i,
          "Mongo path must actually be invoked"
        );
        return true;
      }
    );
    assert.strictEqual(await countPgRows(), before, "no PG rows written while the Mongo path was selected");

    dbConfig.isDbConnected = () => true;
    const found = await repairRequestService.findById(pgRequest._id);
    assert.ok(found, "PG repair request still exists after switching paths");
    await repairRequestRepository.destroy(pgRequest._id);
  } finally {
    dbConfig.isDbConnected = () => true;
  }
});
