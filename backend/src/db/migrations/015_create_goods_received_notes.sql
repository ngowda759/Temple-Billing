-- Phase 2N: goods_received_notes + goods_received_note_items (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/GoodsReceivedNote.js and its real usages across
-- the application:
--   * GoodsReceivedNote.js — the Mongoose model: grnNumber (String, required,
--     unique, trim), purchaseOrder (ObjectId ref 'PurchaseOrder', optional),
--     supplier (ObjectId ref 'InventorySupplier', required), supplierInvoice
--     Number (String, optional), supplierInvoiceDate (Date, optional),
--     receivedItems[] (embedded array of { item: ObjectId ref
--     'InventoryItem' required, poQuantity: Number default 0, received
--     Quantity: Number required min 0, acceptedQuantity: Number required
--     min 0, rejectedQuantity: Number default 0 min 0, unitPrice: Number
--     required min 0, batchNumber: String optional, expiryDate: Date
--     optional, remarks: String optional }), totalAmount (Number required
--     min 0), status (enum with 5 values, default 'Draft'), receivedBy
--     (ObjectId ref 'Employee', optional), approvedBy (ObjectId ref
--     'Employee', optional), notes (String, optional), timestamps.
--   * inventoryWorkflowController.createGRN — POST /api/admin/grn: constructs
--     a GoodsReceivedNote with grnNumber = `GRN-${count + 1}` padded to 5,
--     receivedBy: req.user._id, status: 'Pending Approval', saving the PO /
--     supplier / supplierInvoice* / receivedItems / totalAmount / notes from
--     the body. When purchaseOrderId is given it loads
--     PurchaseOrder.findById(purchaseOrderId) and flips po.status to
--     'Partially Received' (a simplified, approximated transition that does
--     not recompute quantities). Returns the raw saved document.
--   * inventoryWorkflowController.approveGRN — POST /api/admin/grn/:id/
--     approve: loads GoodsReceivedNote.findById(id).populate
--     ("receivedItems.item"); refuses when the GRN is already 'Approved';
--     flips status to 'Approved', sets approvedBy: req.user._id, then per
--     receivedItems line: addStock(item, acceptedQuantity, 'GRN Approved', …
--     ) (which updates InventoryItem.availableStock and writes an
--     InventoryLog), sets item.lastPurchasePrice/lastPurchaseDate, and when
--     item.batchRequired or line.batchNumber is set creates an
--     InventoryBatch ({ item, batchNumber: line.batchNumber ||
--     `AUTO-${Date.now()}`, grn: grn._id, purchasePrice: line.unitPrice,
--     expiryDate: line.expiryDate, originalQuantity: line.acceptedQuantity,
--     currentQuantity: line.acceptedQuantity, supplier: grn.supplier });
--     finally it saves the GRN and records an AccountTransaction
--     (transactionType: 'Debit', source: 'Inventory', category: 'Inventory
--     Purchase', amount: grn.totalAmount, paymentMethod: 'System',
--     referenceModel: 'GoodsReceivedNote', referenceId: grn._id).
--   * InventoryBatch.grn — ObjectId ref to a GoodsReceivedNote (Phase 2I
--     stores it as plain indexed TEXT; the GRN remains Mongo-backed there).
--
-- No controller-level route is wired to GoodsReceivedNote today beyond the
-- two inventoryWorkflowController helpers above; the frontend StoreDashboard
-- has a placeholder "Receive Goods (GRN Entry)" block. The model is still the
-- source of truth and the fallback path.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the goodsReceivedNoteRepository, reachable through the
-- goodsReceivedNoteService) that is selected only when the service is
-- explicitly used AND PostgreSQL is reachable. MongoDB stays the source of
-- truth and the fallback path; no Mongo → PostgreSQL switch happens anywhere
-- in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing GoodsReceivedNote model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id                  → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * grnNumber            → grn_number TEXT NOT NULL, UNIQUE (unique: true
--                            in Mongo; the sole uniqueness semantic on the
--                            model)
--   * purchaseOrder        → purchase_order_id TEXT (ObjectId ref to
--                            'PurchaseOrder'; purchase_orders IS
--                            PostgreSQL-backed (Phase 2M) so a real FK is
--                            used — the GRN references a PO only in the
--                            createGRN flow, which loads po.findById and
--                            flips status: the reference genuinely exists).
--                            ON DELETE behaviour: see header — RESTRICT is
--                            chosen because Mongo never removes POs when a
--                            GRN is deleted (the embedded GRN document keeps
--                            the reference), so a CASCADE would silently
--                            destroy data Mongo keeps while a plain orphaned
--                            reference would be invisible to the batch/count
--                            semantics the app relies on.
--   * supplier             → supplier TEXT NOT NULL (ObjectId ref to
--                            'InventorySupplier' — that entity is still
--                            Mongo-backed, so plain TEXT, NO FK)
--   * supplierInvoiceNumber→ supplier_invoice_number TEXT (optional)
--   * supplierInvoiceDate  → supplier_invoice_date TIMESTAMPTZ (Date,
--                            optional)
--   * receivedItems[]      → normalized into goods_received_note_items (see
--                            below)
--   * totalAmount          → total_amount NUMERIC NOT NULL (required, min: 0)
--   * status               → status TEXT NOT NULL DEFAULT 'Draft', CHECK over
--                            ['Draft','Pending Quality Check','Pending
--                            Approval','Approved','Rejected'] (enum, default
--                            'Draft')
--   * receivedBy           → received_by TEXT (ObjectId ref 'Employee' —
--                            unused optional reference, plain TEXT, NO FK;
--                            see header reasoning)
--   * approvedBy           → approved_by TEXT (ObjectId ref 'Employee' —
--                            unused optional reference, plain TEXT, NO FK;
--                            same reasoning)
--   * notes                → notes TEXT (optional)
--   * createdAt            → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt            → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Normalized goods_received_note_items (every persisted embedded item field):
--   * _id                → id TEXT PRIMARY KEY (24-hex Mongo-compatible id;
--                          embedded sub-documents in Mongo get their own _id)
--   * receivedItems[].item → inventory_item_id TEXT NOT NULL
--                          REFERENCES inventory_items(id) ON DELETE RESTRICT
--                          (ObjectId ref 'InventoryItem' required; the target
--                          table exists in PostgreSQL (Phase 2H) so a real FK
--                          is used. ON DELETE RESTRICT is the least
--                          behaviour-changing strategy, identical to Phases
--                          2I/2J/2K/2M: Mongo leaves GRN lines orphaned when
--                          an item is deleted, so PostgreSQL refuses the
--                          delete instead of cascading — never silently
--                          destroys data Mongo keeps)
--   * receivedItems[].poQuantity → po_quantity NUMERIC NOT NULL DEFAULT 0
--                          (default 0, NO min in Mongo — negatives allowed
--                          exactly like the schema)
--   * receivedItems[].receivedQuantity → received_quantity NUMERIC NOT NULL
--                          (required, min: 0)
--   * receivedItems[].acceptedQuantity → accepted_quantity NUMERIC NOT NULL
--                          (required, min: 0)
--   * receivedItems[].rejectedQuantity → rejected_quantity NUMERIC NOT NULL
--                          DEFAULT 0 (default 0, min: 0)
--   * receivedItems[].unitPrice → unit_price NUMERIC NOT NULL (required,
--                          min: 0)
--   * receivedItems[].batchNumber → batch_number TEXT (optional)
--   * receivedItems[].expiryDate → expiry_date TIMESTAMPTZ (Date, optional)
--   * receivedItems[].remarks → remarks TEXT (optional)
--   * position            → INTEGER NOT NULL DEFAULT 0 — preserves the
--                          original array order of the Mongo receivedItems[]
--                          embedded documents (same convention as bill_items /
--                          purchase_order_items)
--   * createdAt/updatedAt → created_at / updated_at TIMESTAMPTZ NOT NULL
--                          DEFAULT now() (embedded sub-documents in Mongo get
--                          their own timestamps automatically when
--                          `timestamps: true` is set at the array level)
--
-- Intentionally omitted fields: none. Every persisted Mongo field from the
-- GoodsReceivedNote schema has an explicit column above, and every persisted
-- embedded item field has an explicit column on goods_received_note_items.
-- There are no virtual-only fields to persist (the createGRN grnNumber
-- computation is derived at write time from countDocuments and stored — the
-- repo mirrors that by defaulting grnNumber exactly like the service does).
--
-- Foreign keys (documented per column; no fake FKs):
--   * goods_received_note_items.inventory_item_id → inventory_items(id): real
--     FK — the Mongo schema declares item: { type: ObjectId, ref:
--     'InventoryItem', required: true } and inventory_items exists in PG
--     (Phase 2H). ON DELETE RESTRICT (same reasoning as Phases 2I/2J/2K/2M —
--     Mongo keeps child rows orphaned when an item is deleted; PG refuses the
--     delete instead).
--   * goods_received_note_items.grn_id → goods_received_notes(id): real FK,
--     the owning parent. ON DELETE CASCADE — the embedded receivedItems array
--     in the Mongo model is part of the GRN document itself, so deleting a
--     GRN must remove exactly what Mongo would remove with it (the same
--     lifecycle decision made for bills + bill_items / purchase_orders +
--     purchase_order_items).
--   * goods_received_notes.purchase_order_id → purchase_orders(id): real FK
--     (Phase 2M target). The purchaseOrder ref is an optional ObjectId in
--     Mongo and the only real consumer is createGRN (see header). ON DELETE
--     RESTRICT: deleting a PO must never silently destroy the GRN receipts
--     that reference it — Mongo keeps a GRN when its PO is deleted (the ref
--     merely dangles), so the least behaviour-changing strategy is to refuse
--     the PO delete; CASCADE would destroy GRN data Mongo keeps and SET NULL
--     would mutate a persisted reference Mongo would leave in place.
--   * goods_received_notes.supplier → InventorySupplier: NO FK — suppliers
--     stay Mongo-backed (not migrated), so a FK would be fake. Plain TEXT
--     exactly like grn/supplier on inventory_batches and supplier on
--     purchase_orders.
--   * goods_received_notes.received_by / approved_by → employees: NO FK —
--     optional unused ObjectId refs; the convention for every Mongo-backed
--     reference in earlier phases is plain indexed TEXT (no real FK was ever
--     added to the employees table). The PG employees table is also not a
--     cut-over datasource (employees are still synchronised through
--     Mongo-backed users), so a real FK would arbitrarily constrain optional
--     GRN metadata the application never writes or filters.
--
-- Monetary values use NUMERIC so unit prices and the receipt total round-trip
-- exactly. Quantities use NUMERIC (not integer): the Mongo schema declares
-- Number fields and existing inventory flows use fractional quantities
-- (addStock/deductStock are fractional), so preserving scale matters. The min
-- constraints mirror the Mongo schema exactly:
--   * receivedQuantity min: 0 → CHECK (received_quantity >= 0)
--   * acceptedQuantity min: 0 → CHECK (accepted_quantity >= 0)
--   * rejectedQuantity min: 0 → CHECK (rejected_quantity >= 0)
--   * unitPrice min: 0         → CHECK (unit_price >= 0)
--   * totalAmount min: 0       → CHECK (total_amount >= 0)
-- poQuantity has NO min in Mongo ({ type: Number, default: 0 } allows
-- negatives), so unlike the others it gets NO CHECK — exactly like the model.
--
-- Stored vs derived: totalAmount and receivedItems[].unitPrice are STORED
-- fields in the Mongo model (required, persisted), NOT calculated by
-- PostgreSQL. The model never computes line totals from quantity × unitPrice
-- anywhere in the codebase, so PostgreSQL does not introduce a new accounting
-- rule — it persists the exact values the application writes.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * status: ['Draft', 'Pending Quality Check', 'Pending Approval',
--     'Approved', 'Rejected'] — default 'Draft'.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
-- Nullable columns (purchase_order_id, supplier_invoice_number,
-- supplier_invoice_date, batch_number, expiry_date, remarks, received_by,
-- approved_by, notes) stay nullable with no default — they are unset until
-- the application sets them, exactly like the Mongo schema's optional fields.
--
-- Uniqueness semantics: the Mongo schema declares ONE unique index —
-- grnNumber { unique: true }. That is preserved as a UNIQUE constraint on
-- grn_number. No other unique index exists on the model, so none is invented.
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * idx_goods_received_notes_grn_number — unique-scanned by the number
--     lookups in findOne({ grnNumber })
--   * idx_goods_received_notes_status — status equals filters / list grouping
--     (the admin GRN review list is status-driven)
--   * idx_goods_received_notes_purchase_order_id — the createGRN PO status
--     flip and per-PO receipt history
--   * idx_goods_received_notes_created_at — default createdAt DESC list
--     ordering convention used by every other entity screen
--   * idx_goods_received_note_items_grn_id_position — child rows loaded per
--     GRN in the embedded array order
--   * idx_goods_received_note_items_inventory_item_id — per-item GRN history
--     (approveGRN iterates receivedItems by item)

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id TEXT PRIMARY KEY,
  -- Mongo: grnNumber String — required, unique, trim.
  grn_number TEXT NOT NULL,
  -- Mongo: purchaseOrder ObjectId ref 'PurchaseOrder' — optional. Real FK to
  -- the Phase 2M table; the createGRN flow genuinely writes it (see header).
  -- ON DELETE RESTRICT: never silently destroy GRN receipts when a PO is
  -- deleted (Mongo keeps the reference).
  purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  -- Mongo: supplier ObjectId ref 'InventorySupplier' — required. Plain TEXT:
  -- suppliers stay Mongo-backed, so no FK (see header).
  supplier TEXT NOT NULL,
  -- Mongo: supplierInvoiceNumber String — trim, optional.
  supplier_invoice_number TEXT,
  -- Mongo: supplierInvoiceDate Date — optional.
  supplier_invoice_date TIMESTAMPTZ,
  -- Mongo: Number, required, min: 0. NUMERIC + >= 0 CHECK mirror the schema.
  total_amount NUMERIC NOT NULL,
  -- Mongo: status enum, default 'Draft'.
  status TEXT NOT NULL DEFAULT 'Draft',
  -- Mongo: receivedBy ObjectId ref 'Employee' — optional. Plain TEXT, no FK.
  received_by TEXT,
  -- Mongo: approvedBy ObjectId ref 'Employee' — optional. Plain TEXT, no FK.
  approved_by TEXT,
  -- Mongo: notes String — optional.
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's grnNumber unique: true.
  CONSTRAINT goods_received_notes_grn_number_key UNIQUE (grn_number),
  CONSTRAINT goods_received_notes_status_check CHECK (status IN ('Draft', 'Pending Quality Check', 'Pending Approval', 'Approved', 'Rejected')),
  CONSTRAINT goods_received_notes_total_amount_check CHECK (total_amount >= 0)
);

CREATE TABLE IF NOT EXISTS goods_received_note_items (
  id TEXT PRIMARY KEY,
  grn_id TEXT NOT NULL,
  -- Mongo: receivedItems[].item ObjectId ref 'InventoryItem' — required. Real
  -- FK to the Phase 2H table. ON DELETE RESTRICT: Mongo keeps GRN lines
  -- orphaned when an item is deleted, so PostgreSQL refuses the delete
  -- instead (see header).
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  -- Mongo: receivedItems[].poQuantity Number, default 0, NO min — NUMERIC
  -- preserves fractional quantities exactly, and no CHECK (negatives allowed
  -- like Mongo).
  po_quantity NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: receivedItems[].receivedQuantity Number — required, min: 0.
  received_quantity NUMERIC NOT NULL,
  -- Mongo: receivedItems[].acceptedQuantity Number — required, min: 0.
  accepted_quantity NUMERIC NOT NULL,
  -- Mongo: receivedItems[].rejectedQuantity Number, default 0, min: 0.
  rejected_quantity NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: receivedItems[].unitPrice Number — required, min: 0. NUMERIC
  -- preserves sub-unit scale exactly.
  unit_price NUMERIC NOT NULL,
  -- Mongo: receivedItems[].batchNumber String — optional.
  batch_number TEXT,
  -- Mongo: receivedItems[].expiryDate Date — optional.
  expiry_date TIMESTAMPTZ,
  -- Mongo: receivedItems[].remarks String — optional.
  remarks TEXT,
  -- Preserves the original array order of the Mongo receivedItems[] docs.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The embedded receivedItems array is part of the GRN document in Mongo,
  -- so deleting a GRN removes its item rows with it (Phase 2C bill_items /
  -- Phase 2M purchase_order_items lifecycle — the same embedded-array
  -- semantics).
  FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  CONSTRAINT goods_received_note_items_received_quantity_check CHECK (received_quantity >= 0),
  CONSTRAINT goods_received_note_items_accepted_quantity_check CHECK (accepted_quantity >= 0),
  CONSTRAINT goods_received_note_items_rejected_quantity_check CHECK (rejected_quantity >= 0),
  CONSTRAINT goods_received_note_items_unit_price_check CHECK (unit_price >= 0)
);

-- scan of grnNumber lookups: findOne({ grnNumber }) resolves the unique
-- number without a seq scan.
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_grn_number ON goods_received_notes (grn_number);

-- Status equals filters / list grouping (admin GRN review lists are the
-- status-driven equivalent of the PO review screens).
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_status ON goods_received_notes (status);

-- The createGRN PO status flip and per-PO receipt history both resolve GRNs
-- by purchase_order_id.
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_purchase_order_id ON goods_received_notes (purchase_order_id);

-- Default createdAt DESC ordering convention shared by every entity list
-- (bills, donations, prasadam orders, inventory batches, purchase orders, …).
CREATE INDEX IF NOT EXISTS idx_goods_received_notes_created_at ON goods_received_notes (created_at DESC);

-- Child rows are always loaded per GRN in the embedded array order.
CREATE INDEX IF NOT EXISTS idx_goods_received_note_items_grn_id_position ON goods_received_note_items (grn_id, position);

-- Per-item receipt history (items joined by inventory_item_id) mirrors the
-- per-item query axis used by every other inventory child table.
CREATE INDEX IF NOT EXISTS idx_goods_received_note_items_inventory_item_id ON goods_received_note_items (inventory_item_id);