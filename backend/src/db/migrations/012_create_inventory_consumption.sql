-- Phase 2K: inventory_consumptions (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/InventoryConsumption.js and its real usages
-- across the application:
--   * inventoryIssueController.completeUsage creates one consumption record
--     when an inventory issue is completed:
--     InventoryConsumption.create({ issue: issue._id, item: item._id,
--     itemName: item.name, userId: issue.userId, userName: issue.userName,
--     role: issue.role, issuedQuantity: issue.issuedQuantity,
--     usedQuantity: parsedUsed, returnedQuantity: parsedReturned,
--     unit: issue.unit, purpose: issue.purpose, remarks: ... }).
--   * inventoryIssueController.getConsumptionReports lists the latest 100
--     consumptions sorted by date descending:
--     InventoryConsumption.find().sort({ date: -1 }).limit(100). The admin
--     frontend (InventoryManagement.jsx "Consumption Tracking" tab) renders
--     _id / createdAt / userName / itemName / usedQuantity / unit / remarks.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the inventoryConsumptionRepository, reachable through the
-- inventoryConsumptionService) that is selected only when the service is
-- explicitly used AND PostgreSQL is reachable. MongoDB stays the source of
-- truth and the fallback path; no Mongo → PostgreSQL switch happens anywhere
-- in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing InventoryConsumption model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id              → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * issue            → issue_id TEXT (optional ref to InventoryIssue — the
--                        InventoryIssue entity remains Mongo-backed, so plain
--                        TEXT, NO FK — see the header below)
--   * item             → inventory_item_id TEXT NOT NULL
--                        REFERENCES inventory_items(id) ON DELETE RESTRICT
--   * itemName         → item_name TEXT NOT NULL
--   * userId           → user_id TEXT NOT NULL (Mongo schema: String, NOT the
--                        User ObjectId ref; the real write path stores the
--                        issuing user's USERNAME in this field)
--   * userName         → user_name TEXT NOT NULL
--   * role             → role TEXT NOT NULL
--   * issuedQuantity   → issued_quantity NUMERIC NOT NULL (required, min: 0)
--   * usedQuantity     → used_quantity NUMERIC NOT NULL (required, min: 0)
--   * returnedQuantity → returned_quantity NUMERIC NOT NULL (required, min: 0)
--   * unit             → unit TEXT NOT NULL
--   * purpose          → purpose TEXT NOT NULL DEFAULT '' (default '')
--   * remarks          → remarks TEXT NOT NULL DEFAULT '' (default '')
--   * date             → date TIMESTAMPTZ NOT NULL DEFAULT now()
--   * createdAt        → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt        → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted fields: none. Every persisted Mongo field from the
-- InventoryConsumption schema has an explicit column above.
--
-- Foreign keys:
--   * inventory_item_id → inventory_items(id): the Mongo schema declares
--     item: { type: ObjectId, ref: 'InventoryItem', required: true } and the
--     only real write path (completeUsage) loads the item by id and stores its
--     _id, so the FK target is a real item in practice. inventory_items exists
--     in PostgreSQL (Phase 2H) and Phases 2I/2J made the identical choice, so
--     a real FK is used. ON DELETE RESTRICT is the least
--     behaviour-changing strategy:
--       * Mongo's deleteInventoryItem calls InventoryItem.findByIdAndDelete(id)
--         with no consumption cleanup, so consumptions REMAIN after an item is
--         deleted (silently orphaned). PostgreSQL must NOT cascade-delete
--         them — a cascade would destroy data Mongo keeps.
--       * A real FK cannot orphan rows, so deleting an item that still has
--         consumption records is refused by the FK (a clear error instructing
--         the caller to remove the consumptions first). Strictly safer than
--         the current Mongo behaviour, identical to Phases 2I/2J.
--   * issue_id → InventoryIssue gets NO FK: the InventoryIssue entity is not
--     migrated in this phase (only Inventory Consumption is Phase 2K scope),
--     so creating a FK to a non-existent postgres table would be a fake FK.
--     Plain indexed TEXT matches the convention applied to every Mongo-backed
--     reference in Phases 2A–2J (grn/store on inventory_batches, preferred
--     supplier fields on inventory_items, polymorphic reference_id columns).
--   * userId → User gets NO FK: the Mongo schema declares it a STRING (not an
--     ObjectId ref), and the real write path (completeUsage) stores the
--     issuing user's USERNAME. The users table (Phase 2A) is also still
--     Mongo-backed as the source of truth, so user rows are routinely absent
--     from PG. Plain TEXT, no FK — same convention as every user reference.
--
-- Monetary values: none — InventoryConsumption is a pure quantity record (no
-- prices or amounts), so no NUMERIC money column is needed.
--
-- Quantities use NUMERIC (not integer): the Mongo schema declares
-- issuedQuantity/usedQuantity/returnedQuantity as Number, required, min: 0,
-- and the real flows use fractional kitchen quantities (completeUsage parses
-- parseFloat values). NUMERIC with a >= 0 CHECK mirror the Mongo schema's
-- min: 0 exactly: zero is legal (an issue can be completed with everything
-- returned), negatives are refused, and decimal scale is preserved (10.50
-- stays 10.50, 1000.125 stays 1000.125).
--
-- Enums: none — the InventoryConsumption schema declares no enum fields
-- (role/unit/purpose are free-form strings).
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
--
-- Embedded/nested data: the MongoDB InventoryConsumption schema has no
-- embedded arrays or objects (only a flat set of scalar fields plus ObjectId
-- refs), so nothing needs to be normalized and no JSONB column is required.
--
-- Uniqueness semantics: the Mongo schema declares no unique indexes on
-- InventoryConsumption, so none are created. The userId (String) index in the
-- Mongo schema is NOT unique — it is an ordinary index.

CREATE TABLE IF NOT EXISTS inventory_consumptions (
  id TEXT PRIMARY KEY,
  -- Mongo: issue ObjectId ref 'InventoryIssue' — optional. InventoryIssue is
  -- still Mongo-backed (not migrated in this phase), so plain TEXT, no FK.
  issue_id TEXT,
  -- Mongo: item ObjectId ref 'InventoryItem' — required. Real FK to the
  -- Phase 2H table. ON DELETE RESTRICT: Mongo keeps consumptions orphaned
  -- when an item is deleted, so PostgreSQL refuses the delete instead (see
  -- header).
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  -- Mongo: itemName String — required.
  item_name TEXT NOT NULL,
  -- Mongo: userId String — required. Plain TEXT: in the real write path
  -- (completeUsage) this stores the issuing user's USERNAME, and users stays
  -- Mongo-backed, so no FK.
  user_id TEXT NOT NULL,
  -- Mongo: userName String — required.
  user_name TEXT NOT NULL,
  -- Mongo: role String — required (free-form, not an enum).
  role TEXT NOT NULL,
  -- Mongo: Number, required, min: 0. NUMERIC + >= 0 CHECK mirror the schema.
  issued_quantity NUMERIC NOT NULL,
  used_quantity NUMERIC NOT NULL,
  returned_quantity NUMERIC NOT NULL,
  -- Mongo: unit String — required (imported from the InventoryIssue at write
  -- time; no CHECK in the Mongo schema).
  unit TEXT NOT NULL,
  -- Mongo: purpose String, default ''.
  purpose TEXT NOT NULL DEFAULT '',
  -- Mongo: remarks String, default ''.
  remarks TEXT NOT NULL DEFAULT '',
  -- Mongo: Date, default Date.now.
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_consumptions_issued_quantity_check CHECK (issued_quantity >= 0),
  CONSTRAINT inventory_consumptions_used_quantity_check CHECK (used_quantity >= 0),
  CONSTRAINT inventory_consumptions_returned_quantity_check CHECK (returned_quantity >= 0)
);

-- Admin "Consumption Tracking" report and the getConsumptionReports query:
--   InventoryConsumption.find().sort({ date: -1 }).limit(100)
-- The leading date DESC ordering makes this a covering index for the latest-100 scan.
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_date ON inventory_consumptions (date DESC);

-- The Mongo schema declares userId: { ..., index: true } (an ordinary,
-- non-unique index) and the staff frontend lists issues/consumptions by
-- userId on the inventory-issues screens.
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_user_id ON inventory_consumptions (user_id);

-- Mongo: item ObjectId ref 'InventoryItem'. Per-item consumption inspection
-- (and the common item + date DESC report pattern).
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_item_date ON inventory_consumptions (inventory_item_id, date DESC);