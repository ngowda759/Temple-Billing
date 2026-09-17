const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const PayrollRecord = require("../models/PayrollRecord");
const payrollRepository = require("../repositories/payrollRepository");

// Mirrors the enums declared in backend/src/models/PayrollRecord.js exactly.
const STATUSES = new Set(["Pending", "Paid"]);
const PAYMENT_METHODS = new Set([
  "Bank Transfer", "UPI", "Cash", "Cheque", "Card", "Net Banking",
]);

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// Mirrors the `required: true` checks declared in
// backend/src/models/PayrollRecord.js.
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertMonthKey = (value, label = "monthKey") => {
  const text = assertId(value, label);
  if (!MONTH_PATTERN.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a YYYY-MM period key`);
  }
  return text;
};

// baseSalary / netSalary are `required: true`; every other numeric path is a
// bare Number with a default and no `min` beyond the schema's own, so only
// finiteness is checked and fractional values are preserved.
const assertRequiredNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  return num;
};

const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const assertDate = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Payroll path: PostgreSQL is used when the
// datasource seam is connected AND PostgreSQL is actually reachable. If either
// condition fails the existing Mongoose model handles the operation.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * Validates and normalizes payroll data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - employeeId / employeeName / monthKey / baseSalary / netSalary are required,
 *    and monthKey is the 'YYYY-MM' period key payEmployeePayroll already
 *    validates before writing.
 *  - The counter and money paths default to 0, status to 'Pending' and
 *    paymentMethod to 'Bank Transfer'.
 *  - employeeId is normalized to its string form so a Mongoose ObjectId and a
 *    24-hex string address the same row.
 *
 * The result is passed to the repository, which re-derives the same defaults
 * when building the row.
 */
const normalizePayroll = (data) => {
  if (!data) throw new Error("Payroll record data is required");
  assertId(data.employeeId, "employeeId");
  assertId(data.employeeName, "employeeName");
  assertMonthKey(data.monthKey);
  assertRequiredNumber(data.baseSalary, "baseSalary");
  assertRequiredNumber(data.netSalary, "netSalary");
  assertNumber(data.presentDays, "presentDays");
  assertNumber(data.absentDays, "absentDays");
  assertNumber(data.leaveDays, "leaveDays");
  assertNumber(data.halfDays, "halfDays");
  assertNumber(data.lateDays, "lateDays");
  assertNumber(data.extraDutyDays, "extraDutyDays");
  assertNumber(data.overtimeHours, "overtimeHours");
  assertNumber(data.deduction, "deduction");
  assertNumber(data.extraDutyPay, "extraDutyPay");
  assertNumber(data.bonus, "bonus");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertDate(data.paidAt, "paidAt");

  const normalized = { ...data };
  normalized.employeeId = String(data.employeeId).trim();
  normalized.employeeName = String(data.employeeName).trim();
  normalized.monthKey = String(data.monthKey).trim();
  return normalized;
};

const validate = (data) => {
  normalizePayroll(data);
};

// Mirrors PayrollRecord.create(payload) in payEmployeePayroll.
const create = async (data) => {
  const normalized = normalizePayroll(data);
  if (await usePostgres()) return payrollRepository.create(normalized);
  return PayrollRecord.create(normalized);
};

// Mirrors PayrollRecord.findById (verifyPayrollPayment's recordId lookup).
const findById = async (id) =>
  (await usePostgres()) ? payrollRepository.findById(id) : PayrollRecord.findById(id);

// Mirrors PayrollRecord.findOne({ employeeId, monthKey }) in payEmployeePayroll
// and PayrollRecord.findOne({ razorpayOrderId }) in verifyPayrollPayment.
const findOne = async (filter = {}) =>
  (await usePostgres()) ? payrollRepository.findOne(filter) : PayrollRecord.findOne(filter);

// Mirrors PayrollRecord.find({ monthKey }) in loadPayrollContext and
// PayrollRecord.find({ monthKey: { $in }, status: 'Paid' }) in the dashboard
// trend. The caller supplies the exact Mongo filter it needs; limit/offset
// preserve the existing pagination semantics.
const findMany = async (options = {}) => {
  if (await usePostgres()) return payrollRepository.findMany(options);
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  let q = PayrollRecord.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// A patch is a partial document: only the supplied fields are validated, using
// the same rules as a full create (a field that is present must still be valid).
// paidAt is the one field a patch legitimately clears — the controller writes
// null on the Razorpay branch — so an explicit null is accepted.
const normalizePayrollPatch = (updates) => {
  if (updates.employeeId !== undefined) assertId(updates.employeeId, "employeeId");
  if (updates.employeeName !== undefined) assertId(updates.employeeName, "employeeName");
  if (updates.monthKey !== undefined) assertMonthKey(updates.monthKey);
  if (updates.baseSalary !== undefined) assertRequiredNumber(updates.baseSalary, "baseSalary");
  if (updates.netSalary !== undefined) assertRequiredNumber(updates.netSalary, "netSalary");
  if (updates.status !== undefined) assertEnum(updates.status, STATUSES, "status");
  if (updates.paymentMethod !== undefined) assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertNumber(updates.presentDays, "presentDays");
  assertNumber(updates.absentDays, "absentDays");
  assertNumber(updates.leaveDays, "leaveDays");
  assertNumber(updates.halfDays, "halfDays");
  assertNumber(updates.lateDays, "lateDays");
  assertNumber(updates.extraDutyDays, "extraDutyDays");
  assertNumber(updates.overtimeHours, "overtimeHours");
  assertNumber(updates.deduction, "deduction");
  assertNumber(updates.extraDutyPay, "extraDutyPay");
  assertNumber(updates.bonus, "bonus");
  if (updates.paidAt !== null) assertDate(updates.paidAt, "paidAt");
};

// Patches only the supplied fields on whichever datasource is selected — the
// PostgreSQL equivalent of PayrollRecord.findByIdAndUpdate(id, payload,
// { new: true }) and of the loaded-document mutation + save() the controller
// performs after a Razorpay order is created or a payment is verified.
const updateById = async (id, updates) => {
  if (updates) {
    const withoutUndefined = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );
    if (Object.keys(withoutUndefined).length) normalizePayrollPatch(withoutUndefined);
  }
  if (await usePostgres()) return payrollRepository.updateById(id, updates);
  return PayrollRecord.findByIdAndUpdate(id, updates, { new: true });
};

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
};
