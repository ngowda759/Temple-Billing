-- Phase 2T: leaves (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/Leave.js and every real usage of the Leave model:
--   * Leave.js — the Mongoose model: staffId (String, required, trim, index),
--     staffName (String, required, trim), reason (String, required, trim),
--     leaveType (String, default 'General', trim), fromDate (String, required,
--     trim), toDate (String, required, trim), status (String, 3-value enum,
--     default 'Pending'), adminReason (String, default '', trim), reviewedBy
--     (String, default '', trim), reviewedAt (Date, default null),
--     timestamps. There are NO virtuals and NO embedded sub-documents. The
--     schema declares exactly ONE index — { staffId: 1 } from `index: true`.
--     There is NO unique index, no compound index and no sparse/partial index
--     anywhere on this schema.
--   * leaveController.js — applyLeave (POST /api/leaves/apply) is the only
--     creation path: it validates the required fields, the 10-character reason,
--     the 'YYYY-MM-DD' shape of fromDate/toDate, fromDate >= today (server
--     local), the 10:00 same-day cutoff, toDate >= fromDate, the overlap query
--     Leave.findOne({ staffId, status: { $ne: 'Rejected' },
--     fromDate: { $lte: toDate }, toDate: { $gte: fromDate } }) and the yearly
--     quota, then writes Leave.create({ ... status: 'Pending', adminReason: '',
--     reviewedBy: '', reviewedAt: null }) and a Notification. updateLeaveStatus
--     (PUT /api/leaves/status/:id) validates the status enum, requires an
--     adminReason when rejecting, stamps adminReason/reviewedBy/reviewedAt and
--     saves through Leave.findByIdAndUpdate(id, payload, { new: true }).
--     getLeaves (GET /api/leaves/:staffId) reads
--     Leave.find({ staffId }).sort({ createdAt: -1 }); getLeaveStats
--     (GET /api/leaves/stats/:staffId) reads Leave.find({ staffId });
--     getAdminLeaveOverview (GET /api/leaves/admin/overview) reads
--     Leave.find().sort({ createdAt: -1 }). There is NO delete path and NO
--     cancellation flow.
--   * attendanceController.js — buildLeaveQuery produces the standing shape
--     { $or: [{ staffId: { $in } }, { staffEmail: { $in } }], status:
--     'Approved', fromDate: { $lte: endKey }, toDate: { $gte: startKey } } and
--     is used by the dashboard (sort({ fromDate: -1, createdAt: -1 })), the
--     admin dashboard (Leave.find({ status: 'Approved', fromDate: { $lte },
--     toDate: { $gte } }).sort({ fromDate: -1, createdAt: -1 })) and the
--     attendance-mark guard (a single-day fromDate/toDate range). Note the
--     staffEmail branch is inert: the Leave schema has no staffEmail field.
--   * shiftController.js — getLeaveBlock uses
--     Leave.findOne({ status: 'Approved', fromDate: { $lte: dateKey },
--     toDate: { $gte: dateKey }, $or: [...] }).
--   * payrollController.js — loadPayrollContext / payroll generation read
--     Leave.find({ status: 'Approved', fromDate: { $lte: endKey },
--     toDate: { $gte: startKey } }) and aggregate in JS, never in the database.
--   * employeeManagementController.js — getEmployeeById reads
--     Leave.find({ staffId: { $in: identifiers } }).sort({ fromDate: -1 })
--     .limit(100).
--   * priestController.js — the duty-transfer conflict check reads
--     Leave.findOne({ staffId, status: 'Approved', fromDate: { $lte: checkDate },
--     toDate: { $gte: checkDate } }).
--   * frontend/src/pages/staff/LeaveRequest.jsx, staff/LeaveHistory.jsx,
--     staff/StaffDashboard.jsx and admin/employee/LeaveManagement.jsx consume
--     those five endpoints and read only the fields below.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by leaveRepository, reachable through leaveService) that is
-- selected only when the service is used AND PostgreSQL is reachable. MongoDB
-- stays the source of truth and the fallback path; no Mongo → PostgreSQL switch
-- happens anywhere in the application and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — leaves (every persisted Mongo field):
--   * _id          → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * staffId      → staff_id TEXT NOT NULL (required, trim; the employee
--                    identifier — see the identity note; deliberately NO FK)
--   * staffName    → staff_name TEXT NOT NULL (required, trim; a historical
--                    snapshot of the employee name, not a live reference)
--   * reason       → reason TEXT NOT NULL (required, trim; the controller's
--                    10-character minimum stays in the controller)
--   * leaveType    → leave_type TEXT NOT NULL DEFAULT 'General' (trim; free
--                    text with no enum in Mongo, so no CHECK is declared)
--   * fromDate     → from_date TEXT NOT NULL (required, trim; the inclusive
--                    calendar start — kept TEXT, see date semantics)
--   * toDate       → to_date TEXT NOT NULL (required, trim; the inclusive
--                    calendar end — kept TEXT, see date semantics)
--   * status       → status TEXT NOT NULL DEFAULT 'Pending' (the exact 3-value
--                    enum, preserved as a CHECK — no value added or renamed)
--   * adminReason  → admin_reason TEXT NOT NULL DEFAULT '' (trim; reviewer note)
--   * reviewedBy   → reviewed_by TEXT NOT NULL DEFAULT '' (trim; a free-text
--                    reviewer NAME, not an id, so no FK is created)
--   * reviewedAt   → reviewed_at TIMESTAMPTZ (real instant; NULL until reviewed
--                    and reset to NULL when the status returns to 'Pending')
--   * createdAt    → created_at TIMESTAMPTZ NOT NULL DEFAULT now() (timestamps)
--   * updatedAt    → updated_at TIMESTAMPTZ NOT NULL DEFAULT now() (timestamps)
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 13 columns (id + the 10 schema fields + the two timestamps). The model has no
-- staffEmail, no leaveDays/dayCount, no half-day or start/end time fields, no
-- approval history, no attachments, no leaveBalance, no createdBy/updatedBy
-- and no JSON metadata. Those names appear on other entities (Attendance,
-- Employee, PayrollRecord) but not on Leave, so they are deliberately not
-- columns.

CREATE TABLE IF NOT EXISTS leaves (
  id TEXT PRIMARY KEY,
  -- Mongo: staffId String — required, trim, index: true.
  staff_id TEXT NOT NULL,
  -- Mongo: staffName String — required, trim.
  staff_name TEXT NOT NULL,
  -- Mongo: reason String — required, trim.
  reason TEXT NOT NULL,
  -- Mongo: leaveType String — default 'General', trim. Free text; Mongo
  -- declares no enum, so no CHECK is invented.
  leave_type TEXT NOT NULL DEFAULT 'General',
  -- Mongo: fromDate String — required, trim. A calendar day, kept TEXT.
  from_date TEXT NOT NULL,
  -- Mongo: toDate String — required, trim. A calendar day, kept TEXT.
  to_date TEXT NOT NULL,
  -- Mongo: status String — enum, default 'Pending'.
  status TEXT NOT NULL DEFAULT 'Pending',
  -- Mongo: adminReason String — default '', trim.
  admin_reason TEXT NOT NULL DEFAULT '',
  -- Mongo: reviewedBy String — default '', trim. A free-text name, not an id.
  reviewed_by TEXT NOT NULL DEFAULT '',
  -- Mongo: reviewedAt Date — default null.
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's status enum exactly (no value added/renamed).
  CONSTRAINT leaves_status_check CHECK (status IN ('Pending', 'Approved', 'Rejected'))
);

-- It is intentional that there is exactly one CONSTRAINT on this table: the
-- status enum. Mongo declares no unique index on Leave (two identical requests
-- are legal), no date-ordering constraint and no date-shape constraint — the
-- toDate >= fromDate check and the 'YYYY-MM-DD' shape check live in the
-- controller — so none is reproduced here. There are also ZERO foreign keys:
-- staff_id is a dual-identity loose string (it may hold either an Employee _id
-- or an employeeId, and the application tries both with an ObjectId.isValid
-- test), and reviewed_by is a display name, so no single column can express the
-- real relationship.

-- The Mongo schema's only declared index — `staffId` with `index: true` —
-- serving the { staffId } equality and `{ staffId: { $in } }` lookups used by
-- getLeaves, getLeaveStats, the employee detail history and the overlap query.
CREATE INDEX IF NOT EXISTS idx_leaves_staff_id ON leaves (staff_id);

-- The `find({ staffId }).sort({ createdAt: -1 })` ordering used by getLeaves.
CREATE INDEX IF NOT EXISTS idx_leaves_staff_id_created_at ON leaves (staff_id, created_at DESC);

-- The overlap query and the staff-scoped date-range reads:
-- Leave.findOne({ staffId, status: { $ne: 'Rejected' },
-- fromDate: { $lte: toDate }, toDate: { $gte: fromDate } }) and
-- buildLeaveQuery's { staffId: { $in } } plus fromDate/toDate range.
CREATE INDEX IF NOT EXISTS idx_leaves_staff_id_dates ON leaves (staff_id, from_date, to_date);

-- The monthly/annual approved-leave scans run by the payroll generator and the
-- admin attendance dashboard: Leave.find({ status: 'Approved',
-- fromDate: { $lte: endKey }, toDate: { $gte: startKey } }). No staff filter is
-- applied, so a staff_id-leading composite cannot serve them.
CREATE INDEX IF NOT EXISTS idx_leaves_status_dates ON leaves (status, from_date, to_date);

-- The `sort({ fromDate: -1, createdAt: -1 })` ordering the attendance and
-- admin dashboards apply, materialised so the ordering needs no sort step.
CREATE INDEX IF NOT EXISTS idx_leaves_from_date_created_at ON leaves (from_date DESC, created_at DESC);