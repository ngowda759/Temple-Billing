const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Prasadam = require("../models/Prasadam");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// The `status` virtual declared in backend/src/models/Prasadam.js. The schema
// sets toJSON/toObject virtuals:true, so this value is part of the API response
// even though nothing is persisted. It is recomputed on read on the PostgreSQL
// path so both datasources return the identical document shape.
const computeStatus = (availableQuantity, minimumStock) => {
  if (availableQuantity === 0) return "Out Of Stock";
  return availableQuantity <= minimumStock ? "Low Stock" : "Available";
};

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (Mongoose trims before the required
// check, so an all-whitespace name fails validation there too).
const assertRequiredName = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("Prasadam name is required");
  }
  return String(value).trim();
};

// price / availableQuantity / minimumStock are Numbers with `min: 0`. The
// application coerces every one of them with `Number(value) || 0`
// (prasadamController.createPrasadam), so a missing or unparseable value
// becomes 0 — never NULL — while a genuine 0 stays 0.
const toNumberOrDefault = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  return num;
};

// `min: 0` is enforced on CREATE and on save(), which is where Mongoose runs
// the schema validators. It is deliberately NOT enforced by updateById: that
// path mirrors findByIdAndUpdate WITHOUT runValidators, so a negative value is
// reachable and persists through PUT /api/prasadam/:id today. Enforcing it
// everywhere would make the PostgreSQL path stricter than the application.
const MIN_ZERO_FIELDS = ["price", "availableQuantity", "minimumStock"];

const assertMinZero = (value, label) => {
  const num = toNumberOrDefault(value, label);
  if (num < 0) {
    const error = new Error(`${label} (${num}) is less than the minimum allowed value (0).`);
    error.name = "ValidationError";
    throw error;
  }
  return num;
};

const PRASADAM_COLS = [
  "id", "name", "price", "available_quantity", "minimum_stock", "created_at", "updated_at",
];

// NUMERIC columns arrive from the driver as strings; the Mongoose model hands
// the application JS Numbers (the controllers call .toLocaleString() on price),
// so every numeric column is converted back.
const toDoc = (row) => {
  if (!row) return null;
  const availableQuantity = Number(row.available_quantity);
  const minimumStock = Number(row.minimum_stock);
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    price: Number(row.price),
    availableQuantity,
    minimumStock,
    status: computeStatus(availableQuantity, minimumStock),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// The persisted key set, exactly as the strict Mongoose schema defines it.
// prasadamController builds its payloads explicitly, but narrowing here keeps
// the repository identical to Mongoose strict mode for any caller that spreads
// a body (the same rule every other Phase 2 repository applies).
const PERSISTED_KEYS = ["name", "price", "availableQuantity", "minimumStock"];

const pickPersisted = (data) => {
  const picked = {};
  for (const key of PERSISTED_KEYS) {
    if (data[key] !== undefined) picked[key] = data[key];
  }
  return picked;
};

// Builds the full column payload for an insert. `default: 0` on
// availableQuantity / minimumStock mirrors the schema defaults, and
// prasadamController's `Number(x) || 0` coercion means an absent value is 0.
// The `min: 0` range is enforced here because Prasadam.create runs Mongoose's
// validators; updateById deliberately does not (see assertMinZero).
const toRow = (data, id = newId()) => ({
  id,
  name: assertRequiredName(data.name),
  price: assertMinZero(data.price, "price"),
  available_quantity: assertMinZero(data.availableQuantity, "availableQuantity"),
  minimum_stock: assertMinZero(data.minimumStock, "minimumStock"),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const validate = (data) => {
  if (!data) throw new Error("Prasadam data is required");
  assertRequiredName(data.name);
  for (const field of MIN_ZERO_FIELDS) {
    assertMinZero(data[field], field);
  }
};

// A duplicate `name` surfaces as a unique-constraint violation (23505), which
// prasadamController already answers with HTTP 409 for Mongo's 11000. The code
// is re-mapped here so the controller's existing branch is unchanged and a
// duplicate is never silently ignored or upserted.
const rethrowDuplicateName = (error) => {
  if (error && error.code === "23505" && /prasadams_name_key|prasadams_name/.test(error.constraint || error.message || "")) {
    error.code = 11000;
  }
  throw error;
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Prasadam.findById(String(id));
  const { rows } = await query(
    `SELECT ${PRASADAM_COLS.join(", ")} FROM prasadams WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// The listing used by getAllPrasadam (Prasadam.find().sort({ name: 1 })).
// limit/offset are supported so pagination semantics survive if a caller ever
// pages; no current Prasadam query paginates.
const findMany = async (options = {}) => {
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Prasadam.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }

  const conditions = [];
  const values = [];
  if (filter.name !== undefined && filter.name !== null) {
    values.push(String(filter.name));
    conditions.push(`name = $${values.length}`);
  }
  if (filter._id !== undefined || filter.id !== undefined) {
    values.push(String(filter._id !== undefined ? filter._id : filter.id));
    conditions.push(`id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveOrderBy(sort);

  let sql = `SELECT ${PRASADAM_COLS.join(", ")} FROM prasadams ${where} ORDER BY ${orderBy}, id ASC`;
  if (Number.isInteger(Number(limit)) && Number(limit) > 0) sql += ` LIMIT ${Number(limit)}`;
  if (Number.isInteger(Number(offset)) && Number(offset) > 0) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

// Whitelisted sort columns. The standing Prasadam sort is
// Prasadam.find().sort({ name: 1 }), so `name ASC` is the fallback.
const SORT_COLUMNS = {
  id: "id",
  name: "name",
  price: "price",
  availableQuantity: "available_quantity",
  minimumStock: "minimum_stock",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

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
  return parts.length ? parts.join(", ") : "name ASC";
};

/**
 * Looks a prasadam up by name.
 *
 * Two real call sites, with deliberately different matching:
 *  - devoteeController.createPrasadamOrder / verifyPrasadamPayment match the
 *    item with `{ name: { $regex: /^<itemName>$/i } }` — an exact,
 *    case-INsensitive match (caseInsensitive: true).
 *  - inventoryWorkflowController.logKitchenProduction matches with
 *    `{ name: recipe.name }` — an exact, case-SENSITIVE match.
 *
 * Both are returned as a single document in Mongo's natural insertion order
 * (`ORDER BY created_at, id`), which is what findOne resolves to when more than
 * one row matches. A literal comparison is used rather than a regex, so a name
 * containing regex metacharacters is matched literally instead of being
 * reinterpreted as a pattern.
 */
const findOneByName = async (name, { caseInsensitive = false } = {}) => {
  if (name === undefined || name === null || String(name).trim() === "") return null;
  const wanted = String(name).trim();

  if (!dbConfig.isDbConnected()) {
    const filter = caseInsensitive
      ? { name: { $regex: new RegExp(`^${wanted}$`, "i") } }
      : { name: wanted };
    return Prasadam.findOne(filter);
  }

  const predicate = caseInsensitive ? "lower(name) = lower($1)" : "name = $1";
  const { rows } = await query(
    `SELECT ${PRASADAM_COLS.join(", ")} FROM prasadams WHERE ${predicate} ORDER BY created_at ASC, id ASC LIMIT 1`,
    [wanted]
  );
  return toDoc(rows[0]);
};

// Mirrors Prasadam.create(payload). The INSERT is a single atomic statement, so
// a failure cannot leave a partial row behind, and a duplicate name is not
// swallowed — it raises and is re-mapped to Mongo's 11000 shape.
const create = async (data) => {
  const payload = pickPersisted(data || {});
  validate(payload);

  if (!dbConfig.isDbConnected()) return Prasadam.create(payload);

  const id = (data && data.id) || newId();
  const row = toRow(payload, id);
  try {
    await query(
      `INSERT INTO prasadams (${PRASADAM_COLS.join(", ")})
       VALUES (${PRASADAM_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
      PRASADAM_COLS.map((col) => row[col])
    );
  } catch (error) {
    rethrowDuplicateName(error);
  }
  return findById(id);
};

// Field → column mapping used by every partial update. `undefined` leaves a
// column untouched (the controllers only assign fields that were supplied).
//
// No `min: 0` check is applied here on purpose: prasadamController.updatePrasadam
// calls findByIdAndUpdate without runValidators, so Mongoose does not enforce
// the schema minimum on that path today. Adding a check here would invent a
// rule the application does not have. (`min: 0` IS enforced on create and on
// the save() stock movements, which do run validators.)
const ASSIGNMENTS = {
  name: ["name", (v) => assertRequiredName(v)],
  price: ["price", (v) => toNumberOrDefault(v, "price")],
  availableQuantity: ["available_quantity", (v) => toNumberOrDefault(v, "availableQuantity")],
  minimumStock: ["minimum_stock", (v) => toNumberOrDefault(v, "minimumStock")],
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;

  const narrowed = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    if (!ASSIGNMENTS[key]) continue;
    narrowed[key] = value;
  }

  if (!dbConfig.isDbConnected()) {
    if (!Object.keys(narrowed).length) return Prasadam.findById(String(id));
    return Prasadam.findByIdAndUpdate(String(id), narrowed, { new: true });
  }

  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(narrowed)) {
    const [col, coerce] = ASSIGNMENTS[key];
    values.push(coerce(value));
    setClauses.push(`${col} = $${values.length}`);
  }
  if (!setClauses.length) return findById(id);

  setClauses.push("updated_at = now()");
  values.push(String(id));
  try {
    await query(`UPDATE prasadams SET ${setClauses.join(", ")} WHERE id = $${values.length}`, values);
  } catch (error) {
    rethrowDuplicateName(error);
  }
  return findById(id);
};

/**
 * Atomic adjustment of availableQuantity, mirroring the `$inc`-shaped stock
 * movements the application performs on the master:
 *  - restockPrasadam:            availableQuantity += Number(quantityAdded)
 *  - createPrasadamOrder:        availableQuantity -= normalizedQty
 *  - verifyPrasadamPayment:      availableQuantity = max(0, availableQuantity - qty)
 * A single UPDATE keeps the read-modify-write off the application side. A
 * missing row is a no-op, exactly like Mongoose's findById → save() on null.
 *
 * `clampAtZero` reproduces the Math.max(0, …) the payment-verification path
 * applies. The other two paths add/subtract WITHOUT a floor, but they still
 * reach Mongoose's save(), which runs the schema's `min: 0` validator — so a
 * decrement that would go negative raises a validation error there rather than
 * persisting a negative value. The PostgreSQL path raises the same error at the
 * same point so both datasources behave identically.
 */
const incrementById = async (id, delta, { clampAtZero = false } = {}) => {
  if (!id) return null;
  const amount = Number(delta);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid quantity: ${delta}. quantity must be a number`);
  }

  if (!dbConfig.isDbConnected()) {
    const doc = await Prasadam.findById(String(id));
    if (!doc) return null;
    const next = (doc.availableQuantity || 0) + amount;
    doc.availableQuantity = clampAtZero ? Math.max(0, next) : next;
    await doc.save();
    return doc;
  }

  if (clampAtZero) {
    await query(
      "UPDATE prasadams SET available_quantity = GREATEST(0, available_quantity + $1), updated_at = now() WHERE id = $2",
      [amount, String(id)]
    );
    return findById(id);
  }

  // Atomic, and guarded so a result below the schema minimum never lands. The
  // guard is a no-op for a positive delta.
  const { rowCount } = await query(
    "UPDATE prasadams SET available_quantity = available_quantity + $1, updated_at = now() WHERE id = $2 AND available_quantity + $1 >= 0",
    [amount, String(id)]
  );
  if (rowCount === 0) {
    const existing = await findById(id);
    if (!existing) return null;
    const error = new Error(
      `availableQuantity (${Number(existing.availableQuantity) + amount}) is less than the minimum allowed value (0).`
    );
    error.name = "ValidationError";
    throw error;
  }
  return findById(id);
};

// Mirrors prasadamController.deletePrasadam's Prasadam.findByIdAndDelete(id):
// a HARD delete (the schema has no soft-delete/archive field) that returns the
// deleted document so the controller can answer 404 when it is null.
const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Prasadam.findByIdAndDelete(String(id));
  const existing = await findById(id);
  if (!existing) return null;
  await query("DELETE FROM prasadams WHERE id = $1", [String(id)]);
  return existing;
};

module.exports = {
  computeStatus,
  validate,
  findById,
  findMany,
  findOneByName,
  create,
  updateById,
  incrementById,
  destroy,
};
