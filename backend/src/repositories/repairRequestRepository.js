const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const RepairRequest = require("../models/RepairRequest");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/RepairRequest.js exactly.
const STATUSES = new Set(["Pending", "In Progress", "Completed", "Cancelled"]);

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

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// cost has NO min in Mongo ({ type: Number, default: 0 } permits negatives) —
// only finiteness is checked, exactly like the schema.
const assertMoney = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const REPAIR_REQUEST_COLS = [
  "id", "asset_id", "description", "vendor", "cost", "invoice_number",
  "status", "completion_date", "created_by", "created_at", "updated_at",
];

const dateOrNull = (value) =>
  value === undefined || value === null || value === "" ? null : new Date(value);

// Converts a repair_requests row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). Optional fields come back as undefined when
// unset, matching the default-null Mongo behaviour; `asset` stays a plain id
// string exactly like the pre-migration PG repositories do for references.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    asset: row.asset_id || undefined,
    description: row.description,
    vendor: row.vendor,
    cost: row.cost === null || row.cost === undefined ? undefined : Number(row.cost),
    invoiceNumber: row.invoice_number,
    status: row.status,
    completionDate: row.completion_date || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  // The Mongo model keeps `asset` as an ObjectId ref; store the supplied id
  // verbatim as TEXT (nullable — see the migration header).
  asset_id: data.asset === undefined || data.asset === null || String(data.asset).trim() === "" ? null : String(data.asset).trim(),
  description: assertId(data.description, "description"),
  vendor: data.vendor === undefined || data.vendor === null || String(data.vendor).trim() === "" ? "" : String(data.vendor).trim(),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale.
  cost: data.cost ?? 0,
  invoice_number: data.invoiceNumber === undefined || data.invoiceNumber === null || String(data.invoiceNumber).trim() === "" ? "" : String(data.invoiceNumber).trim(),
  status: data.status || "Pending",
  completion_date: dateOrNull(data.completionDate),
  created_by: data.createdBy === undefined || data.createdBy === null || String(data.createdBy).trim() === "" ? null : String(data.createdBy).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The standing
// repair-list sort in the codebase is
// `RepairRequest.find().sort({ createdAt: -1 })`, which is the default here.
const SORT_COLUMNS = {
  asset: "asset_id",
  description: "description",
  vendor: "vendor",
  cost: "cost",
  invoiceNumber: "invoice_number",
  status: "status",
  completionDate: "completion_date",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "created_at DESC";
  let key; let direction;
  if (typeof sort === "string") {
    key = sort; direction = 1;
  } else {
    const entry = Object.entries(sort || {})[0] || [];
    key = entry[0]; direction = entry[1];
  }
  const col = SORT_COLUMNS[key];
  if (!col) return defaultOrder;
  const dir = direction === "DESC" || Number(direction) === -1 ? "DESC" : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
  if (!dir) return defaultOrder;
  return `${col} ${dir}`;
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

// Applies a Mongo comparison operator object ({ $gte/$gt/$lte/$lt }) to a
// column, or an exact equality for a plain value.
const pushRangeOrEquals = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  } else if (input === null) {
    // Mongo `{ field: null }` matches documents where the field is null OR
    // missing.
    conditions.push(`${col} IS NULL`);
  }
};

// Supports the standard CRUD filter surface plus the Mongo-style operator
// filters the application uses (or could use) against RepairRequest:
//   * { id } / { id: { $in: [...] } }
//   * { asset } / { asset: { $in: [...] } } — per-asset repair lookups
//   * { status } / { status: { $in: [...] } } — status filtering
//   * { vendor }, { invoiceNumber }, { description } filters
//   * { createdBy } — who created the request
//   * { cost } range filters (NUMERIC)
//   * { completionDate } / { createdAt } / { updatedAt } range filters
const buildRepairRequestFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.asset === "object" && !Array.isArray(filter.asset) && filter.asset.$in) {
    pushIn(conditions, values, "asset_id", filter.asset.$in);
  } else if (filter.asset !== undefined && filter.asset !== null) {
    pushCond(conditions, values, "asset_id", "=", String(filter.asset).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  if (typeof filter.vendor === "object" && !Array.isArray(filter.vendor) && filter.vendor.$in) {
    pushIn(conditions, values, "vendor", filter.vendor.$in);
  } else if (filter.vendor) {
    pushCond(conditions, values, "vendor", "=", String(filter.vendor).trim());
  }

  if (typeof filter.invoiceNumber === "object" && !Array.isArray(filter.invoiceNumber) && filter.invoiceNumber.$in) {
    pushIn(conditions, values, "invoice_number", filter.invoiceNumber.$in);
  } else if (filter.invoiceNumber) {
    pushCond(conditions, values, "invoice_number", "=", String(filter.invoiceNumber).trim());
  }

  if (typeof filter.description === "object" && !Array.isArray(filter.description) && filter.description.$in) {
    pushIn(conditions, values, "description", filter.description.$in);
  } else if (filter.description) {
    pushCond(conditions, values, "description", "=", String(filter.description).trim());
  }

  if (typeof filter.createdBy === "object" && !Array.isArray(filter.createdBy) && filter.createdBy.$in) {
    pushIn(conditions, values, "created_by", filter.createdBy.$in);
  } else if (filter.createdBy) {
    pushCond(conditions, values, "created_by", "=", String(filter.createdBy).trim());
  }

  pushRangeOrEquals(conditions, values, "cost", filter.cost, false);
  pushRangeOrEquals(conditions, values, "completion_date", filter.completionDate, true);
  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return RepairRequest.findById(String(id));
  const { rows } = await query(`SELECT ${REPAIR_REQUEST_COLS.join(", ")} FROM repair_requests WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return RepairRequest.findOne(filter);
  const { where, values } = buildRepairRequestFilter(filter);
  const { rows } = await query(`SELECT ${REPAIR_REQUEST_COLS.join(", ")} FROM repair_requests ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = RepairRequest.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildRepairRequestFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${REPAIR_REQUEST_COLS.join(", ")} FROM repair_requests ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  assertId(data.description, "description");
  assertEnum(data.status, STATUSES, "status");
  assertMoney(data.cost, "cost");

  if (!dbConfig.isDbConnected()) {
    return RepairRequest.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO repair_requests (${REPAIR_REQUEST_COLS.join(", ")})
     VALUES (${REPAIR_REQUEST_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    REPAIR_REQUEST_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.description !== undefined) assertId(updates.description, "description");
  assertEnum(updates.status, STATUSES, "status");
  assertMoney(updates.cost, "cost");

  if (!dbConfig.isDbConnected()) {
    return RepairRequest.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  }

  const existing = await findById(id);
  if (!existing?._id) return null;

  const fields = [];
  const values = [];
  const apply = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value);
    }
  };
  const applyNullable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || String(value).trim() === "" ? null : String(value).trim());
    }
  };
  const applyStringDefault = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === undefined || String(value).trim() === "" ? "" : String(value).trim());
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };
  const applyDate = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(dateOrNull(value));
    }
  };

  if (updates.asset !== undefined) applyNullable("asset_id", updates.asset);
  if (updates.description !== undefined) apply("description", String(updates.description).trim());
  if (updates.vendor !== undefined) applyStringDefault("vendor", updates.vendor);
  if (updates.cost !== undefined) applyNumber("cost", updates.cost);
  if (updates.invoiceNumber !== undefined) applyStringDefault("invoice_number", updates.invoiceNumber);
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.completionDate !== undefined) applyDate("completion_date", updates.completionDate);
  if (updates.createdBy !== undefined) applyNullable("created_by", updates.createdBy);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE repair_requests SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return RepairRequest.countDocuments(filter);
  const { where, values } = buildRepairRequestFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM repair_requests ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await RepairRequest.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM repair_requests WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  destroy,
  STATUSES,
};