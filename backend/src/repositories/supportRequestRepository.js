const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const SupportRequest = require("../models/SupportRequest");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const SUPPORT_REQUEST_COLS = [
  "id", "name", "email", "subject", "message", "reply", "status", "read",
  "created_at", "updated_at",
];

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertRequiredText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// `reply` is `{ type: String, trim: true }` with NO default and NOT required.
// Mongoose therefore distinguishes three cases and all three are preserved:
//   * omitted → the property stays undefined on a read (returned as undefined,
//     not null, matching cashClosingRepository's handling of its optional paths)
//   * explicit null → accepted and stored as null
//   * a value → cast to String and trimmed (so '   ' stores '')
const nullableTrimmedText = (value) =>
  value === undefined || value === null ? null : String(value).trim();

// `read` is `{ type: Boolean, default: false }` and NOT required: Mongoose casts
// any truthy/falsy value and an explicit null is accepted (stored as null). The
// column is NOT NULL, so a null collapses to the schema default — the same
// choice notificationRepository makes for its defaulted booleans.
const boolOrDefault = (value, fallback) =>
  value === undefined || value === null ? fallback : Boolean(value);

// `status` is `{ type: String, enum: [...], default: 'Open' }` and NOT required.
// An omitted value takes the default; an explicit null is ACCEPTED by Mongoose
// and stored as null (the CHECK constraint passes for a null); any other value
// must be one of the three enum members, because MongoDB rejects anything else.
// Note `status` declares NO `trim`, so the value is passed through untouched —
// ' Open ' is rejected here exactly as Mongoose rejects it.
const SUPPORT_REQUEST_STATUSES = new Set(["Open", "In Progress", "Closed"]);

const toStatus = (value) => {
  if (value === undefined) return "Open";
  if (value === null) return null;
  const text = String(value);
  if (!SUPPORT_REQUEST_STATUSES.has(text)) {
    throw new Error(
      `Invalid status: ${text}. Allowed: ${[...SUPPORT_REQUEST_STATUSES].join(", ")}`
    );
  }
  return text;
};

// Converts a support_requests row into the shape the application receives from
// Mongoose: _id, camelCase field names, and the stored value unchanged. An
// omitted reply comes back as `undefined` (the controller serialises it away),
// exactly as an unset Mongoose path does.
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

// Builds the full column payload for an insert, reproducing the model's defaults
// and its four distinct validation behaviours (see the migration header):
//   required + trim (name/email/subject/message) → a blank value is passed
//     through as NULL so PostgreSQL rejects it exactly as Mongoose's validator
//     does.
//   default + enum (status)                      → omitted becomes 'Open', null
//     is preserved, anything else must be in the enum.
//   trim, no default (reply)                     → omitted stays NULL.
//   default (read)                               → omitted and null become false.
const toRow = (data, id = newId()) => ({
  id,
  name: assertRequiredText(data.name, "name"),
  email: assertRequiredText(data.email, "email"),
  subject: assertRequiredText(data.subject, "subject"),
  message: assertRequiredText(data.message, "message"),
  reply: nullableTrimmedText(data.reply),
  status: toStatus(data.status),
  read: boolOrDefault(data.read, false),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const validate = (data) => {
  if (!data) throw new Error("SupportRequest data is required");
  toRow(data);
};

// The only filter the application builds is getSupportRequests' optional email
// equality (`{ email }` or `{}`). Id lookups go through findById/markRead.
const buildSupportRequestFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  const push = (col, value) => {
    if (value === undefined) return;
    if (value === null) {
      conditions.push(`${col} IS NULL`);
      return;
    }
    values.push(String(value));
    conditions.push(`${col} = $${values.length}`);
  };

  push("id", filter.id);
  push("id", filter._id);
  push("name", filter.name);
  push("email", filter.email);
  push("subject", filter.subject);
  push("message", filter.message);
  push("reply", filter.reply);
  push("status", filter.status);
  if (filter.read !== undefined) {
    values.push(Boolean(filter.read));
    conditions.push(`read = $${values.length}`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// Whitelisted sort columns so dynamic ordering can never inject SQL. The only
// sort the application performs is { createdAt: -1 } (getSupportRequests).
const SORT_COLUMNS = {
  id: "id",
  name: "name",
  email: "email",
  subject: "subject",
  message: "message",
  reply: "reply",
  status: "status",
  read: "read",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "created_at DESC";

const resolveOrderBy = (sort) => {
  const entries = typeof sort === "string" ? [[sort, 1]] : Object.entries(sort || {});
  const parts = [];
  for (const [key, direction] of entries) {
    const col = SORT_COLUMNS[key];
    if (!col) continue;
    const dir =
      direction === "DESC" || Number(direction) === -1
        ? "DESC"
        : direction === "ASC" || Number(direction) === 1
          ? "ASC"
          : null;
    if (!dir) continue;
    parts.push(`${col} ${dir}`);
  }
  return parts.length ? parts.join(", ") : DEFAULT_ORDER;
};

// Mirrors SupportRequest.create(data) — submitSupportRequest.
const create = async (data) => {
  if (!data) throw new Error("SupportRequest data is required");
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

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return SupportRequest.findById(String(id));
  const { rows } = await query(
    `SELECT ${SUPPORT_REQUEST_COLS.join(", ")} FROM support_requests WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

/**
 * The listing behind GET /support. Mirrors
 * SupportRequest.find(filter).sort({ createdAt: -1 }) — the only listing query
 * the domain has, with the optional email equality as its only filter.
 *
 * The secondary `id ASC` tiebreaker makes the order total: Mongo leaves rows
 * created in the same millisecond in natural order, which is not a state
 * PostgreSQL — or a caller — can rely on. The controller reads the whole array,
 * so a stable tiebreak changes nothing observable.
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

/**
 * Mirrors replySupportRequest's `findById(id)` → mutate → `.save()`.
 *
 * That controller path loads the document and calls save(), so Mongoose runs the
 * full document validators — unlike the mark-read path below, which uses
 * findByIdAndUpdate with no `runValidators`. The two operations are therefore
 * modelled separately, and this one is named for the controller's use rather
 * than mirroring a single Mongoose call.
 *
 * Only the two fields replySupportRequest can write are accepted; `id`, the
 * timestamps and the caller-supplied fields are not writable here. The
 * controller always sets a non-empty reply and a valid enum status, so the
 * CHECK constraints are never in play for this path.
 */
const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    const doc = await SupportRequest.findById(String(id));
    if (!doc) return null;
    for (const field of ["reply", "status"]) {
      if (updates[field] !== undefined) doc[field] = updates[field];
    }
    await doc.save();
    return doc;
  }

  const sets = [];
  const values = [];
  const assign = (col, value) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (updates.reply !== undefined) assign("reply", nullableTrimmedText(updates.reply));
  if (updates.status !== undefined) assign("status", toStatus(updates.status));

  if (!sets.length) return findById(id);

  // `updated_at` mirrors Mongoose's `timestamps: true` on a save/update.
  assign("updated_at", new Date());
  values.push(String(id));

  const { rows } = await query(
    `UPDATE support_requests SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${SUPPORT_REQUEST_COLS.join(", ")}`,
    values
  );
  return toDoc(rows[0]);
};

/**
 * Mirrors markSupportRequestAsRead's
 * `SupportRequest.findByIdAndUpdate(id, { read: true }, { new: true })`.
 *
 * Kept as its own operation rather than a generic updateById call because the
 * controller's Mongoose call is a direct findByIdAndUpdate with NO
 * runValidators and a single fixed field — the same shape
 * notificationRepository.findByIdAndUpdate mirrors.
 */
const markRead = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    return SupportRequest.findByIdAndUpdate(String(id), { read: true }, { new: true });
  }

  const { rows } = await query(
    `UPDATE support_requests SET read = true, updated_at = now() WHERE id = $1 RETURNING ${SUPPORT_REQUEST_COLS.join(", ")}`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

module.exports = {
  create,
  findById,
  findMany,
  updateById,
  markRead,
  validate,
  toDoc,
  toRow,
  resolveOrderBy,
};
