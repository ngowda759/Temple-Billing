const accountTransactionService = require("./accountTransactionService");

/**
 * Gets the financial year (e.g., "2026-2027") for a given date.
 * Financial year starts on April 1 and ends on March 31.
 */
const getFinancialYear = (date) => {
  const d = date ? new Date(date) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)

  if (month >= 3) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
};

/**
 * Centralized function to record an accounting transaction.
 * Implements idempotency checks to prevent duplicate entries.
 * 
 * @param {Object} payload 
 * @param {string} payload.transactionType - "Credit" or "Debit"
 * @param {string} payload.source - Source of transaction (e.g., "Pooja Booking")
 * @param {string} payload.category - Account Head name (e.g., "Pooja Income")
 * @param {number} payload.amount - Transaction amount
 * @param {Date} [payload.date] - Date of transaction (defaults to now)
 * @param {string} payload.paymentMethod - Payment method (e.g., "Cash", "UPI")
 * @param {string} payload.status - Status (e.g., "Completed")
 * @param {string} [payload.description] - Description or notes
 * @param {string} [payload.receiptNumber] - Receipt/Bill number
 * @param {string} [payload.invoiceNumber] - Invoice/PO number
 * @param {string} [payload.referenceId] - ObjectId of the source document
 * @param {string} [payload.referenceModel] - Name of the source model
 * @param {string} payload.cashierId - ObjectId of the cashier/user
 * @param {string} [payload.cashierName] - Name of the cashier
 * @param {string} payload.recordedBy - ObjectId of the user recording it
 */
const recordTransaction = async (payload) => {
  try {
    const { amount } = payload || {};

    if (!amount || amount <= 0) return null;

    return await accountTransactionService.recordTransaction(payload);
  } catch (error) {
    console.error("[Accounting Service] Failed to record transaction:", error);
    throw error;
  }
};

module.exports = {
  getFinancialYear,
  recordTransaction,
};
