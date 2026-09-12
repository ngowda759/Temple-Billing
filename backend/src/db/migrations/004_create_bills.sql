-- Phase 2C: bills + bill_items (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/Bill.js and its usages in the application.
-- Primary keys are 24-char hex strings so they remain compatible with existing
-- MongoDB ObjectIds (notably Bill.sourceId references, and the polymorphic
-- reference_id/reference_model values on account_transactions and other models).
-- Monetary values use NUMERIC so bill/bill-item amounts round-trip exactly.
--
-- Normalization: the Mongo Bill embeds items as an array of sub-documents
-- (items[].itemType/items[].itemName/items[].amount). Those are normalized into
-- the relational bill_items table joined by bills.id via a real foreign key.

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  devotee_name TEXT NOT NULL,
  devotee_email TEXT,
  devotee_phone TEXT,
  devotee_address TEXT,
  seva_type TEXT,
  amount NUMERIC NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'Cash',
  bill_type TEXT NOT NULL DEFAULT 'Other',
  reference_no TEXT,
  source_id TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Paid',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  bill_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bills_payment_mode_check CHECK (payment_mode IN ('Cash', 'UPI', 'Card', 'Bank Transfer', 'Net Banking', 'Debit Card', 'Credit Card')),
  CONSTRAINT bills_status_check CHECK (status IN ('Paid', 'Pending', 'Cancelled')),
  -- Mirrors the Mongo schema's `amount: { min: 1 }`: a bill must have a
  -- positive amount of at least one unit. Item amounts are unrestricted,
  -- matching the unconstrained embedded items[].amount in the Mongo model.
  CONSTRAINT bills_amount_check CHECK (amount >= 1)
);

CREATE TABLE IF NOT EXISTS bill_items (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  -- Preserves the original array order of the Mongo Bill.items[] embedded
  -- documents: the receipt generator and the cashier UI render items in the
  -- order they were entered.
  position INTEGER NOT NULL DEFAULT 0,
  item_type TEXT,
  item_name TEXT,
  amount NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT bill_items_item_type_check CHECK (item_type IN ('Pooja', 'Donation', 'Prasadam', 'Room', 'Other'))
);

CREATE INDEX IF NOT EXISTS idx_bills_bill_date ON bills (bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_bills_reference_no ON bills (reference_no);
CREATE INDEX IF NOT EXISTS idx_bills_source_id ON bills (source_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills (status);
CREATE INDEX IF NOT EXISTS idx_bills_bill_type ON bills (bill_type);
CREATE INDEX IF NOT EXISTS idx_bills_payment_mode ON bills (payment_mode);
CREATE INDEX IF NOT EXISTS idx_bills_razorpay_order_id ON bills (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id_position ON bill_items (bill_id, position);