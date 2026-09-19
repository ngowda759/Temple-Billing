const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const AccountTransaction = require("../models/AccountTransaction");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Optional pooled client supplied by a service-level unit of work. When given,
// the query joins the caller's PostgreSQL transaction instead of checking out
// its own connection. Repositories never probe PostgreSQL themselves.
const run = (sql, params, client) => (client ? client.query(sql, params) : query(sql, params));

// Mirrors the enums declared in backend/src/models/AccountTransaction.js.
const TRANSACTION_TYPES = new Set(["Credit", "Debit"]);
const SOURCES = new Set([
  "Pooja Booking", "Donation", "Room Booking", "Prasadam", "Payroll",
  "Manual Entry", "Bank Interest", "Inventory", "Asset", "Repair",
  "Kitchen", "Cleaning",
]);
const PAYMENT_METHODS = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "System"]);
const STATUSES = new Set(["Pending Approval", "Approved", "Completed", "Cancelled", "Rejected"]);
const REFERENCE_MODELS = new Set([
  "Booking", "PoojaBooking", "Donation", "Room", "PrasadamOrder", "PayrollRecord",
  "BankInterest", "RestockHistory", "Asset", "RepairRequest", "InventoryItem",
  "InventoryIssue", "PurchaseOrder", "GoodsReceivedNote", "DamageNote",
  "RepairTicket", "Bill",
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

const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount !== undefined && amount !== null && (!Number.isFinite(num) || num <= 0)) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a positive number.`);
  }
};

const TX_COLS = [
  "id", "transaction_type", "source", "category", "amount", "date",
  "financial_year", "payment_method", "status", "description", "receipt_number",
  "invoice_number", "reference_id", "reference_model", "bank_name", "cashier_id",
  "cashier_name", "recorded_by", "approved_by", "created_at", "updated_at",
];

const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    transactionType: row.transaction_type,
    source: row.source,
    category: row.category,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    date: row.date,
    financialYear: row.financial_year,
    paymentMethod: row.payment_method,
    status: row.status,
    description: row.description || undefined,
    receiptNumber: row.receipt_number || undefined,
    invoiceNumber: row.invoice_number || undefined,
    referenceId: row.reference_id || undefined,
    referenceModel: row.reference_model || undefined,
    bankName: row.bank_name || undefined,
    cashierId: row.cashier_id || undefined,
    cashierName: row.cashier_name || undefined,
    recordedBy: row.recorded_by || undefined,
    approvedBy: row.approved_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  transaction_type: data.transactionType,
  source: data.source,
  category: data.category,
  amount: data.amount,
  date: data.date || new Date(),
  financial_year: data.financialYear,
  payment_method: data.paymentMethod || "System",
  status: data.status || "Completed",
  description: data.description ?? null,
  receipt_number: data.receiptNumber ?? null,
  invoice_number: data.invoiceNumber ?? null,
  reference_id: data.referenceId ? String(data.referenceId) : null,
  reference_model: data.referenceModel || null,
  bank_name: data.bankName ?? null,
  cashier_id: data.cashierId ? String(data.cashierId) : null,
  cashier_name: data.cashierName ?? null,
  recorded_by: data.recordedBy ? String(data.recordedBy) : null,
  approved_by: data.approvedBy ? String(data.approvedBy) : null,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns. `date` is the default Mongo ordering used everywhere.
const SORT_COLUMNS = {
  date: "date",
  createdAt: "created_at",
  amount: "amount",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "date DESC";
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

const buildTxFilter = (filter) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };

  // Mongo-style date range: { date: { $gte, $lte } } or { startDate, endDate }.
  const dateRange = filter.date || {};
  const rangeGte = dateRange.$gte ?? filter.startDate;
  const rangeLte = dateRange.$lte ?? filter.endDate;
  if (rangeGte) pushCond("date", ">=", new Date(rangeGte));
  if (rangeLte) pushCond("date", "<=", new Date(rangeLte));

  assertEnum(filter.transactionType, TRANSACTION_TYPES, "transactionType");
  assertEnum(filter.source, SOURCES, "source");
  assertEnum(filter.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(filter.status, STATUSES, "status");
  assertEnum(filter.referenceModel, REFERENCE_MODELS, "referenceModel");

  if (filter.transactionType) pushCond("transaction_type", "=", filter.transactionType);
  if (filter.source) pushCond("source", "=", filter.source);
  if (filter.paymentMethod) pushCond("payment_method", "=", filter.paymentMethod);
  if (filter.status) pushCond("status", "=", filter.status);
  if (filter.category) pushCond("category", "=", filter.category);
  if (filter.financialYear) pushCond("financial_year", "=", filter.financialYear);
  if (filter.referenceModel) pushCond("reference_model", "=", filter.referenceModel);
  if (filter.referenceId) {
    // Mongo-style { referenceId: { $in: [...] } } matches the query used by
    // inventoryReportController.getItemDetails.
    if (typeof filter.referenceId === "object" && !Array.isArray(filter.referenceId) && filter.referenceId.$in) {
      const list = filter.referenceId.$in;
      const ids = (Array.isArray(list) ? list : [list]).filter((v) => v !== undefined && v !== null).map((v) => String(v));
      if (ids.length) {
        conditions.push(`reference_id IN (${ids.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
        values.push(...ids);
      }
    } else {
      pushCond("reference_id", "=", String(filter.referenceId));
    }
  }
  if (filter.recordedBy) pushCond("recorded_by", "=", String(filter.recordedBy));
  if (filter.cashierId) pushCond("cashier_id", "=", String(filter.cashierId));

  if (filter.referenceModelIn) {
    assertEnumOrArray(filter.referenceModelIn, REFERENCE_MODELS, "referenceModelIn");
    const list = Array.isArray(filter.referenceModelIn) ? filter.referenceModelIn : [filter.referenceModelIn];
    if (list.length) {
      conditions.push(`reference_model IN (${list.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...list);
    }
  }

  if (filter.statusIn) {
    assertEnumOrArray(filter.statusIn, STATUSES, "statusIn");
    const list = Array.isArray(filter.statusIn) ? filter.statusIn : [filter.statusIn];
    if (list.length) {
      conditions.push(`status IN (${list.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...list);
    }
  }

  if (filter.referenceIdIn) {
    const list = Array.isArray(filter.referenceIdIn) ? filter.referenceIdIn : [filter.referenceIdIn];
    const ids = list.filter((v) => v !== undefined && v !== null).map((v) => String(v));
    if (ids.length) {
      conditions.push(`reference_id IN (${ids.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...ids);
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id, client) => {
  if (!id) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await run(`SELECT ${TX_COLS.join(", ")} FROM account_transactions WHERE id = $1 LIMIT 1`, [String(id)], client);
    return toDoc(rows[0]);
  }
  return AccountTransaction.findById(String(id));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = AccountTransaction.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    const docs = await q;
    return docs.map((d) => toDoc(d));
  }

  const { where, values } = buildTxFilter(filter);
  const orderBy = resolveOrderBy(sort);

  let sql = `SELECT ${TX_COLS.join(", ")} FROM account_transactions ${where} ORDER BY ${orderBy}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const findOne = async (filter = {}, client) => {
  if (!dbConfig.isDbConnected()) return AccountTransaction.findOne(filter);
  const { where, values } = buildTxFilter(filter);
  if (!where) return null;
  const { rows } = await run(`SELECT ${TX_COLS.join(", ")} FROM account_transactions ${where} ORDER BY created_at DESC LIMIT 1`, values, client);
  return toDoc(rows[0]);
};

const create = async (data, client) => {
  assertEnum(data.transactionType, TRANSACTION_TYPES, "transactionType");
  assertEnum(data.source, SOURCES, "source");
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.referenceModel, REFERENCE_MODELS, "referenceModel");
  assertAmount(data.amount);

  const id = data.id || newId();
  const row = toRow(data, id);
  if (dbConfig.isDbConnected()) {
    const { rows } = await run(
      `INSERT INTO account_transactions (${TX_COLS.join(", ")})
       VALUES (${TX_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING
       RETURNING ${TX_COLS.join(", ")}`,
      TX_COLS.map((col) => row[col]),
      client
    );
    if (rows[0]) return toDoc(rows[0]);
    const existing = await findById(id, client);
    if (existing) return existing;
  } else {
    return AccountTransaction.create(data);
  }
  return toDoc(row);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertEnum(updates.transactionType, TRANSACTION_TYPES, "transactionType");
  assertEnum(updates.source, SOURCES, "source");
  assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(updates.status, STATUSES, "status");
  assertEnum(updates.referenceModel, REFERENCE_MODELS, "referenceModel");
  assertAmount(updates.amount);

  if (dbConfig.isDbConnected()) {
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

    apply("transaction_type", updates.transactionType);
    apply("source", updates.source);
    apply("category", updates.category);
    apply("amount", updates.amount);
    apply("date", updates.date);
    if (updates.financialYear !== undefined) apply("financial_year", updates.financialYear);
    if (updates.paymentMethod !== undefined) apply("payment_method", updates.paymentMethod);
    apply("status", updates.status);
    if (updates.description !== undefined) apply("description", updates.description ?? null);
    if (updates.receiptNumber !== undefined) apply("receipt_number", updates.receiptNumber ?? null);
    if (updates.invoiceNumber !== undefined) apply("invoice_number", updates.invoiceNumber ?? null);
    if (updates.referenceId !== undefined) apply("reference_id", updates.referenceId ? String(updates.referenceId) : null);
    if (updates.referenceModel !== undefined) apply("reference_model", updates.referenceModel || null);
    if (updates.bankName !== undefined) apply("bank_name", updates.bankName ?? null);
    if (updates.cashierId !== undefined) apply("cashier_id", updates.cashierId ? String(updates.cashierId) : null);
    if (updates.cashierName !== undefined) apply("cashier_name", updates.cashierName ?? null);
    if (updates.recordedBy !== undefined) apply("recorded_by", updates.recordedBy ? String(updates.recordedBy) : null);
    if (updates.approvedBy !== undefined) apply("approved_by", updates.approvedBy ? String(updates.approvedBy) : null);

    if (values.length === 0) return existing;
    fields.push(`updated_at = now()`);
    values.push(id);
    await query(`UPDATE account_transactions SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    return findById(id);
  }
  const updated = await AccountTransaction.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  return updated ? toDoc(updated) : null;
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return AccountTransaction.countDocuments(filter);
  const { where, values } = buildTxFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM account_transactions ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`DELETE FROM account_transactions WHERE id = $1 RETURNING id`, [String(id)]);
    return rows.length > 0;
  }
  const deleted = await AccountTransaction.findByIdAndDelete(String(id));
  return Boolean(deleted);
};

module.exports = {
  findById,
  findMany,
  findOne,
  create,
  updateById,
  count,
  destroy,
};