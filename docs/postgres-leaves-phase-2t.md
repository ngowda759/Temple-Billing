# Phase 2T — PostgreSQL Leaves

Incremental, additive migration of the MongoDB **Leave/Leaves** domain to
PostgreSQL, following the architecture established in Phases 2A–2S.

There is exactly **one** Leave entity in the repository —
`backend/src/models/Leave.js` — and it is the source of truth for this phase.
There is no separate "Leaves" package, `LeaveType`, `LeaveBalance` or
`HolidayCalendar` model, and none is invented here.

## Scope

Only the Leave domain is migrated in this phase:

- `backend/src/db/migrations/021_create_leaves.sql`
- `backend/src/repositories/leaveRepository.js`
- `backend/src/services/leaveService.js`
- minimal controller integration (`leaveController.js`,
  `attendanceController.js`, `shiftController.js`, `payrollController.js`,
  `employeeManagementController.js`, `priestController.js`)
- tests + documentation

**Not migrated:** Shifts, Payroll, Notifications, Events, Poojas, Prasadam,
Settings, Audit Logs, Attendance Setting / Attendance Location, Users/Employees
(2A), Accounting (2B), Bills (2C), Donations (2D), Bookings (2E), Pooja Bookings
(2F), Prasadam Orders (2G), Inventory Items/Batches/Logs/Consumption/Requests
(2H–2L), Purchase Orders (2M), Goods Received Notes (2N), Damage Notes (2O),
Assets (2P), Repairs (2Q), Rooms (2R), Attendance (2S). MongoDB is still present,
Mongoose is still the fallback. No Phase 2U work, no production data migration,
no dual writes and no global cutover happen here.

## Mongoose model inspected

`backend/src/models/Leave.js`:

```
staffId      String   required, trim
staffName    String   required, trim
reason       String   required, trim
leaveType    String   default 'General', trim
fromDate     String   required, trim
toDate       String   required, trim
status       String   enum ['Pending','Approved','Rejected'], default 'Pending'
adminReason  String   default '', trim
reviewedBy   String   default '', trim
reviewedAt   Date     default null
```

`timestamps: true` adds `createdAt` / `updatedAt`. The model declares **no**
indexes, **no** unique indexes, **no** `ref` relationships and **no** embedded
subdocuments or arrays.

## Complete Mongo → PostgreSQL mapping

| Mongo field | PostgreSQL column | PostgreSQL type | Nullable? | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| `_id` (ObjectId) | `id` | `TEXT` | NO | generated (24-hex, ObjectId-shaped) | Project convention from Phases 2A–2S |
| `staffId` | `staff_id` | `TEXT` | NO | — | Untyped identifier in Mongo; no `ref`, so no FK |
| `staffName` | `staff_name` | `TEXT` | NO | — | Display snapshot |
| `reason` | `reason` | `TEXT` | NO | — | Free text |
| `leaveType` | `leave_type` | `TEXT` | NO | `'General'` | Free text, not an enum |
| `fromDate` | `from_date` | `TEXT` | NO | — | Calendar key `YYYY-MM-DD` |
| `toDate` | `to_date` | `TEXT` | NO | — | Calendar key `YYYY-MM-DD` |
| `status` | `status` | `TEXT` | NO | `'Pending'` | CHECK: `Pending`, `Approved`, `Rejected` |
| `adminReason` | `admin_reason` | `TEXT` | NO | `''` | Review remark |
| `reviewedBy` | `reviewed_by` | `TEXT` | NO | `''` | Reviewer display name |
| `reviewedAt` | `reviewed_at` | `TIMESTAMPTZ` | YES | `NULL` | Real instant |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | NO | `now()` | Mongoose `timestamps` |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Refreshed by `updateById` |

## Date semantics

- `from_date` / `to_date` are **TEXT** calendar keys, not `DATE` or
  `TIMESTAMPTZ`. The Mongoose schema stores them as `String`, the frontend date
  inputs and `leaveController`'s `parseISODate` produce `YYYY-MM-DD`, and the
  application compares them as *text* in `$lte` / `$gte` range filters and sorts
  them as text. Converting to `DATE` would change the stored representation and
  the comparison/serialization behavior, so the type is preserved verbatim.
- Lexicographic comparison of `YYYY-MM-DD` is chronologically correct, so the
  range and overlap queries keep their exact meaning.
- `reviewed_at`, `created_at` and `updated_at` are **TIMESTAMPTZ** — real
  instants, round-tripped exactly (including sub-second precision).
- End dates are **inclusive**: a leave from `2026-03-10` to `2026-03-12` covers
  three calendar days, and the next non-overlapping leave may start on
  `2026-03-13`.
- Timezone: the calendar keys carry no zone, so month/year boundary queries are
  unaffected by session timezone. No leave date is converted to a timestamp and
  no leave-day calculation is changed.

## Leave-day calculation

The number of leave days is **derived, never stored**. No Mongo field holds a day
count, so no `days` column is added. `leaveController.getLeaveDaysCount` computes
the count from `fromDate` / `toDate` at read time (weekly-off aware, year-clamped),
and Phase 2T preserves that calculation untouched. There is no holiday calendar
and no new leave-calendar engine here.

Important: the migration deliberately does **not** reproduce the controller's
`reason.length >= 10`, future-date or `toDate >= fromDate` rules, because Mongo
itself does not enforce them — reproducing them would make PostgreSQL stricter
than the source of truth.

## Workflow

Statuses are exactly those declared by the Mongo enum: `Pending`, `Approved`,
`Rejected`. There is no `Cancelled`, `Withdrawn` or other state in the repository,
so none is added.

`leaveController.updateLeaveStatus` performs a generic `findByIdAndUpdate` patch:
any transition among the three enum values is permitted, and the caller supplies
`adminReason`, `reviewedBy` and `reviewedAt`. When the status returns to
`Pending`, the controller clears `adminReason` / `reviewedBy` (and the tests pin
that `reviewedAt` can be reset to `null`). Phase 2T reproduces those transitions
exactly.

## Half-day / partial leave

Not supported. The schema has no `halfDay`, `fromTime`, `toTime`, `isHalfDay` or
`dayPart` field, and no controller or frontend code references such a concept.
`days` is computed in whole calendar days. Nothing is invented.

## Leave balance / quota

There is **no** persisted balance. `leaveController.getEmployeeYearlyQuota`
resolves the yearly quota elsewhere and the "used" figure is recomputed on the
fly from non-`Rejected` leaves inside the current calendar year. Phase 2T keeps
that derivation in the controller and adds no balance table or duplicate state.

## Relationships

**None.** `Leave.staffId` / `staffName` are untyped display identifiers with no
`ref` in the Mongoose schema, so there is no real relationship to model. The
`leaves` table therefore declares **no foreign keys**. In particular, no FK is
created to `employees` — an employee rename or removal must not touch historical
leave records, and `staffId` is not guaranteed to correspond to an `Employee`
document. Adding one would be speculative and is out of scope for this phase.

## Embedded / subdocument structures

**None.** No arrays, nested objects, approval histories, attachments or repeating
data exist in the Leave schema. The single `leaves` table is therefore the whole
design; no child tables and no transactions are introduced.

## Overlap handling

Overlap prevention is a **service/controller-level** rule, not a database
constraint. `applyLeave` runs:

```js
Leave.findOne({
  staffId,
  status: { $ne: "Rejected" },
  fromDate: { $lte: toDate },
  toDate:   { $gte: fromDate },
})
```

The same shape is used by the attendance dashboard, the payroll summary, the
priest-conflict check and the employee history. Phase 2T reproduces this query
semantics in SQL (including `$ne`, `$lte`, `$gte`, `$in`, `$or`, `1 = 0` for
`$in: []` and the match-nothing behavior of the unmapped `staffEmail` branch) and
**deliberately adds no exclusion constraint or unique index**, because:

- the Mongo schema enforces neither, and
- `Rejected` and `Pending` rows legitimately coexist on the same dates.

Turning the check into a database constraint would change existing behavior.

## Constraints, indexes and nullability

Constraints:

- `leaves_pkey` PRIMARY KEY (`id`)
- `leaves_status_check` CHECK (`status IN ('Pending','Approved','Rejected')`) —
  the only Mongo-validated enum
- No UNIQUE constraint (Mongo declares no unique index)
- No foreign keys
- No date-ordering CHECK (Mongo does not enforce `toDate >= fromDate`)

Nullability and defaults come straight from the schema: the six `required` paths
plus the three defaulted text paths and the two timestamps are `NOT NULL`, with
`leave_type DEFAULT 'General'`, `status DEFAULT 'Pending'`,
`admin_reason DEFAULT ''`, `reviewed_by DEFAULT ''`, and
`created_at` / `updated_at DEFAULT now()`. `reviewed_at` is the only nullable
column.

Indexes (justified by actual query patterns):

| Index | Justifies |
| --- | --- |
| `idx_leaves_staff_id` | `GET /api/leaves/:staffId`, stats, today's-leave lookup |
| `idx_leaves_staff_id_created_at` | staff lists sorted `createdAt DESC` |
| `idx_leaves_staff_id_dates` | overlap + quota range filters per employee |
| `idx_leaves_status_dates` | approved-leave dashboards and payroll summaries |
| `idx_leaves_from_date_created_at` | `{ fromDate: -1, createdAt: -1 }` dashboards |

## Repository / service / fallback

`backend/src/repositories/leaveRepository.js` exposes exactly the operations the
application uses — `create`, `findById`, `findOne`, `findMany`, `updateById`,
`count` and `validate`. There is no `delete` because no leave delete path exists
in the repository, and no `getByEmployeeAndDateRange` beyond the Mongo filter
surface `findMany` already covers. All SQL is parameterized; sort keys come from a
whitelist and are never interpolated.

`backend/src/services/leaveService.js` is the datasource seam used by the
controllers. It reads `dbConfig.isDbConnected()` **at call time** (never
destructured at module load) and additionally requires PostgreSQL to be reachable
via `isPostgresConnected()`.

- PostgreSQL connected → the PostgreSQL repository is used.
- PostgreSQL unavailable → the existing Mongoose model is used.

One operation writes to exactly **one** datasource. There is no dual write, and
MongoDB/Mongoose is neither removed nor bypassed.

## Tests

- `backend/test/postgres-leaves.test.js` (19 tests) — the PostgreSQL path:
  full field round-trip, defaults, trimming, validation, TEXT calendar-key date
  semantics, one-day/multi-day/month/year boundaries, `reviewed_at` instant and
  null round-trip, overlap semantics (same-day, partial, adjacent, different
  employees, `Rejected` excluded), quota range, workflow transitions, partial
  updates, `$or` / `$in` / `$ne` filtering, sort whitelist, pagination, and
  no-dual-write assertions.
- `backend/test/postgres-leaves-fallback.test.js` (12 tests) — the Mongo
  fallback: datasource selection, every repository/service operation routing to
  the Mongoose model, operation with the `leaves` table missing, no PG residue,
  no dual write, and in-process seam flipping (proving no stale capture).
- `backend/test/postgres-migrate.test.js` — Phase 2T rollback/re-apply, column
  types and nullability, the single status CHECK, absence of UNIQUE/FK
  constraints, the five indexes, defaults, and confirmation that overlapping
  leave rows legitimately coexist.

## Migration

`021_create_leaves.sql` is the 21st migration (the previous latest was
`020_create_attendance.sql`). It is deterministic and idempotent
(`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), creates the single
`leaves` table with the five indexes and one CHECK, and does not alter any
previous migration. Rolling back is simulated by dropping `leaves` and deleting
its `schema_migrations` row, after which a re-run re-applies only `021` — this
cycle is covered by the migration tests.