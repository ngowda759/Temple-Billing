# Phase 2AC — Final PostgreSQL migration audit

Phase 2AC is an **audit**, not a migration. It does not remove MongoDB, does not
change datasource selection and does not perform a cutover. Its purpose is to
determine whether the application is actually ready for a future MongoDB →
PostgreSQL cutover, and to fix the defects that block a truthful answer.

The audit found that the repository **is not ready for cutover**. MongoDB remains
the live persistence layer for most domains. The PostgreSQL layer is broad and
largely correct, but most of it is not on the runtime path.

## What Phase 2AC changed

Three defects were fixed. Everything else in the audit is reported, not altered.

1. **Duplicate migration number.** `028_create_audit_logs.sql` and
   `028_create_settings.sql` shared the `028` prefix. The audit log migration was
   renumbered to `029_create_audit_logs.sql`. The runner sorts filenames, so both
   files did apply, but the collision made the intended order ambiguous and would
   have silently reordered the chain if either file were renamed. No SQL changed.
2. **Stale migration-count test expectations.** 18 assertions across
   `test/postgres-migrate.test.js` expected 28 migrations. With the renumbering
   there are 29. The two expected-file lists gained `029_create_audit_logs.sql`.
3. **PostgreSQL-version-specific error text.** PostgreSQL 18 reports a RESTRICT
   action as `violates RESTRICT setting of foreign key constraint`; the
   damage-note tests matched only the older `violates foreign key constraint`.
   The assertion now accepts either form.

Also fixed: `test/postgres-audit-logs.test.js` and
`test/postgres-audit-logs-fallback.test.js` existed on disk but were **not** in
the `npm test` file list, so audit-log coverage was not enforced. Both are now
registered (53 test files, all 53 run).

The stale counts in [postgres-migration.md](postgres-migration.md) (28
migrations / 44 tables / 51 test files) were corrected to 29 / 45 / 53.

## 1. Executive summary

MongoDB/Mongoose is still present everywhere and is still the live path for most
domains. Do **not** read the existence of a PostgreSQL table or a passing
PostgreSQL repository test as evidence that a domain is migrated: most of the
PostgreSQL repositories are unreachable from any mounted route.

Concretely:

- 44 Mongoose models remain registered.
- 36 PostgreSQL repositories exist, but **16 are unreachable at runtime** — they
  are imported only by services that no route reaches.
- 11 services are unreachable from every mounted route.
- 11 Mongoose models have **no** PostgreSQL repository at all.
- A third persistence tier exists: JSON file stores used by `authController` and
  `devoteeController`.
- 21 of 1002 tests failed before this phase; all 21 trace to the two defects
  above, not to broken migrations.

## 2. MongoDB inventory

MongoDB is read and written through 44 Mongoose models. The operations that
matter for cutover are the ones with no PostgreSQL equivalent:

| Location | Domain | MongoDB-only operation |
|---|---|---|
| `models/Booking.js` `pre("save")` | Bookings | Auto-generates `bookingNumber` (`PB`/`CB` prefix) by querying the collection. The PostgreSQL path has **no** generator. |
| `models/InventoryBatch.js` `pre("save")` | Inventory | Auto-transitions `status` when quantity hits 0 or expiry passes. Not replicated as a central rule. |
| `controllers/bookingController.js` | Bookings | `Booking.aggregate` for dashboard statistics. |
| `controllers/prasadamController.js` | Prasadam orders | Three `PrasadamOrder.aggregate` calls for reports and top-selling. |
| `controllers/inventoryItemController.js` | Inventory | Mongoose `startSession().withTransaction` for create and stock adjust. |
| `controllers/inventoryRequestController.js` | Inventory requests | Mongoose session transaction for issue. |
| `services/accountingService.js` | Accounting | `recordTransaction` writes `AccountTransaction` directly. |
| `utils/inventoryHelper.js` | Inventory | `addStock`/`deductStock` write `InventoryItem` and `InventoryLog` directly. |

No `bulkWrite` usage exists. `startSession`/`withTransaction` appears only in the
two controllers above. Direct `mongoose.Types.ObjectId` use is confined to
repositories that validate 24-hex string casts.

`models/Notification.js` has a `post("save")` hook that dispatches email. The
PostgreSQL branch reproduces this by calling the shared
`utils/notificationEmail.dispatchNotificationEmail`, so it is not a MongoDB-only
behaviour.

## 3. Mongoose model inventory

Repository presence is not runtime reachability. Status below distinguishes the
two.

**Migrated and live** (service reachable from a mounted route, both paths
tested): `Pooja`, `PoojaMaterialRequirement`, `Prasadam`, `PrasadamOrder`,
`InventoryConsumption`, `Asset`, `RepairRequest`, `RepairTicket`, `Room`,
`Attendance`, `AttendanceSetting`, `Leave`, `Shift`, `PayrollRecord`,
`Notification`, `Event`, `AuditLog`, `PriestSetting`.

**Migrated but not live** (PostgreSQL repository and service exist and pass
tests, but no route reaches them): `User`, `Employee`, `AccountHead`,
`AccountTransaction`, `Bill`, `Booking`, `Donation`, `PoojaBooking`,
`InventoryItem`, `InventoryBatch`, `InventoryLog`, `InventoryRequest`,
`PurchaseOrder`, `GoodsReceivedNote`, `DamageNote`.

**MongoDB-only, no PostgreSQL representation at all**:
`AttendanceLocation`, `CashClosing`, `Instruction`, `InventoryIssue`, `Recipe`,
`RestockHistory`, `ShiftAssignment`, `Supplier`, `SupportRequest`, `Task`,
`TransferRequest`.

## 4. PostgreSQL inventory

29 migration files, 45 distinct tables, 149 indexes, 130 `CHECK` constraints,
761 `NOT NULL` columns. Types: 227 `TIMESTAMPTZ`, 247 `NUMERIC`, 25 `JSONB`,
27 `TEXT[]`. `ON DELETE` distribution: 33 `RESTRICT`, 21 `CASCADE`, 1 `SET NULL`,
7 bare.

The `CASCADE` uses are all genuine composition (child rows owned by a parent
document, such as `booking_items` → `bookings`). `RESTRICT` protects financial
and inventory references. There is no accidental cascade.

**Rollback.** The runner implements UP only; there are no down migrations. The
"rollback" tests simulate rollback by dropping the tables and deleting the
`schema_migrations` row, then re-running the chain. Re-apply works, which is the
property that matters today, but this is re-apply, not rollback, and it does not
exercise down-migration machinery. A production rollback capability does not
exist yet.

## 5. Domain migration matrix

| Domain | MongoDB path | PostgreSQL path | Status |
|---|---|---|---|
| Auth / Users / Employees | controllers write Mongoose directly | repositories exist but unreachable | NOT READY |
| Accounting | controllers + `accountingService` write Mongoose | repositories unreachable; `CashClosing` has no table | NOT READY |
| Billing | controller writes Mongoose | repositories unreachable | NOT READY |
| Bookings | controller writes Mongoose; dashboard aggregates | repositories unreachable; no `bookingNumber` generator | NOT READY |
| Donations | controller writes Mongoose | repository unreachable | NOT READY |
| Pooja bookings | controller writes Mongoose | repository unreachable | NOT READY |
| Poojas | service | live, both paths tested | READY |
| Pooja materials | service | live, both paths tested | READY |
| Prasadam | service | live, both paths tested | READY |
| Prasadam orders | service, but reports aggregate MongoDB | live for writes and list reads | NOT READY (report reads bypass) |
| Inventory items | controller + helper write Mongoose in sessions | service reachable only via `poojaService` | NOT READY |
| Inventory batches | written directly | repository unreachable | NOT READY |
| Inventory logs | helper + controller write Mongoose | repository unreachable | NOT READY |
| Inventory consumption | service | live, both paths tested | READY |
| Inventory requests | controller uses a Mongoose session for issue | service live for status updates | NOT READY (split persistence) |
| Inventory issues | controller writes Mongoose | no table | NOT READY |
| Procurement (PO / GRN / Recipe) | only caller is an unmounted controller | repositories unreachable | NOT READY |
| Damage notes | only caller is an unmounted controller | repository unreachable | NOT READY |
| Assets | service | live, both paths tested | READY |
| Repairs | service | live, both paths tested | READY |
| Rooms | service | live, both paths tested | READY |
| Attendance | service | live, both paths tested | READY |
| Attendance locations | controller writes Mongoose | no table | NOT READY |
| Leaves | service | live, both paths tested | READY |
| Shifts | service for `Shift` | `Shift` live; `ShiftAssignment` has no table | NOT READY |
| Payroll | service for `PayrollRecord` | `PayrollRecord` live; `Task` has no table | NOT READY |
| Notifications | service | live, both paths tested | READY |
| Events | service | live; statistics aggregate stays MongoDB | READY |
| Audit logs | service | live, both paths tested | READY |
| Settings | service | live, both paths tested | READY |
| Priest instructions | controller writes Mongoose | no table | NOT READY |
| Devotee support requests | controller writes Mongoose | no table | NOT READY |
| HR transfers | controller writes Mongoose | no table | NOT READY |
| Suppliers | controller writes Mongoose | no table | NOT READY |
| Restock history | controller writes Mongoose | no table | NOT READY |

## 6. Field-level issues

Field-by-field comparison of every Mongoose path against its PostgreSQL columns
found no dropped columns. Nested documents are preserved as `JSONB`
(`priest_checklist`, `snapshot_materials`, `current_duty`) and arrays are
normalised into child tables or `TEXT[]`. Money uses `NUMERIC`, so precision is
preserved; timestamps use `TIMESTAMPTZ` throughout.

The material discrepancies:

| Domain | Field | MongoDB | PostgreSQL | Risk |
|---|---|---|---|---|
| Bookings | `bookingNumber` | generated in `pre("save")` | nullable `TEXT`, no generator | High — new PostgreSQL rows get no number |
| Pooja bookings | `bookingNumber` | sequential by `createdAt` | generated by numeric-suffix ordering | Medium — ordering differs |
| Inventory batches | `status` | auto-transition on save | plain `TEXT` with CHECK | Medium — invariant no longer centralised |
| Prasadams | `availableQuantity` | Number with `min: 0` | `NUMERIC`, `min: 0` enforced in the repository, not a CHECK | Low — deliberate, documented in the migration |

## 7. Datasource audit

Selection runs through two seams: `isDbConnected()` in `src/config/db.js` (the
Mongoose ready-state) and `isPostgresConnected()` in `src/config/postgres.js`,
initialised at startup by `initPostgres()`.

Two consumption patterns coexist:

- **Call-time read** (49 files): `dbConfig.isDbConnected()` sees the live seam.
- **Require-time destructure** (22 files): `const { isDbConnected } =
  require("../config/db")` freezes the reference at module load. Because
  `isDbConnected` is a stable function that reads live state, this is not a
  production correctness bug — but it **breaks the test seam**, because tests pin
  the datasource by reassigning `dbConfig.isDbConnected`, which the 22
  destructured modules never observe. Datasource switching is therefore only
  testable for modules loaded after the pin.

The destructured group also gates differently: every repository gates on
`isDbConnected()` **only** and never consults `isPostgresConnected()`. The
call-time group gates on both. Two live services that use the destructure
(`prasadamOrderService`, `inventoryItemService`) additionally gate on
`isPostgresConnected`, so no live path trusts MongoDB's flag as proof that
PostgreSQL works. The asymmetry is a real cutover risk in the dead code, not a
live outage risk today.

Startup runs `connectDB()` then `initPostgres()`. If MongoDB is down, the
account seeding and ledger sync are skipped and auth falls back to the file
store. The MongoDB-only controllers have no equivalent fallback.

## 8. Dual-write audit

**No unintended dual writes were found on any reachable path.** Every repository
method is a strict either/or branch. The high count of both SQL and Mongoose
calls per file reflects both branches existing, not both executing.

One latent dual-write construct exists: `src/services/userEmployeeService.js`
mirrors writes to both databases. It is imported by zero files and unreachable
from every route, so it is inert — but it must be removed or fixed before it is
ever wired up.

`models/Notification.js`'s `post("save")` hook fires only on the Mongoose branch;
the PostgreSQL branch calls the shared dispatch helper directly.

## 9. Read/write consistency

Most migrated domains pair their reads and writes on the same datasource. The
exceptions:

- **Prasadam orders** — writes and list reads go to PostgreSQL, but reports and
  top-selling aggregate MongoDB.
- **Inventory requests** — issue uses a Mongoose session while status updates go
  through the live PostgreSQL service.
- **Inventory workflow** — `inventoryWorkflowController` mixes services and raw
  Mongoose writes, and is not mounted on any route.

## 10. Relationship / foreign-key audit

No foreign key references a missing table; the full chain applies cleanly. No
accidental `CASCADE` exists. `ON DELETE RESTRICT` is used deliberately where
financial or inventory integrity matters, and composition relationships cascade
correctly. `pooja_bookings` deliberately carries no foreign key to `bookings`
because the Mongoose model has no such field, and the migration honours that
rather than inventing a relationship.

## 11. Migration / rollback audit

UP was verified end to end against a clean database: 29 migrations applied, 29
`schema_migrations` rows, 45 distinct tables. All DDL uses `IF NOT EXISTS` and
the chain is re-runnable.

DOWN does not exist. This is the single largest gap for a real cutover.

## 12. Test coverage

Command: `npm test` in `backend/`.

| Result | Count |
|---|---|
| tests (before this phase) | 1002 |
| pass (before) | 979 |
| fail (before) | 21 |
| skipped (before) | 2 |
| tests (after this phase) | 1032 |
| pass (after) | 1030 |
| fail (after) | 0 |
| skipped (after) | 2 |

The 30 additional tests are the two audit-log files that were previously not
registered. The 2 skips are unchanged and pre-existing: two cross-datasource
"no MongoDB document left behind" checks skip when MongoDB is not running in the
test environment.

The 21 pre-existing failures were: 19 caused by the stale 28-vs-29 migration
count, and 2 caused by the PostgreSQL 18 RESTRICT error text.

**The most important coverage gap is structural, not a missing test.** Tests
exercise `bookingRepository`, `donationRepository`, `billRepository` and others
**directly**, and they pass — but the controllers that serve those routes never
touch those repositories. Passing repository tests therefore prove the
PostgreSQL implementations work in isolation; they do **not** prove the
application uses them.

## 13. Build / lint / type-check

The project defines no lint or type-check tooling — there is no ESLint config and
no `tsconfig`. Backend is plain JavaScript.

| Check | Result |
|---|---|
| `node --check` over `backend/src` and `backend/scripts` | pass, 0 syntax errors |
| `npm run build:frontend` | pass |
| `npm test` | pass after the fixes in this phase |
| `node src/db/migrate.js` on a clean database | pass, 29 applied |

## 14. Cutover readiness by domain

| Domain | Status | Evidence / Remaining work |
|---|---|---|
| Poojas | READY FOR CUTOVER | service live, both paths tested |
| Pooja materials | READY FOR CUTOVER | service live, both paths tested |
| Prasadam | READY FOR CUTOVER | service live, both paths tested |
| Prasadam orders | NOT READY FOR CUTOVER | report and top-selling reads aggregate MongoDB |
| Inventory consumption | READY FOR CUTOVER | service live, both paths tested |
| Assets | READY FOR CUTOVER | service live, both paths tested |
| Repairs | READY FOR CUTOVER | service live, both paths tested |
| Rooms | READY FOR CUTOVER | service live, both paths tested |
| Attendance | READY FOR CUTOVER | service live, both paths tested |
| Leaves | READY FOR CUTOVER | service live, both paths tested |
| Notifications | READY FOR CUTOVER | service live, both paths tested |
| Events | READY FOR CUTOVER | service live; statistics aggregate stays MongoDB |
| Audit logs | READY FOR CUTOVER | service live, both paths tested, tests now registered |
| Settings | READY FOR CUTOVER | service live, both paths tested |
| Bookings | NOT READY FOR CUTOVER | controller writes Mongoose; repository unreachable; no `bookingNumber` generator |
| Pooja bookings | NOT READY FOR CUTOVER | controller writes Mongoose; repository unreachable |
| Donations | NOT READY FOR CUTOVER | controller writes Mongoose; repository unreachable |
| Billing | NOT READY FOR CUTOVER | controller writes Mongoose; repository unreachable |
| Accounting | NOT READY FOR CUTOVER | controllers write Mongoose; repositories unreachable; `CashClosing` has no table |
| Auth / Users / Employees | NOT READY FOR CUTOVER | controllers write Mongoose; repositories reachable only via the unused `userEmployeeService` |
| Inventory items | NOT READY FOR CUTOVER | controller writes Mongoose in sessions |
| Inventory batches | NOT READY FOR CUTOVER | written directly; repository unreachable; status transition not replicated |
| Inventory logs | NOT READY FOR CUTOVER | written via `inventoryHelper`; repository unreachable |
| Inventory requests | NOT READY FOR CUTOVER | issue path uses a Mongoose session while status updates use PostgreSQL |
| Purchase orders | NOT READY FOR CUTOVER | only caller is an unmounted controller |
| Goods received notes | NOT READY FOR CUTOVER | only caller is an unmounted controller |
| Damage notes | NOT READY FOR CUTOVER | only caller is an unmounted controller |
| Shifts | NOT READY FOR CUTOVER | `ShiftAssignment` has no table |
| Payroll | NOT READY FOR CUTOVER | `Task` has no table |
| Attendance locations | NOT READY FOR CUTOVER | no table or repository exists |
| Inventory issues | NOT READY FOR CUTOVER | no table or repository exists |
| Suppliers | NOT READY FOR CUTOVER | no table or repository exists |
| Restock history | NOT READY FOR CUTOVER | no table or repository exists |
| Recipes | NOT READY FOR CUTOVER | no table or repository exists |
| Priest instructions | NOT READY FOR CUTOVER | no table or repository exists |
| Devotee support requests | NOT READY FOR CUTOVER | no table or repository exists |
| HR tasks | NOT READY FOR CUTOVER | no table or repository exists |
| HR transfer requests | NOT READY FOR CUTOVER | no table or repository exists |
| Shift assignments | NOT READY FOR CUTOVER | no table or repository exists |
| Cash closing | NOT READY FOR CUTOVER | no table or repository exists |

No scores, percentages or rankings are used. A domain is READY only when its
PostgreSQL path is reachable at runtime, complete, and tested.

## 15. Remaining work before MongoDB can be removed

Ordered so each step is verifiable before the next:

1. Unify the datasource seam: replace the 22 require-time destructures with
   call-time reads so datasource switching is testable.
2. Add a PostgreSQL reachability check to the repositories and services that
   currently gate on `isDbConnected()` alone.
3. Wire the already-migrated dead services into their controllers, starting with
   Bookings, Donations, Billing, Accounting and Pooja bookings, whose
   repositories are complete and tested but unreachable.
4. Route `recordTransaction` through `accountTransactionService` so accounting
   writes reach PostgreSQL. Payroll, inventory and prasadam all write the
   MongoDB ledger today.
5. Implement a `bookingNumber` generator on the PostgreSQL path.
6. Replicate the `InventoryBatch.status` transition on the PostgreSQL write path.
7. Resolve the `prasadamController` aggregate reads.
8. Move the `inventoryRequestController` issue path onto
   `inventoryRequestService`.
9. Build tables and repositories for the 11 MongoDB-only models, or explicitly
   declare them out of scope.
10. Remove or fix the `userEmployeeService` dual-write before wiring it up.
11. Add down migrations and a runner `down` command.
12. Add controller-level tests for the untested controllers so "migrated" is
    proven at the route level.
13. Retire the JSON file stores.

## 16. Files changed in Phase 2AC

- `backend/src/db/migrations/029_create_audit_logs.sql` (renamed from
  `028_create_audit_logs.sql`; header note added, SQL unchanged)
- `backend/test/postgres-migrate.test.js` (migration counts 28 → 29, two
  expected-file lists gained the renumbered file)
- `backend/test/postgres-damage-notes.test.js` (RESTRICT error text accepts both
  PostgreSQL forms)
- `backend/package.json` (registered the two audit-log test files)
- `docs/postgres-migration.md` (corrected counts, added the 2AB row)
- `docs/postgres-final-audit-phase-2ac.md` (this document)

No MongoDB model, repository, service, controller or datasource-selection code
was modified. No data was migrated and no cutover was performed.
