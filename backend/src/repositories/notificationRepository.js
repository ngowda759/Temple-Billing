const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Notification = require("../models/Notification");
const notificationEmail = require("../utils/notificationEmail");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertRequiredText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// Every optional String/Date path in the schema has NO default, so an absent
// field stays absent (NULL) rather than becoming ''. An explicit empty string is
// preserved as '' because the schema's `trim: true` keeps it as '' — that
// distinction matters: devoteeController's general-broadcast predicate matches
// on `audienceEmail: ''` as well as null.
const nullableText = (value) =>
  value === undefined || value === null ? null : String(value).trim();

// audienceEmail / audienceRole / emailRecipient declare `lowercase: true`.
const nullableLowerText = (value) =>
  value === undefined || value === null ? null : String(value).trim().toLowerCase();

const toDateOrNull = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

// Mirror of the schema's `default: Date.now` on the NOT NULL date path.
const toDateOrDefault = (value, label) => toDateOrNull(value, label) || new Date();

const boolOrDefault = (value, fallback) => (value === undefined || value === null ? fallback : Boolean(value));

const NOTIFICATION_COLS = [
  "id", "title", "message", "audience_id", "audience_email", "audience_role",
  "category", "date", "viewed", "viewed_at", "read", "read_at", "attachment",
  "email_sent", "email_sent_at", "email_recipient", "created_at", "updated_at",
];

// Converts a notifications row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). The two flags keep their false default and
// the four nullable instants (date is NOT NULL) come back as null when unset.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    title: row.title,
    message: row.message,
    audienceId: row.audience_id || undefined,
    audienceEmail: row.audience_email || undefined,
    audienceRole: row.audience_role || undefined,
    category: row.category || undefined,
    date: row.date,
    viewed: row.viewed,
    viewedAt: row.viewed_at || null,
    read: row.read,
    readAt: row.read_at || null,
    attachment: row.attachment || undefined,
    emailSent: row.email_sent,
    emailSentAt: row.email_sent_at || null,
    emailRecipient: row.email_recipient || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  title: assertRequiredText(data.title, "title"),
  message: assertRequiredText(data.message, "message"),
  audience_id: nullableText(data.audienceId),
  audience_email: nullableLowerText(data.audienceEmail),
  audience_role: nullableLowerText(data.audienceRole),
  category: nullableText(data.category),
  date: toDateOrDefault(data.date, "date"),
  viewed: boolOrDefault(data.viewed, false),
  viewed_at: toDateOrNull(data.viewedAt, "viewedAt"),
  read: boolOrDefault(data.read, false),
  read_at: toDateOrNull(data.readAt, "readAt"),
  attachment: nullableText(data.attachment),
  email_sent: boolOrDefault(data.emailSent, false),
  email_sent_at: toDateOrNull(data.emailSentAt, "emailSentAt"),
  email_recipient: nullableLowerText(data.emailRecipient),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const validate = (data) => {
  if (!data) throw new Error("Notification data is required");
  toRow(data);
};

// ─── Filter translation ────────────────────────────────────────────────────
// The application builds exactly these Mongo shapes, all of which must keep
// their exact meaning:
//   notificationController: { $or: [{ audienceRole }, { audienceId }], category: { $nin } }
//   staffController:        { $or: [{ audienceRole: 'staff' },
//                                    { audienceId: { $in: ids } },
//                                    { audienceEmail: { $in: emails } }] }
//   priestController:       { $or: [{ audienceId }, { audienceEmail }, { audienceRole: 'priest' }] }
//   devoteeController:      { $or: [{ audienceEmail }, { audienceEmail: { $in: aliases } },
//                                    { audienceRole: { $in: ['devotee','all'] },
//                                      audienceEmail: { $in: [null,'',undefined] },
//                                      audienceId: { $in: [null,'',undefined] } },
//                                    { audienceId }] }
//   unread/viewed writes:   { ...query, read: false } / { ...query, viewed: false }

// Resolves a Mongo `$in` list against a column. Mongo `$in: [null]` matches both
// null and a missing field, so a list containing null/undefined also produces
// `col IS NULL`; an explicit '' is an ordinary value and stays in the IN list.
// An empty list is an instant-false predicate, exactly as in Mongo.
const pushIn = (conditions, values, col, list) => {
  const items = Array.isArray(list) ? list : [list];
  if (items.length === 0) {
    conditions.push("1 = 0");
    return;
  }
  const hasNull = items.some((item) => item === null || item === undefined);
  const strings = [...new Set(items.filter((item) => item !== null && item !== undefined).map((item) => String(item)))];
  const ors = [];
  if (strings.length) {
    const placeholders = strings.map((item) => {
      values.push(item);
      return `$${values.length}`;
    });
    ors.push(`${col} IN (${placeholders.join(", ")})`);
  }
  if (hasNull) ors.push(`${col} IS NULL`);
  conditions.push(ors.length === 1 ? ors[0] : `(${ors.join(" OR ")})`);
};

const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input === undefined) return;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      pushIn(conditions, values, col, input.$in);
      return;
    }
    if (input.$nin !== undefined) {
      // Mongo $nin also matches a missing/null field.
      const items = (Array.isArray(input.$nin) ? input.$nin : [input.$nin])
        .filter((item) => item !== null && item !== undefined)
        .map((item) => String(item));
      if (!items.length) return;
      const placeholders = items.map((item) => {
        values.push(item);
        return `$${values.length}`;
      });
      conditions.push(`(${col} IS NULL OR ${col} NOT IN (${placeholders.join(", ")}))`);
      return;
    }
    if (input.$ne !== undefined) {
      if (input.$ne === null) {
        conditions.push(`${col} IS NOT NULL`);
      } else {
        values.push(dateCol ? new Date(input.$ne) : String(input.$ne));
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
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  } else {
    values.push(dateCol ? new Date(input) : String(input));
    conditions.push(`${col} = $${values.length}`);
  }
};

// Translates one Mongo filter object into an AND-ed list of SQL predicates.
// `$or` recurses so the nested broadcast predicate above keeps its exact
// meaning (the inner keys of a sub-object are implicitly AND-ed).
const buildConditions = (filter, values) => {
  const conditions = [];

  if (Array.isArray(filter.$or)) {
    const ors = filter.$or.map((sub) => {
      const subConditions = buildConditions(sub || {}, values);
      return subConditions.length ? `(${subConditions.join(" AND ")})` : "TRUE";
    });
    conditions.push(ors.length ? `(${ors.join(" OR ")})` : "1 = 0");
  }

  if (filter.id !== undefined) pushComparison(conditions, values, "id", filter.id);
  if (filter._id !== undefined) pushComparison(conditions, values, "id", filter._id);
  if (filter.title !== undefined) pushComparison(conditions, values, "title", filter.title);
  if (filter.message !== undefined) pushComparison(conditions, values, "message", filter.message);
  if (filter.audienceId !== undefined) pushComparison(conditions, values, "audience_id", filter.audienceId);
  if (filter.audienceEmail !== undefined) pushComparison(conditions, values, "audience_email", filter.audienceEmail);
  if (filter.audienceRole !== undefined) pushComparison(conditions, values, "audience_role", filter.audienceRole);
  if (filter.category !== undefined) pushComparison(conditions, values, "category", filter.category);
  if (filter.attachment !== undefined) pushComparison(conditions, values, "attachment", filter.attachment);
  if (filter.emailRecipient !== undefined) pushComparison(conditions, values, "email_recipient", filter.emailRecipient);

  // Mongo `{ read: false }` matches both false and a missing field; the column
  // is NOT NULL DEFAULT false, so a plain equality carries the same meaning.
  if (filter.read !== undefined) {
    values.push(Boolean(filter.read));
    conditions.push(`read = $${values.length}`);
  }
  if (filter.viewed !== undefined) {
    values.push(Boolean(filter.viewed));
    conditions.push(`viewed = $${values.length}`);
  }
  if (filter.emailSent !== undefined) {
    values.push(Boolean(filter.emailSent));
    conditions.push(`email_sent = $${values.length}`);
  }

  pushComparison(conditions, values, "date", filter.date, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return conditions;
};

const buildFilter = (filter = {}) => {
  const values = [];
  const conditions = buildConditions(filter, values);
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// Whitelisted sort columns mirroring the actual query patterns. The application
// always sorts explicitly ({ createdAt: -1 } or { date: -1, createdAt: -1 }), so
// created_at DESC is the default for the (unused) no-sort case.
const SORT_COLUMNS = {
  id: "id",
  title: "title",
  audienceId: "audience_id",
  audienceEmail: "audience_email",
  audienceRole: "audience_role",
  category: "category",
  date: "date",
  read: "read",
  viewed: "viewed",
  emailSent: "email_sent",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "created_at DESC";

// Resolves a Mongo sort object/key into a whitelisted ORDER BY clause. Every key
// is whitelisted (unknown keys are dropped) and the original direction is
// preserved, so a multi-key sort keeps its exact Mongo tie-breaking.
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

// Reproduces the model's post-save email hook on the PostgreSQL path: after a
// row is created with emailSent falsy the recipient is resolved (audienceEmail,
// else User/Employee by audienceId), the temple email is sent, and the row is
// stamped with emailSent/emailSentAt/emailRecipient. Like the Mongoose hook this
// runs detached and can never fail the write.
const dispatchEmail = (doc) => {
  if (!doc) return;
  Promise.resolve()
    .then(() => notificationEmail.dispatchNotificationEmail(doc, async (fields) => {
      const id = doc._id || doc.id;
      if (!id) return;
      await query(
        "UPDATE notifications SET email_sent = $1, email_sent_at = $2, email_recipient = $3, updated_at = now() WHERE id = $4",
        [Boolean(fields.emailSent), fields.emailSentAt || null, fields.emailRecipient ? String(fields.emailRecipient).toLowerCase() : null, String(id)]
      );
    }))
    .catch(() => {});
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Notification.findById(String(id));
  const { rows } = await query(
    `SELECT ${NOTIFICATION_COLS.join(", ")} FROM notifications WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// The listing used by every read path (notificationController.getNotifications,
// staffController.getStaffNotifications, priestController.getNotifications,
// devoteeController.getNotifications). limit/offset preserve the existing
// pagination semantics (priestController's dashboard limit of 10).
const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Notification.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${NOTIFICATION_COLS.join(", ")} FROM notifications ${where} ORDER BY ${orderBy}, id ASC`;
  if (Number.isInteger(Number(limit)) && Number(limit) > 0) sql += ` LIMIT ${Number(limit)}`;
  if (Number.isInteger(Number(offset)) && Number(offset) > 0) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

// staffController.getStaffUnreadCount and seedPriestData's existence probe.
const countDocuments = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Notification.countDocuments(filter);
  const { where, values } = buildFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM notifications ${where}`, values);
  return rows[0] ? rows[0].count : 0;
};

// Mirrors Notification.create(payload) and Notification.create([payloads]) — the
// broadcast path inserts one row per recipient. Mongo inserts documents
// independently, so no surrounding transaction is introduced (a single-table
// write cannot span tables, and there is no child row to keep atomic).
const create = async (data) => {
  if (!dbConfig.isDbConnected()) return Notification.create(data);

  if (Array.isArray(data)) {
    const docs = [];
    for (const item of data) {
      docs.push(await create(item));
    }
    return docs;
  }

  validate(data);
  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO notifications (${NOTIFICATION_COLS.join(", ")})
     VALUES (${NOTIFICATION_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
    NOTIFICATION_COLS.map((col) => row[col])
  );
  const doc = await findById(id);
  // The model's post-save hook runs detached; the created document is returned
  // exactly as Mongo returns it (emailSent still false until the send lands).
  if (!row.email_sent) dispatchEmail(doc);
  return doc;
};

const ASSIGNMENTS = {
  title: ["title", (v) => assertRequiredText(v, "title")],
  message: ["message", (v) => assertRequiredText(v, "message")],
  audienceId: ["audience_id", nullableText],
  audienceEmail: ["audience_email", nullableLowerText],
  audienceRole: ["audience_role", nullableLowerText],
  category: ["category", nullableText],
  date: ["date", (v) => toDateOrDefault(v, "date")],
  viewed: ["viewed", (v) => Boolean(v)],
  viewedAt: ["viewed_at", (v) => toDateOrNull(v, "viewedAt")],
  read: ["read", (v) => Boolean(v)],
  readAt: ["read_at", (v) => toDateOrNull(v, "readAt")],
  attachment: ["attachment", nullableText],
  emailSent: ["email_sent", (v) => Boolean(v)],
  emailSentAt: ["email_sent_at", (v) => toDateOrNull(v, "emailSentAt")],
  emailRecipient: ["email_recipient", nullableLowerText],
};

const applyUpdate = (setClauses, values, updates) => {
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    const mapping = ASSIGNMENTS[key];
    if (!mapping) continue;
    const [col, coerce] = mapping;
    values.push(coerce(value));
    setClauses.push(`${col} = $${values.length}`);
  }
};

// Mirrors Notification.findByIdAndUpdate(id, payload, { new: true }) — the
// mark-read paths in notificationController / staffController / devoteeController
// and the email-stamp write in devoteeController.sendNotificationEmail.
const findByIdAndUpdate = async (id, updates = {}) => {
  if (!dbConfig.isDbConnected()) return Notification.findByIdAndUpdate(id, updates, { new: true });

  const setClauses = [];
  const values = [];
  applyUpdate(setClauses, values, updates);
  if (!setClauses.length) return findById(id);

  setClauses.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE notifications SET ${setClauses.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

// Mirrors Notification.updateMany(filter, payload) — staffController's mark-all
// read / mark-all viewed and priestController's read-all.
const updateMany = async (filter = {}, updates = {}) => {
  if (!dbConfig.isDbConnected()) return Notification.updateMany(filter, updates);

  const setClauses = [];
  const values = [];
  applyUpdate(setClauses, values, updates);
  if (!setClauses.length) return { modifiedCount: 0 };

  setClauses.push("updated_at = now()");
  // The SET placeholders were numbered from $1; rebase the WHERE placeholders by
  // the number of SET *values* (not clauses — `updated_at = now()` carries no
  // parameter) so the two sets cannot collide.
  const offset = values.length;
  const { where, values: filterValues } = buildFilter(filter);
  for (const value of filterValues) {
    values.push(value);
  }
  const rebased = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  const result = await query(
    `UPDATE notifications SET ${setClauses.join(", ")} ${rebased}`,
    values
  );
  return { modifiedCount: result.rowCount };
};

module.exports = {
  findById,
  findMany,
  countDocuments,
  create,
  findByIdAndUpdate,
  updateMany,
  validate,
};
