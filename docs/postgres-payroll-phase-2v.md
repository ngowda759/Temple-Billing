# Phase 2V — PostgreSQL Payroll

Incremental, additive migration of the MongoDB **PayrollRecord** domain to
PostgreSQL, following the architecture established in Phases 2A–2U.

There is exactly **one** live Payroll entity in the repository —
`backend/src/models/PayrollRecord.js` (registered as the `PayrollRecord`
Mongoose model). It is the source of truth for this phase. There is no
`Salary`, `SalaryStructure`, `Payslip`, `PayrollPeriod` or `PayrollComponent`
model, and no embedded salary-component arrays.

## Scope

Only the Payroll domain is migrated in this phase:

- `backend/src/db/migrations/023_create_payroll_records.sql`
- `backend/src/repositories/payrollRepository.js`
- `backend/src/services/payrollService.js`
- minimal controller integration (`payrollController.js`)
- tests + documentation

**Not migrated:** Notifications, Events, Poojas, Prasadam, Settings, Audit Logs,
Attendance Setting / Attendance Location, Suppliers, Recipes, Tasks,
ShiftAssignment, Users/Employees (2A), Accounting (2B), Bills (2C),
Donations (2D), Bookings (2E), Pooja Bookings (2F), Prasadam Orders (2G),
Inventory Items/Batches/Logs/Consumption/Requests (2H–2L), Purchase Orders
(2M), Goods Received Notes (2N), Damage Notes (2O), Assets (2P), Repairs (2Q),
Rooms (2R), Attendance (2S), Leaves (2T), Shifts (2U). MongoDB is still present,
Mongoose is still the fallback. No Phase 2W work, no production data migration,
no dual writes and no global cutover happen here.

## Mongoose model inspected

`backend/src/models/PayrollRecord.js`:

```
employeeId       ObjectId  ref 'Employee', required
employeeName     String    required, trim
department       String    default '', trim
role             String    default '', trim
monthKey         String    required, trim
baseSalary       Number    required, min 0
presentDays      Number    default 0, min 0
absentDays       Number    default 0, min 0
leaveDays        Number    default 0, min 0
halfDays         Number    default 0, min 0
lateDays         Number    default 0, min 0
extraDutyDays    Number    default 0, min 0
overtimeHours    Number    default 0, min 0
deduction        Number    default 0, min 0
extraDutyPay     Number    default 0, min 0
bonus            Number    default 0, min 0
netSalary        Number    required, min 0
status           String    enum ['Pending', 'Paid'], default 'Pending'
paymentMethod    String    enum ['Bank Transfer','UPI','Cash','Cheque','Card','Net Banking'],
                           default 'Bank Transfer'
transactionId    String    default '', trim
paidAt           Date      default null
paidBy           String    default '', trim
notes            String    default '', trim
razorpayOrderId    String  (no default)
razorpayPaymentId  String  (no default)
razorpaySignature  String  (no default)
```

`timestamps: true` adds `createdAt` / `updatedAt`. The schema declares exactly
one index — the compound unique index `{ employeeId: 1, monthKey: 1 }` — and
**no** embedded subdocuments or arrays.

## Complete Mongo → PostgreSQL mapping

| Mongo field | PostgreSQL column | PostgreSQL type | Nullable? | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| `_id` (ObjectId) | `id` | `TEXT` | NO | generated (24-hex, ObjectId-shaped) | Project convention from Phases 2A–2U |
| `employeeId` | `employee_id` | `TEXT` | NO | — | The ObjectId as text. **No FK** — see relationships |
| `employeeName` | `employee_name` | `TEXT` | NO | — | Required, trim |
| `department` | `department` | `TEXT` | NO | `''` | |
| `role` | `role` | `TEXT` | NO | `''` | |
| `monthKey` | `month_key` | `TEXT` | NO | — | The payroll period, `'YYYY-MM'`. Kept `TEXT` |
| `baseSalary` | `base_salary` | `NUMERIC` | NO | — | Money, required, `min 0` |
| `presentDays` | `present_days` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `absentDays` | `absent_days` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `leaveDays` | `leave_days` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `halfDays` | `half_days` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `lateDays` | `late_days` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `extraDutyDays` | `extra_duty_days` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `overtimeHours` | `overtime_hours` | `NUMERIC` | NO | `0` | Counter, `min 0` |
| `deduction` | `deduction` | `NUMERIC` | NO | `0` | Money, `min 0` |
| `extraDutyPay` | `extra_duty_pay` | `NUMERIC` | NO | `0` | Money, `min 0` |
| `bonus` | `bonus` | `NUMERIC` | NO | `0` | Money, `min 0` |
| `netSalary` | `net_salary` | `NUMERIC` | NO | — | Money, required, `min 0` |
| `status` | `status` | `TEXT` | NO | `'Pending'` | CHECK mirrors the 2-value enum |
| `paymentMethod` | `payment_method` | `TEXT` | NO | `'Bank Transfer'` | CHECK mirrors the 6-value enum |
| `transactionId` | `transaction_id` | `TEXT` | NO | `''` | |
| `paidAt` | `paid_at` | `TIMESTAMPTZ` | YES | `NULL` | The schema's explicit `default: null` |
| `paidBy` | `paid_by` | `TEXT` | NO | `''` | |
| `notes` | `notes` | `TEXT` | NO | `''` | |
| `razorpayOrderId` | `razorpay_order_id` | `TEXT` | YES | — | No default in the schema → no default here |
| `razorpayPaymentId` | `razorpay_payment_id` | `TEXT` | YES | — | No default |
| `razorpaySignature` | `razorpay_signature` | `TEXT` | YES | — | No default |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Refreshed by every repository update |

## Money precision

Every monetary and counter path is `NUMERIC` — never `FLOAT`, `REAL` or
`DOUBLE PRECISION`. `NUMERIC` carries no explicit precision/scale, so PostgreSQL
stores the value exactly as supplied: an integer stays an integer, `0.01` stays
`0.01` and a fractional `overtimeHours` (e.g. `3.5`) survives. Mongoose stores
these paths as JavaScript `Number` (IEEE-754 doubles); the repository converts
the `NUMERIC` text back to a `Number` on read, so the application sees the same
type it saw on a Mongoose document.

## Stored vs calculated values

The Payroll model stores **already-calculated** values. The calculation itself
lives in the controller (`payrollController.js`, `buildEmployeePayroll`) and is
untouched by this phase:

- `baseSalary`, `deduction`, `extraDutyPay`, `bonus` and `netSalary` are
  computed by the controller from the employee's salary, attendance, leave and
  extra-duty inputs, then persisted verbatim.
- `presentDays`, `absentDays`, `leaveDays`, `halfDays`, `lateDays`,
  `extraDutyDays` and `overtimeHours` are attendance/leave/shift **inputs** that
  the controller derives and stores alongside the money.
- Nothing is re-derived at read time, so the repository stores and returns the
  same values without applying any formula of its own. No payroll formula,
  rounding rule or calculation engine was changed or re-implemented.

## Payroll period semantics

The period is the `monthKey` string, always `'YYYY-MM'`.
`payEmployeePayroll` rejects any other shape with a 400 before a datasource is
reached, and every reader compares the value as text. `month_key` therefore
stays `TEXT` — a `DATE` or `INTEGER` column would change comparison and `$in`
membership semantics. A `CHECK` pins the `'^[0-9]{4}-[0-9]{2}$'` shape, matching
the validation the application already performs.

One record per employee per period is enforced in MongoDB by the compound unique
index `{ employeeId: 1, monthKey: 1 }`. PostgreSQL reproduces it exactly as
`UNIQUE (employee_id, month_key)`, so a second employee in the same period, or
the same employee in a different period, both remain valid.

## Relationships

| Source field | Referenced entity | Current Mongo behavior | PG table exists? | FK in 2V |
| --- | --- | --- | --- | --- |
| `employeeId` (`ref: 'Employee'`) | Employee (Users/Employees, 2A) | Stored as an ObjectId; nothing in the payroll write path populates or validates the target row | Yes (`employees`, 2A) | **No** |
| `AccountTransaction.referenceId` → `PayrollRecord` | AccountTransaction (Accounting, 2B) | Accounting stores the payroll id as `referenceId` with `referenceModel: 'PayrollRecord'`; nothing FK-references payroll | Yes (`account_transactions`, 2B) | **No** |

No foreign keys are declared, deliberately. The live payroll write path receives
`employeeId` from the request/employee lookup and the `employees` table is not
guaranteed to hold a matching row, so an FK would reject writes Mongo accepts.
This matches the Phase 2S (Attendance) and 2T (Leaves) decisions. The Accounting
reference is a soft, polymorphic `referenceId`/`referenceModel` pair on the
Accounting side and is unchanged here.

## Embedded / subdocument structures

The PayrollRecord schema declares **no** embedded arrays or nested objects —
there are no allowance, deduction, bonus, overtime, tax, attendance-summary,
leave-summary or payment-detail subdocuments. Every value is a scalar column, so
no child tables are created and no transactions are required. Payroll is a
single-row domain.

## Status workflow

The only statuses are `Pending` and `Paid`, exactly as the schema enum declares.
No `draft`, `calculated`, `approved`, `processed`, `cancelled` or `reversed`
state exists and none was invented.

- **Creation** writes `Pending` with `paidAt` null.
- **Razorpay order creation** stores `razorpayOrderId` and leaves the record
  `Pending`.
- **Payment verification** moves the record to `Paid` and stores
  `transactionId`, `razorpayPaymentId`, `razorpaySignature` and `paidAt`.
- **Offline / simulated payment** moves the record to `Paid` with the chosen
  `paymentMethod`, a `transactionId`, `paidAt` and `paidBy`.
- No payroll status transition is validated beyond the enum, and none is added by
  this phase.

## Migration

`023_create_payroll_records.sql` creates `payroll_records`, the
`UNIQUE (employee_id, month_key)` constraint, the two enum CHECKs, the twelve
`>= 0` CHECKs, the `month_key` shape CHECK and five indexes
(`payroll_records_pkey` plus four secondary indexes). It is additive and
idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), so it
applies cleanly on a fresh database and re-applies cleanly after being rolled
back.

Rollback follows the project convention: drop the table (and its
`schema_migrations` row) and re-run `npm run db:migrate`, which re-applies only
this migration and rebuilds the table with its indexes.

## Repository and service

`payrollRepository.js` implements only the operations the application performs:
`findById`, `findOne`, `findMany`, `create` and `updateById`. Every value is
bound as a query parameter and sort/filter keys are whitelisted, so nothing is
interpolated into the SQL. `limit`/`offset` preserve the existing pagination
semantics.

`payrollService.js` owns the datasource selection. `usePostgres()` reads
`dbConfig.isDbConnected()` at call time (never a require-time destructure, so
tests can swap the seam) and additionally confirms PostgreSQL is reachable. When
PostgreSQL is selected the service delegates to the repository; otherwise it
falls back to the existing `PayrollRecord` Mongoose model. A single operation
writes to exactly one datasource — there are no dual writes.

## Tests

- `test/postgres-payroll.test.js` — field mapping, defaults, required-field
  validation, financial round-trips (zero/integer/decimal/large), no
  floating-point columns, period uniqueness, period text comparison, calculation
  inputs, reads/filter/sort/pagination, workflow transitions, no-dual-write
  assertions (Mongoose statics are stubbed and must not be called), the
  datasource seam flip and the migration wiring.
- `test/postgres-payroll-fallback.test.js` — Mongo fallback for
  create/read/update, validation parity, the fallback working with no
  `payroll_records` table, no partial or duplicate PG rows, no dual writes, the
  service invoking the Mongoose model end-to-end and the datasource seam.
- `test/postgres-migrate.test.js` — the Phase 2V migration block: column types,
  defaults, constraints, indexes, no floating-point types, period semantics,
  money precision and migration rollback/re-apply.
