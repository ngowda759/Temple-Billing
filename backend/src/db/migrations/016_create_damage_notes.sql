-- Phase 2O: damage_notes (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/DamageNote.js and its real usages across the
-- application:
--   * DamageNote.js — the Mongoose model: damageNumber (String, required,
--     unique, trim), item (ObjectId ref 'InventoryItem', required), batch
--     (ObjectId ref 'InventoryBatch', optional), quantity (Number, required,
--     min: 1), reason (String, required, 6-value enum), description (String,
--     required), photoUrl (String, optional), reportedBy (ObjectId ref
--     'Employee', required), status (3-value enum, default 'Pending
--     Approval'), approvedBy (ObjectId ref 'Employee', optional),
--     writeOffAmount (Number, default 0, no min), expenseId (ObjectId ref
--     'AccountTransaction', optional), timestamps.
--   * inventoryWorkflowController.approveDamageNote — the only real consumer
--     of DamageNote in the codebase: loads DamageNote.findById(id).populate
--     ("item"), refuses when status !== 'Pending Approval', flips status to
--     'Approved' and sets approvedBy: req.user._id, then deducts
--     damage.quantity from InventoryItem (availableStock) via the
--     inventoryHelper.deductStock helper and writes an InventoryLog, bumps
--     item.damagedStock, saves the note, and finally recordTransaction(...)
--     an AccountTransaction (transactionType: 'Debit', source: 'Inventory',
--     category: 'Inventory Loss', amount: damage.writeOffAmount ||
--     item.lastPurchasePrice * damage.quantity, referenceModel:
--     'DamageNote', referenceId: damage._id).
--   * The DamageNote route is NOT wired to any Express router today: the
--     frontend "Mark as Damaged/Expired" action calls the InventoryItem
--     adjust (adjustStock) endpoint instead, and AdminInventoryDashboard
--     shows a hard-coded 'pendingDamages: 1' metric. The Mongoose model stays
--     Mongo-backed and the create/list flows have no controller, so Phase 2O
--     adds a minimal service + repository and re-points the ONE real
--     controller consumer (approveDamageNote) at the new service.
--   * AccountTransaction.referenceModel (enum) already lists 'DamageNote';
--     the approve flow writes an AccountTransaction with that reference (a
--     polymorphic reference_id stored as plain TEXT in PostgreSQL — no FK is
--     derived from it inside DamageNote).
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the damageNoteRepository, reachable through the
-- damageNoteService) that is selected only when the service is explicitly used
-- AND PostgreSQL is reachable. MongoDB stays the source of truth and the
-- fallback path; no Mongo → PostgreSQL switch happens anywhere in the
-- application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing DamageNote model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id           → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * damageNumber  → damage_number TEXT NOT NULL, UNIQUE (unique: true in
--                     Mongo; the sole uniqueness semantic on the model)
--   * item          → inventory_item_id TEXT NOT NULL REFERENCES
--                     inventory_items(id) ON DELETE RESTRICT (ObjectId ref
--                     'InventoryItem' required; inventory_items IS
--                     PostgreSQL-backed (Phase 2H) so a real FK is used.
--                     ON DELETE RESTRICT: Mongo keeps damage notes orphaned if
--                     an item were deleted and the approve flow reads
--                     item.lastPurchasePrice / item.name through the populated
--                     reftherefore PostgreSQL refuses the item delete — never
--                     silently destroys the write-off record Mongo keeps)
--   * batch         → inventory_batch_id TEXT REFERENCES
--                     inventory_batches(id) ON DELETE RESTRICT (ObjectId ref
--                     'InventoryBatch' optional; inventory_batches IS
--                     PostgreSQL-backed (Phase 2I) so a real FK is used.
--                     ON DELETE RESTRICT: same reasoning — the note is an
--                     independent audit record and no cascade exists in Mongo)
--   * quantity      → quantity NUMERIC NOT NULL (Number, required, min: 1;
--                     NUMERIC preserves fractional quantities exactly — see
--                     inventory-items Phase 2H precedent — with CHECK >= 1
--                     mirroring the Mongoose min: 1 validator)
--   * reason        → reason TEXT NOT NULL, CHECK over the 6-value enum
--                     ['Expired','Broken/Damaged','Lost/Stolen','Spoiled',
--                     'Quality Issue','Other']
--   * description   → description TEXT NOT NULL
--   * photoUrl      → photo_url TEXT (optional, trim)
--   * reportedBy    → reported_by TEXT NOT NULL (ObjectId ref 'Employee' —
--                     employees IS PostgreSQL-backed (Phase 2A), but the
--                     approve flow dereferences reportedBy through the User
--                     model (email), not through employees; the employee id
--                     stored here is the Employee collection id, which is NOT
--                     the users table id. A real FK to employees(id) would
--                     therefore reject valid existing documents, and no other
--                     migrated table references employees(id). Plain TEXT, NO
--                     FK — same convention as users.employee_id / GRN
--                     received_by / approved_by)
--   * status        → status TEXT NOT NULL DEFAULT 'Pending Approval', CHECK
--                     over ['Pending Approval','Approved','Rejected'] (enum,
--                     default 'Pending Approval')
--   * approvedBy    → approved_by TEXT (ObjectId ref 'Employee' — plain TEXT,
--                     NO FK; same reasoning as reportedBy)
--   * writeOffAmount → write_off_amount NUMERIC NOT NULL DEFAULT 0 (Number,
--                     default 0, NO min in Mongo — negatives allowed exactly
--                     like the schema, so there is deliberately NO CHECK)
--   * expenseId     → expense_id TEXT (ObjectId ref 'AccountTransaction' —
--                     optional; referenceModel 'DamageNote' transactions are
--                     written by the approve flow but account_transactions is
--                     PostgreSQL-backed with polymorphic reference_id TEXT
--                     that is not a stable identity, and pre-cutting-over the
--                     note's expenseId would create a one-way binding from a
--                     Mongo expense id to a PG row. Plain TEXT, NO FK)
--   * createdAt     → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt     → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Nested data: none. DamageNote is a flat document — no embedded array, no
-- nested sub-documents — so no child table and no JSONB are needed.
--
-- Stored vs derived: write_off_amount is a STORED field in the Mongo model
-- (persisted, default 0). The approve flow DERIVES the AccountTransaction
-- amount as `damage.writeOffAmount || item.lastPurchasePrice * damage.quantity
-- || 0` at write time but never writes that derivation back to the note, so
-- PostgreSQL does not introduce a new derived column either.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * reason: ['Expired', 'Broken/Damaged', 'Lost/Stolen', 'Spoiled',
--     'Quality Issue', 'Other'] — required, no default.
--   * status: ['Pending Approval', 'Approved', 'Rejected'] — default 'Pending
--     Approval'.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
-- Nullable columns (batch, photo_url, approved_by, expense_id) stay nullable
-- with no default — they are unset until the application sets them, exactly
-- like the Mongo schema's optional fields.
--
-- Uniqueness semantics: the Mongo schema declares ONE unique index —
-- damageNumber { unique: true }. That is preserved as a UNIQUE constraint on
-- damage_number. No other unique index exists on the model, so none is
-- invented.
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * idx_damage_notes_status — the approveDamageNote workflow loads a note
--     by id but LIST screens (future dashboard) are status-driven: admin
--     "pending damages" lists approve/deny by status.
--   * idx_damage_notes_inventory_item_id — per-item write-off history (the
--     approve flow reads the linked item; reports sum damage by item).
--   * idx_damage_notes_inventory_batch_id — per-batch write-off history.
--   * idx_damage_notes_created_at — the default createdAt DESC ordering
--     convention used by every other entity list.
-- The unique damage_number index and the PK already cover id/damageNumber
-- lookups. No other column has a standing query pattern, so no other index is
-- created.

CREATE TABLE IF NOT EXISTS damage_notes (
  id TEXT PRIMARY KEY,
  -- Mongo: damageNumber String — required, unique, trim.
  damage_number TEXT NOT NULL,
  -- Mongo: item ObjectId ref 'InventoryItem' — required. Real FK to the
  -- Phase 2H table; the approve flow populates item and reads
  -- lastPurchasePrice/name. ON DELETE RESTRICT: Mongo keeps the note (an
  -- independent audit record) orphaned if an item is deleted, so PostgreSQL
  -- refuses the delete instead of silently destroying data Mongo keeps.
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  -- Mongo: batch ObjectId ref 'InventoryBatch' — optional. Real FK to the
  -- Phase 2I table. ON DELETE RESTRICT: same audit-record reasoning.
  inventory_batch_id TEXT REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  -- Mongo: Number — required, min: 1. NUMERIC preserves fractional
  -- quantities exactly; the min mirrors the Mongoose validator.
  quantity NUMERIC NOT NULL,
  -- Mongo: reason String — required, 6-value enum.
  reason TEXT NOT NULL,
  -- Mongo: description String — required.
  description TEXT NOT NULL,
  -- Mongo: photoUrl String — optional, trim.
  photo_url TEXT,
  -- Mongo: reportedBy ObjectId ref 'Employee' — required. Plain TEXT, NO FK
  -- (the Employee collection id is not the users table id; see header).
  reported_by TEXT NOT NULL,
  -- Mongo: status enum, default 'Pending Approval'.
  status TEXT NOT NULL DEFAULT 'Pending Approval',
  -- Mongo: approvedBy ObjectId ref 'Employee' — optional. Plain TEXT, NO FK.
  approved_by TEXT,
  -- Mongo: writeOffAmount Number — default 0, NO min (negatives allowed in
  -- Mongo, so there is deliberately NO CHECK).
  write_off_amount NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: expenseId ObjectId ref 'AccountTransaction' — optional. Plain
  -- TEXT, NO FK (polymorphic reference; see header).
  expense_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's damageNumber unique: true.
  CONSTRAINT damage_notes_damage_number_key UNIQUE (damage_number),
  CONSTRAINT damage_notes_quantity_check CHECK (quantity >= 1),
  CONSTRAINT damage_notes_reason_check CHECK (reason IN ('Expired', 'Broken/Damaged', 'Lost/Stolen', 'Spoiled', 'Quality Issue', 'Other')),
  CONSTRAINT damage_notes_status_check CHECK (status IN ('Pending Approval', 'Approved', 'Rejected'))
);

-- Status equals filters / list grouping — the admin damage review list is
-- status-driven (pending damages to approve / reject).
CREATE INDEX IF NOT EXISTS idx_damage_notes_status ON damage_notes (status);

-- Per-item write-off history (approveDamageNote reads the linked item;
-- reports sum damage by item).
CREATE INDEX IF NOT EXISTS idx_damage_notes_inventory_item_id ON damage_notes (inventory_item_id);

-- Per-batch write-off history.
CREATE INDEX IF NOT EXISTS idx_damage_notes_inventory_batch_id ON damage_notes (inventory_batch_id);

-- Default createdAt DESC ordering convention shared by every entity list.
CREATE INDEX IF NOT EXISTS idx_damage_notes_created_at ON damage_notes (created_at DESC);