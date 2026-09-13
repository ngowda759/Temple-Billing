-- Phase 2M: purchase_orders + purchase_order_items (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/PurchaseOrder.js and its real usages across the
-- application:
--   * PurchaseOrder.js — the Mongoose model: poNumber (String, required,
--     unique, trim), supplier (ObjectId ref 'InventorySupplier', required),
--     items[] (embedded array of { item: ObjectId ref 'InventoryItem'
--     required, orderedQuantity: Number required min 1, unitPrice: Number
--     required min 0, totalPrice: Number required min 0, receivedQuantity:
--     Number default 0 min 0 }), totalAmount (Number required min 0),
--     status (enum with 8 values, default 'Draft'), expectedDeliveryDate
--     (Date, optional), notes (String, optional), createdBy (ObjectId ref
--     'Employee', optional), approvedBy (ObjectId ref 'Employee', optional),
--     timestamps.
--   * inventoryWorkflowController.createGRN — the only real consumer of a
--     Purchase Order today: it loads
--     PurchaseOrder.findById(purchaseOrderId) when a GRN is created against
--     a PO and flips po.status = 'Partially Received' (a simplified,
--     approximated transition that does not recompute quantities). No route
--     is currently wired to a PurchaseOrder create/list/update endpoint, so
--     the MongoDB model is effectively the write path and the status
--     transitions are exercised only by the GRN flow above.
--   * GoodsReceivedNote.purchaseOrder — an ObjectId ref to PurchaseOrder
--     stored in the GRN model (still Mongo-backed; not migrated here).
--   * AccountTransaction.reference_model — the polymorphic enum already
--     includes 'PurchaseOrder'; no transaction is currently written with
--     referenceModel 'PurchaseOrder' (GRN approvals use 'GoodsReceivedNote').
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the purchaseOrderRepository, reachable through the
-- purchaseOrderService) that is selected only when the service is explicitly
-- used AND PostgreSQL is reachable. MongoDB stays the source of truth and the
-- fallback path; no Mongo → PostgreSQL switch happens anywhere in the
-- application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing PurchaseOrder model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id                 → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * poNumber            → po_number TEXT NOT NULL, UNIQUE (unique: true in
--                           Mongo; the sole uniqueness semantic on the model)
--   * supplier            → supplier TEXT NOT NULL (ObjectId ref to
--                           InventorySupplier — that entity is still
--                           Mongo-backed, so plain TEXT, NO FK)
--   * items[]             → normalized into purchase_order_items (see below)
--   * totalAmount         → total_amount NUMERIC NOT NULL (required, min: 0)
--   * status              → status TEXT NOT NULL DEFAULT 'Draft', CHECK over
--                           ['Draft','Pending Approval','Approved','Sent',
--                           'Partially Received','Received','Cancelled',
--                           'Closed'] (enum, default 'Draft')
--   * expectedDeliveryDate→ expected_delivery_date TIMESTAMPTZ (Date, optional)
--   * notes               → notes TEXT (optional)
--   * createdBy           → created_by TEXT (ObjectId ref 'Employee' —
--                           employees IS PostgreSQL-backed (Phase 2A) but
--                           MongoDB remains the source of truth and the
--                           employees PG table is populated by the users/
--                           employees migration independently of Mongo; the
--                           established convention for every Mongo-backed
--                           reference is plain indexed TEXT. The PO model
--                           makes createdBy an optional, unused reference —
--                           no query ever filters or populates it — so a real
--                           FK would be an invented constraint with no
--                           application use; plain TEXT, NO FK)
--   * approvedBy          → approved_by TEXT (ObjectId ref 'Employee' — same
--                           reasoning: unused optional reference, plain TEXT,
--                           NO FK)
--   * createdAt           → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt           → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Normalized purchase_order_items (every persisted embedded item field):
--   * _id                → id TEXT PRIMARY KEY (24-hex Mongo-compatible id;
--                          embedded sub-documents in Mongo get their own _id)
--   * items[].item       → inventory_item_id TEXT NOT NULL
--                          REFERENCES inventory_items(id) ON DELETE RESTRICT
--                          (ObjectId ref 'InventoryItem' required; the target
--                          table exists in PostgreSQL (Phase 2H) so a real FK
--                          is used. ON DELETE RESTRICT is the least
--                          behaviour-changing strategy, identical to Phases
--                          2I/2J/2K: Mongo leaves order items orphaned when an
--                          item is deleted, so PostgreSQL refuses the delete
--                          instead of cascading — never silently destroys data
--                          Mongo keeps)
--   * items[].orderedQuantity → ordered_quantity NUMERIC NOT NULL
--                          (required, min: 1 — the numeric type preserves
--                          fractional units exactly)
--   * items[].unitPrice   → unit_price NUMERIC NOT NULL (required, min: 0)
--   * items[].totalPrice  → total_price NUMERIC NOT NULL (required, min: 0)
--   * items[].receivedQuantity → received_quantity NUMERIC NOT NULL DEFAULT 0
--                          (default 0, min: 0)
--   * position            → INTEGER NOT NULL DEFAULT 0 — preserves the
--                          original array order of the Mongo items[] embedded
--                          documents (same convention as bill_items)
--   * createdAt/updatedAt → created_at / updated_at TIMESTAMPTZ NOT NULL
--                          DEFAULT now() (embedded sub-documents in Mongo get
--                          their own timestamps automatically when
--                          `timestamps: true` is set at the array level)
--
-- Intentionally omitted fields: none. Every persisted Mongo field from the
-- PurchaseOrder schema has an explicit column above, and every persisted
-- embedded item field has an explicit column on purchase_order_items. There
-- are no virtual-only fields to persist.
--
-- Foreign keys (documented per column; no fake FKs):
--   * purchase_order_items.inventory_item_id → inventory_items(id): real FK —
--     the Mongo schema declares item: { type: ObjectId, ref: 'InventoryItem',
--     required: true } and inventory_items exists in PG (Phase 2H). ON DELETE
--     RESTRICT (same reasoning as Phases 2I/2J/2K — Mongo keeps child rows
--     orphaned when an item is deleted; PG refuses the delete instead).
--   * purchase_order_items.purchase_order_id → purchase_orders(id): real FK,
--     the owning parent. ON DELETE CASCADE — the embedded items array in the
--     Mongo model is part of the PurchaseOrder document itself, so deleting a
--     PO must remove exactly what Mongo would remove with it (the same
--     lifecycle decision made for bills + bill_items in Phase 2C).
--   * purchase_orders.supplier → InventorySupplier: NO FK — suppliers stay
--     Mongo-backed (not migrated), so a FK would be fake. Plain TEXT exactly
--     like grn/supplier on inventory_batches and preferred_supplier on
--     inventory_items.
--   * purchase_orders.created_by / approved_by → employees: NO FK — optional
--     unused ObjectId refs; the convention for every Mongo-backed reference
--     in earlier phases is plain indexed TEXT (no real FK was ever added to
--     the employees table). The PG employees table is also not a cut-over
--     datasource (employees are still synchronised through Mongo-backed
--     users), so a real FK would arbitrarily constrain optional PO metadata
--     the application never writes or filters.
--
-- Monetary values use NUMERIC so unit prices / line totals / the order total
-- round-trip exactly. Quantities use NUMERIC (not integer): the Mongo schema
-- declares Number fields and existing inventory flows use fractional
-- quantities, so preserving scale matters. The min constraints mirror the
-- Mongo schema exactly:
--   * orderedQuantity min: 1 → CHECK (ordered_quantity >= 1)
--   * unitPrice min: 0      → CHECK (unit_price >= 0)
--   * totalPrice min: 0     → CHECK (total_price >= 0)
--   * receivedQuantity min: 0 → CHECK (received_quantity >= 0)
--   * totalAmount min: 0    → CHECK (total_amount >= 0)
-- Stored vs derived: totalAmount and items[].totalPrice are STORED fields in
-- the Mongo model (required, persisted), NOT calculated by PostgreSQL. The
-- model never computes line totals from quantity × unitPrice anywhere in the
-- codebase, so PostgreSQL does not introduce a new accounting rule — it
-- persists the exact values the application writes.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * status: ['Draft', 'Pending Approval', 'Approved', 'Sent',
--     'Partially Received', 'Received', 'Cancelled', 'Closed'] — default
--     'Draft'.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
-- Nullable columns (expected_delivery_date, notes, created_by, approved_by)
-- stay nullable with no default — they are unset until the application sets
-- them, exactly like the Mongo schema's optional fields.
--
-- Uniqueness semantics: the Mongo schema declares ONE unique index —
-- poNumber { unique: true }. That is preserved as a UNIQUE constraint on
-- po_number. No other unique index exists on the model, so none is invented.
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * idx_purchase_orders_status — status equals filters / list grouping
--   * idx_purchase_orders_expected_delivery_date — delivery-date ordering and
--     range scans characteristic of PO review lists
--   * idx_purchase_orders_created_at — default createdAt DESC list ordering
--     convention used by every other entity screen
--   * idx_purchase_order_items_purchase_order_id_position — child rows loaded
--     per order in the embedded array order
--   * idx_purchase_order_items_inventory_item_id — per-item PO history

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  -- Mongo: poNumber String — required, unique, trim.
  po_number TEXT NOT NULL,
  -- Mongo: supplier ObjectId ref 'InventorySupplier' — required. Plain TEXT:
  -- suppliers stay Mongo-backed, so no FK (see header).
  supplier TEXT NOT NULL,
  -- Mongo: Number, required, min: 0. NUMERIC + >= 0 CHECK mirror the schema.
  total_amount NUMERIC NOT NULL,
  -- Mongo: status enum, default 'Draft'.
  status TEXT NOT NULL DEFAULT 'Draft',
  -- Mongo: expectedDeliveryDate Date — optional.
  expected_delivery_date TIMESTAMPTZ,
  -- Mongo: notes String — optional.
  notes TEXT,
  -- Mongo: createdBy ObjectId ref 'Employee' — optional. Plain TEXT, no FK.
  created_by TEXT,
  -- Mongo: approvedBy ObjectId ref 'Employee' — optional. Plain TEXT, no FK.
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's poNumber unique: true.
  CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number),
  CONSTRAINT purchase_orders_status_check CHECK (status IN ('Draft', 'Pending Approval', 'Approved', 'Sent', 'Partially Received', 'Received', 'Cancelled', 'Closed')),
  CONSTRAINT purchase_orders_total_amount_check CHECK (total_amount >= 0)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  -- Mongo: items[].item ObjectId ref 'InventoryItem' — required. Real FK to
  -- the Phase 2H table. ON DELETE RESTRICT: Mongo keeps order items orphaned
  -- when an item is deleted, so PostgreSQL refuses the delete instead (see
  -- header).
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  -- Mongo: items[].orderedQuantity Number — required, min: 1 (decimals allowed).
  ordered_quantity NUMERIC NOT NULL,
  -- Mongo: items[].unitPrice Number — required, min: 0. NUMERIC preserves
  -- sub-unit scale exactly.
  unit_price NUMERIC NOT NULL,
  -- Mongo: items[].totalPrice Number — required, min: 0. STORED (never
  -- derived by PostgreSQL).
  total_price NUMERIC NOT NULL,
  -- Mongo: items[].receivedQuantity Number, default 0, min: 0.
  received_quantity NUMERIC NOT NULL DEFAULT 0,
  -- Preserves the original array order of the Mongo items[] embedded docs.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The embedded items array is part of the PurchaseOrder document in Mongo,
  -- so deleting a PO removes its item rows with it (Phase 2C bill_items
  -- lifecycle — the same embedded-array semantics).
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_items_ordered_quantity_check CHECK (ordered_quantity >= 1),
  CONSTRAINT purchase_order_items_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT purchase_order_items_total_price_check CHECK (total_price >= 0),
  CONSTRAINT purchase_order_items_received_quantity_check CHECK (received_quantity >= 0)
);

-- Status equals filters / list grouping (PO review screens and the createGRN
-- 'Partially Received' transition) — status is the primary PO list axis.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status);

-- Purchase-order review lists sort by delivery date to surface incoming
-- deliveries; expected-delivery range scans are the PO dashboard's core query.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_delivery_date ON purchase_orders (expected_delivery_date);

-- Default createdAt DESC ordering convention shared by every entity list
-- (bills, donations, prasadam orders, inventory batches, consumption, …).
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders (created_at DESC);

-- Child rows are always loaded per order in the embedded array order.
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id_position ON purchase_order_items (purchase_order_id, position);

-- Per-item purchase history (items joined by inventory_item_id) mirrors the
-- per-item query axis used by every other inventory child table.
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_inventory_item_id ON purchase_order_items (inventory_item_id);