-- Phase 2E: bookings (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/Booking.js and its real usages in the application.
-- Primary keys are 24-char hex strings so they remain compatible with existing
-- MongoDB ObjectIds: Bill.sourceId points at bookings (billType 'Pooja Booking',
-- 'Room Booking'), AccountTransaction.referenceId points at bookings with
-- referenceModel = 'Booking' (bookingController status transition recording) and
-- 'PoojaBooking' (devoteeController create/verify flows), and TransferRequest /
-- Notification hold booking IDs as plain reference fields. Monetary values use
-- NUMERIC so booking amounts/gst round-trip exactly.
--
-- Date/time semantics preserved from the Mongo model:
--   * datetime  — the Mongo schema stores this as a String (Mongoose String
--     field, populated by the frontends with ISO-8601 text such as
--     '2026-09-10T06:30:00.000Z' or '2026-09-10T06:30'). It is kept as TEXT so
--     the exact stored form round-trips, mirroring how the controllers treat it
--     (priestController compares new Date(b.datetime) and bookingController
--     rejects past bookings by parsing it, but nothing persists a parsed value
--     back). No timezone conversion is applied at the database layer, which is
--     exactly what Mongo does today.
--   * startedAt / completedAt / approvedAt / rejectedAt / pendingAt /
--     checkinDate / checkoutDate / createdAt / updatedAt — real instants
--     (Mongoose Date) → TIMESTAMPTZ.
--
-- Embedded/nested data:
--   * bookingHistory[] → booking_history child table. It is appended to on
--     every status change (bookingController, priestController) and returned by
--     the receipt endpoint, so it participates in read queries keyed by the
--     booking. Array order matters (most recent entry last, the Mongo array) and
--     is preserved with an incremental position column.
--   * templeMaterialRequests[] → booking_material_requests child table. The
--     priest dashboard reads b.templeMaterialRequests and the inventory code
--     mutates entries in place (adding inventoryRequestId), so the entries are
--     read back keyed by the booking and ordered by position.
--   * items[] → booking_items child table. PoojaManagement renders combined
--     bookings from items[] and receipt generation uses item.price/quantity/
--     date, so array order is preserved with a position column.
--   * snapshotMaterials[] → JSONB. Only ever written once at booking time and
--     read back wholesale (devotee dashboard); no query/filter/join targets the
--     inner fields.
--   * priestChecklist → JSONB. A flat map of boolean flags; always read/written
--     as a whole and never queried by inner field.
--   * poojaRules[] — the Mongo schema declares [String] and the frontend reads it
--     back as an array, so it maps to TEXT[].
--   * priestInstructions — the Mongo schema declares [String], but the create
--     path joins them into a single newline-delimited string, so TEXT preserves
--     the real persisted shape.
--
-- References (devoteeId → User, eventId → Event, assignedPriest → User) remain
-- plain indexed TEXT holding Mongo ObjectId values. Their target tables are
-- either not migrated to PostgreSQL yet (events) or still have MongoDB as the
-- source of truth (users). No foreign keys are created to those referenced
-- entities — consistent with the Phase 2A/2B/2C/2D convention. bills.source_id
-- stays polymorphic TEXT (it also references prasadam orders), and
-- account_transactions.reference_id stays polymorphic TEXT, so no FKs are
-- created to either table from bookings either.

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  devotee_id TEXT,
  event_id TEXT,
  devotee_name TEXT NOT NULL,
  devotee_email TEXT,
  devotee_phone TEXT,
  service TEXT NOT NULL,
  -- The Mongo model declares datetime as a String and the entire application
  -- stores/reads it as text; TEXT preserves the exact persisted form.
  datetime TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  gst NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'UPI',
  payment_status TEXT NOT NULL DEFAULT 'Paid',
  transaction_id TEXT NOT NULL DEFAULT '',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  booking_number TEXT,
  status TEXT NOT NULL DEFAULT 'Completed',
  contact_number TEXT,
  notes TEXT,
  counted BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_priest TEXT,
  priest_name TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completion_remarks TEXT NOT NULL DEFAULT '',
  completion_duration NUMERIC NOT NULL DEFAULT 0,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT NOT NULL DEFAULT '',
  pending_reason TEXT,
  pending_at TIMESTAMPTZ,
  temple_approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  days NUMERIC,
  checkin_date TIMESTAMPTZ,
  checkout_date TIMESTAMPTZ,
  temple_arrangement BOOLEAN NOT NULL DEFAULT FALSE,
  temple_material_charge NUMERIC NOT NULL DEFAULT 0,
  material_status TEXT NOT NULL DEFAULT 'N/A',
  preparation_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  priest_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  pooja_duration TEXT NOT NULL DEFAULT '',
  -- Mongo declares poojaRules as [String] and the frontend reads it back as an
  -- array (DevoteeDashboard), so it maps to a TEXT[] array.
  pooja_rules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  pooja_dress_code TEXT NOT NULL DEFAULT '',
  -- Mongo declares priestInstructions as [String]; the create path joins them
  -- into a single string, so TEXT preserves the actual persisted shape.
  priest_instructions TEXT,
  snapshot_materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_by TEXT NOT NULL DEFAULT '',
  is_combined BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bookings_payment_method_check CHECK (payment_method IN ('UPI', 'Cash', 'Card', 'Bank Transfer', 'Net Banking')),
  CONSTRAINT bookings_payment_status_check CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Refunded')),
  CONSTRAINT bookings_status_check CHECK (status IN ('Booked', 'Pending', 'Approved', 'Confirmed', 'Assigned', 'In Progress', 'Completed', 'Rejected', 'Cancelled', 'Upcoming', 'Transfer Requested', 'Transferred')),
  CONSTRAINT bookings_material_status_check CHECK (material_status IN ('N/A', 'Pending Approval', 'Approved', 'Ready for Collection', 'Issued', 'Acknowledged', 'Consumed', 'Cancelled', 'Pending', 'Reserved', 'Ready')),
  -- Mirrors the Mongo schema's amount: { required: true, min: 0 } and the real
  -- write paths (devoteeController.createBooking, roomRoutes.allotRoom), both of
  -- which reject amounts <= 0 before persisting.
  CONSTRAINT bookings_amount_check CHECK (amount >= 0),
  CONSTRAINT bookings_gst_check CHECK (gst >= 0),
  CONSTRAINT bookings_temple_material_charge_check CHECK (temple_material_charge >= 0),
  CONSTRAINT bookings_completion_duration_check CHECK (completion_duration >= 0),
  CONSTRAINT bookings_days_check CHECK (days IS NULL OR days >= 0),
  -- priestChecklist is a flat map of flags in Mongo; stored as JSONB and kept as
  -- an object (the Mongo sub-document is always an object).
  CONSTRAINT bookings_priest_checklist_object_check CHECK (jsonb_typeof(priest_checklist) = 'object')
);

CREATE TABLE IF NOT EXISTS booking_history (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'Admin',
  note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS booking_material_requests (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  item TEXT,
  item_name TEXT,
  qty TEXT,
  inventory_request_id TEXT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS booking_items (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  -- Preserves the original array order of the Mongo Booking.items[] embedded
  -- array (a mixed/Array field) used by PoojaManagement and the receipt
  -- generator, which render items in the order they were entered.
  position INTEGER NOT NULL DEFAULT 0,
  item_type TEXT,
  item_name TEXT,
  description TEXT,
  quantity NUMERIC,
  price NUMERIC,
  amount NUMERIC,
  date TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

-- Every booking listing (admin getAllBookings, devotee getBookings, dashboard,
-- syncService) sorts by createdAt DESC.
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at DESC);
-- Priest dashboards filter by assignedPriest then often sort by datetime
-- (getAssignedPoojas sorts { datetime: 1 }) or filter status/created_at.
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_priest ON bookings (assigned_priest);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_datetime ON bookings (datetime);
-- devoteeController.getBookings filters by devoteeEmail (buildEmailLookup $in).
CREATE INDEX IF NOT EXISTS idx_bookings_devotee_email ON bookings (devotee_email);
-- verifyBookingPayment falls back to Booking.findOne({ razorpayOrderId }).
CREATE INDEX IF NOT EXISTS idx_bookings_razorpay_order_id ON bookings (razorpay_order_id);
-- Admin getAllBookings date-range filters target created_at; priest completed
-- history filters completedAt.
CREATE INDEX IF NOT EXISTS idx_bookings_completed_at ON bookings (completed_at);
-- roomRoutes checkout matches existing bookings by service text.
CREATE INDEX IF NOT EXISTS idx_bookings_service ON bookings (service);

-- booking_history is read back with the booking (receipt endpoint) and written
-- in order; the child FKs are covered by the composite ordering index.
CREATE INDEX IF NOT EXISTS idx_booking_history_booking_id_position ON booking_history (booking_id, position);
CREATE INDEX IF NOT EXISTS idx_booking_material_requests_booking_id_position ON booking_material_requests (booking_id, position);
CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id_position ON booking_items (booking_id, position);