-- Phase 2H: inventory_items (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/InventoryItem.js and its real usages across the
-- application (inventoryItemController create/update/delete/restock/adjust,
-- inventoryRequestController issueInventoryRequest, inventoryHelper
-- deductStock/addStock, inventoryReportController dashboard/valuation/item
-- details, inventoryWorkflowController GRN/kitchen/damage flows,
-- priestController.getMaterialChecklist, devoteeController/poojaBookingController
-- stock checks, inventoryIssueController.completeUsage).
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the PostgreSQL repository) that is selected only when the
-- Inventory Item service/repository is explicitly used AND PostgreSQL is
-- reachable. MongoDB stays the source of truth and the fallback path; no
-- Mongo → Postgres switch happens anywhere in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing InventoryItem model. Account
-- transactions point at inventory items through reference_id/reference_model
-- = 'InventoryItem'; that column stays polymorphic TEXT (it also references
-- bookings, donations, pooja bookings and prasadam orders), so no FK is
-- created either way — same convention as phases 2A–2G.
--
-- Reference columns stay plain indexed TEXT holding Mongo ObjectId values:
--   * preferred_supplier → InventorySupplier (Mongo-backed, not migrated) — no
--     FK, matching every cross-model reference so far.
--   * expense_head / income_head / inventory_account → AccountHead. The
--     account_heads table exists in PostgreSQL (Phase 2B) but MongoDB remains
--     the source of truth for account heads, so the established convention
--     (plain indexed TEXT, no FK) is kept. The fields are never used by any
--     current write path, so they are nullable.
--
-- Monetary values use NUMERIC so prices round-trip exactly.
--
-- Embedded/nested data: the MongoDB InventoryItem schema has no embedded
-- arrays or objects (only a flat set of scalar fields plus ObjectId refs), so
-- nothing needs to be normalized and no JSONB column is required.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * type: ['Raw Material', 'Finished Good', 'Asset', 'Consumable', 'Other']
--     — default 'Consumable'.
--   * unit: the INVENTORY_UNITS list (40 distinct values) — required, default
--     'Pack'.
--   * category: ['Pooja Items', 'Prasadam Ingredients', 'Cleaning Materials',
--     'Office & Stationery', 'Electrical & Maintenance', 'Festival Materials',
--     'Miscellaneous Items', 'Cooking / Annaprasada'] — default
--     'Miscellaneous Items'.
--
-- Quantities and stock levels use NUMERIC. The Mongo model declares ten stock
-- counters with min: 0 (availableStock, reservedStock, issuedStock,
-- consumedStock, damagedStock, expiredStock, returnedStock, minimumStock,
-- reorderLevel, maximumStock — no upper bound, decimals allowed), so the DB
-- mirrors NUMERIC >= 0 rather than integer.
--
-- shelfLifeDays, purchasePrice, sellingPrice, gstRate and lastPurchasePrice
-- have NO min in the Mongo schema ({ type: Number, default: 0 }), so no >= 0
-- CHECK is applied to them: PostgreSQL permits negatives exactly like Mongo.
--
-- Uniqueness semantics are preserved from the Mongo schema:
--   * compound index (name, category) is UNIQUE — the real applications
--     enforce "no duplicate name within the same category" (inventoryItem
--     create/update check for an existing name+category before writing and
--     translate a duplicate into a 409).
--   * itemCode has unique: true, sparse: true in Mongo — sparse means the
--     constraint only applies to documents where itemCode is present, so NULL
--     rows (no itemCode) are exempt; a Postgres partial unique index on
--     non-null itemCode reproduces the sparse semantics exactly.

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- sparse unique: true in Mongo; partial index below reproduces the exact
  -- semantics (multiple NULL itemCodes are allowed).
  item_code TEXT,
  barcode TEXT,
  qr_code TEXT,
  type TEXT NOT NULL DEFAULT 'Consumable',
  unit TEXT NOT NULL DEFAULT 'Pack',
  -- Ten stock counters with Mongo min: 0 (above). Decimals allowed.
  available_stock NUMERIC NOT NULL DEFAULT 0,
  reserved_stock NUMERIC NOT NULL DEFAULT 0,
  issued_stock NUMERIC NOT NULL DEFAULT 0,
  consumed_stock NUMERIC NOT NULL DEFAULT 0,
  damaged_stock NUMERIC NOT NULL DEFAULT 0,
  expired_stock NUMERIC NOT NULL DEFAULT 0,
  returned_stock NUMERIC NOT NULL DEFAULT 0,
  minimum_stock NUMERIC NOT NULL DEFAULT 0,
  reorder_level NUMERIC NOT NULL DEFAULT 0,
  maximum_stock NUMERIC NOT NULL DEFAULT 0,
  batch_required BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_required BOOLEAN NOT NULL DEFAULT FALSE,
  -- No min in Mongo ({ type: Number, default: 0 }); negatives allowed.
  shelf_life_days NUMERIC NOT NULL DEFAULT 0,
  -- Monetary values: Number, default 0 in Mongo — no min (negatives allowed,
  -- matching Mongo). NUMERIC preserves sub-unit scale exactly.
  purchase_price NUMERIC NOT NULL DEFAULT 0,
  selling_price NUMERIC NOT NULL DEFAULT 0,
  gst_rate NUMERIC NOT NULL DEFAULT 0,
  -- Mongo ObjectId refs to InventorySupplier / AccountHead; plain indexed TEXT
  -- (their targets are not cut over to PostgreSQL yet).
  preferred_supplier TEXT,
  expense_head TEXT,
  income_head TEXT,
  inventory_account TEXT,
  category TEXT NOT NULL DEFAULT 'Miscellaneous Items',
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Mongoose Date (instant), optional in the Mongo schema.
  expiry_date TIMESTAMPTZ,
  last_purchase_date TIMESTAMPTZ,
  last_purchase_price NUMERIC NOT NULL DEFAULT 0,
  last_supplier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_type_check CHECK (type IN ('Raw Material', 'Finished Good', 'Asset', 'Consumable', 'Other')),
  CONSTRAINT inventory_items_unit_check CHECK (unit IN ('Piece (Pc)', 'Number (Nos)', 'Unit', 'Pair', 'Set', 'Bundle', 'Packet', 'Pack', 'Box', 'Carton', 'Roll', 'Dozen', 'Tray', 'Sack', 'Bag', 'Pieces', 'Gram (g)', 'Kilogram (kg)', 'Kg', 'Quintal', 'Ton', 'Millilitre (ml)', 'Litre (L)', 'Liter', 'Can', 'Drum', 'Barrel', 'Bottle', 'Jar', 'Tin', 'Container', 'Bucket', 'Cylinder', 'Meter', 'Feet', 'Square Feet', 'Square Meter')),
  CONSTRAINT inventory_items_category_check CHECK (category IN ('Pooja Items', 'Prasadam Ingredients', 'Cleaning Materials', 'Office & Stationery', 'Electrical & Maintenance', 'Festival Materials', 'Miscellaneous Items', 'Cooking / Annaprasada')),
  -- Ten stock counters mirror the Mongo min: 0 (available_stock through
  -- maximum_stock). shelf_life_days is intentionally NOT constrained: the Mongo
  -- schema has no min on it, and neither do the price fields below.
  CONSTRAINT inventory_items_available_stock_check CHECK (available_stock >= 0),
  CONSTRAINT inventory_items_reserved_stock_check CHECK (reserved_stock >= 0),
  CONSTRAINT inventory_items_issued_stock_check CHECK (issued_stock >= 0),
  CONSTRAINT inventory_items_consumed_stock_check CHECK (consumed_stock >= 0),
  CONSTRAINT inventory_items_damaged_stock_check CHECK (damaged_stock >= 0),
  CONSTRAINT inventory_items_expired_stock_check CHECK (expired_stock >= 0),
  CONSTRAINT inventory_items_returned_stock_check CHECK (returned_stock >= 0),
  CONSTRAINT inventory_items_minimum_stock_check CHECK (minimum_stock >= 0),
  CONSTRAINT inventory_items_reorder_level_check CHECK (reorder_level >= 0),
  CONSTRAINT inventory_items_maximum_stock_check CHECK (maximum_stock >= 0),
  -- Mirrors the Mongo schema's { name: 1, category: 1 } unique index.
  CONSTRAINT inventory_items_name_category_key UNIQUE (name, category)
);

-- The Mongo schema declares itemCode unique: true, sparse: true. The partial
-- unique index only constrains non-NULL itemCodes, exactly like Mongo's sparse
-- index.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_item_code_key ON inventory_items (item_code) WHERE item_code IS NOT NULL;

-- Correctness fix: the initial 009 applied >= 0 CHECKs to shelf_life_days and
-- the four price fields even though the Mongo schema declares no min on them.
-- Drop those constraints now (idempotently) so PostgreSQL is not stricter than
-- Mongo. The ten stock-counter CHECKs (matching Mongo min: 0) stay in place.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_shelf_life_days_check') THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_shelf_life_days_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_purchase_price_check') THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_purchase_price_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_selling_price_check') THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_selling_price_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_gst_rate_check') THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_gst_rate_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_last_purchase_price_check') THEN
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_last_purchase_price_check;
  END IF;
END $$;

-- Inventory lists sort by name ASC ({ name: 1 }) in getAllInventoryItems and
-- getInventoryCatalog.
CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items (name);
-- issues/consumptions/damages read items by ObjectId ref.
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category);
-- issueInventoryRequest matches an item by exact name (case-insensitive) when
-- an approved request is issued.
CREATE INDEX IF NOT EXISTS idx_inventory_items_name_lower ON inventory_items (lower(name));
-- dashboard metric scans stream over all items; the created_at/updated_at
-- indexes keep sorted reads and admin listings incremental.
CREATE INDEX IF NOT EXISTS idx_inventory_items_created_at ON inventory_items (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_items_updated_at ON inventory_items (updated_at DESC);
-- AccountTransaction.referenceId lookups for InventoryItem (inventoryReport
-- getItemDetails financialTransactions $or) resolve by id; the PK covers them.