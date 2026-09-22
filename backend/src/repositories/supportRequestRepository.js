const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const SupportRequest = require("../models/SupportRequest");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const SUPPORT_REQUEST_COLS = [
  "id", "name", "email", "subject", "message", "reply", "status", "read",
  "created_at", "updated_at",
];

// The writable columns the controller can actually set. `id`, `createdAt` and
// `updatedAt` are never caller-assigned through the update path.
const UPDATABLE = ["name", "email", "subject", "message", "reply", "status", "read"];

// Mirrors Mongoose's required+trim on a String path: an omitted, null, empty or
// whitespace-only value fails validation (trim runs before the required check,
// so '   ' collapses to '' and fails). Returns null so the NOT NULL column
// rejects the write exactly as Mongoose does.
const requiredText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
};

// Mirrors the model's `trim: true` on an OPTIONAL String path (`reply`, which
// has no default). An omitted or explicit-null value is stored as null; a
// supplied value is cast to String and trimmed, exactly as Mongoose does.
const optionalText = (value) => {
  if (value === undefined || value === null) return null;
  return String(value).trim();
};

// Mirrors Mongoose's Boolean cast: a boolean passes through, a number is
// non-zero, and the strings "false"/"0" map to false while any other string is
// truthy. An explicit null is preserved (the model's `default` fires only for an
// omitted value and `read` is not required).
const castBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "false" || normalized === "0") return false;
    if (normalized === "") return false;
    return true;
  }
  return Boolean(value);
};

const optionalBoolean = (value) => {
  if (value === undefined) return false;
  if (value === null) return null;
  return castBoolean(value);
};

// Mirrors the model's `status` enum + `default: 'Open'`: an omitted value
// becomes the default, while an explicit null validates in Mongo (the path is
// not required) and is stored as null. A supplied value is trimmed by the schema
// and then checked against the enum by both the CHECK constraint and Mongoose.
const optionalStatus = (value) => {
  if (value === undefined) return "Open";
  if (value === null) return null;
  return String(value).trim();
};

// Converts a support_requests row into the shape the application receives from
// Mongoose: _id, camelCase field names and `undefined` for a path the model
// leaves unset. `reply` is returned as undefined while NULL because that is what
// a Mongoose document exposes before an admin replies.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    reply: row.reply === null || row.reply === undefined ? undefined : row.reply,
    status: row.status,
    read: row.read,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the insert payload, reproducing the model's defaults and its three
// distinct validation behaviours:
//   required + trim (name/email/subject/message) → NOT NULL columns; a
//     blank/omitted value becomes NULL so PostgreSQL rejects it exactly as
//     Mongoose's required validator does.
//   default, not required (status/read) → nullable columns; an omitted value
//     becomes the default while an explicit null is preserved, as Mongoose
//     accepts.
//   neither (reply) → NULL.
const toRow = (data, id = newId()) => ({
  id,
  name: requiredText(data.name),
  email: requiredText(data.email),
  subject: requiredText(data.subject),
  message: requiredText(data.message),
  reply: optionalText(data.reply),
  status: optionalStatus(data.status),
  read: optionalBoolean(data.read),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL. The only
// sort the application performs is { createdAt: -1 } (getSupportRequests).
const SORT_COLUMNS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
  email: "email",
  subject: "subject",
  status: "status",
  read: "read",
};

const DEFAULT_ORDER = "created_at DESC";

const resolveOrderBy = (sort) => {
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
  if (!col) return DEFAULT_ORDER;
  const dir =
    direction === "DESC" || Number(direction) === -1
      ? "DESC"
      : direction === "ASC" || Number(direction) === 1
        ? "ASC"
        : null;
  return dir ? `${col} ${dir}` : DEFAULT_ORDER;
};

// Translates the Mongo-style filters the application and tests build, plus the
// id/createdAt/updatedAt CRUD surface.
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input === undefined) return;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [op, opVal] of Object.entries(input)) {
      if (opVal === undefined || opVal === null) continue;
      if (op === "$in") {
        if (!Array.isArray(opVal) || opVal.length === 0) {
          // An empty $in matches nothing in Mongo; emit a false predicate
          // rather than dropping the condition.
          conditions.push("1 = 0");
          continue;
        }
        values.push(opVal.map((v) => (dateCol ? new Date(v) : String(v))));
        conditions.push(`${col} = ANY($${values.length})`);
      } else if (op === "$ne") {
        values.push(dateCol ? new Date(opVal) : opVal);
        conditions.push(`${col} <> $${values.length}`);
      } else if (op === "$gte" || op === "$gt" || op === "$lte" || op === "$lt") {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        values.push(dateCol ? new Date(opVal) : opVal);
        conditions.push(`${col} ${sqlOp} $${values.length}`);
      } else if (op === "$regex") {
        values.push(String(opVal));
        conditions.push(`${col} ~* $${values.length}`);
      }
    }
    return;
  }
  values.push(dateCol ? new Date(input) : input);
  conditions.push(`${col} = $${values.length}`);
};

const buildSupportRequestFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (filter.id !== undefined) pushComparison(conditions, values, "id", filter.id);
  if (filter._id !== undefined) pushComparison(conditions, values, "id", filter._id);
  if (filter.name !== undefined) pushComparison(conditions, values, "name", filter.name);
  if (filter.email !== undefined) pushComparison(conditions, values, "email", filter.email);
  if (filter.subject !== undefined) pushComparison(conditions, values, "subject", filter.subject);
  if (filter.message !== undefined) pushComparison(conditions, values, "message", filter.message);
  if (filter.reply !== undefined) pushComparison(conditions, values, "reply", filter.reply);
  if (filter.status !== undefined) pushComparison(conditions, values, "status", filter.status);
  if (filter.read !== undefined) pushComparison(conditions, values, "read", filter.read);
  if (filter.createdAt !== undefined) pushComparison(conditions, values, "created_at", filter.createdAt, true);
  if (filter.updatedAt !== undefined) pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return SupportRequest.findById(String(id));
  const { rows } = await query(
    `SELECT ${SUPPORT_REQUEST_COLS.join(", ")} FROM support_requests WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return SupportRequest.findOne(filter);
  const { where, values } = buildSupportRequestFilter(filter);
  const { rows } = await query(
    `SELECT ${SUPPORT_REQUEST_COLS.join(", ")} FROM support_requests ${where} ORDER BY created_at DESC, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

/**
 * The listing behind GET /support. Mirrors
 * SupportRequest.find(filter).sort({ createdAt: -1 }) — the only listing query
 * the domain has. `filter` is `{ email }` when the optional query is present and
 * `{}` otherwise.
 *
 * The secondary `id ASC` tiebreaker makes the order total: Mongo leaves rows
 * with an equal createdAt in natural order, which is not a state PostgreSQL — or
 * a caller — can rely on. The controller reads the whole array, so a stable
 * tiebreak changes nothing observable.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = SupportRequest.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }

  const { where, values } = buildSupportRequestFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${SUPPORT_REQUEST_COLS.join(", ")} FROM support_requests ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  if (!data) throw new Error("Support request data is required");
  if (!dbConfig.isDbConnected()) return SupportRequest.create(data);

  const row = toRow(data, data.id ? String(data.id) : newId());
  const { rows } = await query(
    `INSERT INTO support_requests (${SUPPORT_REQUEST_COLS.join(", ")})
     VALUES (${SUPPORT_REQUEST_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING ${SUPPORT_REQUEST_COLS.join(", ")}`,
    SUPPORT_REQUEST_COLS.map((c) => row[c])
  );
  return toDoc(rows[0]);
};

/**
 * Mirrors the reply/read mutation surface. The controller loads the document
 * first (findById), computes the new `reply`/`status`/`read`, then persists —
 * the same observable result as the original findById + save(), with
 * `updated_at` mirroring Mongoose's `timestamps: true` on an update.
 *
 * `status` is written verbatim because the controller already resolves the
 * fallback-to-'Closed' rule before calling in; the column CHECK still rejects an
 * out-of-enum value exactly as Mongoose's enum validator does. Only the columns
 * in UPDATABLE are writable; `id` and the timestamps are not.
 */
const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    return SupportRequest.findByIdAndUpdate(String(id), updates, { new: true });
  }

  const sets = [];
  const values = [];
  const assign = (col, value) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  for (const field of UPDATABLE) {
    if (updates[field] === undefined) continue;
    const col = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    if (field === "name" || field === "email" || field === "subject" || field === "message") {
      assign(col, requiredText(updates[field]));
    } else if (field === "reply") {
      assign(col, optionalText(updates[field]));
    } else if (field === "status") {
      // An explicit null is preserved (the path is not required); a supplied
      // value is trimmed and left for the CHECK to validate.
      assign(col, updates.status === null ? null : String(updates.status).trim());
    } else if (field === "read") {
      assign(col, updates.read === null ? null : castBoolean(updates.read));
    }
  }

  if (!sets.length) return findById(id);

  assign("updated_at", new Date());
  values.push(String(id));

  const { rows } = await query(
    `UPDATE support_requests SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${SUPPORT_REQUEST_COLS.join(", ")}`,
    values
  );
  return toDoc(rows[0]);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return SupportRequest.countDocuments(filter);
  const { where, values } = buildSupportRequestFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM support_requests ${where}`, values);
  return rows[0].n;
};

const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return SupportRequest.findByIdAndDelete(String(id));
  const { rows } = await query(
    `DELETE FROM support_requests WHERE id = $1 RETURNING ${SUPPORT_REQUEST_COLS.join(", ")}`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  destroy,
  toDoc,
  toRow,
  resolveOrderBy,
};
