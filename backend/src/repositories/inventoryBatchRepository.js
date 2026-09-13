const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const InventoryBatch = require("../models/InventoryBatch");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/InventoryBatch.js.
const STATUSES = new Set(["Active", "Quarantine", "Expired", "Consumed", "Returned", "Disposed"]);

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

// Mirrors the Mongo schema: item required, originalQuantity/currentQuantity
// required with min: 0 (decimals allowed — real flows use fractional kitchen
// quantities, so the check is >= 0 rather than integer).
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertQuantity = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number >= 0 (Mongo schema min: 0)`);
  }
};

// purchasePrice has NO min in the Mongo schema ({ type: Number, default: 0 }),
// so negatives are allowed exactly as Mongo; only non-numeric values are
// rejected.
const assertPrice = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const INVENTORY_BATCH_COLS = [
  "id", "inventory_item_id", "batch_number", "grn", "purchase_price",
  "manufacturing_date", "expiry_date", "original_quantity", "current_quantity",
  "status", "supplier", "created_at", "updated_at",
];

// Converts an inventory_batches row into the shape the application receives
// from Mongoose (camelCase, Mongo _id).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.inventory_item_id,
    batchNumber: row.batch_number,
    grn: row.grn || undefined,
    purchasePrice: row.purchase_price === null || row.purchase_price === undefined ? 0 : Number(row.purchase_price),
    manufacturingDate: row.manufacturing_date || undefined,
    expiryDate: row.expiry_date || undefined,
    originalQuantity: row.original_quantity === null || row.original_quantity === undefined ? undefined : Number(row.original_quantity),
    currentQuantity: row.current_quantity === null || row.current_quantity === undefined ? undefined : Number(row.current_quantity),
    status: row.status,
    supplier: row.supplier || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  inventory_item_id: String(data.item).trim(),
  batch_number: String(data.batchNumber || "").trim(),
  grn: data.grn === undefined || data.grn === null || String(data.grn).trim() === "" ? null : String(data.grn).trim(),
  purchase_price: data.purchasePrice ?? 0,
  manufacturing_date: data.manufacturingDate === undefined || data.manufacturingDate === null ? null : new Date(data.manufacturingDate),
  expiry_date: data.expiryDate === undefined || data.expiryDate === null ? null : new Date(data.expiryDate),
  // Pass the original value straight to NUMERIC so the driver preserves the
  // supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  original_quantity: data.originalQuantity,
  current_quantity: data.currentQuantity,
  status: data.status || "Active",
  supplier: data.supplier === undefined || data.supplier === null || String(data.supplier).trim() === "" ? null : String(data.supplier).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  expiryDate: "expiry_date",
  batchNumber: "batch_number",
  status: "status",
  originalQuantity: "original_quantity",
  currentQuantity: "current_quantity",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "expiry_date ASC, created_at ASC";
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

const assertBatchNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

// Supports the real filters used by the application plus the standard CRUD
// filter surface:
//   * { item } / { item: { $in: [...] } } — FIFO consumption and GRN flows
//   * { status } / { status: { $in: [...] } } — active-batch selection
//   * { expiryDate: { $gte, $lt, $lte } } — expiry scanning
//   * { batchNumber } / { batchNumber: { $in: [...] } }
//   * { id: { $in: [...] } }
const buildInventoryBatchFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.item === "object" && !Array.isArray(filter.item) && filter.item.$in) {
    pushIn(conditions, values, "inventory_item_id", filter.item.$in);
  } else if (filter.item) {
    pushCond(conditions, values, "inventory_item_id", "=", String(filter.item).trim());
  }

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.batchNumber === "object" && !Array.isArray(filter.batchNumber) && filter.batchNumber.$in) {
    pushIn(conditions, values, "batch_number", filter.batchNumber.$in);
  } else if (filter.batchNumber) {
    pushCond(conditions, values, "batch_number", "=", String(filter.batchNumber).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  if (typeof filter.grn === "object" && !Array.isArray(filter.grn) && filter.grn.$in) {
    pushIn(conditions, values, "grn", filter.grn.$in);
  } else if (filter.grn) {
    pushCond(conditions, values, "grn", "=", String(filter.grn).trim());
  }

  if (typeof filter.supplier === "object" && !Array.isArray(filter.supplier) && filter.supplier.$in) {
    pushIn(conditions, values, "supplier", filter.supplier.$in);
  } else if (filter.supplier) {
    pushCond(conditions, values, "supplier", "=", String(filter.supplier).trim());
  }

  // Mongo operator object for expiryDate — matches the Mongo model and any
  // expiry scan ({ expiryDate: { $gte, $lt, $lte } }).
  if (filter.expiryDate && typeof filter.expiryDate === "object" && !Array.isArray(filter.expiryDate)) {
    for (const [op, opVal] of Object.entries(filter.expiryDate)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, "expiry_date", sqlOp, new Date(opVal));
      }
    }
  } else if (filter.expiryDate) {
    pushCond(conditions, values, "expiry_date", "=", new Date(filter.expiryDate));
  }

  // Mongo operator object for createdAt (range filters / listings).
  if (filter.createdAt && typeof filter.createdAt === "object" && !Array.isArray(filter.createdAt)) {
    for (const [op, opVal] of Object.entries(filter.createdAt)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, "created_at", sqlOp, new Date(opVal));
      }
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return InventoryBatch.findById(String(id));
  const { rows } = await query(`SELECT ${INVENTORY_BATCH_COLS.join(", ")} FROM inventory_batches WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryBatch.findOne(filter);
  const { where, values } = buildInventoryBatchFilter(filter);
  // Mongoose findOne({}) returns the first document; we mirror that rather
  // than treating an empty filter as no-match. The tiebreak mirrors the FIFO
  // consumption ordering (expiryDate, createdAt).
  const { rows } = await query(`SELECT ${INVENTORY_BATCH_COLS.join(", ")} FROM inventory_batches ${where} ORDER BY expiry_date ASC, created_at ASC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { expiryDate: 1, createdAt: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = InventoryBatch.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildInventoryBatchFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${INVENTORY_BATCH_COLS.join(", ")} FROM inventory_batches ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates an inventory batch. Mirrors the Mongo model validation (item and
 * batchNumber required, originalQuantity/currentQuantity required >= 0,
 * status enum with default 'Active') and the real create path
 * (inventoryWorkflowController.approveGRN auto-generates a batchNumber from
 * `AUTO-${Date.now()}` when the GRN line has none). The INSERT is a single
 * atomic statement — a failure cannot leave a partial row behind.
 *
 * The Mongoose pre('save') hook auto-flips Active → Consumed when
 * currentQuantity is 0 and Active → Expired when expiryDate is in the past.
 * That hook is a plain pre-save middleware, so it only runs on create/save,
 * never on findByIdAndUpdate — the repository reproduces the same
 * one-directional transition on create only, exactly like Mongo.
 */
const create = async (data) => {
  assertId(data.item, "item");
  assertBatchNumber(data.batchNumber, "batchNumber");
  assertQuantity(data.originalQuantity, "originalQuantity");
  assertQuantity(data.currentQuantity, "currentQuantity");
  assertEnum(data.status, STATUSES, "status");
  assertPrice(data.purchasePrice, "purchasePrice");

  if (!dbConfig.isDbConnected()) return InventoryBatch.create(data);

  const id = data.id || newId();
  const row = toRow(data, id);

  // Mirror of the Mongo pre('save') hook decisions.
  if (Number(row.current_quantity) === 0 && row.status === "Active") {
    row.status = "Consumed";
  }
  if (row.expiry_date && new Date() > new Date(row.expiry_date) && row.status === "Active") {
    row.status = "Expired";
  }

  await query(
    `INSERT INTO inventory_batches (${INVENTORY_BATCH_COLS.join(", ")})
     VALUES (${INVENTORY_BATCH_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    INVENTORY_BATCH_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertEnum(updates.status, STATUSES, "status");
  if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
    throw new Error("item is required");
  }
  if (updates.batchNumber !== undefined && String(updates.batchNumber).trim() === "") {
    throw new Error("batchNumber is required");
  }
  if (updates.originalQuantity !== undefined) assertQuantity(updates.originalQuantity, "originalQuantity");
  if (updates.currentQuantity !== undefined) assertQuantity(updates.currentQuantity, "currentQuantity");
  assertPrice(updates.purchasePrice, "purchasePrice");

  if (!dbConfig.isDbConnected()) {
    return InventoryBatch.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyBlankable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || String(value).trim() === "" ? null : String(value).trim());
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
      values.push(value === null || value === "" ? null : new Date(value));
    }
  };

  if (updates.item !== undefined) apply("inventory_item_id", String(updates.item).trim());
  if (updates.batchNumber !== undefined) apply("batch_number", String(updates.batchNumber).trim());
  if (updates.grn !== undefined) applyBlankable("grn", updates.grn);
  if (updates.purchasePrice !== undefined) applyNumber("purchase_price", updates.purchasePrice);
  if (updates.manufacturingDate !== undefined) applyDate("manufacturing_date", updates.manufacturingDate);
  if (updates.expiryDate !== undefined) applyDate("expiry_date", updates.expiryDate);
  if (updates.originalQuantity !== undefined) applyNumber("original_quantity", updates.originalQuantity);
  if (updates.currentQuantity !== undefined) applyNumber("current_quantity", updates.currentQuantity);
  if (updates.status !== undefined) apply("status", updates.status || "Active");
  if (updates.supplier !== undefined) applyBlankable("supplier", updates.supplier);

  if (values.length === 0) return existing;

  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE inventory_batches SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryBatch.countDocuments(filter);
  const { where, values } = buildInventoryBatchFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM inventory_batches ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await InventoryBatch.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM inventory_batches WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

/**
 * Active batches for an item ordered FIFO (expiryDate ASC, createdAt ASC) —
 * mirrors inventoryWorkflowController.logKitchenProduction:
 *   InventoryBatch.find({ item, status: 'Active' }).sort({ expiryDate: 1, createdAt: 1 })
 */
const findActiveByItemFifo = async (itemId) => {
  if (!itemId) return [];
  if (!dbConfig.isDbConnected()) {
    return InventoryBatch.find({ item: String(itemId), status: "Active" }).sort({ expiryDate: 1, createdAt: 1 });
  }
  const { rows } = await query(
    `SELECT ${INVENTORY_BATCH_COLS.join(", ")} FROM inventory_batches
     WHERE inventory_item_id = $1 AND status = 'Active'
     ORDER BY expiry_date ASC, created_at ASC, id ASC`,
    [String(itemId)]
  );
  return rows.map(toDoc);
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  destroy,
  findActiveByItemFifo,
};