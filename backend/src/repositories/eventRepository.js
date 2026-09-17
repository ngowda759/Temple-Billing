const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Event = require("../models/Event");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enum declared in backend/src/models/Event.js exactly.
const STATUSES = new Set(["Upcoming", "Active", "Completed", "Cancelled"]);

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertRequiredText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// date is `{ type: Date, required: true }` and endDate is a bare Date. Mongoose
// casts to Date and raises a CastError on unparseable input, so both are
// required to be valid instants when present.
const toDate = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

const assertRequiredDate = (value, label) => {
  const date = toDate(value, label);
  if (!date) throw new Error(`${label} is required`);
  return date;
};

// slots / registrations / collection are bare Numbers with no min, no max and
// no integer constraint in Mongo. Every write path coerces with
// `Number(value) || 0`, so a fractional value is legal and persisted today.
// Only finiteness is enforced, mirroring Mongoose's cast failure.
const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  if (!Number.isFinite(Number(value))) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// The schema declares `default: 0`, and the controllers coerce with
// `Number(value) || 0`, so a missing/invalid value becomes 0 — never NULL.
const toCountOrDefault = (value, label) => {
  assertNumber(value, label);
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  return Number(value) || 0;
};

// Optional trimmed Strings: an absent field stays absent (NULL), while an
// explicit '' is preserved as '' because the schema's `trim: true` keeps it.
// That distinction matters — devoteeController.updateEvent assigns
// `String(description || "").trim()` (which can be ''), and the frontend reads
// the field back verbatim.
const nullableText = (value) =>
  value === undefined || value === null ? null : String(value).trim();

const EVENT_COLS = [
  "id", "title", "date", "end_date", "location", "description", "image",
  "slots", "registrations", "collection", "status", "created_at", "updated_at",
];

// NUMERIC columns arrive from the driver as strings; the Mongoose model hands
// the application JS Numbers, so every numeric column is converted back.
const toNumberOrNull = (value) =>
  value === null || value === undefined ? undefined : Number(value);

// Converts an events row into the shape the application receives from Mongoose
// (camelCase, Mongo _id, unset optionals as undefined).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    title: row.title,
    date: row.date,
    endDate: row.end_date === null || row.end_date === undefined ? undefined : row.end_date,
    location: row.location,
    description: row.description === null || row.description === undefined ? undefined : row.description,
    image: row.image === null || row.image === undefined ? undefined : row.image,
    slots: Number(row.slots),
    registrations: Number(row.registrations),
    collection: Number(row.collection),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// The persisted key set, exactly as the strict Mongoose schema defines it. The
// controllers spread `req.body` into Event.create (eventController.createEvent),
// so unknown keys such as imageUrl are silently discarded by Mongoose's strict
// mode — the repository must discard them too.
const PERSISTED_KEYS = [
  "title", "date", "endDate", "location", "description", "image", "slots",
  "registrations", "collection", "status", "createdAt", "updatedAt",
];

const pickPersisted = (data) => {
  const picked = {};
  for (const key of PERSISTED_KEYS) {
    if (data[key] !== undefined) picked[key] = data[key];
  }
  return picked;
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  title: assertRequiredText(data.title, "title"),
  date: assertRequiredDate(data.date, "date"),
  end_date: toDate(data.endDate, "endDate"),
  location: assertRequiredText(data.location, "location"),
  description: nullableText(data.description),
  image: nullableText(data.image),
  slots: toCountOrDefault(data.slots, "slots"),
  registrations: toCountOrDefault(data.registrations, "registrations"),
  collection: toCountOrDefault(data.collection, "collection"),
  status: data.status === undefined || data.status === null || data.status === "" ? "Upcoming" : data.status,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const validate = (data) => {
  if (!data) throw new Error("Event data is required");
  assertRequiredText(data.title, "title");
  assertRequiredDate(data.date, "date");
  assertRequiredText(data.location, "location");
  toDate(data.endDate, "endDate");
  assertEnum(data.status, STATUSES, "status");
  assertNumber(data.slots, "slots");
  assertNumber(data.registrations, "registrations");
  assertNumber(data.collection, "collection");
};

// ─── Filter translation ────────────────────────────────────────────────────
// The application builds exactly these Mongo shapes, all of which must keep
// their exact meaning:
//   getEvents / getFestivalOverview auto-complete:
//     { date: { $lt: todayStart }, status: { $in: ['Upcoming', 'Active'] } }
//   getFestivalOverview counts:
//     { date: { $gte: todayStart }, status: { $nin: ['Completed', 'Cancelled'] } }
//     { date: { $gte: todayStart, $lt: tomorrowStart } }
//     { date: { $gte: monthStart, $lt: nextMonthStart } }

const pushCond = (conditions, values, col, op, value) => {
  values.push(value);
  conditions.push(`${col} ${op} $${values.length}`);
};

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
        pushCond(conditions, values, col, "<>", dateCol ? new Date(input.$ne) : String(input.$ne));
      }
      return;
    }
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      }
    }
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  } else {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : String(input));
  }
};

// Translates one Mongo filter object into an AND-ed list of SQL predicates.
// `$or` recurses so nested predicates keep their exact meaning.
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
  if (filter.location !== undefined) pushComparison(conditions, values, "location", filter.location);
  if (filter.description !== undefined) pushComparison(conditions, values, "description", filter.description);
  if (filter.image !== undefined) pushComparison(conditions, values, "image", filter.image);

  if (filter.status !== undefined) pushComparison(conditions, values, "status", filter.status);
  pushComparison(conditions, values, "slots", filter.slots);
  pushComparison(conditions, values, "registrations", filter.registrations);
  pushComparison(conditions, values, "collection", filter.collection);

  pushComparison(conditions, values, "date", filter.date, true);
  pushComparison(conditions, values, "end_date", filter.endDate, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return conditions;
};

const buildFilter = (filter = {}) => {
  const values = [];
  const conditions = buildConditions(filter, values);
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// Whitelisted sort columns mirroring the actual query patterns. The only
// standing Event sort in the codebase is Event.find().sort({ date: 1 }), so
// `date ASC` is the default for the (unused) no-sort case.
const SORT_COLUMNS = {
  id: "id",
  title: "title",
  date: "date",
  endDate: "end_date",
  location: "location",
  description: "description",
  image: "image",
  slots: "slots",
  registrations: "registrations",
  collection: "collection",
  status: "status",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "date ASC";

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

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Event.findById(String(id));
  const { rows } = await query(
    `SELECT ${EVENT_COLS.join(", ")} FROM events WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// The listing used by both getEvents handlers
// (Event.find().sort({ date: 1 })). limit/offset are supported so pagination
// semantics are preserved if a caller ever passes them; no current Event query
// paginates.
const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Event.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${EVENT_COLS.join(", ")} FROM events ${where} ORDER BY ${orderBy}, id ASC`;
  if (Number.isInteger(Number(limit)) && Number(limit) > 0) sql += ` LIMIT ${Number(limit)}`;
  if (Number.isInteger(Number(offset)) && Number(offset) > 0) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

// Mirrors Event.create(payload). The payload is narrowed to the strict schema's
// persisted key set first, so unknown body keys behave exactly as they do under
// Mongoose's strict mode. A single-table insert has no second table to keep
// atomic, so no transaction is introduced.
const create = async (data) => {
  if (!dbConfig.isDbConnected()) return Event.create(pickPersisted(data || {}));

  const payload = pickPersisted(data || {});
  validate(payload);
  const id = (data && data.id) || newId();
  const row = toRow(payload, id);
  await query(
    `INSERT INTO events (${EVENT_COLS.join(", ")})
     VALUES (${EVENT_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    EVENT_COLS.map((col) => row[col])
  );
  return findById(id);
};

// Field → column mapping used by every partial update, so the assignment rules
// are declared once.
const ASSIGNMENTS = {
  title: ["title", (v) => assertRequiredText(v, "title")],
  date: ["date", (v) => assertRequiredDate(v, "date")],
  endDate: ["end_date", (v) => toDate(v, "endDate")],
  location: ["location", (v) => assertRequiredText(v, "location")],
  description: ["description", nullableText],
  image: ["image", nullableText],
  slots: ["slots", (v) => toCountOrDefault(v, "slots")],
  registrations: ["registrations", (v) => toCountOrDefault(v, "registrations")],
  collection: ["collection", (v) => toCountOrDefault(v, "collection")],
  status: ["status", (v) => {
    assertEnum(v, STATUSES, "status");
    return v;
  }],
};

// The only paths a write path can explicitly clear. devoteeController.updateEvent
// assigns `event.image = imageUrl || undefined`, so a blank imageUrl UNSETS the
// field rather than storing '' — the controllers express that as null here, and
// the repository maps it to NULL. Every other path is required or defaulted, so
// a null is dropped rather than written (no controller produces one).
const UNSETTABLE_KEYS = new Set(["image", "description", "endDate"]);

// Mirrors the controllers' findById → conditional field assignment → save()
// flow (eventController.updateEvent / devoteeController.updateEvent and both
// updateEventStatus handlers). Fields absent from `updates` are left untouched;
// an explicit undefined is skipped exactly as `if (x != null)` skips it.
const updateById = async (id, updates = {}) => {
  if (!id) return null;

  const narrowed = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    if (!ASSIGNMENTS[key]) continue;
    if (value === null && !UNSETTABLE_KEYS.has(key)) continue;
    narrowed[key] = value;
  }

  if (!dbConfig.isDbConnected()) {
    if (!Object.keys(narrowed).length) return Event.findById(String(id));
    return Event.findByIdAndUpdate(String(id), narrowed, { new: true, runValidators: true });
  }

  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(narrowed)) {
    const [col, coerce] = ASSIGNMENTS[key];
    pushCond(setClauses, values, col, "=", coerce(value));
  }
  if (!setClauses.length) return findById(id);

  setClauses.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE events SET ${setClauses.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

// Mirrors the aggregate bumps the booking/donation flows issue:
// Event.findByIdAndUpdate(id, { $inc: { registrations: 1, collection: n } })
// and { $inc: { collection: n } }. Mongo's $inc adds to the stored value (the
// columns are NOT NULL DEFAULT 0) and is a no-op when the document is missing.
const incrementById = async (id, increments = {}) => {
  if (!id) return null;

  const parts = [];
  const values = [];
  for (const column of ["registrations", "collection"]) {
    if (increments[column] === undefined) continue;
    assertNumber(increments[column], column);
    values.push(Number(increments[column]) || 0);
    parts.push(`${column} = ${column} + $${values.length}`);
  }

  if (!dbConfig.isDbConnected()) {
    if (!parts.length) return Event.findById(String(id));
    return Event.findByIdAndUpdate(String(id), { $inc: { ...increments } }, { new: true });
  }

  if (!parts.length) return findById(id);
  parts.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE events SET ${parts.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

// Mirrors the auto-complete write both getEvents handlers and
// getFestivalOverview run before reading:
// Event.updateMany({ date: { $lt: todayStart }, status: { $in: [...] } },
//                  { $set: { status: 'Completed' } })
const updateMany = async (filter = {}, updates = {}) => {
  if (!dbConfig.isDbConnected()) return Event.updateMany(filter, updates);

  const setClauses = [];
  const values = [];
  const sets = updates.$set || updates;
  for (const [key, value] of Object.entries(sets || {})) {
    if (value === undefined) continue;
    const mapping = ASSIGNMENTS[key];
    if (!mapping) continue;
    const [col, coerce] = mapping;
    pushCond(setClauses, values, col, "=", coerce(value));
  }
  if (!setClauses.length) return { modifiedCount: 0 };

  setClauses.push("updated_at = now()");
  // The SET placeholders were numbered from $1; rebase the WHERE placeholders by
  // the number of SET values (not clauses — `updated_at = now()` carries no
  // parameter) so the two sets cannot collide.
  const offset = values.length;
  const { where, values: filterValues } = buildFilter(filter);
  for (const value of filterValues) values.push(value);
  const rebased = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  const result = await query(`UPDATE events SET ${setClauses.join(", ")} ${rebased}`, values);
  return { modifiedCount: result.rowCount };
};

// Mirrors Event.countDocuments(filter) — the three getFestivalOverview counts.
const countDocuments = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Event.countDocuments(filter);
  const { where, values } = buildFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM events ${where}`, values);
  return rows[0] ? rows[0].count : 0;
};

// Mirrors the two getFestivalOverview $group aggregations
// ($sum of registrations and collection, all-time and current-month). Mongo's
// $sum over an empty match yields no group row, which the controller treats as
// 0, so COALESCE reproduces the same result.
const sumTotals = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) {
    const agg = await Event.aggregate([
      { $match: filter },
      { $group: { _id: null, registrations: { $sum: "$registrations" }, collection: { $sum: "$collection" } } },
    ]);
    return {
      registrations: (agg[0] && agg[0].registrations) || 0,
      collection: (agg[0] && agg[0].collection) || 0,
    };
  }
  const { where, values } = buildFilter(filter);
  const { rows } = await query(
    `SELECT COALESCE(SUM(registrations), 0)::text AS registrations,
            COALESCE(SUM(collection), 0)::text AS collection
       FROM events ${where}`,
    values
  );
  return {
    registrations: Number(rows[0] ? rows[0].registrations : 0) || 0,
    collection: Number(rows[0] ? rows[0].collection : 0) || 0,
  };
};

// Mirrors devoteeController.deleteEvent's Event.findByIdAndDelete(id). The
// Mongoose call returns the deleted document (or null), so the repository
// returns the same shape for the controller's response body.
const findByIdAndDelete = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Event.findByIdAndDelete(String(id));
  const existing = await findById(id);
  if (!existing) return null;
  await query("DELETE FROM events WHERE id = $1", [String(id)]);
  return existing;
};

module.exports = {
  STATUSES,
  validate,
  findById,
  findMany,
  create,
  updateById,
  incrementById,
  updateMany,
  countDocuments,
  sumTotals,
  findByIdAndDelete,
};
