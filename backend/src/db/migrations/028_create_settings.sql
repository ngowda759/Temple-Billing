-- Phase 2AA: settings (MongoDB → PostgreSQL migration).
--
-- Covers the two remaining Mongoose models whose schema names end in
-- "Setting". They are independent entities and are NOT the same store:
--
--   1. AttendanceSetting (backend/src/models/AttendanceSetting.js) — a GLOBAL
--      singleton holding the temple attendance coordinates and the attendance
--      time thresholds. It is a flat, fixed-shape document with NO arrays, NO
--      sub-documents, NO ObjectId references, NO enum, NO `min`, and exactly
--      ONE implicit document (the application reads it with `findOne()`).
--      Its only index is the automatic `_id` index: the schema declares no
--      `unique` and no index. createdAt / updatedAt come from timestamps:true.
--
--   2. PriestSetting (backend/src/models/PriestSetting.js) — a PER-PRIEST
--      preferences record, one document per Employee. priestId is a required
--      ObjectId `ref: 'Employee'` carrying `unique: true`, so the schema's only
--      business index is the unique on priestId. smsNotifications /
--      dutyReminders / calendarWidget default true and agamaReferenceModule
--      defaults false. Flat, no arrays, no sub-documents, no enum, no `min`.
--
-- Real usage inspected for this phase (there is no repository or service for
-- either model today; both are reached directly from controllers):
--   * attendanceSettingsController.js
--       getSettings    (GET  /api/attendance/settings, authenticate)
--         — AttendanceSetting.findOne(); if null, AttendanceSetting.create({})
--           so the first read lazily materialises the singleton with its
--           schema defaults. Responds { success, settings }.
--       updateSettings (POST /api/attendance/settings, authenticate +
--         authorizeRoles('admin'))
--         — AttendanceSetting.findOne(); when found, assigns each of the five
--           fields with `req.body.x ?? settings.x` and calls save(); when
--           absent, AttendanceSetting.create(req.body). Responds
--           { success, message, settings }. NOTE: the route is a POST (there is
--           no PUT/PATCH for this store) — the HTTP verb is unrelated to the
--           persistence shape and is untouched by this phase.
--   * attendanceController.js — markAttendance
--       (POST /api/staff/attendance/mark) reads AttendanceSetting.findOne()
--       (creating it when absent) and uses templeLatitude / templeLongitude /
--       allowedRadius for the Haversine geofence check. When the stored temple
--       coordinates are both 0 it marks locationVerified = true without a
--       distance computation. This read is untouched and must keep working.
--   * priestController.js
--       getSettings    (GET /api/priest/settings)
--         — resolves req.user.id → User.findById → Employee.findOne({ email })
--           (404 when no employee), then PriestSetting.findOne({ priestId:
--           employee._id }); creates { priestId } when absent. Returns the raw
--           document (no envelope). The whole priest router is behind
--           authenticate + authorizeRoles('priest').
--       updateSettings (PUT /api/priest/settings)
--         — same resolution; lazily constructs new PriestSetting({ priestId })
--           when absent; assigns only fields that are `!== undefined`; save().
--           Responds { message, settings }.
--   * frontend SettingsManagement.jsx keeps temple name/address and the
--     notification toggles in localStorage only — there is no backend call and
--     no MongoDB domain behind it, so it is deliberately NOT part of this
--     migration.
--   * /api/pooja-settings is a different, already-migrated domain
--     (poojaMaterialRequirements, Phase 2Y) and is NOT touched here.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (attendanceSettingRepository / priestSettingRepository, reachable
-- through their services) selected only when the service is used AND
-- PostgreSQL is reachable. MongoDB stays the source of truth and the fallback;
-- no Mongo → PostgreSQL cutover happens, no production data is migrated, and
-- there are no dual writes.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds the existing models return.
--
-- Mongo → PostgreSQL field mapping — attendance_settings:
--   * _id              → id TEXT PRIMARY KEY (24-hex ObjectId-compatible)
--   * templeLatitude   → temple_latitude NUMERIC NOT NULL DEFAULT 0
--   * templeLongitude  → temple_longitude NUMERIC NOT NULL DEFAULT 0
--   * allowedRadius    → allowed_radius NUMERIC NOT NULL DEFAULT 100
--   * lateThreshold    → late_threshold NUMERIC NOT NULL DEFAULT 15
--   * earlyCheckInWindow → early_check_in_window NUMERIC NOT NULL DEFAULT 30
--   * createdAt        → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt        → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Mongo → PostgreSQL field mapping — priest_settings:
--   * _id                  → id TEXT PRIMARY KEY (24-hex ObjectId-compatible)
--   * priestId             → priest_id TEXT NOT NULL (required, UNIQUE; the
--                            Employee ObjectId as its 24-hex string — see the
--                            identity note; deliberately NO foreign key)
--   * smsNotifications     → sms_notifications BOOLEAN NOT NULL DEFAULT TRUE
--   * dutyReminders        → duty_reminders BOOLEAN NOT NULL DEFAULT TRUE
--   * calendarWidget       → calendar_widget BOOLEAN NOT NULL DEFAULT TRUE
--   * agamaReferenceModule → agama_reference_module BOOLEAN NOT NULL DEFAULT
--                            FALSE
--   * createdAt            → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt            → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Type choices (deliberate, per field):
--   * Every numeric path is NUMERIC, not DOUBLE PRECISION / REAL. The Mongo
--     schema declares these as bare Numbers; NUMERIC round-trips the exact
--     decimal value the application wrote, which matters for the geofence
--     coordinates (templeLatitude / templeLongitude are compared against a
--     haversine distance in metres) and preserves the integer thresholds
--     (allowedRadius / lateThreshold / earlyCheckInWindow) exactly. This is the
--     same money/decimal convention Phase 2S established for attendance
--     latitude / longitude / distanceFromTemple.
--   * The four PriestSetting paths are genuine Booleans in Mongo, so they are
--     BOOLEAN columns — never text/int flags.
--   * created_at / updated_at are TIMESTAMPTZ because timestamps:true stores
--     real Date instants.
--   * JSONB is deliberately NOT used. Both schemas are flat, fully-typed and
--     fixed-shape; there is no flexible or caller-defined key space, so a
--     normalized relational column per field is the correct representation and
--     a key/value table or JSONB blob would be unjustified. Neither schema has
--     any array or embedded object, so there is no child table either.
--
-- Nullability honesty: every column is NOT NULL with the schema's own default.
-- That is exactly what Mongoose does on insert — a document written without
-- templeLatitude / allowedRadius / smsNotifications / ... is stored with
-- 0/100/true/..., so a PostgreSQL row created without them is identical. There
-- is no nullable column on either table because neither schema declares a
-- default of null for any path (contrast attendance.check_in_at, which does).
-- `required: true` on templeLatitude / templeLongitude / allowedRadius /
-- lateThreshold / earlyCheckInWindow is paired with a `default` in Mongo, so
-- Mongoose never rejects an insert for omitting them; the columns therefore
-- carry the default rather than a NOT NULL-without-default requirement.
--
-- Singleton semantics (attendance_settings): the Mongo schema declares NO
-- unique index and the application merely calls `findOne()`, so the singleton
-- is an application convention rather than a database constraint. Multiple rows
-- are physically possible in Mongo today. A CHECK cannot express "at most one
-- row", and adding a UNIQUE constraint on a synthetic constant would invent a
-- rule the source of truth does not have and would make PostgreSQL reject a
-- second row MongoDB accepts. The constraint is therefore intentionally NOT
-- reproduced; the repository's findOne orders by (created_at ASC, id ASC)
-- LIMIT 1 to mirror Mongo's natural-insertion-order `findOne`.
--
-- Identity note — why priest_id has NO foreign key. PriestSetting.priestId is
-- a real `ref: 'Employee'` ObjectId and the `employees` table does exist
-- (Phase 2A), so an FK is superficially attractive. It is deliberately NOT
-- declared, for the same reason documented in 020_create_attendance.sql,
-- 021_create_leaves.sql and 023_create_payroll_records.sql: the live
-- employee-creation paths (employeeController.createEmployee and
-- employeeManagementController.createEmployee) write with `Employee.create(...)`
-- and never touch PostgreSQL, so a priest's employee row is routinely absent
-- from PostgreSQL and an FK would reject writes MongoDB accepts. The column
-- stays indexed TEXT holding the ObjectId-shaped value, keeping it comparable
-- with employees.id once that domain is actually backfilled and cut over.
--
-- Uniqueness semantics: priest_settings reproduces Mongo's `unique: true` on
-- priestId as UNIQUE (priest_id) — the business key "one settings document per
-- priest" and the access path for findOne({ priestId }). attendance_settings
-- declares NO unique constraint (see the singleton note).
--
-- Foreign keys: NONE on either table. Nothing else on either model is a
-- reference: the attendance coordinates/thresholds are plain scalars and the
-- priest toggles are booleans. Because there are no foreign keys there is no
-- ON DELETE behaviour to document, and deleting a settings row never cascades
-- into, blocks, or mutates any other table — mirroring MongoDB exactly.
--
-- Indexes (each justified by a real access path):
--   * attendance_settings_pkey — the primary key. No further index is added:
--     the model's standing read is a bare findOne()/create() with no filter,
--     so no non-key column is ever queried, filtered or sorted on.
--   * priest_settings_pkey — the primary key.
--   * priest_settings_priest_id_key — the UNIQUE constraint replicating Mongo's
--     `unique: true` on priestId. It is also the access path for
--     priestController's findOne({ priestId }), so no separate single-column
--     index on priest_id is added.
--
-- Reversibility: this follows the repository's forward-only migration
-- convention (see backend/src/db/migrate.js — there are no down migrations).
-- Both statements are `CREATE TABLE IF NOT EXISTS`, so the migration is
-- re-runnable, and rolling Phase 2AA back is `DROP TABLE priest_settings` +
-- `DROP TABLE attendance_settings` followed by removing the
-- '028_create_settings.sql' row from schema_migrations, after which db:migrate
-- re-applies it cleanly. Both tables are leaves (no dependants) and neither
-- owns a foreign key, so a rollback cannot damage another table.

CREATE TABLE IF NOT EXISTS attendance_settings (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: templeLatitude Number — required, default 0. NUMERIC keeps the
  -- coordinate exact; compared against a haversine distance in metres.
  temple_latitude NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: templeLongitude Number — required, default 0.
  temple_longitude NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: allowedRadius Number — required, default 100 (meters).
  allowed_radius NUMERIC NOT NULL DEFAULT 100,
  -- Mongo: lateThreshold Number — required, default 15 (minutes).
  late_threshold NUMERIC NOT NULL DEFAULT 15,
  -- Mongo: earlyCheckInWindow Number — required, default 30 (minutes).
  early_check_in_window NUMERIC NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS priest_settings (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: priestId ObjectId ref 'Employee' — required, unique: true. The Mongo
  -- ObjectId as its 24-hex string; deliberately NO foreign key (see the
  -- identity note in the header).
  priest_id TEXT NOT NULL,
  -- Mongo: smsNotifications Boolean — default true.
  sms_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  -- Mongo: dutyReminders Boolean — default true.
  duty_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  -- Mongo: calendarWidget Boolean — default true.
  calendar_widget BOOLEAN NOT NULL DEFAULT TRUE,
  -- Mongo: agamaReferenceModule Boolean — default false.
  agama_reference_module BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's `unique: true` on priestId: one settings
  -- document per priest. Also the access path for findOne({ priestId }).
  CONSTRAINT priest_settings_priest_id_key UNIQUE (priest_id)
);
