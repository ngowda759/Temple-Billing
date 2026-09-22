-- Phase 2AH: inventory_issues (MongoDB → PostgreSQL migration).
--
-- Numbered 034 to follow 033_create_support_requests.sql. The prefix sequence
-- is continuous and collision-free:
--
--     030_create_tasks.sql
--     031_create_cash_closings.sql
--     032_create_suppliers.sql
--     033_create_support_requests.sql
--     034_create_inventory_issues.sql   (this migration)
--
-- migrate.js sorts filenames, so a duplicate prefix would make the apply order
-- ambiguous.
--
-- Mirrors backend/src/models/InventoryIssue.js and every real usage of the
-- InventoryIssue model (audited in docs/postgres-inventory-issue-phase-2ah.md):
--   * inventoryRequestController.issueInventoryRequest — the ONLY create path.
--     Inside one Mongo multi-document transaction it writes
--     InventoryIssue.create([{ request, item, itemName, userId, userName,
--     role, issuedQuantity, unit, issuedBy, purpose }], { session }) together
--     with the InventoryItem stock movement and the request → 'Issued'
--     transition.
--   * inventoryIssueController.getInventoryIssues — reads
--     InventoryIssue.find(userId ? { userId } : {}).sort({ issueDate: -1 }).
--   * inventoryIssueController.completeUsage — the ONLY update path:
--     issue.status = 'Completed'; issue.save().
--   * inventoryConsumptionService / InventoryConsumption.issue — downstream
--     consumers of the issue id.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by inventoryIssueRepository, reachable through
-- inventoryIssueService) that is selected only when the service is used AND
-- PostgreSQL is reachable. MongoDB stays the source of truth and the fallback
-- path; no Mongo → PostgreSQL switch happens anywhere in the application, there
-- are no dual writes and no production data is migrated. The Mongoose model is
-- left untouched.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing InventoryIssue model. This is
-- load-bearing: inventory_consumptions.issue_id is already a plain indexed TEXT
-- column holding those ObjectIds, so preserving the ObjectId hex keeps existing
-- references resolvable with NO change to inventory_consumptions.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id             → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * request         → request_id TEXT NULL (optional ObjectId ref to
--                       InventoryRequest — plain indexed TEXT, NO FK; see
--                       "Foreign keys" below)
--   * item            → inventory_item_id TEXT NOT NULL
--                       REFERENCES inventory_items(id) ON DELETE RESTRICT
--   * itemName        → item_name TEXT NOT NULL
--   * userId          → user_id TEXT NOT NULL (Mongo schema: String, NOT the
--                       User ObjectId ref — the real write path stores the
--                       requesting user's username)
--   * userName        → user_name TEXT NOT NULL
--   * role            → role TEXT NOT NULL
--   * issuedQuantity  → issued_quantity NUMERIC NOT NULL (required, min: 0)
--   * unit            → unit TEXT NOT NULL
--   * issueDate       → issue_date TIMESTAMPTZ NOT NULL DEFAULT now()
--   * issuedBy        → issued_by TEXT NOT NULL
--   * purpose         → purpose TEXT NOT NULL DEFAULT '' (default '')
--   * status          → status TEXT NOT NULL DEFAULT 'Active', CHECK over
--                       ['Active','Completed'] (the schema's only enum)
--   * createdAt       → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt       → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted fields: none. Every persisted Mongo field from the
-- InventoryIssue schema has an explicit column above. No column is invented.
--
-- Foreign keys:
--   * inventory_item_id → inventory_items(id): the Mongo schema declares
--     item: { type: ObjectId, ref: 'InventoryItem', required: true } and the
--     only real write path (issueInventoryRequest) resolves the item by name,
--     loads it and stores its _id, so the FK target is a real item in practice.
--     inventory_items exists in PostgreSQL (Phase 2H). ON DELETE RESTRICT is
--     the least behaviour-changing strategy, identical to
--     inventory_consumptions: Mongo's deleteInventoryItem calls
--     InventoryItem.findByIdAndDelete(id) with no issue cleanup, so issues
--     REMAIN (silently orphaned) after an item delete. PostgreSQL must NOT
--     cascade-delete them — a cascade would destroy data Mongo keeps — so the
--     FK refuses the delete instead.
--   * request_id → inventory_requests: **NO FK in this phase.** Issue rows are
--     written only when the referenced request may live in either store, and the
--     same temporary exemption was granted to inventory_consumptions.issue_id
--     (012_create_inventory_consumption.sql). A hard FK today would reject
--     legitimate issue rows whose request resides only in MongoDB. This is plain
--     indexed TEXT and is promoted to a real FK in a later phase once issuance
--     is fully on PostgreSQL. This is the one audit-documented compatibility
--     caveat.
--   * user_id → users: **NO FK** — the Mongo schema declares userId a String
--     (not an ObjectId ref) holding usernames, and users remains Mongo-backed as
--     the source of truth. Plain TEXT, exactly like every user reference in
--     Phases 2A–2L.
--
-- Monetary values: none — InventoryIssue is a pure quantity record (no prices or
-- amounts), so no NUMERIC money column is needed.
--
-- Quantities use NUMERIC (not integer): the Mongo schema declares
-- issuedQuantity as Number, required, min: 0, and the real flow uses fractional
-- kitchen quantities (issueInventoryRequest parses parseFloat). NUMERIC with a
-- >= 0 CHECK mirrors the Mongo schema's min: 0 exactly: zero is legal, negatives
-- are refused, and decimal scale is preserved (10.50 stays 10.50, 1000.125
-- stays 1000.125).
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * status: ['Active', 'Completed'] — default 'Active'. 'Active' = issued and
--     awaiting reconciliation; 'Completed' = usage logged via completeUsage.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly
-- (issueDate default Date.now → now()).
--
-- Embedded/nested data: the MongoDB InventoryIssue schema has no embedded
-- arrays or objects (only a flat set of scalar fields plus ObjectId refs), so
-- nothing needs to be normalized and no JSONB column is required.
--
-- Uniqueness semantics: the Mongo schema declares ONE index — userId
-- { index: true } — which is ordinary and NOT unique, and no unique indexes at
-- all. No unique constraint is created here (the issue lifecycle has no
-- idempotence or duplicate guard at the model or DB level).

CREATE TABLE IF NOT EXISTS inventory_issues (
  id TEXT PRIMARY KEY,
  -- Mongo: request ObjectId ref 'InventoryRequest' — optional. Plain indexed
  -- TEXT, NO FK (see header): the referenced request may still live in MongoDB.
  request_id TEXT,
  -- Mongo: item ObjectId ref 'InventoryItem' — required. Real FK to the
  -- Phase 2H table. ON DELETE RESTRICT: Mongo keeps issues orphaned when an
  -- item is deleted, so PostgreSQL refuses the delete instead (see header).
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  -- Mongo: itemName String — required.
  item_name TEXT NOT NULL,
  -- Mongo: userId String — required. Plain TEXT: in the real write path this
  -- stores the requesting user's USERNAME, and users stays Mongo-backed, so no
  -- FK.
  user_id TEXT NOT NULL,
  -- Mongo: userName String — required.
  user_name TEXT NOT NULL,
  -- Mongo: role String — required (free-form, not an enum).
  role TEXT NOT NULL,
  -- Mongo: Number, required, min: 0. NUMERIC + >= 0 CHECK mirror the schema.
  issued_quantity NUMERIC NOT NULL,
  -- Mongo: unit String — required (free-form snapshot copied from the item; no
  -- CHECK in the Mongo schema).
  unit TEXT NOT NULL,
  -- Mongo: Date, default Date.now.
  issue_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongo: issuedBy String — required (req.user.name || req.user.id, else
  -- 'Admin').
  issued_by TEXT NOT NULL,
  -- Mongo: purpose String, default ''.
  purpose TEXT NOT NULL DEFAULT '',
  -- Mongo: status enum ['Active','Completed'], default 'Active'.
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_issues_issued_quantity_check CHECK (issued_quantity >= 0),
  CONSTRAINT inventory_issues_status_check CHECK (status IN ('Active', 'Completed'))
);

-- The Mongo schema declares userId: { ..., index: true } (an ordinary,
-- non-unique index) and both real read paths filter by userId:
--   * GET /api/staff/inventory-issues/:userId
--   * GET /api/priest/inventory-issues/:userId
CREATE INDEX IF NOT EXISTS idx_inventory_issues_user_id ON inventory_issues (user_id);

-- Every read sorts by issueDate descending:
--   InventoryIssue.find(query).sort({ issueDate: -1 })
-- The leading DESC ordering makes this a covering index for that scan (Mongo has
-- no index on issueDate, so PostgreSQL is strictly faster here).
CREATE INDEX IF NOT EXISTS idx_inventory_issues_issue_date ON inventory_issues (issue_date DESC);

-- Mongo: item ObjectId ref 'InventoryItem'. Supports per-item inspection and
-- backs the inventory_item_id FK.
CREATE INDEX IF NOT EXISTS idx_inventory_issues_inventory_item_id ON inventory_issues (inventory_item_id);

-- Mongo: request ObjectId ref 'InventoryRequest' (optional). Plain indexed TEXT
-- pending the deferred FK — mirrors the temporary exemption on
-- inventory_consumptions.issue_id.
CREATE INDEX IF NOT EXISTS idx_inventory_issues_request_id ON inventory_issues (request_id);
