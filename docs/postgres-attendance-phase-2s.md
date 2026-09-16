# Phase 2S — PostgreSQL Attendance

Incremental, additive migration of the MongoDB **Attendance** domain to
PostgreSQL, following the architecture established in Phases 2A–2R.

There is exactly **one** Attendance entity in the repository —
`backend/src/models/Attendance.js` — and it is the source of truth for this
phase.

## Scope

Only the Attendance domain is migrated in this phase:

- `backend/src/db/migrations/020_create_attendance.sql`
- `backend/src/repositories/attendanceRepository.js`
- `backend/src/services/attendanceService.js`
- minimal controller integration (`attendanceController.js`,
  `shiftController.js`, `payrollController.js`,
  `employeeManagementController.js`)
- tests + documentation

**Not migrated:** Attendance Setting / Attendance Location (separate models,
still Mongo-backed), Leaves, Shifts, Payroll, Notifications, Events, Poojas,
Prasadam, Settings, Audit Logs, Users/Employees (2A), Accounting (2B), Bills
(2C), Donations (2D), Bookings (2E), Pooja Bookings (2F), Prasadam Orders (2G),
Inventory Items/Batches/Logs/Consumption/Requests (2H–2L), Purchase Orders
(2M), Goods Received Notes (2N), Damage Notes (2O), Assets (2P), Repairs (2Q),
Rooms (2R), MongoDB (still present), Mongoose (still the fallback). No Phase 2T
work, no production data migration, no dual writes and no global cutover happen
here.

## Mongoose model inspected

`backend/src/models/Attendance.js`:

```
staffId            String   required, trim, index
staffName          String   required, trim
employeeId         String   trim, index
staffEmail         String   trim, lowercase
dateKey            String   required, trim, index
checkIn            String   default '--', trim
checkOut           String   default '--', trim
checkInAt          Date     default null
checkOutAt         Date     default null
shift              String   default 'Morning', trim
shiftStartTime     String   default '', trim
shiftEndTime       String   default '', trim
assignmentType     String   default '', trim
dutyName           String   default '', trim
dutyArea           String   default '', trim
status             String   enum [...10 values...], default 'Absent'
isLateCheckIn      Boolean  default false
workingMinutes     Number   default 0
workingHours       String   default '--', trim
overtimeMinutes    Number   default 0
overtimeHours      String   default '--', trim
isOvertime         Boolean  default false
note               String   default '', trim
source             String   default 'manual', trim
correctedBy        String   default '', trim
correctionDate     Date     default null
correctionReason   String   default '', trim
latitude           Number   default null
longitude          Number   default null
locationVerified   Boolean  default false
faceVerified       Boolean  default false
distanceFromTemple Number   default null
deviceInfo         String   default ''
browser            String   default ''
ipAddress          String   default ''
checkInPhoto       String   default ''
checkOutPhoto      String   default ''
timestamps:        true
```

Indexes declared by the schema:

```
{ staffId: 1,   dateKey: 1 }   unique: true
{ employeeId: 1, dateKey: 1 }
{ staffEmail: 1, dateKey: 1 }
{ staffId: 1 }
{ employeeId: 1 }
{ dateKey: 1 }
```

The schema has **no virtuals and no embedded sub-documents** — every field is a
flat scalar. The exact persisted key set (37 fields plus `_id`/timestamps) was
confirmed by probing `Attendance.schema`.

Every real usage was read before designing the mapping:

- `backend/src/controllers/attendanceController.js`
  — `markAttendance` (`POST /api/staff/attendance/mark`): builds
  `buildAttendanceQuery(staffId, { dateKey })` and reads the same-day record
  with `Attendance.findOne`; on check-in it either reuses the loaded record via
  `Attendance.findByIdAndUpdate(_id, payload, { new, upsert })` or creates it via
  `Attendance.create(payload)` (status `Pending`, source `biometric`, plus
  latitude/longitude/distance/verification/device metadata); on check-out it
  mutates the loaded document (derives `status` from the working duration,
  computes `overtimeMinutes` from the stored `isOvertime`, appends a Comp Off
  note for Emergency Duty on a weekly off) and calls `attendance.save()`.
  `updateAttendance` (`PUT /api/staff/attendance/:id`) loads by id, recomputes
  `workingMinutes` from the corrected clock strings, stamps
  `correctedBy`/`correctionDate`/`correctionReason` and source
  `admin-correction`, then calls `attendance.save()`.
  `buildDashboardResponse` / `buildAdminAttendanceDashboard` read with
  the standing `sort({ dateKey: -1, createdAt: -1 })` and the monthly
  `dateKey: { $gte, $lte }` range.
  `buildAttendanceQuery` is the `$or` identity shape:
  `{ $or: [{ staffId: { $in } }, { employeeId: { $in } }, { staffEmail: { $in } }] }`.
- `backend/src/controllers/shiftController.js` — `getAttendanceForAssignment`
  uses `Attendance.findOne({ dateKey, $or: [ ... ] })`.
- `backend/src/controllers/payrollController.js` — the payroll generator reads
  `Attendance.find({ dateKey: { $gte: startKey, $lte: endKey } })` twice and
  aggregates `workingMinutes` / `overtimeMinutes` / `isOvertime` in JS.
- `backend/src/controllers/employeeManagementController.js` — the employee
  detail page reads `Attendance.find({ $or: [...] }).sort({ dateKey: -1 }).limit(100)`.
- `backend/src/routes/attendanceRoutes.js` — the four endpoints above; no other
  Attendance route exists.
- `frontend/src/services/attendanceService.js` and the staff/admin attendance
  pages — the only frontend consumers; they read the document fields returned by
  those endpoints.

Other models with a "dateKey" field (`ShiftAssignment`, `Task`) and other models
with shift/leave concepts (`Shift`, `Leave`) are **separate domains** and are not
touched by this phase.

## Mongo → PostgreSQL field mapping — `attendance`

| Mongo field | PostgreSQL column | PostgreSQL type | Nullable? | Default? | Notes |
|---|---|---|---|---|---|
| `_id` | `id` | `TEXT` | NOT NULL (PK) | — | 24-hex ObjectId-compatible id |
| `staffId` | `staff_id` | `TEXT` | NOT NULL | — | required, trim; identity column, **no FK** (see identity note) |
| `staffName` | `staff_name` | `TEXT` | NOT NULL | — | required, trim; historical snapshot |
| `employeeId` | `employee_id` | `TEXT` | NULL | — | optional, trim; same identity space as `staffId` |
| `staffEmail` | `staff_email` | `TEXT` | NULL | — | optional, trim |
| `dateKey` | `date_key` | `TEXT` | NOT NULL | — | required, trim; calendar day key — **kept TEXT**, see date semantics |
| `checkIn` | `check_in` | `TEXT` | NOT NULL | `'--'` | display clock string (`09:37 AM`), not an instant |
| `checkOut` | `check_out` | `TEXT` | NOT NULL | `'--'` | display clock string, not an instant |
| `checkInAt` | `check_in_at` | `TIMESTAMPTZ` | NULL | `NULL` | real instant |
| `checkOutAt` | `check_out_at` | `TIMESTAMPTZ` | NULL | `NULL` | real instant |
| `shift` | `shift` | `TEXT` | NOT NULL | `'Morning'` | free String, no enum in Mongo |
| `shiftStartTime` | `shift_start_time` | `TEXT` | NOT NULL | `''` | free String |
| `shiftEndTime` | `shift_end_time` | `TEXT` | NOT NULL | `''` | free String |
| `assignmentType` | `assignment_type` | `TEXT` | NOT NULL | `''` | free String; no shift id exists |
| `dutyName` | `duty_name` | `TEXT` | NOT NULL | `''` | free String |
| `dutyArea` | `duty_area` | `TEXT` | NOT NULL | `''` | free String |
| `status` | `status` | `TEXT` | NOT NULL | `'Absent'` | CHECK over the exact 10-value enum |
| `isLateCheckIn` | `is_late_check_in` | `BOOLEAN` | NOT NULL | `FALSE` | — |
| `workingMinutes` | `working_minutes` | `NUMERIC` | NOT NULL | `0` | stored duration in minutes, no `min` in Mongo |
| `workingHours` | `working_hours` | `TEXT` | NOT NULL | `'--'` | display string (`7h 30m`), not a number |
| `overtimeMinutes` | `overtime_minutes` | `NUMERIC` | NOT NULL | `0` | stored duration in minutes |
| `overtimeHours` | `overtime_hours` | `TEXT` | NOT NULL | `'--'` | display string |
| `isOvertime` | `is_overtime` | `BOOLEAN` | NOT NULL | `FALSE` | — |
| `note` | `note` | `TEXT` | NOT NULL | `''` | free String (used for the Comp Off note) |
| `source` | `source` | `TEXT` | NOT NULL | `'manual'` | free String (`manual`/`biometric`/`admin-correction`) |
| `correctedBy` | `corrected_by` | `TEXT` | NOT NULL | `''` | last-correction stamp only |
| `correctionDate` | `correction_date` | `TIMESTAMPTZ` | NULL | `NULL` | instant |
| `correctionReason` | `correction_reason` | `TEXT` | NOT NULL | `''` | last-correction reason only |
| `latitude` | `latitude` | `NUMERIC` | NULL | `NULL` | exact coordinate |
| `longitude` | `longitude` | `NUMERIC` | NULL | `NULL` | exact coordinate |
| `locationVerified` | `location_verified` | `BOOLEAN` | NOT NULL | `FALSE` | — |
| `faceVerified` | `face_verified` | `BOOLEAN` | NOT NULL | `FALSE` | — |
| `distanceFromTemple` | `distance_from_temple` | `NUMERIC` | NULL | `NULL` | exact distance |
| `deviceInfo` | `device_info` | `TEXT` | NOT NULL | `''` | — |
| `browser` | `browser` | `TEXT` | NOT NULL | `''` | — |
| `ipAddress` | `ip_address` | `TEXT` | NOT NULL | `''` | — |
| `checkInPhoto` | `check_in_photo` | `TEXT` | NOT NULL | `''` | — |
| `checkOutPhoto` | `check_out_photo` | `TEXT` | NOT NULL | `''` | — |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | timestamps: true |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | timestamps: true |

Completeness: every persisted Mongo field has a column and there are exactly
**40** columns (id + the 37 schema fields + the two timestamps) — no field is
omitted and none is invented. The Attendance model has **no** `shiftId`, no
`leaveId`, no `taskId`, no approval/regularization workflow fields, no
break/segment arrays, no overtime rate, no working-day fraction, no payroll
link, no `createdBy`/`updatedBy` and no JSON metadata. Those names exist on
*other* entities (`Task.shiftId`, `Leave.*`, `PayrollRecord.*`) but not on
Attendance, so they are deliberately **not** columns. A test asserts both that
those keys do not survive a round trip and that the columns do not exist.

## Date and time semantics

| Field | PostgreSQL type | Why |
|---|---|---|
| `date_key` | `TEXT` | **Not** a date value. The schema declares it as a `String` and the application treats it as a date *key*: it is produced by `new Date().toISOString().slice(0, 10)` (`attendanceController.toDateKey`), compared lexicographically (`dateKey: { $gte, $lte }`), sorted as text (`sort({ dateKey: -1 })`), and compared across year boundaries as strings in `payrollController`. A `DATE` column would re-interpret the value through the server timezone on read and could shift the calendar day — exactly the UTC/local-date bug this phase must avoid. `TEXT` preserves the exact `'YYYY-MM-DD'` round trip and every existing comparison. This is the same decision as `bookings.datetime` (Phase 2E) and `account_transactions.date` |
| `check_in_at`, `check_out_at`, `correction_date` | `TIMESTAMPTZ` | The schema declares them as real `Date` values holding an absolute instant (`now` is written, and `new Date(attendance.checkInAt)` is subtracted from the current time to compute `workingMinutes`). `TIMESTAMPTZ` round-trips the instant exactly, independent of the session timezone |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `timestamps: true` |
| `check_in`, `check_out` | `TEXT` | The schema declares them as display clock strings (`09:37 AM`, default `'--'`), produced by `toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })`. They are **not** instants — the companion `check_*_at` columns carry the instant. Converting them to `TIME`/`TIMESTAMPTZ` would change the stored 12-hour formatted value that the API and the dashboards return verbatim |

So the split is deliberate: only the `Date`-typed paths become `TIMESTAMPTZ`,
while the timezone-free calendar key and the human-formatted clock strings stay
`TEXT`. The application's existing timezone behaviour is unchanged — the
controller still derives `dateKey` from the UTC calendar day and the clock
strings from the local formatter, and PostgreSQL stores both verbatim.

**Date-boundary behaviour:** month and year queries are plain inclusive text
ranges (`dateKey: { $gte: '2026-03-01', $lte: '2026-03-31' }`), rendered as
`date_key >= $n AND date_key <= $n`. Because `date_key` is `TEXT` the
comparison is lexicographic, which is identical to chronological order for
zero-padded `YYYY-MM-DD` values — including across a year boundary
(`'2026-12-31' <= '2027-01-01'`). A `date_key ~ '^\d{4}-\d{2}-\d{2}$'` CHECK
pins the shape so the text contract stays enforced. Overnight attendance is
**not** modelled by the application (there is a single `dateKey` per record and
no cross-midnight session concept), so nothing is invented for it.

## Stored vs derived fields

Nothing is duplicated or newly derived:

- `workingMinutes`, `workingHours`, `overtimeMinutes`, `overtimeHours` and
  `isOvertime` **are stored** — the controller writes them on check-out and on
  correction, and `payrollController` reads the stored `overtimeMinutes` /
  `isOvertime` back to build payroll. They stay stored columns.
- `workingHours` / `overtimeHours` are the `formatWorkingHours(...)` display
  strings the schema itself stores (`'--'`, `'7h 30m'`). They are **not**
  recomputed from the minute columns on read.
- The calculation formulas (`workingMinutes` from `checkOutAt - checkInAt`, the
  `6h`/`4h` present/half-day/absent thresholds, `overtimeMinutes =
  max(0, workingMinutes - 480)`, the Comp Off increment) stay **in the
  controller**, unchanged. No derived column was added and no formula changed.
- The unit is **minutes** for `workingMinutes` / `overtimeMinutes` (confirmed by
  `Math.round(ms / 60000)` and the `480`-minute standard day). `NUMERIC` is used
  rather than an integer so a fractional value can round-trip exactly if one is
  ever stored; the Mongo schema sets no `min`, so **no `>= 0` CHECK** is added —
  Mongoose itself never rejects a negative, and adding one would make PostgreSQL
  stricter than the source of truth.
- `latitude` / `longitude` / `distanceFromTemple` are `NUMERIC` so coordinates
  round-trip exactly (`12.9715987` is asserted verbatim in the tests); a
  floating-point column could not.

## Embedded data

**None.** The Attendance schema contains no arrays and no sub-documents — no
check-in/check-out session list, no break segments, no work segments, no
corrections history, no approval history. There is therefore **no child table,
no JSONB column and no transaction**: every attendance operation is a
single-row write, so introducing multi-table transactions would add complexity
without atomicity to protect. The correction fields (`corrected_by` /
`correction_date` / `correction_reason`) are flat scalars on the document — the
model stores only the **last** correction, not an append-only history — and are
kept as flat columns.

## Relationships / foreign keys

**There are no foreign keys in this phase — zero.**

| Candidate relationship | FK created? | Reason |
|---|---|---|
| `staffId` / `employeeId` → `users` / `employees` | **No** | These are **free Strings**, not real refs. `resolveStaffContext` fills them with a User id, an Employee id, or (when neither resolves) the caller-supplied raw value: `user?._id ?? employee?._id ?? clean(staffId)`. Every read path deliberately matches **any** of `{ staffId, employeeId, staffEmail }` via `$or` and compares against both the User id and the Employee id. There is no single referenced table, and `users`/`employees` remain Mongo-backed in this phase, so the referenced row is routinely absent from PostgreSQL. Both columns are plain indexed `TEXT`, matching the convention already used for `users.employee_id`, `goods_received_notes.received_by` and `damage_notes.reported_by` |
| `shift` / `shiftStartTime` / `shiftEndTime` / `assignmentType` → shifts | **No** | Plain denormalized strings. The model has **no `shiftId` column at all**, and the Shift domain is not migrated in this phase |
| Attendance → `leaves` | **No** | Attendance holds **no leave reference**. The controller looks leave up separately against the Leave collection and only overlays the effective status in memory; nothing is stored on the attendance row |
| Attendance → payroll / tasks | **No** | No reference exists on the model |
| Attendance → attendance settings/locations | **No** | No reference exists on the model; those settings are read separately |

Because there are no foreign keys, there is **no ON DELETE behaviour** to
document, and deleting an attendance row never cascades into, blocks, or mutates
any other table. That mirrors Mongo exactly, where deleting the Attendance
document leaves every other collection untouched.

The employee data is **not duplicated**: the columns store the same identifier
the application already stores, and `staffName`/`staffEmail` are the
denormalized historical snapshot the Mongo schema itself declares (they are read
back verbatim by every dashboard).

## Uniqueness

The Attendance schema declares exactly **one** unique index —
`{ staffId: 1, dateKey: 1 }` with `{ unique: true }` — so exactly one UNIQUE
constraint is reproduced: `attendance_staff_id_date_key_key UNIQUE (staff_id,
date_key)`. That is the business key: one attendance record per staff identifier
per calendar day. The controller's find-then-create/update flow normally
prevents a collision, but the model enforces it regardless, so PostgreSQL does
too. Values are text-normalized (`staffId` trimmed, `dateKey` trimmed) before
comparison, so byte equality matches Mongo's trimmed-field equality for every
value the application writes.

The other two composites — `{ employeeId, dateKey }` and `{ staffEmail, dateKey }`
— are **non-unique** indexes in Mongo and are reproduced as **non-unique**
indexes, *not* as UNIQUE constraints. Mongo allows several rows to share an
`employeeId` (or an email) on the same day, so widening either to UNIQUE would
reject records the source of truth accepts. This is asserted in the tests.

## Enums (preserved exactly)

| Column | Values | Default |
|---|---|---|
| `attendance.status` | `Present`, `Absent`, `Half Day`, `Leave`, `Pending`, `Working`, `Holiday`, `Late`, `Weekly Off`, `Compensatory Off` | `'Absent'` |

No value is renamed and none is added. Some of these are only ever produced by
the read paths (`getEffectiveStatus` derives `Working`/`Late`/`Holiday` in
memory), but they are in the schema enum and are preserved verbatim; the API's
`normalizeAttendanceStatus` still collapses unknown values to `Absent` exactly
as before. No CHECK is added for `staffId`, `staffName`, `employeeId`,
`staffEmail`, `dateKey`, `checkIn`, `checkOut`, `shift`, `shiftStartTime`,
`shiftEndTime`, `assignmentType`, `dutyName`, `dutyArea`, `workingHours`,
`overtimeHours`, `note`, `source`, `correctedBy`, `correctionReason`,
`deviceInfo`, `browser`, `ipAddress`, `checkInPhoto` or `checkOutPhoto` because
Mongo declares no enum for them; inventing one would change existing semantics.

## Indexes and the queries they serve

| Index | Query/use case |
|---|---|
| `attendance_staff_id_date_key_key` (UNIQUE) | Mongo `{ staffId, dateKey } unique: true`; also the access path for the same-day lookup in `markAttendance` and `getAttendanceForAssignment`. It already serves the leading-`staffId` equality the model's separate `staffId` index covered, so no separate single-column index on `staff_id` is added |
| `idx_attendance_employee_id_date_key` | the non-unique Mongo `{ employeeId, dateKey }` index; `buildAttendanceQuery` matches `employeeId: { $in: [...] }` always paired with a `dateKey` equality or range |
| `idx_attendance_staff_email_date_key` | the non-unique Mongo `{ staffEmail, dateKey }` index; same pairing |
| `idx_attendance_date_key` | the standing `dateKey`-only access path: the admin dashboard and the payroll generator read the whole month with `dateKey: { $gte, $lte }` (no staff filter), which a `staffId`-leading composite cannot serve |
| `idx_attendance_date_key_created_at` | the `sort({ dateKey: -1, createdAt: -1 })` ordering every dashboard list uses, materialised as `(date_key DESC, created_at DESC)` |

No index is added for `status`, `shift`, `source` or `is_overtime`: no
server-side query filters on them (the admin status filter is applied in JS
after the monthly read, and the dashboards never query by shift). No uniqueness
beyond `(staff_id, date_key)` is invented.

## Migration

- File: `backend/src/db/migrations/020_create_attendance.sql` (migration 20,
  following `019_create_rooms.sql`).
- Tables: `attendance` (one table; no child tables).
- Columns: the 40 mapped columns above; durations and coordinates are `NUMERIC`
  (never `FLOAT`/`REAL`/`DOUBLE PRECISION`), `date_key` is `TEXT`, and the three
  instant fields plus the two timestamps are `TIMESTAMPTZ`.
- Constraints:
  - `attendance_pkey` PRIMARY KEY (`id`)
  - `attendance_staff_id_date_key_key` UNIQUE (`staff_id`, `date_key`)
  - `attendance_status_check` CHECK (`status IN (...10 values...)`)
  - `attendance_date_key_check` CHECK (`date_key ~ '^\d{4}-\d{2}-\d{2}$'`)
  - **zero** foreign keys
- Indexes: `idx_attendance_employee_id_date_key`,
  `idx_attendance_staff_email_date_key`, `idx_attendance_date_key`,
  `idx_attendance_date_key_created_at` (plus the unique index backing the UNIQUE
  constraint).
- Rollback: the project's migration mechanism is forward-only (no `down`
  migrations), so rollback follows the established convention — `DROP TABLE
  attendance` (the table has no dependents) and delete its `schema_migrations`
  row; a re-run then re-applies only migration 020 and rebuilds the table, its
  constraints and its indexes. The migrate suite tests exactly this.
- The migration is idempotent (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`) and cannot affect MongoDB.

## Repository methods

`backend/src/repositories/attendanceRepository.js`:

- `create(data)` — validates required/enum/dateKey/number rules, INSERTs, re-reads.
  A duplicate `(staffId, dateKey)` surfaces as a unique-constraint violation,
  exactly as Mongoose raises a 11000 duplicate-key error. Nothing is silently
  replaced.
- `findById(id)` / `findOne(filter)` / `findMany({ filter, sort, limit, offset })`
- `updateById(id, updates)` — patches only the supplied fields and bumps
  `updated_at`; `undefined` leaves a column untouched, an explicit value is
  written, and an explicit `null` clears a nullable instant (the correction path
  nulls `checkInAt`/`checkOutAt` when the clock string is cleared). Returns
  `null` for a missing id.
- `count(filter)` — `SELECT COUNT(*)::int`.
- `validate(data)` — the same validation the create path applies.
- Mongo fallbacks for every operation.

Filtering supports the keys the application actually uses (`id`, `staffId`,
`employeeId`, `staffEmail`, `dateKey`, `shift`, `source`, `status`,
`checkInAt`, `createdAt`, `updatedAt`, `isOvertime`, `isLateCheckIn`,
`faceVerified`, `locationVerified`) plus the Mongo operators `$in`, `$gte`,
`$gt`, `$lte`, `$lt`, and the standing `$or` identity shape
`{ $or: [{ staffId: { $in } }, { employeeId: { $in } }, { staffEmail: { $in } }] }`
used by `buildAttendanceQuery` and `getAttendanceForAssignment`. `$in: []`
renders `1 = 0`, matching Mongo's instant-false semantics. Status filters are
enum-checked before they reach SQL.

Sorting is dynamic but goes through a whitelist map — an unknown or malformed
sort key is dropped and the clause falls back to the default
`date_key DESC, created_at DESC` (the standing dashboard order). A multi-key
Mongo sort such as `{ dateKey: -1, createdAt: -1 }` keeps its exact tie-breaking.
`LIMIT`/`OFFSET` are numeric-coerced and appended as literals (never user string
interpolation). **All filter values are parameterized**; no user input is
interpolated into SQL.

## Service

`backend/src/services/attendanceService.js` mirrors the other Phase 2 services:

- preserves the required fields, the defaults (`checkIn`/`checkOut` `'--'`,
  `shift` `'Morning'`, `status` `'Absent'`, `workingMinutes`/`overtimeMinutes`
  `0`, `source` `'manual'`, remaining Strings `''`, the `null` instants and
  coordinates), the enum check, the dateKey shape check and the numeric
  finiteness checks, and trims the fields Mongoose trims;
- `create/findById/findOne/findMany/updateById/count` each branch via
  `usePostgres()`: PostgreSQL when available, otherwise Mongoose — one
  operation, one branch, no dual write;
- `validate(data)` exposes the same normalization for callers;
- `isConnected()` / `usePostgres()` are public so tests can assert exactly which
  datasource is active.

## Fallback boundary (explicit)

Entity-scoped, no global switch, no dual writes:

```
Attendance Service (attendanceService)
      |
      +-- PostgreSQL available (datasource seam connected AND isPostgresConnected())
      |        ↓
      |    attendanceRepository → attendance
      |
      +-- PostgreSQL unavailable (seam disconnected OR PG unreachable)
              ↓
          Mongoose Attendance model (unchanged Phase 1 path)
```

- `usePostgres()` returns true only when `dbConfig.isDbConnected()` **and**
  `isPostgresConnected()` succeed. If either fails, every operation routes to
  the existing Mongoose model, so an unavailable PostgreSQL can never take the
  app down.
- The datasource seam is read **at call time** through the module object
  (`dbConfig.isDbConnected()`), never destructured at require time, so tests
  (and any runtime flip) can switch datasource state in-process without
  restarting Node. This is the known stale-capture risk for `isDbConnected`, and
  the fallback suite tests it explicitly by flipping the seam back and forth on
  already-loaded modules.
- No dual writes: a single operation goes down exactly one branch, and the tests
  assert an exact PG row-count delta plus `mongoose.connection.readyState === 0`
  on the PostgreSQL path, and the absence of the written `staff_id` in
  PostgreSQL on the Mongo path.

## Integration

- `attendanceController.js` now reads and writes attendance through
  `attendanceService` instead of the `Attendance` model directly, so all four
  endpoints follow the selected datasource. Every branch, status code, response
  shape and message is unchanged. The check-out branch no longer mutates the
  loaded document and calls `save()`; it builds the same update object and hands
  it to `attendanceService.updateById`, which applies exactly those fields — the
  derived status thresholds, the overtime formula and the Comp Off note logic
  are identical.
- `shiftController.js`'s `getAttendanceForAssignment` now calls
  `attendanceService.findOne(query)` with the identical query object.
- `payrollController.js`'s two monthly reads now call
  `attendanceService.findMany({ filter: { dateKey: { $gte, $lte } } })`. The
  in-JS aggregation is untouched, and the extra `sort` the service applies does
  not affect it (payroll builds a `dateKey`→doc Map and sums `overtimeMinutes`,
  neither of which depends on row order).
- `employeeManagementController.js`'s employee detail history now calls
  `attendanceService.findMany({ filter, sort: { dateKey: -1 }, limit: 100 })`,
  preserving the existing `limit(100)` pagination semantics.
- Attendance Setting / Location controllers and every other domain are
  **untouched**.

## Tests

`backend/test/postgres-attendance.test.js` (20 tests) runs against the real
PostgreSQL `attendance` table (no mocks) and covers:

- datasource selection (`isConnected`, `usePostgres`);
- a full create → read round trip of every persisted Mongo field, asserted
  against the exact 40-key projection, including trimming, the enum, the display
  clock strings, the three instant fields and the location/verification data;
- proof that fields the schema does not declare (`shiftId`, `leaveId`,
  `createdBy`, `updatedBy`, `approvalStatus`, `metadata`, `sessions`) are neither
  returned nor given columns;
- unset `employeeId`/`staffEmail` reading back as `undefined` and the
  null-default fields reading back as `null`;
- every schema default;
- validation (required fields, whitespace-only rejection, dateKey shape, status
  enum acceptance/rejection, numeric finiteness);
- uniqueness: the single `(staffId, dateKey)` rule, duplicate rejection,
  different-day and different-staff acceptance, and that a shared
  `employeeId`/`staffEmail` on one day is deliberately allowed;
- date/time: `date_key` returning verbatim and staying `TEXT`, a year-boundary
  lexicographic range, and `checkInAt`/`checkOutAt` instants across UTC-day
  boundaries with a null check-out;
- durations: exact round trips including fractional `NUMERIC` scale;
- check-in → check-out → half-day/absent flows through the service, and the
  admin-correction flow stamping the correction fields and clearing an instant;
- `updateById` patch-only semantics and `updatedAt` refresh;
- the query surface: `$or` identity lookups, date ranges, monthly scans, status
  `$in` (including `$in: []`), shift/source/boolean filters, enum rejection,
  whitelisted sorting (including a rejected injection-shaped sort key),
  `LIMIT`/`OFFSET` pagination and `count`;
- **no dual writes** — exact PG row-count delta plus
  `mongoose.connection.readyState === 0`, and a single service `create` reaching
  exactly one datasource.

`backend/test/postgres-repositories.test.js` gains two Phase 2S tests
(create/read/update round trip, no dual writes) alongside the existing
per-phase repository tests.

`backend/test/postgres-attendance-fallback.test.js` (12 tests) pins
`dbConfig.isDbConnected = () => false` and proves:

- the service selects MongoDB and never PostgreSQL, even when `DATABASE_URL`
  points at a dead server;
- the repository's `create`/`findById`/`findMany`/`count`/`updateById` all route
  to the Mongoose model, using call-tracking stubs of the loaded model object
  (the same reference the modules invoke at call time) so the Mongo path is
  genuinely exercised;
- `updateById` re-applies the same validation on the fallback branch;
- the service's `create`/`findById`/`findOne`/`findMany`/`updateById`/`count`
  each reach the corresponding Mongoose method;
- the Mongo fallback works with the `attendance` table dropped;
- **no dual writes** — the Mongo write leaves no new PG row, and a single
  `attendanceService.create` reaches exactly one datasource;
- **the datasource seam** — flipping the seam to PostgreSQL inside the same
  process makes the already-loaded modules take the PG branch (asserted by
  observing that the Mongo-only id is absent from PostgreSQL), and flipping back
  and forth repeatedly always honours the current value. A stale capture of
  `isDbConnected` at require time would fail these assertions.

## Migration tests

Added to `backend/test/postgres-migrate.test.js`:

- the from-scratch run now applies **20** migrations and records
  `020_create_attendance.sql`;
- the rollback test drops `attendance`, deletes its `schema_migrations` row, and
  asserts a re-run applies only 020, rebuilds `attendance` with the UNIQUE
  constraint, and is then idempotent;
- a schema test asserts all 40 columns exist with the expected types,
  nullability and defaults, that there are exactly 40 columns, that no column
  uses `real`/`double precision`, that `date_key` is `TEXT` and not a
  date/timestamp type, that the CHECKs are exactly the status enum and the
  dateKey shape, that there is exactly one UNIQUE constraint on
  `(staff_id, date_key)`, that there are **zero** foreign keys, and that the six
  indexes are exactly the expected set;
- a constraint test proves the UNIQUE, status-enum and dateKey-shape CHECKs
  reject invalid rows, that the column defaults match the Mongo schema, and that
  `NUMERIC` keeps exact duration/coordinate values.

## Regression

The complete suite is run (see `npm test` in `backend/`): all previously
migrated phases stay green, including Rooms, Repairs, Assets, Inventory,
Purchase Orders, Goods Received Notes, Damage Notes, Users/Employees,
Accounting, Bills, Donations, Bookings, Pooja Bookings and Prasadam. Existing
Mongo behaviour and existing tests are unchanged; the only edits to existing
test files are the migration count (19 → 20), the added migration name, the
added `DROP TABLE ... attendance` in the two reset helpers, and the new Phase 2S
tests.

## Final migration chain

1. `001_create_pg_health.sql`
2. `002_create_users_employees.sql`
3. `003_create_accounting.sql`
4. `004_create_bills.sql`
5. `005_create_donations.sql`
6. `006_create_bookings.sql`
7. `007_create_pooja_bookings.sql`
8. `008_create_prasadam_orders.sql`
9. `009_create_inventory_items.sql`
10. `010_create_inventory_batches.sql`
11. `011_create_inventory_logs.sql`
12. `012_create_inventory_consumption.sql`
13. `013_create_inventory_requests.sql`
14. `014_create_purchase_orders.sql`
15. `015_create_goods_received_notes.sql`
16. `016_create_damage_notes.sql`
17. `017_create_assets.sql`
18. `018_create_repairs.sql`
19. `019_create_rooms.sql`
20. `020_create_attendance.sql`
