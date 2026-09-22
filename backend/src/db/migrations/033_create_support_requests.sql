-- Phase 2AH: support_requests (MongoDB → PostgreSQL migration).
--
-- Numbered 033 to follow 032_create_suppliers.sql. The prefix sequence is
-- continuous and collision-free:
--
--     029_create_audit_logs.sql
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
-- devoteeController.js.
--
--   * SupportRequest.js — the Mongoose model. Persisted paths (7 + timestamps):
--     name (String, required, trim),
--     email (String, required, trim),
--     subject (String, required, trim),
--     message (String, required, trim),
--     reply (String, trim, NO default),
--     status (String, enum ['Open','In Progress','Closed'], default 'Open'),
--     read (Boolean, default false).
--     The model declares NO index of any kind, NO hook, NO virtual, NO
--     sub-document, NO unique constraint and NO ObjectId reference — every path
--     is scalar. Verified by compiling the real schema:
--     schema.indexes() === [] and the only keys are the seven fields above plus
--     _id/createdAt/updatedAt/__v.
--
--   * devoteeController.js — the ONLY consumer, via four mounted routes (mounted
--     at both /api/devotee and /api/devotees by app.js, with NO auth middleware
--     — these routes are public, which is the pre-existing behaviour and is
--     deliberately NOT changed here):
--       submitSupportRequest     POST  /support
--         requires subject + message (400 otherwise);
--         SupportRequest.create({ name: name || "Anonymous Devotee",
--                                 email: email || "support@devotee.com",
--                                 subject, message })
--       getSupportRequests       GET   /support
--         SupportRequest.find(email ? { email } : {}).sort({ createdAt: -1 })
--       replySupportRequest      PATCH /support/:id
--         findById(id) then mutates reply/status then .save()
--       markSupportRequestAsRead PATCH /support/:id/read
--         SupportRequest.findByIdAndUpdate(id, { read: true }, { new: true })
--     No scheduled job, no aggregation pipeline, no populate, no dashboard or
--     report reads this model. No delete handler exists at any layer, so this
--     table has no delete path and the repository exposes none.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by supportRequestRepository, reachable through
-- supportRequestService) that is selected only when the service is used AND
-- PostgreSQL is reachable. MongoDB stays the source of truth and the fallback
-- path; no Mongo → PostgreSQL switch happens anywhere in the application, there
-- are no dual writes and no production data is migrated. The Mongoose model is
-- left untouched.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model. The frontend keys on
-- req._id (NotificationsCenter.jsx) and passes it back as the :id path param,
-- so the id must round-trip unchanged.
--
-- Mongo → PostgreSQL field mapping — support_requests (every migrated field):
--   * _id       → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * name      → name TEXT NOT NULL (required, trim)
--   * email     → email TEXT NOT NULL (required, trim; NOT unique, NOT lowercased)
--   * subject   → subject TEXT NOT NULL (required, trim)
--   * message   → message TEXT NOT NULL (required, trim)
--   * reply     → reply TEXT (nullable, NO default)
--   * status    → status TEXT DEFAULT 'Open' (nullable, enum, default 'Open')
--   * read      → read BOOLEAN NOT NULL DEFAULT false
--   * createdAt → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 10 columns (id + the 7 schema fields + the two timestamps). The model has no
-- priority, no category, no requesterId, no assignedUserId, no comments, no
-- attachments and no resolution fields; those names must NOT be added. The audit
-- listed exactly these as "absent from the model and therefore not to be
-- invented".
--
-- Nullability and defaults are transcribed from the model's ACTUAL validator
-- behaviour, verified by compiling the real schema — not from the presence of
-- the `required` keyword alone. Mongoose distinguishes four cases here and the
-- table reproduces all four:
--   * `required: true` + `trim` (name, email, subject, message)
--       → an omitted, empty or whitespace-only value FAILS validation (trim runs
--         before the required check, so '   ' collapses to '' and fails). The
--         columns are therefore NOT NULL with NO default, so PostgreSQL rejects
--         the same writes MongoDB rejects.
--   * `default` + enum, NOT required (status)
--       → an omitted value is filled by the default 'Open'; an explicit null is
--         ACCEPTED and stored as null (no required validator, and `default`
--         fires only for an omitted value). The column is therefore NULLABLE
--         DEFAULT 'Open' — NOT NULL would reject a payload MongoDB stores. This
--         is the same decision made for cash_closings.status in Phase 2AH.
--   * `trim`, NOT required, NO default (reply)
--       → an omitted value stays absent (the property is `undefined` on a Mongo
--         read, which the repository reproduces by returning undefined rather
--         than null); an explicit null is accepted and stored as null. The
--         column is therefore nullable with NO default, so an omitted value
--         stays NULL. A blank string stores '' rather than null, exactly as
--         Mongoose does.
--   * `default`, NOT required (read)
--       → an omitted value becomes false; an explicit null is ACCEPTED by
--         Mongoose (a Boolean path has no required validator) and stored as
--         null. The column is NOT NULL DEFAULT false, and the repository
--         collapses a null to the default — the same choice 024 made for
--         notifications.read/viewed and roomRepository made for its defaulted
--         columns. Without the collapse an explicit null would raise a
--         not-null violation and turn a 201 into a 500.
--
-- The four required columns additionally carry a non-empty CHECK. Mongoose runs
-- `trim: true` before the `required: true` check, so a whitespace-only value is
-- rejected there too; the repository trims before insert, so these CHECKs
-- reproduce exactly what Mongo already rejects and narrow no value the
-- application can currently persist. This mirrors notifications_title_check /
-- notifications_message_check in 024_create_notifications.sql.
--
-- `status` carries a CHECK over the model's enum. MongoDB genuinely rejects an
-- out-of-enum status on write (verified: `status: 'Bogus'`, `status: ''` and
-- `status: ' Open '` — note status has NO `trim` — all raise a validation
-- error), so PostgreSQL reproduces the same value set. The CHECK evaluates to
-- NULL — i.e. passes — for a null status, which is exactly the Mongo enum
-- behaviour for the nullable case described above. This mirrors
-- tasks_status_check (030) and cash_closings_status_check (031).
--
-- TEXT is used for every field. The Mongoose schema declares all of them as
-- Strings, including `email`, which is NOT validated as an email address
-- anywhere (no regex, no format CHECK): the controller only checks presence.
-- Introducing an email-format CHECK would make PostgreSQL stricter than the
-- source of truth.
--
-- Uniqueness: NONE, deliberately. The model declares no unique index and
-- submitSupportRequest performs a bare `SupportRequest.create({...})` with no
-- pre-check, so the same email may legitimately raise many requests. Adding
-- UNIQUE(email) — or uniqueness on any other column — would introduce a
-- business rule the application does not enforce today.
--
-- Foreign keys: NONE, and none are added. There is no referenced entity: the
-- model stores no ObjectId and linkage to a person is a raw email string only.
-- No FK is invented to users/employees.
--
-- Case handling: `email` is stored EXACTLY as supplied and is NOT lowercased,
-- because the schema declares no `lowercase: true` on it. The GET filter does
-- lowercase the QUERY value (`String(req.query.email).trim().toLowerCase()`)
-- but compares it against the raw stored value, so the filter is a plain
-- equality on the raw column. This is a pre-existing latent mismatch (a request
-- stored as "Devotee@Example.com" is not matched by ?email=devotee@example.com)
-- and is deliberately NOT "fixed" here — silently lowercasing on write would
-- change stored data and silently changing the filter would change which rows
-- are returned.

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  -- Mongo: name String — required, trim. NO default: an omitted value fails
  -- Mongoose validation, so PostgreSQL rejects it too.
  name TEXT NOT NULL,
  -- Mongo: email String — required, trim. Stored as-is (no lowercase); NOT
  -- unique.
  email TEXT NOT NULL,
  -- Mongo: subject String — required, trim.
  subject TEXT NOT NULL,
  -- Mongo: message String — required, trim.
  message TEXT NOT NULL,
  -- Mongo: reply String — trim, NOT required, NO default. NULLABLE with no
  -- default so an omitted reply stays NULL (undefined on a Mongo read).
  reply TEXT,
  -- Mongo: status String — enum, default 'Open', NOT required. NULLABLE: an
  -- omitted value becomes the default while an explicit null validates in Mongo
  -- and is stored as null. The CHECK below still passes for a null status,
  -- which is exactly the Mongo enum behaviour.
  status TEXT DEFAULT 'Open',
  -- Mongo: read Boolean — default false. NOT NULL: a null collapses to the
  -- default in the repository, as it does for notifications.read.
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongoose runs `trim: true` before the `required: true` check, so a
  -- whitespace-only value is rejected there as well. The repository trims
  -- before insert, so these CHECKs reproduce exactly what Mongo already rejects
  -- and narrow no value the application can currently persist.
  CONSTRAINT support_requests_name_check CHECK (name <> ''),
  CONSTRAINT support_requests_email_check CHECK (email <> ''),
  CONSTRAINT support_requests_subject_check CHECK (subject <> ''),
  CONSTRAINT support_requests_message_check CHECK (message <> ''),
  -- Mirrors the model's `status` enum. MongoDB rejects an out-of-enum status on
  -- write, so PostgreSQL reproduces the same value set.
  CONSTRAINT support_requests_status_check CHECK (
    status IN ('Open', 'In Progress', 'Closed')
  )
);

-- It is intentional that this table carries exactly ZERO CONSTRAINT beyond the
-- primary key, the four non-empty CHECKs, the status CHECK and the NOT NULLs.
-- In particular there is no UNIQUE constraint and no foreign key, because the
-- Mongo schema declares neither and adding one would introduce a rule the
-- application lacks.

-- getSupportRequests: SupportRequest.find(filter).sort({ createdAt: -1 }) — the
-- only ordering and the only listing query the domain has. The controller reads
-- the whole array (no pagination).
CREATE INDEX IF NOT EXISTS idx_support_requests_created_at
  ON support_requests (created_at DESC);

-- getSupportRequests' optional `?email=` filter: SupportRequest.find({ email })
-- against the raw stored value. This is a plain equality (NOT lower(email)),
-- because the controller lowercases only the query value and compares it to the
-- value stored as supplied. The created_at DESC tail is included because the
-- filter is always applied together with the standing newest-first order, the
-- same shape as idx_notifications_audience_email_created_at in 024.
CREATE INDEX IF NOT EXISTS idx_support_requests_email_created_at
  ON support_requests (email, created_at DESC);
