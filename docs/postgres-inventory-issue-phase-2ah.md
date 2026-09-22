# Phase 2AH — InventoryIssue Mongo-only model gap audit

Phase 2AH is an **audit only**. It does not migrate `InventoryIssue`, does not
remove MongoDB, does not change datasource selection and does not perform a
cutover. No migration, repository, service, controller, route, model or schema
was created or modified by this phase.

The audit answers one question: is `InventoryIssue` a distinct live business
domain that should be migrated to PostgreSQL, an existing/duplicated domain
already represented elsewhere, or a legacy/dead Mongo-only model that does not
currently require migration?

**Finding: `InventoryIssue` is a LIVE, DISTINCT domain. Recommendation:
OPTION A — migrate it in a future, separately approved phase.**

A secondary finding is that the current application **refuses to issue a
PostgreSQL-backed Inventory Request** (HTTP 409) precisely because issuing writes
an `InventoryIssue` row and PostgreSQL has no `inventory_issues` table. Until
`InventoryIssue` is migrated, the Phase 2L Inventory Request migration is
functionally incomplete for its final step.

## 1. Mongo schema

`backend/src/models/InventoryIssue.js` (61 lines):

```js
const inventoryIssueSchema = new mongoose.Schema(
  {
    request:  { type: mongoose.Schema.Types.ObjectId, ref: "InventoryRequest" },
    item:     { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    itemName: { type: String, required: true },
    userId:   { type: String, required: true, index: true },
    userName: { type: String, required: true },
    role:     { type: String, required: true },
    issuedQuantity: { type: Number, required: true, min: 0 },
    unit:     { type: String, required: true },
    issueDate:{ type: Date, default: Date.now },
    issuedBy: { type: String, required: true },
    purpose:  { type: String, default: "" },
    status:   { type: String, enum: ["Active", "Completed"], default: "Active" },
  },
  { timestamps: true }
);
module.exports = mongoose.model("InventoryIssue", inventoryIssueSchema);
```

| Aspect | Finding |
|---|---|
| Fields | `request`, `item`, `itemName`, `userId`, `userName`, `role`, `issuedQuantity`, `unit`, `issueDate`, `issuedBy`, `purpose`, `status` |
| Types | 2 × ObjectId ref, 8 × String, 1 × Number, 1 × Date |
| Required | `item`, `itemName`, `userId`, `userName`, `role`, `issuedQuantity`, `unit`, `issuedBy` |
| Optional | `request` (no `required`), `issueDate` (default `Date.now`), `purpose` (default `""`), `status` (default `"Active"`) |
| Defaults | `issueDate` → now, `purpose` → `""`, `status` → `"Active"` |
| Enum | `status ∈ {"Active", "Completed"}` — the only enum in the schema |
| `trim` / `lowercase` | **None** on any field. Compare `InventoryRequest`, which trims most strings. |
| Validation | Declarative only: required flags, `min: 0` on `issuedQuantity`, the status enum. No custom validators. |
| Indexes | `userId` (`index: true`, **non-unique**). Nothing else. |
| Unique constraints | **None.** No unique index at all. |
| ObjectId refs | `request` → `InventoryRequest` (optional), `item` → `InventoryItem` (required). `userId` is a plain String, **not** a User ref. |
| Timestamps | `{ timestamps: true }` → `createdAt`, `updatedAt` |
| Hooks / middleware | **None** — no `pre`/`post` save, `validate`, `remove` |
| Virtuals | **None** (unlike `InventoryItem`, which has a `status` virtual and `toJSON`/`toObject` virtuals) |
| Instance / static methods | **None** |
| Generated fields | **None** |
| Business logic in model | **None** — all quantity parsing, status transitions and authorization live in the controllers |

## 2. Complete usage inventory

### Model registration and model-level references

| File | Detail |
|---|---|
| `backend/src/models/InventoryIssue.js:61` | `mongoose.model("InventoryIssue", ...)` |
| `backend/src/models/InventoryConsumption.js:5-8` | `issue` ObjectId ref `"InventoryIssue"` |
| `backend/src/models/AccountTransaction.js:75` | `"InventoryIssue"` is an allowed `referenceModel` enum value |
| `backend/src/repositories/accountTransactionRepository.js:25` | same enum in `REFERENCE_MODELS` |
| `backend/src/db/migrations/003_create_accounting.sql:51` | same enum in the PG `reference_model` CHECK |

### Imports and direct runtime usage

| File:line | Operation |
|---|---|
| `backend/src/controllers/inventoryIssueController.js:1` | `require("../models/InventoryIssue")` |
| `backend/src/controllers/inventoryIssueController.js:11` | `InventoryIssue.find(query).sort({ issueDate: -1 })` |
| `backend/src/controllers/inventoryIssueController.js:31` | `InventoryIssue.findById(id)` |
| `backend/src/controllers/inventoryIssueController.js:59-60` | `issue.status = "Completed"; await issue.save()` |
| `backend/src/controllers/inventoryRequestController.js:13` | `require("../models/InventoryIssue")` |
| `backend/src/controllers/inventoryRequestController.js:332-343` | `InventoryIssue.create([{...}], { session })` inside `session.withTransaction` |

### Routes (all mounted and reachable)

| Route | File:line |
|---|---|
| `GET /api/staff/inventory-issues` | `backend/src/routes/staffRoutes.js:133` |
| `GET /api/staff/inventory-issues/:userId` | `backend/src/routes/staffRoutes.js:134` |
| `POST /api/staff/inventory-issues/:id/complete` | `backend/src/routes/staffRoutes.js:135` |
| `GET /api/priest/inventory-issues` | `backend/src/routes/priestRoutes.js:117` |
| `GET /api/priest/inventory-issues/:userId` | `backend/src/routes/priestRoutes.js:118` |
| `POST /api/priest/inventory-issues/:id/complete` | `backend/src/routes/priestRoutes.js:119` |
| `POST /api/admin/inventory-requests/:id/issue` (writes an issue) | `backend/src/routes/adminInventoryRoutes.js:46` |

Mounted in `backend/src/app.js:61` (`/api/staff`), `:69` (`/api/priest`),
`:65` (`/api/admin`).

### Frontend / API clients

| File:line | Detail |
|---|---|
| `frontend/src/pages/staff/StaffInventory.jsx:75` | `GET /staff/inventory-issues/${staffId}` |
| `frontend/src/pages/staff/StaffInventory.jsx:176` | `POST /staff/inventory-issues/${issueId}/complete` |
| `frontend/src/pages/staff/StaffInventory.jsx:480-572` | renders `issue._id`, `itemName`, `issuedQuantity`, `unit`, `issueDate`, `purpose`, `updatedAt`, `usedQuantity`, `returnedQuantity`, `remarks` |
| `frontend/src/pages/priest/PriestInventory.jsx:75,176` | identical priest-side calls |

### Services / repositories

- **No `inventoryIssueRepository.js`** and **no `inventoryIssueService.js`** exist.
  `InventoryIssue` is the last inventory entity with no datasource seam — it is
  100% Mongoose with no PostgreSQL path of any kind.
- `backend/src/services/inventoryConsumptionService.js:66-79` is called with
  `issue: issue._id`, tying the mode to this model.

### Tests

| File:line | Detail |
|---|---|
| `backend/test/postgres-inventory-request-issue.test.js:172,180,230,278` | requires the model and stubs `InventoryIssueModel.create` to pin the fallback transaction ordering |
| `backend/test/postgres-inventory-consumption.test.js:251` | asserts `inventory_consumptions.issue_id` has **no** FK because InventoryIssue is not migrated |

### Documentation / migration comments

`docs/postgres-final-audit-phase-2ac.md:99` lists `InventoryIssue` under
"MongoDB-only, no PostgreSQL representation at all". Also referenced in
`docs/postgres-supportrequest-phase-2ah-implementation.md:21,199`,
`docs/postgres-inventory-consumption-phase-2k.md:43-196`,
`docs/postgres-inventory-requests-phase-2l.md:40-116`,
`docs/postgres-migration.md:275`, `README.md:133`, and in comments at
`012_create_inventory_consumption.sql:29-30,69,107` and
`013_create_inventory_requests.sql:18`.

### Confirmed absent

No `insertMany`, `findOne`, `findOneAndUpdate`, `findByIdAndUpdate`,
`updateOne`, `deleteOne`, `findOneAndDelete`, `aggregate`, `populate`, direct
collection access, seed script, scheduled job, background job, report, export or
utility touching this model.

## 3. Runtime trace

### A. Issue creation — `POST /api/admin/inventory-requests/:id/issue`

```
adminInventoryRoutes.js:46   (authenticate + authorizeRoles("admin","superadmin"))
  → inventoryRequestController.issueInventoryRequest        :279
      → inventoryRequestService.usePostgres()               :283
          → if true AND request exists in PG → 409 REFUSAL  :283-294
      → mongoose.startSession() / session.withTransaction   :296-362
          → InventoryRequest.findById(id).session(session)  [Mongo]
          → InventoryItem.find({ name: i-regex }).session() [Mongo]
          → inventoryItem.save({ session })   // availableStock -= qty, issuedStock += qty
          → request.save({ session })         // status = 'Issued', issuedAt = now
          → InventoryIssue.create([{...}], { session })     [Mongo]  ← the write
          → createStaffNotification(...)                     [1-2 notifications]
```

Persistence: **MongoDB only**, deliberately. The whole operation must live in one
datasource because a Mongo session and a PostgreSQL pool cannot share one atomic
unit; no PostgreSQL row is written.

### B. Issue read / list — `GET /api/staff|priest/inventory-issues[/:userId]`

```
staffRoutes.js:133-134 | priestRoutes.js:117-118
  → inventoryIssueController.getInventoryIssues              :6
      → InventoryIssue.find(userId ? { userId } : {}).sort({ issueDate: -1 })   [Mongo]
      → res.json({ success: true, issues })
```

No pagination, no limit, no `populate`.

### C. Issue completion — `POST /api/staff|priest/inventory-issues/:id/complete`

```
staffRoutes.js:135 | priestRoutes.js:119
  → inventoryIssueController.completeUsage                   :19
      → InventoryIssue.findById(id)                          [Mongo]
      → guards: negatives / already Completed / used + returned !== issuedQuantity
      → InventoryItem.findById(issue.item)                   [Mongo]
      → item.save()   // issuedStock -= issuedQuantity, consumedStock += used, availableStock += returned
      → issue.status = 'Completed'; issue.save()             [Mongo]
      → inventoryConsumptionService.create({ issue: issue._id, ... })
                                                             [PG seam OR Mongoose]
```

The issue lifecycle stays on Mongo while the **derived** consumption record
already has a PostgreSQL path (Phase 2K, `inventory_consumptions.issue_id`,
plain TEXT, no FK).

### D. Admin consumption report

`GET /api/admin/inventory/reports/consumption` → `inventoryConsumptionService.findMany`.
It does not read `InventoryIssue` directly.

### Reachability classification

`InventoryIssue` is **directly reachable from mounted API routes** (staff, priest,
admin). It is not reachable only indirectly, is not admin-only, and is not
confined to background jobs, scripts or tests — although it *is* also exercised by
tests. It is the only inventory entity with no service/repository abstraction.

### Authorization (observed, not changed)

`adminInventoryRoutes` is gated by `authenticate` + `authorizeRoles("admin","superadmin")`
(`adminInventoryRoutes.js:18-19`). The staff and priest `inventory-issues` routes
are declared directly on their routers at `staffRoutes.js:133-135` and
`priestRoutes.js:117-119` with no per-route middleware in those files. Whether a
router-level guard exists is outside this audit's scope; recorded as an
observation only.

## 4. Existing PostgreSQL overlap analysis

PostgreSQL inventory tables present: `inventory_items` (009),
`inventory_batches` (010), `inventory_logs` (011), `inventory_consumptions`
(012), `inventory_requests` (013), `purchase_orders` (014),
`goods_received_notes` (015), `damage_notes` (016). **There is no
`inventory_issues` table** — asserted explicitly in
`backend/test/postgres-inventory-request-issue.test.js:156-164`.

| # | Question | Answer |
|---|---|---|
| 1 | Inventory request fulfillment record? | **Partially.** Created by the fulfillment flow and back-references `request`, but it is a separate lifecycle entity (Active → Completed) with its own actor and quantity semantics, not a state flag on the request. |
| 2 | Inventory consumption record? | **No — it is the antecedent.** `InventoryConsumption` is created *from* a completed issue and is documented as importing `unit` "from the InventoryIssue at write time" (`012_create_inventory_consumption.sql:129`). |
| 3 | Inventory movement / transaction? | **No.** `InventoryLog` (enum includes `"Issue"`) is the movement ledger, and no code path writes an `InventoryLog` when an issue is created or completed. The two are disjoint. |
| 4 | Inventory audit / log record? | **No** — an operational work item, not an audit entry. |
| 5 | Issue / dispatch record? | **Yes.** This is its primary identity: what was issued, to whom, by whom, how much, for what purpose, and whether usage has been reconciled. |
| 6 | Damage / write-off record? | **No** — that is `DamageNote` / `inventory_items.damagedStock`. |
| 7 | Simply historical / legacy? | **No** — actively written and read by current routes and UI. |
| 8 | Duplicated by the InventoryRequest issue workflow? | **Partially overlapped, not duplicated.** The request's `status = 'Issued'` + `issuedAt` capture the *decision*; the issue captures the *event* (its own id, `issuedBy`, `issuedQuantity`, `unit`, `purpose`, `issueDate`, and the reconciliation state). Only `InventoryIssue._id` can answer "which issue is this consumption for?". |
| 9 | Does an existing PG table contain equivalent information? | **No.** The closest is `inventory_requests`, but it is missing four load-bearing columns and its own id. |

Treating `inventory_requests(status='Issued')` as the representation (OPTION B)
was considered and rejected:

1. It cannot supply the `issue_id` that `inventory_consumptions.issue_id` is
   designed to hold — a request id is not an issue id.
2. It cannot represent multiple issues (or a re-issue) per request.
3. It cannot represent the `Active` → `Completed` lifecycle, `issuedBy`, or the
   used/returned reconciliation fields.
4. It cannot represent issue rows whose `request` is null (the field is optional,
   so ad-hoc issues are schema-legal).

## 5. Field-level overlap table

| InventoryIssue Concept | Existing PG Domain | Equivalent Field/Workflow | Overlap | Action |
|---|---|---|---|---|
| `request` (ref InventoryRequest) | `inventory_requests` | `inventory_requests.id`, `status='Issued'`, `issued_at` | **Partial** — records the fulfillment decision, not the issue event | Future: nullable `request_id TEXT` (no FK yet, see §8) |
| `item` (ref InventoryItem) | `inventory_items` | `inventory_items.id` | **Full** — genuine referential relationship | Future: real FK, `ON DELETE RESTRICT` |
| `itemName` | `inventory_items` | `name` (denormalized copy) | **Full** | Future: `item_name TEXT NOT NULL` |
| `userId` | `inventory_requests` | `user_id` (plain TEXT username) | **Partial** — same convention, no FK | Future: `user_id TEXT NOT NULL` + index |
| `userName` | `inventory_requests` | `user_name` | **Full** | Future: `user_name TEXT NOT NULL` |
| `role` | `inventory_requests` | `role` (free-form) | **Full** | Future: `role TEXT NOT NULL` |
| `issuedQuantity` | `inventory_items` | `issuedStock` (aggregate counter only) | **Not equivalent** — no per-issue quantity in any PG table | Future: `issued_quantity NUMERIC NOT NULL CHECK (>= 0)` |
| `unit` | `inventory_items` | `unit` (enum on the item) | **Partial** — the issue stores a free-form snapshot | Future: `unit TEXT NOT NULL` (no CHECK, mirror Mongo) |
| `issueDate` | `inventory_requests` | `issued_at` | **Partial** — request timestamp only, no issue-row timestamp | Future: `issue_date TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `issuedBy` | — | **None** | **No overlap** — no PG table records the issuing actor | Future: `issued_by TEXT NOT NULL` |
| `purpose` | `inventory_requests` | `purpose` | **Partial** | Future: `purpose TEXT NOT NULL DEFAULT ''` |
| `status` Active/Completed | — | **None** — `inventory_requests.status` is `[Pending, Approved, Rejected, Issued]`, with no Active/Completed | **No overlap** | Future: `status TEXT NOT NULL DEFAULT 'Active'` CHECK IN ('Active','Completed') |
| `createdAt` / `updatedAt` | — | timestamps | **Full (convention)** | Future: `TIMESTAMPTZ` |
| issue → consumption derivation | `inventory_consumptions` | `issue_id` (plain TEXT, explicitly no FK today) | **Downstream consumer awaiting the parent table** | Future: gives this column a real target |

`inventory_items` and `inventory_requests` cover the stock and decision
dimensions. **`issuedQuantity`, `issuedBy` and the `Active`/`Completed` lifecycle
have no PostgreSQL representation at all.**

## 6. Actual Mongo behaviour

### CREATE

`inventoryIssueController` never creates issues; creation happens only in
`inventoryRequestController.issueInventoryRequest:332-343`:

- `InventoryIssue.create([{...}], { session })` — always an array document, and
  always inside the request's single Mongo transaction.
- Required fields supplied: `item`, `itemName`, `userId`, `userName`, `role`,
  `issuedQuantity`, `unit`, `issuedBy`.
- Defaults applied: `issueDate` → now, `purpose` → `""` when the request had
  none, `status` → `"Active"`.
- `issuedBy` = `req.user.name || req.user.id`, else `"Admin"`.
- `issuedQuantity` = `parseFloat(request.quantity)`.
- `purpose` = `request.purpose || request.reason`.
- Validation is Mongoose's declarative set; there is no separate app-level
  validation of the issue payload beyond the upstream request checks.
- Side effects in the same transaction: `InventoryItem.availableStock -= qty`,
  `issuedStock += qty`, request → `Issued`, plus notifications.

### READ

- `find(userId ? { userId } : {}).sort({ issueDate: -1 })`.
- No pagination, no limit, no `populate`.
- `userId` is indexed and serves the filter; `issueDate` is **not** indexed, so
  the sort is in-memory.

### UPDATE

- Only `completeUsage` mutates an issue: `issue.status = "Completed"` then
  `save()`.
- Guards: negative quantities → 400; already `Completed` → 400;
  `parsedUsed + parsedReturned !== issuedQuantity` → 400.
- The denominator equality is **strict** (`!==`) against `issuedQuantity` — a
  float comparison. No other field is mutable through the API.
- Stock side effects: `issuedStock -= issuedQuantity`, `consumedStock += used`,
  `availableStock += returned`.
- `updatedAt` is auto-touched; no other timestamp changes.

### DELETE

- **Not supported anywhere.** No `deleteOne`, `findOneAndDelete` or
  `findByIdAndDelete` call and no delete route. Hard delete would be possible via
  the model but is never invoked, so there is no soft-delete flag either.

### Other runtime characteristics

| Aspect | Behaviour |
|---|---|
| Authorization | admin/superadmin gate the issuance route; staff/priest routers expose the read + complete routes |
| Error behaviour | `500` with `error.message`; `404` missing issue/item; `400` validation; **`409`** for the PG-backed-request refusal |
| ID format | Mongo ObjectId (24-hex), referenced as plain TEXT by `inventory_consumptions.issue_id` |
| Relationships | `request` → InventoryRequest (optional), `item` → InventoryItem (required), `userId` plain String (not a User ref) |
| Duplicate handling | **None** at model or DB level — no unique index, no idempotence guard |
| Quantity semantics | `Number`, `min: 0`, fractional allowed (`parseFloat`) |
| Status semantics | `Active` = issued and awaiting reconciliation; `Completed` = usage logged |
| Transactions | creation participates in one Mongo multi-document transaction; completion is a plain sequential save (not transactional) |

Two observations, recorded but **not** acted on:

- `AccountTransaction.referenceModel = "InventoryIssue"` is enum-legal, yet no
  code path ever writes an `AccountTransaction` referencing an issue (only the
  enum declaration and validators exist).
- The frontend filters issues by `status === "Issued"` / `"Consumed"`
  (`StaffInventory.jsx:117-118`), values that never match the actual
  `["Active","Completed"]` enum. This is a pre-existing frontend inconsistency,
  unrelated to the migration question.

## 7. Data migration impact (planning only — nothing performed)

| Aspect | Finding |
|---|---|
| Approximate volume | **Not discoverable** from the repository — no seeds, fixtures or document counts, and no live DB access. Must be measured at migration time (`db.inventoryissues.countDocuments()`). |
| ID format | Mongo ObjectId (24-hex). `inventory_consumptions.issue_id` already stores these as plain TEXT, so a `id TEXT` strategy preserving the ObjectId hex keeps existing references resolvable with **no** change to `inventory_consumptions`. |
| References from other Mongo documents | Only `InventoryConsumption.issue` (ObjectId ref), already mirrored as `inventory_consumptions.issue_id`. |
| References from frontend / API clients | The UIs use `issue._id` for reads and the `:id/complete` call, so IDs must be preserved for parity. |
| Must IDs be preserved? | Yes, to keep `inventory_consumptions.issue_id` and the frontend working unchanged. |
| Overlap with existing PG inventory records | The issue entity itself does not overlap. A backfill must **not** fabricate issues from `inventory_requests(status='Issued')` where no Mongo issue exists. |
| Duplication risk | Low for the entity, but a backfill must **not** re-apply stock deltas — the deltas already happened in Mongo; the issue row is a record, not a new stock event. |
| Historical records requiring migration | Yes, for UI parity: the "Issued" tab must keep showing history, and issues are not reconstructible from `inventory_requests` (no `issuedBy`, no per-issue quantity or status). |
| Backfill transformation | Shallow and mechanical: ObjectId → 24-hex TEXT, Strings → TEXT, Dates → TIMESTAMPTZ, `request` → nullable TEXT ref. No nested/embedded data. |

## 8. Recommendation: OPTION A — MIGRATE (future design only)

`InventoryIssue` is a distinct live domain carrying data and workflow found in no
PostgreSQL table, and it is the missing dependency blocking the Inventory Request
issue step from working on PostgreSQL.

### Proposed future design — NOT created in this phase

**Migration filename:** `backend/src/db/migrations/034_create_inventory_issues.sql`

**Table:** `inventory_issues`

| Column | Type | Nullability | Default | Source |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | — | `_id` (24-hex Mongo-compatible) |
| `request_id` | TEXT | **NULL** | — | `request` (optional ObjectId) |
| `inventory_item_id` | TEXT | NOT NULL, `REFERENCES inventory_items(id) ON DELETE RESTRICT` | — | `item` (required) |
| `item_name` | TEXT | NOT NULL | — | `itemName` |
| `user_id` | TEXT | NOT NULL | — | `userId` (String, not a User ref → no FK) |
| `user_name` | TEXT | NOT NULL | — | `userName` |
| `role` | TEXT | NOT NULL | — | `role` |
| `issued_quantity` | NUMERIC | NOT NULL, `CHECK (issued_quantity >= 0)` | — | `issuedQuantity` |
| `unit` | TEXT | NOT NULL | — | `unit` (free-form, no CHECK) |
| `issue_date` | TIMESTAMPTZ | NOT NULL | `now()` | `issueDate` |
| `issued_by` | TEXT | NOT NULL | — | `issuedBy` |
| `purpose` | TEXT | NOT NULL | `''` | `purpose` |
| `status` | TEXT | NOT NULL, `CHECK (status IN ('Active','Completed'))` | `'Active'` | `status` |
| `created_at` | TIMESTAMPTZ | NOT NULL | `now()` | `createdAt` |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `now()` | `updatedAt` |

**Indexes**

- `idx_inventory_issues_user_id (user_id)` — mirrors the Mongo `userId` index and
  serves both `inventory-issues[/:userId]` filters.
- `idx_inventory_issues_issue_date (issue_date DESC)` — serves the
  `.sort({ issueDate: -1 })` reads.
- `idx_inventory_issues_inventory_item_id (inventory_item_id)` — supports per-item
  inspection and the FK.

**Constraints and foreign keys (only where justified)**

- `inventory_item_id → inventory_items(id) ON DELETE RESTRICT` — `item` is a
  genuine required ref to the already-migrated Phase 2H table. RESTRICT matches
  the convention used by `inventory_consumptions`: Mongo silently leaves rows
  orphaned when an item is deleted, so PostgreSQL refuses the delete instead.
- `request_id → inventory_requests(id)`: **apply the same temporary exemption
  already granted to `inventory_consumptions.issue_id`.** Issue rows are written
  only on the Mongo path while the referenced request may live in either store; a
  hard FK today would reject legitimate issue rows whose request resides only in
  Mongo — the exact reason `012_create_inventory_consumption.sql:69-74` omitted
  the FK on the mirrored column. Recommended: add plain indexed TEXT now and
  promote it to a real FK in a later phase once issuance is fully on PostgreSQL.
  **This is the one compatibility caveat requiring explicit reviewer approval.**
- `user_id → users`: **no FK** — the Mongo schema declares it a String holding
  usernames, and `users` remains Mongo-backed as the source of truth.

**ID strategy:** `id TEXT PRIMARY KEY` with the 24-hex ObjectId, consistent with
Phases 2K/2L and required for `inventory_consumptions.issue_id` to keep resolving.

**Compatibility considerations**

- Migrating this table is what unblocks replacing the current `409` refusal in
  `issueInventoryRequest` (`inventoryRequestController.js:283-294`) with a real
  PostgreSQL issuance transaction, and lets `completeUsage` and
  `inventory_consumptions.issue_id` become fully PG-native.
- `InventoryIssue.status` and `inventory_requests.status` are different enums; a
  PostgreSQL issuance must continue to set the request to `Issued` and the issue
  to `Active` to preserve UI behaviour.
- No `InventoryLog` row is written for issues today; a future migration must
  **not** silently start writing one, as that would be a behaviour change.

**Recommended sequencing:** implement `inventory_issues` together with, or
immediately before, refactoring the issuance and completion handlers onto a
shared PostgreSQL transaction. Migrating the table alone would leave the `409`
refusal in place and gain nothing at runtime.

## 9. Files inspected

**Models:** `InventoryIssue.js`, `InventoryConsumption.js`, `InventoryRequest.js`,
`InventoryItem.js`, `InventoryLog.js`, `AccountTransaction.js`

**Controllers:** `inventoryIssueController.js`, `inventoryRequestController.js`

**Services:** `inventoryConsumptionService.js` (the repositories directory was
confirmed to contain no `inventoryIssueRepository.js`)

**Routes:** `staffRoutes.js`, `priestRoutes.js`, `adminInventoryRoutes.js`, `app.js`

**Migrations:** directory `001`–`033` listed; read in detail `003_create_accounting.sql`,
`012_create_inventory_consumption.sql`, `013_create_inventory_requests.sql`

**Repositories (reference):** `accountTransactionRepository.js`

**Frontend:** `StaffInventory.jsx`, `PriestInventory.jsx`; searched all of
`frontend/src`

**Tests:** `postgres-inventory-request-issue.test.js`,
`postgres-inventory-consumption.test.js`

**Docs:** `postgres-final-audit-phase-2ac.md`,
`postgres-supportrequest-phase-2ah-implementation.md`,
`postgres-inventory-consumption-phase-2k.md`,
`postgres-inventory-requests-phase-2l.md`, `postgres-migration.md`, `README.md`

**Global searches:** repo-wide `grep -rn "InventoryIssue"` across all extensions
(excluding `node_modules` and `package-lock.json`); repository and service
directory listings; `db/`, `data/` and `scratch/` sweeps.

## 10. Confirmation of no changes

`git status --porcelain` was empty at the end of the audit. No source file was
edited; no migration, repository, service, route or controller was created or
changed; no schema changed; no test changed; no database or production data
touched. The only file added by this phase is this audit document.
