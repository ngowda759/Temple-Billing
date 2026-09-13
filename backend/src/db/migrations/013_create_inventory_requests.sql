-- Phase 2L: inventory_requests (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/InventoryRequest.js and its real usages across
-- the application:
--   * inventoryRequestController.createInventoryRequest — staff/priest submit
--     a request ({ userId, userName, role, itemName, quantity, unit, reason,
--     purpose, expectedDate, priority, status: 'Pending' }) after a duplicate
--     check: InventoryRequest.findOne({ userId, itemName, status: 'Pending',
--     createdAt: { $gte: todayStart, $lte: todayEnd } }).
--   * inventoryRequestController.getInventoryRequests /
--     getInventorySummary — InventoryRequest.find({ userId }).sort({
--     createdAt: -1 }) and InventoryRequest.find({ userId }).
--   * inventoryRequestController.updateInventoryRequestStatus — approval
--     (status 'Approved', adminReason/reviewedBy/reviewedAt/approvedBy/
--     approvedAt) and rejection (status 'Rejected', adminReason,
--     rejectionReason, reviewedBy, reviewedAt, rejectedAt).
--   * inventoryRequestController.issueInventoryRequest — issuing
--     (status 'Issued', issuedAt) plus InventoryItem stock movement and an
--     InventoryIssue row inside a Mongo multi-document transaction.
--   * devoteeController.generateInventoryRequestsForBooking and
--     poojaBookingController — system-generated requests
--     ({ userId, userName, role: 'System', itemName, quantity, unit, reason,
--     purpose, expectedDate, status }) linked back from booking
--     templeMaterialRequests.inventoryRequestId.
--   * Booking.templeMaterialRequests[].inventoryRequestId — an ObjectId ref
--     stored as plain TEXT in booking_material_requests (Phase 2B-era decision,
--     unchanged here).
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the inventoryRequestRepository, reachable through the
-- inventoryRequestService) that is selected only when the service is
-- explicitly used AND PostgreSQL is reachable. MongoDB stays the source of
-- truth and the fallback path; no Mongo → PostgreSQL switch happens anywhere
-- in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing InventoryRequest model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id            → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * userId         → user_id TEXT NOT NULL (Mongo schema: String, NOT the
--                      User ObjectId ref — the real write path stores the
--                      requester's USERNAME or devotee email)
--   * userName       → user_name TEXT NOT NULL (required String)
--   * role           → role TEXT NOT NULL DEFAULT 'Staff' (default 'Staff')
--   * requestedBy    → requested_by TEXT NOT NULL DEFAULT '' (default '')
--   * itemName       → item_name TEXT NOT NULL (free-form String; requests are
--                      matched to InventoryItems by exact name later, NOT by
--                      an ObjectId ref)
--   * quantity       → quantity NUMERIC NOT NULL (Number, required, min 0)
--   * unit           → unit TEXT NOT NULL (free-form String — the request
--                      form sends "Pack", "Kg", etc.; no enum CHECK in Mongo)
--   * reason         → reason TEXT NOT NULL DEFAULT '' (model required; the
--                      create path normalizes reason/purpose so at least one
--                      is present)
--   * purpose        → purpose TEXT NOT NULL DEFAULT '' (model required; the
--                      create path normalizes reason/purpose)
--   * expectedDate   → expected_date TIMESTAMPTZ NOT NULL DEFAULT now()
--                      (required Date; create path defaults to now)
--   * priority       → priority TEXT NOT NULL DEFAULT 'Medium', CHECK over
--                      ['High','Medium','Low'] (enum, default 'Medium')
--   * status         → status TEXT NOT NULL DEFAULT 'Pending', CHECK over
--                      ['Pending','Approved','Rejected','Issued']
--                      (enum, default 'Pending')
--   * adminReason    → admin_reason TEXT NOT NULL DEFAULT '' (default '')
--   * rejectionReason→ rejection_reason TEXT NOT NULL DEFAULT '' (default '')
--   * rejectedAt     → rejected_at TIMESTAMPTZ (Date, default null)
--   * approvedBy     → approved_by TEXT NOT NULL DEFAULT '' (default '')
--   * approvedAt     → approved_at TIMESTAMPTZ (Date, default null)
--   * reviewedBy     → reviewed_by TEXT NOT NULL DEFAULT '' (default '')
--   * reviewedAt     → reviewed_at TIMESTAMPTZ (Date, default null)
--   * issuedAt       → issued_at TIMESTAMPTZ (Date, default null)
--   * createdAt      → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt      → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted fields: none. Every persisted Mongo field from the
-- InventoryRequest schema has an explicit column above.
--
-- Foreign keys:
--   * user_id → User gets NO FK. The Mongo schema declares userId as a String
--     (not an ObjectId ref), and the real write paths store usernames /
--     devotee emails / 'System' in it — never a users._id that exists in the
--     PostgreSQL users table (Phase 2A) which remains Mongo-backed as the
--     source of truth. A real FK would reject legitimate requests. Plain TEXT,
--     exactly like every user reference in Phases 2A–2K.
--   * item_name → InventoryItem gets NO FK. The Mongo model stores a free-form
--     itemName STRING (no ObjectId ref), so there is no integrity relationship
--     to migrations 009 inventory_items. The issuing flow (issueInventoryRequest)
--     REPLACES the string match at issue time; a FK keyed on item_name to
--     inventory_items.name would be a fake FK (names are not stable keys and
--     the FK would forbid requests for unknown items — behaviour Mongo allows).
--
-- Monetary values: none — InventoryRequest carries no prices or amounts, so no
-- NUMERIC money column is needed.
--
-- Quantities use NUMERIC (not integer): the Mongo schema declares quantity as
-- Number, required, min: 0, and the real flows parse fractional quantities
-- (parseFloat). NUMERIC with a >= 0 CHECK mirror the Mongo schema's min: 0
-- exactly: zero is legal at the model layer, negatives are refused, and
-- decimal scale is preserved (10.50 stays 10.50, 1000.125 stays 1000.125).
-- Note: the HTTP layer (createInventoryRequest) additionally rejects
-- quantity <= 0 before the model is reached — that is request validation, not
-- a model restriction, so the DB CHECK mirrors the MODEL (>= 0), matching how
-- every prior phase treated controller-vs-schema min differences.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * priority: ['High', 'Medium', 'Low'] — default 'Medium'.
--   * status: ['Pending', 'Approved', 'Rejected', 'Issued'] — default
--     'Pending'. (The frontend/controller also summarize Pending/Approved/
--     Rejected counts; 'Issued' is legal in the schema and issued_at is set on
--     that transition.)
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly. Nullable
-- at/rejected/approved/reviewed/issued columns stay nullable with no default —
-- they are unset until the corresponding transition happens, exactly like the
-- Mongo schema's default null.
--
-- Embedded/nested data: the MongoDB InventoryRequest schema has no embedded
-- arrays or objects (only a flat set of scalar fields), so nothing needs to be
-- normalized and no JSONB column is required.
--
-- Uniqueness semantics: the Mongo schema declares one index — userId
-- { index: true } — which is ordinary and NOT unique. It declares no unique
-- indexes on InventoryRequest, so no unique constraint is created (the
-- duplicate-request guard is a controller-level findOne check, not a DB
-- constraint).

CREATE TABLE IF NOT EXISTS inventory_requests (
  id TEXT PRIMARY KEY,
  -- Mongo: userId String — required (plain TEXT: users stays Mongo-backed as
  -- the source of truth and this field actually holds usernames, so no FK).
  user_id TEXT NOT NULL,
  -- Mongo: userName String — required.
  user_name TEXT NOT NULL,
  -- Mongo: role String, default 'Staff'.
  role TEXT NOT NULL DEFAULT 'Staff',
  -- Mongo: requestedBy String, default ''.
  requested_by TEXT NOT NULL DEFAULT '',
  -- Mongo: itemName String — required (free-form; not an ObjectId ref, so no
  -- FK to inventory_items).
  item_name TEXT NOT NULL,
  -- Mongo: Number, required, min: 0. NUMERIC + >= 0 CHECK mirror the schema.
  quantity NUMERIC NOT NULL,
  -- Mongo: unit String — required (free-form; no enum CHECK in the schema).
  unit TEXT NOT NULL,
  -- Mongo: reason String, required in schema (create path normalizes with
  -- purpose so at least one is present). NOT NULL with '' default.
  reason TEXT NOT NULL DEFAULT '',
  -- Mongo: purpose String, required in schema (create path normalizes).
  purpose TEXT NOT NULL DEFAULT '',
  -- Mongo: expectedDate Date — required; create path defaults to now.
  expected_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongo: priority enum ['High','Medium','Low'], default 'Medium'.
  priority TEXT NOT NULL DEFAULT 'Medium',
  -- Mongo: status enum ['Pending','Approved','Rejected','Issued'], default
  -- 'Pending'.
  status TEXT NOT NULL DEFAULT 'Pending',
  -- Mongo: adminReason String, default ''.
  admin_reason TEXT NOT NULL DEFAULT '',
  -- Mongo: rejectionReason String, default ''.
  rejection_reason TEXT NOT NULL DEFAULT '',
  -- Mongo: rejectedAt Date, default null.
  rejected_at TIMESTAMPTZ,
  -- Mongo: approvedBy String, default ''.
  approved_by TEXT NOT NULL DEFAULT '',
  -- Mongo: approvedAt Date, default null.
  approved_at TIMESTAMPTZ,
  -- Mongo: reviewedBy String, default ''.
  reviewed_by TEXT NOT NULL DEFAULT '',
  -- Mongo: reviewedAt Date, default null.
  reviewed_at TIMESTAMPTZ,
  -- Mongo: issuedAt Date, default null.
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_requests_quantity_check CHECK (quantity >= 0),
  CONSTRAINT inventory_requests_priority_check CHECK (priority IN ('High', 'Medium', 'Low')),
  CONSTRAINT inventory_requests_status_check CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Issued'))
);

-- The Mongo schema declares userId: { ..., index: true } (an ordinary,
-- non-unique index) and every real read path filters by userId:
--   * getInventoryRequests  — InventoryRequest.find({ userId }).sort({ createdAt: -1 })
--   * getInventorySummary   — InventoryRequest.find({ userId })
--   * createInventoryRequest duplicate check — findOne({ userId, itemName,
--     status: 'Pending', createdAt: range })
CREATE INDEX IF NOT EXISTS idx_inventory_requests_user_id ON inventory_requests (user_id);

-- The admin list and the per-user list both sort by createdAt descending:
--   * getInventoryRequests   — .sort({ createdAt: -1 })
--   * AdminDashboard/InventoryManagement — /api/staff/inventory-requests
--     renders createdAt DESC
-- A bare createdAt DESC index serves every one of those scans.
CREATE INDEX IF NOT EXISTS idx_inventory_requests_created_at ON inventory_requests (created_at DESC);

-- The duplicate-request guard in createInventoryRequest:
--   InventoryRequest.findOne({ userId, itemName, status: 'Pending',
--   createdAt: { $gte: todayStart, $lte: todayEnd } })
-- The leading user_id equality + status equality + createdAt range make a
-- compound index behave like Mongo's per-key indexes for this exact predicate.
CREATE INDEX IF NOT EXISTS idx_inventory_requests_user_status_created_at
  ON inventory_requests (user_id, status, created_at DESC);