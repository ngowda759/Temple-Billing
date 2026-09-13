-- Phase 2J: inventory_logs (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/InventoryLog.js and its real usages across the
-- application:
--   * inventoryHelper.deductStock / addStock create a log on every stock
--     movement ({ item, action, quantity, oldStock, newStock, user,
--     description }) — used by inventoryWorkflowController.approveGRN,
--     logKitchenProduction, approveDamageNote and prasadam flows.
--   * inventoryItemController.createInventoryItem / restockItem / adjustStock
--     create logs ({ item, action, quantity, oldStock, newStock, user,
--     description }) on initial stock, restock and Damaged/Expired/Lost/
--     Returned adjustments.
--   * inventoryItemController.getInventoryLogs lists the latest 100 logs:
--     InventoryLog.find().sort({ date: -1 }).limit(100).populate("item",
--     "name").populate("user", "name role").
--   * inventoryReportController.getDashboardMetrics counts today's consumed
--     logs: InventoryLog.find({ date: { $gte: today }, action: "Consumed" }).
--   * inventoryReportController.getInventoryReports lists date-range logs:
--     InventoryLog.find({ date: { $gte: startDate } }).populate("item",
--     "name category").populate("user", "name role").
--   * inventoryReportController.getItemDetails lists an item's stock movement:
--     InventoryLog.find({ item: id }).sort({ date: -1 }).populate("user",
--     "name role").
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the inventoryLogRepository, reachable through the
-- inventoryLogService) that is selected only when the service is explicitly
-- used AND PostgreSQL is reachable. MongoDB stays the source of truth and the
-- fallback path; no Mongo → PostgreSQL switch happens anywhere in the
-- application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing InventoryLog model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id            → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * item           → inventory_item_id TEXT NOT NULL
--                      REFERENCES inventory_items(id) ON DELETE RESTRICT
--   * action         → action TEXT NOT NULL, CHECK over the 10-value enum
--   * quantity       → quantity NUMERIC NOT NULL (required, NO min in Mongo —
--                      zero and negatives are legal)
--   * oldStock       → old_stock NUMERIC NOT NULL DEFAULT 0 (default 0, no min)
--   * newStock       → new_stock NUMERIC NOT NULL DEFAULT 0 (default 0, no min)
--   * user           → user_id TEXT (optional ref to User)
--   * date           → date TIMESTAMPTZ NOT NULL DEFAULT now()
--   * createdAt      → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt      → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted fields:
--   * description — passed by every real write path (inventoryHelper,
--     inventoryItemController) but NOT declared in the Mongo schema.
--     Mongoose strict mode strips it, so it is never persisted in MongoDB.
--     Mapping it to PostgreSQL would make PostgreSQL MORE permissive than the
--     real Mongo model, so it is deliberately not added. The repository still
--     accepts a caller-supplied description and drops it, exactly like Mongo.
--
-- Foreign keys:
--   * inventory_item_id → inventory_items(id): the Mongo schema declares
--     item: { type: ObjectId, ref: 'InventoryItem', required: true }. The
--     inventory_items table exists in PostgreSQL (Phase 2H) and Phase 2I made
--     the identical choice for inventory_batches, so a real FK is used.
--     ON DELETE RESTRICT is the least behaviour-changing strategy:
--       * Mongo's deleteInventoryItem calls InventoryItem.findByIdAndDelete(id)
--         with no log cleanup, so logs REMAIN after an item is deleted
--         (silently orphaned). PostgreSQL must NOT cascade-delete those logs —
--         a cascade would destroy data Mongo keeps.
--       * A real FK cannot orphan rows, so deleting an item that still has
--         logs is refused by the FK (a clear error instructing the caller to
--         remove the logs first). This is strictly safer than the current
--         Mongo behaviour: it never silently destroys log data and never
--         leaves PostgreSQL in a state Mongo would not be in.
--   * user → User is NOT given an FK. users exists in PostgreSQL (Phase 2A)
--     but MongoDB remains its source of truth and user rows are routinely
--     absent from the PostgreSQL users table (registration/login still go
--     through Mongoose). A real FK would reject legitimate logs whose Mongo
--     user id is not present in the PG users table — a hard break of the
--     intended application semantics. Plain indexed TEXT exactly matches the
--     convention applied to every user/employee reference in Phases 2A–2I
--     (account_transactions.recorded_by, pooja_bookings.created_by, …).
--
-- Monetary values: none — InventoryLog is a pure stock-movement ledger (no
-- prices or amounts), so no NUMERIC money column is needed.
--
-- Quantities use NUMERIC (not integer): the Mongo schema declares quantity /
-- oldStock / newStock as loose Numbers with NO min and the real flows use
-- fractional quantities (deductStock/requiredQty are fractional kitchen
-- quantities). No >= 0 CHECK is added — Mongo permits zero and negative values,
-- so PostgreSQL must too. NUMERIC preserves the exact scale (10.50 stays
-- 10.50, not 10.5) and round-trips 0, 0.01, 1000.125, 123456.789 exactly.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * action: ['Added', 'Updated', 'Consumed', 'Restocked', 'Issue',
--     'Damage', 'Expire', 'Return', 'Lost', 'Adjusted'] — required.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
--
-- Embedded/nested data: the MongoDB InventoryLog schema has no embedded arrays
-- or objects (only a flat set of scalar fields plus ObjectId refs), so
-- nothing needs to be normalized and no JSONB column is required.
--
-- Uniqueness semantics: the Mongo schema declares no unique indexes on
-- InventoryLog, so none are created (multiple logs per item/action are the
-- stock-movement history, not constraints).

CREATE TABLE IF NOT EXISTS inventory_logs (
  id TEXT PRIMARY KEY,
  -- Mongo: item ObjectId ref 'InventoryItem' — required. Real FK to the
  -- Phase 2H table. ON DELETE RESTRICT: Mongo keeps logs orphaned when an
  -- item is deleted, so PostgreSQL refuses the delete instead (see header).
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  -- Mongo: Number, default 0, NO min — negatives allowed exactly like Mongo.
  old_stock NUMERIC NOT NULL DEFAULT 0,
  new_stock NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: user ObjectId ref 'User' — optional. users is still Mongo-backed
  -- as the source of truth, so this is plain indexed TEXT, no FK.
  user_id TEXT,
  -- Mongo: Date, default Date.now.
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_logs_action_check CHECK (action IN ('Added', 'Updated', 'Consumed', 'Restocked', 'Issue', 'Damage', 'Expire', 'Return', 'Lost', 'Adjusted'))
);

-- getItemDetails stock movement (inventoryReportController):
--   InventoryLog.find({ item: id }).sort({ date: -1 })
-- The leading item equality plus date DESC ordering make this a covering index
-- for the per-item movement scan.
CREATE INDEX IF NOT EXISTS idx_inventory_logs_item_date ON inventory_logs (inventory_item_id, date DESC);

-- Dashboard consumption count (inventoryReportController.getDashboardMetrics):
--   InventoryLog.find({ date: { $gte: today }, action: 'Consumed' })
-- Equality on action + range on date → (action, date) leading column order.
CREATE INDEX IF NOT EXISTS idx_inventory_logs_action_date ON inventory_logs (action, date);

-- Latest-logs list and report ranges:
--   InventoryLog.find().sort({ date: -1 }).limit(100)          (getInventoryLogs)
--   InventoryLog.find({ date: { $gte: startDate } })           (getInventoryReports)
CREATE INDEX IF NOT EXISTS idx_inventory_logs_date ON inventory_logs (date DESC);