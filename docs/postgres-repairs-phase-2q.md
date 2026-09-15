# Phase 2Q — PostgreSQL Repairs

Incremental, additive migration of the MongoDB **Repair** domain to
PostgreSQL, following the architecture established in Phases 2A–2P.

The repository contains **two** Repair entities, and both are migrated in this
phase:

- `backend/src/models/RepairRequest.js` — the "repair request" record
  (asset + description + cost, 4-value status).
- `backend/src/models/RepairTicket.js` — the "repair ticket" record
  (ticketNumber, asset, reportedBy, issueDescription, status, priority,
  embedded `sparePartsUsed[]`, vendor bill fields).

There is no single model named `Repair`; the actual repository implementation
is the source of truth and it declares exactly these two.

## Scope

Only the Repair domain is migrated in this phase:

- `backend/src/db/migrations/018_create_repairs.sql`
- `backend/src/repositories/repairRequestRepository.js`
- `backend/src/repositories/repairTicketRepository.js`
- `backend/src/services/repairRequestService.js`
- `backend/src/services/repairTicketService.js`
- minimal controller integration
  (`inventoryAssetController.getAllRepairs/createRepair/completeRepair`,
  `inventoryWorkflowController.completeRepairTicket`,
  `publicAssetController.getPublicAssetDetails`)
- tests + documentation

**Not migrated:** Rooms, Attendance, Leaves, Shifts, Payroll, Notifications,
Events, Poojas, Prasadam, Settings, Audit Logs, Assets (already 2P), Inventory
Item/Batch/Log/Consumption/Request, Purchase Orders, Goods Received Notes,
Damage Notes, MongoDB (still present), Mongoose (still the fallback). No Phase
2R work, no production data migration, no dual writes and no global cutover
happen here.

## Mongo models inspected

`backend/src/models/RepairRequest.js` and
`backend/src/models/RepairTicket.js`, plus every real usage of
`RepairRequest` / `RepairTicket` in the codebase:

- `backend/src/controllers/inventoryAssetController.js`
  — `getAllRepairs` (`RepairRequest.find().populate("asset").sort({ createdAt:
  -1 })`), `createRepair` (`RepairRequest.create` with a required `asset` +
  `description`, always forcing `status: 'Pending'`), `completeRepair`
  (`RepairRequest.findById(id).populate("asset")`, rejects an
  already-`Completed` repair with HTTP 400, sets `status: 'Completed'` and
  `completionDate`, optionally overwrites `cost` / `invoiceNumber`, saves, then
  appends the Asset `maintenanceHistory` entry via
  `assetService.addMaintenanceRecord` and records an `AccountTransaction` when
  `cost > 0`).
- `backend/src/controllers/inventoryWorkflowController.js`
  — `completeRepairTicket` (`RepairTicket.findById(id).populate("asset")
  .populate("sparePartsUsed.item")`, sets `status: 'Completed'` and the three
  vendor bill fields, saves, then records an `AccountTransaction` when
  `vendorBillAmount > 0`).
- `backend/src/controllers/publicAssetController.js`
  — `getPublicAssetDetails` (`RepairTicket.find({ asset }).populate("reportedBy",
  "name").populate("approvedBy", "name").sort({ createdAt: -1 })`, returned as
  the asset's public maintenance history).
- `backend/src/routes/adminInventoryRoutes.js` (lines 75–77) — the
  `/api/admin/inventory/repairs` routes bound to `getAllRepairs` /
  `createRepair` / `completeRepair`.
- `backend/src/models/AccountTransaction.js` — the polymorphic
  `reference_model` enum already includes `'RepairRequest'` and
  `'RepairTicket'`, and `accountTransactionRepository.SOURCES` already
  whitelists `'Repair'`. That listing does **not** imply a schema change to
  `account_transactions`; it is only used by the existing (Mongo-written)
  repair completion flows.
- `frontend/src/pages/public/AssetScanResult.jsx` — renders
  `maintenanceHistory[]` entries as `ticket._id`, `ticket.ticketNumber`,
  `ticket.status`, `ticket.issueDescription`, `ticket.reportedBy?.name`,
  `ticket.createdAt` and `ticket.resolutionNotes`. This is the exact response
  contract preserved by the `publicAssetController` integration.
- `backend/src/models/InventoryItem.js` — the `sparePartsUsed[].item` target
  (read through `populate`, written as a plain id).
- `backend/src/models/Asset.js` — the target of `RepairRequest.asset`
  (`ref: "Asset"`) and the asset whose `maintenanceHistory` a completed
  request appends to.

The `RepairTicket.asset` reference is declared as `ref: "InventoryAsset"`,
which is a **legacy/broken cross-reference**: the only registered asset model
is `Asset` (model name `"Asset"`), and `inventoryAssetController` writes the
same `asset` id space for both entities. This is documented rather than
"fixed" — no relationship is invented (see Foreign keys).

## Mongo → PostgreSQL field mapping — `repair_requests`

| Mongo field | Type/default | PostgreSQL column | PG type | Required/default | Transformation | Constraint/index | Notes |
|---|---|---|---|---|---|---|---|
| `_id` | ObjectId | `id` | `TEXT` | PK | 24-hex `crypto.randomBytes(12)` | PRIMARY KEY | Mongo-compatible ObjectId kept as-is |
| `asset` | ObjectId ref `Asset`, required | `asset_id` | `TEXT` | nullable | stringified | index | plain TEXT, **no FK** (see Foreign keys) |
| `description` | String, required | `description` | `TEXT` | NOT NULL | trimmed | — | required scalar |
| `vendor` | String, default `''` | `vendor` | `TEXT` | NOT NULL default `''` | trimmed | — | default preserved |
| `cost` | Number, default `0`, **no min** | `cost` | `NUMERIC` | NOT NULL default `0` | passed verbatim (string/number) to NUMERIC | — | money as NUMERIC; negatives legal → deliberately **no** CHECK |
| `invoiceNumber` | String, default `''` | `invoice_number` | `TEXT` | NOT NULL default `''` | trimmed | — | default preserved |
| `status` | String, enum, default `'Pending'` | `status` | `TEXT` | NOT NULL default `'Pending'` | exact string | `CHECK` (4-value enum); index | enum preserved exactly |
| `completionDate` | Date, optional | `completion_date` | `TIMESTAMPTZ` | nullable | — | — | unset until `completeRepair` stamps it |
| `createdBy` | String, optional | `created_by` | `TEXT` | nullable | trimmed | — | Mongo `String`, **not** an ObjectId ref → no cast, no FK |
| `createdAt` | Date (timestamps) | `created_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | — | index | exact instant preserved |
| `updatedAt` | Date (timestamps) | `updated_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | `now()` on update | — | — |

## Mongo → PostgreSQL field mapping — `repair_tickets`

| Mongo field | Type/default | PostgreSQL column | PG type | Required/default | Transformation | Constraint/index | Notes |
|---|---|---|---|---|---|---|---|
| `_id` | ObjectId | `id` | `TEXT` | PK | 24-hex `crypto.randomBytes(12)` | PRIMARY KEY | — |
| `ticketNumber` | String, required, `unique`, `trim` | `ticket_number` | `TEXT` | NOT NULL | trimmed | `UNIQUE` (`repair_tickets_ticket_number_key`) | the sole Mongo unique index on the model |
| `asset` | ObjectId ref `InventoryAsset`, required | `asset_id` | `TEXT` | NOT NULL | stringified | index | plain TEXT, **no FK** (`InventoryAsset` model does not exist) |
| `reportedBy` | ObjectId ref `Employee`, required | `reported_by` | `TEXT` | NOT NULL | stringified | index | employees stay Mongo-backed → plain TEXT, **no FK** |
| `issueDescription` | String, required | `issue_description` | `TEXT` | NOT NULL | trimmed | — | required scalar |
| `status` | String, enum, default `'Reported'` | `status` | `TEXT` | NOT NULL default `'Reported'` | exact string | `CHECK` (7-value enum); index | enum preserved exactly |
| `priority` | String, enum, default `'Medium'` | `priority` | `TEXT` | NOT NULL default `'Medium'` | exact string | `CHECK` (4-value enum); index | enum preserved exactly |
| `sparePartsUsed[]` | embedded array of `{ item, quantity }` | *normalized* → `repair_ticket_spare_parts` | — | — | see nested-data section | child table | the only nested structure on either model |
| `vendor` | ObjectId ref `InventorySupplier`, optional | `vendor` | `TEXT` | nullable | trimmed | — | suppliers stay Mongo-backed → plain TEXT, **no FK** |
| `vendorBillAmount` | Number, default `0`, **no min** | `vendor_bill_amount` | `NUMERIC` | NOT NULL default `0` | passed verbatim | — | money as NUMERIC; no CHECK (negatives legal in Mongo) |
| `vendorBillPhoto` | String (URL), optional | `vendor_bill_photo` | `TEXT` | nullable | trimmed; null when unset | — | — |
| `repairExpenseId` | ObjectId ref `AccountTransaction`, optional | `repair_expense_id` | `TEXT` | nullable | stringified | — | ledger pointer written after the row exists → plain TEXT, **no FK** |
| `approvedBy` | ObjectId ref `Employee`, optional | `approved_by` | `TEXT` | nullable | stringified | index | plain TEXT, **no FK** |
| `resolutionNotes` | String, optional | `resolution_notes` | `TEXT` | nullable | verbatim | — | — |
| `createdAt` | Date (timestamps) | `created_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | — | index | — |
| `updatedAt` | Date (timestamps) | `updated_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | `now()` on update | — | — |

## Mongo → PostgreSQL field mapping — `repair_ticket_spare_parts`

| Mongo field | Type/default | PostgreSQL column | PG type | Required/default | Transformation | Constraint/index | Notes |
|---|---|---|---|---|---|---|---|
| `sparePartsUsed[]._id` | ObjectId | `id` | `TEXT` | PK | 24-hex | PRIMARY KEY | Mongo sub-document id |
| — (owning document) | — | `ticket_id` | `TEXT` | NOT NULL | parent id | FK → `repair_tickets(id) ON DELETE CASCADE` | real parent/child link |
| — (array index) | — | `position` | `INTEGER` | NOT NULL default `0` | array index | index `(ticket_id, position)` | preserves array order |
| `sparePartsUsed[].item` | ObjectId ref `InventoryItem`, optional | `inventory_item_id` | `TEXT` | nullable | stringified | — | plain TEXT, **no FK** (see Foreign keys) |
| `sparePartsUsed[].quantity` | Number, default `1`, **no min** | `quantity` | `NUMERIC` | NOT NULL default `1` | passed verbatim | — | fractional quantities preserved; no CHECK |
| — | — | `created_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | — | — | — |
| — | — | `updated_at` | `TIMESTAMPTZ` | NOT NULL default `now()` | `now()` on update | — | — |

Every persisted Mongo field from both schemas is mapped. There are **no
silently dropped fields** and **no invented columns, enums or constraints**.
Neither model declares persisted virtuals, and neither has notes, attachments,
labour cost or warranty fields — those are **not** added. `RepairRequest` has
no priority, no technician and no reported/start date beyond `completionDate`;
those are **not** invented either.

## Nested-data decision

`sparePartsUsed[]` is the **only** nested structure on either Repair document
and it lives on `RepairTicket`. It is normalized into the child table
`repair_ticket_spare_parts` rather than stored as JSONB because:

- the sub-documents are independent records with their own Mongo `_id`;
- `quantity` benefits from exact `NUMERIC` precision;
- array order matters and is preserved by `position`;
- deleting a ticket must remove exactly what Mongo removes with the document
  (CASCADE).

This is the same decision made for `asset_maintenance_history` (2P),
`bill_items` (2C) and `purchase_order_items` (2M).

`RepairRequest` has **no** embedded child data and stays a single table. No
`repair_items`, `repair_parts` or `repair_history` tables are invented, because
the application contains no such data.

## Stored vs derived fields

- `cost` (RepairRequest) and `vendorBillAmount` (RepairTicket) are **stored**
  fields in the Mongo models (persisted, default `0`). PostgreSQL stores them
  verbatim as `NUMERIC`.
- `sparePartsUsed[].quantity` is a **stored** quantity (default `1`). There is
  **no** quantity × unit-cost calculation anywhere in the Repair models or
  their consumers, so PostgreSQL introduces no derived money column and no
  computed amount. Existing calculation semantics are preserved by not
  redesigning them.
- `completionDate` is stamped by `completeRepair` (body value or `now()`) and
  stored; the repository does not derive it.

## Enums (preserved exactly)

- `repair_requests.status`: `['Pending', 'In Progress', 'Completed',
  'Cancelled']` — default `'Pending'`.
- `repair_tickets.status`: `['Reported', 'Pending Approval', 'Approved',
  'In Progress', 'Completed', 'Rejected', 'Closed']` — default `'Reported'`.
- `repair_tickets.priority`: `['Low', 'Medium', 'High', 'Critical']` —
  default `'Medium'`.

No values added, removed or renamed. No workflow state is invented.

## Lifecycle semantics preserved

- `createRepair` always writes `status: 'Pending'` (the controller never reads
  a status from the body); `completeRepair` is the only writer of
  `'Completed'`. Both are preserved.
- `completeRepair` still rejects an already-`Completed` request with HTTP 400
  before any write.
- `completeRepairTicket` keeps its "each vendor field falls back to its
  current value" semantics.
- Asset interaction is unchanged: a completed request still appends an Asset
  `maintenanceHistory` entry through `assetService.addMaintenanceRecord`, and
  an `AccountTransaction` is still recorded when `cost > 0` /
  `vendorBillAmount > 0`. The Assets domain is **not** redesigned or
  re-migrated; only the Repair-side read/write now follows the datasource.
- Deletion: nothing in Mongo cascades when a repair is deleted. A repair
  request deletes one row; a repair ticket deletes its own child spare-part
  rows (which are part of the same document in Mongo) and nothing else.

## Quantity and monetary semantics

- `cost`, `vendor_bill_amount` and `spare_parts.quantity` are `NUMERIC` — never
  `FLOAT`/`REAL`/`DOUBLE PRECISION`.
- None of the three has a `min` in Mongo, so **no** `>= 0` CHECK is invented;
  negatives stay legal exactly as in Mongo.
- The PostgreSQL driver returns `NUMERIC` as JS numbers; the test suite asserts
  exact round-trips for `0.01`, `10.50`, `1000.99`, `1000000.99`,
  `123456789.1234` and `0` at both the repository/service layer and the raw
  SQL layer.

## Fallback boundary (explicit)

Entity-scoped, no global switch, no dual writes:

```
Repair Services (repairRequestService / repairTicketService)
      |
      +-- PostgreSQL available (datasource seam connected AND isPostgresConnected())
      |        ↓
      |    repairRequestRepository / repairTicketRepository
      |      → repair_requests + repair_tickets + repair_ticket_spare_parts
      |
      +-- PostgreSQL unavailable (seam disconnected OR PG unreachable)
              ↓
          Mongoose RepairRequest / RepairTicket models (unchanged Phase 1 path)
```

- `usePostgres()` returns true only when `dbConfig.isDbConnected()` **and**
  `isPostgresConnected()` succeed. If either fails, every operation routes to
  the existing Mongoose model, so an unavailable PostgreSQL can never take the
  app down.
- The datasource seam is read **at call time** through the module object
  (`dbConfig.isDbConnected()`), never destructured at require time, so tests
  (and any runtime flip) can switch datasource state in-process without
  restarting Node.
- No dual writes: a single operation goes down exactly one branch, and the
  tests assert an exact PG row-count delta plus
  `mongoose.connection.readyState === 0`.

## Foreign keys (documented per column)

| Source column | Target table | Nullable? | ON DELETE | Reason |
|---|---|---|---|---|
| `repair_ticket_spare_parts.ticket_id` | `repair_tickets(id)` | required | **CASCADE** | the embedded array is part of the RepairTicket document; deleting a ticket must remove exactly what Mongo removes with it (same lifecycle as `asset_maintenance_history` in 2P) |
| `repair_requests.asset_id` | — | nullable | — | the model ref `Asset` and the ticket ref `InventoryAsset` are inconsistent legacy naming, and the repairs table writes a raw supplied ObjectId; plain TEXT, **no FK** |
| `repair_requests.created_by` | — | nullable | — | the Mongo field is a `String` (not an ObjectId ref); plain TEXT, **no FK** |
| `repair_tickets.asset_id` | — | required | — | the referenced `InventoryAsset` Mongoose model does not exist; plain TEXT, **no FK** |
| `repair_tickets.reported_by` / `approved_by` | — | required / nullable | — | employees stay Mongo-backed (same reasoning as `damage_notes` in 2O); plain TEXT, **no FK** |
| `repair_tickets.vendor` | — | nullable | — | suppliers stay Mongo-backed; plain TEXT, **no FK** |
| `repair_tickets.repair_expense_id` | — | nullable | — | the ledger pointer is written after the repair row exists; a FK would gate repair writes on accounting ordering, which Mongo does not do; plain TEXT, **no FK** |
| `repair_ticket_spare_parts.inventory_item_id` | — | nullable | — | the embedded sub-path is not required, and the model ref `InventoryItem` is legacy naming; plain TEXT, **no FK** so a repair sub-row cannot alter InventoryItem deletion semantics |

Exactly **one** real FK exists in this phase. No CASCADE is applied to any
reference Mongo does not cascade; no fake or speculative FK is created.

## Indexes and the queries they serve

| Index | Query/use case |
|---|---|
| `idx_repair_requests_asset_id` | per-asset repair lookups (`completeRepair`, asset detail views) |
| `idx_repair_requests_status` | status tabs/filters |
| `idx_repair_requests_created_at` | the standing `getAllRepairs` sort `sort({ createdAt: -1 })` |
| `repair_tickets_ticket_number_key` (UNIQUE) | Mongo `ticketNumber { unique: true }` + ticket lookups |
| `idx_repair_tickets_asset_id` | public asset-detail maintenance history `find({ asset })` |
| `idx_repair_tickets_status` / `idx_repair_tickets_priority` | status/priority filters |
| `idx_repair_tickets_reported_by` / `idx_repair_tickets_approved_by` | "my tickets" / approver queues |
| `idx_repair_tickets_created_at` | the standing `createdAt DESC` ordering convention |
| `idx_repair_ticket_spare_parts_ticket_id` | per-ticket part reads (`ticket_id, position`) |

No other column has a standing query pattern, so no other index is created and
no uniqueness is invented (`repair_requests` deliberately has **no** unique
constraint — the Mongo model declares none).

## Repository methods

`backend/src/repositories/repairRequestRepository.js`:

- `create(data)` — validates required/enum/money rules, INSERTs, re-reads.
- `findById(id)` / `findOne(filter)` / `findMany({ filter, sort, limit, offset })`
- `updateById(id, updates)` — applies only provided fields + `updated_at =
  now()`; returns `null` for a missing id.
- `count(filter)` — `SELECT COUNT(*)::int`.
- `destroy(id)` — `DELETE ... RETURNING id` (truthy on deletion).
- Mongo fallbacks for every operation.

`backend/src/repositories/repairTicketRepository.js`:

- the same surface, plus transactional parent + child handling:
  `create` wraps the ticket INSERT and its spare-part INSERTs in a single
  `BEGIN`/`COMMIT` (rolled back on any failure);
  `updateById` wraps the ticket UPDATE plus delete-and-reinsert of the
  `sparePartsUsed[]` rows in one transaction;
  `destroy` deletes the parent row and lets the FK CASCADE remove the children.

Filtering supports the keys the Mongo models expose (`id`, `asset`, `status`,
`vendor`, `description`, `invoiceNumber`, `createdBy`, `cost`,
`completionDate`, `createdAt`, `updatedAt`, `ticketNumber`, `reportedBy`,
`approvedBy`, `priority`) plus the Mongo operators `$in` and
`$gte/$gt/$lte/$lt`. `$in: []` renders `1 = 0`, matching Mongo's instant-false
semantics. Sorting is dynamic but goes through a whitelist map — a hostile sort
key falls back to the default ordering. `LIMIT`/`OFFSET` are numeric-coerced
and appended as literals (never user string interpolation). All filter values
are parameterized.

## Service

`backend/src/services/repairRequestService.js` and
`backend/src/services/repairTicketService.js` mirror the other Phase 2
services:

- preserve the required fields, defaults (`status`, `priority`, `vendor`,
  `invoiceNumber`, `cost`, `vendorBillAmount`, `sparePartsUsed[].quantity`),
  the enum checks and the no-min monetary semantics;
- `create/findById/findOne/findMany/updateById/count/destroy` each branch via
  `usePostgres()`: PostgreSQL when available, otherwise Mongoose — one
  operation, one branch, no dual write;
- `validate(data)` exposes the same normalization for future callers;
- `isConnected()` / `usePostgres()` are public so tests can assert exactly
  which datasource is active.

## Integration

- `inventoryAssetController` — `getAllRepairs`, `createRepair` and
  `completeRepair` now call `repairRequestService`. The
  `withPopulatedAsset` helper resolves the referenced asset on whichever
  datasource it lives on (Mongo populate returns the full document; the PG
  path returns a plain id), so the response shape is identical on both paths.
  The asset `maintenanceHistory` append and the `AccountTransaction` recording
  are unchanged, and `completeRepair` keeps its HTTP 400 "already completed"
  guard.
- `inventoryWorkflowController.completeRepairTicket` now loads and updates
  through `repairTicketService`. The new `populateTicket` helper reassembles
  the `asset` and `sparePartsUsed[].item` documents the pre-migration
  `populate` produced, so the response contract is unchanged.
- `publicAssetController.getPublicAssetDetails` now reads the maintenance
  history through `repairTicketService.findMany({ filter: { asset }, sort: {
  createdAt: -1 } })` and resolves `reportedBy` / `approvedBy` names from the
  Mongo `Employee` collection on both paths, preserving the exact response
  `AssetScanResult.jsx` consumes (`ticket.reportedBy?.name`). Unresolvable
  references keep their raw id, exactly like `populate` leaving the field
  untouched.

No API contract changed: response shapes, status codes and route bindings are
identical.

## Transaction handling

`repair_requests` is flat, so a single create/update is naturally atomic (one
statement). `repair_tickets` has child rows, so both writers are transactional:

- `create` — `BEGIN` → INSERT ticket → INSERT spare parts → `COMMIT`; any
  failure rolls the whole thing back so no partial parent row survives.
- `updateById` — `BEGIN` → UPDATE ticket → DELETE existing spare parts →
  INSERT the replacement array → `COMMIT`; a failure rolls back the parent
  update too.
- `destroy` — a single DELETE; the FK CASCADE removes the children.

The tests exercise both rollback paths by colliding a spare-part primary key,
and assert the parent row/status is untouched afterwards.

## Repository / service tests

Coverage lives in `backend/test/postgres-repositories.test.js` (direct
repository layer), `backend/test/postgres-repairs.test.js` (service layer) and
`backend/test/postgres-repairs-fallback.test.js` (Mongo fallback). All run
against real PostgreSQL. Cases covered: create/read/update round-trip,
`findById`/`findOne`/`findMany`, `count`, `destroy`, required fields, optional
fields, defaults, enum validation (every legal value plus rejection of illegal
ones), 24-hex id round-trip, timestamps, embedded spare parts round-trip and
ordering, spare-part replacement (not append), filtering, `$in` (including
empty `$in` → 0 rows), sorting (including a hostile/unwhitelisted sort key),
pagination, duplicate `ticketNumber` rejection, the absence of a
`repair_requests` unique constraint, monetary/quantity precision, CASCADE
delete, and transaction rollback for both create and update.

## Fallback tests

`backend/test/postgres-repairs-fallback.test.js` proves, with the datasource
seam pinned to "disconnected", that:

- `usePostgres()` is false and both services route to Mongoose;
- the repositories' CRUD methods genuinely invoke the Mongoose models (via
  call-tracking spies installed on the actual model methods), including reads,
  updates (`findByIdAndUpdate`) and deletes (`findByIdAndDelete`);
- the Mongo fallback works with the repair tables missing;
- no PG row is written while the Mongo fallback is active (no dual write);
- the services end-to-end invoke `create/findById/findOne/findMany/
  updateById/count/destroy` on the Mongo models;
- the seam flips back to PostgreSQL **within the same process** without
  restarting Node.

`backend/test/postgres-repairs.test.js` additionally asserts, on the PG path,
an exact row-count delta of one (one parent + two children for a ticket) and
`mongoose.connection.readyState === 0`.

## Migration tests

`backend/test/postgres-migrate.test.js` covers the full chain (now 18
migrations): fresh run applies 001–018, idempotent second run applies none,
rollback-and-reapply of migration 018 rebuilds all three tables + the child FK,
a deliberately failed migration rolls back with no recorded row and no partial
table/index, the real 018 tables remain intact after that failure, and the
child FK enforces valid/invalid references with CASCADE delete while
`asset_id` deliberately accepts a non-existent asset. All previous migration
files are unchanged.

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
18. `018_create_repairs.sql`
