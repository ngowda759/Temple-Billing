const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const CashClosing = require("../models/CashClosing");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const CASH_CLOSING_COLS = [
  "id", "date", "opening_cash", "cash_collected", "upi_collected",
  "card_collected", "bank_transfer_collected", "total_system_collection",
  "cash_deposited", "closing_cash", "discrepancy", "notes", "status",
  "recorded_by", "verified_by", "created_at", "updated_at",
];

// Mirrors the Mongoose model's `required: true`. Mongoose's required validator
// rejects undefined/null/'' but accepts 0, so `0` is a legal money value and is
// never treated as "missing" here.
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

// The six money paths that carry `default: 0` but NO `required`, so Mongoose
// fills an omitted value with 0 and ACCEPTS an explicit null (storing null).
// A null/blank input is therefore passed through as NULL rather than coerced to
// 0 — coercing would silently change a value MongoDB keeps as null.
const optionalMoney = (value) => {
  if (value === undefined) return 0;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

// Converts a cash_closings row into the shape the application receives from
// Mongoose: _id, camelCase field names, and `undefined` for a property the
// model leaves unset. `notes`/`verifiedBy` are returned as undefined when NULL
// because that is what a Mongoose document exposes for an unset path (the
// controller serialises them away), matching auditLogRepository's handling of
// `details`.
const toDoc = (row) => {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? undefined : Number(v));
  return {
    _id: row.id,
    id: row.id,
    date: row.date,
    openingCash: num(row.opening_cash),
    cashCollected: num(row.cash_collected),
    upiCollected: num(row.upi_collected),
    cardCollected: num(row.card_collected),
    bankTransferCollected: num(row.bank_transfer_collected),
    totalSystemCollection: num(row.total_system_collection),
    cashDeposited: num(row.cash_deposited),
    closingCash: num(row.closing_cash),
    discrepancy: num(row.discrepancy),
    notes: row.notes === null || row.notes === undefined ? undefined : row.notes,
    status: row.status,
    recordedBy: row.recorded_by || undefined,
    verifiedBy: row.verified_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert, reproducing the model's
// defaults and its four distinct validation behaviours:
//   required + default → NOT NULL column; an omitted value becomes 0, while an
//     explicit null/'' is passed through so PostgreSQL rejects it exactly as
//     Mongoose's required validator does.
//   default only       → nullable column; omitted becomes 0, explicit null/'' stays NULL.
//   required, no default (date/closingCash/recordedBy) → an omitted value becomes
//     NULL so PostgreSQL rejects the write Mongoose would reject.
//   neither (notes/verifiedBy) → NULL.
const toRow = (data, id = newId()) => ({
  id,
  date: assertDate(data.date, "date") || new Date(),
  // required + default 0
  opening_cash: data.openingCash === undefined ? 0 : data.openingCash,
  // required + default 0 (server-computed by the controller)
  cash_collected: data.cashCollected === undefined ? 0 : data.cashCollected,
  upi_collected: optionalMoney(data.upiCollected),
  card_collected: optionalMoney(data.cardCollected),
  bank_transfer_collected: optionalMoney(data.bankTransferCollected),
  total_system_collection: optionalMoney(data.totalSystemCollection),
  cash_deposited: optionalMoney(data.cashDeposited),
  // required, NO default — omitted stays NULL so NOT NULL rejects it
  closing_cash: data.closingCash === undefined ? null : data.closingCash,
  discrepancy: optionalMoney(data.discrepancy),
  notes: data.notes === undefined || data.notes === null ? null : String(data.notes).trim(),
  // enum + default: an omitted value becomes 'Pending Verification'. An explicit
  // null is passed through, so PostgreSQL rejects it on the NOT NULL column.
  status: data.status === undefined ? "Pending Verification" : data.status,
  // required, NO default — omitted stays NULL so NOT NULL rejects it
  recorded_by: data.recordedBy === undefined ? null : String(assertRequired(data.recordedBy, "recordedBy")),
  verified_by: data.verifiedBy === undefined || data.verifiedBy === null ? null : String(data.verifiedBy),
  created_at: assertDate(data.createdAt, "createdAt") || new Date(),
  updated_at: assertDate(data.updatedAt, "updatedAt") || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL. The only
// sort the application performs is { date: -1 } (getCashClosings).
const SORT_COLUMNS = {
  date: "date",
  createdAt: "created_at",
  updatedAt: "updated_at",
  openingCash: "opening_cash",
  cashCollected: "cash_collected",
  closingCash: "closing_cash",
  discrepancy: "discrepancy",
  status: "status",
  recordedBy: "recorded_by",
};

const DEFAULT_ORDER = "date DESC";

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
  const fallback = DEFAULT_ORDER.split(", ")
    .map((part) => `${colPrefix}${part}`)
    .join(", ");
  if (!col) return fallback;
  const dir =
    direction === "DESC" || Number(direction) === -1
      ? "DESC"
      : direction === "ASC" || Number(direction) === 1
        ? "ASC"
        : null;
  return dir ? `${colPrefix}${col} ${dir}` : fallback;
};

// Translates the Mongo-style filters the controller and tests build:
//   { recordedBy }                    — the cashier scoping used by submitCashClosing
//   { status }                        — the verification state
//   { date: { $gte, $lte } }          — day range
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

// `alias` qualifies every column so the same builder serves the plain SELECT
// and the populate LEFT JOINs below.
const buildCashClosingFilter = (filter = {}, alias = "") => {
  const conditions = [];
  const values = [];
  const col = (name) => (alias ? `${alias}.${name}` : name);

  if (filter.id !== undefined) pushComparison(conditions, values, col("id"), filter.id);
  if (filter._id !== undefined) pushComparison(conditions, values, col("id"), filter._id);
  if (filter.recordedBy !== undefined) pushComparison(conditions, values, col("recorded_by"), String(filter.recordedBy));
  if (filter.verifiedBy !== undefined) pushComparison(conditions, values, col("verified_by"), String(filter.verifiedBy));
  if (filter.status !== undefined) pushComparison(conditions, values, col("status"), filter.status);

  pushComparison(conditions, values, col("date"), filter.date, true);
  pushComparison(conditions, values, col("created_at"), filter.createdAt, true);
  pushComparison(conditions, values, col("updated_at"), filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// Reproduces the controller's
//   .populate('recordedBy', 'name').populate('verifiedBy', 'name')
// as two LEFT JOINs. LEFT JOIN is deliberate: MongoDB's populate leaves the
// path null when the referenced user no longer exists, so an INNER JOIN would
// silently drop financial history. A closing is never dropped for referencing
// a missing user.
const findManyPopulated = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset } = options;
  const { where, values } = buildCashClosingFilter(filter, "c");
  const orderBy = resolveOrderBy(sort, "c");
  let sql = `SELECT ${CASH_CLOSING_COLS.map((c) => `c.${c}`).join(", ")},
                    r.id AS recorded_ref_id, r.name AS recorded_name,
                    v.id AS verified_ref_id, v.name AS verified_name
             FROM cash_closings c
             LEFT JOIN users r ON r.id = c.recorded_by
             LEFT JOIN users v ON v.id = c.verified_by
             ${where} ORDER BY ${orderBy}, c.id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map((row) => {
    const doc = toDoc(row);
    // Mongo populate replaces the id with the referenced document, or null when
    // the reference dangles.
    doc.recordedBy = row.recorded_ref_id ? { _id: row.recorded_ref_id, name: row.recorded_name } : null;
    doc.verifiedBy = row.verified_ref_id ? { _id: row.verified_ref_id, name: row.verified_name } : null;
    return doc;
  });
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return CashClosing.findById(String(id));
  const { rows } = await query(
    `SELECT ${CASH_CLOSING_COLS.join(", ")} FROM cash_closings WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return CashClosing.findOne(filter);
  const { where, values } = buildCashClosingFilter(filter);
  const { rows } = await query(
    `SELECT ${CASH_CLOSING_COLS.join(", ")} FROM cash_closings ${where} ORDER BY date DESC, created_at DESC, id DESC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

/**
 * The listing behind GET /api/accounts/cash-closing. Mirrors
 * CashClosing.find().sort({ date: -1 }).populate('recordedBy','name')
 * .populate('verifiedBy','name') — including the populate shape, which the
 * accountant Shift Verification table reads (`c.recordedBy?.name`).
 *
 * `populate` defaults to false so the plain repository surface returns the
 * referenced ids as strings (par with an unpopulated Mongoose document); the
 * service and controller request the populated shape explicitly.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset, populate = false } = options;
  if (!dbConfig.isDbConnected()) {
    let q = CashClosing.find(filter).sort(sort);
    if (populate) q = q.populate("recordedBy", "name").populate("verifiedBy", "name");
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  if (populate) return findManyPopulated({ filter, sort, limit, offset });

  const { where, values } = buildCashClosingFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${CASH_CLOSING_COLS.join(", ")} FROM cash_closings ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  if (!data) throw new Error("Cash closing data is required");
  if (!dbConfig.isDbConnected()) return CashClosing.create(data);
  const row = toRow(data);
  const { rows } = await query(
    `INSERT INTO cash_closings (${CASH_CLOSING_COLS.join(", ")})
     VALUES (${CASH_CLOSING_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING ${CASH_CLOSING_COLS.join(", ")}`,
    CASH_CLOSING_COLS.map((c) => row[c])
  );
  return toDoc(rows[0]);
};

/**
 * Mirrors CashClosing.findByIdAndUpdate(id, updates, { new: true }).
 *
 * Only the writable columns are accepted; `id`, `createdAt` and the derived
 * money buckets are NOT updatable, so a caller cannot rewrite the stored
 * calculation through the update path. The repository never re-derives any
 * amount — the controller owns every calculation, exactly as it does on Mongo.
 */
const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    return CashClosing.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  }

  const sets = [];
  const values = [];
  const assign = (col, value) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (updates.status !== undefined) assign("status", updates.status);
  if (updates.verifiedBy !== undefined) {
    assign("verified_by", updates.verifiedBy === null ? null : String(updates.verifiedBy));
  }
  if (updates.notes !== undefined) {
    assign("notes", updates.notes === null ? null : String(updates.notes).trim());
  }
  if (updates.date !== undefined) assign("date", assertDate(updates.date, "date"));
  if (updates.openingCash !== undefined) assign("opening_cash", updates.openingCash);
  if (updates.cashCollected !== undefined) assign("cash_collected", updates.cashCollected);
  if (updates.upiCollected !== undefined) assign("upi_collected", optionalMoney(updates.upiCollected));
  if (updates.cardCollected !== undefined) assign("card_collected", optionalMoney(updates.cardCollected));
  if (updates.bankTransferCollected !== undefined) assign("bank_transfer_collected", optionalMoney(updates.bankTransferCollected));
  if (updates.totalSystemCollection !== undefined) assign("total_system_collection", optionalMoney(updates.totalSystemCollection));
  if (updates.cashDeposited !== undefined) assign("cash_deposited", optionalMoney(updates.cashDeposited));
  if (updates.closingCash !== undefined) assign("closing_cash", updates.closingCash);
  if (updates.discrepancy !== undefined) assign("discrepancy", optionalMoney(updates.discrepancy));

  if (!sets.length) return findById(id);

  // `updated_at` mirrors Mongoose's `timestamps: true` on a save.
  assign("updated_at", new Date());
  values.push(String(id));

  const { rows } = await query(
    `UPDATE cash_closings SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${CASH_CLOSING_COLS.join(", ")}`,
    values
  );
  return toDoc(rows[0]);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return CashClosing.countDocuments(filter);
  const { where, values } = buildCashClosingFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM cash_closings ${where}`, values);
  return rows[0].n;
};

const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return CashClosing.findByIdAndDelete(String(id));
  const { rows } = await query(
    `DELETE FROM cash_closings WHERE id = $1 RETURNING ${CASH_CLOSING_COLS.join(", ")}`,
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
