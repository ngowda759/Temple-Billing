# Phase 2R — PostgreSQL Rooms

Incremental, additive migration of the MongoDB **Room** domain to PostgreSQL,
following the architecture established in Phases 2A–2Q.

There is exactly **one** Room entity in the repository —
`backend/src/models/Room.js` — and it is the source of truth for this phase.

## Scope

Only the Room domain is migrated in this phase:

- `backend/src/db/migrations/019_create_rooms.sql`
- `backend/src/repositories/roomRepository.js`
- `backend/src/services/roomService.js`
- minimal route/controller integration (`backend/src/routes/roomRoutes.js`)
- minimal scheduler integration (`backend/src/app.js` background room job)
- tests + documentation

**Not migrated:** Poojas, Prasadam, Attendance, Leaves, Shifts, Payroll,
Notifications, Events, Settings, Audit Logs, Users/Employees (already 2A),
Accounting (2B), Bills (2C), Donations (2D), Bookings (2E), Pooja Bookings
(2F), Prasadam Orders (2G), Inventory Items/Batches/Logs/Consumption/Requests
(2H–2L), Purchase Orders (2M), Goods Received Notes (2N), Damage Notes (2O),
Assets (2P), Repairs (2Q), MongoDB (still present), Mongoose (still the
fallback). No Phase 2S work, no production data migration, no dual writes and
no global cutover happen here.

## Mongoose model inspected

`backend/src/models/Room.js`:

```
number       String   required, unique, trim
type         String   required, trim
block        String   trim
floor        String   trim
price        Number   required, min 0
capacity     Number   default 2
bedType      String   trim, default 'Double'
amenities    [String] default []
status       String   enum ['Available','Occupied','Maintenance'], default 'Available'
devotee      String   trim
phone        String   trim
days         Number
payMode      String   trim
checkinDate  Date
checkoutDate Date
timestamps:  true
```

The schema has **no** virtuals, **no** embedded sub-documents, and exactly
**one** index: `number { unique: true }`. Because the schema is strict by
default, every key the frontend sends that is not listed above is silently
discarded — verified by probing `Room.schema`.

Every real usage was read before designing the mapping:

- `backend/src/routes/roomRoutes.js`
  — `GET /` (`Room.find().sort({ number: 1 })`), `POST /`
  (`Room.findOne({ number })` duplicate guard, then `new Room({...}).save()`),
  `allotRoom` (`Room.findOne({ number })`, rejects when
  `status !== 'Available'`, computes `diffDays`/`totalAmount`, stamps
  `devotee/phone/days/payMode/checkinDate/checkoutDate` and
  `status: 'Occupied'`, then writes a `Booking` history row via Mongoose),
  `POST /checkout/:roomNumber` (`Room.findOne({ number })`, matches active
  bookings with a text regex over `Booking.service`, then unsets the guest
  fields and saves `status: 'Available'`),
  `PATCH /maintenance/:roomNumber` (toggles `Available ↔ Maintenance`, rejects
  an occupied room with HTTP 400),
  `DELETE /:roomNumber` (`Room.findOneAndDelete({ number })`).
- `backend/src/app.js` — the 60-second background room scheduler:
  auto-checkout (`{ status: 'Occupied', checkoutDate: { $lte: now } }` → unset
  guest fields, `status: 'Available'`) and auto check-in
  (`{ status: 'Available', checkinDate: { $lte: now }, checkoutDate: { $gt: now },
  devotee: { $exists: true, $ne: null } }` → `status: 'Occupied'`).
- `frontend/src/pages/admin/RoomAllotment.jsx` — the only frontend consumer;
  it calls all six endpoints above and renders
  number/type/block/floor/price/capacity/bedType/amenities/status/devotee/
  phone/checkinDate.

## Mongo → PostgreSQL field mapping — `rooms`

| Mongo field | PostgreSQL column | PostgreSQL type | Nullable? | Default? | Notes |
|---|---|---|---|---|---|
| `_id` | `id` | `TEXT` | NOT NULL (PK) | — | 24-hex ObjectId-compatible id |
| `number` | `number` | `TEXT` | NOT NULL | — | required, trim; **UNIQUE** (the sole Mongo unique index) |
| `type` | `type` | `TEXT` | NOT NULL | — | required, trim; free String, no enum in Mongo |
| `block` | `block` | `TEXT` | NULL | — | optional, trim |
| `floor` | `floor` | `TEXT` | NULL | — | optional, trim |
| `price` | `price` | `NUMERIC` | NOT NULL | — | required, `min: 0` → `CHECK (price >= 0)` |
| `capacity` | `capacity` | `NUMERIC` | NOT NULL | `2` | bare Number, no min, fractional values legal |
| `bedType` | `bed_type` | `TEXT` | NOT NULL | `'Double'` | free String, no enum |
| `amenities` | `amenities` | `TEXT[]` | NOT NULL | `ARRAY[]::TEXT[]` | `[String]`; kept as an array column (see nested-data decision) |
| `status` | `status` | `TEXT` | NOT NULL | `'Available'` | `CHECK IN ('Available','Occupied','Maintenance')` |
| `devotee` | `devotee` | `TEXT` | NULL | — | optional guest name |
| `phone` | `phone` | `TEXT` | NULL | — | optional guest phone |
| `days` | `days` | `NUMERIC` | NULL | — | optional; copies the `bookings.days` precedent |
| `payMode` | `pay_mode` | `TEXT` | NULL | — | optional; the `'UPI'` default is applied by the write path |
| `checkinDate` | `checkin_date` | `TIMESTAMPTZ` | NULL | — | optional |
| `checkoutDate` | `checkout_date` | `TIMESTAMPTZ` | NULL | — | optional |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | timestamps: true |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | timestamps: true |

Completeness: every persisted Mongo field has a column, and there are exactly
**18** columns — no field is invented. The Room model has no room code, no room
name, no building, no location, no room size/dimensions, no occupancy counter,
no bed counts, no extra-person charge, no security deposit, no
description/notes, no metadata, no `createdBy`/`updatedBy`, no facilities
table, no maintenance/repair reference and no booking/reservation reference.
The admin form does send `extraCharge`, `securityDeposit`, `roomSize`,
`totalBeds`, `totalExtraBeds`, `description`, `checkinTime`, `checkoutTime`,
`mealsIncluded`, `cancellationPolicy` and `isActive`, but the strict Mongoose
schema discards them, so they are deliberately **not** columns. A test asserts
both that the keys do not survive a round trip and that the columns do not
exist.

`required: true` on a trimmed String path also rejects the empty string in
Mongoose (trim runs before the required check), so `number`/`type`/`price` are
NOT NULL and the service rejects whitespace-only values. `price = 0` is legal
(`min: 0`) at every layer.

## Nested-data decision

`amenities` is the **only** repeating field on a Room, and Mongo declares it as
`[String]` — an array of plain scalars, not sub-documents with their own `_id`.

It is therefore kept as a PostgreSQL `TEXT[]` column rather than normalized
into a child table:

- the application always reads and writes the whole array atomically with the
  room document;
- nothing queries or updates an individual amenity;
- there is no per-amenity identity (`_id`), timestamp, or independent lifecycle.

This matches the existing convention for other `[String]` arrays
(`users.permissions` / `users.menu_access`, `bookings.pooja_rules`) and differs
from `asset_maintenance_history`, `repair_ticket_spare_parts` and `bill_items`,
which are real embedded sub-document arrays with their own identity and were
normalized in prior phases.

`JSONB` is not used anywhere in this table: the only list is a homogeneous
string array, not structured or dynamic metadata.

## Stored vs derived fields

Nothing is duplicated or newly derived:

- `status` **is stored** in Mongo (an enum column with a default) and the
  application reads availability directly from it
  (`if (room.status !== 'Available')`). It stays a stored column.
- `days` is **stored** by `allotRoom`; it is not recomputed on read.
- `price` is a stored nightly tariff. The booking total (`price × diffDays`) is
  computed at allot time and written to the **Booking** document, so no derived
  money column is introduced on `rooms`.

There is no availability model to preserve beyond the stored `status` value,
and none is invented.

## Enums (preserved exactly)

| Column | Values | Default |
|---|---|---|
| `rooms.status` | `Available`, `Occupied`, `Maintenance` | `'Available'` |

No CHECK is added for `number`, `type`, `block`, `floor`, `bed_type` or
`pay_mode` — Mongo declares none for them, and inventing one would change
existing semantics. `capacity` and `days` get no `>= 0` CHECK either, because
Mongo declares no `min` on them (`capacity = 0` and fractional values are
legal).

## Home of the semantics preserved

| Semantics | Preserved how |
|---|---|
| duplicate room number | `rooms_number_key` UNIQUE + the route's find-then-create guard; the PG path also maps the constraint violation back to the same HTTP 400 |
| availability | stored `status`; `allotRoom` rejects `status !== 'Available'` |
| occupancy | `status = 'Occupied'` plus the stored `devotee`/`phone`/`days`/`payMode`/`checkinDate`/`checkoutDate` guest fields |
| capacity | `NUMERIC`, fractional allowed, default 2 |
| room type | free-text `type`, trimmed, no enum |
| room numbering | `number` text, trimmed, unique |
| pricing | `price NUMERIC`, required, `>= 0` |
| checkout | `roomService.release()` unsets the guest fields and restores `'Available'` on both datasources |
| maintenance state | `PATCH /maintenance/:number` toggles the stored status; occupied rooms are still rejected |
| deletion | single-row delete, nothing cascades |
| search / filtering / sorting / pagination | repository filter surface + whitelisted sorts + `LIMIT`/`OFFSET` |
| validation | required/enum/money/number rules re-applied in the service and repository |

## Fallback boundary (explicit)

Entity-scoped, no global switch, no dual writes:

```
Room Service (roomService)
      |
      +-- PostgreSQL available (datasource seam connected AND isPostgresConnected())
      |        ↓
      |    roomRepository → rooms
      |
      +-- PostgreSQL unavailable (seam disconnected OR PG unreachable)
              ↓
          Mongoose Room model (unchanged Phase 1 path)
```

- `usePostgres()` returns true only when `dbConfig.isDbConnected()` **and**
  `isPostgresConnected()` succeed. If either fails, every operation routes to
  the existing Mongoose model, so an unavailable PostgreSQL can never take the
  app down.
- The datasource seam is read **at call time** through the module object
  (`dbConfig.isDbConnected()`), never destructured at require time, so tests
  (and any runtime flip) can switch datasource state in-process without
  restarting Node. This is the known stale-capture risk for
  `isDbConnected`, and the fallback suite tests it explicitly by flipping the
  seam back and forth on already-loaded modules.
- No dual writes: a single operation goes down exactly one branch, and the
  tests assert an exact PG row-count delta plus
  `mongoose.connection.readyState === 0` on the PostgreSQL path, and the
  absence of the written `number` in PostgreSQL on the Mongo path.

## Foreign keys

**There are no foreign keys in this phase — zero.** Rooms is not the child of
any other entity and it references no PostgreSQL row.

| Candidate relationship | FK created? | Reason |
|---|---|---|
| guest `devotee` → devotees/users | **No** | the Mongo field is a free-text **name**, not an ObjectId ref; there is nothing to reference |
| Room → `bookings` | **No** | the relation is one-directional: `bookings` stores the room *number inside free-text strings* (`service`, `notes`) and has no room id column. The existing checkout path matches those rows with a text regex over `service`, not by identifier. A FK would invent a relationship the data model does not have |
| Room → maintenance / repair records | **No** | the Room model has no repair reference at all. The only "maintenance" concept is the stored `status` value |

Because there are no foreign keys, there is **no ON DELETE behaviour** to
document, and deleting a room never cascades into, blocks, or mutates any other
table. That mirrors Mongo exactly, where deleting the Room document leaves
every Booking untouched.

## Indexes and the queries they serve

| Index | Query/use case |
|---|---|
| `rooms_number_key` (UNIQUE) | Mongo `number { unique: true }`; also the access path for every `roomRoutes` lookup (`findOne({ number })` in allot/checkout/maintenance/delete) and the `POST /api/rooms` duplicate guard. No separate non-unique index on `number` is added — the unique index already serves equality lookups |
| `idx_rooms_status` | the scheduler's standing filters (`status: 'Occupied'` for auto checkout, `status: 'Available'` for auto check-in) |
| `idx_rooms_checkin_date` | the auto check-in range scan `checkinDate: { $lte: now }` run every 60 seconds |
| `idx_rooms_checkout_date` | the auto-checkout scan `checkoutDate: { $lte: now }` and the auto check-in `checkoutDate: { $gt: now }` |
| `idx_rooms_created_at` | the standing `createdAt DESC` ordering convention shared by every entity list |

No index is added for `type`/`block`/`floor`/`bed_type`/`pay_mode`/`amenities`:
there is no server-side query against them. The admin grid's
search/type/status filtering runs client-side over the full list returned by
`GET /api/rooms`, and no repository filter or aggregation uses those columns.
No uniqueness beyond `number` is invented.

## Migration

- File: `backend/src/db/migrations/019_create_rooms.sql` (migration 19,
  following `018_create_repairs.sql`).
- Tables: `rooms` (one table; no child tables).
- Columns: the 18 mapped columns above; `price`/`capacity`/`days` are `NUMERIC`
  (never `FLOAT`/`REAL`/`DOUBLE PRECISION`), dates are `TIMESTAMPTZ`.
- Constraints:
  - `rooms_pkey` PRIMARY KEY (`id`)
  - `rooms_number_key` UNIQUE (`number`)
  - `rooms_price_check` CHECK (`price >= 0`)
  - `rooms_status_check` CHECK (`status IN ('Available','Occupied','Maintenance')`)
- Indexes: `idx_rooms_status`, `idx_rooms_checkin_date`,
  `idx_rooms_checkout_date`, `idx_rooms_created_at` (plus the unique index
  backing `rooms_number_key`).
- Rollback: the project's migration mechanism is forward-only (no `down`
  migrations), so rollback follows the established convention — `DROP TABLE
  rooms` (the table has no dependents) and delete its `schema_migrations` row;
  a re-run then re-applies only migration 019 and rebuilds the table, its
  constraints and its indexes. The migrate suite tests exactly this.
- The migration is idempotent (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`) and cannot affect MongoDB.

## Repository methods

`backend/src/repositories/roomRepository.js`:

- `create(data)` — validates required/enum/money/number rules, INSERTs, re-reads.
- `findById(id)` / `findOne(filter)` / `findMany({ filter, sort, limit, offset })`
- `updateById(id, updates)` — applies only provided fields + `updated_at =
  now()`; returns `null` for a missing id.
- `release(id)` — unsets the guest fields and sets `status = 'Available'`, the
  exact checkout/auto-checkout semantics.
- `count(filter)` — `SELECT COUNT(*)::int`.
- `destroy(id)` — `DELETE ... RETURNING id` (truthy on deletion).
- Mongo fallbacks for every operation.

Filtering supports the keys the application actually uses (`id`, `number`,
`type`, `block`, `floor`, `bedType`, `status`, `devotee`, `price`, `capacity`,
`days`, `checkinDate`, `checkoutDate`, `createdAt`, `updatedAt`) plus the Mongo
operators `$in`, `$gte`, `$gt`, `$lte`, `$lt`, `$ne` and `$exists`. `$in: []`
renders `1 = 0`, matching Mongo's instant-false semantics; `$exists: false`
maps to `IS NULL`, matching Mongo's absent-field behaviour for the optional
columns. Status filters are enum-checked before hitting SQL.

Sorting is dynamic but goes through a whitelist map — an unknown or malformed
sort key falls back to the default `number ASC` (the standing
`Room.find().sort({ number: 1 })`). `LIMIT`/`OFFSET` are numeric-coerced and
appended as literals (never user string interpolation). All filter values are
parameterized; no user input is interpolated into SQL.

## Service

`backend/src/services/roomService.js` mirrors the other Phase 2 services:

- preserves the required fields, the defaults (`capacity`, `bedType`,
  `amenities`, `status`), the enum check and the `price >= 0` rule, and trims
  the same fields Mongoose trims;
- `create/findById/findOne/findMany/updateById/release/findOneAndDelete/count/destroy`
  each branch via `usePostgres()`: PostgreSQL when available, otherwise
  Mongoose — one operation, one branch, no dual write;
- `validate(data)` exposes the same normalization for future callers;
- `isConnected()` / `usePostgres()` are public so tests can assert exactly
  which datasource is active.

## Integration

- `backend/src/routes/roomRoutes.js` now reads and writes rooms through
  `roomService` instead of the `Room` model directly, so all six endpoints
  follow the selected datasource. Every branch, status code, response shape and
  message is unchanged; the only addition is mapping a `rooms_number_key`
  violation to the same HTTP 400 "Room number already exists" the Mongoose
  11000 path has always returned.
- The `Booking` writes in `allotRoom` / checkout are **unchanged** — Bookings is
  a separate domain (Phase 2E) and the checkout regex is left exactly as it
  was.
- `backend/src/app.js`'s background room scheduler now calls
  `roomService.findMany/release/updateById` instead of `Room.find/save`, so the
  auto check-in / auto checkout writes follow the same datasource. The queries,
  the ordering, and the mutations performed are identical.
- No other domain service is touched.

## Repository / service tests

`backend/test/postgres-rooms.test.js` (26 tests) runs against the real
PostgreSQL `rooms` table (no mocks) and covers:

- the datasource selection (`isConnected`, `usePostgres`);
- a full create → read round trip of every persisted Mongo field, including
  trimming, guest fields, dates and the amenities array order;
- proof that the fields the strict schema discards are neither returned nor
  given columns;
- unset optionals reading back as `undefined`;
- defaults (capacity 2, `'Double'`, `[]`, `'Available'`);
- validation (required `number`/`type`/`price`, status enum, fractional
  capacity/days);
- monetary precision: `price` is asserted to be `numeric` (never
  float/double) and round-trips `0`, `0.01`, `1200`, `1200.50`, `123456.789`,
  `99999999.99`; `price = 0` legal; negatives rejected by the service and by
  the `rooms_price_check` constraint;
- uniqueness: one UNIQUE constraint on `number`, duplicate insert rejected,
  duplicate rename rejected, free rename accepted;
- update semantics (patch-only, `updatedAt` refresh, clearing optional fields,
  missing id → `null`) and delete semantics (`destroy` truthiness,
  `findOneAndDelete` by number);
- the query surface: default `number ASC` ordering, `$in` (including
  `$in: []`), range filters, enum rejection, `LIMIT`/`OFFSET` pagination and
  `count`;
- lifecycle: allot → checkout (`release`) clearing every guest field, and the
  maintenance toggle keeping the stored enum while rejecting an occupied room;
- the scheduler's two standing queries (auto checkout and auto check-in,
  including the `devotee: { $exists: true, $ne: null }` exclusion);
- **no dual writes** — exact PG row-count delta plus
  `mongoose.connection.readyState === 0`;
- **the datasource seam** — flipping the seam and asserting the loader/route
  selection changes without a fresh Node process, and that an unreachable
  PostgreSQL falls back even when the seam says connected.

`backend/test/postgres-repositories.test.js` gains three Phase 2R tests
(create/read/update/delete round trip, `release`, no dual writes) alongside the
existing per-phase repository tests.

## Fallback tests

`backend/test/postgres-rooms-fallback.test.js` (15 tests) pins
`dbConfig.isDbConnected = () => false` and proves:

- the service selects MongoDB and never PostgreSQL, even when `DATABASE_URL`
  points at a dead server;
- the repository's `create`/`findById`/`findMany`/`findOne`/`count`/
  `updateById`/`destroy`/`release` all route to the Mongoose model, using
  call-tracking stubs of the loaded model object (the same reference the
  modules invoke at call time) so the Mongo path is genuinely exercised;
- the service's `create`/`findById`/`findOne`/`findMany`/`updateById`/`count`/
  `destroy`/`findOneAndDelete`/`release` each reach the corresponding Mongoose
  method;
- the Mongo fallback works with the `rooms` table dropped;
- **no dual writes** — the Mongo write leaves no new PG row, and a single
  `roomService.create` reaches exactly one datasource;
- **the datasource seam** — flipping the seam to PostgreSQL inside the same
  process makes the already-loaded modules take the PG branch (asserted by
  observing that the Mongo-only id is absent from PostgreSQL), and flipping
  back and forth repeatedly always honours the current value. A stale capture
  of `isDbConnected` at require time would fail these assertions.

## Migration tests

Added to `backend/test/postgres-migrate.test.js`:

- the from-scratch run now applies **19** migrations and records
  `019_create_rooms.sql`;
- the rollback test drops `rooms`, deletes its `schema_migrations` row, and
  asserts a re-run applies only 019, rebuilds `rooms` with the UNIQUE
  constraint, and is then idempotent;
- a schema test asserts all 18 columns exist with the expected types,
  nullability and defaults, that there are exactly 18 columns, that no column
  uses `real`/`double precision`, that the CHECKs are exactly the status enum
  and `price >= 0` (and that `capacity`/`days` deliberately have none), that
  there is exactly one UNIQUE constraint on `number`, that there are **zero**
  foreign keys, and that the five justified indexes exist and no others;
- a constraint test proves the UNIQUE, `price >= 0` and status CHECKs reject
  invalid rows, that the column defaults match the Mongo schema, and that
  `NUMERIC` keeps exact scale (`123456.7891`).

## Regression

The complete suite is run (see `npm test` in `backend/`): all previously
migrated phases stay green, including Assets, Repairs, Inventory, Purchase
Orders, Goods Received Notes, Damage Notes, Users/Employees, Accounting, Bills,
Donations, Pooja Bookings and Prasadam. Existing Mongo behaviour and existing
tests are unchanged; the only edits to existing test files are the migration
count (18 → 19), the added migration name, the added `DROP TABLE ... rooms` in
the two reset helpers, and the new Phase 2R tests.

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
19. `019_create_rooms.sql`
