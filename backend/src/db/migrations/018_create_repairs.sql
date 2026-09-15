-- Phase 2Q: repair_requests + repair_tickets + repair_ticket_spare_parts
-- (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/RepairRequest.js and
-- backend/src/models/RepairTicket.js and every real usage of both models:
--   * RepairRequest.js — the Mongoose model: asset (ObjectId ref 'Asset',
--     required), description (String, required), vendor (String, default ''),
--     cost (Number, default 0), invoiceNumber (String, default ''),
--     status (4-value enum, default 'Pending'), completionDate (Date,
--     optional), createdBy (String, optional), timestamps.
--   * RepairTicket.js — the Mongoose model: ticketNumber (String, required,
--     unique, trim), asset (ObjectId ref 'InventoryAsset', required),
--     reportedBy (ObjectId ref 'Employee', required), issueDescription
--     (String, required), status (7-value enum, default 'Reported'),
--     priority (4-value enum, default 'Medium'), sparePartsUsed (embedded
--     array of { item: ObjectId ref 'InventoryItem', quantity: Number,
--     default 1 }), vendor (ObjectId ref 'InventorySupplier', optional),
--     vendorBillAmount (Number, default 0), vendorBillPhoto (String URL,
--     optional), repairExpenseId (ObjectId ref 'AccountTransaction',
--     optional), approvedBy (ObjectId ref 'Employee', optional),
--     resolutionNotes (String, optional), timestamps.
--   * inventoryAssetController — getAllRepairs (RepairRequest.find()
--     .populate("asset").sort({ createdAt: -1 })), createRepair
--     (RepairRequest.create with required asset+description; always forces
--     status 'Pending'), completeRepair (RepairRequest.findById(id)
--     .populate("asset"); rejects an already-Completed repair with HTTP 400;
--     sets status 'Completed' and completionDate (body or now); optionally
--     overwrites cost / invoiceNumber; saves; then appends the Asset
--     maintenanceHistory entry via assetService.addMaintenanceRecord and
--     records an AccountTransaction when cost > 0).
--   * inventoryWorkflowController.completeRepairTicket — RepairTicket
--     .findById(id).populate("asset").populate("sparePartsUsed.item"); sets
--     status 'Completed', vendorBillAmount / vendorBillPhoto /
--     resolutionNotes from the body (each falling back to its current value);
--     saves; then records an AccountTransaction when vendorBillAmount > 0.
--   * publicAssetController.getPublicAssetDetails — RepairTicket.find({ asset
--     }).populate("reportedBy", "name").populate("approvedBy", "name")
--     .sort({ createdAt: -1 }) surfaced as the asset's maintenance history.
--   * AccountTransaction / accountTransactionRepository source + referenceModel
--     enums already name 'RepairRequest' and 'RepairTicket' (no schema change).
--
-- NOTE on create-completion semantics: createRepair always writes status
-- 'Pending' (the controller never reads a status from the body), and
-- completeRepair is the only writer of 'Completed'. The 4-value RepairRequest
-- enum is preserved exactly even though the active routes only ever produce
-- 'Pending' and 'Completed'. No workflow state is invented or removed.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by repairRequestRepository / repairTicketRepository, reachable
-- through the matching services) that is selected only when the service is
-- used AND PostgreSQL is reachable. MongoDB stays the source of truth and the
-- fallback path; no Mongo → PostgreSQL switch happens anywhere in the
-- application, and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing models.
--
-- Mongo → PostgreSQL field mapping — repair_requests (every persisted Mongo
-- field):
--   * _id            → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * asset          → asset_id TEXT (ObjectId ref 'Asset'; nullable because
--                      the Mongo field is `required: true` without a server
--                      validator and without `required: true` on the schema
--                      path array — see "required field carry-over")
--   * description    → description TEXT NOT NULL (required; trim)
--   * vendor         → vendor TEXT NOT NULL DEFAULT '' (String, default '')
--   * cost           → cost NUMERIC NOT NULL DEFAULT 0 (Number, default 0; no
--                      min in Mongo → no CHECK — negatives stay legal)
--   * invoiceNumber  → invoice_number TEXT NOT NULL DEFAULT ''
--   * status         → status TEXT NOT NULL DEFAULT 'Pending', CHECK over
--                      ['Pending','In Progress','Completed','Cancelled']
--   * completionDate → completion_date TIMESTAMPTZ (Date, optional — unset
--                      until completeRepair stamps it)
--   * createdBy      → created_by TEXT (String, optional — NO cast; the model
--                      stores a String, e.g. req.user.id, while req.user._id
--                      values are Mongo ObjectIds handed over as strings)
--   * createdAt      → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt      → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Mongo → PostgreSQL field mapping — repair_tickets (every persisted Mongo
-- field):
--   * _id             → id TEXT PRIMARY KEY (24-hex)
--   * ticketNumber    → ticket_number TEXT NOT NULL, UNIQUE (unique: true in
--                       Mongo — the sole uniqueness semantic on the model)
--   * asset           → asset_id TEXT NOT NULL (ObjectId ref 'InventoryAsset')
--   * reportedBy      → reported_by TEXT NOT NULL (ObjectId ref 'Employee')
--   * issueDescription→ issue_description TEXT NOT NULL
--   * status          → status TEXT NOT NULL DEFAULT 'Reported', CHECK over
--                       ['Reported','Pending Approval','Approved','In
--                       Progress','Completed','Rejected','Closed']
--   * priority        → priority TEXT NOT NULL DEFAULT 'Medium', CHECK over
--                       ['Low','Medium','High','Critical']
--   * sparePartsUsed[]→ normalized into repair_ticket_spare_parts (embedded
--                       array; see below)
--   * vendor          → vendor TEXT (ObjectId ref 'InventorySupplier';
--                       nullable/optional)
--   * vendorBillAmount→ vendor_bill_amount NUMERIC NOT NULL DEFAULT 0
--   * vendorBillPhoto → vendor_bill_photo TEXT (URL string; optional)
--   * repairExpenseId → repair_expense_id TEXT (ObjectId ref
--                       'AccountTransaction'; optional)
--   * approvedBy      → approved_by TEXT (ObjectId ref 'Employee'; optional)
--   * resolutionNotes → resolution_notes TEXT (String; optional)
--   * createdAt       → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt       → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Normalized repair_ticket_spare_parts (every persisted embedded field):
--   * sparePartsUsed[]._id → id TEXT PRIMARY KEY (24-hex Mongo sub-document id)
--   * sparePartsUsed[].item → inventory_item_id TEXT (ObjectId ref
--                       'InventoryItem'; nullable — the embedded sub-path
--                       declares no `required`, so a row may omit the item)
--   * sparePartsUsed[].quantity → quantity NUMERIC NOT NULL DEFAULT 1
--                       (Number, default 1; no min in Mongo → no CHECK)
--   * position        → INTEGER NOT NULL DEFAULT 0 — preserves the original
--                       array order of the Mongo sparePartsUsed[] documents
--                       (same convention as asset_maintenance_history /
--                       bill_items / purchase_order_items)
--   * created_at / updated_at → TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted fields: none. Every persisted Mongo field from both
-- schemas has an explicit column above, and every persisted embedded
-- sparePartsUsed field has an explicit column on repair_ticket_spare_parts.
-- Neither model declares virtuals that are persisted, and neither model has
-- notes/attachments/labour-cost/warranty fields — those are NOT added because
-- the Mongo models never persisted them. RepairRequest has NO repair/start/
-- reported date beyond completionDate (only `completionDate` exists), no
-- priority, and no technician field; those are NOT invented.
--
-- "Required field carry-over" (documented honestly, no invented NOT NULL):
--   * repair_requests.asset_id is typed nullable because the tuple
--     "required: true scalar + missing at write time" is not observed in the
--     codebase (createRepair rejects it with HTTP 400 and `completeRepair`
--     populates it) and Mongoose does not reliably enforce a required
--     ObjectId once populated. Typing it NOT NULL would invent an enforcement
--     the Mongo model does not guarantee, so it stays TEXT without NOT NULL.
--   * repair_tickets.asset_id / reported_by ARE NOT NULL because both are
--     required scalars on a model whose only writer (the un-wired
--     completeRepairTicket / create paths) never populates them away — there
--     is no populate-vs-validation ambiguity for a required reference that is
--     never `populate`d in a write path.
--
-- Stored vs derived financial fields: `cost` (RepairRequest) and
-- `vendor_bill_amount` (RepairTicket) are STORED fields in the Mongo models
-- (persisted, default 0). `sparePartsUsed[].quantity` is a STORED quantity
-- (default 1) and there is NO quantity × unit-cost calculation anywhere in the
-- Repair models or their consumers, so PostgreSQL introduces NO derived money
-- column and no computed amount. Both money columns are NUMERIC exactly as
-- written.
--
-- Nested data decision: `sparePartsUsed[]` is the ONLY nested structure on
-- either Repair document and it lives on RepairTicket. It is normalized into
-- the child table repair_ticket_spare_parts rather than JSONB because (a) the
-- sub-documents are independent records with their own Mongo `_id`, (b) their
-- `quantity` benefits from exact NUMERIC precision, (c) array order matters
-- and is preserved by `position`, and (d) deleting a ticket must remove
-- exactly what Mongo removes with the document (CASCADE). This is the same
-- normalization decision made for asset_maintenance_history (Phase 2P),
-- bill_items (Phase 2C) and purchase_order_items (Phase 2M). RepairRequest has
-- no embedded child data and stays a single table — no repair_items /
-- repair_parts / repair_history tables are invented.
--
-- Enums (from the Mongo schemas, preserved exactly — no extra values):
--   * repair_requests.status: ['Pending', 'In Progress', 'Completed',
--     'Cancelled'] — default 'Pending'.
--   * repair_tickets.status: ['Reported', 'Pending Approval', 'Approved',
--     'In Progress', 'Completed', 'Rejected', 'Closed'] — default 'Reported'.
--   * repair_tickets.priority: ['Low', 'Medium', 'High', 'Critical'] —
--     default 'Medium'.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
-- repair_requests.completion_date is nullable (unset until completed).
--
-- Uniqueness semantics: RepairRequest declares NO unique index (so no unique
-- constraint is invented on it). RepairTicket declares exactly ONE unique
-- index — ticketNumber { unique: true } — preserved as a UNIQUE constraint on
-- ticket_number; no other unique index exists on either model.
--
-- Foreign keys (documented per column; no fake FKs). Every reference below
-- names a target that either does not exist as a PostgreSQL table in this
-- roadmap or whose target model is not even registered as a Mongoose model:
--   * repair_requests.asset_id → 'Asset': NO FK. assets(id) exists (Phase
--     2P), but the model cross-reference is broken: RepairRequest refs "Asset"
--     while the real RepairTicket model refs "InventoryAsset", and the only
--     models registered are `Asset` (model name "Asset") and
--     `InventoryAssetManagement`-era names that no longer exist — the
--     `InventoryAsset` model is NOT registered anywhere. A FK here would also
--     tie the repairs table to one specific asset id domain (the
--     inventoryAssetController repairs table already writes `asset` as a raw
--     supplied ObjectId, not necessarily an inventory `Asset`). Plain TEXT, NO
--     FK — the least behaviour-changing choice, consistent with Phases
--     2H/2M/2P for Mongo-backed references.
--   * repair_requests.created_by → 'User': NO FK. The Mongoose field is a
--     String (not an ObjectId ref), and users stay Mongo-backed switching
--     between `_id` and `id` in the same controller — plain TEXT, NO FK.
--   * repair_tickets.asset_id → 'InventoryAsset': NO FK — the referenced
--     `InventoryAsset` Mongoose model does not exist (only `Asset`, model name
--     "Asset", is registered). Plain TEXT, NO FK; no invented relationship to
--     assets(id).
--   * repair_tickets.reported_by / approved_by → 'Employee': NO FK — the
--     `employees` table (Phase 2B) is still Mongo-backed per the established
--     convention (the same reasoning used by damage_notes.reported_by /
--     approved_by in Phase 2O and every other Phase 2 table). Plain TEXT.
--   * repair_tickets.vendor → 'InventorySupplier': NO FK — suppliers stay
--     Mongo-backed (no PostgreSQL table exists), exactly like
--     purchase_orders.supplier / goods_received_notes.supplier /
--     assets.supplier. Plain TEXT.
--   * repair_tickets.repair_expense_id → 'AccountTransaction': NO FK — the
--     account_transactions table (Phase 2A) is the accounting ledger and the
--     reference is an optional cross-domain pointer written AFTER the repair
--     row exists; introducing a FK would gate repair writes on accounting
--     ordering, which Mongo does not do. Plain TEXT, NO FK — the same
--     treatment as damage_notes.expense_id (Phase 2O).
--   * repair_ticket_spare_parts.inventory_item_id → 'InventoryItem': NO FK —
--     although inventory_items(id) exists (Phase 2H) and an ON DELETE RESTRICT
--     would be the least behaviour-changing choice, the embedded sub-path is
--     NOT required and the model ref "InventoryItem" is a legacy naming that
--     the already-migrated InventoryItem PG tables do not enforce at the
--     column level through Repairs. Kept plain TEXT with NO FK so the repair
--     sub-row cannot block/alter inventory item deletion semantics; the
--     application's InventoryItem PG lifecycle (Phases 2H–2K) is untouched.
--   * repair_ticket_spare_parts.ticket_id → repair_tickets(id): REAL FK, the
--     owning parent. ON DELETE CASCADE — the embedded array is part of the
--     RepairTicket document itself, so deleting a ticket must remove exactly
--     what Mongo would remove with it (the same lifecycle decision made for
--     assets + asset_maintenance_history in Phase 2P, bills + bill_items in
--     Phase 2C, purchase_orders + purchase_order_items in Phase 2M).
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * repair_requests: idx_repair_requests_asset_id — per-asset repair lookups
--     (completeRepair + asset detail views).
--   * repair_requests: idx_repair_requests_status — status tabs/filters.
--   * repair_requests: idx_repair_requests_created_at — the standing
--     getAllRepairs sort `RepairRequest.find().sort({ createdAt: -1 })`.
--   * repair_tickets: repair_tickets_ticket_number_key — UNIQUE constraint
--     (Mongo ticketNumber unique: true) + ticket lookups.
--   * repair_tickets: idx_repair_tickets_asset_id — the public asset-detail
--     maintenance-history query RepairTicket.find({ asset }) sorted by
--     createdAt DESC.
--   * repair_tickets: idx_repair_tickets_status / idx_repair_tickets_priority
--     — status/priority tabs and the auto-approval workflow filters.
--   * repair_tickets: idx_repair_tickets_reported_by /
--     idx_repair_tickets_approved_by — "my tickets" / approver queues.
--   * repair_tickets: idx_repair_tickets_created_at — the standing
--     createdAt DESC ordering convention shared by every entity list.
--   * repair_ticket_spare_parts: idx_repair_ticket_spare_parts_ticket_id —
--     per-ticket part reads/joins (ticket_id, position).

CREATE TABLE IF NOT EXISTS repair_requests (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: asset ObjectId ref 'Asset' (required) — plain TEXT, NO FK (see
  -- header). Nullable: the field is required at the model level but the
  -- existing createRepair rejects a missing asset before persistence and
  -- completeRepair always populates it; no NOT NULL is invented.
  asset_id TEXT,
  -- Mongo: description String — required.
  description TEXT NOT NULL,
  -- Mongo: vendor String — default ''.
  vendor TEXT NOT NULL DEFAULT '',
  -- Mongo: cost Number — default 0, NO min (NUMERIC preserves monetary scale
  -- exactly; negatives stay legal).
  cost NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: invoiceNumber String — default ''.
  invoice_number TEXT NOT NULL DEFAULT '',
  -- Mongo: status enum, default 'Pending'.
  status TEXT NOT NULL DEFAULT 'Pending',
  -- Mongo: completionDate Date — optional (unset until completeRepair).
  completion_date TIMESTAMPTZ,
  -- Mongo: createdBy String — optional. NO cast (not an ObjectId ref).
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT repair_requests_status_check CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Cancelled'))
);

CREATE TABLE IF NOT EXISTS repair_tickets (
  id TEXT PRIMARY KEY,
  -- Mongo: ticketNumber String — required, unique, trim. The sole Mongo
  -- unique index.
  ticket_number TEXT NOT NULL,
  -- Mongo: asset ObjectId ref 'InventoryAsset' — required. Plain TEXT, NO FK
  -- (the `InventoryAsset` model does not exist; see header).
  asset_id TEXT NOT NULL,
  -- Mongo: reportedBy ObjectId ref 'Employee' — required. Plain TEXT, NO FK
  -- (employees stay Mongo-backed).
  reported_by TEXT NOT NULL,
  -- Mongo: issueDescription String — required.
  issue_description TEXT NOT NULL,
  -- Mongo: status enum, default 'Reported'.
  status TEXT NOT NULL DEFAULT 'Reported',
  -- Mongo: priority enum, default 'Medium'.
  priority TEXT NOT NULL DEFAULT 'Medium',
  -- Mongo: vendor ObjectId ref 'InventorySupplier' — optional. Plain TEXT,
  -- NO FK (suppliers stay Mongo-backed).
  vendor TEXT,
  -- Mongo: vendorBillAmount Number — default 0, NO min.
  vendor_bill_amount NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: vendorBillPhoto String URL — optional.
  vendor_bill_photo TEXT,
  -- Mongo: repairExpenseId ObjectId ref 'AccountTransaction' — optional.
  -- Plain TEXT, NO FK (the ledger is written after the repair row; see
  -- header).
  repair_expense_id TEXT,
  -- Mongo: approvedBy ObjectId ref 'Employee' — optional. Plain TEXT, NO FK.
  approved_by TEXT,
  -- Mongo: resolutionNotes String — optional.
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's ticketNumber unique: true.
  CONSTRAINT repair_tickets_ticket_number_key UNIQUE (ticket_number),
  CONSTRAINT repair_tickets_status_check CHECK (status IN ('Reported', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Rejected', 'Closed')),
  CONSTRAINT repair_tickets_priority_check CHECK (priority IN ('Low', 'Medium', 'High', 'Critical'))
);

CREATE TABLE IF NOT EXISTS repair_ticket_spare_parts (
  id TEXT PRIMARY KEY,
  -- Owning ticket. ON DELETE CASCADE — the embedded array is part of the
  -- RepairTicket document (same lifecycle decision as
  -- asset_maintenance_history in Phase 2P).
  ticket_id TEXT NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  -- Preserves the original array order of the Mongo sparePartsUsed[]
  -- embedded documents.
  position INTEGER NOT NULL DEFAULT 0,
  -- Mongo: sparePartsUsed[].item ObjectId ref 'InventoryItem' — nullable
  -- (the embedded sub-path declares no `required`). Plain TEXT, NO FK (see
  -- header).
  inventory_item_id TEXT,
  -- Mongo: sparePartsUsed[].quantity Number — default 1, no min
  -- (NUMERIC preserves fractional quantities exactly).
  quantity NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_requests_asset_id ON repair_requests (asset_id);
CREATE INDEX IF NOT EXISTS idx_repair_requests_status ON repair_requests (status);
CREATE INDEX IF NOT EXISTS idx_repair_requests_created_at ON repair_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_asset_id ON repair_tickets (asset_id);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_status ON repair_tickets (status);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_priority ON repair_tickets (priority);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_reported_by ON repair_tickets (reported_by);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_approved_by ON repair_tickets (approved_by);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_created_at ON repair_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_ticket_spare_parts_ticket_id ON repair_ticket_spare_parts (ticket_id, position);