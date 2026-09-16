const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Shift = require("../models/Shift");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const SHIFT_COLS = [
  "id", "shift_name", "start_time", "end_time", "category", "required_staff",
  "active", "notes", "created_at", "updated_at",
];

// Mirrors the Mongoose `required: true` check on a trimmed String path: missing,
// null and whitespace-only values are all rejected (trim runs before the
// required check in Mongo, so an all-whitespace String fails there too).
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// requiredStaff is a bare Number with no min in the Mongo schema, so only
// finiteness is checked and fractional values are preserved.
const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// Every defaulted column is NOT NULL and no write path stores null on one, so an
// absent value falls back to the schema's own default. This keeps the columns
// honest without changing any value the application can produce.
const textOrDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === "" ? fallback : text;
};

const numberOrDefault = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return Number(value);
};

// Converts a shifts row into the shape the application receives from Mongoose
// (camelCase, Mongo _id, NUMERIC read back as a Number).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    shiftName: row.shift_name,
    startTime: row.start_time,
    endTime: row.end_time,
    category: row.category,
    requiredStaff: row.required_staff === null || row.required_staff === undefined
      ? undefined
      : Number(row.required_staff),
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  shift_name: assertId(data.shiftName, "shiftName"),
  start_time: assertId(data.startTime, "startTime"),
  end_time: assertId(data.endTime, "endTime"),
  category: textOrDefault(data.category, "General"),
  required_staff: numberOrDefault(data.requiredStaff, 1),
  active: data.active === undefined || data.active === null ? true : Boolean(data.active),
  notes: textOrDefault(data.notes, ""),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The standing
// orders are { createdAt: -1 } (the shift lists), { shiftName: 1 } (the active
// list) and { updatedAt: -1, createdAt: -1 } (the employee→shift resolution),
// so `created_at DESC` is the default.
const SORT_COLUMNS = {
  shiftName: "shift_name",
  startTime: "start_time",
  endTime: "end_time",
  category: "category",
  requiredStaff: "required_staff",
  active: "active",
  notes: "notes",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "created_at DESC";

// Resolves a Mongo sort object/key into a whitelisted ORDER BY clause. Every key
// is whitelisted (unknown keys are dropped) and the original direction is
// preserved, so a multi-key sort such as { updatedAt: -1, createdAt: -1 } keeps
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

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Resolves a shiftName filter value. resolveShiftDefinition queries
// Shift.findOne({ shiftName: /^name$/i, active: true }), so a case-insensitive
// anchored RegExp is translated into lower(shift_name) = lower($n) — which the
// idx_shifts_shift_name_lower index serves — instead of interpolating any part
// of the pattern into SQL. Any other pattern shape falls back to a parameterized
// case-insensitive substring match with the Mongoose source treated as a
// literal, which keeps the behaviour safe rather than silently unmatching.
const resolveNameClause = (conditions, values, input) => {
  if (input instanceof RegExp) {
    if (input.ignoreCase && input.source.startsWith("^") && input.source.endsWith("$")) {
      values.push(input.source.slice(1, -1));
      conditions.push(`lower(shift_name) = lower($${values.length})`);
      return;
    }
    values.push(`%${escapeRegex(input.source.replace(/^\^|\$$/g, ""))}%`);
    conditions.push(`shift_name ILIKE $${values.length} ESCAPE '\\'`);
    return;
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      const vals = (Array.isArray(input.$in) ? input.$in : [input.$in])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v));
      if (vals.length) {
        conditions.push(`shift_name IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
        values.push(...vals);
      } else {
        // Mongo $in: [] matches no documents (it is an instant-false predicate).
        conditions.push("1 = 0");
      }
      return;
    }
    if (input.$ne !== undefined) {
      if (input.$ne === null) {
        conditions.push("shift_name IS NOT NULL");
      } else {
        values.push(input.$ne);
        conditions.push(`shift_name <> $${values.length}`);
      }
      return;
    }
    return;
  }
  if (input !== undefined && input !== null) {
    values.push(String(input).trim());
    conditions.push(`shift_name = $${values.length}`);
  } else if (input === null) {
    conditions.push("shift_name IS NULL");
  }
};

// Applies a Mongo comparison operator object ({ $in/$ne/$gte/$gt/$lte/$lt }) to
// a column, or an exact equality for a plain value, or IS NULL for an explicit
// null (Mongo `{ field: null }` also matches documents where the field is
// missing). dateCol marks the two real TIMESTAMPTZ columns.
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      const vals = (Array.isArray(input.$in) ? input.$in : [input.$in])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => (dateCol ? v : String(v)));
      if (vals.length) {
        conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
        values.push(...vals);
      } else {
        conditions.push("1 = 0");
      }
      return;
    }
    if (input.$ne !== undefined) {
      if (input.$ne === null) {
        conditions.push(`${col} IS NOT NULL`);
      } else {
        values.push(dateCol ? new Date(input.$ne) : input.$ne);
        conditions.push(`${col} <> $${values.length}`);
      }
      return;
    }
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        values.push(dateCol ? new Date(opVal) : opVal);
        conditions.push(`${col} ${sqlOp} $${values.length}`);
      }
    }
    return;
  }
  if (input !== undefined && input !== null) {
    values.push(dateCol ? new Date(input) : input);
    conditions.push(`${col} = $${values.length}`);
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  }
};

// Supports the filter surface the application actually uses against Shift:
//   * { id } / { id: { $in: [...] } }
//   * { shiftName } — equality, $in, $ne, or the case-insensitive anchored RegExp
//     used by attendanceController.resolveShiftDefinition
//   * { active } — equality, $in or $ne (the active-shift scans)
//   * { category } — equality, $in or $ne (free text, matched exactly)
//   * { requiredStaff } — equality or range (headcount lookups)
//   * { createdAt } / { updatedAt } range filters
// Every value is bound as a parameter; nothing is interpolated.
const buildShiftFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (filter.id !== undefined) {
    if (filter.id && typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
      const vals = (Array.isArray(filter.id.$in) ? filter.id.$in : [filter.id.$in])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v));
      if (vals.length) {
        conditions.push(`id IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
        values.push(...vals);
      } else {
        conditions.push("1 = 0");
      }
    } else if (filter.id !== null) {
      values.push(String(filter.id).trim());
      conditions.push(`id = $${values.length}`);
    } else {
      conditions.push("id IS NULL");
    }
  }

  if (filter.shiftName !== undefined) resolveNameClause(conditions, values, filter.shiftName);
  if (filter.active !== undefined) pushComparison(conditions, values, "active", filter.active);
  if (filter.category !== undefined) pushComparison(conditions, values, "category", filter.category);
  if (filter.requiredStaff !== undefined) pushComparison(conditions, values, "required_staff", filter.requiredStaff);
  if (filter.createdAt !== undefined) pushComparison(conditions, values, "created_at", filter.createdAt, true);
  if (filter.updatedAt !== undefined) pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const validate = (data) => {
  if (!data) throw new Error("Shift data is required");
  assertId(data.shiftName, "shiftName");
  assertId(data.startTime, "startTime");
  assertId(data.endTime, "endTime");
  assertNumber(data.requiredStaff, "requiredStaff");
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Shift.findById(String(id));
  const { rows } = await query(
    `SELECT ${SHIFT_COLS.join(", ")} FROM shifts WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// The single-document lookup used by assignShift's default-shift conflict check
// (Shift.findOne({ shiftName, active: true }).sort({ createdAt: -1 })) and by
// attendanceController.resolveShiftDefinition
// (Shift.findOne({ shiftName: /^name$/i, active: true })
//  .sort({ updatedAt: -1, createdAt: -1 })). The caller supplies the exact Mongo
// sort key; the default order is { createdAt: -1 }.
const findOne = async (filter = {}, sort = { createdAt: -1 }) => {
  if (!dbConfig.isDbConnected()) return Shift.findOne(filter).sort(sort);
  const { where, values } = buildShiftFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const { rows } = await query(
    `SELECT ${SHIFT_COLS.join(", ")} FROM shifts ${where} ORDER BY ${orderBy}, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Shift.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildShiftFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${SHIFT_COLS.join(", ")} FROM shifts ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  validate(data);
  if (!dbConfig.isDbConnected()) return Shift.create(data);
  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO shifts (${SHIFT_COLS.join(", ")})
     VALUES (${SHIFT_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
    SHIFT_COLS.map((col) => row[col])
  );
  return findById(id);
};

// Patches only the supplied fields, on whichever datasource is selected — the
// PostgreSQL equivalent of mutating the loaded Mongoose document and calling
// save() (updateShift).
const updateById = async (id, updates) => {
  if (updates) {
    if (updates.shiftName !== undefined) assertId(updates.shiftName, "shiftName");
    if (updates.startTime !== undefined) assertId(updates.startTime, "startTime");
    if (updates.endTime !== undefined) assertId(updates.endTime, "endTime");
    if (updates.requiredStaff !== undefined) assertNumber(updates.requiredStaff, "requiredStaff");
  }
  if (!dbConfig.isDbConnected()) {
    return Shift.findByIdAndUpdate(id, updates, { new: true });
  }

  const assignments = [];
  const values = [];
  const apply = (col, value) => {
    values.push(value);
    assignments.push(`${col} = $${values.length}`);
  };

  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    switch (key) {
      case "shiftName": apply("shift_name", assertId(value, "shiftName")); break;
      case "startTime": apply("start_time", assertId(value, "startTime")); break;
      case "endTime": apply("end_time", assertId(value, "endTime")); break;
      case "category": apply("category", textOrDefault(value, "General")); break;
      case "requiredStaff": apply("required_staff", numberOrDefault(value, 1)); break;
      case "active": apply("active", Boolean(value)); break;
      case "notes": apply("notes", textOrDefault(value, "")); break;
      default: break;
    }
  }

  if (!assignments.length) return findById(id);

  assignments.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE shifts SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

// Mirrors Shift.findByIdAndDelete(id) on the fallback branch. The controller's
// follow-up Task.deleteMany({ shiftId }) stays in the controller — Task is a
// separate domain and is not migrated in this phase.
const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Shift.findByIdAndDelete(String(id));
  const { rows } = await query(
    `DELETE FROM shifts WHERE id = $1 RETURNING ${SHIFT_COLS.join(", ")}`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Shift.countDocuments(filter);
  const { where, values } = buildShiftFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM shifts ${where}`, values);
  return rows[0]?.count || 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  destroy,
  count,
  validate,
};