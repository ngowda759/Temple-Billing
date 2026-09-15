# Phase 2P — PostgreSQL Assets

Incremental, additive migration of the MongoDB **Asset** entity to PostgreSQL,
following the architecture established in Phases 2A–2O.

## Scope

Only the Asset entity is migrated in this phase:

- `backend/src/db/migrations/017_create_assets.sql`
- `backend/src/repositories/assetRepository.js`
- `backend/src/services/assetService.js`
- minimal controller integration
  (`inventoryAssetController`, `publicAssetController`)
- tests + documentation

**Not migrated:** Repairs, Rooms, Attendance, Leaves, Shifts, Payroll,
Notifications, Events, Poojas, Prasadam, Settings, Audit Logs,
InventoryItem/Batch/Log/Consumption/Request, Purchase Orders, Goods Received
Notes, Damage Notes, MongoDB (still present), Mongoose (still the fallback),
and no Phase 2Q work. No production data migration and no global cutover
happen here.

## Mongo model inspected

`backend/src/models/Asset.js` (Mongoose), plus every real usage of
`Asset` / `asset` in the codebase:

- `backend/src/controllers/inventoryAssetController.js` — `getAllAssets`
  (`Asset.find().populate("supplier").sort({ name: 1 })`), `createAsset`
  (`Asset.create` with required assetId+name, duplicate assetId → HTTP 409),
  `updateAsset` (`Asset.findByIdAndUpdate(id, req.body, { new: true })`),
  `deleteAsset` (`Asset.findByIdAndDelete`).
- `backend/src/controllers/publicAssetController.js` — `getPublicAssetDetails`
  (`Asset.findOne({ assetId }).populate("supplier")` with fallback
  `Asset.findById(assetId).populate("supplier")` for 24-hex ids, then
  returns a projection of
  `id/assetId/name/category/purchaseDate/assignedLocation/status/warranty/
  supplier.name ('N/A' when unset)` together with the asset's **RepairTicket**
  maintenance history (NOT the embedded `maintenanceHistory` array).
- `backend/src/controllers/inventoryAssetController.completeRepair` — the
  **only** writer of the Asset's embedded `maintenanceHistory[]`: it pushes
  `{ repairDate: repair.completionDate, description:
  repair.description + (remarks ? ' - Remarks: ' + remarks : ''), cost:
  repair.cost, vendor: repair.vendor }` and saves the document.
- `backend/src/app.js` — the warranty-expiry cron runs
  `Asset.find({ warranty: { $exists: true, $ne: null } })` and parses the
  warranty **string** as a Date. It reads the Mongo collection directly and is
  untouched by this phase (Mongo stays the source of truth).
- `frontend/src/pages/admin/InventoryERP/AdminAssetManagement.jsx`,
  `frontend/src/pages/admin/InventoryManagement.jsx`,
  `frontend/src/pages/public/AssetScanResult.jsx`,
  `frontend/src/pages/accountant/AccountantInventory.jsx` — render
  `assetId/name/category/assignedLocation/status/purchaseDate/warranty/
  supplier/purchaseCost/serialNumber`. The asset **list** never renders a
  populated supplier; the public QR page renders `asset.supplier` as a name
  string that `publicAssetController` assembles.

The Asset Mongoose schema has one **embedded array**
(`maintenanceHistory[]`) and one Mongo-backed ObjectId reference
(`supplier` → `Supplier`, which has **no** PostgreSQL table in this phase).
The complete field list from the model: `assetId` (String, required,
`unique`), `name` (String, required, trim), `category` (6-value enum, default
`'Other'`), `qrCode` (String, default `''`), `purchaseDate` (Date, default
`null`), `supplier` (optional ObjectId ref `Supplier`), `invoiceNumber`
(String, default `''`), `warranty` (String, default `''` — e.g. "1 Year" /
"Ends 2025", **NOT** a Date), `assignedLocation` (String, default
`'Main Temple'`), `status` (3-value enum, default `'Active'`), `purchaseCost`
(Number, default `0`, **no min**), `serialNumber` (String, default `''`),
`maintenanceHistory[]` (embedded sub-documents `{ repairDate: Date,
description: String, cost: Number, vendor: String }`), plus `timestamps`
(`createdAt` / `updatedAt`).

**Intentionally omitted fields:** none of
depreciation / currentValue / bookValue / notes / attachments /
assignedEmployee — those are **not** fields on the Mongo model and are **not**
invented in PostgreSQL.

## Mongo → PostgreSQL field mapping

| Mongo field | Type/default | PostgreSQL column | PG type | Required/default | Transformation | Constraint/index | Notes |
|---|---|---|---|---|---|---|---|
| `_id` | ObjectId | `id` | `TEXT` | PK | 24-hex `crypto.randomBytes(12)` | PRIMARY KEY | Mongo-compatible ObjectId kept as-is |
| `assetId` | String, required, `unique`, trim | `asset_id` | `TEXT` | NOT NULL | trimmed, never null | `UNIQUE` (`assets_asset_id_key`) | the sole unique index on the Mongo model |
| `name` | String, required, trim | `name` | `TEXT` | NOT NULL | trimmed | index (`idx_assets_name`) | list sorted by name |
| `category` | String enum, default `'Other'` | `category` | `TEXT` | NOT NULL default `'Other'` | exact string | `CHECK` (6 values) + index | enum preserved exactly |
| `qrCode` | String, default `''` | `qr_code` | `TEXT` | NOT NULL default `''` | trimmed | — | — |
| `purchaseDate` | Date, default `null` | `purchase_date` | `TIMESTAMPTZ` | nullable | `Date` | index (`idx_assets_purchase_date`) | nullable until provided |
| `supplier` | ObjectId ref `Supplier`, optional | `supplier` | `TEXT` | nullable | plain string id | — | suppliers stay Mongo-backed → **no FK** (see Foreign keys) |
| `invoiceNumber` | String, default `''` | `invoice_number` | `TEXT` | NOT NULL default `''` | trimmed | — | — |
| `warranty` | String, default `''` | `warranty` | `TEXT` | NOT NULL default `''` | trimmed | — | a **String** in Mongo even though app.js parses it as a Date; kept TEXT |
| `assignedLocation` | String, default `'Main Temple'` | `assigned_location` | `TEXT` | NOT NULL default `'Main Temple'` | trimmed | index (`idx_assets_assigned_location`) | — |
| `status` | String enum, default `'Active'` | `status` | `TEXT` | NOT NULL default `'Active'` | exact string | `CHECK` (3 values) + index | enum preserved exactly |
| `purchaseCost` | Number, default `0`, **no min** | `purchase_cost` | `NUMERIC` | NOT NULL default `0` | passed verbatim (string/number) to NUMERIC | — | monetary scale preserved exactly; negatives legal in Mongo → no CHECK |
| `serialNumber` | String, default `''` | `serial_number` | `TEXT` | NOT NULL default `''` | trimmed | — | **NOT unique** (no Mongo unique index) |
| `maintenanceHistory[]` | embedded array | `asset_maintenance_history` (child table) | see below | — | normalized (see Nested data) | child index | every embedded field mapped below |
| `createdAt` | Date (timestamps) | `created_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | — | index (`idx_assets_created_at`) | exact instant preserved |
| `updatedAt` | Date (timestamps) | `updated_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | `now()` on update | — | — |

Every persisted Mongo field is mapped. There are **no silently dropped
fields** and **no invented columns/constraints**.

## Normalized `asset_maintenance_history` (every persisted embedded field)

| Mongo field | Type/default | PG column | PG type | Notes |
|---|---|---|---|---|
| `maintenanceHistory[]._id` | embedded ObjectId | `id` | `TEXT` PK | Mongo sub-documents get their own `_id` |
| `maintenanceHistory[].repairDate` | Date, optional | `repair_date` | `TIMESTAMPTZ` | optional |
| `maintenanceHistory[].description` | String, optional | `description` | `TEXT` | optional |
| `maintenanceHistory[].cost` | Number, optional, no min | `cost` | `NUMERIC` | monetary scale preserved; negatives legal |
| `maintenanceHistory[].vendor` | String, optional | `vendor` | `TEXT` | optional |
| (array order) | — | `position` | `INTEGER NOT NULL DEFAULT 0` | preserves the Mongo array order (same convention as bill_items / purchase_order_items) |
| (timestamps) | — | `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | nested sub-document timestamps |

## Nested-data decision

`maintenanceHistory[]` is the **only** nested structure on the Asset
document. It is normalized into the `asset_maintenance_history` child table
rather than JSONB because:

1. the only writer, `completeRepair`, pushes full sub-documents that must be
   returned in array order;
2. child rows are independent records whose numeric `cost` benefits from
   `NUMERIC` precision;
3. `ON DELETE CASCADE` on the parent exactly mirrors Mongo removing the
   embedded array when the document is deleted.

This is the same normalization decision made for `bill_items`,
`purchase_order_items` and `goods_received_note_items`.

## Stored vs derived fields

- `purchase_cost` is a **stored** field in the Mongo model (persisted, default
  `0`). There is no depreciation / current value / book value computation
  anywhere in the Asset model or its consumers, so PostgreSQL introduces
  **no** derived column — `purchase_cost` is stored exactly as written.
- Embedded `maintenanceHistory[].cost` is also a **stored** field.
- `created_at` / `updated_at` use the conventional `now()` defaults and the
  repository stamps `updated_at` on updates.

## Enums (preserved exactly)

- `category`: `['Electrical', 'Furniture', 'Electronics', 'Utensils',
  'Machinery', 'Other']` — default `'Other'`.
- `status`: `['Active', 'Under Repair', 'Retired']` — default `'Active'`.

No values added, removed or renamed. No invented enums.

## Monetary semantics

- `purchase_cost` is `NUMERIC NOT NULL DEFAULT 0` with **no** CHECK, because
  the Mongo schema has no `min` for `purchaseCost` (negatives are legal).
- `asset_maintenance_history.cost` is `NUMERIC` (nullable, no CHECK) with the
  same no-min reasoning.
- The PostgreSQL driver returns NUMERIC as JS numbers; the test suite asserts
  exact round-trips for `0.01`, `10.50`, `1000.99`, `1000000.99`,
  `123456789.1234` and `-5` (a legal Mongo value). No JavaScript float
  corruption and no rounding are introduced.

## Fallback boundary (explicit)

Entity-scoped, no global switch, no dual writes:

```
Asset Service
      |
      +-- PostgreSQL available (datasource seam connected AND isPostgresConnected())
      |        ↓
      |    assetRepository → assets + asset_maintenance_history
      |
      +-- PostgreSQL unavailable (seam disconnected OR PG unreachable)
              ↓
          Mongoose Asset model (unchanged Phase 1 path)
```

- `assetService.usePostgres()` returns true only when
  `dbConfig.isDbConnected()` **and** `isPostgresConnected()` succeed. If
  either fails, every operation routes to the existing Mongoose model.
- The repository reads `dbConfig.isDbConnected()` at call time through the
  module object (`dbConfig.isDbConnected()`), not a destructured snapshot, so
  tests can switch datasource state in-process without restarting Node.
- No dual writes: a single operation goes down exactly one branch.

## Foreign keys (documented per column)

| Source column | Target table | Nullable? | ON DELETE | Reason |
|---|---|---|---|---|
| `asset_maintenance_history.asset_id` | `assets(id)` | required (NOT NULL) | CASCADE | The embedded `maintenanceHistory[]` array is part of the Asset document itself; deleting an asset must remove exactly what Mongo would remove with it (same lifecycle decision as bills + bill_items in Phase 2C) |
| `assets.supplier` | — | nullable | — | suppliers stay **Mongo-backed** (no PostgreSQL table exists), so a plain `TEXT` id is stored with **no FK** — exactly like `inventory_items.preferred_supplier` and `purchase_orders.supplier` in Phases 2H/2M |

No fake FKs are created. No invented `users`/`employees` FK: the Asset model
has no assigned-employee reference.

## Indexes and the queries they serve

| Index | Query/use case | Justification |
|---|---|---|
| `assets_asset_id_key` (UNIQUE) | Mongo `assetId { unique: true }` and the public QR-scan lookup `Asset.findOne({ assetId })` | the sole uniqueness semantic; no invented uniqueness |
| `idx_assets_name` | `getAllAssets` — `Asset.find().sort({ name: 1 })`, the standing asset-list sort | every list route sorts by name |
| `idx_assets_status` | AdminAssetManagement status tabs (Active / Under Repair / Retired) | status-driven grouping |
| `idx_assets_category` | AdminAssetManagement category chips | category-driven filtering |
| `idx_assets_assigned_location` | location-based asset lists | standing location filter |
| `idx_assets_purchase_date` | purchase-date reporting/sorting | reporting range queries |
| `idx_assets_created_at` | default `created_at DESC` list ordering convention | shared by every entity list |
| `idx_asset_maintenance_history_asset_id` | per-asset maintenance reads/joins (the `completeRepair` writer + list reads) | child `(asset_id, position)` access path |

`serial_number` is deliberately **not** unique (the Mongo model has no unique
index on it) and `warranty` is **not** indexed (its only consumer is the
Mongo-side cron).

## Repository methods

`backend/src/repositories/assetRepository.js`:

- `create(data)` — validates required fields / enums / money, INSERTs assets +
  child `asset_maintenance_history` rows (with `position`), re-reads the doc.
- `findById(id)` — `SELECT ... WHERE id = $1 LIMIT 1`, loads child history.
- `findOne(filter)` — builds an optional `WHERE` from the whitelisted filter
  (used by the public `findOne({ assetId })` lookup).
- `findMany({ filter, sort, limit, offset })` — whitelisted sort keys, safe
  `LIMIT`/`OFFSET`, deterministic secondary `id ASC` tiebreak, loads child
  history for each row.
- `updateById(id, updates)` — applies only provided fields + `updated_at =
  now()`; returns null for a missing id; embedded history is only appended via
  `addMaintenanceRecord`, never silently rewritten.
- `addMaintenanceRecord(assetId, entry)` — the `completeRepair` writer: appends
  an entry in array order (`MAX(position)+1`), mirroring Mongo `$push`.
- `count(filter)` — `SELECT COUNT(*)::int`.
- `destroy(id)` — `DELETE ... RETURNING id` (truthy on deletion; child rows
  CASCADE).
- Mongo fallbacks for each operation using the Mongoose model.

Filtering supports the exact keys the Mongo model exposes (`id`, `assetId`,
`name`, `category`, `status`, `supplier`, `assignedLocation`, `serialNumber`,
`warranty`, `purchaseDate`, `createdAt`, `updatedAt`, `purchaseCost`) plus the
Mongo comparison operators `$in` and `$gte/$gt/$lte/$lt` and the
`{ warranty: { $exists: true, $ne: null } }` cron shape. `$in: []` renders
`1 = 0`, matching Mongo's instant-false semantics. `$ne: null` renders a
parameterless `IS NOT NULL`. Sorting is dynamic but goes through a whitelist
map — a hostile sort key falls back to the default ordering. All SQL is
parameterized.

## Service

`backend/src/services/assetService.js` mirrors the other Phase 2 services:

- preserves validation required fields (`assetId`, `name`), defaults
  (`category` → `'Other'`, `status` → `'Active'`, `qrCode`/`invoiceNumber`/
  `warranty`/`serialNumber` → `''`, `assignedLocation` → `'Main Temple'`,
  `purchaseCost` → `0`), the enum checks, and the no-min semantics of
  `purchaseCost`;
- `create/findById/findOne/findMany/updateById/addMaintenanceRecord/count/
  destroy` each branch via `usePostgres()`: PostgreSQL when available,
  otherwise Mongoose — one single operation, one branch, no dual write;
- the `validate(data)` helper exposes the same normalization for future
  callers;
- `isConnected()` / `usePostgres()` are public so tests can assert exactly
  which datasource is active.

## Integration

The controller changes are minimal and preserve the API contract:

- `inventoryAssetController.getAllAssets` now calls
  `assetService.findMany({ sort: { name: 1 } })` instead of
  `Asset.find().populate("supplier")`. The asset list response shape is
  unchanged (`{ success: true, assets }`); the admin frontend never renders a
  populated supplier in the list, and the only supplier-name consumer
  (`AssetScanResult`) goes through `publicAssetController`, so the removal of
  `populate` from the list changes nothing observable.
- `createAsset` / `updateAsset` / `deleteAsset` route through the service with
  the same status codes — including HTTP 409 "Asset ID already exists" for a
  duplicate assetId (Mongo `11000` on the fallback, the
  `assets_asset_id_key` unique-violation message on the PG path).
- `completeRepair` keeps RepairRequest entirely Mongo-backed (Repairs are not
  part of this phase) and routes only the embedded
  `asset.maintenanceHistory.push(...)+save()` step through
  `assetService.addMaintenanceRecord(assetId, {...})`, so the maintenance
  history lands on whichever datasource the asset lives on.
- `publicAssetController.getPublicAssetDetails` reads through
  `assetService.findOne({ assetId })` / `findById`, keeps RepairTicket
  (Mongo-backed) for the maintenance history, and resolves `supplier.name`
  from the Mongo Supplier collection whether the asset came from PG (plain
  id string) or Mongoose (bare ObjectId) — `'N/A'` when unresolvable, exactly
  the pre-migration populate-null contract.

No public API shape changed: asset response documents keep Mongo field names
(`_id`, camelCase), supplier is resolved to a name in the QR route, and asset
ids remain 24-hex Mongo-compatible strings.

## Transaction handling

The Asset write involves a parent `assets` row plus (on create / when
`completeRepair` appends) child `asset_maintenance_history` rows. Both are in
the **same** PostgreSQL database, and the repository issues the parent INSERT
and each child INSERT sequentially through the shared `pg` pool. A failed
child INSERT leaves a partial parent row — the same non-atomicity the existing
per-phase repositories accept (the app.js cron and the Mongo flow are equally
non-transactional across these stores). No application-level transaction is
claimed; the enterprise convention is per-statement atomicity.

## Repository tests

Coverage lives in `backend/test/postgres-repositories.test.js` (direct
repository layer) and `backend/test/postgres-assets.test.js` (service layer).
Both run against the real PostgreSQL container. Cases covered:
create/read/update round-trip (incl. embedded history), findById/findOne,
findMany, count, destroy, required fields, optional fields, defaults,
enum validation, invalid enum rejection, ID round-trip (24-hex), timestamps,
filtering, `$in` (incl. empty `$in` → 0 rows), sorting (incl.
hostile/unwhitelisted sort key), pagination, date-range filters, warranty-cron
filter (`warranty IS NOT NULL`), purchaseCost/maintenance-cost NUMERIC
precision, duplicate assetId UNIQUE constraint, `ON CONFLICT (id) DO NOTHING`
silent duplicate-id convention, the `completeRepair` append writer, child-row
CASCADE on delete, and `DELETE RETURNING` existence reporting.

## Service/fallback tests

`backend/test/postgres-assets-fallback.test.js` proves, with the datasource
seam pinned to "disconnected", that:

- `usePostgres()` is false and the service routes to Mongoose;
- the repository's CRUD methods genuinely invoke the Mongoose model (via
  call-tracking spies installed on the actual model methods), including reads,
  updates (`findByIdAndUpdate`) and deletes (`findByIdAndDelete`);
- the Mongo fallback works with the `assets` table missing;
- no PG row is written while the Mongo fallback is active (no dual write);
- the service end-to-end invokes `create/findById/findOne/findMany/
  updateById/addMaintenanceRecord/count/destroy` on the Mongo model;
- the seam flips back to PostgreSQL **within the same process** without
  restarting Node.

`backend/test/postgres-assets.test.js` also includes an in-process
datasource-switching test and a no-dual-write assertion
(`mongoose.connection.readyState === 0` and an exact PG row-count delta of
one).

## Migration tests

`backend/test/postgres-migrate.test.js` covers the full chain (now 17
migrations): fresh run applies 001–017, idempotent second run applies none,
rollback-and-reapply of migration 017 rebuilds `assets` +
`asset_maintenance_history` + FKs, a deliberately failed migration rolls back
with no recorded row, no partial table/index/constraint left, and the real 017
`assets` tables remain intact. All previous migration files are unchanged
(git diff clean).

## Final migration chain

1. `001_create_pg_health.sql`
2. `002_create_users_employees.sql`
3. `003_create_accounting.sql`
4. `004_create_bills.sql`
5. `005_create_donations.sql`
6. `006_create_bookings.sql`
7. `007_create_pooja_bookings.sql`
8. `008_create_prasadam_orders.sql`
9. `009_create_inventory_items.sql`
10. `010_create_inventory_batches.sql`
11. `011_create_inventory_logs.sql`
12. `012_create_inventory_consumption.sql`
13. `013_create_inventory_requests.sql`
14. `014_create_purchase_orders.sql`
15. `015_create_goods_received_notes.sql`
16. `016_create_damage_notes.sql`
17. `017_create_assets.sql`