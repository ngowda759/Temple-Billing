const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const PurchaseOrder = require("../models/PurchaseOrder");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the embedded item validation declared in backend/src/models/PurchaseOrder.js
// items[]:
//   * item { ObjectId ref 'InventoryItem', required }
//   * orderedQuantity { Number, required, min: 1 }
//   * unitPrice { Number, required, min: 0 }
//   * totalPrice { Number, required, min: 0 }
//   * receivedQuantity { Number, default 0, min: 0 }

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertRequiredQuantity = (value, label, min) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < min) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= ${min} (Mongo schema min: ${min})`);
  }
};

const assertOptionalQuantity = (value, label, min) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < min) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= ${min} (Mongo schema min: ${min})`);
  }
};

// Mirrors the shape of one embedded item inside the Mongo PurchaseOrder.items[] array.
const ITEM_COLS = [
  "id", "purchase_order_id", "inventory_item_id", "ordered_quantity", "unit_price",
  "total_price", "received_quantity", "position", "created_at", "updated_at",
];

// Converts an embedded Mongo item (as stored in PurchaseOrder.items) into a
// purchase_order_items row.
const toRow = (data, purchaseOrderId, id = newId(), position = 0) => ({
  id,
  purchase_order_id: purchaseOrderId || data.purchaseOrderId || data.purchase_order_id,
  inventory_item_id: assertId(data.item, "item"),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  ordered_quantity: data.orderedQuantity,
  unit_price: data.unitPrice,
  total_price: data.totalPrice,
  received_quantity: data.receivedQuantity ?? 0,
  position: data.position ?? position,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Converts a purchase_order_items row back into a
// Mongo-embedded-item-shaped object. In the Mongo model the embedded item
// itself carries the _id (sub-document), the item ref and the four numeric
// fields.
const toItem = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.inventory_item_id,
    orderedQuantity: row.ordered_quantity === null || row.ordered_quantity === undefined ? undefined : Number(row.ordered_quantity),
    unitPrice: row.unit_price === null || row.unit_price === undefined ? undefined : Number(row.unit_price),
    totalPrice: row.total_price === null || row.total_price === undefined ? undefined : Number(row.total_price),
    receivedQuantity: row.received_quantity === null || row.received_quantity === undefined ? undefined : Number(row.received_quantity),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Validates one embedded item exactly like the Mongoose sub-document schema.
const assertItem = (item) => {
  if (!item || typeof item !== "object") {
    throw new Error("items: each item must be an object");
  }
  assertId(item.item, "items.item");
  assertRequiredQuantity(item.orderedQuantity, "items.orderedQuantity", 1);
  assertRequiredQuantity(item.unitPrice, "items.unitPrice", 0);
  assertRequiredQuantity(item.totalPrice, "items.totalPrice", 0);
  assertOptionalQuantity(item.receivedQuantity, "items.receivedQuantity", 0);
};

const normalizeItems = (items) => {
  if (items === undefined || items === null) return [];
  const list = Array.isArray(items) ? items : [items];
  for (const item of list) assertItem(item);
  return list.map((item) => ({ ...item }));
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    const po = await PurchaseOrder.findOne({ "items._id": String(id) }, { "items.$": 1 });
    return po && po.items && po.items[0] ? po.items[0] : null;
  }
  const { rows } = await query(`SELECT ${ITEM_COLS.join(", ")} FROM purchase_order_items WHERE id = $1 LIMIT 1`, [String(id)]);
  return toItem(rows[0]);
};

const findByPurchaseOrderId = async (purchaseOrderId) => {
  if (!purchaseOrderId) return [];
  if (!dbConfig.isDbConnected()) {
    const po = await PurchaseOrder.findById(String(purchaseOrderId)).select("items");
    return po && Array.isArray(po.items) ? po.items : [];
  }
  const { rows } = await query(
    `SELECT ${ITEM_COLS.join(", ")} FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY position ASC, created_at ASC, id ASC`,
    [String(purchaseOrderId)]
  );
  return rows.map(toItem);
};

const findMany = async (options = {}) => {
  const { filter = {}, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    const docs = await PurchaseOrder.find(filter.purchaseOrderId ? { _id: filter.purchaseOrderId } : {});
    return docs.flatMap((d) => (Array.isArray(d.items) ? d.items : []));
  }

  const conditions = [];
  const values = [];
  if (filter.purchaseOrderId) {
    conditions.push(`purchase_order_id = $${values.length + 1}`);
    values.push(String(filter.purchaseOrderId));
  }
  if (filter.inventoryItemId) {
    conditions.push(`inventory_item_id = $${values.length + 1}`);
    values.push(String(filter.inventoryItemId));
  }

  let sql = `SELECT ${ITEM_COLS.join(", ")} FROM purchase_order_items`;
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY position ASC, created_at ASC, id ASC";
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toItem);
};

const create = async (data) => {
  const normalized = normalizeItems([data])[0];
  const id = data.id || newId();
  const row = toRow(normalized, data.purchaseOrderId || data.purchase_order_id, id, data.position ?? 0);
  if (dbConfig.isDbConnected()) {
    await query(
      `INSERT INTO purchase_order_items (${ITEM_COLS.join(", ")})
       VALUES (${ITEM_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      ITEM_COLS.map((col) => row[col])
    );
    const existing = await findById(id);
    if (existing) return existing;
  } else {
    const po = await PurchaseOrder.findById(String(data.purchaseOrderId || data.purchase_order_id));
    if (!po) return null;
    po.items.push(normalized);
    await po.save();
    const created = po.items[po.items.length - 1];
    return created.toObject ? created.toObject() : created;
  }
  return toItem(row);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.item !== undefined) assertId(updates.item, "item");
  if (updates.orderedQuantity !== undefined) assertRequiredQuantity(updates.orderedQuantity, "orderedQuantity", 1);
  if (updates.unitPrice !== undefined) assertRequiredQuantity(updates.unitPrice, "unitPrice", 0);
  if (updates.totalPrice !== undefined) assertRequiredQuantity(updates.totalPrice, "totalPrice", 0);
  assertOptionalQuantity(updates.receivedQuantity, "receivedQuantity", 0);
  if (!dbConfig.isDbConnected()) {
    const po = await PurchaseOrder.findOneAndUpdate(
      { "items._id": String(id) },
      {
        $set: {
          "items.$.item": updates.item,
          "items.$.orderedQuantity": updates.orderedQuantity,
          "items.$.unitPrice": updates.unitPrice,
          "items.$.totalPrice": updates.totalPrice,
          "items.$.receivedQuantity": updates.receivedQuantity,
        },
      },
      { new: true }
    );
    if (!po) return null;
    const item = po.items.find((i) => String(i._id) === String(id));
    return item ? (item.toObject ? item.toObject() : item) : null;
  }

  const existing = await findById(id);
  if (!existing?.id) return null;

  const fields = [];
  const values = [];
  const apply = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value);
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };

  if (updates.item !== undefined) apply("inventory_item_id", String(updates.item).trim());
  if (updates.orderedQuantity !== undefined) applyNumber("ordered_quantity", updates.orderedQuantity);
  if (updates.unitPrice !== undefined) applyNumber("unit_price", updates.unitPrice);
  if (updates.totalPrice !== undefined) applyNumber("total_price", updates.totalPrice);
  if (updates.receivedQuantity !== undefined) applyNumber("received_quantity", updates.receivedQuantity);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE purchase_order_items SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) {
    const docs = await PurchaseOrder.find(filter.purchaseOrderId ? { _id: filter.purchaseOrderId } : {});
    return docs.reduce((n, d) => n + (Array.isArray(d.items) ? d.items.length : 0), 0);
  }
  const conditions = [];
  const values = [];
  if (filter.purchaseOrderId) {
    conditions.push(`purchase_order_id = $${values.length + 1}`);
    values.push(String(filter.purchaseOrderId));
  }
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM purchase_order_items ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    values
  );
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) {
    const po = await PurchaseOrder.findOneAndUpdate(
      { "items._id": String(id) },
      { $pull: { items: { _id: String(id) } } },
      { new: true }
    );
    return Boolean(po);
  }
  const { rows } = await query(`DELETE FROM purchase_order_items WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findByPurchaseOrderId,
  findMany,
  create,
  updateById,
  count,
  destroy,
  normalizeItems,
  assertItem,
};