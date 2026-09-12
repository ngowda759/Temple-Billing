-- Phase 2D: donations (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/Donation.js and its real usages in the application.
-- Primary keys are 24-char hex strings so they remain compatible with existing
-- MongoDB ObjectIds (notably Bill.sourceId and AccountTransaction.referenceId,
-- both of which point at donations with referenceModel = 'Donation'). Monetary
-- values use NUMERIC so donation amounts round-trip exactly (the Mongo model
-- stores amount as a JS Number, but every real write path accepts arbitrary
-- rupee/paise values and the Phase 2B/2C convention is NUMERIC for money).

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  donor_name TEXT NOT NULL,
  donor_email TEXT,
  contact_number TEXT,
  donor_phone TEXT,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  payment_method TEXT NOT NULL DEFAULT 'UPI',
  transaction_id TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  event_id TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Not Collected',
  donated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT donations_payment_method_check CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Bank Transfer', 'Debit Card', 'Credit Card', 'Net Banking')),
  CONSTRAINT donations_status_check CHECK (status IN ('Collected', 'Not Collected', 'Completed', 'Pending', 'Failed')),
  -- The Mongo schema declares `amount: { min: 0 }`, but every real write path
  -- (donationController.createDonation, devoteeController.createDonation,
  -- createRazorpayOrder) already rejects amounts <= 0, so a strictly positive
  -- NUMERIC preserves the application's actual semantics at the DB level.
  -- This mirrors the Phase 2B account_transactions.amount_check decision.
  CONSTRAINT donations_amount_check CHECK (amount > 0)
);

-- Every donation listing (admin, devotee, stats, sync) sorts by createdAt DESC.
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations (created_at DESC);
-- devoteeController.getDonations filters by donorEmail (via buildEmailLookup).
CREATE INDEX IF NOT EXISTS idx_donations_donor_email ON donations (donor_email);
-- Razorpay order lookup in verifyRazorpayPayment and handleRazorpayWebhook.
CREATE INDEX IF NOT EXISTS idx_donations_razorpay_order_id ON donations (razorpay_order_id);

-- Reference columns (event_id → Event, donated_by → User) remain plain indexed
-- TEXT: they hold MongoDB-style ObjectId values whose target tables are either
-- not migrated to PostgreSQL yet (events) or still have MongoDB as the source of
-- truth (users' PG table is populated separately from the live Mongo data). Real
-- foreign keys will be added by the later cutover phase once every referenced
-- entity exists in PostgreSQL and the data is backfilled. This mirrors the
-- Phase 2A/2B convention. No column on donations points at bills: the
-- donation → bill relationship is expressed by Bill.sourceId = donation._id,
-- and bills.source_id remains polymorphic (it also references bookings and
-- prasadam orders that are still Mongo-backed), so no FK is created here.