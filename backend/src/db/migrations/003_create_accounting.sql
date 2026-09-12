-- Phase 2B: account_heads + account_transactions (MongoDB → PostgreSQL migration).
-- Mirrors backend/src/models/AccountHead.js and backend/src/models/AccountTransaction.js.
-- Primary keys are 24-char hex strings so they remain compatible with existing MongoDB
-- ObjectIds (notably AccountTransaction.referenceId, AccountHead.createdBy,
-- AccountTransaction.cashierId/recordedBy/approvedBy). Monetary values use NUMERIC.

CREATE TABLE IF NOT EXISTS account_heads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_heads_name_key UNIQUE (name),
  CONSTRAINT account_heads_type_check CHECK (type IN ('Income', 'Expense'))
);

CREATE INDEX IF NOT EXISTS idx_account_heads_type ON account_heads (type);
CREATE INDEX IF NOT EXISTS idx_account_heads_is_active ON account_heads (is_active);
CREATE INDEX IF NOT EXISTS idx_account_heads_created_at ON account_heads (created_at DESC);

CREATE TABLE IF NOT EXISTS account_transactions (
  id TEXT PRIMARY KEY,
  transaction_type TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  financial_year TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'System',
  status TEXT NOT NULL DEFAULT 'Completed',
  description TEXT,
  receipt_number TEXT,
  invoice_number TEXT,
  reference_id TEXT,
  reference_model TEXT,
  bank_name TEXT,
  cashier_id TEXT,
  cashier_name TEXT,
  recorded_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_transactions_transaction_type_check CHECK (transaction_type IN ('Credit', 'Debit')),
  CONSTRAINT account_transactions_source_check CHECK (source IN ('Pooja Booking', 'Donation', 'Room Booking', 'Prasadam', 'Payroll', 'Manual Entry', 'Bank Interest', 'Inventory', 'Asset', 'Repair', 'Kitchen', 'Cleaning')),
  CONSTRAINT account_transactions_payment_method_check CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'System')),
  CONSTRAINT account_transactions_status_check CHECK (status IN ('Pending Approval', 'Approved', 'Completed', 'Cancelled', 'Rejected')),
  CONSTRAINT account_transactions_reference_model_check CHECK (
    reference_model IN ('Booking', 'PoojaBooking', 'Donation', 'Room', 'PrasadamOrder', 'PayrollRecord', 'BankInterest', 'RestockHistory', 'Asset', 'RepairRequest', 'InventoryItem', 'InventoryIssue', 'PurchaseOrder', 'GoodsReceivedNote', 'DamageNote', 'RepairTicket', 'Bill')
    OR reference_model IS NULL
  ),
  -- Financially meaningless records must not exist. The Mongo model declares min: 0,
  -- and every real write path (accountingService.recordTransaction) already rejects
  -- amounts <= 0, so NUMERIC amount > 0 preserves existing semantics at the DB level.
  CONSTRAINT account_transactions_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_account_transactions_date ON account_transactions (date DESC);
CREATE INDEX IF NOT EXISTS idx_account_transactions_financial_year ON account_transactions (financial_year);
CREATE INDEX IF NOT EXISTS idx_account_transactions_status ON account_transactions (status);
CREATE INDEX IF NOT EXISTS idx_account_transactions_source ON account_transactions (source);
CREATE INDEX IF NOT EXISTS idx_account_transactions_transaction_type ON account_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_account_transactions_financial_year_status ON account_transactions (financial_year, status);
CREATE INDEX IF NOT EXISTS idx_account_transactions_reference ON account_transactions (reference_model, reference_id);
CREATE INDEX IF NOT EXISTS idx_account_transactions_recorded_by ON account_transactions (recorded_by);
CREATE INDEX IF NOT EXISTS idx_account_transactions_cashier_id ON account_transactions (cashier_id);
CREATE INDEX IF NOT EXISTS idx_account_transactions_created_at ON account_transactions (created_at DESC);

-- Reference columns (created_by, cashier_id, recorded_by, approved_by, reference_id)
-- remain plain indexed TEXT: they hold MongoDB-style ObjectId values whose target
-- tables (users, bookings, donations, …) are not fully migrated to PostgreSQL yet.
-- Real foreign keys will be added by the later financial migration once those tables
-- exist and the accounts layer is cut over. This mirrors the Phase 2A convention.