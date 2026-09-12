-- Phase 2G: prasadam_orders (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/PrasadamOrder.js and its real usages in the
-- application (devoteeController createPrasadamOrder/getPrasadamOrders/
-- verifyPrasadamPayment/cancelPrasadamOrder, prasadamAdminController
-- getAdminPrasadamOrders/updateAdminPrasadamOrderStatus/deleteAdminPrasadamOrder,
-- prasadamController.getSalesReports aggregates, syncService.syncLedgerBills).
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by the PostgreSQL repository) that is selected only when the
-- Prasadam Order service/repository is explicitly used AND PostgreSQL is
-- reachable. MongoDB stays the source of truth and the fallback path; no
-- Mongo → Postgres switch happens anywhere in the application.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing PrasadamOrder model. Bills point
-- at prasadam orders through bill.source_id, and account_transactions point at
-- them through reference_id/reference_model = 'PrasadamOrder'; both of those
-- columns stay polymorphic TEXT (they also reference bookings, donations and
-- pooja bookings), so no FK is created either way — same convention as phases
-- 2A–2F. Monetary values use NUMERIC so amounts round-trip exactly.
--
-- Enums (from the Mongo schema, preserved exactly — no extra values):
--   * channel: ['devotee', 'cashier'] — default 'devotee'.
--   * paymentMethod: ['UPI', 'Cash', 'Card', 'Bank Transfer', 'Net Banking',
--     'Debit Card', 'Credit Card'] — default 'UPI'.
--   * status: ['Collected', 'Not Collected', 'Pending', 'Approved', 'Rejected',
--     'Processing', 'Ready for Pickup', 'Completed', 'Cancelled', 'Placed',
--     'Preparing', 'Ready', 'Delivered'] — default 'Not Collected'.
--
-- razorpay fields are plain nullable TEXT (the Mongo model declares them
-- optional + trim); they are part of the PrasadamOrder entity, so the
-- PostgreSQL path can carry them like any other field.
--
-- References stay plain indexed TEXT:
--   * devoteeId → User: users keeps MongoDB as the source of truth (Phase 2A);
--     no FK. Intentionally nullable (Mongo `sparse: true`).
--   * No FK to bills or account_transactions (see above).

CREATE TABLE IF NOT EXISTS prasadam_orders (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'devotee',
  devotee_id TEXT,
  devotee_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'UPI',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  -- status default mirrors the Mongo model exactly: 'Not Collected'.
  status TEXT NOT NULL DEFAULT 'Not Collected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prasadam_orders_channel_check CHECK (channel IN ('devotee', 'cashier')),
  CONSTRAINT prasadam_orders_payment_method_check CHECK (payment_method IN ('UPI', 'Cash', 'Card', 'Bank Transfer', 'Net Banking', 'Debit Card', 'Credit Card')),
  CONSTRAINT prasadam_orders_status_check CHECK (status IN ('Collected', 'Not Collected', 'Pending', 'Approved', 'Rejected', 'Processing', 'Ready for Pickup', 'Completed', 'Cancelled', 'Placed', 'Preparing', 'Ready', 'Delivered')),
  -- The Mongo schema declares quantity min: 1, unitPrice/amount min: 0.
  CONSTRAINT prasadam_orders_quantity_check CHECK (quantity >= 1),
  CONSTRAINT prasadam_orders_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT prasadam_orders_amount_check CHECK (amount >= 0)
);

-- Every prasadam order listing sorts by createdAt DESC and filters by
-- channel/status/createdAt range (admin orders table, devotee orders page).
CREATE INDEX IF NOT EXISTS idx_prasadam_orders_created_at ON prasadam_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prasadam_orders_channel ON prasadam_orders (channel);
-- prasadamAdminController order status + search columns.
CREATE INDEX IF NOT EXISTS idx_prasadam_orders_status ON prasadam_orders (status);
CREATE INDEX IF NOT EXISTS idx_prasadam_orders_devotee_id ON prasadam_orders (devotee_id);
CREATE INDEX IF NOT EXISTS idx_prasadam_orders_email ON prasadam_orders (email);
-- prasadamController.getSalesReports aggregates by createdAt and itemName.
CREATE INDEX IF NOT EXISTS idx_prasadam_orders_item_name ON prasadam_orders (item_name);