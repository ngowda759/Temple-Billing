const dbConfig = require("../config/db");
const { isPostgresConnected, runInTransaction } = require("../config/postgres");
const AccountTransaction = require("../models/AccountTransaction");
const accountTransactionRepository = require("../repositories/accountTransactionRepository");
const accountHeadRepository = require("../repositories/accountHeadRepository");
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

// The explicit PostgreSQL gate: PostgreSQL is used when the datasource seam is
// connected AND PostgreSQL is actually reachable. Reading the seam through the
// config module keeps it switchable at call time; the reachability check means
// an unreachable PostgreSQL can never break a transaction recording nor leave
// partial accounting state — the Mongoose model takes over instead.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

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
 * Ensures the account head exists using the SAME PostgreSQL client as the
 * transaction insert, so both statements commit or roll back together. A
 * concurrent auto-create that loses the account_heads_name_key race aborts the
 * unit of work rather than leaving a head without its transaction.
 */
const ensureAccountHeadInTx = async (client, { category, transactionType, recordedBy }) => {
  const existing = await accountHeadRepository.findByName(category, client);
  if (existing) return existing;
  return accountHeadRepository.create({
    name: category,
    type: transactionType === "Credit" ? "Income" : "Expense",
    description: `Auto-generated head for ${category}`,
    isActive: true,
    createdBy: recordedBy,
  }, client);
};

/**
 * Records a transaction, mirroring accountingService.recordTransaction semantics:
 * idempotency check on (referenceId, referenceModel, category), auto-creation of
 * missing account heads, and derived financial year. Calls the PostgreSQL
 * repository when PostgreSQL is selected and reachable and falls back to the
 * Mongo model otherwise.
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

  const pg = await usePostgres();

  if (referenceId && referenceModel && category) {
    const existing = pg
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

  if (!pg) {
    if (category) {
      await ensureAccountHead({ category, transactionType, recordedBy });
    }
    return AccountTransaction.create(transactionData);
  }

  // One PostgreSQL transaction: the account-head write and the ledger write
  // share a single client, so a failure in either leaves no partial accounting
  // state.
  return runInTransaction(async (client) => {
    if (category) {
      await ensureAccountHeadInTx(client, { category, transactionType, recordedBy });
    }
    return accountTransactionRepository.create(transactionData, client);
  });
};

const findById = async (id) =>
  (await usePostgres()) ? accountTransactionRepository.findById(id) : AccountTransaction.findById(id);

const findMany = async (options = {}) =>
  (await usePostgres()) ? accountTransactionRepository.findMany(options) : AccountTransaction.find(options.filter || {}).sort(options.sort || { date: -1 });

const updateById = async (id, updates) => {
  if (updates && updates.amount !== undefined) assertAmount(updates.amount);
  return (await usePostgres())
    ? accountTransactionRepository.updateById(id, updates)
    : AccountTransaction.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? accountTransactionRepository.count(filter) : AccountTransaction.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? accountTransactionRepository.destroy(id) : Boolean(await AccountTransaction.findByIdAndDelete(id));

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
  usePostgres,
};