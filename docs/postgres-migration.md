# PostgreSQL Migration — Index

This is the entry point for the MongoDB → PostgreSQL migration. It replaces the
original Phase 1 document, which described infrastructure only and said no
business reads or writes went through PostgreSQL. That is no longer true: many
entities now read and write PostgreSQL when it is configured and reachable.

## Why PostgreSQL?

The application originally depended entirely on MongoDB/Mongoose. PostgreSQL is
being introduced as an additional, production-ready data layer so models can be
migrated **one at a time** without a big-bang switchover.

**Core rules that still hold:**

- The migration is **additive**. MongoDB/Mongoose is still present everywhere and
  remains the fallback path for every entity.
- There are **no dual writes**. A single request takes either the PostgreSQL path
  or the Mongo path — never both.
- Every migrated entity keeps its Mongoose model. An unavailable or unreachable
  PostgreSQL can never take the app down or cause a partial write.

## Current status

**Migrations applied:** `backend/src/db/migrations/001`–`023` (23 files).
**PostgreSQL tables created:** 35 `CREATE TABLE` statements across those files
(this count includes the Phase 1 `pg_health` probe table; `schema_migrations` is
created by the runner itself, not by a migration file).
**Test files:** 41 under `backend/test/`. Most entities have a PostgreSQL-path
test plus a fallback test (from Phase 2G onward); four cover cross-cutting
concerns (config, migrate, health, repositories).

| Phase | Entity / area | Migration file(s) | Documentation |
|---|---|---|---|
| 1 | Infrastructure only: pool, migration runner, health probe. No business data. | `001_create_pg_health.sql` | this document |
| 2A | Users, Employees | `002_create_users_employees.sql` | summarised below |
| 2B | Account heads, Account transactions | `003_create_accounting.sql` | summarised below |
| 2C | Bills, Bill items | `004_create_bills.sql` | summarised below |
| 2D | Donations | `005_create_donations.sql` | summarised below |
| 2E | Bookings (+ history, material requests, items) | `006_create_bookings.sql` | summarised below |
| 2F | Pooja bookings (+ material requests) | `007_create_pooja_bookings.sql` | summarised below |
| 2G | Prasadam orders | `008_create_prasadam_orders.sql` | summarised below |
| 2H | Inventory items | `009_create_inventory_items.sql` | summarised below |
| 2I | Inventory batches | `010_create_inventory_batches.sql` | [phase 2I](postgres-inventory-batches-phase-2i.md) |
| 2J | Inventory logs | `011_create_inventory_logs.sql` | [phase 2J](postgres-inventory-logs-phase-2j.md) |
| 2K | Inventory consumption | `012_create_inventory_consumption.sql` | [phase 2K](postgres-inventory-consumption-phase-2k.md) |
| 2L | Inventory requests | `013_create_inventory_requests.sql` | [phase 2L](postgres-inventory-requests-phase-2l.md) |
| 2M | Purchase orders (+ items) | `014_create_purchase_orders.sql` | [phase 2M](postgres-purchase-orders-phase-2m.md) |
| 2N | Goods received notes (+ items) | `015_create_goods_received_notes.sql` | summarised below |
| 2O | Damage notes | `016_create_damage_notes.sql` | [phase 2O](postgres-damage-notes-phase-2o.md) |
| 2P | Assets (+ maintenance history) | `017_create_assets.sql` | [phase 2P](postgres-assets-phase-2p.md) |
| 2Q | Repair requests, Repair tickets (+ spare parts) | `018_create_repairs.sql` | [phase 2Q](postgres-repairs-phase-2q.md) |
| 2S | Attendance | `020_create_attendance.sql` | [phase 2S](postgres-attendance-phase-2s.md) |
| 2T | Leaves | `021_create_leaves.sql` | [phase 2T](postgres-leaves-phase-2t.md) |
| 2U | Shifts | `022_create_shifts.sql` | [phase 2U](postgres-shifts-phase-2u.md) |
| 2V | Payroll | `023_create_payroll_records.sql` | [phase 2V](postgres-payroll-phase-2v.md) |

Phases 2A–2H and 2N were implemented without a dedicated document. Their scope
is summarised in [Entities without a dedicated document](#entities-without-a-dedicated-document)
below; the migration SQL and repository files are the authoritative reference.

## Configuration

The backend reads PostgreSQL settings from environment variables (`backend/.env`):

- `DATABASE_URL` — connection URL, e.g.
  `postgresql://username:password@localhost:5432/temple_billing`
- Alternatively, individual `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` values.
- `POSTGRES_SSL` — set to `true` for hosted providers that require SSL (or pass
  `?sslmode=require` in `DATABASE_URL`). No credentials are hard-coded anywhere.
- `PG_CONNECT_TIMEOUT_MS` — optional connection timeout in ms (default `5000`).

`POSTGRES_SSL` alone does **not** enable PostgreSQL. A real connection target
(`DATABASE_URL` or at least one `PG*` value) must be present; otherwise
`initPostgres()` logs `PostgreSQL not configured; skipping connection.` and the
application runs on MongoDB only.

MongoDB settings (`MONGODB_URI`, `MONGO_CONNECT_TIMEOUT_MS`) are unchanged and
remain required.

## Running migrations

```bash
cd backend
cp .env.example .env # then set DATABASE_URL
npm install
npm run db:migrate
```

The runner (`backend/src/db/migrate.js`):

- Scans `src/db/migrations/` for `*.sql` files in filename order.
- Bootstraps a `schema_migrations` tracking table on first run.
- Takes a PostgreSQL advisory lock (`727271701`) so concurrent runners exclude
  each other.
- Applies each pending migration inside a transaction and records its filename.
- Re-running is safe: applied migrations are skipped, nothing is duplicated.
- A failed migration rolls back that migration and exits with a non-zero code
  showing which file failed.

## Verifying connectivity

```bash
npm run db:verify
```

Or via HTTP:

```bash
curl http://localhost:5000/api/health
# -> { "status": "ok", "service": "temple-billing-backend", "postgres": "connected" }
```

`GET /api/health` reports `postgres` as `connected` or `unavailable`. It never
exposes credentials. Note that both application startup and the health probe
swallow connection errors and report `unavailable` rather than failing, which is
intentional so a missing PostgreSQL does not stop the app.

## How the datasource is selected

Every migrated entity lives in three layers:

```
Controller  →  Service  →  ├─ Repository  →  PostgreSQL
                           └─ Mongoose model (fallback)
```

The service owns the selection. **Two different gates exist**, and they are not
equivalent — this matters when reasoning about behaviour:

**Gate A — Mongo-connectivity only** (Phases 2A–2F: users/employees, accounting,
bills, donations, bookings, pooja bookings):

```js
const isConnected = () => isDbConnected(); // mongoose.connection.readyState === 1
```

PostgreSQL is used whenever MongoDB is connected. There is no separate
PostgreSQL reachability check.

**Gate B — Mongo connectivity *and* PostgreSQL reachability** (Phase 2G onward:
prasadam orders, inventory items/batches/logs/consumption/requests, purchase
orders, GRNs, damage notes, assets, repairs):

```js
const usePostgres = async () => {
  if (!isDbConnected()) return false;
  try {
    return await isPostgresConnected(); // SELECT 1 against the pool
  } catch {
    return false;
  }
};
```

Both conditions must hold, so an unreachable PostgreSQL falls back to Mongoose
even when MongoDB is up, and never causes a partial write.

`backend/test/*-fallback.test.js` pins `dbConfig.isDbConnected = () => false` to
force and prove the Mongo fallback deterministically. `backend/test/*.test.js`
(the PostgreSQL-path tests) pin it to `true` against a test database.

## Conventions used across all phases

These were established in Phase 2A and followed consistently since:

- **Primary keys are 24-hex `TEXT`** generated with
  `crypto.randomBytes(12).toString("hex")`, so they stay compatible with existing
  MongoDB ObjectId references held by non-migrated entities.
- **Money is `NUMERIC`** so rupee/paise values round-trip exactly.
- **Embedded arrays are normalised** into child tables with a `position` column
  that preserves the original array order.
- **No fake foreign keys.** A reference to an entity that is still Mongo-backed
  stays plain indexed `TEXT` with no FK. Real FKs are only added where the target
  table genuinely exists in PostgreSQL.
- **Enums are preserved exactly** from the Mongoose schema via `CHECK` constraints.
- **MongoDB field nullability/defaults are mirrored**, and where the Mongoose
  `min` differs from what the application actually enforces, the repository
  enforces the application's real semantics and the constraint documents the
  divergence.
- **Repositories return documents shaped like Mongoose documents** (`_id`, `id`,
  camelCase fields, `createdAt`/`updatedAt`) so controllers and the frontend need
  no changes.

## Entities without a dedicated document

**2A — Users, Employees** (`002_create_users_employees.sql`).
`users` mirrors `User.js` including `role`/`status`/`provider` CHECK enums,
`permissions`/`menu_access` as `TEXT[]`. `employees` mirrors `Employee.js`
including `current_duty` as `JSONB`, `face_descriptor` as `DOUBLE PRECISION[]`,
and soft-delete columns (`deleted_at`/`deleted_by`). Repositories:
`userRepository.js`, `employeeRepository.js`. Service: `userEmployeeService.js`.

**2B — Accounting** (`003_create_accounting.sql`).
`account_heads` (`type` IN `Income`/`Expense`) and `account_transactions`
(polymorphic `reference_id` + `reference_model`, `amount > 0` CHECK).
Repositories: `accountHeadRepository.js`, `accountTransactionRepository.js`.
Services: `accountHeadService.js`, `accountTransactionService.js`.

**2C — Bills** (`004_create_bills.sql`).
`bills` (`amount >= 1`) and `bill_items` normalised from the embedded
`items[]`, with a real FK `bill_items.bill_id → bills(id) ON DELETE CASCADE`.
Repositories: `billRepository.js`, `billItemRepository.js`. Service: `billService.js`.

**2D — Donations** (`005_create_donations.sql`).
`donations` with `amount > 0` and enum CHECKs matching `Donation.js`.
Repository: `donationRepository.js`. Service: `donationService.js`.

**2E — Bookings** (`006_create_bookings.sql`).
`bookings` plus three child tables (`booking_history`,
`booking_material_requests`, `booking_items`). `datetime` is deliberately `TEXT`
because the Mongoose schema stores it as a String. `snapshotMaterials[]` and
`priestChecklist` become `JSONB`; `poojaRules[]` becomes `TEXT[]`.
Repository: `bookingRepository.js`. Service: `bookingService.js`.

**2F — Pooja bookings** (`007_create_pooja_bookings.sql`).
`pooja_bookings` plus `pooja_booking_material_requests`. A speculative `unit`
column was deliberately dropped in `df8e25c`.
Repository: `poojaBookingRepository.js`. Service: `poojaBookingService.js`.

**2G — Prasadam orders** (`008_create_prasadam_orders.sql`).
`prasadam_orders` mirroring `PrasadamOrder.js` enums.
Repository: `prasadamOrderRepository.js`. Service: `prasadamOrderService.js`.
Helpers: `backend/src/utils/prasadamOrderHelper.js`. This is the first phase to
use Gate B (Mongo connectivity **and** PostgreSQL reachability).

**2H — Inventory items** (`009_create_inventory_items.sql`).
`inventory_items` with CHECK constraints aligned exactly to the Mongo schema
(commit `80cb350`). Repository: `inventoryItemRepository.js`. Service:
`inventoryItemService.js`.

**2N — Goods received notes** (`015_create_goods_received_notes.sql`).
`goods_received_notes` plus `goods_received_note_items`.
Repositories: `goodsReceivedNoteRepository.js`, `goodsReceivedNoteItemRepository.js`.
Service: `goodsReceivedNoteService.js`.

## Planned next steps

1. Migrate the remaining MongoDB entities: Attendance settings/locations,
   Payroll, Notifications, Events, Poojas, Prasadam, Settings, Audit Logs,
   InventoryIssue, Suppliers, Recipes, Tasks (and the legacy ShiftAssignment
   model, whose only consumer is the offline
   `backend/scripts/migrateShiftAssignments.js` script), CashClosing,
   SupportRequest, TransferRequest, Instructions, RestockHistory, and
   PoojaMaterialRequirement.
2. Backfill production data into the migrated tables.
3. Cut over each entity to PostgreSQL as the source of truth.
4. Remove Mongoose once every entity has moved.

Until an entity's own phase is complete and cut over, MongoDB remains the source
of truth for it.
