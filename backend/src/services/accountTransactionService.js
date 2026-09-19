const dbConfig = require("../config/db");
const AccountTransaction = require("../models/AccountTransaction");
const accountTransactionRepository = require("../repositories/accountTransactionRepository");
const accountHeadService = require("./accountHeadService");

const TRANSACTION_TYPES = new Set(["Credit", "Debit"]);
const PAYMENT_METHODS = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "System"]);
const STATUSES = new Set(["Pending Approval", "Approved", "Completed", "Cancelled", "Rejected"]);
// Mirrors the source enum declared in backend/src/models/AccountTransaction.js.
const ACCOUNT_TRANSACTION_SOURCES = new Set([
  "Pooja Booking", "Donation", "Room Booking", "Prasadam", "Payroll",
  "Manual Entry", "Bank Interest", "Inventory", "Asset", "Repair",
  "Kitchen", "Cleaning",
]);

const isConnected = () => dbConfig.isDbConnected();

const getFinancialYear = (date) => {
  const d = date ? new Date(date) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)
  return month >= 3 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount === undefined || amount === null || !Number.isFinite(num) || num <= 0) {
    throw new Error("Amount must be a positive number");
  }
};

/**
 * PostgreSQL-backed account transaction operations.
 *
 * Business rules mirror the existing Mongo implementation:
 *  - `transactionType` must be "Credit" | "Debit".
 *  - `source` is required and must belong to the model enum.
 *  - `amount` must be a positive number (the Mongo schema declares min: 0 and
 *    accountingService.recordTransaction rejects amounts <= 0).
 *  - `date` defaults to now; `paymentMethod` defaults to "System";
 *    `status` defaults to "Completed".
 *  - `financialYear` is derived from the transaction date (Apr 1 – Mar 31).
 *  - `referenceId`/`referenceModel` stay polymorphic until the referenced
 *    entities are migrated; no foreign keys are created to future tables.
 */
const validate = (data) => {
  if (!data.transactionType || !TRANSACTION_TYPES.has(data.transactionType)) {
    throw new Error(`Invalid transactionType: ${data.transactionType}. Allowed: Credit, Debit`);
  }
  if (!data.source) {
    throw new Error("Transaction source is required");
  }
  if (!ACCOUNT_TRANSACTION_SOURCES.has(data.source)) {
    throw new Error(`Invalid source: ${data.source}. Allowed: ${[...ACCOUNT_TRANSACTION_SOURCES].join(", ")}`);
  }
  if (!data.category) {
    throw new Error("Transaction category is required");
  }
  assertAmount(data.amount);
  if (data.paymentMethod !== undefined && !PAYMENT_METHODS.has(data.paymentMethod)) {
    throw new Error(`Invalid paymentMethod: ${data.paymentMethod}`);
  }
  if (data.status !== undefined && !STATUSES.has(data.status)) {
    throw new Error(`Invalid status: ${data.status}`);
  }
};

const ensureAccountHead = async ({ category, transactionType, recordedBy }) => {
  const existing = await accountHeadService.findByName(category);
  if (existing) return existing;
  return accountHeadService.create({
    name: category,
    type: transactionType === "Credit" ? "Income" : "Expense",
    description: `Auto-generated head for ${category}`,
    isActive: true,
    createdBy: recordedBy,
  }).catch(() => null);
};

/**
 * Records a transaction, mirroring accountingService.recordTransaction semantics:
 * idempotency check on (referenceId, referenceModel, category), auto-creation of
 * missing account heads, and derived financial year. Calls the PostgreSQL
 * repository when connected and falls back to the Mongo model otherwise.
 */
const recordTransaction = async (payload) => {
  const {
    transactionType,
    source,
    category,
    amount,
    date = new Date(),
    paymentMethod = "System",
    status = "Completed",
    description,
    receiptNumber,
    invoiceNumber,
    referenceId,
    referenceModel,
    cashierId,
    cashierName,
    recordedBy,
  } = payload;

  assertAmount(amount);

  if (referenceId && referenceModel && category) {
    const existing = isConnected()
      ? await accountTransactionRepository.findOne({
          referenceId,
          referenceModel,
          category,
          statusIn: ["Completed", "Approved", "Pending Approval"],
        })
      : await AccountTransaction.findOne({
          referenceId,
          referenceModel,
          category,
          status: { $in: ["Completed", "Approved", "Pending Approval"] },
        });
    if (existing) {
      return existing;
    }
  }

  const financialYear = getFinancialYear(date);

  if (category) {
    await ensureAccountHead({ category, transactionType, recordedBy });
  }

  const transactionData = {
    transactionType,
    source,
    category,
    amount,
    date,
    financialYear,
    paymentMethod,
    status,
    description,
    receiptNumber,
    invoiceNumber,
    referenceId,
    referenceModel,
    cashierId,
    cashierName,
    recordedBy,
  };

  if (isConnected()) {
    return accountTransactionRepository.create(transactionData);
  }
  return AccountTransaction.create(transactionData);
};

const findById = async (id) =>
  isConnected() ? accountTransactionRepository.findById(id) : AccountTransaction.findById(id);

const findMany = async (options = {}) =>
  isConnected() ? accountTransactionRepository.findMany(options) : AccountTransaction.find(options.filter || {}).sort(options.sort || { date: -1 });

const updateById = async (id, updates) => {
  if (updates && updates.amount !== undefined) assertAmount(updates.amount);
  return isConnected()
    ? accountTransactionRepository.updateById(id, updates)
    : AccountTransaction.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  isConnected() ? accountTransactionRepository.count(filter) : AccountTransaction.countDocuments(filter);

const destroy = async (id) =>
  isConnected() ? accountTransactionRepository.destroy(id) : Boolean(await AccountTransaction.findByIdAndDelete(id));

module.exports = {
  getFinancialYear,
  validate,
  recordTransaction,
  findById,
  findMany,
  updateById,
  count,
  destroy,
  isConnected,
};