const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Bill = require("../models/Bill");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the itemType enum declared in backend/src/models/Bill.js items[].
const ITEM_TYPES = new Set(["Pooja", "Donation", "Prasadam", "Room", "Other"]);

const assertItemType = (value) => {
  if (value === undefined || value === null || value === "") return;
  if (!ITEM_TYPES.has(value)) {
    throw new Error(`Invalid itemType: ${value}. Allowed: ${[...ITEM_TYPES].join(", ")}`);
  }
};

const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount !== undefined && amount !== null && !Number.isFinite(num)) {
    throw new Error(`Invalid item amount: ${amount}. Amount must be a finite number.`);
  }
};

// Mirrors the shape of one embedded item inside the Mongo Bill.items[] array.
const ITEM_COLS = ["id", "bill_id", "position", "item_type", "item_name", "amount", "created_at", "updated_at"];

// Converts an embedded Mongo item (as stored in Bill.items) into a bill_items row.
const toRow = (data, billId, id = newId()) => ({
  id,
  bill_id: billId || data.billId || data.bill_id,
  position: data.position ?? 0,
  item_type: data.itemType ?? null,
  item_name: data.itemName ?? null,
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  amount: data.amount === undefined || data.amount === null ? null : data.amount,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Converts a bill_items row back into a Mongo-embedded-item-shaped object.
const toItem = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    itemType: row.item_type || undefined,
    itemName: row.item_name || undefined,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) {
    const bill = await Bill.findOne({ "items._id": String(id) }, { "items.$": 1 });
    return bill && bill.items && bill.items[0] ? bill.items[0] : null;
  }
  const { rows } = await query(`SELECT ${ITEM_COLS.join(", ")} FROM bill_items WHERE id = $1 LIMIT 1`, [String(id)]);
  return toItem(rows[0]);
};

const findByBillId = async (billId) => {
  if (!billId) return [];
  if (!dbConfig.isDbConnected()) {
    const bill = await Bill.findById(String(billId)).select("items");
    return bill && Array.isArray(bill.items) ? bill.items : [];
  }
  const { rows } = await query(
    `SELECT ${ITEM_COLS.join(", ")} FROM bill_items WHERE bill_id = $1 ORDER BY position ASC, created_at ASC, id ASC`,
    [String(billId)]
  );
  return rows.map(toItem);
};

const findMany = async (options = {}) => {
  const { filter = {}, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Bill.find(filter.billId ? { _id: filter.billId } : {});
    const docs = await q;
    const items = docs.flatMap((d) => (Array.isArray(d.items) ? d.items : []));
    return items;
  }

  const conditions = [];
  const values = [];
  if (filter.billId) {
    conditions.push(`bill_id = $${values.length + 1}`);
    values.push(String(filter.billId));
  }
  if (filter.itemType) {
    conditions.push(`item_type = $${values.length + 1}`);
    values.push(filter.itemType);
  }

  let sql = `SELECT ${ITEM_COLS.join(", ")} FROM bill_items`;
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY position ASC, created_at ASC, id ASC";
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toItem);
};

const create = async (data) => {
  assertItemType(data.itemType);
  assertAmount(data.amount);
  const id = data.id || newId();
  const row = toRow(data, data.billId, id);
  if (dbConfig.isDbConnected()) {
    await query(
      `INSERT INTO bill_items (${ITEM_COLS.join(", ")})
       VALUES (${ITEM_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      ITEM_COLS.map((col) => row[col])
    );
    const existing = await findById(id);
    if (existing) return existing;
  } else {
    const bill = await Bill.findById(String(data.billId));
    if (!bill) return null;
    bill.items.push({ itemType: data.itemType, itemName: data.itemName, amount: data.amount });
    await bill.save();
    const created = bill.items[bill.items.length - 1];
    return created.toObject ? created.toObject() : created;
  }
  return toItem(row);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertItemType(updates.itemType);
  assertAmount(updates.amount);
  if (!dbConfig.isDbConnected()) {
    const bill = await Bill.findOneAndUpdate(
      { "items._id": String(id) },
      {
        $set: {
          "items.$.itemType": updates.itemType,
          "items.$.itemName": updates.itemName,
          "items.$.amount": updates.amount,
        },
      },
      { new: true }
    );
    if (!bill) return null;
    const item = bill.items.find((i) => String(i._id) === String(id));
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

  if (updates.itemType !== undefined) apply("item_type", updates.itemType ?? null);
  if (updates.itemName !== undefined) apply("item_name", updates.itemName ?? null);
  if (updates.amount !== undefined) apply("amount", updates.amount ?? null);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE bill_items SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) {
    const docs = await Bill.find(filter.billId ? { _id: filter.billId } : {});
    return docs.reduce((n, d) => n + (Array.isArray(d.items) ? d.items.length : 0), 0);
  }
  const conditions = [];
  const values = [];
  if (filter.billId) {
    conditions.push(`bill_id = $${values.length + 1}`);
    values.push(String(filter.billId));
  }
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM bill_items ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    values
  );
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) {
    const bill = await Bill.findOneAndUpdate(
      { "items._id": String(id) },
      { $pull: { items: { _id: String(id) } } },
      { new: true }
    );
    return Boolean(bill);
  }
  const { rows } = await query(`DELETE FROM bill_items WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findByBillId,
  findMany,
  create,
  updateById,
  count,
  destroy,
};