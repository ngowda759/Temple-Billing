const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const Bill = require("../models/Bill");
const billItemRepository = require("./billItemRepository");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/Bill.js.
const PAYMENT_MODES = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Net Banking", "Debit Card", "Credit Card"]);
const STATUSES = new Set(["Paid", "Pending", "Cancelled"]);
const ITEM_TYPES = new Set(["Pooja", "Donation", "Prasadam", "Room", "Other"]);

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

const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount === undefined || amount === null || !Number.isFinite(num) || num < 1) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number >= 1 (Mongo schema min: 1).`);
  }
};

const BILL_COLS = [
  "id", "devotee_name", "devotee_email", "devotee_phone", "devotee_address",
  "seva_type", "amount", "payment_mode", "bill_type", "reference_no", "source_id",
  "notes", "status", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature",
  "bill_date", "created_at", "updated_at",
];

// Converts a bills row into the shape the application receives from Mongoose.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    devoteeName: row.devotee_name,
    devoteeEmail: row.devotee_email || undefined,
    devoteePhone: row.devotee_phone || undefined,
    devoteeAddress: row.devotee_address || undefined,
    sevaType: row.seva_type || undefined,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    billType: row.bill_type,
    referenceNo: row.reference_no || undefined,
    sourceId: row.source_id || undefined,
    notes: row.notes || undefined,
    status: row.status,
    razorpayOrderId: row.razorpay_order_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id || undefined,
    razorpaySignature: row.razorpay_signature || undefined,
    billDate: row.bill_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Converts a bills row plus its normalized bill_items rows back into a
// Mongoose-compatible Bill document (embedded `items` array included).
const toDocWithItems = (row, items) => ({
  ...toDoc(row),
  items: Array.isArray(items) ? items : [],
});

const toRow = (data, id = newId()) => ({
  id,
  devotee_name: String(data.devoteeName || "").trim(),
  devotee_email: data.devoteeEmail ? String(data.devoteeEmail).trim() : null,
  devotee_phone: data.devoteePhone ? String(data.devoteePhone).trim() : null,
  devotee_address: data.devoteeAddress ? String(data.devoteeAddress).trim() : null,
  seva_type: data.sevaType ? String(data.sevaType).trim() : null,
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  amount: data.amount,
  payment_mode: data.paymentMode || "Cash",
  bill_type: data.billType || "Other",
  reference_no: data.referenceNo ? String(data.referenceNo).trim() : null,
  source_id: data.sourceId ? String(data.sourceId).trim() : null,
  notes: data.notes === undefined || data.notes === null ? null : String(data.notes).trim(),
  status: data.status || "Paid",
  razorpay_order_id: data.razorpayOrderId || null,
  razorpay_payment_id: data.razorpayPaymentId || null,
  razorpay_signature: data.razorpaySignature || null,
  bill_date: data.billDate || new Date(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns:
// getBills sorts by { billDate: -1 }; billController create/verify flows look up
// by billDate/createdAt; findMany opens the door to amount-based sorting.
const SORT_COLUMNS = {
  billDate: "bill_date",
  createdAt: "created_at",
  amount: "amount",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "bill_date DESC";
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

const buildBillFilter = (filter = {}) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };

  assertEnum(filter.paymentMode, PAYMENT_MODES, "paymentMode");
  if (typeof filter.status !== "object") assertEnum(filter.status, STATUSES, "status");

  // Mongo-style { status: { $in: [...] } }. Handled before plain equality.
  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    const list = filter.status.$in;
    const vals = (Array.isArray(list) ? list : [list]).filter((v) => v !== undefined && v !== null);
    if (vals.length) {
      conditions.push(`status IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...vals);
    }
  } else if (filter.status) {
    pushCond("status", "=", filter.status);
  }

  if (filter.paymentMode) pushCond("payment_mode", "=", filter.paymentMode);
  if (filter.billType) pushCond("bill_type", "=", filter.billType);
  if (filter.referenceNo) pushCond("reference_no", "=", filter.referenceNo);
  if (filter.razorpayOrderId) pushCond("razorpay_order_id", "=", filter.razorpayOrderId);
  if (filter.devoteeName) pushCond("devotee_name", "=", filter.devoteeName);

  // Mongo-style { sourceId: { $in: [...] } }, mirroring Phase 2B's referenceId $in handling.
  if (typeof filter.sourceId === "object" && !Array.isArray(filter.sourceId) && filter.sourceId.$in) {
    const list = filter.sourceId.$in;
    const ids = (Array.isArray(list) ? list : [list]).filter((v) => v !== undefined && v !== null).map((v) => String(v));
    if (ids.length) {
      conditions.push(`source_id IN (${ids.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...ids);
    }
  } else if (filter.sourceId) {
    pushCond("source_id", "=", String(filter.sourceId));
  }

  // Mongo-style date range: { billDate: { $gte, $lte } } or { billDateFrom, billDateTo }.
  const dateRange = filter.billDate || {};
  const rangeGte = dateRange.$gte ?? filter.billDateFrom;
  const rangeLte = dateRange.$lte ?? filter.billDateTo;
  if (rangeGte) pushCond("bill_date", ">=", new Date(rangeGte));
  if (rangeLte) pushCond("bill_date", "<=", new Date(rangeLte));

  // Aggregators use { statusIn: [...] } when multiple statuses must match.
  if (filter.statusIn) {
    assertEnumOrArray(filter.statusIn, STATUSES, "statusIn");
    const list = Array.isArray(filter.statusIn) ? filter.statusIn : [filter.statusIn];
    if (list.length) {
      conditions.push(`status IN (${list.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...list);
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const normalizeItems = (items) => {
  if (items === undefined || items === null) return [];
  return (Array.isArray(items) ? items : [items]).filter(
    (item) => item && typeof item === "object"
  );
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Bill.findById(String(id));
  const { rows } = await query(`SELECT ${BILL_COLS.join(", ")} FROM bills WHERE id = $1 LIMIT 1`, [String(id)]);
  if (!rows[0]) return null;
  const items = await billItemRepository.findByBillId(rows[0].id);
  return toDocWithItems(rows[0], items);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Bill.findOne(filter);
  const { where, values } = buildBillFilter(filter);
  if (!where) return null;
  const { rows } = await query(`SELECT ${BILL_COLS.join(", ")} FROM bills ${where} ORDER BY bill_date DESC, created_at DESC LIMIT 1`, values);
  if (!rows[0]) return null;
  const items = await billItemRepository.findByBillId(rows[0].id);
  return toDocWithItems(rows[0], items);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { billDate: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Bill.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildBillFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${BILL_COLS.join(", ")} FROM bills ${where} ORDER BY ${orderBy}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => {
    const items = await billItemRepository.findByBillId(row.id);
    return toDocWithItems(row, items);
  }));
};

/**
 * Creates a bill together with its normalized items inside a single PostgreSQL
 * transaction. Either the bill row and every item row persist, or none do.
 */
const create = async (data) => {
  assertAmount(data.amount);
  assertEnum(data.paymentMode, PAYMENT_MODES, "paymentMode");
  assertEnum(data.status, STATUSES, "status");
  const items = normalizeItems(data.items);

  if (!dbConfig.isDbConnected()) {
    return Bill.create({ ...data, items });
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO bills (${BILL_COLS.join(", ")})
       VALUES (${BILL_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      BILL_COLS.map((col) => row[col])
    );
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO bill_items (id, bill_id, position, item_type, item_name, amount, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [newId(), id, index, item.itemType ?? null, item.itemName ?? null, item.amount === undefined || item.amount === null ? null : item.amount]
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
  assertEnum(updates.paymentMode, PAYMENT_MODES, "paymentMode");
  assertEnum(updates.status, STATUSES, "status");
  if (updates.amount !== undefined) assertAmount(updates.amount);

  if (!dbConfig.isDbConnected()) {
    return Bill.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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

  if (updates.devoteeName !== undefined) apply("devotee_name", String(updates.devoteeName).trim());
  if (updates.devoteeEmail !== undefined) apply("devotee_email", updates.devoteeEmail ? String(updates.devoteeEmail).trim() : null);
  if (updates.devoteePhone !== undefined) apply("devotee_phone", updates.devoteePhone ? String(updates.devoteePhone).trim() : null);
  if (updates.devoteeAddress !== undefined) apply("devotee_address", updates.devoteeAddress ? String(updates.devoteeAddress).trim() : null);
  if (updates.sevaType !== undefined) apply("seva_type", updates.sevaType ? String(updates.sevaType).trim() : null);
  if (updates.amount !== undefined) apply("amount", Number(updates.amount));
  if (updates.paymentMode !== undefined) apply("payment_mode", updates.paymentMode || "Cash");
  if (updates.billType !== undefined) apply("bill_type", updates.billType || "Other");
  if (updates.referenceNo !== undefined) apply("reference_no", updates.referenceNo ? String(updates.referenceNo).trim() : null);
  if (updates.sourceId !== undefined) apply("source_id", updates.sourceId ? String(updates.sourceId) : null);
  if (updates.notes !== undefined) apply("notes", updates.notes ?? null);
  if (updates.status !== undefined) apply("status", updates.status || "Paid");
  if (updates.razorpayOrderId !== undefined) apply("razorpay_order_id", updates.razorpayOrderId || null);
  if (updates.razorpayPaymentId !== undefined) apply("razorpay_payment_id", updates.razorpayPaymentId || null);
  if (updates.razorpaySignature !== undefined) apply("razorpay_signature", updates.razorpaySignature || null);
  if (updates.billDate !== undefined) apply("bill_date", updates.billDate);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE bills SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

/**
 * Replaces a bill's normalized item rows. Single SQL statements so a partial
 * multi-statement script cannot leave a bill with orphan item rows. The bill
 * row itself is intentionally untouched here (item-only update).
 */
const replaceItems = async (billId, items = []) => {
  if (!billId) return;
  for (const item of normalizeItems(items)) {
    assertEnum(item.itemType, ITEM_TYPES, "itemType");
    if (item.amount !== undefined && item.amount !== null) {
      const num = Number(item.amount);
      if (!Number.isFinite(num)) {
        throw new Error(`Invalid item amount: ${item.amount}`);
      }
    }
  }
  const normalized = normalizeItems(items);
  if (!dbConfig.isDbConnected()) {
    const bill = await Bill.findById(String(billId));
    if (!bill) return;
    bill.items = normalized;
    await bill.save();
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM bill_items WHERE bill_id = $1", [String(billId)]);
    for (const [index, item] of normalized.entries()) {
      await client.query(
        `INSERT INTO bill_items (id, bill_id, position, item_type, item_name, amount, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
        [newId(), String(billId), index, item.itemType ?? null, item.itemName ?? null, item.amount === undefined || item.amount === null ? null : item.amount]
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
  if (!dbConfig.isDbConnected()) return Bill.countDocuments(filter);
  const { where, values } = buildBillFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM bills ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await Bill.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM bills WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

// Aggregators mirroring the Mongo ledger flows used across the app:
// Bill.find({ sourceId }), Bill.updateMany({ sourceId }, ...), Bill.deleteMany({ sourceId }).
const findManyBySourceId = async (sourceId) => {
  if (!sourceId) return [];
  return findMany({ filter: { sourceId: String(sourceId) } });
};

const updateManyBySourceId = async (sourceId, updates = {}) => {
  if (!sourceId) return 0;
  const docs = await findManyBySourceId(sourceId);
  let updated = 0;
  for (const doc of docs) {
    const next = await updateById(doc._id, updates);
    if (next) updated += 1;
  }
  return updated;
};

const deleteManyBySourceId = async (sourceId) => {
  if (!sourceId) return 0;
  if (!dbConfig.isDbConnected()) {
    const result = await Bill.deleteMany({ sourceId: String(sourceId) });
    return result.deletedCount || 0;
  }
  const docs = await findManyBySourceId(sourceId);
  let deleted = 0;
  for (const doc of docs) {
    if (await destroy(doc._id)) deleted += 1;
  }
  return deleted;
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
  findManyBySourceId,
  updateManyBySourceId,
  deleteManyBySourceId,
};