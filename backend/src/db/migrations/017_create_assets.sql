-- Phase 2P: assets + asset_maintenance_history (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/Asset.js and its real usages across the
-- application:
--   * Asset.js — the Mongoose model: assetId (String, required, unique),
--     name (String, required, trim), category (6-value enum, default
--     'Other'), qrCode (String, default ''), purchaseDate (Date, default
--     null), supplier (ObjectId ref 'Supplier', optional), invoiceNumber
--     (String, default ''), warranty (String, default '' — e.g. "1 Year" or
--     "Ends 2025", NOT a Date), assignedLocation (String, default 'Main
--     Temple'), status (3-value enum, default 'Active'), purchaseCost
--     (Number, default 0), serialNumber (String, default ''),
--     maintenanceHistory (embedded array of { repairDate: Date, description:
--     String, cost: Number, vendor: String }), timestamps.
--   * inventoryAssetController — getAllAssets (Asset.find().populate(
--     "supplier").sort({ name: 1 })), createAsset (Asset.create with
--     required assetId+name, category/purchaseDate/supplier/invoiceNumber/
--     warranty/assignedLocation/status/purchaseCost/serialNumber from body,
--     duplicate assetId → HTTP 409), updateAsset (Asset.findByIdAndUpdate(id,
--     req.body, { new: true })), deleteAsset (Asset.findByIdAndDelete).
--   * inventoryAssetController.completeRepair — pushes { repairDate,
--     description, cost, vendor } into asset.maintenanceHistory and saves the
--     asset document (the maintenance history is written from the completed
--     RepairRequest flow — this is the ONLY writer of maintenanceHistory).
--   * publicAssetController.getPublicAssetDetails — Asset.findOne({ assetId
--     }) with fallback Asset.findById(assetId) (24-hex), populates supplier,
--     then returns a project of id/assetId/name/category/purchaseDate/
--     assignedLocation/status/warranty/supplier.name ('N/A' when unset) and
--     the asset's RepairTicket maintenance history (NOT the embedded
--     maintenanceHistory array).
--   * app.js warranty-expiry cron — Asset.find({ warranty: { $exists: true,
--     $ne: null } }) then parses the warranty STRING as a Date.
--   * AdminAssetManagement / InventoryManagement / AssetScanResult — list
--     assets sorted by name, render assetId/name/category/status/
--     assignedLocation/purchaseDate/warranty/supplier/purchaseCost/
--     serialNumber.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the assetRepository, reachable through the assetService)
-- that is selected only when the service is explicitly used AND PostgreSQL is
-- reachable. MongoDB stays the source of truth and the fallback path; no
-- Mongo → PostgreSQL switch happens anywhere in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing Asset model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id              → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * assetId          → asset_id TEXT NOT NULL, UNIQUE (unique: true in
--                        Mongo; the sole uniqueness semantic on the model)
--   * name             → name TEXT NOT NULL (required; trim preserved by the
--                        repository)
--   * category         → category TEXT NOT NULL DEFAULT 'Other', CHECK over
--                        ['Electrical','Furniture','Electronics','Utensils',
--                        'Machinery','Other']
--   * qrCode           → qr_code TEXT NOT NULL DEFAULT '' (String default '')
--   * purchaseDate     → purchase_date TIMESTAMPTZ (Date, default null —
--                        nullable, unset until provided)
--   * supplier         → supplier TEXT (ObjectId ref 'Supplier' — suppliers
--                        stay Mongo-backed (no PostgreSQL table exists), so
--                        plain TEXT, NO FK — exactly like inventory
--                        items.preferred_supplier and purchase_orders.supplier
--                        in Phases 2H/2M)
--   * invoiceNumber    → invoice_number TEXT NOT NULL DEFAULT ''
--   * warranty         → warranty TEXT NOT NULL DEFAULT '' (String in Mongo —
--                        kept as TEXT even though app.js parses it as a Date;
--                        the model never stores a Date)
--   * assignedLocation → assigned_location TEXT NOT NULL DEFAULT 'Main
--                        Temple'
--   * status           → status TEXT NOT NULL DEFAULT 'Active', CHECK over
--                        ['Active','Under Repair','Retired']
--   * purchaseCost     → purchase_cost NUMERIC NOT NULL DEFAULT 0 (Number,
--                        default 0, NO min in Mongo — NUMERIC preserves
--                        monetary scale exactly)
--   * serialNumber     → serial_number TEXT NOT NULL DEFAULT ''
--   * maintenanceHistory[] → normalized into asset_maintenance_history
--                        (embedded array of sub-documents; see below)
--   * createdAt        → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt        → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Normalized asset_maintenance_history (every persisted embedded field):
--   * _id              → id TEXT PRIMARY KEY (24-hex Mongo-compatible id;
--                        embedded sub-documents in Mongo get their own _id)
--   * maintenanceHistory[].repairDate → repair_date TIMESTAMPTZ (Date,
--                        optional in the embedded sub-documents)
--   * maintenanceHistory[].description → description TEXT (optional String)
--   * maintenanceHistory[].cost      → cost NUMERIC (optional Number — no min
--                        in Mongo, so NUMERIC without a CHECK preserves
--                        negatives too)
--   * maintenanceHistory[].vendor     → vendor TEXT (optional String)
--   * position          → INTEGER NOT NULL DEFAULT 0 — preserves the original
--                        array order of the Mongo maintenanceHistory[]
--                        embedded documents (same convention as bill_items /
--                        purchase_order_items)
--   * created_at / updated_at → TIMESTAMPTZ NOT NULL DEFAULT now() (nested
--                        arrays with Mongoose sub-documents track their own
--                        timestamps when the parent schema uses timestamps;
--                        MySQL-style per-row created/updated mirror that)
--
-- Intentionally omitted fields: none. Every persisted Mongo field from the
-- Asset schema has an explicit column above, and every persisted embedded
-- maintenanceHistory field has an explicit column on
-- asset_maintenance_history. There are no virtual-only fields. The Asset
-- schema has no depreciation/currentValue/bookValue/notes/attachments/
-- assignedEmployee — those are NOT added because the Mongo model never
-- persisted them.
--
-- Stored vs derived financial fields: purchaseCost is a STORED field in the
-- Mongo model (persisted, default 0). There is no current value / book value /
-- depreciation computation anywhere in the Asset model or its consumers, so
-- PostgreSQL introduces NO derived column — purchase_cost is stored exactly as
-- written. Embedded maintenanceHistory[].cost is also a stored field.
--
-- Nested data decision: maintenanceHistory is the only nested structure on
-- the Asset document. It is normalized into a child table
-- asset_maintenance_history rather than JSONB because (a) the ONLY writer,
-- completeRepair, pushes full sub-documents which then need to be returned
-- in array order, and (b) the child rows are independent records whose
-- numeric cost benefits from NUMERIC precision and whose delete semantics
-- (CASCADE with the parent) exactly mirror Mongo removing the embedded array
-- with the document. This is the same normalization decision made for
-- bill_items / purchase_order_items / goods_received_note_items.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * category: ['Electrical', 'Furniture', 'Electronics', 'Utensils',
--     'Machinery', 'Other'] — default 'Other'.
--   * status: ['Active', 'Under Repair', 'Retired'] — default 'Active'.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
-- purchase_date is nullable (default null in Mongo — unset until provided).
--
-- Uniqueness semantics: the Mongo schema declares ONE unique index —
-- assetId { unique: true }. That is preserved as a UNIQUE constraint on
-- asset_id. No other unique index exists on the model, so none is invented.
-- serialNumber is NOT unique (the Mongo model has no unique index on it).
--
-- Foreign keys (documented per column; no fake FKs):
--   * assets.supplier → Supplier: NO FK — suppliers stay Mongo-backed (no
--     PostgreSQL table exists for them), so a real FK would be invented. Plain
--     TEXT exactly like preferred_supplier on inventory_items and supplier on
--     purchase_orders.
--   * asset_maintenance_history.asset_id → assets(id): real FK, the owning
--     parent. ON DELETE CASCADE — the embedded array in the Mongo Asset
--     document is part of the document itself, so deleting an asset must
--     remove exactly what Mongo would remove with it (the same lifecycle
--     decision made for bills + bill_items in Phase 2C).
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * idx_assets_asset_id — UNIQUE constraint (Mongo assetId unique: true);
--     the public QR-scan lookup Asset.findOne({ assetId }).
--   * idx_assets_name — the only standing asset list sort in the codebase:
--     getAllAssets does Asset.find().sort({ name: 1 }).
--   * idx_assets_status — the AdminAssetManagement tabs group statuses
--     ("Under Repair", "Scrapped"/Retired, Active filtering).
--   * idx_assets_category — the AdminAssetManagement category chips filter by
--     category.
--   * idx_assets_assigned_location — location-based asset lists.
--   * idx_assets_purchase_date — purchase-date reporting/sorting.
--   * idx_assets_created_at — the default createdAt DESC ordering convention
--     used by every entity list.
--   * idx_asset_maintenance_history_asset_id — per-asset maintenance history
--     reads/joins (completeRepair writer + list reads).

CREATE TABLE IF NOT EXISTS assets (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: assetId String — required, unique. The sole Mongo unique index.
  asset_id TEXT NOT NULL,
  -- Mongo: name String — required, trim.
  name TEXT NOT NULL,
  -- Mongo: category enum, default 'Other'.
  category TEXT NOT NULL DEFAULT 'Other',
  -- Mongo: qrCode String — default ''.
  qr_code TEXT NOT NULL DEFAULT '',
  -- Mongo: purchaseDate Date — default null (nullable until provided).
  purchase_date TIMESTAMPTZ,
  -- Mongo: supplier ObjectId ref 'Supplier' — optional. Plain TEXT, NO FK
  -- (suppliers stay Mongo-backed; see header).
  supplier TEXT,
  -- Mongo: invoiceNumber String — default ''.
  invoice_number TEXT NOT NULL DEFAULT '',
  -- Mongo: warranty String (e.g. "1 Year", "Ends 2025") — default ''.
  warranty TEXT NOT NULL DEFAULT '',
  -- Mongo: assignedLocation String — default 'Main Temple'.
  assigned_location TEXT NOT NULL DEFAULT 'Main Temple',
  -- Mongo: status enum, default 'Active'.
  status TEXT NOT NULL DEFAULT 'Active',
  -- Mongo: purchaseCost Number — default 0, NO min (NUMERIC preserves
  -- monetary scale exactly).
  purchase_cost NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: serialNumber String — default ''. NOT unique (Mongo has no unique
  -- index on it).
  serial_number TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's assetId unique: true.
  CONSTRAINT assets_asset_id_key UNIQUE (asset_id),
  CONSTRAINT assets_category_check CHECK (category IN ('Electrical', 'Furniture', 'Electronics', 'Utensils', 'Machinery', 'Other')),
  CONSTRAINT assets_status_check CHECK (status IN ('Active', 'Under Repair', 'Retired'))
);

CREATE TABLE IF NOT EXISTS asset_maintenance_history (
  id TEXT PRIMARY KEY,
  -- Owning asset. ON DELETE CASCADE — the embedded array is part of the
  -- Asset document (same lifecycle decision as bill_items / purchase_order_
  -- items).
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  -- Preserves the original array order of the Mongo Asset.maintenanceHistory[]
  -- embedded documents.
  position INTEGER NOT NULL DEFAULT 0,
  -- Mongo: repairDate Date — optional.
  repair_date TIMESTAMPTZ,
  -- Mongo: description String — optional.
  description TEXT,
  -- Mongo: cost Number — optional, no min (NUMERIC preserves scale).
  cost NUMERIC,
  -- Mongo: vendor String — optional.
  vendor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_name ON assets (name);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (status);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets (category);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_location ON assets (assigned_location);
CREATE INDEX IF NOT EXISTS idx_assets_purchase_date ON assets (purchase_date);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_history_asset_id ON asset_maintenance_history (asset_id, position);