-- Phase 2U: shifts (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/Shift.js and every real usage of the Shift model:
--   * Shift.js — the Mongoose model: shiftName (String, required, trim),
--     startTime (String, required, trim), endTime (String, required, trim),
--     category (String, default 'General', trim), requiredStaff (Number,
--     default 1), active (Boolean, default true), notes (String, default '',
--     trim), timestamps. There are NO virtuals and NO embedded sub-documents.
--     The schema declares NO index of any kind — no unique index, no compound
--     index, no sparse/partial index. In particular shiftName is NOT unique:
--     Mongo happily stores two shifts with the same name and no write path
--     rejects one.
--   * shiftController.js — the only writer.
--       getShiftDashboard (GET /api/shifts/dashboard) reads
--       Shift.find().sort({ createdAt: -1 }).
--       getShifts (GET /api/shifts) reads the same
--       Shift.find().sort({ createdAt: -1 }).
--       createShift (POST /api/shifts) validates that shiftName/startTime/
--       endTime are non-empty, then Shift.create({ shiftName, startTime,
--       endTime, category: trimmed || 'General', requiredStaff: Number(...) ||
--       1, active: body.active !== false, notes: trimmed }).
--       updateShift (PUT /api/shifts/:id) loads Shift.findById(id) (404 when
--       absent), then patches only the supplied shiftName/startTime/endTime/
--       category/notes (trimmed), requiredStaff (Number(...) || 1) and active
--       (Boolean(...)) through the service (an UPDATE on PostgreSQL,
--       findByIdAndUpdate on Mongoose).
--       deleteShift (DELETE /api/shifts/:id) calls Shift.findByIdAndDelete(id)
--       (404 when absent) and then Task.deleteMany({ shiftId }) — Task is a
--       separate domain and is NOT part of this migration.
--       assignShift (POST /api/shifts/assign) reads Shift.findById(shiftId) and
--       Shift.findOne({ shiftName: <employee default shift>, active: true })
--       .sort({ createdAt: -1 }) for the default-shift conflict check. The
--       assignment itself is written to a Task document (with denormalized
--       shiftId/shiftName/shiftStartTime/shiftEndTime/category/requiredStaff),
--       NOT to Shift.
--       getAvailableEmployees (GET /api/shifts/available-employees) reads
--       Shift.find({ active: true }) and keys the results by shiftName.
--   * attendanceController.js — resolveShiftDefinition reads
--     Shift.findOne({ shiftName: /^<name>$/i, active: true })
--     .sort({ updatedAt: -1, createdAt: -1 }) to resolve an employee's
--     defaultShift/shift by NAME; the attendance dashboard reads
--     Shift.find({ active: true }).sort({ shiftName: 1 }).
--   * frontend/src/services/shiftService.js + frontend/src/pages/admin/employee/
--     ShiftManagement.jsx consume those endpoints and read only the fields
--     below. The time fields are 12-hour meridiem display strings: the form
--     builds them as `${Number(hour)}:${minute} ${meridiem}` ("9:00 AM",
--     "5:00 PM") and parses them back with
--     /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by shiftRepository, reachable through shiftService) that is
-- selected only when the service is used AND PostgreSQL is reachable. MongoDB
-- stays the source of truth and the fallback path; no Mongo → PostgreSQL switch
-- happens anywhere in the application and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — shifts (every persisted Mongo field):
--   * _id           → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * shiftName     → shift_name TEXT NOT NULL (required, trim; NOT unique —
--                     see the uniqueness note)
--   * startTime     → start_time TEXT NOT NULL (required, trim; a 12-hour
--                     meridiem time-of-day STRING — see time semantics)
--   * endTime       → end_time TEXT NOT NULL (required, trim; same)
--   * category      → category TEXT NOT NULL DEFAULT 'General' (trim; free
--                     text with no enum in Mongo, so no CHECK is declared)
--   * requiredStaff → required_staff NUMERIC NOT NULL DEFAULT 1 (Number with
--                     no min in Mongo, so no integer cast and no CHECK)
--   * active        → active BOOLEAN NOT NULL DEFAULT TRUE
--   * notes         → notes TEXT NOT NULL DEFAULT '' (trim)
--   * createdAt     → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt     → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 10 columns (id + the 7 schema fields + the two timestamps). The model has no
-- shiftCode, no description, no shiftType, no status, no breakDuration, no
-- gracePeriod, no workingHours/overtimeHours, no employee assignment array and
-- no createdBy/updatedBy. Those names appear on other entities (Task,
-- ShiftAssignment, Attendance, Employee, PayrollRecord) but not here, so they
-- are deliberately NOT columns.
--
-- Time semantics — the important decision in this migration. startTime /
-- endTime are NOT timestamps and are NOT plain TIME values. The application
-- stores and renders them as 12-hour meridiem display strings ("9:00 AM",
-- "5:00 PM") built by the frontend form and returned verbatim by
-- serializeShift, and parses them with
-- /^(\d{1,2}):(\d{2})\s*(AM|PM)$/ in shiftController.parseTimeToMinutes and
-- attendanceController. A PostgreSQL TIME column would silently rewrite
-- "9:00 AM" into "09:00:00", breaking both the API contract (startTime is
-- echoed back to the UI and into Task.workingHours/durationMinutes messages)
-- and the frontend's regex parser. Both columns therefore stay TEXT so the
-- stored value round-trips byte-for-byte. The 24-hour wraparound used by
-- overnight shifts (e.g. "10:00 PM" → "6:00 AM") is a pure calculation in
-- normalizeRange (`if (end <= start) end += 24 * 60`) and is not encoded in
-- any column type here, so it keeps working exactly as before.
--
-- Only created_at / updated_at are real instants and are the only TIMESTAMPTZ
-- columns. No timezone conversion is introduced for the time-of-day strings.
--
-- Uniqueness / constraints: the Shift schema declares NO unique index, so
-- shift_name is deliberately NOT unique — PostgreSQL must not prohibit
-- duplicate shift names that Mongo allows. No CHECK is declared either:
-- category/notes are unconstrained free text, requiredStaff has no min in
-- Mongo, and the startTime/endTime format is enforced by the frontend rather
-- than the schema. The only constraint is the primary key.
--
-- Foreign keys: NONE, deliberately. Shift references no other collection and
-- nothing references Shift by id in a way PostgreSQL could express today:
--   * Employee.defaultShift/.shift/currentDuty.shift are plain strings matched
--     against shift_name case-insensitively at read time (and may not match any
--     Shift at all), so they are not foreign keys.
--   * Attendance has no shiftId — only denormalized shift/shiftStartTime/
--     shiftEndTime strings — so no FK is possible or appropriate.
--   * Task.shiftId is a loose string with no `ref`, and Task has no PostgreSQL
--     table yet (a later phase), so an FK would point at a table that does not
--     exist.
--   * Leave has no shift reference at all.

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  -- Mongo: shiftName String — required, trim.
  shift_name TEXT NOT NULL,
  -- Mongo: startTime String — required, trim. A 12-hour meridiem time-of-day
  -- string ("9:00 AM"); TEXT so it round-trips verbatim (see time semantics).
  start_time TEXT NOT NULL,
  -- Mongo: endTime String — required, trim. Same representation; "end <=
  -- start" denotes an overnight shift purely in application logic.
  end_time TEXT NOT NULL,
  -- Mongo: category String — default 'General', trim. Free text; Mongo
  -- declares no enum, so no CHECK is invented.
  category TEXT NOT NULL DEFAULT 'General',
  -- Mongo: requiredStaff Number — default 1. NUMERIC: Mongo allows fractional
  -- values and declares no min, so nothing is narrowed.
  required_staff NUMERIC NOT NULL DEFAULT 1,
  -- Mongo: active Boolean — default true.
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Mongo: notes String — default '', trim.
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- It is intentional that there is exactly ZERO CONSTRAINT on this table beyond
-- the primary key: the Shift schema declares no unique index (duplicate shift
-- names are legal in Mongo) and no validation beyond `required`, so no UNIQUE
-- and no CHECK is reproduced here.

-- The active-shift scans: Shift.find({ active: true }) in getAvailableEmployees
-- and Shift.find({ active: true }).sort({ shiftName: 1 }) in the attendance
-- dashboard.
CREATE INDEX IF NOT EXISTS idx_shifts_active ON shifts (active);

-- The employee→shift resolution the attendance dashboard performs by name
-- ({ shiftName: /^name$/i, active: true }). A functional index on
-- lower(shift_name) lets PostgreSQL serve that case-insensitive equality
-- without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_shifts_shift_name_lower ON shifts (lower(shift_name));

-- getShifts / getShiftDashboard: Shift.find().sort({ createdAt: -1 }).
CREATE INDEX IF NOT EXISTS idx_shifts_created_at ON shifts (created_at DESC);

-- assignShift's default-shift lookup:
-- Shift.findOne({ shiftName, active: true }).sort({ createdAt: -1 }), which
-- filters on both active and the name.
CREATE INDEX IF NOT EXISTS idx_shifts_active_created_at ON shifts (active, created_at DESC);

-- attendanceController.resolveShiftDefinition:
-- Shift.findOne({ shiftName: /^name$/i, active: true })
-- .sort({ updatedAt: -1, createdAt: -1 }) — the updated_at-leading ordering is
-- materialised so the lookup needs no sort step.
CREATE INDEX IF NOT EXISTS idx_shifts_active_updated_at_created_at
  ON shifts (active, updated_at DESC, created_at DESC);