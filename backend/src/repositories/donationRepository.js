const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Donation = require("../models/Donation");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/Donation.js.
const PAYMENT_METHODS = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Debit Card", "Credit Card", "Net Banking"]);
const STATUSES = new Set(["Collected", "Not Collected", "Completed", "Pending", "Failed"]);

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// `donorName` is required and trimmed (the Mongo schema declares
// required: true, trim: true). Mirrors the NOT NULL column: an empty or
// whitespace-only name is rejected here rather than persisted as ''.
const assertDonorName = (donorName) => {
  if (donorName === undefined || donorName === null || String(donorName).trim() === "") {
    throw new Error("donorName is required");
  }
};

// `amount` is required (the Mongo model declares required: true, min: 0). Every
// real write path rejects amounts <= 0 before persisting, so creation here
// enforces a strictly positive amount, matching the DB CHECK constraint.
const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount === undefined || amount === null || !Number.isFinite(num) || num <= 0) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number > 0 (Mongo schema min: 0, application requires > 0).`);
  }
};

const DONATION_COLS = [
  "id", "donor_name", "donor_email", "contact_number", "donor_phone",
  "amount", "category", "payment_method", "transaction_id", "razorpay_order_id",
  "razorpay_payment_id", "razorpay_signature", "event_id", "notes", "status",
  "donated_by", "created_at", "updated_at",
];

// Converts a donations row into the shape the application receives from Mongoose.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    donorName: row.donor_name,
    donorEmail: row.donor_email || undefined,
    contactNumber: row.contact_number || undefined,
    donorPhone: row.donor_phone || undefined,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    category: row.category,
    paymentMethod: row.payment_method,
    transactionId: row.transaction_id || undefined,
    razorpayOrderId: row.razorpay_order_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id || undefined,
    razorpaySignature: row.razorpay_signature || undefined,
    eventId: row.event_id || undefined,
    notes: row.notes || undefined,
    status: row.status,
    donatedBy: row.donated_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  donor_name: String(data.donorName || "").trim(),
  donor_email: data.donorEmail ? String(data.donorEmail).trim().toLowerCase() : null,
  contact_number: data.contactNumber ? String(data.contactNumber).trim() : null,
  donor_phone: data.donorPhone ? String(data.donorPhone).trim() : null,
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  amount: data.amount,
  category: data.category || "General",
  payment_method: data.paymentMethod || "UPI",
  transaction_id: data.transactionId ? String(data.transactionId).trim() : null,
  razorpay_order_id: data.razorpayOrderId ? String(data.razorpayOrderId).trim() : null,
  razorpay_payment_id: data.razorpayPaymentId ? String(data.razorpayPaymentId).trim() : null,
  razorpay_signature: data.razorpaySignature ? String(data.razorpaySignature).trim() : null,
  event_id: data.eventId ? String(data.eventId) : null,
  notes: data.notes === undefined || data.notes === null ? null : String(data.notes).trim(),
  status: data.status || "Not Collected",
  donated_by: data.donatedBy ? String(data.donatedBy) : null,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns:
// getAllDonations sorts by { createdAt: -1 }; findMany opens the door to
// amount/date-based sorting used by reports and stats screens.
const SORT_COLUMNS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  amount: "amount",
  donorName: "donor_name",
  category: "category",
  status: "status",
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

const buildDonationFilter = (filter = {}) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };

  assertEnum(filter.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  if (typeof filter.status !== "object") assertEnum(filter.status, STATUSES, "status");

  // Mongo-style { donorEmail: { $in: [...] } }, mirroring buildEmailLookup
  // (devoteeController.getDonations) which emits { donorEmail: { $in: aliases } }.
  if (typeof filter.donorEmail === "object" && !Array.isArray(filter.donorEmail) && filter.donorEmail.$in) {
    const list = filter.donorEmail.$in;
    const emails = (Array.isArray(list) ? list : [list])
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v).trim().toLowerCase());
    if (emails.length) {
      conditions.push(`donor_email IN (${emails.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...emails);
    }
  } else if (filter.donorEmail) {
    pushCond("donor_email", "=", String(filter.donorEmail).trim().toLowerCase());
  }

  if (filter.donorName) pushCond("donor_name", "=", String(filter.donorName).trim());
  if (filter.contactNumber) pushCond("contact_number", "=", String(filter.contactNumber).trim());
  if (filter.donorPhone) pushCond("donor_phone", "=", String(filter.donorPhone).trim());
  if (filter.category) pushCond("category", "=", filter.category);
  if (filter.transactionId) pushCond("transaction_id", "=", filter.transactionId);
  if (filter.razorpayOrderId) pushCond("razorpay_order_id", "=", filter.razorpayOrderId);
  if (filter.eventId) pushCond("event_id", "=", String(filter.eventId));

  // Mongo-style { status: { $in: [...] } }.
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

  // Mongo-style date range: { createdAt: { $gte, $lte } } or { dateFrom, dateTo }.
  const dateRange = filter.createdAt || {};
  const rangeGte = dateRange.$gte ?? filter.dateFrom;
  const rangeLte = dateRange.$lte ?? filter.dateTo;
  if (rangeGte) pushCond("created_at", ">=", new Date(rangeGte));
  if (rangeLte) pushCond("created_at", "<=", new Date(rangeLte));

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

const assertEnumOrArray = (value, allowed, label) => {
  if (value === undefined || value === null) return;
  for (const item of Array.isArray(value) ? value : [value]) {
    assertEnum(item, allowed, label);
  }
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Donation.findById(String(id));
  const { rows } = await query(`SELECT ${DONATION_COLS.join(", ")} FROM donations WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Donation.findOne(filter);
  const { where, values } = buildDonationFilter(filter);
  if (!where) return null;
  const { rows } = await query(`SELECT ${DONATION_COLS.join(", ")} FROM donations ${where} ORDER BY created_at DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Donation.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildDonationFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${DONATION_COLS.join(", ")} FROM donations ${where} ORDER BY ${orderBy}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  assertDonorName(data.donorName);
  assertAmount(data.amount);
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");

  if (!dbConfig.isDbConnected()) {
    return Donation.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO donations (${DONATION_COLS.join(", ")})
     VALUES (${DONATION_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    DONATION_COLS.map((col) => row[col])
  );
  const existing = await findById(id);
  if (existing) return existing;
  return toDoc(row);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(updates.status, STATUSES, "status");
  if (updates.amount !== undefined) assertAmount(updates.amount);

  if (!dbConfig.isDbConnected()) {
    return Donation.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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

  if (updates.donorName !== undefined) apply("donor_name", String(updates.donorName).trim());
  if (updates.donorEmail !== undefined) apply("donor_email", updates.donorEmail ? String(updates.donorEmail).trim().toLowerCase() : null);
  if (updates.contactNumber !== undefined) apply("contact_number", updates.contactNumber ? String(updates.contactNumber).trim() : null);
  if (updates.donorPhone !== undefined) apply("donor_phone", updates.donorPhone ? String(updates.donorPhone).trim() : null);
  if (updates.amount !== undefined) apply("amount", updates.amount);
  if (updates.category !== undefined) apply("category", updates.category || "General");
  if (updates.paymentMethod !== undefined) apply("payment_method", updates.paymentMethod || "UPI");
  if (updates.transactionId !== undefined) apply("transaction_id", updates.transactionId ? String(updates.transactionId).trim() : null);
  if (updates.razorpayOrderId !== undefined) apply("razorpay_order_id", updates.razorpayOrderId ? String(updates.razorpayOrderId).trim() : null);
  if (updates.razorpayPaymentId !== undefined) apply("razorpay_payment_id", updates.razorpayPaymentId ? String(updates.razorpayPaymentId).trim() : null);
  if (updates.razorpaySignature !== undefined) apply("razorpay_signature", updates.razorpaySignature ? String(updates.razorpaySignature).trim() : null);
  if (updates.eventId !== undefined) apply("event_id", updates.eventId ? String(updates.eventId) : null);
  if (updates.notes !== undefined) apply("notes", updates.notes === undefined || updates.notes === null ? null : String(updates.notes).trim());
  if (updates.status !== undefined) apply("status", updates.status || "Not Collected");
  if (updates.donatedBy !== undefined) apply("donated_by", updates.donatedBy ? String(updates.donatedBy) : null);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE donations SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Donation.countDocuments(filter);
  const { where, values } = buildDonationFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM donations ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await Donation.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM donations WHERE id = $1 RETURNING id`, [String(id)]);
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
};