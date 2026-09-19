# Phase 2AA — Settings (attendance_settings + priest_settings)

Phase 2AA migrates the two remaining Mongoose models whose schema names end in
`Setting`. They are **independent stores** and are migrated together because they
are the same domain area (temple/attendance configuration and per-priest
preferences), not because they share a table.

- Migration: `backend/src/db/migrations/028_create_settings.sql`
- Repositories: `backend/src/repositories/attendanceSettingRepository.js`,
  `backend/src/repositories/priestSettingRepository.js`
- Services: `backend/src/services/attendanceSettingService.js`,
  `backend/src/services/priestSettingService.js`

This phase is **additive**. MongoDB/Mongoose remains the source of truth and the
fallback path for both entities. There is no cutover, no production data
migration and no dual write.

## 1. The two entities

### `AttendanceSetting` — a global singleton

`backend/src/models/AttendanceSetting.js` is a flat, fixed-shape document holding
the temple attendance geofence and the attendance time thresholds.

| Mongo field | Type | Required | Default |
|---|---|---|---|
| `templeLatitude` | Number | yes | `0` |
| `templeLongitude` | Number | yes | `0` |
| `allowedRadius` | Number | yes | `100` (metres) |
| `lateThreshold` | Number | yes | `15` (minutes) |
| `earlyCheckInWindow` | Number | yes | `30` (minutes) |
| `createdAt` / `updatedAt` | Date | auto | auto |

There are **no arrays, no sub-documents, no ObjectId references, no enums and no
`min` validators**. The schema declares **no indexes at all** — not even a unique
one — so the "singleton" is an application convention (`findOne()`), not a
database constraint. Multiple rows are physically possible in MongoDB today.

Real usage, all direct against the model before this phase:

- `attendanceSettingsController.getSettings` (`GET /api/attendance/settings`,
  authenticated) — `findOne()`, creating `{}` when absent.
- `attendanceSettingsController.updateSettings` (`POST /api/attendance/settings`,
  authenticated + admin) — `findOne()`, then `body.x ?? settings.x` per field and
  `save()`, or `create(req.body)` when absent. Note the route is a **POST**; the
  verb is unrelated to the persistence shape and was not changed.
- `attendanceController.markAttendance` (`POST /api/staff/attendance/mark`) —
  read-only, for the haversine geofence check.
- `frontend/src/pages/admin/employee/AttendanceSettings.jsx` — edits
  `lateThreshold` / `earlyCheckInWindow`; the location list it also renders comes
  from the separate `AttendanceLocation` entity, which is **not** part of this
  phase.

### `PriestSetting` — one document per priest

`backend/src/models/PriestSetting.js` is a flat preferences record keyed by the
priest's Employee id.

| Mongo field | Type | Required | Default |
|---|---|---|---|
| `priestId` | ObjectId → `Employee` | yes | — (`unique: true`) |
| `smsNotifications` | Boolean | no | `true` |
| `dutyReminders` | Boolean | no | `true` |
| `calendarWidget` | Boolean | no | `true` |
| `agamaReferenceModule` | Boolean | no | `false` |
| `createdAt` / `updatedAt` | Date | auto | auto |

Note the asymmetry: three toggles default `true`, one defaults `false`. The
schema's only business index is the unique on `priestId`.

Real usage: `priestController.getSettings` (`GET /api/priest/settings`) and
`priestController.updateSettings` (`PUT /api/priest/settings`), both behind the
router-wide `authenticate` + `authorizeRoles("priest")`, both lazily creating the
document on first access.

## 2. Not part of this phase

- `frontend/src/pages/admin/SettingsManagement.jsx` stores temple name/address
  and the notification toggles in `localStorage` only. There is no backend call
  and no MongoDB domain behind it.
- `/api/pooja-settings` is a different, already-migrated domain
  (`pooja_material_requirements`, Phase 2Y).
- `AttendanceLocation` is a separate entity, deliberately left out (it is listed
  separately in `postgres-migration.md`).
- Neither model contains credentials, tokens, passwords or API keys, so there are
  no sensitive values to protect in this phase.

## 3. PostgreSQL design

Two tables, one per model, with a normalized relational column per field. JSONB
and key/value layouts were rejected: both schemas are flat, fully-typed and
fixed-shape, so there is no flexible key space to model.

### `attendance_settings`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | TEXT | NOT NULL | — (PK, 24-hex) |
| `temple_latitude` | NUMERIC | NOT NULL | `0` |
| `temple_longitude` | NUMERIC | NOT NULL | `0` |
| `allowed_radius` | NUMERIC | NOT NULL | `100` |
| `late_threshold` | NUMERIC | NOT NULL | `15` |
| `early_check_in_window` | NUMERIC | NOT NULL | `30` |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `now()` |

### `priest_settings`

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | TEXT | NOT NULL | — (PK, 24-hex) |
| `priest_id` | TEXT | NOT NULL | — |
| `sms_notifications` | BOOLEAN | NOT NULL | `TRUE` |
| `duty_reminders` | BOOLEAN | NOT NULL | `TRUE` |
| `calendar_widget` | BOOLEAN | NOT NULL | `TRUE` |
| `agama_reference_module` | BOOLEAN | NOT NULL | `FALSE` |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `now()` |

Constraints: `priest_settings` carries
`CONSTRAINT priest_settings_priest_id_key UNIQUE (priest_id)`, reproducing Mongo's
`unique: true`. `attendance_settings` deliberately declares **no** unique
constraint, because the Mongo schema declares none and a `CHECK` cannot express
"at most one row".

Indexes: the two primary keys plus `priest_settings_priest_id_key`. Nothing else
is added — `attendance_settings` is only ever read with a bare `findOne()` and
`priest_settings` only with `findOne({ priestId })`, so no non-key column is ever
filtered or sorted on. The unique index on `priest_id` already serves that
lookup.

**Foreign keys: none.** `priestId` is a real `ref: 'Employee'` and `employees`
does exist, but the live employee-creation paths write with `Employee.create(...)`
and never touch PostgreSQL, so a priest's employee row is routinely absent. An FK
would reject writes MongoDB accepts. This repeats the decision already documented
in `020_create_attendance.sql`, `021_create_leaves.sql` and
`023_create_payroll_records.sql` for the same identity space. With no foreign
keys there is no `ON DELETE` behaviour and no cascade.

### Type choices

- Every numeric path is `NUMERIC`, not float/real, so the geofence coordinates
  and thresholds round-trip exactly.
- The four toggles are genuine `BOOLEAN` columns.
- `JSONB` is not used anywhere in this phase.

## 4. Field mapping

`AttendanceSetting`:

| MongoDB | PostgreSQL | Type | Transformation |
|---|---|---|---|
| `_id` | `id` | TEXT | ObjectId → 24-hex string |
| `templeLatitude` | `temple_latitude` | NUMERIC | Number → numeric |
| `templeLongitude` | `temple_longitude` | NUMERIC | Number → numeric |
| `allowedRadius` | `allowed_radius` | NUMERIC | Number → numeric |
| `lateThreshold` | `late_threshold` | NUMERIC | Number → numeric |
| `earlyCheckInWindow` | `early_check_in_window` | NUMERIC | Number → numeric |
| `createdAt` | `created_at` | TIMESTAMPTZ | Date → timestamptz |
| `updatedAt` | `updated_at` | TIMESTAMPTZ | Date → timestamptz |

`PriestSetting`:

| MongoDB | PostgreSQL | Type | Transformation |
|---|---|---|---|
| `_id` | `id` | TEXT | ObjectId → 24-hex string |
| `priestId` | `priest_id` | TEXT | ObjectId → 24-hex string (UNIQUE, no FK) |
| `smsNotifications` | `sms_notifications` | BOOLEAN | Boolean |
| `dutyReminders` | `duty_reminders` | BOOLEAN | Boolean |
| `calendarWidget` | `calendar_widget` | BOOLEAN | Boolean |
| `agamaReferenceModule` | `agama_reference_module` | BOOLEAN | Boolean |
| `createdAt` | `created_at` | TIMESTAMPTZ | Date → timestamptz |
| `updatedAt` | `updated_at` | TIMESTAMPTZ | Date → timestamptz |

Every persisted field is accounted for; no column is invented.

## 5. Datasource selection

Both services use **Gate B** — the same gate as Phase 2G onward:

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

PostgreSQL is used only when MongoDB is connected **and** PostgreSQL is actually
reachable. The datasource seam is read through the config module at call time
(`const isConnected = () => dbConfig.isDbConnected()`), never destructured at
module load, so tests can flip it in-process without a reload.

## 6. Preserved behaviour

- **Lazy creation.** `GET` still materialises the document with schema defaults
  on first read, on both datasources.
- **Defaults.** `0/0/100/15/30` and `true/true/true/false` are applied
  identically. An existing row is never re-defaulted.
- **Update semantics.** `body.x ?? settings.x` is preserved: an omitted **or
  null** field keeps its stored value. `false` is honoured and never treated as
  "absent".
- **Singleton resolution.** `attendance_settings.findOne` returns the oldest row
  (`ORDER BY created_at ASC, id ASC LIMIT 1`), mirroring Mongo's natural
  `findOne` when more than one row exists.
- **Response shapes.** `{ success, settings }`, `{ success, message, settings }`,
  the unenveloped priest `GET`, and every status code are unchanged.
- **Precedence.** Unchanged. `markAttendance` still prefers the employee's own
  `attendanceLocation` over the global temple coordinates, and still marks
  `locationVerified = true` without a distance computation when the global
  coordinates are both `0`.
- **Caching.** None existed and none was added.
- **Delete / reset.** Neither controller exposes a delete or reset, so no
  `destroy` method was added to either repository.
- **Boolean cast parity.** The repository reproduces Mongoose's exact cast:
  only the literal strings `'false'` and `'0'` become `false`; `'FALSE'`, `'No'`,
  `'off'` and `'  false  '` all become `true`, matching the model.

One divergence is documented deliberately: an explicit `null` written to a
`PriestSetting` toggle is coerced to the schema default rather than stored as
`NULL`. Every Phase 2 migration represents a Boolean path that declares a
`default` as `NOT NULL DEFAULT <default>` (see `notifications.viewed` /
`read` / `emailSent`), and no caller sends `null` here.

## 7. Tests

- `backend/test/postgres-settings.test.js` — the PostgreSQL path (repository,
  service, defaults, update semantics, validation, constraints, controller
  response shapes, no dual writes, dynamic switching).
- `backend/test/postgres-settings-fallback.test.js` — the MongoDB fallback,
  routing to the exact Mongoose calls, no dual writes, the
  PostgreSQL → MongoDB → PostgreSQL round-trip, and in-process switching.
- `backend/test/postgres-migrate.test.js` — extended with the Phase 2AA
  migration apply / schema / constraint / index / rollback assertions, and the
  hard-coded migration count and filename list updated from 27 to 28.