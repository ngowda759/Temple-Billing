const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const AuditLog = require("../models/AuditLog");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const AUDIT_LOG_COLS = [
  "id", "date", "user_id", "action", "module", "details", "ip_address",
  "created_at", "updated_at",
];

// Mirrors the Mongoose model's `required: true` on date, user, action, module.
// None of those schema paths declare `trim: true`, so Mongoose's required
// validator rejects only undefined/null/'' — a whitespace-only string is
// accepted there and must be accepted here too, otherwise the PostgreSQL path
// would reject payloads MongoDB stores.
const assertRequired = (value, label) => {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required`);
  }
  return value;
};

const assertDate = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

// Converts an audit_logs row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). `user` is returned as the id STRING because
// that is what the repository stores — the populate-style shape
// ({ _id, name, role }) is attached by findMany, which is the only read path
// that populates in the controller.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    date: row.date,
    user: row.user_id,
    action: row.action,
    module: row.module,
    details: row.details === null || row.details === undefined ? undefined : row.details,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. datetime/createdAt/updatedAt
// mirror the model's `default: Date.now` and `{ timestamps: true }`.
const toRow = (data, id = newId()) => ({
  id,
  date: assertDate(data.date, "date") || new Date(),
  user_id: String(assertRequired(data.user, "user")).trim(),
  action: assertRequired(data.action, "action"),
  module: assertRequired(data.module, "module"),
  // details is optional and has NO default in the schema, so an absent value
  // stays NULL rather than becoming ''.
  details: data.details === undefined || data.details === null ? null : String(data.details),
  ip_address: data.ipAddress === undefined || data.ipAddress === null || String(data.ipAddress).trim() === ""
    ? "127.0.0.1"
    : String(data.ipAddress),
  created_at: assertDate(data.createdAt, "createdAt") || new Date(),
  updated_at: assertDate(data.updatedAt, "updatedAt") || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL. The only
// sort the application performs on AuditLog is { date: -1 }.
const SORT_COLUMNS = {
  date: "date",
  createdAt: "created_at",
  updatedAt: "updated_at",
  action: "action",
  module: "module",
  user: "user_id",
  ipAddress: "ip_address",
};

const DEFAULT_ORDER = "date DESC, created_at DESC";

const resolveOrderBy = (sort, alias = "") => {
  const colPrefix = alias ? `${alias}.` : "";
  let key;
  let direction;
  if (typeof sort === "string") {
    key = sort;
    direction = 1;
  } else {
    const entry = Object.entries(sort || {})[0] || [];
    key = entry[0];
    direction = entry[1];
  }
  const col = SORT_COLUMNS[key];
  if (!col) return DEFAULT_ORDER.split(", ").map((part) => `${colPrefix}${part}`).join(", ");
  const dir = direction === "DESC" || Number(direction) === -1
    ? "DESC"
    : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
  return dir ? `${colPrefix}${col} ${dir}` : DEFAULT_ORDER.split(", ").map((part) => `${colPrefix}${part}`).join(", ");
};

// Translates the exact filter the controller builds into SQL predicates:
//   { date: { $gte, $lte } }        — startDate + endDate range
//   { user }                        — exact user id equality
//   { action: { $regex, $options } } — case-insensitive substring
//   { module }                      — exact module equality
// plus the id/createdAt/updatedAt CRUD surface.
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input === undefined) return;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [op, opVal] of Object.entries(input)) {
      if (opVal === undefined || opVal === null) continue;
      if (op === "$gte" || op === "$gt" || op === "$lte" || op === "$lt") {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        values.push(dateCol ? new Date(opVal) : opVal);
        conditions.push(`${col} ${sqlOp} $${values.length}`);
      } else if (op === "$ne") {
        values.push(dateCol ? new Date(opVal) : opVal);
        conditions.push(`${col} <> $${values.length}`);
      }
    }
    return;
  }
  values.push(dateCol ? new Date(input) : input);
  conditions.push(`${col} = $${values.length}`);
};

// Mongo `{ action: { $regex: value, $options: 'i' } }` is an unanchored
// case-insensitive substring match. A parameterized ILIKE with the same
// escaping used across the other repositories preserves that meaning, and the
// regex metacharacters Mongo would treat specially are matched literally.
const pushRegexInsensitive = (conditions, values, col, input) => {
  if (input === undefined || input === null) return;
  const pattern = input && typeof input === "object" ? input.$regex : input;
  if (pattern === undefined || pattern === null) return;
  const term = String(pattern);
  if (term === "") return;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  values.push(`%${escaped}%`);
  conditions.push(`${col} ILIKE $${values.length} ESCAPE '\\'`);
};

// `alias` qualifies every column with a table alias so the same builder serves
// both the plain SELECT and the populate LEFT JOIN below.
const buildAuditLogFilter = (filter = {}, alias = "") => {
  const conditions = [];
  const values = [];
  const col = (name) => (alias ? `${alias}.${name}` : name);

  if (filter.id !== undefined) pushComparison(conditions, values, col("id"), filter.id);
  if (filter._id !== undefined) pushComparison(conditions, values, col("id"), filter._id);
  if (filter.user !== undefined) pushComparison(conditions, values, col("user_id"), filter.user);
  if (filter.action !== undefined) pushRegexInsensitive(conditions, values, col("action"), filter.action);
  if (filter.module !== undefined) pushComparison(conditions, values, col("module"), filter.module);
  if (filter.ipAddress !== undefined) pushComparison(conditions, values, col("ip_address"), filter.ipAddress);

  pushComparison(conditions, values, col("date"), filter.date, true);
  pushComparison(conditions, values, col("created_at"), filter.createdAt, true);
  pushComparison(conditions, values, col("updated_at"), filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// Reproduces the controller's `.populate('user', 'name role')` as a LEFT JOIN.
// A LEFT JOIN is deliberate: MongoDB's populate leaves `user` as null when the
// referenced row no longer exists, so an INNER JOIN would silently drop audit
// history. Audit rows are never dropped for referencing a missing user.
const findManyPopulated = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset } = options;
  const { where, values } = buildAuditLogFilter(filter, "a");
  const orderBy = resolveOrderBy(sort, "a");
  let sql = `SELECT a.id, a.date, a.user_id, a.action, a.module, a.details, a.ip_address,
                    a.created_at, a.updated_at,
                    u.id AS user_ref_id, u.name AS user_name, u.role AS user_role
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
             ${where} ORDER BY ${orderBy}, a.id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map((row) => {
    const doc = toDoc(row);
    doc.user = row.user_ref_id
      ? { _id: row.user_ref_id, name: row.user_name, role: row.user_role }
      : null;
    return doc;
  });
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return AuditLog.findById(String(id));
  const { rows } = await query(
    `SELECT ${AUDIT_LOG_COLS.join(", ")} FROM audit_logs WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return AuditLog.findOne(filter);
  const { where, values } = buildAuditLogFilter(filter);
  const { rows } = await query(
    `SELECT ${AUDIT_LOG_COLS.join(", ")} FROM audit_logs ${where} ORDER BY date DESC, created_at DESC, id DESC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

/**
 * The listing behind GET /api/audit-logs. Mirrors
 * AuditLog.find(query).sort({ date: -1 }).populate('user', 'name role') —
 * including the populate shape, which the React page depends on
 * (log.user?.name).
 *
 * `populate` defaults to false so the plain repository surface keeps returning
 * `user` as the id string (par with the Mongoose document without populate);
 * the service and controller request the populated shape explicitly.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset, populate = false } = options;
  if (!dbConfig.isDbConnected()) {
    let q = AuditLog.find(filter).sort(sort);
    if (populate) q = q.populate("user", "name role");
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  if (populate) return findManyPopulated({ filter, sort, limit, offset });

  const { where, values } = buildAuditLogFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${AUDIT_LOG_COLS.join(", ")} FROM audit_logs ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Mirrors AuditLog.create() for the single-record write path (logAudit).
 * Validation matches the schema's required fields so the two datasources
 * accept identical payloads; the INSERT is one atomic statement, so a failure
 * cannot leave a partial row.
 */
const create = async (data) => {
  const id = data.id || newId();
  const row = toRow(data, id);

  if (!dbConfig.isDbConnected()) return AuditLog.create(data);

  await query(
    `INSERT INTO audit_logs (${AUDIT_LOG_COLS.join(", ")})
     VALUES (${AUDIT_LOG_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    AUDIT_LOG_COLS.map((col) => row[col])
  );
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return AuditLog.countDocuments(filter);
  const { where, values } = buildAuditLogFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM audit_logs ${where}`, values);
  return rows[0] ? rows[0].count : 0;
};

module.exports = {
  AUDIT_LOG_COLS,
  findById,
  findOne,
  findMany,
  create,
  count,
};