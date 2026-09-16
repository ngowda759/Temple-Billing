# Phase 2U — PostgreSQL Shifts

Incremental, additive migration of the MongoDB **Shift/Shifts** domain to
PostgreSQL, following the architecture established in Phases 2A–2T.

There is exactly **one** live Shift entity in the repository —
`backend/src/models/Shift.js` — and it is the source of truth for this phase.
There is no `ShiftType`, `ShiftSchedule`, `ShiftRoster` or `ShiftBreak` model.

## Scope

Only the Shift domain is migrated in this phase:

- `backend/src/db/migrations/022_create_shifts.sql`
- `backend/src/repositories/shiftRepository.js`
- `backend/src/services/shiftService.js`
- minimal controller integration (`shiftController.js`,
  `attendanceController.js`)
- tests + documentation

**Not migrated:** Payroll, Notifications, Events, Poojas, Prasadam, Settings,
Audit Logs, Attendance Setting / Attendance Location, Suppliers, Recipes, Tasks
and ShiftAssignment, Users/Employees (2A), Accounting (2B), Bills (2C),
Donations (2D), Bookings (2E), Pooja Bookings (2F), Prasadam Orders (2G),
Inventory Items/Batches/Logs/Consumption/Requests (2H–2L), Purchase Orders
(2M), Goods Received Notes (2N), Damage Notes (2O), Assets (2P), Repairs (2Q),
Rooms (2R), Attendance (2S), Leaves (2T). MongoDB is still present, Mongoose is
still the fallback. No Phase 2V work, no production data migration, no dual
writes and no global cutover happen here.

## Mongoose model inspected

`backend/src/models/Shift.js`:

```
shiftName     String   required, trim
startTime     String   required, trim
endTime       String   required, trim
category      String   default 'General', trim
requiredStaff Number   default 1
active        Boolean  default true
notes         String   default '', trim
```

`timestamps: true` adds `createdAt` / `updatedAt`. The model declares **no**
indexes, **no** unique indexes, **no** `ref` relationships and **no** embedded
subdocuments or arrays.

## Complete Mongo → PostgreSQL mapping

| Mongo field | PostgreSQL column | PostgreSQL type | Nullable? | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| `_id` (ObjectId) | `id` | `TEXT` | NO | generated (24-hex, ObjectId-shaped) | Project convention from Phases 2A–2T |
| `shiftName` | `shift_name` | `TEXT` | NO | — | Required, trim. **Not unique** — see constraints |
| `startTime` | `start_time` | `TEXT` | NO | — | 12-hour meridiem time-of-day string; kept `TEXT`, see time semantics |
| `endTime` | `end_time` | `TEXT` | NO | — | Same representation; `end <= start` means overnight |
| `category` | `category` | `TEXT` | NO | `'General'` | Free text, no enum in Mongo → no CHECK |
| `requiredStaff` | `required_staff` | `NUMERIC` | NO | `1` | Mongo `Number` with no min → no integer cast, no CHECK |
| `active` | `active` | `BOOLEAN` | NO | `TRUE` | |
| `notes` | `notes` | `TEXT` | NO | `''` | Trimmed |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | NO | `now()` | Real instant |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Real instant, bumped on update |

Exactly 10 columns: `id` + the 7 schema fields + the 2 timestamps. Nothing is
invented. The model has no `shiftCode`, no `description`, no `shiftType`, no
`status`, no `breakDuration`, no `gracePeriod`, no `workingHours`, no overtime
threshold, no employee assignment array and no `createdBy` / `updatedBy`; those
names exist on `Task`, `ShiftAssignment`, `Attendance`, `Employee` and
`PayrollRecord` but **not** on `Shift`, so they are deliberately not columns.

## Time semantics

`startTime` / `endTime` are **not** timestamps and are **not** plain `TIME`
values.

The frontend form builds them as
`` `${Number(hour)}:${minute} ${meridiem}` `` — `"9:00 AM"`, `"5:00 PM"` — and
they are parsed back with `/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i`
(`ShiftManagement.jsx`), `/^(\d{1,2}):(\d{2})\s*(AM|PM)$/`
(`shiftController.parseTimeToMinutes`) and the same regex in
`attendanceController`. `serializeShift` returns them verbatim to the UI, and
they are copied into `Task.workingHours` / `durationMinutes` messages.

A PostgreSQL `TIME` column would silently rewrite `"9:00 AM"` into `"09:00:00"`,
breaking the API contract and the frontend parser. Both columns therefore stay
`TEXT` and round-trip byte-for-byte.

| Field | Type | Why |
| --- | --- | --- |
| `start_time` | `TEXT` | 12-hour meridiem display string; `TIME` would rewrite it |
| `end_time` | `TEXT` | Same |
| `created_at` | `TIMESTAMPTZ` | Real instant |
| `updated_at` | `TIMESTAMPTZ` | Real instant |

No timezone conversion is applied to the time-of-day strings, and no session
timezone affects them.

### Overnight behavior

Overnight shifts (for example `10:00 PM` → `6:00 AM`) **are** supported, purely
as a calculation: `shiftController.normalizeRange` adds 24 hours when
`end <= start` (`if (end <= start) end += 24 * 60`) and then computes
`durationMinutes`. `Shift.js` declares no ordering rule and the controller
never rejects such a pair.

The migration preserves this exactly: no CHECK forbids `end_time <= start_time`,
no type conversion normalizes the pair, and the tests pin that
`"10:00 PM"` → `"6:00 AM"` as well as the `12:00 AM` / `12:00 PM` boundaries
round-trip unchanged. The order-of-magnitude calculation itself is untouched
and stays in the controller.

### Working hours / duration

`Shift` stores **no** duration, break duration, grace period or overtime
threshold. `durationMinutes` exists only on `Task` and `ShiftAssignment`, and is
derived in `shiftController` from the two time strings. Nothing is duplicated
here; the existing derivation is preserved as-is.

## Relationships

**There are zero foreign keys in this phase, deliberately.**

| Source field | Referenced entity | Current Mongo behavior | PG table today? | FK in 2U? |
| --- | --- | --- | --- | --- |
| — | — | `Shift` has no reference field at all | — | — |
| `Employee.defaultShift` / `.shift` / `currentDuty.shift` | `Shift.shiftName` | Plain strings matched **by name**, case-insensitively, active only; may not match any Shift | `employees` exists | **No** — no id, may be absent, name-based |
| `Attendance.shiftRecord`? | — | `Attendance` has no `shiftId` at all; only denormalized `shift` / `shiftStartTime` / `shiftEndTime` strings | `attendance` exists | **No** — nothing to reference |
| `Task.shiftId` | `Shift._id` | Loose `String` with `index: true` and no `ref`; `deleteShift` runs `Task.deleteMany({ shiftId })` | `tasks` does **not** exist | **No** — would reference a table from a later phase |
| `Leave` | — | No shift field | `leaves` exists | **No** |

Because there are no FKs there are also no `ON DELETE` clauses. The
`deleteShift` cascade onto `Task` is an application-level `deleteMany` and
remains in `shiftController` unchanged.

## Embedded / subdocument structures

`Shift` has none — no arrays, no nested objects, no subdocuments. Nothing is
normalized. Employee assignments are **not** embedded in `Shift`: the live app
writes them to `Task` documents with denormalized shift fields, so no child
assignment table is created in this phase.

`backend/src/models/ShiftAssignment.js` is a legacy schema whose only consumer is
the offline one-off script `backend/scripts/migrateShiftAssignments.js`
(`ShiftAssignment` → `Task`). No controller, service, repository or route
references it, and the live application writes assignments to `Task` instead. It
is therefore **out of scope** for Phase 2U and is not migrated.

## Constraints

| Kind | Present? | Reason |
| --- | --- | --- |
| `PRIMARY KEY (id)` | Yes | The one constraint the table has |
| `UNIQUE (shift_name)` | **No** | `Shift.js` declares no unique index. `shiftName` is just `required, trim`, and `createShift`/`updateShift` have **no** duplicate-name guard. Mongo stores two shifts with the same name happily, so PostgreSQL must not prohibit them. |
| `CHECK` on `category` | **No** | Free text, no `enum` in Mongo |
| `CHECK` on `requiredStaff` | **No** | No `min` in Mongo; fractional and negative values are storable |
| `CHECK` on `start_time` / `end_time` | **No** | The `HH:MM AM/PM` shape is enforced by the frontend form, not by the schema — and an ordering CHECK would break overnight shifts |
| `FOREIGN KEY` | **No** | See relationships — every candidate is name-based or points at a table that does not exist |
| `NOT NULL` | Yes, on all 10 columns | `id` plus the 7 schema fields, all of which the write path always populates with a default when absent |

## Indexes

Each index is traced to a real query; none is speculative.

| Index | Serves |
| --- | --- |
| `idx_shifts_active` | `Shift.find({ active: true })` — `getAvailableEmployees` |
| `idx_shifts_shift_name_lower` | `Shift.findOne({ shiftName: /^name$/i, active: true })` — `attendanceController.resolveShiftDefinition`; the functional `lower()` index serves the case-insensitive equality |
| `idx_shifts_created_at` | `Shift.find().sort({ createdAt: -1 })` — `getShifts`, `getShiftDashboard` |
| `idx_shifts_active_created_at` | `Shift.findOne({ shiftName, active: true }).sort({ createdAt: -1 })` — `assignShift` default-shift conflict check |
| `idx_shifts_active_updated_at_created_at` | `Shift.findOne({ shiftName: /^name$/i, active: true }).sort({ updatedAt: -1, createdAt: -1 })` — the resolution ordering, materialised |

There is deliberately **no** index on `category` or `notes`: no query filters or
sorts on them.

## Repository / service

`shiftRepository.js` implements only the operations the application actually
uses:

| Method | Mirrors |
| --- | --- |
| `findById(id)` | `Shift.findById` |
| `findOne(filter, sort)` | `Shift.findOne({...}).sort({...})` |
| `findMany({ filter, sort, limit, offset })` | `Shift.find(...).sort(...)` + `limit`/`skip` |
| `create(data)` | `Shift.create` |
| `updateById(id, updates)` | `Shift.findByIdAndUpdate(id, payload, { new: true })` — the PostgreSQL-persistence half of the loaded-document `save()` `updateShift` performs |
| `destroy(id)` | `Shift.findByIdAndDelete` |
| `count(filter)` | `Shift.countDocuments` |
| `validate(data)` | the schema's `required` checks |

Every value is bound as a parameter. The `shiftName` filter resolves the
anchored case-insensitive `RegExp` that `resolveShiftDefinition` builds into
`lower(shift_name) = lower($n)`; any other pattern shape falls back to a
parameterized `ILIKE ... ESCAPE '\'` with the source treated as a literal, so no
part of a pattern is ever interpolated. Sorting goes through a fixed camelCase →
column whitelist, so an unknown or injection-shaped sort key is dropped and the
default order applies.

`shiftService.js` is the datasource seam:

```js
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};
```

`isDbConnected()` is read through the config module at call time (never
destructured at require time), so tests can swap it after load. PostgreSQL is
used only when the seam is connected **and** PostgreSQL is reachable; otherwise
the existing Mongoose model handles the operation. Each operation touches
**exactly one** datasource — there are no dual writes.

Controller integration is minimal:

- `shiftController.js` — the `Shift` model import is replaced by `shiftService`
  across `getShiftDashboard`, `getShifts`, `createShift`, `updateShift`,
  `deleteShift`, `assignShift` and `getAvailableEmployees`. All validation,
  conflict detection, notification and email behavior is unchanged, and the
  `Task.deleteMany({ shiftId })` cascade stays where it was.
- `attendanceController.js` — `resolveShiftDefinition` and the active-shift list
  now read through `shiftService` with the same filters and sorts.

No other domain was modified.

## Tests

| File | Covers |
| --- | --- |
| `test/postgres-shifts.test.js` | PostgreSQL path: full field round-trip, non-persisted fields absent, defaults, trimming, validation, time semantics, overnight shifts, midnight boundaries, instants, the `{ shiftName, active }` and anchored case-insensitive RegExp lookups, active scans, standing sorts, filters/`$in`/pagination, update/delete semantics, duplicate names, no-dual-write assertions |
| `test/postgres-shifts-controllers.test.js` | Controller integration: the real `shiftController` handlers on the PostgreSQL path (create/list/update/delete, the `serializeShift` field set, 400/404 responses, the `Task.deleteMany({ shiftId })` cascade, single-datasource writes) and on the Mongo fallback |
| `test/postgres-shifts-fallback.test.js` | Mongo fallback: datasource selection, Mongoose routing for every repository/service method, validation on the fallback branch, fallback needing no table, no-dual-write assertions, datasource-seam flipping in-process |
| `test/postgres-migrate.test.js` | Phase 2U migration: columns/types/nullability, absence of UNIQUE/CHECK/FK, index set, defaults, duplicate-name coexistence, overnight storable, rollback and re-apply |

## Verification summary

- Shift model inspected: `backend/src/models/Shift.js`
- PostgreSQL table: `shifts`
- Migration: `022_create_shifts.sql` (latest was `021_create_leaves.sql`)
- Files added: `022_create_shifts.sql`, `shiftRepository.js`, `shiftService.js`,
  `test/postgres-shifts.test.js`, `test/postgres-shifts-fallback.test.js`,
  `test/postgres-shifts-controllers.test.js`, `docs/postgres-shifts-phase-2u.md`
- Files changed: `shiftController.js`, `attendanceController.js`, `package.json`,
  `test/postgres-migrate.test.js`, `test/postgres-repositories.test.js`,
  `test/postgres-attendance.test.js`, `test/postgres-leaves.test.js`,
  `docs/postgres-migration.md`, `README.md`
- MongoDB remains intact, Mongoose remains the fallback, no production data
  migration, no dual writes, no cutover, no Phase 2V work.