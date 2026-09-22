# Phase 2AH — PostgreSQL Inventory Issues (implementation)

Incremental, additive migration of the MongoDB **InventoryIssue** domain to
PostgreSQL, following the architecture established in Phases 2A–2AA and the
audit in `docs/postgres-inventory-issue-phase-2ah.md` (PR #42, **Option A —
MIGRATE**).

The audit remains authoritative for the domain inventory; this document records
the implementation it recommended.

## Scope

Only the InventoryIssue domain is migrated in this phase:

- `backend/src/db/migrations/034_create_inventory_issues.sql`
- `backend/src/repositories/inventoryIssueRepository.js`
- `backend/src/services/inventoryIssueService.js`
- minimal datasource-aware integration in
  `backend/src/controllers/inventoryIssueController.js` and
  `backend/src/controllers/inventoryRequestController.js`
- optional PostgreSQL transaction-client plumbing threaded through the existing
  Inventory Request / Item / Consumption repositories and services
- tests + documentation

**Not migrated:** Notification, AttendanceLocation, Instruction, Recipe,
RestockHistory, ShiftAssignment, TransferRequest, or any other Mongo-only model.
The Mongoose `InventoryIssue` model is **kept**. MongoDB remains the fallback and
no production data is migrated, backfilled or cut over. No dual writes are
introduced.

## Pre-implementation re-verification

Every audit claim was re-checked against the repository before implementing.
The audit's table, indexes, enum, quantity CHECK and id strategy were implemented
verbatim. One audit caveat was honoured exactly as written:

- **`request_id` stays plain indexed TEXT with NO FK.** The audit flagged this as
  "the one compatibility caveat requiring explicit reviewer approval" and
  recommended the same temporary exemption already granted to
  `inventory_consumptions.issue_id`. That is what migration 034 does.

The FK on `inventory_item_id` uses **`ON DELETE RESTRICT`**, not `CASCADE`: Mongo's
`deleteInventoryItem` calls `InventoryItem.findByIdAndDelete(id)` with no issue
cleanup, so issues are left orphaned. A `CASCADE` would delete rows Mongo keeps —
`RESTRICT` refuses the delete instead, matching `inventory_consumptions`.

## Mongoose model inspected

`backend/src/models/InventoryIssue.js`:

```
request         ObjectId ref InventoryRequest   (optional, no required)
item            ObjectId ref InventoryItem      required
itemName        String                          required
userId          String                          required, index: true
userName        String                          required
role            String                          required
issuedQuantity  Number                          required, min: 0
unit            String                          required
issueDate       Date                            default Date.now
issuedBy        String                          required
purpose         String                          default ""
status          String  enum [Active, Completed] default "Active"   (not required)
                timestamps: true → createdAt, updatedAt
```

The only declared index is `userId: { index: true }` (ordinary, non-unique). No
unique constraint, no hook, no virtual, no sub-document, no embedded array.

## Table

`inventory_issues` — 15 columns (`id` + the 12 schema fields + two timestamps):

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `TEXT` | PK | — | 24-hex Mongo ObjectId |
| `request_id` | `TEXT` | NULL | — | optional ref; **plain indexed TEXT, no FK** |
| `inventory_item_id` | `TEXT` | NOT NULL | — | `REFERENCES inventory_items(id) ON DELETE RESTRICT` |
| `item_name` | `TEXT` | NOT NULL | — | |
| `user_id` | `TEXT` | NOT NULL | — | String username → **no FK** |
| `user_name` | `TEXT` | NOT NULL | — | |
| `role` | `TEXT` | NOT NULL | — | free-form |
| `issued_quantity` | `NUMERIC` | NOT NULL | — | `CHECK (issued_quantity >= 0)` |
| `unit` | `TEXT` | NOT NULL | — | free-form, no CHECK |
| `issue_date` | `TIMESTAMPTZ` | NOT NULL | `now()` | |
| `issued_by` | `TEXT` | NOT NULL | — | |
| `purpose` | `TEXT` | NOT NULL | `''` | |
| `status` | `TEXT` | NOT NULL | `'Active'` | `CHECK IN ('Active','Completed')` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |

Indexes: PK on `id`; `idx_inventory_issues_user_id (user_id)`;
`idx_inventory_issues_issue_date (issue_date DESC)`;
`idx_inventory_issues_inventory_item_id (inventory_item_id)`;
`idx_inventory_issues_request_id (request_id)`.

`NUMERIC` (not integer) preserves the Mongoose `Number` semantics: fractional
kitchen quantities round-trip and `1000.125` stays `1000.125`.

## Repository

`backend/src/repositories/inventoryIssueRepository.js` — mirrors the established
pattern (`query` from `../config/postgres`, `dbConfig.isDbConnected()` fallback,
`toDoc`/`toRow`, parameterized SQL, whitelisted sort columns, deterministic
ordering with an `id ASC` tie-breaker).

Only the operations with real runtime callers:

| Operation | Mirrors |
|---|---|
| `create` | `InventoryIssue.create({...}, { session })` — the only create path |
| `findMany` | `InventoryIssue.find(userId ? { userId } : {}).sort({ issueDate: -1 })` |
| `findById` | `InventoryIssue.findById(id)` (used by the completion flow) |
| `updateStatus` | `issue.status = 'Completed'; issue.save()` — the only mutation |

No speculative CRUD, no delete (the application has none), no repository-level
PostgreSQL probing. `toDoc` maps `_id → _id`/`id` and camelCase fields so the
staff/priest screens and `inventory_consumptions.issue_id` keep working unchanged.

## Service

`backend/src/services/inventoryIssueService.js` owns datasource selection:
PostgreSQL when `dbConfig.isDbConnected()` **and** `isPostgresConnected()`;
otherwise the existing Mongoose model. Exactly one datasource per operation, no
dual writes, Mongo fallback preserved.

Each read/write accepts an optional PostgreSQL transaction `client`, forwarded to
the repository only on the PG path. That is the seam used to enlist issue writes
in a caller-owned transaction without the repository ever probing connectivity.

## Controller integration

### Path A — CREATE (`inventoryRequestController.issueInventoryRequest`)

The previous artificial `409 "not yet available for requests stored in
PostgreSQL"` refusal is **removed**, because a complete PostgreSQL issuance path
is now implemented. The handler selects exactly one datasource:

- **PostgreSQL selected:** request transition, item stock movement and the
  InventoryIssue insert all run inside ONE `runInTransaction` unit of work on a
  single pooled client. Notifications fire **after** commit. If the request, item
  or issue store is unavailable on PostgreSQL, the handler refuses (500) rather
  than half-writing across datasources.
- **Mongo selected:** the pre-existing Mongo multi-document transaction
  (`mongoose.startSession`) runs unchanged and writes no PostgreSQL rows.

No Mongo session is ever mixed with PostgreSQL writes.

### Path B — COMPLETE (`inventoryIssueController.completeUsage`)

Datasource-aware. The handler asks the issue service which datasource is
selected, and refuses (500) if the item or consumption store is not on the same
datasource — preventing `PG InventoryIssue + Mongo InventoryItem` or the reverse.

- **PostgreSQL path:** ONE `runInTransaction` covers the issue read, the item
  stock update, the status change and the consumption insert.
- **Mongo path:** the original implementation, unchanged.

`getInventoryIssues` and `getConsumptionReports` now route through the services
instead of calling the Mongoose models directly (same response shapes, same
`issueDate DESC` ordering).

## Stock accounting preserved

Issue creation: `availableStock -= issuedQuantity`, `issuedStock += issuedQuantity`.
Completion: `issuedStock -= issuedQuantity`, `consumedStock += usedQuantity`,
`availableStock += returnedQuantity`. No `InventoryLog` writes were introduced, and
no stock movements are replayed during migration.

## Transaction / atomicity strategy

`runInTransaction(fn)` (existing `src/config/postgres.js`) checks out one pooled
client, `BEGIN`s, passes the client to `fn`, then `COMMIT`s — or `ROLLBACK`s on any
throw. The repositories gained an optional trailing `client` parameter that routes
`query` through that client, so every write in the unit of work shares one
connection. Existing single-statement callers are unaffected (the parameter is
optional and defaults to the pool).

## Tests

- `backend/test/postgres-inventory-issues.test.js` — 19 tests: migration
  shape/constraints/FK/indexes, ordering 033 → 034 + idempotency, id TEXT /
  ObjectId compatibility and `inventory_consumptions.issue_id` linkage,
  repository create/read/update, userId filtering, `issue_date DESC`, defaults,
  status enum, quantity `>= 0`, Mongo fallback, PostgreSQL selection,
  exactly-one-datasource, no dual writes, PG request → issue flow, PG completion
  stock effects, consumption linkage, invalid completion quantities,
  already-completed rejection, transaction rollback.
- `backend/test/postgres-inventory-request-issue.test.js` — updated from the old
  `409` refusal assertions to the implemented PostgreSQL issuance behavior plus a
  no-Mongo-write guard.
- `backend/test/postgres-migrate.test.js`, `test/postgres-support-requests.test.js`
  — migration count 33 → 34 and the new filename in the ordered chain.

## Confirmation

No Mongo data was migrated, backfilled or cut over. The Mongoose model and
fallback remain. No dual writes exist. No `request_id` FK, no `users` FK, no
`InventoryLog` redesign and no other Mongo-only model migration was introduced.
