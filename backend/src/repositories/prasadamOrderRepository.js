const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const PrasadamOrder = require("../models/PrasadamOrder");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/PrasadamOrder.js.
const CHANNELS = new Set(["devotee", "cashier"]);
const PAYMENT_METHODS = new Set(["UPI", "Cash", "Card", "Bank Transfer", "Net Banking", "Debit Card", "Credit Card"]);
const STATUSES = new Set([
  "Collected", "Not Collected", "Pending", "Approved", "Rejected",
  "Processing", "Ready for Pickup", "Completed", "Cancelled", "Placed",
  "Preparing", "Ready", "Delivered",
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

const assertRequired = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

// Mirrors the Mongo schema: devoteeName/itemName required+trim,
// quantity min 1, unitPrice/amount min 0.
const assertAmount = (amount, label) => {
  if (amount === undefined || amount === null) return;
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${label}: ${amount}. ${label === "quantity" ? "Quantity must be >= 1" : `${label[0].toUpperCase() + label.slice(1)} must be >= 0`}`);
  }
};

const PRASADAM_ORDER_COLS = [
  "id", "channel", "devotee_id", "devotee_name", "email", "phone", "address",
  "item_name", "quantity", "unit_price", "amount", "payment_method",
  "razorpay_order_id", "razorpay_payment_id", "razorpay_signature", "status",
  "created_at", "updated_at",
];

// Converts a prasadam_orders row into the shape the application receives from
// Mongoose (camelCase, Mongo _id).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    channel: row.channel,
    devoteeId: row.devotee_id || undefined,
    devoteeName: row.devotee_name,
    email: row.email || undefined,
    phone: row.phone || undefined,
    address: row.address || undefined,
    itemName: row.item_name,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    unitPrice: row.unit_price === null || row.unit_price === undefined ? undefined : Number(row.unit_price),
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    paymentMethod: row.payment_method,
    razorpayOrderId: row.razorpay_order_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id || undefined,
    razorpaySignature: row.razorpay_signature || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  channel: data.channel || "devotee",
  devotee_id: data.devoteeId ? String(data.devoteeId) : null,
  devotee_name: String(data.devoteeName || "").trim(),
  email: data.email === undefined || data.email === null || String(data.email).trim() === "" ? null : String(data.email).trim(),
  phone: data.phone === undefined || data.phone === null ? null : String(data.phone).trim(),
  address: data.address === undefined || data.address === null || String(data.address).trim() === "" ? null : String(data.address).trim(),
  item_name: String(data.itemName || "").trim(),
  quantity: data.quantity,
  unit_price: data.unitPrice,
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  amount: data.amount,
  payment_method: data.paymentMethod || "UPI",
  razorpay_order_id: data.razorpayOrderId === undefined || data.razorpayOrderId === null ? null : String(data.razorpayOrderId).trim(),
  razorpay_payment_id: data.razorpayPaymentId === undefined || data.razorpayPaymentId === null ? null : String(data.razorpayPaymentId).trim(),
  razorpay_signature: data.razorpaySignature === undefined || data.razorpaySignature === null ? null : String(data.razorpaySignature).trim(),
  status: data.status || "Not Collected",
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  createdAt: "created_at",
  amount: "amount",
  quantity: "quantity",
  status: "status",
  devoteeName: "devotee_name",
  itemName: "item_name",
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

// Normalizes a search string like prasadamAdminController does: a
// case-insensitive substring match across devoteeName/email/phone/itemName.
// A single parameterized ILIKE term preserves that behaviour; the admin flow
// also searches amount by string and cashierName, which have no PostgreSQL
// column (cashierName does not exist on the Mongo model either) and so are
// intentionally out of scope here.
const buildSearch = (search, values) => {
  const term = String(search || "").trim();
  if (!term) return null;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const paramIdx = values.length + 1;
  const like = `%${escaped}%`;
  const sql = `(devotee_name ILIKE $${paramIdx} ESCAPE '\\' OR email ILIKE $${paramIdx} ESCAPE '\\'
    OR phone ILIKE $${paramIdx} ESCAPE '\\' OR item_name ILIKE $${paramIdx} ESCAPE '\\')`;
  return { sql, param: like };
};

const buildPrasadamOrderFilter = (filter = {}) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };
  const pushIn = (col, list) => {
    const vals = (Array.isArray(list) ? list : [list])
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v));
    if (vals.length) {
      conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...vals);
    }
  };

  assertEnum(filter.paymentMethod, PAYMENT_METHODS, "paymentMethod");

  // Channel $in before plain equality — the devotee portal matches the
  // devotee channel plus pre-channel orders ({ channel: { $exists: false } })
  // via { channel: { $in: ["devotee", ""] } }; no PG row can lack the column,
  // so the IN list alone preserves the same semantics.
  if (typeof filter.channel === "object" && !Array.isArray(filter.channel) && filter.channel.$in) {
    assertEnumOrArray(filter.channel.$in, CHANNELS, "channel.$in");
    pushIn("channel", filter.channel.$in);
  } else if (filter.channel) {
    assertEnum(filter.channel, CHANNELS, "channel");
    pushCond("channel", "=", filter.channel);
  }

  // Status $in before plain equality (Mongo operators only apply to status).
  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn("status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond("status", "=", filter.status);
  }

  // Mongo-style { $or: [...] } — used by the devotee portal to match either a
  // normalized email (case-insensitive, like the Mongo $regex 'i' lookup) or a
  // devoteeId that points at the same user, so the clauses must be OR'd inside
  // one parenthesized group.
  const orConditions = Array.isArray(filter.$or) ? filter.$or : [];
  const orParts = [];
  for (const clause of orConditions) {
    if (!clause || typeof clause !== "object") continue;
    if (clause.email) {
      orParts.push(`email ILIKE $${values.length + 1} ESCAPE '\\'`);
      values.push(`%${String(clause.email).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    }
    if (clause.devoteeId) {
      orParts.push(`devotee_id = $${values.length + 1}`);
      values.push(String(clause.devoteeId));
    }
    if (clause.channel) {
      orParts.push(`channel = $${values.length + 1}`);
      values.push(String(clause.channel));
    }
  }
  if (orParts.length) {
    conditions.push(`(${orParts.join(" OR ")})`);
  }

  if (filter.paymentMethod) pushCond("payment_method", "=", filter.paymentMethod);
  if (filter.devoteeId) pushCond("devotee_id", "=", String(filter.devoteeId));
  if (filter.itemName) pushCond("item_name", "=", String(filter.itemName).trim());
  // Razorpay verification lookup (verifyPrasadamPayment).
  if (filter.razorpayOrderId) pushCond("razorpay_order_id", "=", String(filter.razorpayOrderId).trim());

  // createdAt range filters (admin orders table, devotee orders page).
  const createdRange = filter.createdAt || {};
  const cGte = createdRange.$gte ?? filter.dateFrom;
  const cLte = createdRange.$lte ?? filter.dateTo;
  if (cGte) pushCond("created_at", ">=", new Date(cGte));
  if (cLte) pushCond("created_at", "<=", new Date(cLte));

  if (filter.search) {
    const built = buildSearch(filter.search, values);
    if (built) {
      conditions.push(built.sql);
      values.push(built.param);
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return PrasadamOrder.findById(String(id));
  const { rows } = await query(`SELECT ${PRASADAM_ORDER_COLS.join(", ")} FROM prasadam_orders WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return PrasadamOrder.findOne(filter);
  const { where, values } = buildPrasadamOrderFilter(filter);
  if (!where) return null;
  const { rows } = await query(`SELECT ${PRASADAM_ORDER_COLS.join(", ")} FROM prasadam_orders ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = PrasadamOrder.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildPrasadamOrderFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id DESC`;
  let sql = `SELECT ${PRASADAM_ORDER_COLS.join(", ")} FROM prasadam_orders ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates a prasadam order. Mirrors the Mongo model validation
 * (devoteeName/itemName required, quantity >= 1, unitPrice/amount >= 0,
 * channel/paymentMethod/status enums) so both paths accept the same payload.
 * The PostgreSQL INSERT is a single atomic statement — a failure cannot leave
 * a partial row behind.
 */
const create = async (data) => {
  assertRequired(data.devoteeName, "devoteeName");
  assertRequired(data.itemName, "itemName");
  if (data.quantity !== undefined && data.quantity !== null) {
    const num = Number(data.quantity);
    if (!Number.isFinite(num) || num < 1) {
      throw new Error(`Invalid quantity: ${data.quantity}. Quantity must be >= 1`);
    }
  }
  assertAmount(data.unitPrice, "unitPrice");
  assertAmount(data.amount, "amount");
  assertEnum(data.channel, CHANNELS, "channel");
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");

  if (!dbConfig.isDbConnected()) return PrasadamOrder.create(data);

  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO prasadam_orders (${PRASADAM_ORDER_COLS.join(", ")})
     VALUES (${PRASADAM_ORDER_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    PRASADAM_ORDER_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertEnum(updates.channel, CHANNELS, "channel");
  assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(updates.status, STATUSES, "status");
  if (updates.quantity !== undefined && updates.quantity !== null) {
    const num = Number(updates.quantity);
    if (!Number.isFinite(num) || num < 1) {
      throw new Error(`Invalid quantity: ${updates.quantity}. Quantity must be >= 1`);
    }
  }
  if (updates.unitPrice !== undefined) assertAmount(updates.unitPrice, "unitPrice");
  if (updates.amount !== undefined) assertAmount(updates.amount, "amount");

  if (!dbConfig.isDbConnected()) {
    return PrasadamOrder.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  }

  const existing = await findById(id);
  if (!existing?._id) return null;

  const fields = [];
  const values = [];
  const applyBlankable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || String(value).trim() === "" ? null : String(value).trim());
    }
  };
  const apply = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value);
    }
  };

  if (updates.channel !== undefined) apply("channel", updates.channel || "devotee");
  if (updates.devoteeId !== undefined) apply("devotee_id", updates.devoteeId ? String(updates.devoteeId) : null);
  if (updates.devoteeName !== undefined) apply("devotee_name", String(updates.devoteeName).trim());
  if (updates.email !== undefined) applyBlankable("email", updates.email);
  if (updates.phone !== undefined) applyBlankable("phone", updates.phone);
  if (updates.address !== undefined) applyBlankable("address", updates.address);
  if (updates.itemName !== undefined) apply("item_name", String(updates.itemName).trim());
  if (updates.quantity !== undefined) apply("quantity", updates.quantity);
  if (updates.unitPrice !== undefined) apply("unit_price", updates.unitPrice);
  if (updates.amount !== undefined) apply("amount", updates.amount);
  if (updates.paymentMethod !== undefined) apply("payment_method", updates.paymentMethod || "UPI");
  if (updates.razorpayOrderId !== undefined) applyBlankable("razorpay_order_id", updates.razorpayOrderId);
  if (updates.razorpayPaymentId !== undefined) applyBlankable("razorpay_payment_id", updates.razorpayPaymentId);
  if (updates.razorpaySignature !== undefined) applyBlankable("razorpay_signature", updates.razorpaySignature);
  if (updates.status !== undefined) apply("status", updates.status || "Not Collected");

  if (values.length === 0) return existing;

  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE prasadam_orders SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return PrasadamOrder.countDocuments(filter);
  const { where, values } = buildPrasadamOrderFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM prasadam_orders ${where}`, values);
  return rows[0]?.count || 0;
};

/**
 * Sales report aggregates for the Prasadam Order domain.
 *
 * These move `prasadamController.getSalesReports`' aggregation off the
 * controller so the read follows the same repository seam as every other
 * Prasadam Order read, while preserving the exact Mongo semantics:
 *
 *   Mongo:  [{ $match: { createdAt: { $gte: from } } },
 *            { $group: { _id: null, totalRevenue: { $sum: "$amount" },
 *                        totalOrders: { $sum: 1 } } }]
 *   PG:     SELECT COALESCE(SUM(amount), 0)::numeric AS total_revenue,
 *                  COUNT(*)::int AS total_orders
 *           FROM prasadam_orders WHERE created_at >= $1
 *
 * Date semantics match because created_at is TIMESTAMPTZ and the boundary is
 * passed as the same JS Date the caller already computed. An empty match set
 * returns zeros from both datasources (Mongo yields an empty array and the
 * caller substitutes zeros; COALESCE/COUNT yield one zero row here), so the
 * empty-result shape is identical. Amounts stay NUMERIC in PostgreSQL and are
 * converted only at the response boundary, so no financial precision is lost.
 */
const aggregateSalesTotals = async (from) => {
  if (!dbConfig.isDbConnected()) {
    const rows = await PrasadamOrder.aggregate([
      { $match: { createdAt: { $gte: new Date(from) } } },
      { $group: { _id: null, totalRevenue: { $sum: "$amount" }, totalOrders: { $sum: 1 } } },
    ]);
    const row = rows[0];
    return {
      totalRevenue: row ? Number(row.totalRevenue) || 0 : 0,
      totalOrders: row ? Number(row.totalOrders) || 0 : 0,
    };
  }

  const { rows } = await query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total_revenue, COUNT(*)::int AS total_orders
     FROM prasadam_orders WHERE created_at >= $1`,
    [new Date(from)]
  );
  const row = rows[0] || {};
  return {
    totalRevenue: row.total_revenue === null || row.total_revenue === undefined ? 0 : Number(row.total_revenue),
    totalOrders: row.total_orders || 0,
  };
};

/**
 * Top-selling items by summed quantity since `from`, mirroring:
 *
 *   Mongo:  [{ $match }, { $group: { _id: "$itemName",
 *                                    totalQuantity: { $sum: "$quantity" } } },
 *            { $sort: { totalQuantity: -1 } }, { $limit: limit }]
 *   PG:     SELECT item_name, SUM(quantity)::numeric AS total_quantity
 *           FROM prasadam_orders WHERE created_at >= $1
 *           GROUP BY item_name ORDER BY total_quantity DESC LIMIT $2
 *
 * The response buckets keep the Mongo `{ _id, totalQuantity }` shape so the
 * endpoint payload is unchanged. Tie ordering is unspecified in both, exactly
 * as it was before.
 */
const aggregateTopSelling = async (from, limit = 5) => {
  const safeLimit = Math.max(1, Number(limit) || 5);

  if (!dbConfig.isDbConnected()) {
    const rows = await PrasadamOrder.aggregate([
      { $match: { createdAt: { $gte: new Date(from) } } },
      { $group: { _id: "$itemName", totalQuantity: { $sum: "$quantity" } } },
      { $sort: { totalQuantity: -1 } },
      { $limit: safeLimit },
    ]);
    return rows.map((row) => ({ _id: row._id, totalQuantity: Number(row.totalQuantity) }));
  }

  const { rows } = await query(
    `SELECT item_name, SUM(quantity)::numeric AS total_quantity
     FROM prasadam_orders WHERE created_at >= $1
     GROUP BY item_name ORDER BY total_quantity DESC LIMIT $2`,
    [new Date(from), safeLimit]
  );
  return rows.map((row) => ({ _id: row.item_name, totalQuantity: Number(row.total_quantity) }));
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await PrasadamOrder.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM prasadam_orders WHERE id = $1 RETURNING id`, [String(id)]);
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
  aggregateSalesTotals,
  aggregateTopSelling,
};