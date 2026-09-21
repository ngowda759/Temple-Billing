-- Phase 2AH: cash_closings (MongoDB → PostgreSQL migration).
--
-- Numbered 031 rather than 030 deliberately. 030 is already claimed by
-- 030_create_tasks.sql on the sibling Phase 2AH branch
-- (phase-2ah-mongo-only-model-audit / PR #36). Two files sharing the 030 prefix
-- is the same collision 028→029 had to be renumbered for: the runner sorts
-- filenames (migrate.js), so a shared prefix makes the apply order ambiguous.
--
-- The final sequence is deterministic once both branches are merged:
--
--     029_create_audit_logs.sql
--     030_create_tasks.sql          (sibling Phase 2AH branch)
--     031_create_cash_closings.sql  (this migration)
--
-- The gap at 030 on this branch alone is temporary and harmless — the sibling
-- branch fills it. There is no duplicate number in either the merged tree or
-- this branch, and schema_migrations records filenames, not sequence numbers,
-- so the temporary gap cannot corrupt migration state. Verified against the
-- merged tree: 31 migrations, applied in order, no duplicate prefix.
--
-- Mirrors backend/src/models/CashClosing.js and every real usage of the
-- CashClosing model. Before this phase the domain had NO repository and NO
-- service — the entire persistence surface was three controller handlers in
-- accountController.js.
--
--   * CashClosing.js — the Mongoose model. Persisted paths (14 + timestamps):
--     date (Date, required, NO default),
--     openingCash (Number, required, default 0),
--     cashCollected (Number, required, default 0),
--     upiCollected (Number, default 0),
--     cardCollected (Number, default 0),
--     bankTransferCollected (Number, default 0),
--     totalSystemCollection (Number, default 0),
--     cashDeposited (Number, default 0),
--     closingCash (Number, required, NO default),
--     discrepancy (Number, default 0),
--     notes (String, optional, NO default),
--     status (String, enum, default 'Pending Verification'),
--     recordedBy (ObjectId ref 'User', required),
--     verifiedBy (ObjectId ref 'User', optional).
--     The model declares NO index of any kind, NO hook, NO virtual, NO
--     sub-document and NO unique constraint.
--
--   * accountController.js — the ONLY consumer, via three mounted routes
--     (mounted at /api/accounts by app.js):
--       getCashClosings   GET  /api/accounts/cash-closing
--         (admin, accountant, cashier)
--         CashClosing.find().sort({ date: -1 })
--           .populate('recordedBy', 'name').populate('verifiedBy', 'name')
--       submitCashClosing POST /api/accounts/cash-closing
--         (cashier, accountant) — see the calculation note below
--       verifyCashClosing PUT  /api/accounts/cash-closing/:id/verify
--         (accountant) — status + verifiedBy, then save()
--     No scheduled job, no aggregation pipeline and no dashboard/report reads
--     this model. Every other accounting endpoint reads only
--     AccountTransaction (through accountTransactionService).
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by cashClosingRepository, reachable through cashClosingService)
-- that is selected only when the service is used AND PostgreSQL is reachable.
-- MongoDB stays the source of truth and the fallback path; no Mongo →
-- PostgreSQL switch happens anywhere in the application, there are no dual
-- writes and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Nullability and defaults are transcribed from the model's ACTUAL validator
-- behaviour, verified by compiling the real schema, not from the presence of
-- the `required` keyword alone. Mongoose distinguishes four cases here and the
-- table reproduces all four:
--   * `required: true` + `default` (openingCash, cashCollected)
--       → an omitted value is filled by the default and validates; an explicit
--         null or '' FAILS the required validator. The column is therefore
--         NOT NULL DEFAULT 0.
--   * `default` only (the six derived/optional money paths)
--       → an omitted value is filled by the default, and an explicit null is
--         ACCEPTED and stored as null (no required validator). The column is
--         therefore NULLABLE DEFAULT 0 — NOT NULL would reject payloads
--         MongoDB stores.
--   * `required: true` with NO default (date, closingCash, recordedBy)
--       → an omitted value FAILS validation. The column is NOT NULL with NO
--         default, so PostgreSQL rejects the same writes MongoDB rejects.
--   * neither (notes, verifiedBy)
--       → NULL with no default; the property stays undefined on a Mongo read,
--         which the repository reproduces by returning undefined rather than
--         null.
-- `status` is the fifth case: `default` plus an enum, but NOT required. It is
-- NULLABLE DEFAULT 'Pending Verification': an omitted value becomes the default,
-- while an explicit null validates in Mongo and is stored as null.
-- (This is reachable — verifyCashClosing passes req.body.status straight
-- through with no validation, so `{"status": null}` succeeds on the Mongo path.
-- Making the column NOT NULL would turn that 200 into a 500.)
--
-- Mongo → PostgreSQL field mapping — cash_closings (every persisted field):
--   * _id                    → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * date                   → date TIMESTAMPTZ NOT NULL (required, no default)
--   * openingCash            → opening_cash NUMERIC NOT NULL DEFAULT 0
--   * cashCollected          → cash_collected NUMERIC NOT NULL DEFAULT 0
--   * upiCollected           → upi_collected NUMERIC DEFAULT 0
--   * cardCollected          → card_collected NUMERIC DEFAULT 0
--   * bankTransferCollected  → bank_transfer_collected NUMERIC DEFAULT 0
--   * totalSystemCollection  → total_system_collection NUMERIC DEFAULT 0
--   * cashDeposited          → cash_deposited NUMERIC DEFAULT 0
--   * closingCash            → closing_cash NUMERIC NOT NULL (required, no default)
--   * discrepancy            → discrepancy NUMERIC DEFAULT 0
--   * notes                  → notes TEXT
--   * status                 → status TEXT DEFAULT 'Pending Verification' (nullable)
--   * recordedBy             → recorded_by TEXT NOT NULL
--   * verifiedBy             → verified_by TEXT
--   * createdAt              → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt              → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 17 columns (id + the 14 schema fields + the two timestamps). The model has no
-- `expectedClosing`, no `expectedCash`, no `variance` and no `cashierId`; those
-- names must NOT be added. `discrepancy` is the variance concept, and the
-- expected closing balance is a LOCAL VARIABLE inside submitCashClosing that is
-- calculated for the discrepancy and the audit-log string but never persisted.
--
-- MONEY COLOUR: every monetary/amount column is plain NUMERIC with no
-- precision and no scale. The application performs plain JavaScript Number
-- (IEEE-754) arithmetic and imposes no rounding and no range constraint, so
-- NUMERIC(12,2) or any fixed scale would introduce a rounding rule and an
-- overflow limit the existing behaviour does not have. Plain NUMERIC stores the
-- value the application computed without narrowing it.
--
-- `discrepancy` is SIGNED and may legitimately be negative: it is
-- `Number(closingCash) - expectedClosing`, which is negative whenever the
-- physical count is short. No CHECK constrains it, and none is added.
--
-- TIMEZONE: `date` is TIMESTAMPTZ (not DATE) because the controller derives it
-- with `targetDate.setHours(0,0,0,0)` in the SERVER's local timezone. A DATE
-- column would discard that instant and re-read it differently. No conversion
-- is introduced.
--
-- Uniqueness: NONE, deliberately. The model declares no unique index and
-- submitCashClosing performs a bare `new CashClosing({...}).save()` with no
-- pre-check, so two submissions for the same cashier and the same day both
-- persist. Adding UNIQUE (recorded_by, date) — or any per-day uniqueness —
-- would introduce a business rule the application does not enforce today. If
-- one-closing-per-cashier-per-day is ever wanted it is a separate business-rule
-- change, not part of this migration.
--
-- Foreign keys: NONE, deliberately. `recordedBy` / `verifiedBy` are ObjectId
-- references to User that the application resolves only through Mongoose
-- populate, which leaves the path null when the referenced row is gone. A real
-- FK would (a) change delete semantics for users and (b) force an INNER-JOIN
-- style relationship the application does not have. The repository reproduces
-- populate with a LEFT JOIN, exactly as auditLogRepository does.

CREATE TABLE IF NOT EXISTS cash_closings (
  id TEXT PRIMARY KEY,
  -- Mongo: date Date — required, NO default. Stored as the local-midnight
  -- instant the controller computes.
  date TIMESTAMPTZ NOT NULL,
  -- Mongo: openingCash Number — required, default 0.
  opening_cash NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: cashCollected Number — required, default 0. SERVER-COMPUTED: the
  -- controller recomputes it from AccountTransaction and never reads the
  -- client-posted value, so this column always holds the authoritative figure.
  cash_collected NUMERIC NOT NULL DEFAULT 0,
  -- Mongo: upiCollected Number — default 0, NOT required: an explicit null is
  -- accepted by Mongo and must remain accepted here.
  upi_collected NUMERIC DEFAULT 0,
  -- Mongo: cardCollected Number — default 0, not required.
  card_collected NUMERIC DEFAULT 0,
  -- Mongo: bankTransferCollected Number — default 0, not required.
  bank_transfer_collected NUMERIC DEFAULT 0,
  -- Mongo: totalSystemCollection Number — default 0, not required. Sum of the
  -- four buckets above, stored as computed (not derived on read).
  total_system_collection NUMERIC DEFAULT 0,
  -- Mongo: cashDeposited Number — default 0, not required.
  cash_deposited NUMERIC DEFAULT 0,
  -- Mongo: closingCash Number — required, NO default. An omitted value fails
  -- validation in Mongo, so it is NOT NULL with no default here.
  closing_cash NUMERIC NOT NULL,
  -- Mongo: discrepancy Number — default 0, not required. Signed; may be
  -- negative. No CHECK.
  discrepancy NUMERIC DEFAULT 0,
  -- Mongo: notes String — optional, NO default (stays undefined on a read).
  notes TEXT,
  -- Mongo: status String — enum, default 'Pending Verification', NOT required.
  -- NULLABLE: `default` fires only on an omitted value, so an explicit null
  -- (which verifyCashClosing can send straight from req.body) validates and is
  -- stored as null in Mongo. NOT NULL here would reject that write. The CHECK
  -- below still evaluates to NULL — i.e. passes — for a null status, which is
  -- exactly the Mongo enum behaviour.
  status TEXT DEFAULT 'Pending Verification',
  -- Mongo: recordedBy ObjectId ref 'User' — required. Plain indexed TEXT, no
  -- FK (see header). Stored as the 24-hex id string.
  recorded_by TEXT NOT NULL,
  -- Mongo: verifiedBy ObjectId ref 'User' — optional, set by verifyCashClosing.
  verified_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the model's `status` enum. MongoDB rejects an out-of-enum status
  -- on write, so PostgreSQL reproduces the same value set.
  CONSTRAINT cash_closings_status_check CHECK (
    status IN ('Pending Verification', 'Verified', 'Disputed')
  )
);

-- It is intentional that this table carries exactly ZERO CONSTRAINT beyond the
-- primary key, the status CHECK and the NOT NULLs. In particular there is no
-- UNIQUE constraint and no foreign key, because the Mongo schema declares
-- neither and adding one would introduce a rule the application lacks.

-- getCashClosings: CashClosing.find().sort({ date: -1 }) — the only ordering
-- the domain uses, and the only listing endpoint.
CREATE INDEX IF NOT EXISTS idx_cash_closings_date ON cash_closings (date DESC);

-- submitCashClosing scopes its collection lookup to the submitting cashier
-- (recordedBy), and getCashClosings' populate resolves recordedBy through a
-- LEFT JOIN on the same column.
CREATE INDEX IF NOT EXISTS idx_cash_closings_recorded_by ON cash_closings (recorded_by);

-- verifyCashClosing loads a closing by id and then writes status + verifiedBy;
-- the verification queue is the (day, status) slice of this table. This is an
-- additive access-pattern index only — it is NOT a uniqueness constraint.
CREATE INDEX IF NOT EXISTS idx_cash_closings_date_status ON cash_closings (date DESC, status);
