const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Leave = require("../models/Leave");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enum declared in backend/src/models/Leave.js exactly.
const STATUSES = new Set(["Pending", "Approved", "Rejected"]);

// fromDate / toDate are timezone-free 'YYYY-MM-DD' calendar strings on every
// write path (the frontend date inputs, leaveController's parseISODate check
// and the payroll/dashboard range filters). The application also compares and
// sorts them as text.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertEnumOrArray = (value, allowed, label) => {
  if (value === undefined || value === null) return;
  for (const item of Array.isArray(value) ? value : [value]) {
    assertEnum(item, allowed, label);
  }
};

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// The controller validates the 'YYYY-MM-DD' shape before writing, and every
// reader treats the pair as text. Pinning the shape here keeps a malformed
// value from silently breaking the lexicographic range comparisons.
const assertDateKey = (value, label) => {
  const text = assertId(value, label);
  if (!DATE_PATTERN.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a YYYY-MM-DD calendar key`);
  }
  return text;
};

const LEAVE_COLS = [
  "id", "staff_id", "staff_name", "reason", "leave_type", "from_date",
  "to_date", "status", "admin_reason", "reviewed_by", "reviewed_at",
  "created_at", "updated_at",
];

const toDateOrNull = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

// verifiedAt / reviewedAt / reviewedBy / adminReason all have schema defaults
// and no write path stores null on them, so an absent value falls back to the
// schema's own default. That keeps the NOT NULL columns honest without changing
// any value the application can produce.
const textOrDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === "" ? fallback : text;
};

// Converts a leaves row into the shape the application receives from Mongoose
// (camelCase, Mongo _id, the reviewedAt default as null exactly as the schema
// declares).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    reason: row.reason,
    leaveType: row.leave_type,
    fromDate: row.from_date,
    toDate: row.to_date,
    status: row.status,
    adminReason: row.admin_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at === undefined ? null : row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  staff_id: assertId(data.staffId, "staffId"),
  staff_name: assertId(data.staffName, "staffName"),
  reason: assertId(data.reason, "reason"),
  leave_type: textOrDefault(data.leaveType, "General"),
  from_date: assertDateKey(data.fromDate, "fromDate"),
  to_date: assertDateKey(data.toDate, "toDate"),
  status: textOrDefault(data.status, "Pending"),
  admin_reason: textOrDefault(data.adminReason, ""),
  reviewed_by: textOrDefault(data.reviewedBy, ""),
  reviewed_at: toDateOrNull(data.reviewedAt, "reviewedAt"),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The standing
// orders are { createdAt: -1 } (the leave lists), { fromDate: -1, createdAt: -1 }
// (the attendance/admin dashboards) and { fromDate: -1 } (the employee detail
// history), so `created_at DESC` is the default.
const SORT_COLUMNS = {
  staffId: "staff_id",
  staffName: "staff_name",
  leaveType: "leave_type",
  fromDate: "from_date",
  toDate: "to_date",
  status: "status",
  reviewedBy: "reviewed_by",
  reviewedAt: "reviewed_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "created_at DESC";

// Resolves a Mongo sort object/key into a whitelisted ORDER BY clause. Every
// key is whitelisted (unknown keys are dropped) and the original direction is
// preserved, so a multi-key sort such as { fromDate: -1, createdAt: -1 } keeps
// its exact Mongo tie-breaking.
const resolveOrderBy = (sort) => {
  const entries = typeof sort === "string" ? [[sort, 1]] : Object.entries(sort || {});
  const parts = [];
  for (const [key, direction] of entries) {
    const col = SORT_COLUMNS[key];
    if (!col) continue;
    const dir = direction === "DESC" || Number(direction) === -1
      ? "DESC"
      : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
    if (!dir) continue;
    parts.push(`${col} ${dir}`);
  }
  return parts.length ? parts.join(", ") : DEFAULT_ORDER;
};

const pushCond = (conditions, values, col, op, value) => {
  conditions.push(`${col} ${op} $${values.length + 1}`);
  values.push(value);
};

const pushIn = (conditions, values, col, list) => {
  const vals = (Array.isArray(list) ? list : [list])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));
  if (vals.length) {
    conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
    values.push(...vals);
  } else {
    // Mongo $in: [] matches no documents (it is an instant-false predicate).
    conditions.push("1 = 0");
  }
};

// Applies a Mongo comparison operator object ({ $in/$ne/$gte/$gt/$lte/$lt }) to
// a column, or an exact equality for a plain value, or IS NULL for an explicit
// null (Mongo `{ field: null }` also matches documents where the field is
// missing).
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      pushIn(conditions, values, col, input.$in);
      return;
    }
    if (input.$ne !== undefined) {
      if (input.$ne === null) {
        conditions.push(`${col} IS NOT NULL`);
      } else {
        pushCond(conditions, values, col, "<>", dateCol ? new Date(input.$ne) : input.$ne);
      }
      return;
    }
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  }
};

// The identifier columns the standing $or clauses match on. Leave references no
// single table (see the migration header): the leave lookups match the same
// person across { staffId, staffEmail } with an $or. staffEmail is deliberately
// included even though the Leave schema declares no such field — the controller
// still sends it, Mongo treats the clause as match-nothing, and the column is
// mapped to a always-NULL expression so the PostgreSQL path behaves identically.
const OR_CLAUSE_COLUMNS = {
  staffId: "staff_id",
  staffEmail: null,
};

// Supports the filter surface the application actually uses against Leave:
//   * { id } / { id: { $in: [...] } }
//   * { staffId } / { leaveType } / { status } / { reviewedBy } — equality, $in
//     or $ne
//   * { status: { $ne: "Rejected" } } — the overlap and quota queries
//   * { fromDate: { $lte } } / { toDate: { $gte } } — the calendar range scans
//     (compared as text, exactly as Mongo compares the stored Strings)
//   * { reviewedAt } / { createdAt } / { updatedAt } range filters
//   * { $or: [ { staffId: { $in } }, { staffEmail: { $in } } ] } — the
//     attendance dashboard, the shift planner and the religious-duty guard
const buildLeaveFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status && typeof filter.status === "object" && !Array.isArray(filter.status)) {
    // { status: { $ne: "Rejected" } } — the overlap and quota queries.
    assertEnum(filter.status.$ne, STATUSES, "status.$ne");
    pushComparison(conditions, values, "status", filter.status);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  if (filter.staffId !== undefined) pushComparison(conditions, values, "staff_id", filter.staffId);
  if (filter.leaveType !== undefined) pushComparison(conditions, values, "leave_type", filter.leaveType);
  if (filter.reviewedBy !== undefined) pushComparison(conditions, values, "reviewed_by", filter.reviewedBy);

  // Mongo-style { $or: [...] }. A clause whose column is unmapped (staffEmail)
  // renders the always-false `1 = 0`, matching the match-nothing semantics the
  // schema's missing field produces in Mongo.
  const orConditions = Array.isArray(filter.$or) ? filter.$or : [];
  const orParts = [];
  for (const clause of orConditions) {
    if (!clause || typeof clause !== "object") continue;
    for (const [key, col] of Object.entries(OR_CLAUSE_COLUMNS)) {
      const input = clause[key];
      if (input === undefined) continue;
      if (col === null) {
        orParts.push("1 = 0");
        continue;
      }
      if (input && typeof input === "object" && !Array.isArray(input) && input.$in !== undefined) {
        const vals = (Array.isArray(input.$in) ? input.$in : [input.$in])
          .filter((v) => v !== undefined && v !== null)
          .map((v) => String(v));
        if (vals.length) {
          orParts.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
          values.push(...vals);
        } else {
          orParts.push("1 = 0");
        }
      } else if (input !== null) {
        orParts.push(`${col} = $${values.length + 1}`);
        values.push(String(input));
      } else {
        orParts.push(`${col} IS NULL`);
      }
    }
  }
  if (orParts.length) {
    conditions.push(`(${orParts.join(" OR ")})`);
  }

  // fromDate / toDate are stored as text and compared lexicographically, which
  // is how the application already uses them (`$lte` / `$gte` on the string).
  pushComparison(conditions, values, "from_date", filter.fromDate);
  pushComparison(conditions, values, "to_date", filter.toDate);

  pushComparison(conditions, values, "reviewed_at", filter.reviewedAt, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const validate = (data) => {
  if (!data) throw new Error("Leave data is required");
  assertId(data.staffId, "staffId");
  assertId(data.staffName, "staffName");
  assertId(data.reason, "reason");
  assertDateKey(data.fromDate, "fromDate");
  assertDateKey(data.toDate, "toDate");
  assertEnum(data.status, STATUSES, "status");
  toDateOrNull(data.reviewedAt, "reviewedAt");
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Leave.findById(String(id));
  const { rows } = await query(`SELECT ${LEAVE_COLS.join(", ")} FROM leaves WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Leave.findOne(filter);
  const { where, values } = buildLeaveFilter(filter);
  const { rows } = await query(
    `SELECT ${LEAVE_COLS.join(", ")} FROM leaves ${where} ORDER BY ${DEFAULT_ORDER}, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Leave.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildLeaveFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${LEAVE_COLS.join(", ")} FROM leaves ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  validate(data);
  if (!dbConfig.isDbConnected()) return Leave.create(data);
  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO leaves (${LEAVE_COLS.join(", ")})
     VALUES (${LEAVE_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
    LEAVE_COLS.map((col) => row[col])
  );
  return findById(id);
};

// Patches only the supplied fields. `undefined` leaves a column untouched, an
// explicit value is written and an explicit null clears the nullable
// reviewed_at (the updateLeaveStatus path resets it to null when the status
// returns to 'Pending').
const updateById = async (id, updates) => {
  if (updates) {
    if (updates.staffId !== undefined) assertId(updates.staffId, "staffId");
    if (updates.staffName !== undefined) assertId(updates.staffName, "staffName");
    if (updates.reason !== undefined) assertId(updates.reason, "reason");
    if (updates.fromDate !== undefined) assertDateKey(updates.fromDate, "fromDate");
    if (updates.toDate !== undefined) assertDateKey(updates.toDate, "toDate");
    if (updates.status !== undefined) assertEnum(updates.status, STATUSES, "status");
  }
  if (!dbConfig.isDbConnected()) {
    return Leave.findByIdAndUpdate(id, updates, { new: true });
  }

  const assignments = [];
  const values = [];
  const apply = (col, value) => {
    values.push(value);
    assignments.push(`${col} = $${values.length}`);
  };
  const applyRequiredText = (col, value, label) => apply(col, assertId(value, label));
  const applyText = (col, value, fallback) => apply(col, textOrDefault(value, fallback));
  const applyDate = (col, value, label) => apply(col, toDateOrNull(value, label));

  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    switch (key) {
      case "staffId": applyRequiredText("staff_id", value, "staffId"); break;
      case "staffName": applyRequiredText("staff_name", value, "staffName"); break;
      case "reason": applyRequiredText("reason", value, "reason"); break;
      case "leaveType": applyText("leave_type", value, "General"); break;
      case "fromDate": apply("from_date", assertDateKey(value, "fromDate")); break;
      case "toDate": apply("to_date", assertDateKey(value, "toDate")); break;
      case "status": apply("status", value === null ? "Pending" : value); break;
      case "adminReason": applyText("admin_reason", value, ""); break;
      case "reviewedBy": applyText("reviewed_by", value, ""); break;
      case "reviewedAt": applyDate("reviewed_at", value, "reviewedAt"); break;
      default: break;
    }
  }

  if (!assignments.length) return findById(id);

  assignments.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE leaves SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Leave.countDocuments(filter);
  const { where, values } = buildLeaveFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM leaves ${where}`, values);
  return rows[0]?.count || 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  validate,
  STATUSES,
};