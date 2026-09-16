-- Phase 2S: attendance (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/Attendance.js and every real usage of the
-- Attendance model:
--   * Attendance.js — the Mongoose model: staffId (String, required, trim,
--     index), staffName (String, required, trim), employeeId (String, trim,
--     index), staffEmail (String, trim, lowercase), dateKey (String, required,
--     trim, index), checkIn (String, default '--', trim), checkOut (String,
--     default '--', trim), checkInAt (Date, default null), checkOutAt (Date,
--     default null), shift (String, default 'Morning', trim), shiftStartTime
--     (String, default '', trim), shiftEndTime (String, default '', trim),
--     assignmentType (String, default '', trim), dutyName (String, default '',
--     trim), dutyArea (String, default '', trim), status (String, 10-value
--     enum, default 'Absent'), isLateCheckIn (Boolean, default false),
--     workingMinutes (Number, default 0), workingHours (String, default '--',
--     trim), overtimeMinutes (Number, default 0), overtimeHours (String,
--     default '--', trim), isOvertime (Boolean, default false), note (String,
--     default '', trim), source (String, default 'manual', trim), correctedBy
--     (String, default '', trim), correctionDate (Date, default null),
--     correctionReason (String, default '', trim), latitude (Number, default
--     null), longitude (Number, default null), locationVerified (Boolean,
--     default false), faceVerified (Boolean, default false),
--     distanceFromTemple (Number, default null), deviceInfo (String, default
--     ''), browser (String, default ''), ipAddress (String, default ''),
--     checkInPhoto (String, default ''), checkOutPhoto (String, default ''),
--     timestamps. There are NO virtuals and NO embedded sub-documents.
--     schema.index({ staffId: 1, dateKey: 1 }, { unique: true }) is the only
--     unique index; employeeId+dateKey and staffEmail+dateKey are non-unique.
--   * attendanceController.js — markAttendance (POST /api/staff/attendance/mark)
--     writes a check-in payload (status 'Pending', source 'biometric') through
--     Attendance.create, or reuses the existing same-day document via
--     Attendance.findByIdAndUpdate(...{ upsert: true }); the check-out branch
--     mutates the loaded Mongoose document and calls attendance.save(),
--     computing workingMinutes from checkInAt and the stored overtimeMinutes
--     when isOvertime is set. updateAttendance (PUT /api/staff/attendance/:id)
--     loads the record by id, recomputes workingMinutes from the corrected
--     check-in/check-out clock strings and stamps correctedBy / correctionDate
--     / correctionReason / source 'admin-correction' through document.save().
--     buildDashboardResponse / buildAdminAttendanceDashboard read with
--     Attendance.find(await buildAttendanceQuery(...)).sort({ dateKey: -1,
--     createdAt: -1 }) and
--     Attendance.find({ dateKey: { $gte, $lte } }).sort({ dateKey: -1,
--     createdAt: -1 }).
--   * buildAttendanceQuery — the standing lookup shape is
--     { $or: [{ staffId: { $in: [...] } }, { employeeId: { $in: [...] } },
--     { staffEmail: { $in: [...] } }] } plus either dateKey equality or a
--     dateKey { $gte, $lte } range.
--   * shiftController.js — getAttendanceForAssignment uses
--     Attendance.findOne({ dateKey, $or: [{ staffId: { $in } },
--     { employeeId: { $in } }, { staffEmail: { $in } }] }).
--   * employeeManagementController.js — getEmployeeById reads
--     Attendance.find({ $or: [...] }).sort({ dateKey: -1 }).limit(100).
--   * payrollController.js — loadPayrollContext / payroll generation read
--     Attendance.find({ dateKey: { $gte: startKey, $lte: endKey } }) and
--     aggregate workingMinutes / overtimeMinutes / isOvertime in JS. Nothing
--     is aggregated in the database.
--   * frontend/src/services/attendanceService.js + the staff/admin attendance
--     pages consume those three endpoints only; no additional field is read.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by attendanceRepository, reachable through attendanceService)
-- that is selected only when the service is used AND PostgreSQL is reachable.
-- MongoDB stays the source of truth and the fallback path; no Mongo →
-- PostgreSQL switch happens anywhere in the application and no production data
-- is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — attendance (every persisted Mongo field):
--   * _id              → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * staffId          → staff_id TEXT NOT NULL (required, trim; the
--                        employee/user identifier — see the identity note)
--   * staffName        → staff_name TEXT NOT NULL (required, trim)
--   * employeeId       → employee_id TEXT (optional, trim; the same identity
--                        space as staffId, stored separately by the schema)
--   * staffEmail       → staff_email TEXT (optional, trim, lowercase)
--   * dateKey          → date_key TEXT NOT NULL (required, trim; the calendar
--                        day the record belongs to — see date semantics)
--   * checkIn          → check_in TEXT NOT NULL DEFAULT '--' (trim)
--   * checkOut         → check_out TEXT NOT NULL DEFAULT '--' (trim)
--   * checkInAt        → check_in_at TIMESTAMPTZ (nullable, default null)
--   * checkOutAt       → check_out_at TIMESTAMPTZ (nullable, default null)
--   * shift            → shift TEXT NOT NULL DEFAULT 'Morning' (trim)
--   * shiftStartTime   → shift_start_time TEXT NOT NULL DEFAULT '' (trim)
--   * shiftEndTime     → shift_end_time TEXT NOT NULL DEFAULT '' (trim)
--   * assignmentType   → assignment_type TEXT NOT NULL DEFAULT '' (trim)
--   * dutyName         → duty_name TEXT NOT NULL DEFAULT '' (trim)
--   * dutyArea         → duty_area TEXT NOT NULL DEFAULT '' (trim)
--   * status           → status TEXT NOT NULL DEFAULT 'Absent', CHECK over the
--                        exact 10-value Mongo enum
--   * isLateCheckIn    → is_late_check_in BOOLEAN NOT NULL DEFAULT FALSE
--   * workingMinutes   → working_minutes NUMERIC NOT NULL DEFAULT 0
--   * workingHours     → working_hours TEXT NOT NULL DEFAULT '--' (trim)
--   * overtimeMinutes  → overtime_minutes NUMERIC NOT NULL DEFAULT 0
--   * overtimeHours    → overtime_hours TEXT NOT NULL DEFAULT '--' (trim)
--   * isOvertime       → is_overtime BOOLEAN NOT NULL DEFAULT FALSE
--   * note             → note TEXT NOT NULL DEFAULT '' (trim)
--   * source           → source TEXT NOT NULL DEFAULT 'manual' (trim)
--   * correctedBy      → corrected_by TEXT NOT NULL DEFAULT '' (trim)
--   * correctionDate   → correction_date TIMESTAMPTZ (nullable, default null)
--   * correctionReason → correction_reason TEXT NOT NULL DEFAULT '' (trim)
--   * latitude         → latitude NUMERIC (nullable, default null)
--   * longitude        → longitude NUMERIC (nullable, default null)
--   * locationVerified → location_verified BOOLEAN NOT NULL DEFAULT FALSE
--   * faceVerified     → face_verified BOOLEAN NOT NULL DEFAULT FALSE
--   * distanceFromTemple → distance_from_temple NUMERIC (nullable, default
--                        null)
--   * deviceInfo       → device_info TEXT NOT NULL DEFAULT ''
--   * browser          → browser TEXT NOT NULL DEFAULT ''
--   * ipAddress        → ip_address TEXT NOT NULL DEFAULT ''
--   * checkInPhoto     → check_in_photo TEXT NOT NULL DEFAULT ''
--   * checkOutPhoto    → check_out_photo TEXT NOT NULL DEFAULT ''
--   * createdAt        → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt        → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted Mongo fields: none. Every persisted field on the
-- Attendance schema has an explicit column above, and there are exactly 40
-- columns (id + the 37 schema fields + the two timestamps).
-- Conversely, no field is invented: the Attendance model has no shiftId, no
-- leaveId, no taskId, no approval/regularization workflow fields, no
-- break/segment arrays, no overtime rate, no working-day fraction, no payroll
-- link, no createdBy/updatedBy and no JSON metadata. Those names do exist on
-- other entities (Task.shiftId, Leave.*, PayrollRecord.*) but not here, so they
-- are deliberately NOT columns. Confirmed by probing Attendance.schema: the
-- persisted key set is exactly the 37 fields listed above.
--
-- Identity note (employee/user identifier): Attendance does NOT hold a real
-- foreign-key-style reference. `staffId` / `employeeId` are free Strings that
-- the write path fills with a User id OR an Employee id OR, when neither
-- resolves, the caller-supplied raw value (attendanceController
-- resolveStaffContext: `user?._id ?? employee?._id ?? clean(staffId)`), and the
-- read paths deliberately match ANY of { staffId, employeeId, staffEmail } and
-- compare against both the User id and the Employee id
-- (getStaffAttendanceTargets / buildAttendanceQuery). There is therefore no
-- single referenced table to point a foreign key at, and `users` / `employees`
-- remain Mongo-backed as their source of truth. Both identifiers stay plain
-- indexed TEXT with NO FK — the same convention as
-- users.employee_id / goods_received_notes.received_by /
-- damage_notes.reported_by. No employee data is duplicated: the columns store
-- the identifier the application already stores, and staffName/staffEmail are
-- the denormalized historical snapshot the Mongo schema itself declares (they
-- are read back verbatim by every dashboard).
--
-- Date semantics (deliberate, per field):
--   * date_key is TEXT, NOT DATE. The Mongo schema declares dateKey as a
--     String and the field is a *date key*, not a date value: it is compared,
--     sorted and range-scanned as text (`dateKey: { $gte, $lte }`,
--     `sort({ dateKey: -1 })`, cross-year string comparisons in
--     payrollController) and it is produced by `new Date().toISOString()
--     .slice(0, 10)` (attendanceController.toDateKey), i.e. it is the UTC
--     calendar day of an instant. Keeping TEXT preserves those exact
--     lexicographic comparisons and the exact 'YYYY-MM-DD' round trip. A DATE
--     column would silently shift the value through the server timezone on
--     read, which is precisely the UTC/local-date bug this phase must avoid.
--     This mirrors bookings.datetime (TEXT, Phase 2E) and
--     account_transactions.date — the same "calendar key stored as a
--     timezone-free string" decision. The column has a CHECK that pins the
--     shape to 'YYYY-MM-DD' (plus NULL-free) so the text contract stays
--     enforced, matching what every write path and filter already assumes.
--   * check_in_at / check_out_at / correction_date are TIMESTAMPTZ. The Mongo
--     schema declares them as real `Date` values holding an absolute instant
--     (attendanceController writes `now`, and `new Date(attendance.checkInAt)`
--     is subtracted directly from the current time to compute
--     workingMinutes). TIMESTAMPTZ round-trips the instant exactly.
--   * created_at / updated_at are TIMESTAMPTZ (timestamps: true).
--   * check_in / check_out are TEXT because the Mongo schema declares them as
--     display clock strings (e.g. '09:37 AM', default '--'), produced by
--     `toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })`.
--     They are NOT instants; the companion check_*_at columns carry the
--     instant. Converting them to TIME/TIMESTAMPTZ would change the stored
--     12-hour formatted value the API and dashboards return verbatim, so they
--     stay TEXT. This is the single most important date/time decision in this
--     phase: only the `Date`-typed paths become TIMESTAMPTZ.
--
-- Durations: workingMinutes / overtimeMinutes are stored Numbers in Mongo (the
-- application writes them and reads them back to compute payroll), so they are
-- persisted columns — NUMERIC to preserve the value exactly. No >= 0 CHECK is
-- added: the schema declares no `min`, and while the check-out and correction
-- paths clamp with Math.max(0, …), Mongoose itself never rejects a negative, so
-- adding one would make PostgreSQL stricter than the source of truth. The
-- corresponding workingHours / overtimeHours display strings ('--', '7h 30m',
-- produced by formatWorkingHours) are also stored in Mongo and stay TEXT.
-- Nothing is newly derived: the formulas live in the controller and are
-- untouched; no duplicate computed column is introduced.
--
-- latitude / longitude / distanceFromTemple are NUMERIC (Mongo Numbers with no
-- min; nullable because they default to null). NUMERIC keeps the exact decimal
-- value; a floating-point column could not round-trip the coordinates exactly.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * attendance.status: ['Present', 'Absent', 'Half Day', 'Leave', 'Pending',
--     'Working', 'Holiday', 'Late', 'Weekly Off', 'Compensatory Off'] — default
--     'Absent'. No value is renamed and none is added. Note that some of these
--     are only ever produced by the read paths (getEffectiveStatus derives
--     'Working' / 'Late' / 'Holiday' in memory); they are in the schema enum and
--     are preserved verbatim, but the API's normalizeAttendanceStatus still
--     collapses unknown values to 'Absent' exactly as before.
--   * There is no CHECK on staffId/staffName/employeeId/staffEmail/dateKey/
--     checkIn/checkOut/shift/shiftStartTime/shiftEndTime/assignmentType/
--     dutyName/dutyArea/workingHours/overtimeHours/note/source/correctedBy/
--     correctionReason/deviceInfo/browser/ipAddress/checkInPhoto/
--     checkOutPhoto because Mongo declares no enum for them.
--
-- Uniqueness semantics: the Attendance schema declares exactly ONE unique index
-- — `{ staffId: 1, dateKey: 1 }` with `{ unique: true }` — so exactly one UNIQUE
-- constraint is reproduced here on (staff_id, date_key). That is the business
-- key: one attendance record per staff identifier per calendar day, enforced by
-- the model even though the controller's find-then-create/upsert flow normally
-- prevents a collision. The values are text-normalized (staffId trimmed,
-- dateKey trimmed) before comparison so PostgreSQL's byte-equality matches
-- Mongo's trimmed-field equality for the values the application actually
-- writes. The non-unique employeeId+dateKey and staffEmail+dateKey indexes are
-- reproduced as non-unique indexes, NOT as UNIQUE constraints — Mongo allows
-- several rows to share an employeeId or an email on the same day, and
-- widening either to UNIQUE would reject records the source of truth accepts.
--
-- Nullability honesty: staff_id / staff_name / date_key are NOT NULL because
-- the Mongo schema marks them `required: true` and every real write supplies
-- them (markAttendance always derives staffId/staffName/dateKey). Every other
-- String/Boolean/Number column is NOT NULL with the schema's own default,
-- because Mongoose applies those defaults on every insert — a Mongoose document
-- without checkIn/status/workingMinutes/... is stored with '--'/'Absent'/0, so a
-- PostgreSQL row created without them is identical. check_in_at /
-- check_out_at / correction_date / latitude / longitude / distance_from_temple
-- stay nullable because the schema explicitly defaults them to null and the
-- check-out / correction paths write null back (updateAttendance sets
-- checkInAt/checkOutAt to null when the clock string is cleared).
-- `required: true` on a trimmed String path also rejects the empty string in
-- Mongoose (trim runs before the required check), so staff_id/staff_name/
-- date_key reject whitespace-only values at both layers.
--
-- Embedded data: none. The Attendance schema has no arrays and no
-- sub-documents (no check-in/check-out sessions, no break segments, no
-- work-segment list, no corrections history, no approval history), so there is
-- no child table and no JSONB column. The correction fields (corrected_by /
-- correction_date / correction_reason) are flat scalars on the document — the
-- model keeps only the LAST correction, it is not an append-only history — and
-- are therefore flat columns. No transaction is needed because every
-- attendance operation is a single-row write.
--
-- Foreign keys: NONE, because the model declares no real relationship to a
-- PostgreSQL-backed table (see the identity note above). Specifically no FK is
-- invented for:
--   * staffId / employeeId — a free String that may hold a User id, an Employee
--     id or a raw caller value, matched with $or across three columns; and both
--     users and employees are still Mongo-backed as their source of truth, so
--     the referenced row is routinely absent from PostgreSQL.
--   * shift / shiftStartTime / shiftEndTime / assignmentType — plain strings
--     denormalized onto the record. There is no shiftId column on the model,
--     and the Shift/Task domains are not migrated in this phase.
--   * Leave — attendance has no leave reference at all. The controller looks
--     leave up separately against the Leave collection and only overlays the
--     status in memory; nothing is stored on the attendance row.
--   * PayrollRecord / Task — no reference exists on the model.
-- Because there are no foreign keys, there is no ON DELETE behaviour to
-- document, and deleting an attendance row never cascades into, blocks, or
-- mutates any other table. That mirrors Mongo exactly.
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * attendance_staff_id_date_key_key — the UNIQUE constraint replicating
--     Mongo's { staffId, dateKey } unique index. It is also the access path for
--     the same-day lookup performed by markAttendance and
--     getAttendanceForAssignment, and it already serves the leading-staffId
--     equality that the model's separate `staffId` index covered, so no
--     separate single-column index on staff_id is added.
--   * idx_attendance_employee_id_date_key — the non-unique { employeeId,
--     dateKey } Mongo index. buildAttendanceQuery matches employeeId via
--     `employeeId: { $in: [...] }` and the dashboards always pair it with a
--     dateKey equality or range.
--   * idx_attendance_staff_email_date_key — the non-unique { staffEmail,
--     dateKey } Mongo index. buildAttendanceQuery matches staffEmail via
--     `staffEmail: { $in: [...] }` with the same dateKey pairing.
--   * idx_attendance_date_key — the standing dateKey access path on its own:
--     the admin dashboard and the payroll generator read the whole month with
--     `dateKey: { $gte: startKey, $lte: endKey }` (no staff filter), which a
--     staffId-leading composite index cannot serve.
--   * idx_attendance_date_key_created_at — the `sort({ dateKey: -1,
--     createdAt: -1 })` ordering every dashboard list uses, materialised as a
--     (date_key DESC, created_at DESC) index.
-- No index is added for status / shift / source / is_overtime: no server-side
-- query filters on them (the admin status filter is applied in JS after the
-- monthly read, and the dashboards never query by shift).

CREATE TABLE IF NOT EXISTS attendance (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: staffId String — required, trim. Identity column; see the header
  -- identity note (no FK).
  staff_id TEXT NOT NULL,
  -- Mongo: staffName String — required, trim. Historical snapshot.
  staff_name TEXT NOT NULL,
  -- Mongo: employeeId String — optional, trim (same identity space as staffId).
  employee_id TEXT,
  -- Mongo: staffEmail String — optional, trim, lowercase.
  staff_email TEXT,
  -- Mongo: dateKey String — required, trim. Calendar day key ('YYYY-MM-DD'),
  -- kept as TEXT so lexicographic queries and UTC date keys are preserved
  -- exactly (see the date semantics note).
  date_key TEXT NOT NULL,
  -- Mongo: checkIn String — default '--', trim. Display clock string
  -- (e.g. '09:37 AM'), not an instant.
  check_in TEXT NOT NULL DEFAULT '--',
  -- Mongo: checkOut String — default '--', trim.
  check_out TEXT NOT NULL DEFAULT '--',
  -- Mongo: checkInAt Date — default null. Absolute instant.
  check_in_at TIMESTAMPTZ,
  -- Mongo: checkOutAt Date — default null. Absolute instant.
  check_out_at TIMESTAMPTZ,
  -- Mongo: shift String — default 'Morning', trim.
  shift TEXT NOT NULL DEFAULT 'Morning',
  -- Mongo: shiftStartTime String — default '', trim.
  shift_start_time TEXT NOT NULL DEFAULT '',
  -- Mongo: shiftEndTime String — default '', trim.
  shift_end_time TEXT NOT NULL DEFAULT '',
  -- Mongo: assignmentType String — default '', trim.
  assignment_type TEXT NOT NULL DEFAULT '',
  -- Mongo: dutyName String — default '', trim.
  duty_name TEXT NOT NULL DEFAULT '',
  -- Mongo: dutyArea String — default '', trim.
  duty_area TEXT NOT NULL DEFAULT '',
  -- Mongo: status enum — default 'Absent'.
  status TEXT NOT NULL DEFAULT 'Absent',
  -- Mongo: isLateCheckIn Boolean — default false.
  is_late_check_in BOOLEAN NOT NULL DEFAULT FALSE,
  -- Mongo: workingMinutes Number — default 0, no min in Mongo (NUMERIC
  -- preserves the value exactly; no >= 0 CHECK, the schema declares none).
  working_minutes NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: workingHours String — default '--', trim. Display string.
  working_hours TEXT NOT NULL DEFAULT '--',
  -- Mongo: overtimeMinutes Number — default 0, no min in Mongo.
  overtime_minutes NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: overtimeHours String — default '--', trim. Display string.
  overtime_hours TEXT NOT NULL DEFAULT '--',
  -- Mongo: isOvertime Boolean — default false.
  is_overtime BOOLEAN NOT NULL DEFAULT FALSE,
  -- Mongo: note String — default '', trim.
  note TEXT NOT NULL DEFAULT '',
  -- Mongo: source String — default 'manual', trim.
  source TEXT NOT NULL DEFAULT 'manual',
  -- Mongo: correctedBy String — default '', trim.
  corrected_by TEXT NOT NULL DEFAULT '',
  -- Mongo: correctionDate Date — default null.
  correction_date TIMESTAMPTZ,
  -- Mongo: correctionReason String — default '', trim.
  correction_reason TEXT NOT NULL DEFAULT '',
  -- Mongo: latitude Number — default null. NUMERIC keeps coordinates exact.
  latitude NUMERIC,
  -- Mongo: longitude Number — default null.
  longitude NUMERIC,
  -- Mongo: locationVerified Boolean — default false.
  location_verified BOOLEAN NOT NULL DEFAULT FALSE,
  -- Mongo: faceVerified Boolean — default false.
  face_verified BOOLEAN NOT NULL DEFAULT FALSE,
  -- Mongo: distanceFromTemple Number — default null.
  distance_from_temple NUMERIC,
  -- Mongo: deviceInfo String — default ''.
  device_info TEXT NOT NULL DEFAULT '',
  -- Mongo: browser String — default ''.
  browser TEXT NOT NULL DEFAULT '',
  -- Mongo: ipAddress String — default ''.
  ip_address TEXT NOT NULL DEFAULT '',
  -- Mongo: checkInPhoto String — default ''.
  check_in_photo TEXT NOT NULL DEFAULT '',
  -- Mongo: checkOutPhoto String — default ''.
  check_out_photo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's { staffId, dateKey } unique: true index.
  CONSTRAINT attendance_staff_id_date_key_key UNIQUE (staff_id, date_key),
  -- Mirrors the Mongo schema's status enum exactly (no value added/renamed).
  CONSTRAINT attendance_status_check CHECK (status IN (
    'Present', 'Absent', 'Half Day', 'Leave', 'Pending',
    'Working', 'Holiday', 'Late', 'Weekly Off', 'Compensatory Off'
  )),
  -- The date key is a timezone-free 'YYYY-MM-DD' calendar key on every write
  -- path (attendanceController.toDateKey produces exactly this shape, and every
  -- filter/sort treats it as text). The shape is pinned so the text contract
  -- the application already relies on stays enforced; it does not narrow any
  -- value the application can produce.
  CONSTRAINT attendance_date_key_check CHECK (date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

-- buildAttendanceQuery employeeId matching (`employeeId: { $in: [...] }` paired
-- with a dateKey equality/range) — the non-unique Mongo { employeeId, dateKey }
-- index.
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id_date_key ON attendance (employee_id, date_key);

-- buildAttendanceQuery staffEmail matching (`staffEmail: { $in: [...] }` paired
-- with a dateKey equality/range) — the non-unique Mongo { staffEmail, dateKey }
-- index.
CREATE INDEX IF NOT EXISTS idx_attendance_staff_email_date_key ON attendance (staff_email, date_key);

-- Month/range reads with no staff filter: the admin dashboard and the payroll
-- generator both run Attendance.find({ dateKey: { $gte: startKey, $lte: endKey } }).
CREATE INDEX IF NOT EXISTS idx_attendance_date_key ON attendance (date_key);

-- The `sort({ dateKey: -1, createdAt: -1 })` ordering applied by every
-- dashboard list, materialised so the ordering needs no sort step.
CREATE INDEX IF NOT EXISTS idx_attendance_date_key_created_at ON attendance (date_key DESC, created_at DESC);