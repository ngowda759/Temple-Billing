const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const PurchaseOrder = require("../models/PurchaseOrder");
const purchaseOrderItemRepository = require("./purchaseOrderItemRepository");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/PurchaseOrder.js.
const STATUSES = new Set([
  "Draft", "Pending Approval", "Approved", "Sent",
  "Partially Received", "Received", "Cancelled", "Closed",
]);

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

const assertText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

// totalAmount is a Number, required, min: 0 in the Mongo schema. Zero is legal
// at the model layer; negatives are refused, mirroring the Mongoose min: 0
// validator exactly.
const assertAmount = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0 (Mongo schema min: 0)`);
  }
};

const PURCHASE_ORDER_COLS = [
  "id", "po_number", "supplier", "total_amount", "status",
  "expected_delivery_date", "notes", "created_by", "approved_by",
  "created_at", "updated_at",
];

// Converts a purchase_orders row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). Nullable date columns come back as
// undefined when unset, matching null/default-null Mongo behaviour.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    poNumber: row.po_number,
    supplier: row.supplier,
    totalAmount: row.total_amount === null || row.total_amount === undefined ? undefined : Number(row.total_amount),
    status: row.status,
    expectedDeliveryDate: row.expected_delivery_date || undefined,
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    approvedBy: row.approved_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Converts a purchase_orders row plus its normalized purchase_order_items rows
// back into a Mongoose-compatible PurchaseOrder document (embedded `items`
// array included).
const toDocWithItems = (row, items) => ({
  ...toDoc(row),
  items: Array.isArray(items) ? items : [],
});

const toRow = (data, id = newId()) => ({
  id,
  po_number: assertId(data.poNumber, "poNumber"),
  supplier: assertId(data.supplier, "supplier"),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  total_amount: data.totalAmount,
  status: data.status || "Draft",
  expected_delivery_date: data.expectedDeliveryDate === undefined || data.expectedDeliveryDate === null ? null : new Date(data.expectedDeliveryDate),
  notes: data.notes === undefined || data.notes === null || String(data.notes).trim() === "" ? null : String(data.notes).trim(),
  created_by: data.createdBy === undefined || data.createdBy === null || String(data.createdBy).trim() === "" ? null : String(data.createdBy).trim(),
  approved_by: data.approvedBy === undefined || data.approvedBy === null || String(data.approvedBy).trim() === "" ? null : String(data.approvedBy).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The Mongo
// model itself exposes only poNumber (unique, scalar sortable), the status/
// date fields and timestamps; the default for PO list screens follows the
// app-wide createdAt DESC convention.
const SORT_COLUMNS = {
  poNumber: "po_number",
  status: "status",
  expectedDeliveryDate: "expected_delivery_date",
  supplier: "supplier",
  totalAmount: "total_amount",
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

// Applies a Mongo comparison operator object ({ $gte/$gt/$lte/$lt })
// to a column, or an exact equality for a plain value.
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
  }
};

// Supports the standard CRUD filter surface plus the Mongo-style operator
// filters the application could use against PurchaseOrder:
//   * { poNumber } — unique number lookups
//   * { supplier } / { supplier: { $in: [...] } } — supplier lists
//   * { status } / { status: { $in: [...] } } — status filtering (the admin PO
//     list and the createGRN status transition)
//   * { id } / { id: { $in: [...] } }
//   * { createdAt } / { updatedAt } / { expectedDeliveryDate } range filters
//   * { totalAmount } range filters
const buildPurchaseOrderFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.supplier === "object" && !Array.isArray(filter.supplier) && filter.supplier.$in) {
    pushIn(conditions, values, "supplier", filter.supplier.$in);
  } else if (filter.supplier) {
    pushCond(conditions, values, "supplier", "=", String(filter.supplier).trim());
  }

  if (typeof filter.poNumber === "object" && !Array.isArray(filter.poNumber) && filter.poNumber.$in) {
    pushIn(conditions, values, "po_number", filter.poNumber.$in);
  } else if (filter.poNumber) {
    pushCond(conditions, values, "po_number", "=", String(filter.poNumber).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "updated_at", filter.updatedAt, true);
  pushRangeOrEquals(conditions, values, "expected_delivery_date", filter.expectedDeliveryDate, true);
  pushRangeOrEquals(conditions, values, "total_amount", filter.totalAmount, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const loadItems = async (id) => purchaseOrderItemRepository.findByPurchaseOrderId(id);

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return PurchaseOrder.findById(String(id));
  const { rows } = await query(`SELECT ${PURCHASE_ORDER_COLS.join(", ")} FROM purchase_orders WHERE id = $1 LIMIT 1`, [String(id)]);
  if (!rows[0]) return null;
  return toDocWithItems(rows[0], await loadItems(rows[0].id));
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return PurchaseOrder.findOne(filter);
  const { where, values } = buildPurchaseOrderFilter(filter);
  const { rows } = await query(`SELECT ${PURCHASE_ORDER_COLS.join(", ")} FROM purchase_orders ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  if (!rows[0]) return null;
  return toDocWithItems(rows[0], await loadItems(rows[0].id));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = PurchaseOrder.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildPurchaseOrderFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${PURCHASE_ORDER_COLS.join(", ")} FROM purchase_orders ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => toDocWithItems(row, await loadItems(row.id))));
};

/**
 * Creates a purchase order together with its normalized embedded items inside
 * a single PostgreSQL transaction. Either the purchase_order row and every
 * item row persist, or none do (the Mongo model saves the PO and its embedded
 * items as one document — the same unit-of-work semantics).
 */
const create = async (data) => {
  assertId(data.poNumber, "poNumber");
  assertId(data.supplier, "supplier");
  assertAmount(data.totalAmount, "totalAmount");
  assertEnum(data.status, STATUSES, "status");
  const items = purchaseOrderItemRepository.normalizeItems(data.items);

  if (!dbConfig.isDbConnected()) {
    return PurchaseOrder.create({ ...data, items });
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO purchase_orders (${PURCHASE_ORDER_COLS.join(", ")})
       VALUES (${PURCHASE_ORDER_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      PURCHASE_ORDER_COLS.map((col) => row[col])
    );
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, inventory_item_id, ordered_quantity, unit_price, total_price, received_quantity, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [
          newId(),
          id,
          String(item.item).trim(),
          item.orderedQuantity,
          item.unitPrice,
          item.totalPrice,
          item.receivedQuantity ?? 0,
          index,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.poNumber !== undefined && updates.poNumber !== null && String(updates.poNumber).trim() === "") {
    throw new Error("poNumber is required");
  }
  if (updates.supplier !== undefined && updates.supplier !== null && String(updates.supplier).trim() === "") {
    throw new Error("supplier is required");
  }
  if (updates.totalAmount !== undefined) assertAmount(updates.totalAmount, "totalAmount");
  assertEnum(updates.status, STATUSES, "status");

  if (!dbConfig.isDbConnected()) {
    return PurchaseOrder.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyDate = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : new Date(value));
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };

  if (updates.poNumber !== undefined) apply("po_number", String(updates.poNumber).trim());
  if (updates.supplier !== undefined) apply("supplier", String(updates.supplier).trim());
  if (updates.totalAmount !== undefined) applyNumber("total_amount", updates.totalAmount);
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.expectedDeliveryDate !== undefined) applyDate("expected_delivery_date", updates.expectedDeliveryDate);
  if (updates.notes !== undefined) applyNullable("notes", updates.notes);
  if (updates.createdBy !== undefined) applyNullable("created_by", updates.createdBy);
  if (updates.approvedBy !== undefined) applyNullable("approved_by", updates.approvedBy);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE purchase_orders SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

/**
 * Replaces a purchase order's normalized item rows inside a single PostgreSQL
 * transaction (delete-all + insert is atomic, matching the embedded-array
 * replacement semantics of the Mongo model: `po.items = [...]`).
 */
const replaceItems = async (purchaseOrderId, items = []) => {
  if (!purchaseOrderId) return;
  const normalized = purchaseOrderItemRepository.normalizeItems(items);

  if (!dbConfig.isDbConnected()) {
    const po = await PurchaseOrder.findById(String(purchaseOrderId));
    if (!po) return;
    po.items = normalized;
    await po.save();
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM purchase_order_items WHERE purchase_order_id = $1", [String(purchaseOrderId)]);
    for (const [index, item] of normalized.entries()) {
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, inventory_item_id, ordered_quantity, unit_price, total_price, received_quantity, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
        [
          newId(),
          String(purchaseOrderId),
          String(item.item).trim(),
          item.orderedQuantity,
          item.unitPrice,
          item.totalPrice,
          item.receivedQuantity ?? 0,
          index,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return PurchaseOrder.countDocuments(filter);
  const { where, values } = buildPurchaseOrderFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM purchase_orders ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await PurchaseOrder.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM purchase_orders WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  replaceItems,
  count,
  destroy,
};