-- Phase 2I: inventory_batches (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/InventoryBatch.js and its real usages across the
-- application:
--   * inventoryWorkflowController.approveGRN creates one batch per GRN line
--     ({ item, batchNumber: line.batchNumber || `AUTO-${Date.now()}`, grn,
--     purchasePrice: line.unitPrice, expiryDate, originalQuantity:
--     line.acceptedQuantity, currentQuantity: line.acceptedQuantity,
--     supplier: grn.supplier }).
--   * inventoryWorkflowController.logKitchenProduction consumes raw-material
--     batches FIFO: InventoryBatch.find({ item, status: 'Active' }).sort({
--     expiryDate: 1, createdAt: 1 }), decrementing currentQuantity until it
--     reaches 0 and flipping status to 'Consumed'.
--   * The Mongoose pre('save') hook (run only on create/save, never on
--     findByIdAndUpdate) auto-flips Active → Consumed when currentQuantity is
--     0 and Active → Expired when expiryDate is past; the repository mirrors
--     that in its create path only, exactly like Mongo.
--   * DamageNote.batch references an InventoryBatch by ObjectId, but no query
--     loads batches through it.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the PostgreSQL repository) that is selected only when the
-- Inventory Batch service/repository is explicitly used AND PostgreSQL is
-- reachable. MongoDB stays the source of truth and the fallback path; no
-- Mongo → Postgres switch happens anywhere in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing InventoryBatch model.
--
-- Foreign keys:
--   * inventory_item_id → inventory_items(id): the Mongo schema declares
--     item: { type: ObjectId, ref: 'InventoryItem', required: true } and both
--     real usages (approveGRN create, logKitchenProduction FIFO) require it.
--     inventory_items exists in PostgreSQL (Phase 2H), so a real FK is used.
--     ON DELETE RESTRICT is the least behaviour-changing strategy:
--       * Mongo's deleteInventoryItem calls InventoryItem.findByIdAndDelete(id)
--         with no batch cleanup, so batches REMAIN after an item is deleted
--         (silently orphaned). PostgreSQL must NOT cascade-delete those
--         batches — a cascade would destroy data Mongo keeps.
--       * A real FK cannot orphan rows, so deleting an item that still has
--         batches is refused by the FK (a clear error instructing the caller
--         to remove the batches first). This is strictly safer than the
--         current Mongo behaviour: it never silently destroys batch data and
--         never leaves PostgreSQL in a state Mongo would not be in.
--   * grn → GoodsReceivedNote and supplier → InventorySupplier are plain
--     indexed TEXT holding Mongo ObjectIds: those entities are still
--     Mongo-backed (not migrated in this phase), so no FK is created — no
--     fake FKs to future tables.
--
-- Monetary values use NUMERIC so unit prices round-trip exactly. Quantities
-- use NUMERIC >= 0: the Mongo schema declares originalQuantity and
-- currentQuantity with min: 0 and the real flows use fractional kitchen
-- quantities (deductStock/requiredQty are fractional), so NUMERIC (not
-- integer) is required and negatives are rejected exactly like Mongo.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * status: ['Active', 'Quarantine', 'Expired', 'Consumed', 'Returned',
--     'Disposed'] — default 'Active'.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
--
-- Embedded/nested data: the MongoDB InventoryBatch schema has no embedded
-- arrays or objects (only a flat set of scalar fields plus ObjectId refs), so
-- nothing needs to be normalized and no JSONB column is required.
--
-- Uniqueness semantics are preserved from the Mongo schema:
--   * compound index { item: 1, batchNumber: 1 } is UNIQUE — the Mongo schema
--     declares inventoryBatchSchema.index({ item: 1, batchNumber: 1 },
--     { unique: true }), and no controller performs manual duplicate checks
--     before writing, so the DB constraint is the sole enforcement — identical
--     in PostgreSQL. Multiple batches may (and do) belong to one item, and the
--     same batchNumber may exist for different items.

CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  -- Mongo: item ObjectId ref 'InventoryItem' — required. Real FK to the
  -- Phase 2H table. ON DELETE RESTRICT: Mongo keeps batches orphaned when an
  -- item is deleted, so PostgreSQL refuses the delete instead (see header).
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  batch_number TEXT NOT NULL,
  -- Mongo: grn ObjectId ref 'GoodsReceivedNote' — optional. GoodsReceivedNote
  -- is still Mongo-backed, so this is plain TEXT, no FK.
  grn TEXT,
  -- Mongo: Number, default 0, NO min (negatives allowed exactly like Mongo).
  -- NUMERIC preserves sub-unit scale exactly.
  purchase_price NUMERIC NOT NULL DEFAULT 0,
  manufacturing_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  -- Mongo: Number, required, min: 0 (decimals allowed).
  original_quantity NUMERIC NOT NULL,
  current_quantity NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  -- Mongo: supplier ObjectId ref 'InventorySupplier' — optional. Plain TEXT.
  supplier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_batches_status_check CHECK (status IN ('Active', 'Quarantine', 'Expired', 'Consumed', 'Returned', 'Disposed')),
  CONSTRAINT inventory_batches_original_quantity_check CHECK (original_quantity >= 0),
  CONSTRAINT inventory_batches_current_quantity_check CHECK (current_quantity >= 0),
  -- Mirrors the Mongo schema's { item: 1, batchNumber: 1 } unique index.
  CONSTRAINT inventory_batches_item_batch_number_key UNIQUE (inventory_item_id, batch_number)
);

-- FIFO batch consumption (logKitchenProduction):
--   InventoryBatch.find({ item, status: 'Active' }).sort({ expiryDate: 1, createdAt: 1 })
-- The leading item/status equality plus expiry/createdAt ordering make this a
-- covering index for the consumption scan.
CREATE INDEX IF NOT EXISTS idx_inventory_batches_item_status_expiry ON inventory_batches (inventory_item_id, status, expiry_date, created_at);

-- Default ordering for batch listings mirrors the app-wide createdAt DESC
-- convention (and the FIFO tiebreak's createdAt component).
CREATE INDEX IF NOT EXISTS idx_inventory_batches_created_at ON inventory_batches (created_at DESC);