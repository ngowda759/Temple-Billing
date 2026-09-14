const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const GoodsReceivedNote = require("../models/GoodsReceivedNote");
const goodsReceivedNoteItemRepository = require("./goodsReceivedNoteItemRepository");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/GoodsReceivedNote.js.
const STATUSES = new Set([
  "Draft", "Pending Quality Check", "Pending Approval", "Approved", "Rejected",
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

const GOODS_RECEIVED_NOTE_COLS = [
  "id", "grn_number", "purchase_order_id", "supplier", "supplier_invoice_number",
  "supplier_invoice_date", "total_amount", "status", "received_by", "approved_by",
  "notes", "created_at", "updated_at",
];

// Generates the exact grnNumber the createGRN controller produces:
// `GRN-${count + 1}` zero-padded to 5 (e.g. GRN-00007). This is a derived,
// write-time value — no control flow ever parses an existing grnNumber, so
// the only semantic is "one greater than the current count".
const defaultGrnNumber = async () => {
  const existing = await count({});
  return `GRN-${String(existing + 1).padStart(5, "0")}`;
};

// Converts a goods_received_notes row into the shape the application receives
// from Mongoose (camelCase, Mongo _id). Nullable date columns come back as
// undefined when unset, matching null/default-null Mongo behaviour.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    grnNumber: row.grn_number,
    purchaseOrder: row.purchase_order_id || undefined,
    supplier: row.supplier,
    supplierInvoiceNumber: row.supplier_invoice_number || undefined,
    supplierInvoiceDate: row.supplier_invoice_date || undefined,
    totalAmount: row.total_amount === null || row.total_amount === undefined ? undefined : Number(row.total_amount),
    status: row.status,
    receivedBy: row.received_by || undefined,
    approvedBy: row.approved_by || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Converts a goods_received_notes row plus its normalized
// goods_received_note_items rows back into a Mongoose-compatible
// GoodsReceivedNote document (embedded receivedItems array included).
const toDocWithItems = (row, items) => ({
  ...toDoc(row),
  receivedItems: Array.isArray(items) ? items : [],
});

const toRow = (data, id = newId()) => ({
  id,
  grn_number: assertId(data.grnNumber, "grnNumber"),
  // purchaseOrder is optional in Mongo — null when unset.
  purchase_order_id: data.purchaseOrder === undefined || data.purchaseOrder === null || String(data.purchaseOrder).trim() === "" ? null : String(data.purchaseOrder).trim(),
  supplier: assertId(data.supplier, "supplier"),
  supplier_invoice_number: data.supplierInvoiceNumber === undefined || data.supplierInvoiceNumber === null || String(data.supplierInvoiceNumber).trim() === "" ? null : String(data.supplierInvoiceNumber).trim(),
  supplier_invoice_date: data.supplierInvoiceDate === undefined || data.supplierInvoiceDate === null ? null : new Date(data.supplierInvoiceDate),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  total_amount: data.totalAmount,
  status: data.status || "Draft",
  received_by: data.receivedBy === undefined || data.receivedBy === null || String(data.receivedBy).trim() === "" ? null : String(data.receivedBy).trim(),
  approved_by: data.approvedBy === undefined || data.approvedBy === null || String(data.approvedBy).trim() === "" ? null : String(data.approvedBy).trim(),
  notes: data.notes === undefined || data.notes === null || String(data.notes).trim() === "" ? null : String(data.notes).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The Mongo
// model itself exposes only grnNumber (unique, scalar sortable), the status/
// dates and timestamps; the default for GRN list screens follows the app-wide
// createdAt DESC convention. No column outside this whitelist can ever be
// injected into ORDER BY.
const SORT_COLUMNS = {
  grnNumber: "grn_number",
  status: "status",
  purchaseOrder: "purchase_order_id",
  supplier: "supplier",
  totalAmount: "total_amount",
  receivedBy: "received_by",
  approvedBy: "approved_by",
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
// filters the application could use against GoodsReceivedNote:
//   * { grnNumber } — unique number lookups (admin GRN review shows one GRN
//     by number)
//   * { supplier } / { supplier: { $in: [...] } } — supplier receipt lists
//   * { status } / { status: { $in: [...] } } — status filtering (the admin
//     GRN review list is status-driven: Draft / Pending Quality Check /
//     Pending Approval / Approved / Rejected)
//   * { purchaseOrder } / { purchaseOrder: { $in: [...] } } — the createGRN
//     PO status flip and per-PO receipt history
//   * { id } / { id: { $in: [...] } }
//   * { createdAt } / { updatedAt } / { supplierInvoiceDate } range filters
//   * { totalAmount } range filters
const buildGoodsReceivedNoteFilter = (filter = {}) => {
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

  if (typeof filter.purchaseOrder === "object" && !Array.isArray(filter.purchaseOrder) && filter.purchaseOrder.$in) {
    pushIn(conditions, values, "purchase_order_id", filter.purchaseOrder.$in);
  } else if (filter.purchaseOrder) {
    pushCond(conditions, values, "purchase_order_id", "=", String(filter.purchaseOrder).trim());
  }

  if (typeof filter.grnNumber === "object" && !Array.isArray(filter.grnNumber) && filter.grnNumber.$in) {
    pushIn(conditions, values, "grn_number", filter.grnNumber.$in);
  } else if (filter.grnNumber) {
    pushCond(conditions, values, "grn_number", "=", String(filter.grnNumber).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "updated_at", filter.updatedAt, true);
  pushRangeOrEquals(conditions, values, "supplier_invoice_date", filter.supplierInvoiceDate, true);
  pushRangeOrEquals(conditions, values, "total_amount", filter.totalAmount, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const loadItems = async (id) => goodsReceivedNoteItemRepository.findByGrnId(id);

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return GoodsReceivedNote.findById(String(id));
  const { rows } = await query(`SELECT ${GOODS_RECEIVED_NOTE_COLS.join(", ")} FROM goods_received_notes WHERE id = $1 LIMIT 1`, [String(id)]);
  if (!rows[0]) return null;
  return toDocWithItems(rows[0], await loadItems(rows[0].id));
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return GoodsReceivedNote.findOne(filter);
  const { where, values } = buildGoodsReceivedNoteFilter(filter);
  const { rows } = await query(`SELECT ${GOODS_RECEIVED_NOTE_COLS.join(", ")} FROM goods_received_notes ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  if (!rows[0]) return null;
  return toDocWithItems(rows[0], await loadItems(rows[0].id));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = GoodsReceivedNote.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildGoodsReceivedNoteFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${GOODS_RECEIVED_NOTE_COLS.join(", ")} FROM goods_received_notes ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => toDocWithItems(row, await loadItems(row.id))));
};

/**
 * Creates a goods received note together with its normalized embedded items
 * inside a single PostgreSQL transaction. Either the goods_received_notes row
 * and every item row persist, or none do (the Mongo model saves the GRN and
 * its embedded items as one document — the same unit-of-work semantics).
 */
const create = async (data) => {
  assertId(data.supplier, "supplier");
  assertAmount(data.totalAmount, "totalAmount");
  assertEnum(data.status, STATUSES, "status");
  if (data.purchaseOrder !== undefined && data.purchaseOrder !== null && String(data.purchaseOrder).trim() !== "") {
    assertId(data.purchaseOrder, "purchaseOrder");
  }
  const items = goodsReceivedNoteItemRepository.normalizeItems(data.receivedItems);

  const normalized = { ...data };
  if (normalized.grnNumber === undefined || normalized.grnNumber === null || String(normalized.grnNumber).trim() === "") {
    if (dbConfig.isDbConnected()) {
      // The controller derives the next number from countDocuments + 1; the
      // PostgreSQL equivalent is the current row count + 1. Both are derived
      // at write time and neither parses existing numbers.
      normalized.grnNumber = await defaultGrnNumber();
    } else {
      const existing = await GoodsReceivedNote.countDocuments();
      normalized.grnNumber = `GRN-${String(existing + 1).padStart(5, "0")}`;
    }
  }
  normalized.grnNumber = String(normalized.grnNumber).trim();

  if (!dbConfig.isDbConnected()) {
    return GoodsReceivedNote.create({ ...normalized, receivedItems: items });
  }

  const id = normalized.id || newId();
  const row = toRow(normalized, id);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO goods_received_notes (${GOODS_RECEIVED_NOTE_COLS.join(", ")})
       VALUES (${GOODS_RECEIVED_NOTE_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      GOODS_RECEIVED_NOTE_COLS.map((col) => row[col])
    );
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO goods_received_note_items (id, grn_id, inventory_item_id, po_quantity, received_quantity, accepted_quantity, rejected_quantity, unit_price, batch_number, expiry_date, remarks, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [
          newId(),
          id,
          String(item.item).trim(),
          item.poQuantity ?? 0,
          item.receivedQuantity,
          item.acceptedQuantity,
          item.rejectedQuantity ?? 0,
          item.unitPrice,
          item.batchNumber === undefined || item.batchNumber === null || String(item.batchNumber).trim() === "" ? null : String(item.batchNumber).trim(),
          item.expiryDate === undefined || item.expiryDate === null ? null : new Date(item.expiryDate),
          item.remarks === undefined || item.remarks === null || String(item.remarks).trim() === "" ? null : String(item.remarks).trim(),
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
  if (updates.supplier !== undefined && updates.supplier !== null && String(updates.supplier).trim() === "") {
    throw new Error("supplier is required");
  }
  if (updates.totalAmount !== undefined) assertAmount(updates.totalAmount, "totalAmount");
  assertEnum(updates.status, STATUSES, "status");
  if (updates.receivedItems !== undefined && updates.receivedItems !== null) {
    goodsReceivedNoteItemRepository.normalizeItems(updates.receivedItems);
  }

  if (!dbConfig.isDbConnected()) {
    return GoodsReceivedNote.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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

  if (updates.grnNumber !== undefined && updates.grnNumber !== null) {
    if (String(updates.grnNumber).trim() === "") throw new Error("grnNumber is required");
    apply("grn_number", String(updates.grnNumber).trim());
  }
  if (updates.purchaseOrder !== undefined) applyNullable("purchase_order_id", updates.purchaseOrder);
  if (updates.supplier !== undefined) apply("supplier", String(updates.supplier).trim());
  if (updates.supplierInvoiceNumber !== undefined) applyNullable("supplier_invoice_number", updates.supplierInvoiceNumber);
  if (updates.supplierInvoiceDate !== undefined) applyDate("supplier_invoice_date", updates.supplierInvoiceDate);
  if (updates.totalAmount !== undefined) applyNumber("total_amount", updates.totalAmount);
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.receivedBy !== undefined) applyNullable("received_by", updates.receivedBy);
  if (updates.approvedBy !== undefined) applyNullable("approved_by", updates.approvedBy);
  if (updates.notes !== undefined) applyNullable("notes", updates.notes);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE goods_received_notes SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

/**
 * Replaces a GRN's normalized item rows inside a single PostgreSQL transaction
 * (delete-all + insert is atomic, matching the embedded-array replacement
 * semantics of the Mongo model: `grn.receivedItems = [...]`).
 */
const replaceItems = async (grnId, items = []) => {
  if (!grnId) return;
  const normalized = goodsReceivedNoteItemRepository.normalizeItems(items);

  if (!dbConfig.isDbConnected()) {
    const grn = await GoodsReceivedNote.findById(String(grnId));
    if (!grn) return;
    grn.receivedItems = normalized;
    await grn.save();
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM goods_received_note_items WHERE grn_id = $1", [String(grnId)]);
    for (const [index, item] of normalized.entries()) {
      await client.query(
        `INSERT INTO goods_received_note_items (id, grn_id, inventory_item_id, po_quantity, received_quantity, accepted_quantity, rejected_quantity, unit_price, batch_number, expiry_date, remarks, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())`,
        [
          newId(),
          String(grnId),
          String(item.item).trim(),
          item.poQuantity ?? 0,
          item.receivedQuantity,
          item.acceptedQuantity,
          item.rejectedQuantity ?? 0,
          item.unitPrice,
          item.batchNumber === undefined || item.batchNumber === null || String(item.batchNumber).trim() === "" ? null : String(item.batchNumber).trim(),
          item.expiryDate === undefined || item.expiryDate === null ? null : new Date(item.expiryDate),
          item.remarks === undefined || item.remarks === null || String(item.remarks).trim() === "" ? null : String(item.remarks).trim(),
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
  if (!dbConfig.isDbConnected()) return GoodsReceivedNote.countDocuments(filter);
  const { where, values } = buildGoodsReceivedNoteFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM goods_received_notes ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await GoodsReceivedNote.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM goods_received_notes WHERE id = $1 RETURNING id`, [String(id)]);
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