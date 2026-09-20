-- Phase 2AH: tasks (MongoDB → PostgreSQL migration).
--
-- This is the keystone table of the Phase 2AH "Mongo-only model gap" work.
-- Task is the single most heavily used MongoDB-only model: it is the source of
-- truth for priest duties, shift assignments, festival duties, transfer
-- approvals and the payroll/attendance read models.
--
-- Mirrors backend/src/models/Task.js and every real usage of the Task model:
--   * Task.js — the Mongoose model. Persisted paths (38 + timestamps):
--     assignmentType (String, default 'Duty & Shift', trim),
--     shiftId (String, trim, index, NO default → optional),
--     shiftName (String, trim, default ''),
--     shiftStartTime (String, trim, default ''),
--     shiftEndTime (String, trim, default ''),
--     dateKey (String, trim, index, default ''),
--     startTime (String, trim, default ''),
--     endTime (String, trim, default ''),
--     staffId (String, required, trim, index),
--     staffName (String, required, trim),
--     employeeId (String, trim, index, NO default → optional),
--     staffEmail (String, trim, lowercase, NO default → optional),
--     dutyName (String, trim, default ''),
--     title (String, trim, NO default → optional),
--     description (String, trim, NO default → optional),
--     dueDate (String, trim, NO default → optional),
--     duty (String, required, trim),
--     area (String, required, trim),
--     dutyArea (String, trim, default ''),
--     time (String, required, trim),
--     reportingTime (String, trim, default ''),
--     assignedBy (String, required, trim),
--     supervisor (String, default '', trim),
--     priority (String, enum, default 'Medium'),
--     workingHours (String, default '', trim),
--     status (String, enum, default 'Pending'),
--     attendanceStatus (String, default 'Pending', trim),
--     conflict (Boolean, default false),
--     reason (String, default '', trim),
--     notes (String, default '', trim),
--     requiredStaff (Number, default 1),
--     durationMinutes (Number, default 0),
--     acceptedAt (Date, optional),
--     rejectedAt (Date, optional),
--     rejectionReason (String, trim, optional),
--     completedAt (Date, optional),
--     completionRemarks (String, trim, default ''),
--     completionDuration (Number, default 0).
--     The model declares NO unique index of any kind. It declares two compound
--     indexes — { staffId: 1, dateKey: 1 } and { staffId: 1, dueDate: 1 } — plus
--     four single-field `index: true` markers on shiftId, dateKey, staffId and
--     employeeId. No hook, no virtual and no embedded sub-document exists.
--   * staffController.js — getAllTasks / getTasks (Task.find(...).sort({createdAt:-1})),
--     updateTaskStatus (Task.findByIdAndUpdate), deleteTask (Task.findByIdAndDelete)
--     and assignTask (Task.create).
--   * shiftController.js — getShiftDashboard (dateKey range + sort {dateKey:1,
--     startTime:1}), deleteShift (Task.deleteMany({ shiftId }) cascade),
--     assignShift (conflict scan Task.find({employeeId,dateKey}) then Task.create),
--     deleteAssignment (Task.findByIdAndDelete) and getAvailableEmployees
--     (Task.find({dateKey,status:{$nin:[...]}})).
--   * priestController.js — dashboard / seva schedule / special duties / festival
--     duties / my duties reads, the duty status transitions (accept, reject,
--     complete, festival attendance/complete, start, complete) and the transfer
--     status updates.
--   * attendanceController.js — buildDashboardResponse, getAttendanceOverview and
--     the check-in/check-out flow (read-only).
--   * payrollController.js — loadPayrollContext and generatePayroll (read-only).
--   * employeeManagementController.js — getEmployeeById duty history (read-only,
--     sort {dueDate:-1,createdAt:-1}, limit 100).
--   * transferController.js — transfer listing/resolution and directAdminTransfer.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by taskRepository, reachable through taskService) that is
-- selected only when the service is used AND PostgreSQL is reachable. MongoDB
-- stays the source of truth and the fallback path; no Mongo → PostgreSQL switch
-- happens anywhere in the application and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — tasks (every persisted Mongo field):
--   * _id               → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * assignmentType    → assignment_type TEXT NOT NULL DEFAULT 'Duty & Shift'
--   * shiftId           → shift_id TEXT (optional; NO FK — see foreign keys)
--   * shiftName         → shift_name TEXT NOT NULL DEFAULT ''
--   * shiftStartTime    → shift_start_time TEXT NOT NULL DEFAULT ''
--   * shiftEndTime      → shift_end_time TEXT NOT NULL DEFAULT ''
--   * dateKey           → date_key TEXT NOT NULL DEFAULT ''
--   * startTime         → start_time TEXT NOT NULL DEFAULT ''
--   * endTime           → end_time TEXT NOT NULL DEFAULT ''
--   * staffId           → staff_id TEXT NOT NULL
--   * staffName         → staff_name TEXT NOT NULL
--   * employeeId        → employee_id TEXT (optional)
--   * staffEmail        → staff_email TEXT (optional)
--   * dutyName          → duty_name TEXT NOT NULL DEFAULT ''
--   * title             → title TEXT (optional)
--   * description       → description TEXT (optional)
--   * dueDate           → due_date TEXT (optional)
--   * duty              → duty TEXT NOT NULL
--   * area              → area TEXT NOT NULL
--   * dutyArea          → duty_area TEXT NOT NULL DEFAULT ''
--   * time              → time TEXT NOT NULL
--   * reportingTime     → reporting_time TEXT NOT NULL DEFAULT ''
--   * assignedBy        → assigned_by TEXT NOT NULL
--   * supervisor        → supervisor TEXT NOT NULL DEFAULT ''
--   * priority          → priority TEXT NOT NULL DEFAULT 'Medium'
--   * workingHours      → working_hours TEXT NOT NULL DEFAULT ''
--   * status            → status TEXT NOT NULL DEFAULT 'Pending'
--   * attendanceStatus  → attendance_status TEXT NOT NULL DEFAULT 'Pending'
--   * conflict          → conflict BOOLEAN NOT NULL DEFAULT FALSE
--   * reason            → reason TEXT NOT NULL DEFAULT ''
--   * notes             → notes TEXT NOT NULL DEFAULT ''
--   * requiredStaff     → required_staff NUMERIC NOT NULL DEFAULT 1
--   * durationMinutes   → duration_minutes NUMERIC NOT NULL DEFAULT 0
--   * acceptedAt        → accepted_at TIMESTAMPTZ
--   * rejectedAt        → rejected_at TIMESTAMPTZ
--   * rejectionReason   → rejection_reason TEXT
--   * completedAt       → completed_at TIMESTAMPTZ
--   * completionRemarks → completion_remarks TEXT NOT NULL DEFAULT ''
--   * completionDuration→ completion_duration NUMERIC NOT NULL DEFAULT 0
--   * createdAt         → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt         → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 41 columns (id + the 38 schema fields + the two timestamps). The model has no
-- role, no compensation, no employeeName, no employeeEmail, no category and no
-- assignedPriest path. Those names are READ by controllers (priestController's
-- festival-duty mapper reads `role`, the special-duty mapper reads
-- `compensation`, serializeAssignment reads employeeName/employeeEmail/category
-- and respondToTransfer patches assignedPriest) but they are NOT declared in the
-- schema, so Mongoose strict mode never persists them and a read returns
-- undefined. They are deliberately NOT columns: adding them would make
-- PostgreSQL richer than the source of truth and change the API payloads.
-- taskRepository's update whitelist mirrors strict mode by ignoring them.
--
-- Time semantics — the important decision in this migration. `startTime`,
-- `endTime`, `time`, `reportingTime`, `shiftStartTime` and `shiftEndTime` are
-- NOT timestamps and are NOT plain TIME values. The application stores and
-- renders them as 12-hour meridiem display strings ("9:00 AM", "5:00 PM") built
-- by the frontend form, parses them with /^(\d{1,2}):(\d{2})\s*(AM|PM)$/ in
-- shiftController.parseTimeToMinutes (normalizeRange) and compares them with
-- `===`/`includes` in getAvailablePriestsForTransfer. A PostgreSQL TIME column
-- would silently rewrite "9:00 AM" into "09:00:00", breaking the API contract
-- and the frontend parser. They therefore stay TEXT so the stored value
-- round-trips byte-for-byte.
--
-- `dateKey` and `dueDate` are calendar DAY strings ("YYYY-MM-DD"), not instants:
-- payrollController filters them with { $gte: startKey, $lte: endKey } where the
-- bounds are themselves "YYYY-MM-DD" strings, and the tie-breaking sorts
-- ({ dueDate: 1, time: 1 }) rely on lexicographic day ordering. They stay TEXT so
-- the string comparison the application performs is preserved exactly.
--
-- Only accepted_at / rejected_at / completed_at / created_at / updated_at are
-- real instants and are the only TIMESTAMPTZ columns. No timezone conversion is
-- introduced for the time-of-day or day strings.
--
-- Uniqueness / constraints: the Task schema declares NO unique index, so no
-- UNIQUE constraint exists here — duplicate duties for one employee and day are
-- legal in Mongo (the application detects conflicts in code, it does not reject
-- the write). The two enum-like paths, priority and status, ARE declared with
-- `enum` in Mongo, so their value sets are reproduced as CHECK constraints. The
-- two required numeric paths have no min in Mongo, so no numeric CHECK is added.
--
-- Foreign keys: NONE, deliberately. Task's cross-model pointers are loose,
-- denormalized strings that the application never resolves through a population
-- and that may legitimately dangle:
--   * shiftId is a plain String (no `ref`). The Shift model's id now lives in
--     the PostgreSQL shifts table, but a Task may keep a shiftId whose shift was
--     deleted — deleteShift's cascade removes those Tasks in application code
--     (shiftController.js), it does not rely on a database FK.
--   * staffId / employeeId / staffEmail / assignedBy / supervisor are plain
--     Strings matched against Employee, User and Priest identifiers by hand
--     (staffController.getStaffIdCandidates, attendanceController
--     getStaffAttendanceTargets, payrollController). They are frequently
--     ObjectId strings of either User OR Employee, so no single FK target exists.
--   * transferReference / Booking are not stored here at all — TransferRequest
--     points AT a Task through its polymorphic referenceId, in the opposite
--     direction.
-- In short: inventing an FK would change delete semantics the application does
-- not currently have.

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  -- Mongo: assignmentType String — default 'Duty & Shift', trim.
  assignment_type TEXT NOT NULL DEFAULT 'Duty & Shift',
  -- Mongo: shiftId String — trim, index: true, no default. Optional loose string.
  shift_id TEXT,
  -- Mongo: shiftName String — default '', trim.
  shift_name TEXT NOT NULL DEFAULT '',
  -- Mongo: shiftStartTime String — default '', trim. 12-hour meridiem display
  -- string, see time semantics.
  shift_start_time TEXT NOT NULL DEFAULT '',
  -- Mongo: shiftEndTime String — default '', trim.
  shift_end_time TEXT NOT NULL DEFAULT '',
  -- Mongo: dateKey String — default '', trim, index: true. A "YYYY-MM-DD" day
  -- string compared lexicographically, see day semantics.
  date_key TEXT NOT NULL DEFAULT '',
  -- Mongo: startTime String — default '', trim. 12-hour meridiem display string.
  start_time TEXT NOT NULL DEFAULT '',
  -- Mongo: endTime String — default '', trim. Same representation.
  end_time TEXT NOT NULL DEFAULT '',
  -- Mongo: staffId String — required, trim, index: true.
  staff_id TEXT NOT NULL,
  -- Mongo: staffName String — required, trim.
  staff_name TEXT NOT NULL,
  -- Mongo: employeeId String — trim, index: true, no default. Optional.
  employee_id TEXT,
  -- Mongo: staffEmail String — trim, lowercase, no default. Optional.
  staff_email TEXT,
  -- Mongo: dutyName String — default '', trim.
  duty_name TEXT NOT NULL DEFAULT '',
  -- Mongo: title String — trim, no default. Optional.
  title TEXT,
  -- Mongo: description String — trim, no default. Optional.
  description TEXT,
  -- Mongo: dueDate String — trim, no default. Optional "YYYY-MM-DD" day string.
  due_date TEXT,
  -- Mongo: duty String — required, trim.
  duty TEXT NOT NULL,
  -- Mongo: area String — required, trim.
  area TEXT NOT NULL,
  -- Mongo: dutyArea String — default '', trim.
  duty_area TEXT NOT NULL DEFAULT '',
  -- Mongo: time String — required, trim. 12-hour meridiem display string.
  time TEXT NOT NULL,
  -- Mongo: reportingTime String — default '', trim. Same representation.
  reporting_time TEXT NOT NULL DEFAULT '',
  -- Mongo: assignedBy String — required, trim.
  assigned_by TEXT NOT NULL,
  -- Mongo: supervisor String — default '', trim.
  supervisor TEXT NOT NULL DEFAULT '',
  -- Mongo: priority String — enum ['Low','Medium','High','Urgent'], default
  -- 'Medium'. The enum is reproduced as a CHECK below.
  priority TEXT NOT NULL DEFAULT 'Medium',
  -- Mongo: workingHours String — default '', trim.
  working_hours TEXT NOT NULL DEFAULT '',
  -- Mongo: status String — enum (10 values), default 'Pending'. Reproduced as a
  -- CHECK below: the model genuinely constrains this path.
  status TEXT NOT NULL DEFAULT 'Pending',
  -- Mongo: attendanceStatus String — default 'Pending', trim. No enum in Mongo,
  -- so no CHECK is declared (the application writes free text such as 'Present').
  attendance_status TEXT NOT NULL DEFAULT 'Pending',
  -- Mongo: conflict Boolean — default false.
  conflict BOOLEAN NOT NULL DEFAULT FALSE,
  -- Mongo: reason String — default '', trim.
  reason TEXT NOT NULL DEFAULT '',
  -- Mongo: notes String — default '', trim.
  notes TEXT NOT NULL DEFAULT '',
  -- Mongo: requiredStaff Number — default 1. NUMERIC: Mongo allows fractional
  -- values and declares no min, so nothing is narrowed.
  required_staff NUMERIC NOT NULL DEFAULT 1,
  -- Mongo: durationMinutes Number — default 0. Same NUMERIC reasoning.
  duration_minutes NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: acceptedAt Date — optional.
  accepted_at TIMESTAMPTZ,
  -- Mongo: rejectedAt Date — optional.
  rejected_at TIMESTAMPTZ,
  -- Mongo: rejectionReason String — trim, optional.
  rejection_reason TEXT,
  -- Mongo: completedAt Date — optional.
  completed_at TIMESTAMPTZ,
  -- Mongo: completionRemarks String — trim, default ''.
  completion_remarks TEXT NOT NULL DEFAULT '',
  -- Mongo: completionDuration Number — default 0.
  completion_duration NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Task schema's `status` enum (TASK_STATUSES). MongoDB rejects an
  -- out-of-enum status on write, so PostgreSQL reproduces the same value set.
  CONSTRAINT tasks_status_check CHECK (
    status IN ('Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled',
               'Accepted', 'Rejected', 'Attended', 'Transfer Requested', 'Transferred')
  ),
  -- Mirrors the Task schema's `priority` enum.
  CONSTRAINT tasks_priority_check CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent'))
);

-- It is intentional that there is exactly ZERO CONSTRAINT on this table beyond
-- the primary key, the two enum CHECKs and the NOT NULLs: the Task schema
-- declares no unique index, so PostgreSQL must not prohibit duplicate duties
-- that Mongo allows.

-- The four single-field `index: true` markers declared on the schema.
-- shiftId is used by deleteShift's cascade (Task.deleteMany({ shiftId })).
CREATE INDEX IF NOT EXISTS idx_tasks_shift_id ON tasks (shift_id);
-- dateKey is used by the shift dashboard week range, getAvailableEmployees,
-- getAttendanceOverview (dueDate) and the payroll month range.
CREATE INDEX IF NOT EXISTS idx_tasks_date_key ON tasks (date_key);
-- staffId is the primary identity used by every duty read.
CREATE INDEX IF NOT EXISTS idx_tasks_staff_id ON tasks (staff_id);
-- employeeId is the shift-assignment identity (assignShift conflict scan).
CREATE INDEX IF NOT EXISTS idx_tasks_employee_id ON tasks (employee_id);

-- Mirrors the schema's compound index { staffId: 1, dateKey: 1 }.
CREATE INDEX IF NOT EXISTS idx_tasks_staff_id_date_key ON tasks (staff_id, date_key);
-- Mirrors the schema's compound index { staffId: 1, dueDate: 1 }.
CREATE INDEX IF NOT EXISTS idx_tasks_staff_id_due_date ON tasks (staff_id, due_date);

-- The standing list orders. getAllTasks / getTasks / getSpecialDuties /
-- getFestivalDuties / getAttendanceOverview all sort { createdAt: -1 }.
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC);
-- getShiftDashboard sorts { dateKey: 1, startTime: 1 }; the live (day, start
-- time) ordering is materialised so the week planner needs no sort step.
CREATE INDEX IF NOT EXISTS idx_tasks_date_key_start_time ON tasks (date_key, start_time);
-- getEmployeeById's duty history sorts { dueDate: -1, createdAt: -1 }.
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date DESC);
-- The identity email lookups (priestController's $or on staffEmail, payroll and
-- attendance matching) filter on staff_email; it is compared case-insensitively
-- after Mongoose's lowercase setter, so a plain index serves equality.
CREATE INDEX IF NOT EXISTS idx_tasks_staff_email ON tasks (staff_email);