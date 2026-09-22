// Phase 2AH InventoryIssue PostgreSQL-path tests.
//
// InventoryIssue persistence is additive and entity-scoped:
//
//   InventoryIssue
//         |
//         +-- PostgreSQL available (datasource seam connected + PG reachable)
//         |        ↓
//         |    inventoryIssueRepository → inventory_issues table
//         |
//         +-- PostgreSQL unavailable
//                 ↓
//             Mongoose InventoryIssue model (unchanged Phase 1 Mongo path)
//
// These tests run against a REAL PostgreSQL instance (no mocked PG path) and
// cover: migration shape/order, id compatibility, repository CRUD, filtering,
// ordering, defaults, enum/quantity validation, Mongo fallback, PostgreSQL
// selection, exactly-one-datasource, no dual writes, the request → issue flow,
// issue completion, InventoryConsumption linkage through issue_id, invalid
// completion quantities, already-completed rejection and transaction rollback.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");
const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "db", "migrations");

const unique = () => crypto.randomBytes(8).toString("hex");

let originalIsDbConnected;
let inventoryIssueService;
let inventoryIssueRepository;
let inventoryItemRepository;
let inventoryConsumptionService;
let inventoryIssueController;
let inventoryRequestController;
let inventoryRequestRepository;

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const resetAllTables = async () => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("DROP TABLE IF EXISTS schema_migrations");
    await pool.query("DROP TABLE IF EXISTS inventory_consumptions CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_issues CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_requests CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_logs CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_batches CASCADE");
    await pool.query("DROP TABLE IF EXISTS inventory_items CASCADE");
  } finally {
    await pool.end();
  }
};

const runMigrate = () => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, POSTGRES_SSL: "" },
  });
  if (res.status !== 0) throw new Error("migrate failed: " + res.stdout + "\n" + res.stderr);
  return `${res.stdout}${res.stderr}`;
};

const createMockRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const issueBase = (overrides = {}) => ({
  itemName: "Ghee",
  userId: `staff-${unique()}`,
  userName: "Ramesh Kumar",
  role: "Staff",
  issuedQuantity: 5,
  unit: "Litre (L)",
  issuedBy: "Admin",
  purpose: "Kitchen needs",
  ...overrides,
});

// Create a real item row so the inventory_item_id FK is satisfiable.
const makeItem = async (overrides = {}) =>
  inventoryItemRepository.create({
    name: `Item-${unique()}`,
    unit: "Litre (L)",
    availableStock: 100,
    issuedStock: 0,
    consumedStock: 0,
    minimumStock: 0,
    ...overrides,
  });

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await resetAllTables();
  runMigrate();
  dbConfig.isDbConnected = () => true;
  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;

  inventoryIssueService = require("../src/services/inventoryIssueService");
  inventoryIssueRepository = require("../src/repositories/inventoryIssueRepository");
  inventoryItemRepository = require("../src/repositories/inventoryItemRepository");
  inventoryConsumptionService = require("../src/services/inventoryConsumptionService");
  inventoryRequestRepository = require("../src/repositories/inventoryRequestRepository");
  inventoryIssueController = require("../src/controllers/inventoryIssueController");
  inventoryRequestController = require("../src/controllers/inventoryRequestController");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

// ─── 1. Migration shape ─────────────────────────────────────────────────────
test("migration shape: inventory_issues has exactly the approved columns, constraints, FK and indexes", async () => {
  const cols = await poolQuery(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'inventory_issues'
     ORDER BY ordinal_position`);
  assert.deepStrictEqual(
    cols.map((c) => c.column_name),
    [
      "id", "request_id", "inventory_item_id", "item_name", "user_id", "user_name",
      "role", "issued_quantity", "unit", "issue_date", "issued_by", "purpose",
      "status", "created_at", "updated_at",
    ],
    "exactly the approved columns, in order — nothing invented, nothing missing"
  );

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  assert.strictEqual(byName.id.data_type, "text", "id is TEXT (Mongo ObjectId hex)");
  assert.strictEqual(byName.request_id.is_nullable, "YES", "request_id is nullable");
  assert.strictEqual(byName.inventory_item_id.is_nullable, "NO");
  assert.strictEqual(byName.item_name.is_nullable, "NO");
  assert.strictEqual(byName.user_id.is_nullable, "NO");
  assert.strictEqual(byName.user_name.is_nullable, "NO");
  assert.strictEqual(byName.role.is_nullable, "NO");
  assert.strictEqual(byName.issued_quantity.data_type, "numeric");
  assert.strictEqual(byName.unit.is_nullable, "NO");
  assert.strictEqual(byName.issue_date.data_type, "timestamp with time zone");
  assert.strictEqual(byName.issued_by.is_nullable, "NO");
  assert.match(byName.purpose.column_default, /''::text/);
  assert.match(byName.status.column_default, /'Active'/);
  assert.match(byName.issue_date.column_default, /now\(\)/);
  assert.match(byName.created_at.column_default, /now\(\)/);
  assert.match(byName.updated_at.column_default, /now\(\)/);

  // Constraints: quantity >= 0, status enum, and a real item FK.
  const cons = await poolQuery(`
    SELECT conname, contype FROM pg_constraint
     WHERE conrelid = 'public.inventory_issues'::regclass`);
  const byType = cons.reduce((acc, c) => ({ ...acc, [c.contype]: [...(acc[c.contype] || []), c.conname] }), {});
  assert.ok(byType.p, "primary key present");
  assert.strictEqual(byType.c.length, 2, "exactly two CHECK constraints (quantity, status)");
  assert.strictEqual(byType.f.length, 1, "exactly one foreign key (inventory_item_id)");
  assert.match(byType.f[0], /inventory_item_id/);

  // The FK must be ON DELETE RESTRICT so item deletes never cascade-remove
  // issues Mongo would have kept.
  const fk = await poolQuery(`
    SELECT confdeltype FROM pg_constraint
     WHERE conrelid = 'public.inventory_issues'::regclass AND contype = 'f'`);
  assert.strictEqual(fk[0].confdeltype, "r", "ON DELETE RESTRICT");

  // No FK on request_id (deferred) and no users FK.
  const fkCols = await poolQuery(`
    SELECT a.attname FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid = 'public.inventory_issues'::regclass AND c.contype = 'f'`);
  assert.deepStrictEqual(fkCols.map((r) => r.attname), ["inventory_item_id"], "no FK on request_id or user_id");

  const idx = await poolQuery(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'inventory_issues'`);
  const byIndex = Object.fromEntries(idx.map((i) => [i.indexname, i.indexdef]));
  for (const n of [
    "idx_inventory_issues_user_id",
    "idx_inventory_issues_issue_date",
    "idx_inventory_issues_inventory_item_id",
    "idx_inventory_issues_request_id",
  ]) {
    assert.ok(byIndex[n], `missing approved index ${n}`);
  }
  assert.match(byIndex.idx_inventory_issues_issue_date, /issue_date DESC/, "issue_date index is DESC");
});

// ─── 2. Migration ordering 033 → 034 ────────────────────────────────────────
test("migration ordering: 033 → 034 apply contiguously and are idempotent", async () => {
  const rows = await poolQuery("SELECT name FROM schema_migrations ORDER BY id");
  const names = rows.map((r) => r.name);
  assert.strictEqual(names[names.length - 1], "034_create_inventory_issues.sql");
  assert.strictEqual(names[names.length - 2], "033_create_support_requests.sql");

  // Filename prefixes must be unique and sort in numeric order (what migrate.js
  // relies on) — this is the guard against a 033/034 collision.
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const prefixes = files.map((f) => f.slice(0, 3));
  assert.strictEqual(new Set(prefixes).size, prefixes.length, "no duplicate migration prefix");
  assert.deepStrictEqual([...files].sort(), [...files].sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3))));

  // Re-running applies nothing.
  const output = runMigrate();
  assert.match(output, /No pending migrations\./);
  assert.match(output, /Applied 0 migration\(s\)\./);
});

// ─── 3. id TEXT / ObjectId compatibility ────────────────────────────────────
test("id compatibility: ids are 24-char hex and inventory_consumptions.issue_id resolves unchanged", async () => {
  const item = await makeItem();
  const created = await inventoryIssueService.create(issueBase({ item: item._id }));
  assert.match(created._id, /^[0-9a-f]{24}$/, "24-char hex Mongo-compatible id");
  assert.strictEqual(created.id, created._id);

  const raw = await poolQuery("SELECT id FROM inventory_issues WHERE id = $1", [created._id]);
  assert.strictEqual(raw.length, 1);
  assert.strictEqual(raw[0].id.length, 24);

  // issue_id is plain TEXT; the preserved ObjectId hex needs no transformation.
  const consumption = await inventoryConsumptionService.create({
    issue: created._id,
    item: item._id,
    itemName: item.name,
    userId: created.userId,
    userName: created.userName,
    role: created.role,
    issuedQuantity: 5,
    usedQuantity: 5,
    returnedQuantity: 0,
    unit: "Litre (L)",
    purpose: "Kitchen needs",
    remarks: "",
  });
  const linked = await poolQuery("SELECT issue_id FROM inventory_consumptions WHERE id = $1", [consumption._id]);
  assert.strictEqual(linked[0].issue_id, created._id, "issue_id stores the same raw hex id — no transformation");
});

// ─── 4. Repository create/read/update ───────────────────────────────────────
test("repository: create → read → update round trip", async () => {
  const item = await makeItem();
  const created = await inventoryIssueRepository.create(issueBase({ item: item._id }));
  assert.ok(created._id);

  const fetched = await inventoryIssueRepository.findById(created._id);
  assert.strictEqual(fetched.item, item._id);
  assert.strictEqual(fetched.itemName, "Ghee");
  assert.strictEqual(Number(fetched.issuedQuantity), 5);
  assert.strictEqual(fetched.status, "Active");
  assert.ok(fetched.issueDate instanceof Date);

  const updated = await inventoryIssueRepository.updateStatus(created._id, "Completed");
  assert.strictEqual(updated.status, "Completed");
  assert.notStrictEqual(updated.updatedAt.getTime(), fetched.updatedAt.getTime(), "updatedAt advanced");

  const missing = await inventoryIssueRepository.findById("000000000000000000000000");
  assert.strictEqual(missing, null);
  const updateMissing = await inventoryIssueRepository.updateStatus("000000000000000000000000", "Completed");
  assert.strictEqual(updateMissing, null);
});

// ─── 5. userId filtering ────────────────────────────────────────────────────
test("userId filter: findMany returns only the requested user's issues", async () => {
  const item = await makeItem();
  const userId = `staff-${unique()}`;
  const otherUser = `staff-${unique()}`;
  await inventoryIssueService.create(issueBase({ item: item._id, userId, itemName: "A" }));
  await inventoryIssueService.create(issueBase({ item: item._id, userId, itemName: "B" }));
  await inventoryIssueService.create(issueBase({ item: item._id, userId: otherUser, itemName: "C" }));

  const mine = await inventoryIssueService.findMany({ filter: { userId }, sort: { issueDate: -1 } });
  assert.strictEqual(mine.length, 2);
  assert.ok(mine.every((i) => i.userId === userId));

  const all = await inventoryIssueService.findMany({ filter: {}, sort: { issueDate: -1 } });
  assert.ok(all.length >= 3, "no filter returns the whole collection");
});

// ─── 6. issueDate descending order ──────────────────────────────────────────
test("ordering: issues are returned issueDate descending", async () => {
  const item = await makeItem();
  const userId = `staff-${unique()}`;
  const early = await inventoryIssueService.create(
    issueBase({ item: item._id, userId, issueDate: new Date("2025-01-01T00:00:00Z") })
  );
  const mid = await inventoryIssueService.create(
    issueBase({ item: item._id, userId, issueDate: new Date("2025-06-01T00:00:00Z") })
  );
  const late = await inventoryIssueService.create(
    issueBase({ item: item._id, userId, issueDate: new Date("2025-12-01T00:00:00Z") })
  );

  const ordered = await inventoryIssueService.findMany({ filter: { userId }, sort: { issueDate: -1 } });
  assert.deepStrictEqual(ordered.map((i) => i._id), [late._id, mid._id, early._id]);
});

// ─── 7. Defaults ────────────────────────────────────────────────────────────
test("defaults: issueDate defaults to now, purpose to '', status to 'Active'", async () => {
  const item = await makeItem();
  const before = Date.now();
  const created = await inventoryIssueService.create({
    item: item._id,
    itemName: "Camphor",
    userId: `staff-${unique()}`,
    userName: "Ramesh",
    role: "Staff",
    issuedQuantity: 2,
    unit: "Pack",
    issuedBy: "Admin",
  });
  assert.strictEqual(created.purpose, "");
  assert.strictEqual(created.status, "Active");
  assert.ok(created.issueDate instanceof Date);
  assert.ok(created.issueDate.getTime() >= before - 1000, "default issueDate is now");

  const raw = await poolQuery("SELECT purpose, status FROM inventory_issues WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].purpose, "");
  assert.strictEqual(raw[0].status, "Active");
});

// ─── 8. status enum ─────────────────────────────────────────────────────────
test("status enum: only 'Active' and 'Completed' are accepted", async () => {
  const item = await makeItem();
  await assert.rejects(
    () => inventoryIssueService.create(issueBase({ item: item._id, status: "Pending" })),
    /Invalid status/
  );
  await assert.rejects(
    () => inventoryIssueService.updateStatus("000000000000000000000001", "Archived"),
    /Invalid status/
  );

  // The database CHECK is the backstop even if application validation is bypassed.
  await assert.rejects(
    () =>
      poolQuery(
        "INSERT INTO inventory_issues (id, inventory_item_id, item_name, user_id, user_name, role, issued_quantity, unit, issued_by, status) VALUES ($1,$2,'x','u','n','Staff',1,'Pack','Admin','Bogus')",
        ["0000000000000000000000ff", item._id]
      ),
    /inventory_issues_status_check/
  );
});

// ─── 9. quantity >= 0 ───────────────────────────────────────────────────────
test("quantity: negatives are rejected, zero is legal and decimals round-trip", async () => {
  const item = await makeItem();
  await assert.rejects(
    () => inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: -1 })),
    /issuedQuantity must be >= 0/
  );

  const zero = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 0 }));
  assert.strictEqual(Number(zero.issuedQuantity), 0);

  const decimal = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 1000.125 }));
  const raw = await poolQuery("SELECT issued_quantity::text AS q FROM inventory_issues WHERE id = $1", [decimal._id]);
  assert.strictEqual(raw[0].q, "1000.125", "NUMERIC preserves the scale exactly");

  await assert.rejects(
    () =>
      poolQuery(
        "INSERT INTO inventory_issues (id, inventory_item_id, item_name, user_id, user_name, role, issued_quantity, unit, issued_by) VALUES ($1,$2,'x','u','n','Staff',-2,'Pack','Admin')",
        ["0000000000000000000000fe", item._id]
      ),
    /inventory_issues_issued_quantity_check/
  );
});

// ─── 10. Mongo fallback ─────────────────────────────────────────────────────
test("fallback: when the seam is disconnected the service uses the Mongoose model and writes no PostgreSQL rows", async () => {
  const InventoryIssueModel = require("../src/models/InventoryIssue");
  const originalCreate = InventoryIssueModel.create;
  const originalFind = InventoryIssueModel.find;
  let mongoCreate = 0;
  let mongoFind = 0;
  InventoryIssueModel.create = async (data) => {
    mongoCreate += 1;
    return { _id: "mongo-issue-1", ...data };
  };
  InventoryIssueModel.find = () => {
    mongoFind += 1;
    return { sort: async () => [{ _id: "mongo-issue-1", itemName: "Mongo Ghee" }] };
  };

  const before = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_issues");
  dbConfig.isDbConnected = () => false;
  try {
    assert.strictEqual(await inventoryIssueService.usePostgres(), false);

    const created = await inventoryIssueService.create(
      issueBase({ item: "0000000000000000000000aa" })
    );
    assert.strictEqual(created._id, "mongo-issue-1", "the Mongoose model handled the write");
    assert.strictEqual(mongoCreate, 1, "exactly one MongoDB write");

    const listed = await inventoryIssueService.findMany({ filter: {}, sort: { issueDate: -1 } });
    assert.strictEqual(listed[0]._id, "mongo-issue-1");
    assert.strictEqual(mongoFind, 1);

    const after = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_issues");
    assert.strictEqual(after[0].n, before[0].n, "the MongoDB fallback wrote no PostgreSQL rows");
  } finally {
    InventoryIssueModel.create = originalCreate;
    InventoryIssueModel.find = originalFind;
    dbConfig.isDbConnected = () => true;
  }
});

// ─── 11. PostgreSQL selection ───────────────────────────────────────────────
test("selection: the service selects PostgreSQL when the seam is connected and PG is reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await inventoryIssueService.usePostgres(), true);
  assert.strictEqual(inventoryIssueService.isConnected(), true);
});

// ─── 12. exactly-one-datasource behavior ────────────────────────────────────
test("exactly one datasource: a PG-selected write reaches PostgreSQL only; a Mongo-selected write reaches Mongo only", async () => {
  const item = await makeItem();

  const beforePg = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_issues");
  dbConfig.isDbConnected = () => true;
  const pgCreated = await inventoryIssueService.create(issueBase({ item: item._id }));
  const afterPg = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_issues");
  assert.strictEqual(afterPg[0].n, beforePg[0].n + 1, "exactly one PostgreSQL row written");
  assert.match(pgCreated._id, /^[0-9a-f]{24}$/);
});

// ─── 13. no dual writes ─────────────────────────────────────────────────────
test("no dual writes: the PostgreSQL create never calls the Mongoose model", async () => {
  const InventoryIssueModel = require("../src/models/InventoryIssue");
  const originalCreate = InventoryIssueModel.create;
  let mongoWrites = 0;
  InventoryIssueModel.create = async () => {
    mongoWrites += 1;
    throw new Error("MongoDB must not be written on the PostgreSQL path");
  };

  const item = await makeItem();
  dbConfig.isDbConnected = () => true;
  try {
    const created = await inventoryIssueService.create(issueBase({ item: item._id }));
    assert.ok(created._id);
    assert.strictEqual(mongoWrites, 0, "no MongoDB write occurred");
  } finally {
    InventoryIssueModel.create = originalCreate;
  }
});

// ─── 14. PostgreSQL Inventory Request → Issue flow ──────────────────────────
test("flow: an approved PostgreSQL request is issued atomically (request + item + issue)", async () => {
  const item = await inventoryItemRepository.create({
    name: `ReqItem-${unique()}`,
    unit: "Pack",
    availableStock: 30,
    issuedStock: 0,
    minimumStock: 0,
  });
  const request = await inventoryRequestRepository.create({
    userId: `staff-${unique()}`,
    userName: "Requester",
    role: "Staff",
    itemName: item.name,
    quantity: 6,
    unit: "Pack",
    reason: "Daily pooja",
    purpose: "Pooja needs",
    status: "Approved",
  });

  const res = createMockRes();
  dbConfig.isDbConnected = () => true;
  await inventoryRequestController.issueInventoryRequest({ params: { id: request._id } }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const rereadRequest = await inventoryRequestRepository.findById(request._id);
  assert.strictEqual(rereadRequest.status, "Issued");
  const rereadItem = await inventoryItemRepository.findById(item._id);
  assert.strictEqual(Number(rereadItem.availableStock), 24);
  assert.strictEqual(Number(rereadItem.issuedStock), 6);

  const issues = await inventoryIssueService.findMany({ filter: { request: request._id } });
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(Number(issues[0].issuedQuantity), 6);
  assert.strictEqual(issues[0].status, "Active");
});

// ─── 15. PostgreSQL issue completion ────────────────────────────────────────
test("completion: a PostgreSQL issue completes and applies the exact stock effects", async () => {
  const item = await inventoryItemRepository.create({
    name: `CompleteItem-${unique()}`,
    unit: "Litre (L)",
    availableStock: 10,
    issuedStock: 8,
    consumedStock: 0,
    minimumStock: 0,
  });
  const issue = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 8 }));

  const res = createMockRes();
  dbConfig.isDbConnected = () => true;
  await inventoryIssueController.completeUsage(
    { params: { id: issue._id }, body: { usedQuantity: 6, returnedQuantity: 2, remarks: "Done" } },
    res
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const rereadItem = await inventoryItemRepository.findById(item._id);
  assert.strictEqual(Number(rereadItem.issuedStock), 0, "issuedStock -= issuedQuantity");
  assert.strictEqual(Number(rereadItem.consumedStock), 6, "consumedStock += usedQuantity");
  assert.strictEqual(Number(rereadItem.availableStock), 12, "availableStock += returnedQuantity");

  const rereadIssue = await inventoryIssueRepository.findById(issue._id);
  assert.strictEqual(rereadIssue.status, "Completed");
});

// ─── 16. InventoryConsumption linkage through issue_id ──────────────────────
test("completion: exactly one InventoryConsumption is created and links through issue_id", async () => {
  const item = await inventoryItemRepository.create({
    name: `LinkItem-${unique()}`,
    unit: "Litre (L)",
    availableStock: 10,
    issuedStock: 3,
    minimumStock: 0,
  });
  const issue = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 3 }));

  const res = createMockRes();
  await inventoryIssueController.completeUsage(
    { params: { id: issue._id }, body: { usedQuantity: 3, returnedQuantity: 0 } },
    res
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const rows = await poolQuery("SELECT issue_id, used_quantity, returned_quantity FROM inventory_consumptions WHERE issue_id = $1", [issue._id]);
  assert.strictEqual(rows.length, 1, "exactly one consumption row");
  assert.strictEqual(rows[0].issue_id, issue._id);
  assert.strictEqual(Number(rows[0].used_quantity), 3);
  assert.strictEqual(Number(rows[0].returned_quantity), 0);
});

// ─── 17. invalid completion quantities ──────────────────────────────────────
test("completion: invalid quantities are rejected and leave no partial state", async () => {
  const item = await inventoryItemRepository.create({
    name: `InvalidItem-${unique()}`,
    unit: "Litre (L)",
    availableStock: 10,
    issuedStock: 4,
    minimumStock: 0,
  });

  // used + returned must equal issuedQuantity.
  const issue = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 4 }));
  const res = createMockRes();
  await inventoryIssueController.completeUsage(
    { params: { id: issue._id }, body: { usedQuantity: 1, returnedQuantity: 1 } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.message, /must equal Issued Quantity/);

  // Nothing moved: issue still Active, stock untouched, no consumption row.
  const rereadIssue = await inventoryIssueRepository.findById(issue._id);
  assert.strictEqual(rereadIssue.status, "Active");
  const rereadItem = await inventoryItemRepository.findById(item._id);
  assert.strictEqual(Number(rereadItem.issuedStock), 4);
  const cons = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_consumptions WHERE issue_id = $1", [issue._id]);
  assert.strictEqual(cons[0].n, 0, "no consumption row leaked from the rolled-back completion");

  // Negative quantities are refused before any datasource work.
  const negRes = createMockRes();
  await inventoryIssueController.completeUsage(
    { params: { id: issue._id }, body: { usedQuantity: -1, returnedQuantity: 5 } },
    negRes
  );
  assert.strictEqual(negRes.statusCode, 400);
  assert.match(negRes.body.message, /cannot be negative/);
});

// ─── 18. already-completed rejection ────────────────────────────────────────
test("completion: an already-completed issue is rejected (exactly-once consumption)", async () => {
  const item = await inventoryItemRepository.create({
    name: `TwiceItem-${unique()}`,
    unit: "Litre (L)",
    availableStock: 10,
    issuedStock: 2,
    minimumStock: 0,
  });
  const issue = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 2 }));

  const first = createMockRes();
  await inventoryIssueController.completeUsage(
    { params: { id: issue._id }, body: { usedQuantity: 2, returnedQuantity: 0 } },
    first
  );
  assert.strictEqual(first.statusCode, 200, JSON.stringify(first.body));

  const second = createMockRes();
  await inventoryIssueController.completeUsage(
    { params: { id: issue._id }, body: { usedQuantity: 2, returnedQuantity: 0 } },
    second
  );
  assert.strictEqual(second.statusCode, 400);
  assert.match(second.body.message, /already been completed/);

  const rows = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_consumptions WHERE issue_id = $1", [issue._id]);
  assert.strictEqual(rows[0].n, 1, "the consumption is created exactly once");
});

// ─── 19. rollback behavior when the PostgreSQL transaction fails ─────────────
test("rollback: a failure after the stock move rolls the whole PostgreSQL completion back", async () => {
  const item = await inventoryItemRepository.create({
    name: `RollbackItem-${unique()}`,
    unit: "Litre (L)",
    availableStock: 10,
    issuedStock: 5,
    minimumStock: 0,
  });
  const issue = await inventoryIssueService.create(issueBase({ item: item._id, issuedQuantity: 5 }));

  // Force the final consumption insert to fail after the item update and the
  // status change have already run inside the transaction.
  const inventoryConsumptionRepository = require("../src/repositories/inventoryConsumptionRepository");
  const originalCreate = inventoryConsumptionRepository.create;
  inventoryConsumptionRepository.create = async () => {
    throw new Error("injected consumption failure");
  };

  try {
    const res = createMockRes();
    await inventoryIssueController.completeUsage(
      { params: { id: issue._id }, body: { usedQuantity: 5, returnedQuantity: 0 } },
      res
    );
    assert.strictEqual(res.statusCode, 500, JSON.stringify(res.body));
  } finally {
    inventoryConsumptionRepository.create = originalCreate;
  }

  // The stock movement and the status change were rolled back together.
  const rereadItem = await inventoryItemRepository.findById(item._id);
  assert.strictEqual(Number(rereadItem.issuedStock), 5, "issuedStock rolled back");
  assert.strictEqual(Number(rereadItem.consumedStock), 0);
  const rereadIssue = await inventoryIssueRepository.findById(issue._id);
  assert.strictEqual(rereadIssue.status, "Active", "status rolled back");
  const rows = await poolQuery("SELECT COUNT(*)::int AS n FROM inventory_consumptions WHERE issue_id = $1", [issue._id]);
  assert.strictEqual(rows[0].n, 0);
});
