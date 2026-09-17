const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const PayrollRecord = require("../models/PayrollRecord");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the two enums declared in backend/src/models/PayrollRecord.js exactly.
const STATUSES = new Set(["Pending", "Paid"]);
const PAYMENT_METHODS = new Set([
  "Bank Transfer", "UPI", "Cash", "Cheque", "Card", "Net Banking",
]);

// The payroll period. payEmployeePayroll rejects anything that is not
// 'YYYY-MM' with a 400 before it reaches a datasource, and every reader treats
// the value as text, so the shape is validated here too.
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
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

// baseSalary / netSalary are `required: true`, so a missing value is rejected
// exactly as Mongo rejects it. The rest are bare Numbers with a default and no
// `min` beyond the schema's own, so only finiteness is checked and fractional
// values are preserved — the NUMERIC columns and the >= 0 CHECK constraints
// carry the schema's `min: 0`.
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

// paidAt is the only Date path and the schema explicitly defaults it to null.
const toDateOrNull = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

// Every defaulted String column is NOT NULL and no write path stores null on
// one, so an absent value falls back to the schema's own default. This keeps
// the columns honest without changing any value the application can produce.
const textOrDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === "" ? fallback : text;
};

// razorpayOrderId / razorpayPaymentId / razorpaySignature are Optional Strings
// with NO default in the schema, so an absent field stays absent (undefined)
// rather than becoming '' — exactly what a Mongoose document reports.
const textOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

const numberOrDefault = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return Number(value);
};

const PAYROLL_COLS = [
  "id", "employee_id", "employee_name", "department", "role", "month_key",
  "base_salary", "present_days", "absent_days", "leave_days", "half_days",
  "late_days", "extra_duty_days", "overtime_hours", "deduction",
  "extra_duty_pay", "bonus", "net_salary", "status", "payment_method",
  "transaction_id", "paid_at", "paid_by", "notes", "razorpay_order_id",
  "razorpay_payment_id", "razorpay_signature", "created_at", "updated_at",
];

// NUMERIC comes back as a string from pg; every money/counter field is returned
// as a Number so the controller's arithmetic and comparisons behave the same as
// they do on a Mongoose document.
const toNumber = (value) =>
  value === null || value === undefined ? value : Number(value);

// Converts a payroll_records row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). paid_at keeps its null default and the three
// razorpay columns come back as undefined when unset, matching the schema.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    department: row.department,
    role: row.role,
    monthKey: row.month_key,
    baseSalary: toNumber(row.base_salary),
    presentDays: toNumber(row.present_days),
    absentDays: toNumber(row.absent_days),
    leaveDays: toNumber(row.leave_days),
    halfDays: toNumber(row.half_days),
    lateDays: toNumber(row.late_days),
    extraDutyDays: toNumber(row.extra_duty_days),
    overtimeHours: toNumber(row.overtime_hours),
    deduction: toNumber(row.deduction),
    extraDutyPay: toNumber(row.extra_duty_pay),
    bonus: toNumber(row.bonus),
    netSalary: toNumber(row.net_salary),
    status: row.status,
    paymentMethod: row.payment_method,
    transactionId: row.transaction_id,
    paidAt: row.paid_at || null,
    paidBy: row.paid_by,
    notes: row.notes,
    razorpayOrderId: row.razorpay_order_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id || undefined,
    razorpaySignature: row.razorpay_signature || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  employee_id: assertId(data.employeeId, "employeeId"),
  employee_name: assertId(data.employeeName, "employeeName"),
  department: textOrDefault(data.department, ""),
  role: textOrDefault(data.role, ""),
  month_key: assertMonthKey(data.monthKey),
  base_salary: assertRequiredNumber(data.baseSalary, "baseSalary"),
  present_days: numberOrDefault(data.presentDays, 0),
  absent_days: numberOrDefault(data.absentDays, 0),
  leave_days: numberOrDefault(data.leaveDays, 0),
  half_days: numberOrDefault(data.halfDays, 0),
  late_days: numberOrDefault(data.lateDays, 0),
  extra_duty_days: numberOrDefault(data.extraDutyDays, 0),
  overtime_hours: numberOrDefault(data.overtimeHours, 0),
  deduction: numberOrDefault(data.deduction, 0),
  extra_duty_pay: numberOrDefault(data.extraDutyPay, 0),
  bonus: numberOrDefault(data.bonus, 0),
  net_salary: assertRequiredNumber(data.netSalary, "netSalary"),
  status: textOrDefault(data.status, "Pending"),
  payment_method: textOrDefault(data.paymentMethod, "Bank Transfer"),
  transaction_id: textOrDefault(data.transactionId, ""),
  paid_at: toDateOrNull(data.paidAt, "paidAt"),
  paid_by: textOrDefault(data.paidBy, ""),
  notes: textOrDefault(data.notes, ""),
  razorpay_order_id: textOrNull(data.razorpayOrderId),
  razorpay_payment_id: textOrNull(data.razorpayPaymentId),
  razorpay_signature: textOrNull(data.razorpaySignature),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The model
// declares no standing order and the controller never passes a sort, so
// `created_at DESC` is the default.
const SORT_COLUMNS = {
  employeeId: "employee_id",
  employeeName: "employee_name",
  monthKey: "month_key",
  baseSalary: "base_salary",
  netSalary: "net_salary",
  status: "status",
  paymentMethod: "payment_method",
  paidAt: "paid_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "created_at DESC";

// Resolves a Mongo sort object/key into a whitelisted ORDER BY clause. Every key
// is whitelisted (unknown keys are dropped) and the original direction is
// preserved, so a multi-key sort keeps its exact Mongo tie-breaking.
const resolveOrderBy = (sort) => {
  const entries = typeof sort === "string" ? [[sort, 1]] : Object.entries(sort || {});
  const parts = [];
  for (const [key, direction] of entries) {
    const col = SORT_COLUMNS[key];
    if (!col) continue;
    const dir = direction === "DESC" || Number(direction) === -1
      ? "DESC"
      : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
    if (!dir) continue;
    parts.push(`${col} ${dir}`);
  }
  return parts.length ? parts.join(", ") : DEFAULT_ORDER;
};

const pushCond = (conditions, values, col, op, value) => {
  conditions.push(`${col} ${op} $${values.length + 1}`);
  values.push(value);
};

const pushIn = (conditions, values, col, list) => {
  const vals = (Array.isArray(list) ? list : [list])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));
  if (vals.length) {
    conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
    values.push(...vals);
  } else {
    // Mongo $in: [] matches no documents (it is an instant-false predicate).
    conditions.push("1 = 0");
  }
};

// Applies a Mongo comparison operator object ({ $in/$ne/$gte/$gt/$lte/$lt }) to
// a column, or an exact equality for a plain value, or IS NULL for an explicit
// null. `dateCol` marks paid_at, the only real instant.
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      pushIn(conditions, values, col, input.$in);
      return;
    }
    if (input.$ne !== undefined) {
      if (input.$ne === null) {
        conditions.push(`${col} IS NOT NULL`);
      } else {
        pushCond(conditions, values, col, "<>", dateCol ? new Date(input.$ne) : input.$ne);
      }
      return;
    }
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  }
};

// Supports the filter surface the application actually uses against
// PayrollRecord:
//   * { id } / { id: { $in: [...] } }
//   * { employeeId } — equality or $in. The controller passes the Mongoose
//     ObjectId straight through (findOne({ employeeId: employee._id, monthKey })),
//     so the value is stringified before comparison to match the TEXT column.
//   * { monthKey } — equality or $in. month_key is TEXT and the application
//     compares it lexicographically, so no casting is introduced.
//   * { status } — equality, $in or $ne, validated against the schema enum.
//   * { paymentMethod } — equality, $in or $ne, validated against the enum.
//   * { razorpayOrderId } — the verify-payment fallback lookup.
//   * { paidAt } / { createdAt } / { updatedAt } range filters.
// Every value is bound as a parameter; nothing is interpolated.
const buildPayrollFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  // employeeId may arrive as an ObjectId, a 24-hex string or an array of either.
  if (filter.employeeId !== undefined) {
    if (
      filter.employeeId &&
      typeof filter.employeeId === "object" &&
      !Array.isArray(filter.employeeId) &&
      filter.employeeId.$in !== undefined
    ) {
      pushIn(conditions, values, "employee_id", filter.employeeId.$in);
    } else if (filter.employeeId === null) {
      conditions.push("employee_id IS NULL");
    } else {
      pushCond(conditions, values, "employee_id", "=", String(filter.employeeId).trim());
    }
  }

  if (filter.monthKey !== undefined) pushComparison(conditions, values, "month_key", filter.monthKey);

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    for (const item of filter.status.$in) assertEnum(item, STATUSES, "status");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status && typeof filter.status === "object" && !Array.isArray(filter.status)) {
    if (filter.status.$ne !== undefined) assertEnum(filter.status.$ne, STATUSES, "status");
    pushComparison(conditions, values, "status", filter.status);
  } else if (filter.status !== undefined && filter.status !== null) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.paymentMethod === "object" && !Array.isArray(filter.paymentMethod) && filter.paymentMethod.$in) {
    for (const item of filter.paymentMethod.$in) assertEnum(item, PAYMENT_METHODS, "paymentMethod");
    pushIn(conditions, values, "payment_method", filter.paymentMethod.$in);
  } else if (filter.paymentMethod !== undefined) {
    if (filter.paymentMethod && typeof filter.paymentMethod === "object" && !Array.isArray(filter.paymentMethod)) {
      if (filter.paymentMethod.$ne !== undefined) {
        assertEnum(filter.paymentMethod.$ne, PAYMENT_METHODS, "paymentMethod");
      }
    } else {
      assertEnum(filter.paymentMethod, PAYMENT_METHODS, "paymentMethod");
    }
    pushComparison(conditions, values, "payment_method", filter.paymentMethod);
  }

  if (filter.razorpayOrderId !== undefined) {
    pushComparison(conditions, values, "razorpay_order_id", filter.razorpayOrderId);
  }

  pushComparison(conditions, values, "paid_at", filter.paidAt, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const validate = (data) => {
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
  toDateOrNull(data.paidAt, "paidAt");
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return PayrollRecord.findById(String(id));
  const { rows } = await query(
    `SELECT ${PAYROLL_COLS.join(", ")} FROM payroll_records WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// The single-document lookup used by payEmployeePayroll
// (findOne({ employeeId, monthKey })) and by verifyPayrollPayment's fallback
// (findOne({ razorpayOrderId })).
const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return PayrollRecord.findOne(filter);
  const { where, values } = buildPayrollFilter(filter);
  const { rows } = await query(
    `SELECT ${PAYROLL_COLS.join(", ")} FROM payroll_records ${where} ORDER BY ${DEFAULT_ORDER}, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = PayrollRecord.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildPayrollFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${PAYROLL_COLS.join(", ")} FROM payroll_records ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  validate(data);
  if (!dbConfig.isDbConnected()) return PayrollRecord.create(data);
  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO payroll_records (${PAYROLL_COLS.join(", ")})
     VALUES (${PAYROLL_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
    PAYROLL_COLS.map((col) => row[col])
  );
  return findById(id);
};

// Patches only the supplied fields, on whichever datasource is selected — the
// PostgreSQL equivalent of PayrollRecord.findByIdAndUpdate(id, payload,
// { new: true }) and of the loaded-document mutation + save() the controller
// performs on the Razorpay branches. `undefined` leaves a column untouched and
// an explicit null clears a nullable column (paid_at, or one of the three
// razorpay columns).
const updateById = async (id, updates) => {
  if (updates) {
    if (updates.employeeId !== undefined) assertId(updates.employeeId, "employeeId");
    if (updates.employeeName !== undefined) assertId(updates.employeeName, "employeeName");
    if (updates.monthKey !== undefined) assertMonthKey(updates.monthKey);
    if (updates.baseSalary !== undefined) assertRequiredNumber(updates.baseSalary, "baseSalary");
    if (updates.netSalary !== undefined) assertRequiredNumber(updates.netSalary, "netSalary");
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
    if (updates.status !== undefined) assertEnum(updates.status, STATUSES, "status");
    if (updates.paymentMethod !== undefined) assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  }
  if (!dbConfig.isDbConnected()) {
    return PayrollRecord.findByIdAndUpdate(id, updates, { new: true });
  }

  const assignments = [];
  const values = [];
  const apply = (col, value) => {
    values.push(value);
    assignments.push(`${col} = $${values.length}`);
  };
  const applyRequiredText = (col, value, label) => apply(col, assertId(value, label));
  const applyText = (col, value, fallback) => apply(col, textOrDefault(value, fallback));
  const applyNumber = (col, value, fallback) => apply(col, numberOrDefault(value, fallback));
  const applyNullableText = (col, value) => apply(col, textOrNull(value));

  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    switch (key) {
      case "employeeId": applyRequiredText("employee_id", value, "employeeId"); break;
      case "employeeName": applyRequiredText("employee_name", value, "employeeName"); break;
      case "department": applyText("department", value, ""); break;
      case "role": applyText("role", value, ""); break;
      case "monthKey": apply("month_key", assertMonthKey(value)); break;
      case "baseSalary": apply("base_salary", assertRequiredNumber(value, "baseSalary")); break;
      case "presentDays": applyNumber("present_days", value, 0); break;
      case "absentDays": applyNumber("absent_days", value, 0); break;
      case "leaveDays": applyNumber("leave_days", value, 0); break;
      case "halfDays": applyNumber("half_days", value, 0); break;
      case "lateDays": applyNumber("late_days", value, 0); break;
      case "extraDutyDays": applyNumber("extra_duty_days", value, 0); break;
      case "overtimeHours": applyNumber("overtime_hours", value, 0); break;
      case "deduction": applyNumber("deduction", value, 0); break;
      case "extraDutyPay": applyNumber("extra_duty_pay", value, 0); break;
      case "bonus": applyNumber("bonus", value, 0); break;
      case "netSalary": apply("net_salary", assertRequiredNumber(value, "netSalary")); break;
      case "status": apply("status", value === null ? "Pending" : value); break;
      case "paymentMethod": apply("payment_method", value === null ? "Bank Transfer" : value); break;
      case "transactionId": applyText("transaction_id", value, ""); break;
      case "paidAt": apply("paid_at", toDateOrNull(value, "paidAt")); break;
      case "paidBy": applyText("paid_by", value, ""); break;
      case "notes": applyText("notes", value, ""); break;
      case "razorpayOrderId": applyNullableText("razorpay_order_id", value); break;
      case "razorpayPaymentId": applyNullableText("razorpay_payment_id", value); break;
      case "razorpaySignature": applyNullableText("razorpay_signature", value); break;
      default: break;
    }
  }

  if (!assignments.length) return findById(id);

  assignments.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE payroll_records SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  validate,
  STATUSES,
  PAYMENT_METHODS,
};
