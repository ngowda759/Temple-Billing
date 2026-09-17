-- Phase 2X: events (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/Event.js and every real usage of the Event model:
--   * Event.js — the Mongoose model: title (String, trim, required), date
--     (Date, required), endDate (Date, optional), location (String, trim,
--     required), description (String, trim, optional), image (String, trim,
--     optional), slots (Number, default 0), registrations (Number, default 0),
--     collection (Number, default 0), status (String, 4-value enum, default
--     'Upcoming'), timestamps. There are NO virtuals, NO embedded
--     sub-documents, NO arrays and NO schema-declared indexes — not even a
--     unique index. The only index Mongo maintains is the automatic _id index.
--   * eventController.js — the dedicated /api/events router:
--       createEvent  (POST /add) validates title/date/location, rejects a date
--       before tomorrow and an endDate earlier than date, then calls
--       Event.create({ ...req.body, endDate: endDate || date }).
--       getEvents    (GET /) runs the auto-complete updateMany below, then
--       Event.find().sort({ date: 1 }).
--       updateEvent  (PUT /:id) findById → conditional field assignment →
--       event.save().
--       updateEventStatus (PATCH /:id/status) findById → status → save().
--   * devoteeController.js — the admin/devotee festival surfaces:
--       getEvents         (GET  /api/devotee/events) auto-complete updateMany,
--                         then Event.find().sort({ date: 1 }).
--       createEvent       (POST /api/devotee/events) the same validation as
--                         eventController plus an explicit eventData object
--                         (image from imageUrl, optional slots/registrations/
--                         collection/status).
--       getFestivalOverview (GET /api/devotee/events/overview) auto-complete
--                         updateMany, three countDocuments
--                         ({ date: { $gte: today } , status: { $nin: [Completed,
--                         Cancelled] } }, { date: { $gte: today, $lt: tomorrow } }
--                         and { date: { $gte: monthStart, $lt: nextMonthStart } })
--                         and two aggregate $group $sum of registrations +
--                         collection (all-time and current-month).
--       updateEventStatus (PATCH /api/devotee/events/:id/status)
--       updateEvent       (PATCH /api/devotee/events/:id) findById →
--                         validation → conditional assignment → save().
--       deleteEvent       (DELETE /api/devotee/events/:id) findByIdAndDelete.
--       plus the linked-booking/donation aggregate bumps — six
--       Event.findByIdAndUpdate(id, { $inc: { registrations: 1, collection: n } })
--       / { $inc: { collection: n } } calls in createBooking,
--       verifyBookingPayment, createDonation, the simulated-donation path,
--       verifyRazorpayPayment, the Razorpay webhook and updateBookingStatus.
--   * Booking.js / Donation.js — eventId (ObjectId, ref 'Event', sparse) is a
--     plain reference used only to drive the $inc bumps above. No populate() is
--     ever issued against it.
--   * frontend/src/pages/admin/FestivalsEventsManagement.jsx,
--     ReportsAnalytics.jsx, cashier/DonationsPage.jsx and the admin/cashier/
--     devotee services read the JSON above (title, date, endDate, location,
--     description, image, registrations, status) and filter/sort client-side.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by eventRepository, reachable through eventPersistenceService)
-- that is selected only when the service is used AND PostgreSQL is reachable.
-- MongoDB stays the source of truth and the fallback path; no Mongo →
-- PostgreSQL switch happens anywhere in the application, no production data is
-- migrated and there are no dual writes.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — events (every persisted Mongo field):
--   * _id           → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * title         → title TEXT NOT NULL (required, trim; CHECK non-empty,
--                     because Mongoose trims before the required check, so a
--                     whitespace-only title is rejected there too)
--   * date          → date TIMESTAMPTZ NOT NULL (required; see the date/time
--                     note below)
--   * endDate       → end_date TIMESTAMPTZ (optional; unset stays NULL)
--   * location      → location TEXT NOT NULL (required, trim; CHECK non-empty,
--                     same trim-then-required rule as title)
--   * description   → description TEXT (optional free text; an explicit empty
--                     string is preserved as '' because Mongoose `trim: true`
--                     keeps '' — only an absent field becomes NULL)
--   * image         → image TEXT (optional; an http(s) URL or a data-URI
--                     banner, same ''-vs-absent rule as description)
--   * slots         → slots NUMERIC NOT NULL DEFAULT 0 (bare Number with no min
--                     and no integer constraint in Mongo → no CHECK and no
--                     integer cast; see the count-type note below)
--   * registrations → registrations NUMERIC NOT NULL DEFAULT 0 (same)
--   * collection    → collection NUMERIC NOT NULL DEFAULT 0 (money — NUMERIC,
--                     never float/double, so the rupee amounts round-trip
--                     exactly; the Phase 2B/2C/2D/2E/2F/2G convention)
--   * status        → status TEXT NOT NULL DEFAULT 'Upcoming', CHECK over
--                     ['Upcoming', 'Active', 'Completed', 'Cancelled'] — the
--                     exact 4-value enum from the Mongo schema
--   * createdAt     → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt     → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 13 columns (id + the 10 schema fields + the two timestamps). The model has no
-- category/type, no start/end time-of-day, no organizer or contact, no
-- attendees/registrations child data, no media array or attachments, no
-- featured flag, no publication state, no slug/event code, no createdBy/
-- updatedBy, no notes, no metadata and no booking/notification reference
-- column. Those concepts appear on other entities but not on Event, so they are
-- deliberately NOT columns and no child table is created — an event is a
-- single-table row.
--
-- Date / time semantics. Event.date and Event.endDate are absolute instants,
-- NOT calendar dates and NOT times of day, so both are TIMESTAMPTZ. There is no
-- date-only and no time-of-day field anywhere on the model, so this migration
-- deliberately declares no DATE and no TIME column. The exact instant stored
-- depends on the write path and is preserved unchanged: the create paths hand
-- Mongoose the raw request string (new Date('2026-05-20') → 00:00Z, i.e. UTC
-- midnight), while devoteeController.updateEvent's endDate branch calls
-- setHours(0,0,0,0) and therefore stores local midnight. Mongoose keeps
-- whichever instant it is given, and so does this table — no normalization,
-- no truncation and no timezone rewriting is introduced. The auto-complete and
-- overview range predicates compare these instants against local-midnight
-- boundaries (todayStart / tomorrowStart / monthStart / nextMonthStart), which
-- TIMESTAMPTZ comparison reproduces exactly.
--
-- Count-type note (slots / registrations). Both are bare `Number` paths with no
-- min, no max and no integer constraint in Mongo, and the write paths coerce
-- with `Number(slots) || 0`, so a fractional value is legal and persisted today.
-- NUMERIC is used rather than INTEGER to preserve that behaviour, following the
-- established precedent for the identical case on rooms.capacity (migration
-- 019: "fractional values are legal in Mongo — no integer cast and no CHECK").
-- An INTEGER column would reject or silently round a value the current API
-- accepts, which this additive migration must not do.
--
-- Status semantics. status is the ONLY lifecycle concept on Event — there is no
-- separate publication flag and no featured flag, so nothing is collapsed into
-- it and no second column is invented. The enum is exactly the four values the
-- schema declares. The automatic Upcoming/Active → Completed transition is
-- applied by the controllers (not by the database) via updateMany, and the
-- default 'Upcoming' mirrors the schema default. No status transition rule is
-- added or removed here.
--
-- Registration / capacity semantics. registrations and slots are scalar
-- counters, not child records: there is no attendee list, no per-registration
-- row, no registration status, no booking reference column and no ordering to
-- preserve. The linked Booking/Donation flows only ever `$inc` these counters.
-- No child table is created, no foreign key is added and no transaction is
-- introduced, because an event is a single-table row and there is no second
-- table that a write could leave partially updated.
--
-- Relationships / foreign keys. Event declares NO outbound reference field, so
-- events has no foreign key. Booking.eventId and Donation.eventId point AT
-- Event, but they live in tables created by migrations 006 and 005, which
-- deliberately keep them as plain indexed TEXT holding Mongo ObjectId values,
-- and deleteEvent performs a bare findByIdAndDelete with no cascading cleanup
-- anywhere. Adding an inbound FK would therefore both alter an already-released
-- migration and introduce RESTRICT/CASCADE semantics the application does not
-- have today (it currently leaves orphaned eventId values behind). No FK is
-- created in either direction, and no ON DELETE behaviour is invented.
--
-- Indexes. The Mongo schema declares NO index, so these two are deliberate,
-- query-justified additions rather than a reproduction of an existing index:
--   * idx_events_date serves the standing ascending listing sort
--     (Event.find().sort({ date: 1 })) that both getEvents handlers apply, plus
--     the date range predicates in the overview counts and aggregates.
--   * idx_events_status_date serves the auto-complete updateMany, whose filter
--     is { date: { $lt: todayStart }, status: { $in: ['Upcoming', 'Active'] } }.
-- No index is added for slots / registrations / collection / image / title /
-- description / location: no query in the application filters or sorts on them
-- (the admin grid filters client-side), so an index there would be speculative.

CREATE TABLE IF NOT EXISTS events (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: title String — required, trim.
  title TEXT NOT NULL,
  -- Mongo: date Date — required. An absolute instant, never a calendar date.
  date TIMESTAMPTZ NOT NULL,
  -- Mongo: endDate Date — optional; unset stays NULL.
  end_date TIMESTAMPTZ,
  -- Mongo: location String — required, trim.
  location TEXT NOT NULL,
  -- Mongo: description String — optional; '' is preserved, absent becomes NULL.
  description TEXT,
  -- Mongo: image String — optional URL/data-URI; '' preserved, absent NULL.
  image TEXT,
  -- Mongo: slots Number — default 0, bare Number (no min, no integer cast).
  slots NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: registrations Number — default 0, bare Number.
  registrations NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: collection Number — default 0. Money, so NUMERIC.
  collection NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: status String — 4-value enum, default 'Upcoming'.
  status TEXT NOT NULL DEFAULT 'Upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongoose runs `trim: true` before the `required: true` check, so a
  -- whitespace-only title/location is rejected there as well. The repository
  -- trims before insert, so these CHECKs reproduce exactly what Mongo already
  -- rejects and narrow no value the application can currently persist.
  CONSTRAINT events_title_check CHECK (title <> ''),
  CONSTRAINT events_location_check CHECK (location <> ''),
  -- The exact enum from Event.js. No other status value is reachable: both
  -- updateEventStatus handlers validate against this list before writing and
  -- updateEvent only assigns a status inside the same list.
  CONSTRAINT events_status_check CHECK (status IN ('Upcoming', 'Active', 'Completed', 'Cancelled'))
);

-- The standing ascending listing sort applied by eventController.getEvents and
-- devoteeController.getEvents, and the date range predicates used by
-- getFestivalOverview's counts and aggregates.
CREATE INDEX IF NOT EXISTS idx_events_date
  ON events (date);

-- The auto-complete updateMany filter
-- { date: { $lt: todayStart }, status: { $in: ['Upcoming', 'Active'] } } run by
-- both getEvents handlers and by getFestivalOverview.
CREATE INDEX IF NOT EXISTS idx_events_status_date
  ON events (status, date);
