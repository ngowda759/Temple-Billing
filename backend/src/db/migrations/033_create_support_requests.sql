-- Phase 2AH: support_requests (MongoDB → PostgreSQL migration).
--
-- Numbered 033 to follow 032_create_suppliers.sql. The prefix sequence is
-- continuous and collision-free:
--
--     030_create_tasks.sql
--     031_create_cash_closings.sql
--     032_create_suppliers.sql
--     033_create_support_requests.sql   (this migration)
--
-- migrate.js sorts filenames, so a duplicate prefix would make the apply order
-- ambiguous — the 028→029 and 030→031 renumberings exist to avoid exactly that.
--
-- Mirrors backend/src/models/SupportRequest.js and every real usage of the
-- SupportRequest model. Before this phase the domain had NO repository and NO
-- service — the entire persistence surface was four controller handlers in
-- devoteeController.js, reachable from four mounted routes.
--
--   * SupportRequest.js — the Mongoose model. Persisted paths:
--     name (String, required, trim),
--     email (String, required, trim),
--     subject (String, required, trim),
--     message (String, required, trim),
--     reply (String, trim, optional),
--     status (String, enum ['Open','In Progress','Closed'], default 'Open'),
--     read (Boolean, default false),
--     timestamps.
--     The model declares NO index of any kind, NO hook, NO virtual, NO
--     sub-document, NO unique constraint, NO ObjectId reference and no
--     validation beyond the four `required: true` paths and the status enum.
--
--   * devoteeController.js — the ONLY consumer, via four mounted routes
--     (devoteeRoutes is mounted at BOTH /api/devotee and /api/devotees by
--     app.js; the routes carry NO auth middleware):
--       submitSupportRequest       POST  /support
--         SupportRequest.create({ name, email, subject, message }) — the
--         controller 400s unless subject AND message are present, then defaults
--         name to 'Anonymous Devotee' and email to 'support@devotee.com' when
--         absent. It then creates a Notification ("New Support Request") through
--         notificationPersistenceService.
--       getSupportRequests         GET   /support
--         SupportRequest.find(filter).sort({ createdAt: -1 }) where filter is
--         { email } when the optional ?email= query is present (trimmed and
--         lowercased by the controller) and {} otherwise. No pagination.
--       replySupportRequest        PATCH /support/:id
--         SupportRequest.findById(id), sets reply = String(reply).trim(),
--         sets status from the body ONLY when it is one of the three enum
--         values and otherwise forces 'Closed', then save(). It then creates a
--         Notification ("Feedback Response") scoped to the request's email.
--       markSupportRequestAsRead   PATCH /support/:id/read
--         SupportRequest.findByIdAndUpdate(id, { read: true }, { new: true }).
--     There is NO delete handler at any layer — support requests are never
--     deleted through the application.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by supportRequestRepository, reachable through
-- supportRequestService) that is selected only when the service is used AND
-- PostgreSQL is reachable. MongoDB stays the source of truth and the fallback
-- path; no Mongo → PostgreSQL switch happens anywhere in the application, there
-- are no dual writes and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — support_requests (every persisted field):
--   * _id       → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * name      → name TEXT NOT NULL (required, trim, NO default)
--   * email     → email TEXT NOT NULL (required, trim, NO default)
--   * subject   → subject TEXT NOT NULL (required, trim, NO default)
--   * message   → message TEXT NOT NULL (required, trim, NO default)
--   * reply     → reply TEXT (optional, trim, NO default)
--   * status    → status TEXT DEFAULT 'Open' (nullable — see below)
--   * read      → read BOOLEAN DEFAULT false (nullable — see below)
--   * createdAt → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Nullability and defaults are transcribed from the model's ACTUAL validator
-- behaviour, verified by compiling the real schema (not from the presence of
-- the `required` keyword alone). Mongoose distinguishes three cases here and
-- the table reproduces all three:
--   * `required: true` + `trim` (name, email, subject, message)
--       → an omitted, empty, null or whitespace-only value FAILS validation
--         (trim runs before the required check, so '   ' collapses to '' and
--         fails). The columns are therefore NOT NULL with NO default, so
--         PostgreSQL rejects the same writes MongoDB rejects.
--   * `default` + trim/Boolean, NOT required (status, read)
--       → an OMITTED value is filled by the default and validates, while an
--         explicit null is ACCEPTED and stored as null (the default fires only
--         for an omitted value, and there is no required validator). The columns
--         are therefore NULLABLE DEFAULT — NOT NULL would reject a payload
--         MongoDB stores. The CHECK below still evaluates to NULL — i.e. passes
--         — for a null status, which is exactly the Mongo enum behaviour.
--   * neither (reply)
--       → NULL with no default. It stays undefined on a Mongo read until a
--         reply is written.
--     Note that this nullability for status/read is only observable by calling
--     the service or repository directly: the live controller never sends null
--     for either (it omits them on create and always sends concrete values on
--     reply). It exists to keep the two datasources faithful, not to serve a
--     current client.
--
-- TEXT is used for every field. The Mongoose schema declares all five text
-- paths as Strings, so numeric input is cast by Mongoose (e.g. `email: 12345`
-- stores '12345'). Nothing in the codebase validates an email format, so no
-- email CHECK is introduced: a CHECK would make PostgreSQL stricter than the
-- source of truth. The repository casts the same way rather than rejecting.
--
-- Uniqueness: NONE, deliberately. The model declares no unique index and
-- submitSupportRequest performs a bare create with no pre-check, so two requests
-- may legitimately share an email (a devotee can raise many requests), a subject
-- or any other value. Adding UNIQUE(email) — or uniqueness on any other column —
-- would introduce a business rule the application does not enforce today.
--
-- Foreign keys: NONE, and none are added anywhere else. The requester is a raw
-- email string, not a User or Employee reference; SupportRequest holds no
-- ObjectId at all. Nothing references support_requests either, so no existing
-- table gains a foreign key.
--
-- CHECK constraints: exactly ONE, on `status`, mirroring the model's enum. No
-- CHECK is placed on any other column, and no column carries a length limit,
-- because the Mongoose schema declares none.

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  -- Mongo: name String — required, trim. NO default: an omitted/blank value
  -- fails Mongoose validation, so PostgreSQL rejects it too.
  name TEXT NOT NULL,
  -- Mongo: email String — required, trim. NO default. NOT unique, and NOT
  -- lowercased: the model stores the value verbatim (the GET filter lowercases
  -- only the query).
  email TEXT NOT NULL,
  -- Mongo: subject String — required, trim. NO default.
  subject TEXT NOT NULL,
  -- Mongo: message String — required, trim. NO default.
  message TEXT NOT NULL,
  -- Mongo: reply String — optional, trim, NO default. NULL until an admin
  -- replies.
  reply TEXT,
  -- Mongo: status String — enum, default 'Open', NOT required. NULLABLE: an
  -- omitted value becomes the default, while an explicit null validates in Mongo
  -- and is stored as null.
  status TEXT DEFAULT 'Open',
  -- Mongo: read Boolean — default false, NOT required. NULLABLE for the same
  -- reason as status: an explicit null is accepted and stored as null.
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mirrors the model's `status` enum. MongoDB rejects an out-of-enum status, so
  -- PostgreSQL does the same. A null status passes (the predicate is NULL),
  -- matching Mongo's enum behaviour on a non-required path.
  CONSTRAINT support_requests_status_check
    CHECK (status IN ('Open', 'In Progress', 'Closed'))
);

-- getSupportRequests: SupportRequest.find(...).sort({ createdAt: -1 }) — the
-- only ordering the domain has, and the index the default listing walks. The
-- DEFAULT_ORDER tiebreaker in the repository is id, which is covered because
-- id is the primary key.
CREATE INDEX IF NOT EXISTS idx_support_requests_created_at
  ON support_requests (created_at DESC);

-- getSupportRequests with a devotee email: SupportRequest.find({ email }) where
-- the controller has already lowercased the query. A plain (non-functional)
-- index is used because the stored value is NOT lowercased by the model, so a
-- functional index would not match the column's actual contents. This mirrors
-- the model's own lack of an email index without claiming an equality the
-- schema does not provide.
CREATE INDEX IF NOT EXISTS idx_support_requests_email ON support_requests (email);
