-- Phase 2V: payroll records (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/PayrollRecord.js and every real usage of the
-- PayrollRecord model:
--   * PayrollRecord.js — the Mongoose model: employeeId (ObjectId, ref
--     'Employee', required, index), employeeName (String, required, trim),
--     department (String, trim, default ''), role (String, trim, default ''),
--     monthKey (String, required, trim, index), baseSalary (Number, required,
--     min 0), presentDays / absentDays / leaveDays / halfDays / lateDays /
--     extraDutyDays / overtimeHours (Number, default 0, min 0), deduction /
--     extraDutyPay / bonus (Number, default 0, min 0), netSalary (Number,
--     required, min 0), status (String enum ['Pending', 'Paid'], default
--     'Pending'), paymentMethod (String enum ['Bank Transfer', 'UPI', 'Cash',
--     'Cheque', 'Card', 'Net Banking'], default 'Bank Transfer'), transactionId
--     (String, trim, default ''), paidAt (Date, default null), paidBy (String,
--     trim, default ''), notes (String, trim, default ''), razorpayOrderId /
--     razorpayPaymentId / razorpaySignature (String, trim, NO default),
--     timestamps. There are NO virtuals and NO embedded sub-documents.
--     The schema declares THREE indexes — { employeeId: 1 } and { monthKey: 1 }
--     from `index: true`, plus the compound UNIQUE index
--     `{ employeeId: 1, monthKey: 1 }` with `{ unique: true }`.
--   * payrollController.js — the only writer and reader of the collection.
--       loadPayrollContext (the shared helper behind getPayrollDashboard and
--       getPerformanceDashboard) reads
--       PayrollRecord.find({ monthKey: monthRange.monthKey }) and keys the
--       results by String(record.employeeId) — String, not ObjectId.
--       getPayrollDashboard additionally reads
--       PayrollRecord.find({ monthKey: { $in: [...6 month keys] },
--       status: 'Paid' }) for the six-month trend.
--       payEmployeePayroll (POST /api/payroll/:employeeId/pay) reads
--       PayrollRecord.findOne({ employeeId: employee._id, monthKey }) and then
--       either PayrollRecord.findByIdAndUpdate(existingRecord._id, payload,
--       { new: true }) or PayrollRecord.create(payload). On the Razorpay branch
--       it mutates the loaded document (record.razorpayOrderId = order.id) and
--       calls record.save().
--       verifyPayrollPayment (POST /api/payroll/verify-payment) reads
--       PayrollRecord.findById(recordId), falls back to
--       PayrollRecord.findOne({ razorpayOrderId }), then mutates the loaded
--       document (status / transactionId / razorpayPaymentId /
--       razorpaySignature / paidAt) and calls record.save().
--       There is NO delete path, NO listing endpoint, NO approval step and NO
--       payslip generation anywhere in the repository.
--   * frontend/src/services/payrollService.js + frontend/src/pages/admin/
--     employee/Payroll.jsx consume GET /api/payroll/dashboard,
--     POST /api/payroll/:employeeId/pay, POST /api/payroll/verify-payment and
--     GET /api/payroll/performance, and read only the fields below.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by payrollRepository, reachable through payrollService) that is
-- selected only when the service is used AND PostgreSQL is reachable. MongoDB
-- stays the source of truth and the fallback path; no Mongo → PostgreSQL switch
-- happens anywhere in the application and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — payroll_records (every persisted Mongo
-- field):
--   * _id               → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * employeeId        → employee_id TEXT NOT NULL (required; the Employee
--                         ObjectId as its 24-hex string — deliberately NO FK,
--                         see the identity note)
--   * employeeName      → employee_name TEXT NOT NULL (required, trim; a
--                         historical snapshot, not a live reference)
--   * department        → department TEXT NOT NULL DEFAULT '' (trim)
--   * role              → role TEXT NOT NULL DEFAULT '' (trim; free text — the
--                         Employee role enum is NOT reproduced here because
--                         PayrollRecord.role declares no enum of its own)
--   * monthKey          → month_key TEXT NOT NULL (required, trim; the payroll
--                         period — see the period note)
--   * baseSalary        → base_salary NUMERIC NOT NULL (money, min 0)
--   * presentDays       → present_days NUMERIC NOT NULL DEFAULT 0 (min 0)
--   * absentDays        → absent_days NUMERIC NOT NULL DEFAULT 0 (min 0)
--   * leaveDays         → leave_days NUMERIC NOT NULL DEFAULT 0 (min 0)
--   * halfDays          → half_days NUMERIC NOT NULL DEFAULT 0 (min 0)
--   * lateDays          → late_days NUMERIC NOT NULL DEFAULT 0 (min 0)
--   * extraDutyDays     → extra_duty_days NUMERIC NOT NULL DEFAULT 0 (min 0)
--   * overtimeHours     → overtime_hours NUMERIC NOT NULL DEFAULT 0 (min 0; a
--                         FRACTIONAL value — the controller writes
--                         Number(overtimeHours.toFixed(1)), e.g. 3.5, so this
--                         must not be an integer column)
--   * deduction         → deduction NUMERIC NOT NULL DEFAULT 0 (money, min 0)
--   * extraDutyPay      → extra_duty_pay NUMERIC NOT NULL DEFAULT 0 (money)
--   * bonus             → bonus NUMERIC NOT NULL DEFAULT 0 (money)
--   * netSalary         → net_salary NUMERIC NOT NULL (money, min 0)
--   * status            → status TEXT NOT NULL DEFAULT 'Pending' (2-value enum)
--   * paymentMethod     → payment_method TEXT NOT NULL DEFAULT 'Bank Transfer'
--                         (6-value enum)
--   * transactionId     → transaction_id TEXT NOT NULL DEFAULT '' (trim)
--   * paidAt            → paid_at TIMESTAMPTZ (nullable; the schema explicitly
--                         defaults it to null and the Razorpay branch writes
--                         null back)
--   * paidBy            → paid_by TEXT NOT NULL DEFAULT '' (trim)
--   * notes             → notes TEXT NOT NULL DEFAULT '' (trim)
--   * razorpayOrderId   → razorpay_order_id TEXT (nullable; the schema declares
--                         NO default, so the field is absent until the Razorpay
--                         branch sets it — mirrors bills/donations/bookings)
--   * razorpayPaymentId → razorpay_payment_id TEXT (nullable, same reasoning)
--   * razorpaySignature → razorpay_signature TEXT (nullable, same reasoning)
--   * createdAt         → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt         → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 29 columns (id + the 26 schema fields + the two timestamps). The model has no
-- allowances[], no deductions[] breakdown, no bonuses[], no overtimeEntries[],
-- no tax/statutory component, no attendance or leave summary object, no
-- payment-details subdocument, no payPeriod start/end date pair, no approvedBy,
-- no approvedAt, no processedAt, no payslip URL and no reversal/cancellation
-- fields. Those concepts appear on other entities but not on PayrollRecord, so
-- they are deliberately NOT columns and no child table is created.
--
-- Money and precision — the critical decision in this migration. Payroll is a
-- financial domain, so every monetary column (base_salary, deduction,
-- extra_duty_pay, bonus, net_salary) is NUMERIC and NEVER float/real/double
-- precision, which could not round-trip rupee values exactly. The project
-- convention (Phases 2A–2U) is a bare NUMERIC with no explicit precision/scale;
-- that is used here too so nothing is silently rounded or truncated, and the
-- exact value the application writes is the exact value PostgreSQL returns.
-- The non-monetary counters (present_days, absent_days, leave_days, half_days,
-- late_days, extra_duty_days, overtime_hours) are NUMERIC as well because Mongo
-- declares them as bare Numbers with no integer cast and overtime_hours
-- genuinely holds fractional values; narrowing them would make PostgreSQL
-- stricter than the source of truth.
--
-- The existing rounding behavior is preserved untouched: the controller rounds
-- with roundMoney = Math.round(Number(v || 0)) (whole rupees) BEFORE persisting,
-- so PostgreSQL simply stores the already-rounded value. No rounding, rescaling
-- or re-derivation is introduced by this migration, and no payroll formula is
-- moved into SQL.
--
-- Stored vs derived: baseSalary, employeeName, department and role are stored
-- snapshots; the day counters, overtimeHours, deduction, extraDutyPay, bonus
-- and netSalary are computed by payrollController and then persisted by
-- payEmployeePayroll, so they are real columns. Everything else the API returns
-- — monthlyPayroll, pendingSalary, paidEmployees, bonusDistribution,
-- departmentBreakdown, the six-month trend, upcomingPayments, the performance
-- scores/rating/labels, joiningDate and payrollId — is derived in JavaScript at
-- read time, is never persisted on the document and therefore gets no column.
--
-- Payroll period semantics: the period is monthKey, the 'YYYY-MM' string the
-- controller validates with /^\d{4}-\d{2}$/ and slices out of a UTC date key.
-- There is NO startDate/endDate pair and no separate payrollPeriod field —
-- getMonthRange derives the calendar bounds in memory from the month key.
-- month_key therefore stays TEXT so the stored value round-trips byte-for-byte
-- and the application's lexicographic monthKey comparisons and $in membership
-- behave exactly as they do against Mongo Strings. The shape is pinned by a
-- CHECK so the text contract every read path already assumes stays enforced;
-- it does not narrow any value the application can produce, because
-- payEmployeePayroll already rejects anything that is not 'YYYY-MM' with a 400.
--
-- Uniqueness — the business key. The schema declares
-- `index({ employeeId: 1, monthKey: 1 }, { unique: true })`: at most ONE payroll
-- record per employee per month. That is reproduced exactly as
-- UNIQUE (employee_id, month_key). The write path reinforces it by reading
-- findOne({ employeeId, monthKey }) first and updating the existing record
-- instead of inserting a second one, so the constraint is the same backstop on
-- both datasources and no new behavior is introduced. Because the values are
-- text-normalized (employeeId trimmed and stringified) before comparison,
-- PostgreSQL's byte-equality matches Mongo's trimmed-field equality for the
-- values the application actually writes.
--
-- Identity note — why there is NO foreign key on employee_id.
-- PayrollRecord.employeeId is a real `ref: 'Employee'` ObjectId and the
-- `employees` table does exist (Phase 2A), so an FK is superficially
-- attractive. It is deliberately NOT declared, for two reasons:
--   1. The live employee-creation paths (employeeController.createEmployee and
--      employeeManagementController.createEmployee) write with
--      `Employee.create(...)` directly and never touch PostgreSQL — the only
--      code that populates the employees table is
--      userEmployeeService.createEmployeeRecord, and nothing in src/ calls it.
--      A payroll row's employee row is therefore routinely absent from
--      PostgreSQL, and an FK would reject writes that MongoDB accepts.
--   2. This mirrors the Phase 2S (attendance) and Phase 2T (leaves) decisions
--      for the same identifier space: no fake FKs to entities whose PostgreSQL
--      table is not yet populated by the write path.
-- The column stays an indexed TEXT holding the ObjectId-shaped value, which
-- keeps it comparable with employees.id once that domain is actually backfilled
-- and cut over.
--
-- Foreign keys: NONE, deliberately (see the identity note). Nothing else on the
-- model is a reference: monthKey is a period label, employeeName / department /
-- role are snapshots, transactionId and the three razorpay fields are opaque
-- external strings, and the account_transactions.referenceModel = 'PayrollRecord'
-- link is a loose polymorphic string on the accounting side (accounting is a
-- separate migrated domain and account_transactions.reference_id is plain TEXT
-- by design). Because there are no foreign keys there is no ON DELETE behavior
-- to document, and deleting a payroll row never cascades into, blocks, or
-- mutates any other table. That mirrors MongoDB exactly.
--
-- Nullability honesty: employee_id / employee_name / month_key / base_salary /
-- net_salary are NOT NULL because the schema marks them `required: true` and
-- every real write supplies them. Every other String/Boolean/Number column is
-- NOT NULL with the schema's own default, because Mongoose applies those
-- defaults on every insert — a document written without department / status /
-- deduction / ... is stored with ''/'Pending'/0, so a PostgreSQL row created
-- without them is identical. paid_at stays nullable because the schema
-- explicitly defaults it to null and the Razorpay branch writes null back.
-- razorpay_order_id / razorpay_payment_id / razorpay_signature stay nullable
-- because the schema declares no default for them at all, so the fields are
-- genuinely absent on a record created outside the Razorpay flow.
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * payroll_records_employee_id_month_key_key — the UNIQUE constraint
--     replicating Mongo's compound unique index. It is also the access path for
--     payEmployeePayroll's findOne({ employeeId, monthKey }) and already serves
--     the leading-employeeId equality that the model's separate `employeeId`
--     index covered, so no separate single-column index on employee_id is
--     added.
--   * idx_payroll_records_month_key — the non-unique { monthKey }
--     index. loadPayrollContext reads the whole month with
--     find({ monthKey: monthRange.monthKey }); a status-leading composite index
--     cannot serve that equality.
--   * idx_payroll_records_status_month_key — getPayrollDashboard's six-month
--     trend: find({ monthKey: { $in: [...] }, status: 'Paid' }).
--   * idx_payroll_records_razorpay_order_id — verifyPayrollPayment's
--     findOne({ razorpayOrderId }). Mirrors idx_bills_…/idx_donations_…/
--     idx_bookings_razorpay_order_id.
--   * idx_payroll_records_created_at — the standing created_at DESC ordering
--     used when records are listed.
-- No index is added for department / role / payment_method / status alone:
-- no server-side query filters or sorts on them (the dashboard aggregates them
-- in JavaScript after loading the month).

CREATE TABLE IF NOT EXISTS payroll_records (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: employeeId ObjectId ref 'Employee' — required. The Mongo ObjectId as
  -- its 24-hex string; deliberately NO foreign key (see the identity note).
  employee_id TEXT NOT NULL,
  -- Mongo: employeeName String — required, trim. Historical snapshot.
  employee_name TEXT NOT NULL,
  -- Mongo: department String — default '', trim.
  department TEXT NOT NULL DEFAULT '',
  -- Mongo: role String — default '', trim. Free text; PayrollRecord declares no
  -- role enum, so no CHECK is invented.
  role TEXT NOT NULL DEFAULT '',
  -- Mongo: monthKey String — required, trim. The payroll period ('YYYY-MM'),
  -- kept TEXT so lexicographic comparisons and $in membership are preserved
  -- exactly (see the period note).
  month_key TEXT NOT NULL,
  -- Mongo: baseSalary Number — required, min 0. NUMERIC (money), never float.
  base_salary NUMERIC NOT NULL,
  -- Mongo: presentDays Number — default 0, min 0.
  present_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: absentDays Number — default 0, min 0.
  absent_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: leaveDays Number — default 0, min 0.
  leave_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: halfDays Number — default 0, min 0.
  half_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: lateDays Number — default 0, min 0.
  late_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: extraDutyDays Number — default 0, min 0.
  extra_duty_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: overtimeHours Number — default 0, min 0. Fractional in practice
  -- (the controller writes Number(x.toFixed(1))), so NUMERIC, not integer.
  overtime_hours NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: deduction Number — default 0, min 0. NUMERIC (money).
  deduction NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: extraDutyPay Number — default 0, min 0. NUMERIC (money).
  extra_duty_pay NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: bonus Number — default 0, min 0. NUMERIC (money).
  bonus NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: netSalary Number — required, min 0. NUMERIC (money), never float.
  net_salary NUMERIC NOT NULL,
  -- Mongo: status String — enum, default 'Pending'.
  status TEXT NOT NULL DEFAULT 'Pending',
  -- Mongo: paymentMethod String — enum, default 'Bank Transfer'.
  payment_method TEXT NOT NULL DEFAULT 'Bank Transfer',
  -- Mongo: transactionId String — default '', trim.
  transaction_id TEXT NOT NULL DEFAULT '',
  -- Mongo: paidAt Date — default null. The only nullable real instant.
  paid_at TIMESTAMPTZ,
  -- Mongo: paidBy String — default '', trim.
  paid_by TEXT NOT NULL DEFAULT '',
  -- Mongo: notes String — default '', trim.
  notes TEXT NOT NULL DEFAULT '',
  -- Mongo: razorpayOrderId String — trim, NO default in the schema, so the
  -- field is absent until the Razorpay branch sets it → nullable.
  razorpay_order_id TEXT,
  -- Mongo: razorpayPaymentId String — trim, no default → nullable.
  razorpay_payment_id TEXT,
  -- Mongo: razorpaySignature String — trim, no default → nullable.
  razorpay_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's { employeeId, monthKey } unique: true index:
  -- one payroll record per employee per month.
  CONSTRAINT payroll_records_employee_id_month_key_key UNIQUE (employee_id, month_key),
  -- Mirrors the Mongo schema's status enum exactly (no value added/renamed).
  CONSTRAINT payroll_records_status_check CHECK (status IN ('Pending', 'Paid')),
  -- Mirrors the Mongo schema's paymentMethod enum exactly.
  CONSTRAINT payroll_records_payment_method_check CHECK (payment_method IN (
    'Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Net Banking'
  )),
  -- Mirrors the Mongo schema's `min: 0` on each numeric path. These reproduce
  -- what Mongoose already rejects, so no value the application can currently
  -- persist is narrowed: the deduction formula is a sum of non-negative terms
  -- and the controller's own inputs are validated/enum-bound.
  CONSTRAINT payroll_records_base_salary_check CHECK (base_salary >= 0),
  CONSTRAINT payroll_records_net_salary_check CHECK (net_salary >= 0),
  CONSTRAINT payroll_records_present_days_check CHECK (present_days >= 0),
  CONSTRAINT payroll_records_absent_days_check CHECK (absent_days >= 0),
  CONSTRAINT payroll_records_leave_days_check CHECK (leave_days >= 0),
  CONSTRAINT payroll_records_half_days_check CHECK (half_days >= 0),
  CONSTRAINT payroll_records_late_days_check CHECK (late_days >= 0),
  CONSTRAINT payroll_records_extra_duty_days_check CHECK (extra_duty_days >= 0),
  CONSTRAINT payroll_records_overtime_hours_check CHECK (overtime_hours >= 0),
  CONSTRAINT payroll_records_deduction_check CHECK (deduction >= 0),
  CONSTRAINT payroll_records_extra_duty_pay_check CHECK (extra_duty_pay >= 0),
  CONSTRAINT payroll_records_bonus_check CHECK (bonus >= 0),
  -- The month key is a timezone-free 'YYYY-MM' period label on every write path
  -- (payEmployeePayroll rejects anything else with a 400 before touching the
  -- database) and every reader treats it as text. Pinning the shape keeps the
  -- text contract enforced without narrowing any producible value.
  CONSTRAINT payroll_records_month_key_check CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);

-- payEmployeePayroll's findOne({ employeeId, monthKey }) and the monthly scan
-- with an employee filter. The UNIQUE constraint above already provides the
-- index that serves this, so no separate employee_id index is created.
-- The non-unique Mongo { monthKey } index serving
-- find({ monthKey: monthRange.monthKey }) in loadPayrollContext.
CREATE INDEX IF NOT EXISTS idx_payroll_records_month_key ON payroll_records (month_key);

-- getPayrollDashboard's six-month trend:
-- find({ monthKey: { $in: [...] }, status: 'Paid' }).
CREATE INDEX IF NOT EXISTS idx_payroll_records_status_month_key
  ON payroll_records (status, month_key);

-- verifyPayrollPayment falls back to findOne({ razorpayOrderId }).
CREATE INDEX IF NOT EXISTS idx_payroll_records_razorpay_order_id
  ON payroll_records (razorpay_order_id);

-- The standing created_at DESC ordering for listing payroll records.
CREATE INDEX IF NOT EXISTS idx_payroll_records_created_at
  ON payroll_records (created_at DESC);
