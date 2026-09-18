# Phase 2Z — PostgreSQL Prasadam

Incremental, additive migration of the MongoDB **Prasadam** domain (the prasadam
*stock master*) to PostgreSQL, following the architecture established in Phases
2A–2Y.

There is exactly **one** Prasadam model in the repository —
`backend/src/models/Prasadam.js` (registered as the `Prasadam` Mongoose model).
It is the source of truth for this phase. The similarly named
`PrasadamOrder` model was already migrated in Phase 2G and is **not** touched
here; the two are distinct, unrelated entities.

## Scope

Only the Prasadam master is migrated in this phase:

- `backend/src/db/migrations/027_create_prasadams.sql`
- `backend/src/repositories/prasadamRepository.js`
- `backend/src/services/prasadamService.js`
- minimal call-site integration (`prasadamController.js`,
  `devoteeController.js`, `inventoryWorkflowController.js`)
- tests + documentation

**Not migrated:** Notifications, Events, Poojas, Settings, Audit Logs,
Attendance Setting / Attendance Location, Suppliers, Recipes, Tasks,
ShiftAssignment, CashClosing, SupportRequest, TransferRequest, Instructions,
RestockHistory, PoojaMaterialRequirement, and every entity already handled in
Phases 2A–2Y. The Prasadam **Order** ledger (2G) is unrelated to this phase and
is untouched. MongoDB is still present, Mongoose is still the fallback. No
production data migration, no dual writes and no global cutover happen here.

## Mongoose model inspected

`backend/src/models/Prasadam.js`:

```
name               String  required, trim, unique: true
price              Number  required, min 0
availableQuantity  Number  required, min 0, default 0
minimumStock       Number  required, min 0, default 0
```

`{ timestamps: true }` adds `createdAt` / `updatedAt`. A `status` **virtual**
(computed, not stored) is declared:

```js
if (this.availableQuantity === 0) return "Out Of Stock";
return this.availableQuantity <= this.minimumStock ? "Low Stock" : "Available";
```

`toJSON` / `toObject` set `virtuals: true`, so `status` appears in API responses.

The schema declares **no** embedded subdocuments, **no** arrays, and **no**
object references. `name` is the only indexed path (`unique: true`). There is no
soft-delete, archive, active or `isDeleted` field: the model has no delete
behaviour at all, and the controller performs a bare hard delete.

## Complete Mongo → PostgreSQL mapping

| Mongo field | PostgreSQL column | PostgreSQL type | Nullable? | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| `_id` (ObjectId) | `id` | `TEXT` | NO | generated (24-hex, ObjectId-shaped) | Project convention from Phases 2A–2Y |
| `name` | `name` | `TEXT` | NO | — | Required, trim, `unique: true` → `UNIQUE (name)` |
| `price` | `price` | `NUMERIC` | NO | — | Money, required, `min 0` |
| `availableQuantity` | `available_quantity` | `NUMERIC` | NO | `0` | Bare `Number`, `min 0`, `default 0` |
| `minimumStock` | `minimum_stock` | `NUMERIC` | NO | `0` | Bare `Number`, `min 0`, `default 0` |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | NO | `now()` | |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | NO | `now()` | Refreshed by every repository update |
| `status` (virtual) | — | — | — | — | **Not stored.** Recomputed on read |

Seven columns in total: `id` + the four schema fields + the two timestamps. The
model has no category, unit, description, image, SKU, supplier link, cost price,
expiry, batch link, creator/updater or archive flag, so none of those become
columns. Prasadam is a single-table, single-row domain — no child tables are
created.

## Money and quantity types

`price` is money and is `NUMERIC`, never `FLOAT`/`REAL`/`DOUBLE PRECISION`, so
rupee/paise values round-trip exactly (the Phase 2B–2Y convention). The Phase 2G
`prasadam_orders.unit_price` holds the value copied from this column at order
time, so both sides are `NUMERIC`.

`availableQuantity` and `minimumStock` are bare `Number` with no integer cast,
and every write path coerces with `Number(value) || 0`. A fractional quantity is
therefore legal and persisted today, so `NUMERIC` is used rather than `INTEGER` —
the same precedent as `events.slots`, `rooms.capacity` and
`prasadam_orders.quantity`. An `INTEGER` column would reject or silently round a
value the current API accepts.

## `min: 0` — a deliberate divergence from a CHECK constraint

The Mongoose schema declares `min: 0` for `price`, `availableQuantity` and
`minimumStock`. Those validators run on `create` and on `save()`, but
`prasadamController.updatePrasadam` calls
`findByIdAndUpdate(id, payload, { new: true })` **without** `runValidators`, so a
negative value is reachable through `PUT /api/prasadam/:id` today and **does**
persist in MongoDB.

A `>= 0` CHECK constraint would therefore make the PostgreSQL path stricter than
the application: a write the API accepts today would start failing. No `>= 0`
CHECK is created. The schema minimum is enforced by the repository instead, at
exactly the points the Mongoose validators run:

| Path | Mongoose behaviour | PostgreSQL behaviour |
| --- | --- | --- |
| create (`Prasadam.create`) | validators run → `min: 0` enforced | `assertMinZero` in `toRow`/`validate` |
| restock (`availableQuantity += n`, `save()`) | validators run | guarded atomic `UPDATE` |
| order decrement (`availableQuantity -= n`, `save()`) | validators run → negative result throws | guarded atomic `UPDATE` raising the same `ValidationError` |
| payment decrement (`Math.max(0, …)`, `save()`) | validators run, result clamped | `GREATEST(0, available_quantity + $1)` |
| `updateById` (`findByIdAndUpdate`, no `runValidators`) | validators do **not** run | no minimum check — mirrors Mongo |

This mirrors both real paths exactly; no rule is added or removed.

One `CHECK` *is* created: `name <> ''`. Mongoose `trim: true` runs before the
`required: true` check, so a whitespace-only name is already rejected there; the
repository trims before insert, so this constraint narrows no value the
application can currently persist.

## Unique-name semantics

`name` is `unique: true`, and `prasadamController.createPrasadam` answers a
Mongo duplicate-key error (`code === 11000`) with HTTP 409. The `UNIQUE (name)`
constraint preserves that: a duplicate insert raises `23505`, which
`prasadamService`/`prasadamRepository` re-map to the same `11000`-shaped error,
so the controller's existing 409 branch is untouched. Nothing is silently
replaced or upserted. The same mapping applies on `updateById`, where renaming a
row onto an existing name raises the same error.

The constraint also serves the standing listing sort
(`Prasadam.find().sort({ name: 1 })`). No further index is added: no query
filters or sorts on `price` / `availableQuantity` / `minimumStock`, and the UI
filters client-side.

## Relationships

Prasadam declares **no** outbound reference field, so `prasadams` has no foreign
key. There is likewise **no inbound FK**, because the links that exist are
name-based `String` values rather than ids:

| Link | Current Mongo behaviour | FK in 2Z |
| --- | --- | --- |
| `PrasadamOrder.itemName` → `Prasadam.name` | Orders match the master by name, case-insensitively, and keep their own denormalized `itemName` copy | **No** |
| `Recipe.name` → `Prasadam.name` | `logKitchenProduction` matches the master by exact name | **No** |
| `inventory_items` / `inventory_batches` / `purchase_orders` / `goods_received_notes` / `bills` / `poojas` / `sevas` | No field on Prasadam references any of these, and nothing references `prasadams` | **No** |

A name is not a stable key — it is mutable on the master and every consumer
keeps its own copy — so it cannot be expressed as a foreign key without changing
behaviour. Inventing one from a same-looking `String` would be speculative, so
no FK is created in either direction and no `ON DELETE` behaviour is invented.

`deletePrasadam` is a bare hard delete with no cascading cleanup anywhere in the
application, which the repository preserves. No `ON DELETE CASCADE` is used.

## Migration

`027_create_prasadams.sql` creates `prasadams` with the seven columns, the
`UNIQUE (name)` constraint and the `name <> ''` CHECK. It is additive and
idempotent (`CREATE TABLE IF NOT EXISTS`), so it applies cleanly on a fresh
database and re-applies cleanly after being rolled back.

**Migration number.** Phase 2Y (`phase-2y-postgres-poojas`, PR #27) claimed
`026_create_poojas.sql` and has since merged, so the next free number on `main`
was `027`. `027_create_prasadams.sql` is therefore used. The two migrations use
different numbers and different tables, so they never collide regardless of merge
order.

Rollback follows the project convention: drop the table (and its
`schema_migrations` row) and re-run `npm run db:migrate`, which re-applies only
this migration.

## Repository and service

`prasadamRepository.js` implements only the operations the application performs:
`findById`, `findMany`, `findOneByName`, `create`, `updateById`,
`incrementById` and `destroy`, plus `computeStatus` and `validate`. Every value
is bound as a query parameter and sort/filter keys are whitelisted, so nothing is
interpolated into the SQL. `limit`/`offset` preserve the existing pagination
semantics (no current Prasadam query paginates).

`findOneByName` supports the two real call sites with deliberately different
matching: `devoteeController` matches the item with `/^<itemName>$/i` (exact,
case-insensitive → `lower(name) = lower($1)`), while
`inventoryWorkflowController.logKitchenProduction` matches `{ name: recipe.name }`
(exact, case-sensitive → `name = $1`). A literal comparison is used rather than a
regex, so a name containing regex metacharacters is matched literally instead of
being reinterpreted as a pattern.

`prasadamService.js` owns the datasource selection. `usePostgres()` reads
`dbConfig.isDbConnected()` **at call time** (never a require-time destructure, so
tests can swap the seam) and additionally confirms PostgreSQL is reachable. When
PostgreSQL is selected the service delegates to the repository; otherwise it
falls back to the existing `Prasadam` Mongoose model. A single operation writes
to exactly one datasource — there are no dual writes.

The service also normalizes a Mongoose document and a repository row to the same
plain shape, so each controller response body is identical on both paths and the
`status` virtual is always present.

## Preserved business behaviour

- `status` is recomputed on read and never stored (`Out Of Stock` at 0,
  `Low Stock` at `<= minimumStock`, otherwise `Available`).
- The listing keeps `find().sort({ name: 1 })` and the `{ success, items }`
  response shape.
- `create` keeps its 400 (missing name) and 409 (duplicate name) responses and
  the devotee/staff notification side-effects.
- `update` keeps the price-change broadcast notification and the low-stock staff
  notification, including the `min: 0`-bypassing `findByIdAndUpdate` semantics.
- `restock` adds and returns `{ success, message, item }` with the message
  `Prasadam restocked successfully`.
- `delete` remains a hard delete returning `Prasadam deleted successfully.`, and
  404 `Prasadam not found.` when nothing was removed.
- The devotee order flow decrements the master by `normalizedQty` after the order
  is created, and the payment-verification flow decrements with a zero floor.
  Both keep their low-stock broadcast notifications.

### Out-of-scope findings (documented, not fixed)

`inventoryWorkflowController.logKitchenProduction` sets
`prasadamRecord.availableStock = …` on the matched Prasadam document.
`availableStock` is **not** a field on the Prasadam schema, so under Mongoose
strict mode this assignment persists nothing — it is a pre-existing no-op. This
phase preserves it verbatim (the assignment stays in memory, and `save()` is only
reached for a real Mongoose document) rather than inventing a stock column or
changing production behaviour.

`prasadamAdminController.js` requires `../models/Prasadam` but never uses it (its
`Prasadam`-named logic all targets `PrasadamOrder`, migrated in 2G). The import
is dead. It is left in place — removing an unused import is unrelated to this
phase — but it is **not** a remaining Prasadam data path.

Both are tracked as separate concerns outside Phase 2Z.

## Tests

- `test/postgres-prasadam-master.test.js` — the PostgreSQL path: complete field
  mapping, defaults, the `status` virtual (all three states plus "exactly at
  minimum"), listing sort and limit/offset, both name lookups (including regex
  metacharacters), updates, duplicate-name/11000 behaviour, stock movements
  (restock, decrement, clamped decrement, rejected negative decrement), hard
  delete, validation, `min: 0` on create vs its deliberate absence on update,
  money/quantity precision, constraints and indexes, no-dual-write assertions
  (Mongoose statics stubbed and must not be called; a PG write leaves no Mongo
  document behind), and the controller's response shapes.
- `test/postgres-prasadam-master-fallback.test.js` — the Mongo fallback: every
  repository operation routing to the exact Mongoose call (including the
  `/^name$/i` regex and `findByIdAndUpdate` without `runValidators`), working
  with no `prasadams` table, no dual writes, and the dynamic datasource seam
  (`PostgreSQL → MongoDB → PostgreSQL` in one process without a reload).
- `test/postgres-migrate.test.js` — the Phase 2Z migration block: column types,
  defaults, the unique/CHECK/FK constraint set, money and fractional-quantity
  precision, and migration rollback/re-apply. The applied-migration bookkeeping
  (`Applied 26 migration(s).`, the expected file list, `schema_migrations`
  counts) was updated for the new migration.
