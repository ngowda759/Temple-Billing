-- Phase 2R: rooms (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/Room.js and every real usage of the Room model:
--   * Room.js — the Mongoose model: number (String, required, unique, trim),
--     type (String, required, trim), block (String, trim, optional), floor
--     (String, trim, optional), price (Number, required, min 0), capacity
--     (Number, default 2), bedType (String, trim, default 'Double'),
--     amenities ([String], default []), status (3-value enum, default
--     'Available'), devotee (String, trim, optional), phone (String, trim,
--     optional), days (Number, optional), payMode (String, trim, optional),
--     checkinDate (Date, optional), checkoutDate (Date, optional), timestamps.
--     There are NO virtuals and NO embedded sub-documents.
--   * roomRoutes.js — GET / (Room.find().sort({ number: 1 })), POST /
--     (Room.findOne({ number }) duplicate guard then new Room({...}).save()),
--     allotRoom (Room.findOne({ number }); rejects when status !== 'Available';
--     stamps devotee/phone/days/payMode/checkinDate/checkoutDate and status
--     'Occupied'; then writes a Booking history row), POST /checkout/:roomNumber
--     (Room.findOne({ number }); clears the guest fields and sets status
--     'Available'), PATCH /maintenance/:roomNumber (Room.findOne({ number });
--     toggles Available ↔ Maintenance and rejects an Occupied room),
--     DELETE /:roomNumber (Room.findOneAndDelete({ number })).
--   * app.js — the 60s background room scheduler runs
--     Room.find({ status: 'Occupied', checkoutDate: { $lte: now } }) (auto
--     checkout) and Room.find({ status: 'Available', checkinDate: { $lte: now },
--     checkoutDate: { $gt: now }, devotee: { $exists: true, $ne: null } })
--     (auto check-in). Both mutate and save the Mongoose documents.
--   * frontend/src/pages/admin/RoomAllotment.jsx — GET /api/rooms, POST
--     /api/rooms, POST /api/rooms/allot, POST /api/rooms/checkout/:number,
--     PATCH /api/rooms/maintenance/:number, DELETE /api/rooms/:number. Renders
--     number/type/block/floor/price/capacity/bedType/amenities/status/devotee/
--     phone/checkinDate. It also POSTs extraCharge / securityDeposit /
--     roomSize / totalBeds / totalExtraBeds / description / checkinTime /
--     checkoutTime / mealsIncluded / cancellationPolicy / isActive in the
--     create payload — the Mongoose schema is NOT strict:false-free, i.e. it
--     is strict by default, so those keys are silently discarded by the model
--     and are therefore NOT persisted. They are deliberately NOT added here.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by roomRepository, reachable through roomService) that is
-- selected only when the service is used AND PostgreSQL is reachable. MongoDB
-- stays the source of truth and the fallback path; no Mongo → PostgreSQL
-- switch happens anywhere in the application, and no production data is
-- migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — rooms (every persisted Mongo field):
--   * _id           → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * number        → number TEXT NOT NULL (required, trim; UNIQUE because the
--                     Mongo schema declares number unique: true — the sole
--                     unique index on the model)
--   * type          → type TEXT NOT NULL (required, trim — free String, no
--                     enum in Mongo, so no CHECK)
--   * block         → block TEXT (optional; unset stays NULL)
--   * floor         → floor TEXT (optional; unset stays NULL)
--   * price         → price NUMERIC NOT NULL (required, min 0 → CHECK >= 0).
--                     NUMERIC, never float/double, so the rupee amounts
--                     round-trip exactly.
--   * capacity      → capacity NUMERIC NOT NULL DEFAULT 2 (Number, default 2;
--                     fractional values are legal in Mongo — no integer cast
--                     and no CHECK, because Mongo declares neither min nor an
--                     integer constraint)
--   * bedType       → bed_type TEXT NOT NULL DEFAULT 'Double' (free String,
--                     default 'Double', no enum in Mongo → no CHECK)
--   * amenities[]   → amenities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] —
--                     Mongo declares [String] and both the API and the admin
--                     grid read it back as an array, so it keeps array
--                     semantics. See the nested-data decision below.
--   * status        → status TEXT NOT NULL DEFAULT 'Available', CHECK over
--                     ['Available', 'Occupied', 'Maintenance'] — the exact
--                     3-value enum from the Mongo schema
--   * devotee       → devotee TEXT (optional guest name; cleared by checkout)
--   * phone         → phone TEXT (optional guest phone)
--   * days          → days NUMERIC (optional; copies the bookings.days
--                     precedent — Mongo declares a bare Number with no min and
--                     no integer constraint, so no CHECK and no integer cast)
--   * payMode       → pay_mode TEXT (optional free String; the default 'UPI'
--                     is applied by the write path, not by the schema, so the
--                     column has no default)
--   * checkinDate   → checkin_date TIMESTAMPTZ (optional; unset stays NULL)
--   * checkoutDate  → checkout_date TIMESTAMPTZ (optional; unset stays NULL)
--   * createdAt     → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt     → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Intentionally omitted Mongo fields: none. Every persisted field on the Room
-- schema has an explicit column above. Conversely, no field is invented: the
-- Room model has no room code, no room name, no building, no location, no
-- dimensions/room size, no occupancy counter, no bed counts, no extra-person
-- charge, no security deposit, no description/notes, no metadata, no
-- createdBy/updatedBy, no facilities table, no maintenance/repair reference
-- and no booking/reservation reference. The frontend sends several of those
-- names (extraCharge, securityDeposit, roomSize, totalBeds, totalExtraBeds,
-- description, checkinTime, checkoutTime, mealsIncluded, cancellationPolicy,
-- isActive) but the strict Mongoose schema discards them, so they are NOT
-- columns. Confirmed by probing Room.schema: the persisted key set is exactly
-- number, type, block, floor, price, capacity, bedType, amenities, status,
-- devotee, phone, days, payMode, checkinDate, checkoutDate.
--
-- Stored vs derived values: status IS stored in Mongo (an enum column with a
-- default), so it stays a stored column — availability is read directly from
-- it (`if (room.status !== "Available")`). days is stored by allotRoom and is
-- NOT derived on read. price is a stored nightly tariff; the booking total
-- (price × days) is computed at allot time and written to the Booking
-- document, so no derived money column is introduced here. Nothing is
-- duplicated.
--
-- Nested data decision: amenities is the ONLY repeating field on a Room, and
-- the Mongo schema declares it as [String] — an array of plain scalars, not
-- sub-documents with their own _id. It is therefore kept as a PostgreSQL
-- TEXT[] column and NOT normalized into a child table: the application always
-- reads/writes the array atomically with the room document, never queries or
-- updates an individual amenity, and there is no per-amenity identity to
-- preserve. This matches the established convention for the other [String]
-- arrays in the roadmap (users.permissions / users.menu_access,
-- bookings.pooja_rules) and, unlike asset_maintenance_history /
-- repair_ticket_spare_parts / bill_items, there is no child-row identity or
-- independent lifecycle to model. JSONB is not used: the values are a
-- homogeneous string list, not structured/dynamic metadata.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * rooms.status: ['Available', 'Occupied', 'Maintenance'] — default
--     'Available'. There is no CHECK on number/type/block/floor/bedType/
--     payMode because Mongo declares none for them.
--
-- Dates use TIMESTAMPTZ so Mongoose Date instants round-trip exactly.
-- checkin_date / checkout_date are nullable (both are unset when a room is
-- vacant).
--
-- Uniqueness semantics: the Room schema declares exactly ONE unique index —
-- number { unique: true } — preserved as a UNIQUE constraint on number (PG
-- names it rooms_number_key). No other unique index exists on the model, so
-- no other UNIQUE constraint is invented. The duplicate-room-number guard in
-- POST /api/rooms is preserved by the service's existing-then-create path.
--
-- Nullability honesty: number / type / price are NOT NULL because the Mongo
-- schema marks them `required: true` and every real write path supplies them
-- (POST /api/rooms validates them, allotRoom looks the room up by number, and
-- devotee-created rooms always carry a price). capacity / bed_type / status /
-- amenities carry their Mongo defaults as column defaults (2 / 'Double' /
-- 'Available' / '{}'), so a row created without them is identical to a Mongo
-- document created without them. devotee / phone / days / pay_mode /
-- checkin_date / checkout_date stay nullable because the schema leaves them
-- unset and the checkout/auto-checkout paths explicitly unset them.
--
-- Note on Mongoose `required`: on a String path `required: true` also rejects
-- the empty string (``trim`` runs first for trimmed paths), so an empty
-- number/type is rejected by Mongo and is rejected by the repository's
-- assertId for the same reason. price = 0 is legal in Mongo (`min: 0`) and is
-- legal here (`price >= 0`).
--
-- Foreign keys: NONE. Rooms is not the child of any other entity and it
-- references no PostgreSQL row. Specifically, no FK is invented for:
--   * the guest devotee — `devotee` is a free-text NAME (not an ObjectId ref
--     to a Devotee document), so there is nothing to reference;
--   * the Booking history rows written by roomRoutes.allotRoom — the relation
--     is one-directional (a Booking embeds the room NUMBER inside its
--     free-text `service`/`notes` strings and there is no room id column in
--     bookings), and the existing checkout path matches those rows with a
--     text regex over `service`, not by identifier. Adding a FK would invent a
--     relationship the data model does not have;
--   * maintenance/repairs — the Room model has no repair reference at all (no
--     repairRequest/repairTicket/asset field); the only "maintenance" concept
--     is the stored status value. No FK is invented.
-- Because there are no foreign keys, there is no ON DELETE behaviour to
-- document, and deleting a room never cascades into, blocks, or mutates any
-- other table. That mirrors Mongo exactly, where deleting the Room document
-- leaves every Booking untouched.
--
-- Indexes (each justified by a real query pattern; see inline comments):
--   * rooms_number_key — UNIQUE constraint (Mongo number unique: true). It is
--     also the access path for every roomRoutes lookup
--     (Room.findOne({ number }) in allot/checkout/maintenance/delete) and for
--     the duplicate-number guard in POST /api/rooms, so no separate
--     non-unique index on number is added (the unique index already serves
--     equality lookups).
--   * idx_rooms_status — the app.js background scheduler's standing queries
--     filter on status ('Occupied' for auto checkout, 'Available' for auto
--     check-in filtering).
--   * idx_rooms_checkin_date / idx_rooms_checkout_date — the two scheduler
--     paths range-scan these columns every 60 seconds:
--     checkoutDate { $lte: now } and checkinDate { $lte: now } plus
--     checkoutDate { $gt: now }.
--   * idx_rooms_created_at — the standing createdAt DESC ordering convention
--     shared by every entity list in the roadmap.
-- No index is added for type/block/floor/bedType/payMode/amenities because
-- there is no server-side query against them: the frontend search/type/status
-- filtering in RoomAllotment.jsx runs client-side over the full list returned
-- by GET /api/rooms, and no repository filter/aggregation uses those columns.

CREATE TABLE IF NOT EXISTS rooms (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: number String — required, unique, trim. The sole Mongo unique
  -- index; also the lookup key for every roomRoutes operation.
  number TEXT NOT NULL,
  -- Mongo: type String — required, trim. Free String (no enum in Mongo).
  type TEXT NOT NULL,
  -- Mongo: block String — optional, trim.
  block TEXT,
  -- Mongo: floor String — optional, trim.
  floor TEXT,
  -- Mongo: price Number — required, min 0. NUMERIC so rupee amounts keep
  -- their exact scale (never float/double).
  price NUMERIC NOT NULL,
  -- Mongo: capacity Number — default 2. NUMERIC: Mongo allows fractional
  -- values and declares no min, so nothing is narrowed.
  capacity NUMERIC NOT NULL DEFAULT 2,
  -- Mongo: bedType String — default 'Double', trim, no enum.
  bed_type TEXT NOT NULL DEFAULT 'Double',
  -- Mongo: amenities [String] — default []. Kept as an array column; the
  -- application reads/writes it atomically with the room.
  amenities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Mongo: status enum, default 'Available'.
  status TEXT NOT NULL DEFAULT 'Available',
  -- Mongo: devotee String — optional guest name, trim.
  devotee TEXT,
  -- Mongo: phone String — optional guest phone, trim.
  phone TEXT,
  -- Mongo: days Number — optional, no min (copies the bookings.days
  -- precedent).
  days NUMERIC,
  -- Mongo: payMode String — optional, trim; default applied by the write
  -- path, not by the schema.
  pay_mode TEXT,
  -- Mongo: checkinDate Date — optional (unset while vacant).
  checkin_date TIMESTAMPTZ,
  -- Mongo: checkoutDate Date — optional (unset while vacant).
  checkout_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the Mongo schema's number unique: true.
  CONSTRAINT rooms_number_key UNIQUE (number),
  -- Mirrors the Mongo schema's price { required: true, min: 0 }.
  CONSTRAINT rooms_price_check CHECK (price >= 0),
  CONSTRAINT rooms_status_check CHECK (status IN ('Available', 'Occupied', 'Maintenance'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms (status);
CREATE INDEX IF NOT EXISTS idx_rooms_checkin_date ON rooms (checkin_date);
CREATE INDEX IF NOT EXISTS idx_rooms_checkout_date ON rooms (checkout_date);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms (created_at DESC);
