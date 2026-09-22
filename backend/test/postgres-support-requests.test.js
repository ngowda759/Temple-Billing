// Phase 2AH PostgreSQL-path tests for the SupportRequest repository and service.
//
// These tests run with the datasource seam connected so the repository and
// service must select the PostgreSQL path. They verify that:
//   - supportRequestRepository / supportRequestService persist to and read from
//     the real support_requests table (no mocks),
//   - every persisted Mongo schema field round-trips losslessly and that no
//     field the Mongoose schema does not declare is invented,
//   - the model's ACTUAL validator behaviour is reproduced exactly:
//       * name / email / subject / message are required AND trimmed, so an
//         omitted, null, '' or whitespace-only value is rejected,
//       * status is an optional enum with default 'Open' that ALSO accepts an
//         explicit null, while '' / 'Bogus' / ' Open ' are rejected,
//       * reply is optional with no default — omitted stays NULL, a blank value
//         stores '',
//       * read defaults to false and an explicit null collapses to the default,
//   - findMany mirrors SupportRequest.find(filter).sort({ createdAt: -1 }) and
//     the optional email equality filter the GET /support handler builds,
//   - updateById mirrors the reply path's findById → mutate → save(), and
//     markRead mirrors findByIdAndUpdate(id, { read: true }, { new: true }),
//   - the table carries exactly the approved shape — one primary key, the
//     status enum CHECK, the four non-empty CHECKs, NO unique constraint and NO
//     foreign key,
//   - the service never writes to MongoDB while PostgreSQL is selected
//     (no dual writes) and can switch datasources in-process.
const test = require("node:test");
const assert = require("node:assert");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const { closePostgres } = require("../src/config/postgres");
const dbConfig = require("../src/config/db");
const SupportRequest = require("../src/models/SupportRequest");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://temple_test:temple_test_pw@127.0.0.1:5432/temple_billing_test";

const MIGRATE_SCRIPT = path.join(__dirname, "..", "src", "db", "migrate.js");

const unique = () => crypto.randomBytes(8).toString("hex");
const hex24 = () => crypto.randomBytes(12).toString("hex");

const poolQuery = async (sql, params = []) => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
};

const runMigrate = (databaseUrl = TEST_DB_URL) => {
  const res = spawnSync(process.execPath, [MIGRATE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl, POSTGRES_SSL: "" },
  });
  return { output: res.stdout + "\n" + res.stderr, status: res.status };
};

const resetAllTables = async (databaseUrl) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const row of rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    }
  } finally {
    await pool.end();
  }
};

let originalIsDbConnected;
let supportRequestRepository;
let supportRequestService;

test.before(async () => {
  originalIsDbConnected = dbConfig.isDbConnected;
  await resetAllTables(TEST_DB_URL);
  const res = runMigrate();
  if (res.status !== 0) throw new Error("migrate failed: " + res.output);

  process.env.DATABASE_URL = TEST_DB_URL;
  delete process.env.PGHOST;
  delete process.env.PGPORT;
  delete process.env.PGDATABASE;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.POSTGRES_SSL;
  dbConfig.isDbConnected = () => true;

  supportRequestRepository = require("../src/repositories/supportRequestRepository");
  supportRequestService = require("../src/services/supportRequestService");
});

test.after(async () => {
  dbConfig.isDbConnected = originalIsDbConnected;
  await closePostgres();
});

const base = (overrides = {}) => ({
  name: `Devotee ${unique()}`,
  email: `devotee-${unique()}@example.com`,
  subject: `Subject ${unique()}`,
  message: "Please look into this.",
  ...overrides,
});

// ─── Migration shape ───────────────────────────────────────────────────────
test("migration: support_requests exists with exactly the approved 10 columns", async () => {
  const cols = await poolQuery(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'support_requests'
     ORDER BY ordinal_position
  `);
  assert.deepStrictEqual(
    cols.map((c) => c.column_name),
    ["id", "name", "email", "subject", "message", "reply", "status", "read", "created_at", "updated_at"],
    "id + the 7 schema fields + the two timestamps, and nothing else"
  );

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  for (const name of ["id", "name", "email", "subject", "message", "reply", "status"]) {
    assert.strictEqual(byName[name].data_type, "text", `${name} is TEXT`);
  }
  assert.strictEqual(byName.read.data_type, "boolean", "read is a genuine BOOLEAN");
  assert.strictEqual(byName.created_at.data_type, "timestamp with time zone");
  assert.strictEqual(byName.updated_at.data_type, "timestamp with time zone");

  // Required + trim → NOT NULL, no default.
  for (const name of ["name", "email", "subject", "message"]) {
    assert.strictEqual(byName[name].is_nullable, "NO", `${name} is NOT NULL`);
    assert.strictEqual(byName[name].column_default, null, `${name} has no default`);
  }
  // Optional with no default → nullable, no default.
  assert.strictEqual(byName.reply.is_nullable, "YES");
  assert.strictEqual(byName.reply.column_default, null, "reply keeps no default");
  // status: default 'Open' but NULLABLE (an explicit null is accepted by Mongo).
  assert.strictEqual(byName.status.is_nullable, "YES");
  assert.match(String(byName.status.column_default), /Open/);
  // read: NOT NULL DEFAULT false.
  assert.strictEqual(byName.read.is_nullable, "NO");
  assert.match(String(byName.read.column_default), /false/i);
});

test("migration: id is the 24-hex TEXT primary key", async () => {
  const pk = await poolQuery(`
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'public.support_requests'::regclass AND i.indisprimary
  `);
  assert.deepStrictEqual(pk, [{ attname: "id", type: "text" }]);
});

test("migration: the table declares no UNIQUE constraint and no foreign key", async () => {
  const cons = await poolQuery(`
    SELECT conname, contype FROM pg_constraint
     WHERE conrelid = 'public.support_requests'::regclass
     ORDER BY contype, conname
  `);
  const types = cons.map((c) => c.contype);
  assert.ok(!types.includes("f"), "no foreign key — the model declares no ObjectId reference");
  assert.ok(!types.includes("u"), "no UNIQUE constraint — email is not unique in Mongo");
  assert.deepStrictEqual(
    [...new Set(types)].sort(),
    ["c", "p"],
    "only the primary key and CHECK constraints"
  );
});

test("migration: the status CHECK carries exactly the Mongo enum", async () => {
  const checks = await poolQuery(`
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'public.support_requests'::regclass AND contype = 'c'
     ORDER BY conname
  `);
  const statusCheck = checks.find((c) => c.conname === "support_requests_status_check");
  assert.ok(statusCheck, "the status CHECK exists");
  for (const value of ["Open", "In Progress", "Closed"]) {
    assert.ok(statusCheck.def.includes(value), `status CHECK includes ${value}`);
  }
  assert.ok(!statusCheck.def.includes("Bogus"));
});

test("migration: only the two approved indexes exist on support_requests", async () => {
  const idx = (await poolQuery(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'support_requests'
     ORDER BY indexname
  `)).map((r) => r.indexname);
  assert.deepStrictEqual(idx, [
    "idx_support_requests_created_at",
    "idx_support_requests_email_created_at",
    "support_requests_pkey",
  ], "no speculative index beyond the created_at order and the email filter");
});

test("migration: applying twice is idempotent and creates no duplicate table", async () => {
  const before = await poolQuery("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '033_create_support_requests.sql'");
  assert.strictEqual(before[0].n, 1);

  const { output, status } = runMigrate();
  assert.strictEqual(status, 0);
  assert.match(output, /No pending migrations\./);

  const after = await poolQuery("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '033_create_support_requests.sql'");
  assert.strictEqual(after[0].n, 1, "the migration is recorded exactly once");
});

test("migration: the chain 029→033 is continuous and prefix-unique", async () => {
  const rows = await poolQuery("SELECT name FROM schema_migrations ORDER BY id");
  const names = rows.map((r) => r.name);
  assert.deepStrictEqual(names.slice(-5), [
    "029_create_audit_logs.sql",
    "030_create_tasks.sql",
    "031_create_cash_closings.sql",
    "032_create_suppliers.sql",
    "033_create_support_requests.sql",
  ]);
  assert.strictEqual(names.length, 33, "029–032 were not renumbered");
});

// ─── Round trip ────────────────────────────────────────────────────────────
test("PG path: create persists one row and returns the Mongoose-shaped document", async () => {
  const payload = base();
  const created = await supportRequestService.create(payload);

  assert.ok(created._id, "an _id is returned");
  assert.strictEqual(created._id.length, 24, "the id is a 24-char Mongo-compatible hex string");
  assert.match(created._id, /^[0-9a-f]{24}$/);
  assert.strictEqual(created.name, payload.name);
  assert.strictEqual(created.email, payload.email);
  assert.strictEqual(created.subject, payload.subject);
  assert.strictEqual(created.message, payload.message);
  assert.strictEqual(created.status, "Open", "the schema default applies");
  assert.strictEqual(created.read, false, "the schema default applies");
  assert.strictEqual(created.reply, undefined, "an omitted reply stays undefined, as on a Mongo read");
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);

  const raw = await poolQuery(
    "SELECT id, name, email, subject, message, reply, status, read FROM support_requests WHERE id = $1",
    [created._id]
  );
  assert.strictEqual(raw.length, 1, "exactly one row written");
  assert.strictEqual(raw[0].reply, null);
  assert.strictEqual(raw[0].status, "Open");
  assert.strictEqual(raw[0].read, false);
});

test("PG path: an explicit ObjectId round-trips unchanged", async () => {
  const id = hex24();
  const created = await supportRequestRepository.create({ ...base(), id });
  assert.strictEqual(created._id, id);
  assert.strictEqual(created.id, id);
  const found = await supportRequestRepository.findById(id);
  assert.strictEqual(found._id, id);
  assert.strictEqual(found.subject, created.subject);
});

test("PG path: findById returns null for an unknown id and for a malformed id", async () => {
  assert.strictEqual(await supportRequestService.findById(hex24()), null);
  // A malformed id is an ordinary non-matching TEXT value here; it can never
  // collide with a stored 24-hex id, so it resolves to "not found" exactly as
  // it does for every other migrated domain (see postgres-suppliers.test.js).
  assert.strictEqual(await supportRequestService.findById("not-an-object-id"), null);
});

// ─── Validation parity with the Mongoose model ─────────────────────────────
test("PG path: the four required fields reject omitted, null, empty and whitespace values", async () => {
  const required = ["name", "email", "subject", "message"];
  for (const field of required) {
    for (const bad of [undefined, null, "", "   ", "\t"]) {
      await assert.rejects(
        () => supportRequestService.create(base({ [field]: bad })),
        new RegExp(`${field} is required`),
        `${field}=${JSON.stringify(bad)} must be rejected`
      );
    }
  }
});

test("PG path: values are trimmed exactly as the schema's trim:true does", async () => {
  const created = await supportRequestService.create({
    name: "  Devotee Name  ",
    email: "  Devotee@Example.com  ",
    subject: "  Help me  ",
    message: "  Please reply  ",
  });
  assert.strictEqual(created.name, "Devotee Name");
  assert.strictEqual(created.email, "Devotee@Example.com", "email is trimmed but NOT lowercased");
  assert.strictEqual(created.subject, "Help me");
  assert.strictEqual(created.message, "Please reply");
});

test("PG path: status accepts the three enum values, defaults to Open and rejects anything else", async () => {
  for (const status of ["Open", "In Progress", "Closed"]) {
    const created = await supportRequestService.create(base({ status }));
    assert.strictEqual(created.status, status);
  }

  const defaulted = await supportRequestService.create(base());
  assert.strictEqual(defaulted.status, "Open");

  // Mongoose rejects an out-of-enum value, so PostgreSQL must too. Note `status`
  // declares NO trim, so a padded enum value is also invalid.
  for (const bad of ["", "Bogus", "Open ", " Open", "open", "CLOSED"]) {
    await assert.rejects(
      () => supportRequestService.create(base({ status: bad })),
      /Invalid status/,
      `status=${JSON.stringify(bad)} must be rejected`
    );
  }
});

test("PG path: an explicit null status is accepted, as Mongoose accepts it", async () => {
  // `status` is `{ default, enum }` but NOT required, so `default` fires only
  // for an omitted value — an explicit null validates and is stored as null.
  const created = await supportRequestService.create(base({ status: null }));
  assert.strictEqual(created.status, null);
  const raw = await poolQuery("SELECT status FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].status, null, "the CHECK constraint passes for a null status");
});

test("PG path: reply is optional — omitted stays NULL, blank stores '' and a value is trimmed", async () => {
  const omitted = await supportRequestService.create(base());
  const blank = await supportRequestService.create(base({ reply: "   " }));
  const value = await supportRequestService.create(base({ reply: "  We fixed it.  " }));

  const rows = await poolQuery(
    "SELECT id, reply FROM support_requests WHERE id = ANY($1)",
    [[omitted._id, blank._id, value._id]]
  );
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.reply]));
  assert.strictEqual(byId[omitted._id], null, "an omitted reply is NULL");
  assert.strictEqual(byId[blank._id], "", "a whitespace-only reply trims to ''");
  assert.strictEqual(byId[value._id], "We fixed it.");
  assert.strictEqual(omitted.reply, undefined, "omitted reads back as undefined, not null");
});

test("PG path: read defaults to false and an explicit null collapses to the default", async () => {
  const defaulted = await supportRequestService.create(base());
  const explicitTrue = await supportRequestService.create(base({ read: true }));
  const explicitNull = await supportRequestService.create(base({ read: null }));

  assert.strictEqual(defaulted.read, false);
  assert.strictEqual(explicitTrue.read, true);
  // Mongoose accepts an explicit null on a Boolean path; the column is NOT
  // NULL, so the default is applied rather than raising a not-null violation.
  assert.strictEqual(explicitNull.read, false);
});

test("PG path: no field the Mongoose schema does not declare is persisted", async () => {
  const created = await supportRequestService.create(base({
    priority: "High",
    category: "Billing",
    requesterId: hex24(),
    assignedUserId: hex24(),
    attachments: ["a.png"],
    resolution: "done",
  }));
  assert.strictEqual(created.priority, undefined);
  assert.strictEqual(created.category, undefined);
  assert.strictEqual(created.requesterId, undefined);
  assert.strictEqual(created.resolution, undefined);

  const cols = await poolQuery(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'support_requests'
  `);
  const names = cols.map((c) => c.column_name);
  for (const invented of ["priority", "category", "requester_id", "assigned_user_id", "resolution", "attachments"]) {
    assert.ok(!names.includes(invented), `${invented} must not exist`);
  }
});

test("PG path: two requests may share an email — no unique constraint is imposed", async () => {
  const email = `dup-${unique()}@example.com`;
  await supportRequestService.create(base({ email }));
  await supportRequestService.create(base({ email }));
  const rows = await poolQuery("SELECT count(*)::int AS n FROM support_requests WHERE email = $1", [email]);
  assert.strictEqual(rows[0].n, 2, "Mongo allows the duplicate, so PostgreSQL must too");
});

// ─── Listing / filtering ───────────────────────────────────────────────────
test("PG path: findMany returns newest first, mirroring sort({ createdAt: -1 })", async () => {
  const tag = unique();
  const email = `order-${tag}@example.com`;
  const t0 = new Date("2024-01-01T00:00:00Z");
  const t1 = new Date("2024-06-01T00:00:00Z");
  const t2 = new Date("2025-01-01T00:00:00Z");
  await supportRequestService.create(base({ email, createdAt: t0, subject: `old-${tag}` }));
  await supportRequestService.create(base({ email, createdAt: t2, subject: `new-${tag}` }));
  await supportRequestService.create(base({ email, createdAt: t1, subject: `mid-${tag}` }));

  const list = await supportRequestService.findMany({ filter: { email }, sort: { createdAt: -1 } });
  assert.deepStrictEqual(list.map((r) => r.subject), [`new-${tag}`, `mid-${tag}`, `old-${tag}`]);
});

test("PG path: the email filter matches the raw stored value exactly", async () => {
  const email = `filter-${unique()}@example.com`;
  const created = await supportRequestService.create(base({ email }));

  const hit = await supportRequestService.findMany({ filter: { email }, sort: { createdAt: -1 } });
  assert.ok(hit.some((r) => r._id === created._id), "an exact email match is returned");
  assert.ok(hit.every((r) => r.email === email), "only rows with that email are returned");

  const miss = await supportRequestService.findMany({ filter: { email: `nope-${unique()}@example.com` } });
  assert.deepStrictEqual(miss, []);
});

test("PG path: the filter is a plain equality, not lower(email) — the pre-existing mismatch is preserved", async () => {
  // getSupportRequests lowercases the QUERY value but compares it against the
  // email stored as supplied. A request stored with mixed case is therefore NOT
  // matched by its lowercased query — the same (latent) behaviour as Mongo. The
  // migration deliberately does not "fix" either side.
  const email = `MixedCase-${unique()}@Example.com`;
  const created = await supportRequestService.create(base({ email }));

  const lowered = await supportRequestService.findMany({ filter: { email: email.toLowerCase() } });
  assert.ok(!lowered.some((r) => r._id === created._id), "lowercased query does not match the raw stored value");

  const exact = await supportRequestService.findMany({ filter: { email } });
  assert.ok(exact.some((r) => r._id === created._id), "the exact stored value does match");
});

test("PG path: findMany with an empty filter returns the newest requests overall", async () => {
  const list = await supportRequestService.findMany({ filter: {}, sort: { createdAt: -1 } });
  assert.ok(list.length > 0);
  const times = list.map((r) => new Date(r.createdAt).getTime());
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i - 1] >= times[i], "created_at DESC order holds across the whole table");
  }
});

test("PG path: findMany pagination mirrors limit/skip", async () => {
  const tag = unique();
  const email = `page-${tag}@example.com`;
  for (let i = 0; i < 3; i += 1) {
    await supportRequestService.create(base({
      email,
      createdAt: new Date(2025, 0, i + 1),
    }));
  }
  const page = await supportRequestService.findMany({ filter: { email }, sort: { createdAt: -1 }, limit: 2, offset: 1 });
  assert.strictEqual(page.length, 2);
});

// ─── Reply / mark read ─────────────────────────────────────────────────────
test("PG path: updateById mirrors the reply save() and bumps updatedAt", async () => {
  const created = await supportRequestService.create(base({ createdAt: new Date("2020-01-01T00:00:00Z") }));
  const updated = await supportRequestService.updateById(created._id, {
    reply: "  We have resolved this.  ",
    status: "Closed",
  });

  assert.strictEqual(updated._id, created._id);
  assert.strictEqual(updated.reply, "We have resolved this.");
  assert.strictEqual(updated.status, "Closed");
  assert.ok(new Date(updated.updatedAt).getTime() > new Date(created.updatedAt).getTime(), "updated_at advances");

  const raw = await poolQuery("SELECT reply, status FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].reply, "We have resolved this.");
  assert.strictEqual(raw[0].status, "Closed");
});

test("PG path: updateById returns null for an unknown id (the controller's 404 branch)", async () => {
  assert.strictEqual(await supportRequestService.updateById(hex24(), { reply: "x", status: "Closed" }), null);
});

test("PG path: markRead sets read = true and leaves every other field alone", async () => {
  const created = await supportRequestService.create(base());
  assert.strictEqual(created.read, false);

  const marked = await supportRequestService.markRead(created._id);
  assert.strictEqual(marked._id, created._id);
  assert.strictEqual(marked.read, true);
  assert.strictEqual(marked.subject, created.subject);
  assert.strictEqual(marked.reply, undefined);
  assert.strictEqual(marked.status, created.status);

  const raw = await poolQuery("SELECT read FROM support_requests WHERE id = $1", [created._id]);
  assert.strictEqual(raw[0].read, true);
});

test("PG path: markRead returns null for an unknown id", async () => {
  assert.strictEqual(await supportRequestService.markRead(hex24()), null);
});

test("PG path: there is no delete operation at any layer", async () => {
  // The application has no delete handler for SupportRequest, so neither the
  // repository nor the service exposes one.
  assert.strictEqual(supportRequestRepository.destroy, undefined);
  assert.strictEqual(supportRequestService.destroy, undefined);
});

// ─── Datasource selection / no dual writes ─────────────────────────────────
test("service: PostgreSQL is selected when the seam is connected and PG is reachable", async () => {
  dbConfig.isDbConnected = () => true;
  assert.strictEqual(await supportRequestService.usePostgres(), true);
  assert.strictEqual(supportRequestService.isConnected(), true);
});

test("service: the PG probe gates the path, not just the seam", async () => {
  const saved = process.env.DATABASE_URL;
  try {
    dbConfig.isDbConnected = () => true;
    process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nope";
    await closePostgres();
    assert.strictEqual(await supportRequestService.usePostgres(), false, "an unreachable PG falls back");
  } finally {
    process.env.DATABASE_URL = saved;
    await closePostgres();
    dbConfig.isDbConnected = () => true;
  }
});

test("service: a PG write never reaches MongoDB (no dual writes)", async () => {
  dbConfig.isDbConnected = () => true;
  const originalCreate = SupportRequest.create;
  const originalFindByIdAndUpdate = SupportRequest.findByIdAndUpdate;
  const calls = [];
  SupportRequest.create = async (data) => { calls.push(["create", data]); return { ...data, _id: hex24() }; };
  SupportRequest.findByIdAndUpdate = async () => { calls.push(["findByIdAndUpdate"]); return null; };
  try {
    const created = await supportRequestService.create(base());
    await supportRequestService.markRead(created._id);
    assert.deepStrictEqual(calls, [], "the Mongoose model was never touched while PostgreSQL was selected");
  } finally {
    SupportRequest.create = originalCreate;
    SupportRequest.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test("service: validation runs before either datasource is touched", async () => {
  dbConfig.isDbConnected = () => true;
  const originalCreate = SupportRequest.create;
  let mongoCalls = 0;
  SupportRequest.create = async (data) => { mongoCalls += 1; return data; };
  const before = await poolQuery("SELECT count(*)::int AS n FROM support_requests");
  try {
    await assert.rejects(() => supportRequestService.create(base({ subject: "" })), /subject is required/);
    assert.strictEqual(mongoCalls, 0, "nothing was written to Mongo");
    const after = await poolQuery("SELECT count(*)::int AS n FROM support_requests");
    assert.strictEqual(after[0].n, before[0].n, "nothing was written to PostgreSQL");
  } finally {
    SupportRequest.create = originalCreate;
  }
});

test("service: the datasource can be flipped in-process without reloading the module", async () => {
  const tag = unique();

  dbConfig.isDbConnected = () => true;
  const created = await supportRequestService.create(base({ subject: `pg-${tag}` }));
  assert.strictEqual(created._id.length, 24);
  const pgRows = await poolQuery("SELECT id FROM support_requests WHERE subject = $1", [`pg-${tag}`]);
  assert.strictEqual(pgRows.length, 1, "row landed in PostgreSQL");

  // Flip the seam to Mongo: the same module instance must route back.
  dbConfig.isDbConnected = () => false;
  const originalCreate = SupportRequest.create;
  let mongoCalls = 0;
  SupportRequest.create = async (data) => { mongoCalls += 1; return { ...data, _id: hex24() }; };
  try {
    assert.strictEqual(await supportRequestService.usePostgres(), false);
    await supportRequestService.create(base({ subject: `mongo-${tag}` }));
    assert.strictEqual(mongoCalls, 1, "Mongoose handled the write once the seam flipped");
  } finally {
    SupportRequest.create = originalCreate;
  }
  const leaked = await poolQuery("SELECT id FROM support_requests WHERE subject = $1", [`mongo-${tag}`]);
  assert.strictEqual(leaked.length, 0, "no dual write while Mongo was selected");

  dbConfig.isDbConnected = () => true;
});
