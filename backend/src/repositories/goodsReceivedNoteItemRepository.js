const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const GoodsReceivedNote = require("../models/GoodsReceivedNote");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the embedded item validation declared in
// backend/src/models/GoodsReceivedNote.js receivedItems[]:
//   * item { ObjectId ref 'InventoryItem', required }
//   * poQuantity { Number, default 0, NO min }
//   * receivedQuantity { Number, required, min: 0 }
//   * acceptedQuantity { Number, required, min: 0 }
//   * rejectedQuantity { Number, default 0, min: 0 }
//   * unitPrice { Number, required, min: 0 }
//   * batchNumber { String, optional }
//   * expiryDate { Date, optional }
//   * remarks { String, optional }

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

// poQuantity has NO min in Mongo ({ type: Number, default: 0 } permits
// negatives) — only finiteness is checked.
const assertPoQuantity = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
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

// Mirrors the shape of one embedded item inside the Mongo
// GoodsReceivedNote.receivedItems[] array.
const ITEM_COLS = [
  "id", "grn_id", "inventory_item_id", "po_quantity", "received_quantity",
  "accepted_quantity", "rejected_quantity", "unit_price", "batch_number",
  "expiry_date", "remarks", "position", "created_at", "updated_at",
];

// Converts an embedded Mongo item (as stored in
// GoodsReceivedNote.receivedItems) into a goods_received_note_items row.
const toRow = (data, grnId, id = newId(), position = 0) => ({
  id,
  grn_id: grnId || data.grnId || data.grn_id,
  inventory_item_id: assertId(data.item, "item"),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  po_quantity: data.poQuantity ?? 0,
  received_quantity: data.receivedQuantity,
  accepted_quantity: data.acceptedQuantity,
  rejected_quantity: data.rejectedQuantity ?? 0,
  unit_price: data.unitPrice,
  batch_number: data.batchNumber === undefined || data.batchNumber === null || String(data.batchNumber).trim() === "" ? null : String(data.batchNumber).trim(),
  expiry_date: data.expiryDate === undefined || data.expiryDate === null ? null : new Date(data.expiryDate),
  remarks: data.remarks === undefined || data.remarks === null || String(data.remarks).trim() === "" ? null : String(data.remarks).trim(),
  position: data.position ?? position,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Converts a goods_received_note_items row back into a
// Mongo-embedded-item-shaped object. In the Mongo model the embedded item
// itself carries the _id (sub-document), the item ref and the fields above.
const toItem = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.inventory_item_id,
    poQuantity: row.po_quantity === null || row.po_quantity === undefined ? undefined : Number(row.po_quantity),
    receivedQuantity: row.received_quantity === null || row.received_quantity === undefined ? undefined : Number(row.received_quantity),
    acceptedQuantity: row.accepted_quantity === null || row.accepted_quantity === undefined ? undefined : Number(row.accepted_quantity),
    rejectedQuantity: row.rejected_quantity === null || row.rejected_quantity === undefined ? undefined : Number(row.rejected_quantity),
    unitPrice: row.unit_price === null || row.unit_price === undefined ? undefined : Number(row.unit_price),
    batchNumber: row.batch_number || undefined,
    expiryDate: row.expiry_date || undefined,
    remarks: row.remarks || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Validates one embedded item exactly like the Mongoose sub-document schema.
const assertItem = (item) => {
  if (!item || typeof item !== "object") {
    throw new Error("receivedItems: each item must be an object");
  }
  assertId(item.item, "receivedItems.item");
  assertPoQuantity(item.poQuantity, "receivedItems.poQuantity");
  assertRequiredQuantity(item.receivedQuantity, "receivedItems.receivedQuantity", 0);
  assertRequiredQuantity(item.acceptedQuantity, "receivedItems.acceptedQuantity", 0);
  assertOptionalQuantity(item.rejectedQuantity, "receivedItems.rejectedQuantity", 0);
  assertRequiredQuantity(item.unitPrice, "receivedItems.unitPrice", 0);
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
    const grn = await GoodsReceivedNote.findOne({ "receivedItems._id": String(id) }, { "receivedItems.$": 1 });
    return grn && grn.receivedItems && grn.receivedItems[0] ? grn.receivedItems[0] : null;
  }
  const { rows } = await query(`SELECT ${ITEM_COLS.join(", ")} FROM goods_received_note_items WHERE id = $1 LIMIT 1`, [String(id)]);
  return toItem(rows[0]);
};

const findByGrnId = async (grnId) => {
  if (!grnId) return [];
  if (!dbConfig.isDbConnected()) {
    const grn = await GoodsReceivedNote.findById(String(grnId)).select("receivedItems");
    return grn && Array.isArray(grn.receivedItems) ? grn.receivedItems : [];
  }
  const { rows } = await query(
    `SELECT ${ITEM_COLS.join(", ")} FROM goods_received_note_items WHERE grn_id = $1 ORDER BY position ASC, created_at ASC, id ASC`,
    [String(grnId)]
  );
  return rows.map(toItem);
};

const findMany = async (options = {}) => {
  const { filter = {}, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    const docs = await GoodsReceivedNote.find(filter.grnId ? { _id: filter.grnId } : {});
    return docs.flatMap((d) => (Array.isArray(d.receivedItems) ? d.receivedItems : []));
  }

  const conditions = [];
  const values = [];
  if (filter.grnId) {
    conditions.push(`grn_id = $${values.length + 1}`);
    values.push(String(filter.grnId));
  }
  if (filter.inventoryItemId) {
    conditions.push(`inventory_item_id = $${values.length + 1}`);
    values.push(String(filter.inventoryItemId));
  }

  let sql = `SELECT ${ITEM_COLS.join(", ")} FROM goods_received_note_items`;
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
  const row = toRow(normalized, data.grnId || data.grn_id, id, data.position ?? 0);
  if (dbConfig.isDbConnected()) {
    await query(
      `INSERT INTO goods_received_note_items (${ITEM_COLS.join(", ")})
       VALUES (${ITEM_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      ITEM_COLS.map((col) => row[col])
    );
    const existing = await findById(id);
    if (existing) return existing;
  } else {
    const grn = await GoodsReceivedNote.findById(String(data.grnId || data.grn_id));
    if (!grn) return null;
    grn.receivedItems.push(normalized);
    await grn.save();
    const created = grn.receivedItems[grn.receivedItems.length - 1];
    return created.toObject ? created.toObject() : created;
  }
  return toItem(row);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.item !== undefined) assertId(updates.item, "item");
  if (updates.poQuantity !== undefined) assertPoQuantity(updates.poQuantity, "poQuantity");
  if (updates.receivedQuantity !== undefined) assertRequiredQuantity(updates.receivedQuantity, "receivedQuantity", 0);
  if (updates.acceptedQuantity !== undefined) assertRequiredQuantity(updates.acceptedQuantity, "acceptedQuantity", 0);
  assertOptionalQuantity(updates.rejectedQuantity, "rejectedQuantity", 0);
  if (updates.unitPrice !== undefined) assertRequiredQuantity(updates.unitPrice, "unitPrice", 0);
  if (!dbConfig.isDbConnected()) {
    const grn = await GoodsReceivedNote.findOneAndUpdate(
      { "receivedItems._id": String(id) },
      {
        $set: {
          "receivedItems.$.item": updates.item,
          "receivedItems.$.poQuantity": updates.poQuantity,
          "receivedItems.$.receivedQuantity": updates.receivedQuantity,
          "receivedItems.$.acceptedQuantity": updates.acceptedQuantity,
          "receivedItems.$.rejectedQuantity": updates.rejectedQuantity,
          "receivedItems.$.unitPrice": updates.unitPrice,
          "receivedItems.$.batchNumber": updates.batchNumber,
          "receivedItems.$.expiryDate": updates.expiryDate,
          "receivedItems.$.remarks": updates.remarks,
        },
      },
      { new: true }
    );
    if (!grn) return null;
    const item = grn.receivedItems.find((i) => String(i._id) === String(id));
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

  if (updates.item !== undefined) apply("inventory_item_id", String(updates.item).trim());
  if (updates.poQuantity !== undefined) applyNumber("po_quantity", updates.poQuantity);
  if (updates.receivedQuantity !== undefined) applyNumber("received_quantity", updates.receivedQuantity);
  if (updates.acceptedQuantity !== undefined) applyNumber("accepted_quantity", updates.acceptedQuantity);
  if (updates.rejectedQuantity !== undefined) applyNumber("rejected_quantity", updates.rejectedQuantity);
  if (updates.unitPrice !== undefined) applyNumber("unit_price", updates.unitPrice);
  if (updates.batchNumber !== undefined) applyNullable("batch_number", updates.batchNumber);
  if (updates.expiryDate !== undefined) applyDate("expiry_date", updates.expiryDate);
  if (updates.remarks !== undefined) applyNullable("remarks", updates.remarks);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE goods_received_note_items SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) {
    const docs = await GoodsReceivedNote.find(filter.grnId ? { _id: filter.grnId } : {});
    return docs.reduce((n, d) => n + (Array.isArray(d.receivedItems) ? d.receivedItems.length : 0), 0);
  }
  const conditions = [];
  const values = [];
  if (filter.grnId) {
    conditions.push(`grn_id = $${values.length + 1}`);
    values.push(String(filter.grnId));
  }
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM goods_received_note_items ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    values
  );
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) {
    const grn = await GoodsReceivedNote.findOneAndUpdate(
      { "receivedItems._id": String(id) },
      { $pull: { receivedItems: { _id: String(id) } } },
      { new: true }
    );
    return Boolean(grn);
  }
  const { rows } = await query(`DELETE FROM goods_received_note_items WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findByGrnId,
  findMany,
  create,
  updateById,
  count,
  destroy,
  normalizeItems,
  assertItem,
};