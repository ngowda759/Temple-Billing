-- Phase 2Y: poojas + pooja_required_materials + pooja_material_requirements +
-- pooja_material_requirement_items (MongoDB → PostgreSQL migration).
--
-- This migration covers the two Pooja-domain Mongoose models. They are separate
-- collections and separate documents in MongoDB, and neither references the
-- other, so they are four tables here (two parents, two embedded-array
-- children) rather than one joined shape.
--
-- Mirrors backend/src/models/Pooja.js (collection `poojas`) and every real
-- usage of the Pooja model:
--   * Pooja.js — the Mongoose model: name (String, required, unique, trim),
--     description (String, trim, default ''), price (Number, required, min 0),
--     duration (String, trim, default ''), availableDays ([String], default
--     ['Everyday']), availableDates ([String], default []), availableStartTime
--     (String, default ''), availableEndTime (String, default ''),
--     minimumAdvanceBookingDays (Number, default 0), strictAdvancePreparation
--     (Boolean, default false), requiredMaterials (embedded array, see below),
--     rules ([String], default []), instructions ([String], default []),
--     dressCode (String, trim, default ''), status (String, 2-value enum,
--     default 'Active'), timestamps. The ONLY index the schema declares is
--     { name: 1 } unique.
--   * poojaController.js — the dedicated /api/poojas router:
--       getAllPoojas (GET /)  Pooja.find({}).populate("requiredMaterials.item",
--                             "name category currentStock") → raw array body.
--       getPoojaById (GET /:id) Pooja.findById(id).populate(same projection);
--                             404 when missing.
--       createPooja  (POST /) new Pooja(req.body) → save() → 201
--                             { message, pooja }; validation failure → 400.
--       updatePooja  (PUT /:id) Pooja.findByIdAndUpdate(id, req.body,
--                             { new: true, runValidators: true }); 404 when
--                             missing, 400 on validation failure.
--       deletePooja  (DELETE /:id) Pooja.findByIdAndDelete(id) → hard delete;
--                             404 when missing.
--   * poojaBookingController.createBooking — Pooja.findOne({ name: service })
--     .populate("requiredMaterials.item"); rejects an unknown pooja with 404;
--     gates the booking on pooja.availableDays.includes('Everyday') ||
--     pooja.availableDays.includes(dayName) || pooja.availableDates.includes(
--     'YYYY-MM-DD') and returns 400 when neither matches.
--   * devoteeController — Pooja.findOne({ name }).populate(
--     "requiredMaterials.item") in generateInventoryRequestsForBooking and in
--     createBooking: reads duration, rules[], dressCode,
--     minimumAdvanceBookingDays, strictAdvancePreparation, and per material
--     materialSource, item, itemName, qty, unit, responsibilityType,
--     preparationDaysBeforePooja, preparationInstructions,
--     requiresAdvanceCollection, mandatory. Also Pooja.findOne({ name: service })
--     purely to obtain poojaDoc._id for the
--     Employee.find({ eligiblePoojas: poojaDoc._id }) priest lookup.
--   * priestController — Pooja.findOne({ name }) to build the priest's
--     "materials to arrange / devotee brings" list from requiredMaterials.
--   * scripts/migratePoojaMaterials.js — a legacy one-off backfill script that
--     reads Pooja.find({}) and saves each document.
--
-- Mirrors backend/src/models/PoojaMaterialRequirement.js (collection
-- `poojamaterialrequirements`) and its only consumer,
-- poojaSettingsController.js:
--   * getAllRequirements   (GET /api/pooja-settings)
--       PoojaMaterialRequirement.find().populate("requiredMaterials.item",
--       "name unit category") → { success, requirements }.
--   * getRequirementByName (GET /api/pooja-settings/:poojaName)
--       findOne({ poojaName }).populate(same) → { success, requirement }
--       (null when absent — the frontend relies on the null, not a 404).
--   * saveRequirement      (POST /api/pooja-settings)
--       rejects a missing poojaName with 400, then findOneAndUpdate(
--       { poojaName: poojaName.trim() }, { requiredMaterials: items || [] },
--       { new: true, upsert: true }).populate(same) → { success, requirement }.
--       The whole array is REPLACED on every save; there is no append path.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by poojaRepository / poojaMaterialRequirementRepository,
-- reachable through the matching services) that is selected only when the
-- service is used AND PostgreSQL is reachable. MongoDB stays the source of
-- truth and the fallback path; no Mongo → PostgreSQL switch happens anywhere in
-- the application, no production data is migrated and there are no dual writes.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing models. Embedded sub-document
-- `_id` values are preserved the same way.
--
-- Mongo → PostgreSQL field mapping — poojas (every persisted Mongo field):
--   * _id                       → id TEXT PRIMARY KEY (24-hex id)
--   * name                      → name TEXT NOT NULL, UNIQUE (required, trim;
--                                 CHECK name <> '' because Mongoose trims
--                                 before the required check, so a
--                                 whitespace-only name is rejected there too)
--   * description               → description TEXT NOT NULL DEFAULT ''
--                                 (String, trim, default '')
--   * price                     → price NUMERIC NOT NULL, CHECK (price >= 0)
--                                 (Number, required, min 0). NUMERIC, never
--                                 float, so rupee amounts round-trip exactly.
--   * duration                  → duration TEXT NOT NULL DEFAULT ''
--   * availableDays             → available_days TEXT[] NOT NULL
--                                 DEFAULT ARRAY[]::TEXT[]
--   * availableDates            → available_dates TEXT[] NOT NULL
--                                 DEFAULT ARRAY[]::TEXT[] (see the TEXT[] note)
--   * availableStartTime        → available_start_time TEXT NOT NULL DEFAULT ''
--                                 (see the time-of-day note)
--   * availableEndTime          → available_end_time TEXT NOT NULL DEFAULT ''
--   * minimumAdvanceBookingDays → minimum_advance_booking_days NUMERIC NOT NULL
--                                 DEFAULT 0 (bare Number, no min → no CHECK)
--   * strictAdvancePreparation  → strict_advance_preparation BOOLEAN NOT NULL
--                                 DEFAULT false
--   * requiredMaterials[]       → normalized into pooja_required_materials
--                                 (embedded array; see below)
--   * rules                     → rules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
--   * instructions              → instructions TEXT[] NOT NULL
--                                 DEFAULT ARRAY[]::TEXT[]
--   * dressCode                 → dress_code TEXT NOT NULL DEFAULT ''
--   * status                    → status TEXT NOT NULL DEFAULT 'Active',
--                                 CHECK over ['Active', 'Inactive']
--   * createdAt                 → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt                 → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Normalized pooja_required_materials (every persisted embedded field):
--   * requiredMaterials[]._id    → id TEXT PRIMARY KEY (24-hex sub-doc id)
--   * requiredMaterials[].item   → item TEXT, nullable (ObjectId ref
--                                 'InventoryItem'; the sub-path declares no
--                                 `required`, so a row may omit it)
--   * requiredMaterials[].materialSource
--                                → material_source TEXT NOT NULL
--                                 DEFAULT 'TEMPLE_INVENTORY', CHECK over
--                                 ['TEMPLE_INVENTORY', 'EXTERNAL_OR_DEVOTEE']
--   * requiredMaterials[].itemName → item_name TEXT NOT NULL (required)
--   * requiredMaterials[].qty    → qty NUMERIC NOT NULL (Number, required, no
--                                 min in Mongo → no CHECK)
--   * requiredMaterials[].unit   → unit TEXT NOT NULL (required)
--   * requiredMaterials[].responsibilityType
--                                → responsibility_type TEXT NOT NULL
--                                 DEFAULT 'TEMPLE_PROVIDES', CHECK over the
--                                 exact 4-value enum
--   * requiredMaterials[].preparationDaysBeforePooja
--                                → preparation_days_before_pooja NUMERIC NOT
--                                 NULL DEFAULT 0
--   * requiredMaterials[].preparationInstructions
--                                → preparation_instructions TEXT NOT NULL
--                                 DEFAULT ''
--   * requiredMaterials[].requiresAdvanceCollection
--                                → requires_advance_collection BOOLEAN NOT NULL
--                                 DEFAULT false
--   * requiredMaterials[].collectionInstructions
--                                → collection_instructions TEXT NOT NULL
--                                 DEFAULT ''
--   * requiredMaterials[].mandatory
--                                → mandatory BOOLEAN NOT NULL DEFAULT false
--   * requiredMaterials[].templeCharge
--                                → temple_charge NUMERIC NOT NULL DEFAULT 0
--   * position                   → INTEGER NOT NULL DEFAULT 0 — preserves the
--                                 original array order of the Mongo
--                                 requiredMaterials[] documents (same
--                                 convention as asset_maintenance_history,
--                                 repair_ticket_spare_parts and
--                                 pooja_booking_material_requests)
--   * created_at / updated_at    → TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Mongo → PostgreSQL field mapping — pooja_material_requirements (every
-- persisted Mongo field):
--   * _id            → id TEXT PRIMARY KEY (24-hex id)
--   * poojaName      → pooja_name TEXT NOT NULL, UNIQUE (required, trim — the
--                      sole Mongo unique index, and the findOneAndUpdate upsert
--                      key)
--   * requiredMaterials[] → normalized into pooja_material_requirement_items
--   * createdAt      → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt      → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Normalized pooja_material_requirement_items (every persisted embedded field):
--   * requiredMaterials[]._id → id TEXT PRIMARY KEY (24-hex sub-doc id)
--   * requiredMaterials[].item → item TEXT, NULLABLE (ObjectId ref
--                      'InventoryItem'; the sub-schema says `required: true`
--                      but the only writer does not enforce it — see
--                      "required field carry-over" below)
--   * requiredMaterials[].quantity → quantity NUMERIC, NULLABLE (Number,
--                      required, min: 0.01 in the sub-schema; same
--                      unenforced-on-write situation, so no CHECK is added)
--   * requiredMaterials[].charge → charge NUMERIC NOT NULL DEFAULT 0
--   * requiredMaterials[].mandatory → mandatory BOOLEAN NOT NULL DEFAULT false
--   * requiredMaterials[].templeArrangeAvailable
--                      → temple_arrange_available BOOLEAN NOT NULL DEFAULT true
--   * requiredMaterials[].templeCharge → temple_charge NUMERIC NOT NULL
--                      DEFAULT 0
--   * position         → INTEGER NOT NULL DEFAULT 0 (array order, as above)
--   * created_at / updated_at → TIMESTAMPTZ NOT NULL DEFAULT now()
-- The four defaulted fields above DO keep NOT NULL, because Mongoose applies
-- schema defaults while casting the update array (the upsert's $set carries
-- charge: 0, mandatory: false, templeArrangeAvailable: true, templeCharge: 0
-- for every element), so those four can never be absent on a PG row either.
--
-- Intentionally omitted fields: none. Every persisted Mongo field from both
-- schemas has an explicit column, and every persisted embedded field has an
-- explicit column on its child table. Two read-only fields the application
-- touches do NOT exist on the models and are therefore NOT given columns:
--   * pooja.priestInstructions (read by devoteeController.createBooking) is not
--     a path on Pooja, so Mongoose strict mode never persists it and the read
--     always yields undefined.
--   * requiredMaterials[].canTempleArrange (read by
--     poojaBookingController.createBooking) and
--     requiredMaterials[].mustBringByDevotee (read by priestController) are not
--     paths on the Pooja sub-schema either, so they are always falsy. Both
--     callers therefore take their "else" branch today.
-- These are pre-existing schema/consumer mismatches. They are preserved exactly
-- (no column is invented, and no consumer is "fixed") because this phase must
-- not change business behaviour. Adding columns for them would fabricate state
-- the application has never stored.
--
-- Date / time semantics. Pooja has NO Date path at all: availableDates is a
-- [String] of 'YYYY-MM-DD' calendar labels, and availableStartTime /
-- availableEndTime are plain Strings such as '06:00' typed into an
-- <input type="time">. This migration therefore declares no TIMESTAMPTZ,
-- no DATE and no TIME business column — only the two timestamps.
--   * available_dates is TEXT[] and NOT DATE[]: the booking gate compares
--     `pooja.availableDates.includes(dateString)` where dateString is
--     `d.toISOString().split('T')[0]`, and the admin UI stores and re-displays
--     the raw strings. A DATE[] column would change both the equality semantics
--     and the JSON wire format (the driver would return 'YYYY-MM-DD' strings
--     for dates but the array would reject any legacy non-date entry the Mongo
--     schema happily accepts today).
--   * available_start_time / available_end_time are TEXT and NOT TIME: the
--     model declares them as String with default '', nothing parses or compares
--     them server-side, and they are echoed to the UI verbatim. A TIME column
--     would reject '' (the schema default) and would rewrite any legacy
--     free-text value. This is the same conclusion migration 022 reached for
--     shifts.startTime / endTime.
--
-- Array columns vs child tables. availableDays / availableDates / rules /
-- instructions are [String] arrays of scalars with no identity, no ordering
-- requirement beyond the stored order and no query against their elements, so
-- they stay TEXT[] columns — the same decision migration 019 made for
-- rooms.amenities. requiredMaterials[] on BOTH models is normalized into a
-- child table instead, because (a) the sub-documents are independent records
-- with their own Mongo `_id`, (b) their numeric fields (qty / quantity /
-- templeCharge / charge) benefit from exact NUMERIC precision, (c) array order
-- matters to the priest/booking material lists and is preserved by `position`,
-- and (d) deleting the parent must remove exactly what Mongo removes with the
-- document (CASCADE). That is the same normalization decision made for
-- asset_maintenance_history (2P), repair_ticket_spare_parts (2Q) and
-- pooja_booking_material_requests (2F).
--
-- Defaults. The column defaults mirror the Mongo schema defaults exactly. The
-- one deliberate exception is available_days: the schema default ['Everyday']
-- is a Mongoose-level default applied when the field is absent from a create
-- payload, so the service/repository applies it on write and the column itself
-- defaults to ARRAY[]::TEXT[] (the same split migration 019 used for
-- rooms.amenities). Every other default is a literal column default.
--
-- Enums (from the Mongo schemas, preserved exactly — no extra values):
--   * poojas.status: ['Active', 'Inactive'] — default 'Active'.
--   * pooja_required_materials.materialSource:
--     ['TEMPLE_INVENTORY', 'EXTERNAL_OR_DEVOTEE'] — default 'TEMPLE_INVENTORY'.
--   * pooja_required_materials.responsibilityType: ['TEMPLE_PROVIDES',
--     'DEVOTEE_MUST_BRING', 'DEVOTEE_PREPARATION_REQUIRED',
--     'DEVOTEE_OR_TEMPLE'] — default 'TEMPLE_PROVIDES'.
--   * PoojaMaterialRequirement declares no enum at all, so none is invented on
--     its tables.
--
-- Uniqueness semantics. Pooja declares exactly ONE unique index — name
-- { unique: true } — preserved as a UNIQUE constraint on poojas.name.
-- PoojaMaterialRequirement declares exactly ONE — poojaName { unique: true } —
-- preserved as a UNIQUE constraint on pooja_material_requirements.pooja_name.
-- No other unique index exists on either model, so none is invented.
--
-- "Required field carry-over" (documented honestly, no invented NOT NULL):
--   * poojas.price IS NOT NULL: price is a required scalar with a min and every
--     write path supplies it, so NOT NULL is the faithful reading.
--   * pooja_required_materials.item stays NULLABLE: the sub-path declares no
--     `required` (its comment says so explicitly — "Not required for
--     EXTERNAL_OR_DEVOTEE"), so a row without an item is legal today.
--   * item_name / unit / qty ARE NOT NULL on pooja_required_materials: each is
--     `required: true` and both Pooja write paths enforce it. The create path
--     runs full document validation (new Pooja(...).save()) and the update path
--     runs Pooja.findByIdAndUpdate(..., { runValidators: true }). Verified
--     against Mongoose itself: an update validator casts the array and runs
--     per-element validation, so unit/qty/itemName are rejected on
--     PUT /api/poojas/:id exactly as on create.
--   * item / quantity on pooja_material_requirement_items stay NULLABLE and get
--     no min CHECK, because that model's ONLY writer does not enforce them:
--     poojaSettingsController.saveRequirement calls findOneAndUpdate(
--     { poojaName }, { requiredMaterials: items || [] }, { new: true,
--     upsert: true }) — there is no runValidators, so Mongoose casts the array
--     but never runs the `required` or `min: 0.01` validators. A caller posting
--     requiredMaterials without item/quantity is persisted today with those
--     paths absent. Typing item NOT NULL or adding quantity >= 0.01 would invent
--     an enforcement the model does not guarantee on this path and would make
--     the PostgreSQL path reject a payload MongoDB accepts — the same reasoning
--     migration 018 used for repair_requests.asset_id.
--
-- Relationships / foreign keys. No outbound foreign key is created:
--   * pooja_required_materials.item and pooja_material_requirement_items.item
--     hold Mongo ObjectIds pointing at InventoryItem. inventory_items(id) does
--     exist (Phase 2H) and ON DELETE RESTRICT would be the least
--     behaviour-changing choice, but the Pooja sub-path is NOT required on one
--     of the two models and the settings upsert accepts any id the caller
--     sends, so a FK would let a Pooja/settings row block an inventory item
--     delete — a restriction MongoDB does not impose here. Kept plain TEXT with
--     NO FK, the same treatment repair_ticket_spare_parts.inventory_item_id
--     (Phase 2Q) and pooja_booking_material_requests.item (Phase 2F) received.
--     Indexed where a query actually joins on it.
--   * Employee.eligiblePoojas stores the Pooja _id, but that column lives on
--     the already-released employees table (Phase 2A) as a TEXT[]; pointing a
--     FK at it would alter a released migration, so none is created. The
--     24-hex id format keeps that lookup working unchanged.
--   * PoojaBooking.service is a NAME string, not a Pooja id, so
--     pooja_bookings has no FK to poojas either (migration 007's header already
--     documents the same conclusion from its side).
-- The only foreign keys introduced here are the two intra-migration
-- parent→child ones, both ON DELETE CASCADE, because each child table is an
-- embedded array of its parent document: MongoDB deletes those sub-documents
-- with the parent, so PostgreSQL must too. CASCADE is NOT used anywhere else.
--
-- Indexes. Only indexes with a real query behind them are created:
--   * poojas_name_key (UNIQUE constraint) — mirrors Mongo's unique index and
--     serves Pooja.findOne({ name }) (the poojaBooking / devotee / priest
--     lookups) as well as the controller's own unique check.
--   * idx_poojas_created_at — the deterministic stand-in for the unsorted
--     Pooja.find({}) listing (Mongo's natural order is unspecified; PostgreSQL
--     needs an explicit order to be reproducible).
--   * idx_pooja_required_materials_pooja_id (pooja_id, position) — the child
--     read for every parent load, in array order.
--   * idx_pooja_material_requirements_created_at — the same stand-in for the
--     unsorted PoojaMaterialRequirement.find() listing.
--   * idx_pooja_material_requirement_items_requirement_id (requirement_id,
--     position) — the child read for every parent load, in array order.
-- No index is added for status: nothing in the application filters poojas by
-- status (getAllPoojas is an unfiltered list and the admin grid filters
-- client-side), so an index there would be speculative.

CREATE TABLE IF NOT EXISTS poojas (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: name String — required, unique, trim.
  name TEXT NOT NULL,
  -- Mongo: description String — trim, default ''.
  description TEXT NOT NULL DEFAULT '',
  -- Mongo: price Number — required, min 0. Money, so NUMERIC.
  price NUMERIC NOT NULL,
  -- Mongo: duration String — trim, default ''.
  duration TEXT NOT NULL DEFAULT '',
  -- Mongo: availableDays [String] — schema default ['Everyday'] is applied by
  -- the service/repository on write (Mongoose-level default), so the column
  -- default is the empty array.
  available_days TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Mongo: availableDates [String] — 'YYYY-MM-DD' calendar labels compared by
  -- string equality in the booking gate; deliberately NOT DATE[].
  available_dates TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Mongo: availableStartTime String — 'HH:MM' from an <input type="time">,
  -- never parsed server-side; deliberately NOT TIME ('' is the schema default).
  available_start_time TEXT NOT NULL DEFAULT '',
  -- Mongo: availableEndTime String — same.
  available_end_time TEXT NOT NULL DEFAULT '',
  -- Mongo: minimumAdvanceBookingDays Number — default 0, bare Number (no min).
  minimum_advance_booking_days NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: strictAdvancePreparation Boolean — default false.
  strict_advance_preparation BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: rules [String] — default [].
  rules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Mongo: instructions [String] — default [].
  instructions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Mongo: dressCode String — trim, default ''.
  dress_code TEXT NOT NULL DEFAULT '',
  -- Mongo: status String — 2-value enum, default 'Active'.
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongoose runs `trim: true` before the `required: true` check, so a
  -- whitespace-only name is rejected there as well. The repository trims
  -- before insert, so this CHECK reproduces exactly what Mongo already rejects
  -- and narrows no value the application can currently persist.
  CONSTRAINT poojas_name_check CHECK (name <> ''),
  -- Mongo: price { type: Number, required: true, min: 0 }.
  CONSTRAINT poojas_price_check CHECK (price >= 0),
  -- The exact enum from Pooja.js. Both the create path (new Pooja + save) and
  -- the update path (runValidators) validate against this list before writing.
  CONSTRAINT poojas_status_check CHECK (status IN ('Active', 'Inactive')),
  -- Mirrors the Mongo schema's name unique: true.
  CONSTRAINT poojas_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS pooja_required_materials (
  -- Mongo: requiredMaterials[]._id — 24-hex sub-document id.
  id TEXT PRIMARY KEY,
  -- Owning pooja. ON DELETE CASCADE — the embedded array is part of the Pooja
  -- document (same lifecycle decision as asset_maintenance_history in Phase 2P,
  -- repair_ticket_spare_parts in Phase 2Q and pooja_booking_material_requests
  -- in Phase 2F).
  pooja_id TEXT NOT NULL REFERENCES poojas(id) ON DELETE CASCADE,
  -- Preserves the original array order of the Mongo requiredMaterials[]
  -- embedded documents.
  position INTEGER NOT NULL DEFAULT 0,
  -- Mongo: requiredMaterials[].item ObjectId ref 'InventoryItem' — NULLABLE
  -- (the sub-path declares no `required`; its comment reads "Not required for
  -- EXTERNAL_OR_DEVOTEE"). Plain TEXT, NO FK (see header).
  item TEXT,
  -- Mongo: requiredMaterials[].materialSource — 2-value enum.
  material_source TEXT NOT NULL DEFAULT 'TEMPLE_INVENTORY',
  -- Mongo: requiredMaterials[].itemName String — required.
  item_name TEXT NOT NULL,
  -- Mongo: requiredMaterials[].qty Number — required, no min in Mongo.
  qty NUMERIC NOT NULL,
  -- Mongo: requiredMaterials[].unit String — required.
  unit TEXT NOT NULL,
  -- Mongo: requiredMaterials[].responsibilityType — 4-value enum, required.
  responsibility_type TEXT NOT NULL DEFAULT 'TEMPLE_PROVIDES',
  -- Mongo: requiredMaterials[].preparationDaysBeforePooja Number — default 0.
  preparation_days_before_pooja NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: requiredMaterials[].preparationInstructions String — default ''.
  preparation_instructions TEXT NOT NULL DEFAULT '',
  -- Mongo: requiredMaterials[].requiresAdvanceCollection Boolean — default false.
  requires_advance_collection BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: requiredMaterials[].collectionInstructions String — default ''.
  collection_instructions TEXT NOT NULL DEFAULT '',
  -- Mongo: requiredMaterials[].mandatory Boolean — default false.
  mandatory BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: requiredMaterials[].templeCharge Number — default 0.
  temple_charge NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pooja_required_materials_material_source_check CHECK (material_source IN ('TEMPLE_INVENTORY', 'EXTERNAL_OR_DEVOTEE')),
  CONSTRAINT pooja_required_materials_responsibility_type_check CHECK (responsibility_type IN ('TEMPLE_PROVIDES', 'DEVOTEE_MUST_BRING', 'DEVOTEE_PREPARATION_REQUIRED', 'DEVOTEE_OR_TEMPLE'))
);

CREATE TABLE IF NOT EXISTS pooja_material_requirements (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: poojaName String — required, unique, trim. Also the
  -- findOneAndUpdate({ poojaName }) upsert key used by saveRequirement.
  pooja_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongoose trims before the required check, so a whitespace-only poojaName is
  -- rejected there too; the repository trims before insert.
  CONSTRAINT pooja_material_requirements_pooja_name_check CHECK (pooja_name <> ''),
  -- Mirrors the Mongo schema's poojaName unique: true.
  CONSTRAINT pooja_material_requirements_pooja_name_key UNIQUE (pooja_name)
);

CREATE TABLE IF NOT EXISTS pooja_material_requirement_items (
  -- Mongo: requiredMaterials[]._id — 24-hex sub-document id.
  id TEXT PRIMARY KEY,
  -- Owning requirement. ON DELETE CASCADE — the embedded array is part of the
  -- PoojaMaterialRequirement document.
  requirement_id TEXT NOT NULL REFERENCES pooja_material_requirements(id) ON DELETE CASCADE,
  -- Preserves the original array order of the Mongo requiredMaterials[]
  -- embedded documents.
  position INTEGER NOT NULL DEFAULT 0,
  -- Mongo: requiredMaterials[].item ObjectId ref 'InventoryItem' — the
  -- sub-schema declares `required: true` but this model's only writer
  -- (saveRequirement's findOneAndUpdate) runs no validators, so an absent item
  -- is persisted today. NULLABLE for that reason; plain TEXT, NO FK (see
  -- header).
  item TEXT,
  -- Mongo: requiredMaterials[].quantity Number — `required` + min: 0.01 in the
  -- sub-schema, but again unenforced on this write path, so NULLABLE with no
  -- CHECK. NUMERIC preserves fractional quantities exactly.
  quantity NUMERIC,
  -- Mongo: requiredMaterials[].charge Number — default 0.
  charge NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: requiredMaterials[].mandatory Boolean — default false.
  mandatory BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: requiredMaterials[].templeArrangeAvailable Boolean — default true.
  temple_arrange_available BOOLEAN NOT NULL DEFAULT true,
  -- Mongo: requiredMaterials[].templeCharge Number — default 0.
  temple_charge NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deterministic stand-in for the unsorted Pooja.find({}) listing
-- (getAllPoojas applies no sort; Mongo natural order is unspecified, so
-- PostgreSQL needs an explicit order to be reproducible). The unique name
-- constraint above already indexes the Pooja.findOne({ name }) lookups.
CREATE INDEX IF NOT EXISTS idx_poojas_created_at ON poojas (created_at ASC, id ASC);

-- The child read performed for every parent load, in embedded-array order.
CREATE INDEX IF NOT EXISTS idx_pooja_required_materials_pooja_id
  ON pooja_required_materials (pooja_id, position);

-- Deterministic stand-in for the unsorted PoojaMaterialRequirement.find()
-- listing (getAllRequirements applies no sort). The unique pooja_name
-- constraint above already indexes the findOne({ poojaName }) lookup.
CREATE INDEX IF NOT EXISTS idx_pooja_material_requirements_created_at
  ON pooja_material_requirements (created_at ASC, id ASC);

-- The child read performed for every parent load, in embedded-array order.
CREATE INDEX IF NOT EXISTS idx_pooja_material_requirement_items_requirement_id
  ON pooja_material_requirement_items (requirement_id, position);
