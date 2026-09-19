// Phase 2AE controller-level tests for the Donations endpoints.
//
// These drive the real donationController handlers (not the service in
// isolation) so the API contract is verified end-to-end:
//   - createDonation / getAllDonations / getDonationStats / deleteDonation /
//     updateDonationStatus persist and read through the PostgreSQL repository
//     when the datasource seam selects PostgreSQL,
//   - the same handlers fall back to Mongoose when the seam selects Mongo,
//   - a write reaches exactly one datasource (no dual persistence),
//   - validation, response shapes and the Bill / accounting side effects are
//     unchanged from before the wiring.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const Donation = require("../src/models/Donation");
const Bill = require("../src/models/Bill");
const accountingService = require("../src/services/accountingService");
const donationController = require("../src/controllers/donationController");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const emailFor = (tag) => `${tag}-${unique()}@example.com`;

let originalIsDbConnected;
let originalBill;
let originalRecordTransaction;

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    for (const row of rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    }
  } finally {
    await pool.end();
  }
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

const createMockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const pinConnected = () => { dbConfig.isDbConnected = () => true; };
const pinDisconnected = () => { dbConfig.isDbConnected = () => false; };

// The Bill writes and the accounting transaction are cross-domain side effects
// that stay on their existing (Mongo-only) path; they are captured here so the
// tests can prove the wiring preserved them without touching real Mongo state.
const stubSideEffects = () => {
  const calls = { billCreate: [], billDelete: [], billUpdate: [], txns: [] };
  Bill.create = async (data) => { calls.billCreate.push(data); return { ...data, _id: "bill_" + unique() }; };
  Bill.deleteMany = async (filter) => { calls.billDelete.push(filter); return { deletedCount: 1 }; };
  Bill.updateMany = async (filter, update) => { calls.billUpdate.push([filter, update]); return { modifiedCount: 1 }; };
  accountingService.recordTransaction = async (payload) => { calls.txns.push(payload); return { _id: "txn_" + unique() }; };
  return calls;
};

const validBody = (overrides = {}) => ({
  donorName: "Asha Rao",
  donorEmail: "Asha@Example.com",
  amount: "1500.5",
  category: "Annadanam",
  paymentMethod: "UPI",
  contactNumber: "+91 9000000000",
  notes: "General fund",
  status: "Completed",
  ...overrides,
});

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  originalBill = {
    create: Bill.create,
    deleteMany: Bill.deleteMany,
    updateMany: Bill.updateMany,
  };
  originalRecordTransaction = accountingService.recordTransaction;

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
  pinConnected();
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  Bill.create = originalBill.create;
  Bill.deleteMany = originalBill.deleteMany;
  Bill.updateMany = originalBill.updateMany;
  accountingService.recordTransaction = originalRecordTransaction;
  await closePostgres();
});

// ─── PostgreSQL path ───────────────────────────────────────────────────────
test("donation controller (PG): createDonation persists through the service and keeps the response shape", async () => {
  const calls = stubSideEffects();
  const res = createMockRes();
  await donationController.createDonation(
    { body: validBody({ donorName: "  Asha Rao  " }), user: { id: "0000000000000000000000u1" } },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.message, "Donation added successfully");
  assert.ok(res.body.donation._id, "the created donation is returned");
  assert.strictEqual(res.body.donation.donorName, "Asha Rao");
  assert.strictEqual(res.body.donation.donorEmail, "asha@example.com", "email is lowercased like Mongo");
  assert.strictEqual(res.body.donation.amount, 1500.5);
  assert.strictEqual(res.body.donation.category, "Annadanam");
  assert.strictEqual(res.body.donation.status, "Completed");

  // The row really landed in PostgreSQL.
  const rows = await pgQuery(
    "SELECT donor_name, donor_email, amount::text AS amount, status FROM donations WHERE id = $1",
    [res.body.donation._id]
  );
  assert.strictEqual(rows.length, 1, "the donation exists in PostgreSQL");
  assert.strictEqual(rows[0].donor_name, "Asha Rao");
  assert.strictEqual(rows[0].donor_email, "asha@example.com");
  assert.strictEqual(rows[0].amount, "1500.5");
  assert.strictEqual(rows[0].status, "Completed");

  // Side effects preserved: a Donation bill and one accounting credit.
  assert.strictEqual(calls.billCreate.length, 1, "a Bill row is still created");
  assert.strictEqual(calls.billCreate[0].billType, "Donation");
  assert.strictEqual(calls.billCreate[0].sourceId, res.body.donation._id);
  assert.strictEqual(calls.billCreate[0].status, "Paid");
  assert.strictEqual(calls.txns.length, 1, "an accounting transaction is still recorded");
  assert.strictEqual(calls.txns[0].transactionType, "Credit");
  assert.strictEqual(calls.txns[0].source, "Donation");
  assert.strictEqual(calls.txns[0].category, "Annadanam Donation", "the fund is mapped from the category");
  assert.strictEqual(calls.txns[0].referenceId, res.body.donation._id);
});

test("donation controller (PG): a Pending donation records no accounting transaction", async () => {
  const calls = stubSideEffects();
  const res = createMockRes();
  await donationController.createDonation(
    { body: validBody({ donorName: "Pending Donor", status: "Pending" }), user: { id: "u2" } },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.donation.status, "Pending");
  assert.strictEqual(calls.billCreate.length, 1);
  assert.strictEqual(calls.billCreate[0].status, "Pending");
  assert.strictEqual(calls.txns.length, 0, "no ledger entry until the donation is collected");
});

test("donation controller (PG): getAllDonations and getDonationStats read the PostgreSQL table", async () => {
  stubSideEffects();
  const tag = unique();
  const create = async (name, amount, status) => {
    const res = createMockRes();
    await donationController.createDonation(
      { body: validBody({ donorName: name, donorEmail: `${name.replace(/\s/g, "").toLowerCase()}-${tag}@example.com`, amount, status }) },
      res
    );
    assert.strictEqual(res.statusCode, 201);
    return res.body.donation;
  };
  const a = await create("List One", "100", "Completed");
  const b = await create("List Two", "250.75", "Pending");

  const listRes = createMockRes();
  await donationController.getAllDonations({}, listRes);
  assert.strictEqual(listRes.statusCode, 200);
  assert.strictEqual(listRes.body.success, true);
  assert.strictEqual(listRes.body.count, listRes.body.donations.length);
  const listedIds = listRes.body.donations.map((d) => d._id);
  assert.ok(listedIds.includes(a._id) && listedIds.includes(b._id), "both PostgreSQL rows are listed");
  assert.ok(listRes.body.donations.length >= 2);

  const statsRes = createMockRes();
  await donationController.getDonationStats({}, statsRes);
  assert.strictEqual(statsRes.statusCode, 200);
  assert.strictEqual(statsRes.body.success, true);
  assert.ok(statsRes.body.stats.totalAmount >= 350.75, "the totals include the PostgreSQL rows");
  assert.ok(statsRes.body.stats.completed >= 1);
  assert.ok(statsRes.body.stats.pending >= 1);
  assert.strictEqual(statsRes.body.stats.totalDonors, listRes.body.donations.length);
});

test("donation controller (PG): deleteDonation removes the row and drops its ledger bill", async () => {
  const calls = stubSideEffects();
  const createRes = createMockRes();
  await donationController.createDonation({ body: validBody({ donorName: "Delete Me" }), user: { id: "u3" } }, createRes);
  const id = createRes.body.donation._id;

  const res = createMockRes();
  await donationController.deleteDonation({ params: { id } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: true, message: "Donation deleted successfully" });
  const rows = await pgQuery("SELECT id FROM donations WHERE id = $1", [id]);
  assert.strictEqual(rows.length, 0, "the PostgreSQL row was deleted");
  assert.strictEqual(calls.billDelete.length, 1, "the Donation bill is still purged");
  assert.strictEqual(calls.billDelete[0].sourceId, id);
});

test("donation controller (PG): updateDonationStatus updates the row and returns the updated donation", async () => {
  const calls = stubSideEffects();
  const createRes = createMockRes();
  await donationController.createDonation(
    { body: validBody({ donorName: "Status Donor", category: "Hundi", status: "Pending" }), user: { id: "u4" } },
    createRes
  );
  const id = createRes.body.donation._id;
  calls.txns.length = 0;

  const res = createMockRes();
  await donationController.updateDonationStatus(
    { params: { id }, body: { status: "Collected" }, user: { id: "u4" } },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.message, "Donation status updated successfully");
  assert.strictEqual(res.body.donation.status, "Collected", "the response reflects the updated status");

  const rows = await pgQuery("SELECT status FROM donations WHERE id = $1", [id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, "Collected", "the status change was persisted to PostgreSQL");
  assert.strictEqual(calls.billUpdate.length, 1, "the ledger bill status is still synced");
  assert.deepStrictEqual(calls.billUpdate[0][1], { $set: { status: "Paid" } });
  assert.strictEqual(calls.txns.length, 1, "the collected donation is recorded in accounting");
  assert.strictEqual(calls.txns[0].category, "Hundi Collection");
});

test("donation controller (PG): a write reaches exactly one datasource", async () => {
  stubSideEffects();
  const mongoWrites = [];
  const originals = {
    create: Donation.create,
    findByIdAndUpdate: Donation.findByIdAndUpdate,
    findByIdAndDelete: Donation.findByIdAndDelete,
  };
  Donation.create = async (data) => { mongoWrites.push(["create", data]); return null; };
  Donation.findByIdAndUpdate = async () => { mongoWrites.push(["update"]); return null; };
  Donation.findByIdAndDelete = async () => { mongoWrites.push(["delete"]); return false; };
  try {
    const before = (await pgQuery("SELECT COUNT(*)::int AS n FROM donations"))[0].n;
    const res = createMockRes();
    await donationController.createDonation(
      { body: validBody({ donorName: "Single Datasource", donorEmail: emailFor("single") }), user: { id: "u5" } },
      res
    );
    assert.strictEqual(res.statusCode, 201);
    const after = (await pgQuery("SELECT COUNT(*)::int AS n FROM donations"))[0].n;
    assert.strictEqual(after, before + 1, "exactly one PostgreSQL row was written");
    assert.strictEqual(mongoWrites.length, 0, "the Mongoose model was not written to");
  } finally {
    Donation.create = originals.create;
    Donation.findByIdAndUpdate = originals.findByIdAndUpdate;
    Donation.findByIdAndDelete = originals.findByIdAndDelete;
  }
});

test("donation controller (PG): validation is preserved before any write", async () => {
  stubSideEffects();
  const cases = [
    [{ donorName: "", amount: "100" }, 400],
    [{ donorName: "No Amount", amount: "" }, 400],
    [{ donorName: "Zero Amount", amount: "0" }, 400],
    [{ donorName: "Bad Amount", amount: "abc" }, 400],
    [{ donorName: "Bad Contact", amount: "100", contactNumber: "not-a-phone" }, 400],
  ];
  for (const [body, expected] of cases) {
    const res = createMockRes();
    await donationController.createDonation({ body, user: { id: "u6" } }, res);
    assert.strictEqual(res.statusCode, expected, `body ${JSON.stringify(body)} must be rejected`);
    assert.strictEqual(res.body.success, false);
  }
});

// ─── Mongo fallback path ───────────────────────────────────────────────────
test("donation controller (Mongo fallback): the same handlers route to Mongoose and write no PostgreSQL row", async () => {
  const calls = stubSideEffects();
  pinDisconnected();

  const mongoCalls = [];
  const makeDoc = (obj, id) => ({ ...obj, _id: id, id, deleteOne: async function deleteOne() { mongoCalls.push(["deleteOne", this._id]); } });

  const originals = {
    create: Donation.create,
    find: Donation.find,
    findById: Donation.findById,
    findByIdAndUpdate: Donation.findByIdAndUpdate,
    findByIdAndDelete: Donation.findByIdAndDelete,
  };
  const store = [makeDoc({ donorName: "Mongo Donor", amount: 100, category: "General", paymentMethod: "UPI", status: "Pending" }, "mongo-don-1")];
  Donation.create = async (data) => { mongoCalls.push(["create", data]); const doc = makeDoc(data, "mongo-don-" + (store.length + 1)); store.push(doc); return doc; };
  Donation.find = (filter) => { mongoCalls.push(["find", filter]); return { sort: (s) => { mongoCalls.push(["sort", s]); return Promise.resolve(store); } }; };
  Donation.findById = async (id) => { mongoCalls.push(["findById", id]); return store.find((d) => d._id === id) || null; };
  Donation.findByIdAndUpdate = async (id, updates) => {
    mongoCalls.push(["findByIdAndUpdate", id, updates]);
    const doc = store.find((d) => d._id === id);
    if (!doc) return null;
    return { ...doc, ...updates };
  };
  Donation.findByIdAndDelete = async (id) => { mongoCalls.push(["findByIdAndDelete", id]); return store.find((d) => d._id === id) || null; };

  const uniqueEmail = emailFor("fallback");
  try {
    const created = createMockRes();
    await donationController.createDonation(
      { body: validBody({ donorName: "Mongo Donor", donorEmail: uniqueEmail, status: "Pending" }), user: { id: "u7" } },
      created
    );
    assert.strictEqual(created.statusCode, 201);
    assert.strictEqual(created.body.donation._id, "mongo-don-2");
    assert.ok(mongoCalls.some(([name]) => name === "create"), "createDonation reached Donation.create");

    // The fallback wrote nothing to PostgreSQL.
    const pgRows = await pgQuery("SELECT id FROM donations WHERE donor_email = $1", [uniqueEmail.toLowerCase()]);
    assert.strictEqual(pgRows.length, 0, "the Mongo fallback did not write a PostgreSQL row");

    // Listing and stats also route to Mongoose.
    mongoCalls.length = 0;
    const listRes = createMockRes();
    await donationController.getAllDonations({}, listRes);
    assert.strictEqual(listRes.statusCode, 200);
    assert.ok(mongoCalls.some(([name]) => name === "find"), "getAllDonations reached Donation.find");

    const statsRes = createMockRes();
    await donationController.getDonationStats({}, statsRes);
    assert.strictEqual(statsRes.statusCode, 200);
    assert.ok(calls.txns.length >= 0);

    // Updates and deletes stay on Mongoose.
    mongoCalls.length = 0;
    const updateRes = createMockRes();
    await donationController.updateDonationStatus(
      { params: { id: "mongo-don-1" }, body: { status: "Completed" }, user: { id: "u7" } },
      updateRes
    );
    assert.strictEqual(updateRes.statusCode, 200);
    assert.strictEqual(updateRes.body.donation.status, "Completed");
    assert.ok(mongoCalls.some(([name]) => name === "findByIdAndUpdate"), "the status update reached Mongoose");
    const pgUpdated = await pgQuery("SELECT status FROM donations WHERE id = 'mongo-don-1'");
    assert.strictEqual(pgUpdated.length, 0, "the fallback update wrote nothing to PostgreSQL");

    mongoCalls.length = 0;
    const deleteRes = createMockRes();
    await donationController.deleteDonation({ params: { id: "mongo-don-1" } }, deleteRes);
    assert.strictEqual(deleteRes.statusCode, 200);
    assert.ok(mongoCalls.some(([name]) => name === "findByIdAndDelete"), "the delete reached Mongoose");
  } finally {
    Donation.create = originals.create;
    Donation.find = originals.find;
    Donation.findById = originals.findById;
    Donation.findByIdAndUpdate = originals.findByIdAndUpdate;
    Donation.findByIdAndDelete = originals.findByIdAndDelete;
    pinConnected();
  }
});

test("donation controller (Mongo fallback): not-found and validation responses are unchanged", async () => {
  stubSideEffects();
  pinDisconnected();
  const originals = { findById: Donation.findById };
  Donation.findById = async () => null;
  try {
    const deleteRes = createMockRes();
    await donationController.deleteDonation({ params: { id: "missing" } }, deleteRes);
    assert.strictEqual(deleteRes.statusCode, 404);
    assert.deepStrictEqual(deleteRes.body, { success: false, message: "Donation not found" });

    const updateRes = createMockRes();
    await donationController.updateDonationStatus({ params: { id: "missing" }, body: { status: "Collected" } }, updateRes);
    assert.strictEqual(updateRes.statusCode, 404);
    assert.deepStrictEqual(updateRes.body, { success: false, message: "Donation not found" });

    const badRes = createMockRes();
    await donationController.createDonation({ body: { donorName: "", amount: "" } }, badRes);
    assert.strictEqual(badRes.statusCode, 400);
    assert.strictEqual(badRes.body.success, false);
  } finally {
    Donation.findById = originals.findById;
    pinConnected();
  }
});