const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Supplier = require("../models/Supplier");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const SUPPLIER_COLS = [
  "id", "name", "address", "phone", "email", "gst", "created_at", "updated_at",
];

// The writable columns the controller can actually set. `id`, `createdAt` and
// `updatedAt` are never caller-assigned through the update path.
const UPDATABLE = ["name", "address", "phone", "email", "gst"];

// Mirrors the model's `trim: true` on an OPTIONAL String path (`default: ''`).
// Mongoose casts any supplied value to String and trims it, then:
//   * an absent value is filled by `default: ''`
//   * an explicit null is accepted and stored as null (no required validator,
//     and `default` fires only for an omitted value)
// A blank string therefore stores '' rather than null, exactly as Mongoose does.
const optionalWrite = (value) => {
  if (value === undefined) return "";
  if (value === null) return null;
  return String(value).trim();
};

// Converts a suppliers row into the shape the application receives from
// Mongoose: _id, camelCase field names, and the stored value unchanged. An
// explicit null is read back as null (Mongoose stores and returns null for a
// non-required String path), while the controller's `clean()` normalises either
// null or '' to '' before it is used.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    gst: row.gst,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the insert payload, reproducing the model's defaults and its two
// distinct validation behaviours:
//   required + trim (name)   → NOT NULL column; a blank value is passed through
//     as NULL so PostgreSQL rejects it exactly as Mongoose's validator does.
//   default '' + trim (rest) → nullable column with DEFAULT ''; an omitted or
//     blank value stores '' (matching Mongoose's default, which persists it)
//     while an explicit null is preserved, as Mongoose accepts.
// `itemsSupplied` is intentionally not mapped — it is unused across the
// application and is not represented in PostgreSQL.
const toRow = (data, id = newId()) => ({
  id,
  name: data.name === undefined || data.name === null || String(data.name).trim() === ""
    ? null
    : String(data.name).trim(),
  address: optionalWrite(data.address),
  phone: optionalWrite(data.phone),
  email: optionalWrite(data.email),
  gst: optionalWrite(data.gst),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL. The only
// sort the application performs is { name: 1 } (getAllSuppliers).
const SORT_COLUMNS = {
  name: "name",
  address: "address",
  phone: "phone",
  email: "email",
  gst: "gst",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "name ASC";

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

// Translates the Mongo-style filters the controller and tests build, plus the
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

const buildSupplierFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (filter.id !== undefined) pushComparison(conditions, values, "id", filter.id);
  if (filter._id !== undefined) pushComparison(conditions, values, "id", filter._id);
  if (filter.name !== undefined) pushComparison(conditions, values, "name", filter.name);
  if (filter.address !== undefined) pushComparison(conditions, values, "address", filter.address);
  if (filter.phone !== undefined) pushComparison(conditions, values, "phone", filter.phone);
  if (filter.email !== undefined) pushComparison(conditions, values, "email", filter.email);
  if (filter.gst !== undefined) pushComparison(conditions, values, "gst", filter.gst);
  if (filter.createdAt !== undefined) pushComparison(conditions, values, "created_at", filter.createdAt, true);
  if (filter.updatedAt !== undefined) pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Supplier.findById(String(id));
  const { rows } = await query(
    `SELECT ${SUPPLIER_COLS.join(", ")} FROM suppliers WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Supplier.findOne(filter);
  const { where, values } = buildSupplierFilter(filter);
  const { rows } = await query(
    `SELECT ${SUPPLIER_COLS.join(", ")} FROM suppliers ${where} ORDER BY name ASC, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

/**
 * The listing behind GET /api/admin/inventory-suppliers. Mirrors
 * Supplier.find().sort({ name: 1 }) — the only listing query the domain has.
 *
 * The secondary `id ASC` tiebreaker makes the order total: Mongo leaves rows
 * with an equal name in natural order, which is not a state PostgreSQL — or a
 * caller — can rely on. The controller reads the whole array, so a stable
 * tiebreak changes nothing observable.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Supplier.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }

  const { where, values } = buildSupplierFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${SUPPLIER_COLS.join(", ")} FROM suppliers ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  if (!data) throw new Error("Supplier data is required");
  if (!dbConfig.isDbConnected()) return Supplier.create(data);

  const row = toRow(data, data.id ? String(data.id) : newId());
  const { rows } = await query(
    `INSERT INTO suppliers (${SUPPLIER_COLS.join(", ")})
     VALUES (${SUPPLIER_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING ${SUPPLIER_COLS.join(", ")}`,
    SUPPLIER_COLS.map((c) => row[c])
  );
  return toDoc(rows[0]);
};

/**
 * Mirrors Supplier.findByIdAndUpdate(id, updates, { new: true }).
 *
 * The controller always sends all five fields (`clean()` yields '' for anything
 * absent), and its Mongoose call passes NO runValidators, so Mongo applies
 * `name: ''` verbatim rather than raising a required error. This path therefore
 * writes whatever it is given — including an empty name — instead of inventing a
 * stricter rule. Only the five controller-owned columns are writable; `id` and
 * the timestamps are not.
 */
const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    return Supplier.findByIdAndUpdate(String(id), updates, { new: true });
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
    if (field === "name") {
      // Matches the controller's `clean(name)`: always a trimmed String, and
      // never NULL (an all-blank value stores '').
      assign(col, String(updates.name === null ? "" : updates.name).trim());
    } else {
      assign(col, optionalWrite(updates[field]));
    }
  }

  if (!sets.length) return findById(id);

  // `updated_at` mirrors Mongoose's `timestamps: true` on an update.
  assign("updated_at", new Date());
  values.push(String(id));

  const { rows } = await query(
    `UPDATE suppliers SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${SUPPLIER_COLS.join(", ")}`,
    values
  );
  return toDoc(rows[0]);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Supplier.countDocuments(filter);
  const { where, values } = buildSupplierFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM suppliers ${where}`, values);
  return rows[0].n;
};

const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Supplier.findByIdAndDelete(String(id));
  const { rows } = await query(
    `DELETE FROM suppliers WHERE id = $1 RETURNING ${SUPPLIER_COLS.join(", ")}`,
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
