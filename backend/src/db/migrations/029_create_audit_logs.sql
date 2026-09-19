-- Phase 2AB: audit_logs (MongoDB → PostgreSQL migration).
--
-- Renumbered 028 → 029 in Phase 2AC: Phase 2AA had already taken the 028
-- prefix for 028_create_settings.sql, so two migrations shared a number. The
-- runner sorts filenames, so both applied, but the collision made the intended
-- apply order ambiguous and would silently reorder the chain if either file was
-- ever renamed. The SQL below is unchanged.
--
-- Mirrors backend/src/models/AuditLog.js and every real usage of the AuditLog
-- model. Unlike every earlier phase this domain has NO repository and NO
-- service today: the entire persistence surface is a single controller.
--
--   * AuditLog.js — the Mongoose model: date (Date, required, default
--     Date.now), user (ObjectId ref 'User', required), action (String,
--     required), module (String, required), details (String, optional),
--     ipAddress (String, default '127.0.0.1'), timestamps. The schema declares
--     NO nested sub-documents, NO arrays, NO virtuals, NO enum, NO unique
--     index and NO TTL/retention field.
--
--   * auditLogController.js — the ONLY consumer of the model:
--       getAuditLogs(req, res)  (GET /api/audit-logs, admin only)
--         AuditLog.find(query).sort({ date: -1 }).populate('user', 'name role')
--         where query is assembled from:
--           - startDate + endDate → { date: { $gte, $lte } } (both required)
--           - user              → { user } but ONLY when user.length === 24
--                                 (the controller's own guard; a shorter value
--                                 silently skips the filter)
--           - action            → { action: { $regex: action, $options: 'i' } }
--           - module            → { module } exact match
--         There is NO limit/skip: the endpoint returns every match and the
--         React page paginates client-side.
--       logAudit(userId, action, moduleName, details, ipAddress) — the ONLY
--         write path: AuditLog.create({ user, action, module, details,
--         ipAddress }). Errors are swallowed and logged with console.error, so
--         a failed audit write never fails the business request.
--
--     logAudit has exactly two callers, both in accountController.js:
--       - approveExpense    → 'Approved Expense' / 'Rejected Expense',
--                             module 'Accounts & Finance'
--       - submitCashClosing → 'Submitted Shift Closing',
--                             module 'Accounts & Finance'
--     Both pass req.user.id and req.ip. No other module writes audit records,
--     so no additional writer has to be reproduced.
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by auditLogRepository, reachable through auditLogService) that
-- is selected only when the service is used AND PostgreSQL is reachable.
-- MongoDB stays the source of truth and the fallback path; no Mongo →
-- PostgreSQL switch happens anywhere in the application, there are no dual
-- writes and no production data is migrated.
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing AuditLog model.
--
-- Mongo → PostgreSQL field mapping (every persisted Mongo field):
--   * _id       → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * date      → date TIMESTAMPTZ NOT NULL DEFAULT now() (default Date.now)
--   * user      → user_id TEXT NOT NULL (required ObjectId ref 'User' kept as
--                 its 24-hex string; deliberately NO foreign key, see below)
--   * action    → action TEXT NOT NULL (free text — the model declares NO
--                 enum, so no CHECK is invented)
--   * module    → module TEXT NOT NULL (free text — NO enum, so no CHECK)
--   * details   → details TEXT (optional)
--   * ipAddress → ip_address TEXT NOT NULL DEFAULT '127.0.0.1' (the schema
--                 default)
--   * createdAt → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- nine columns (id + the six schema fields + the two timestamps). The model has
-- no actor/entity/entityId pair, no before/after payload, no request or
-- user-agent field, no severity/outcome/status field, no metadata object and no
-- reference to the changed document — `details` is a single free-text String.
-- Those concepts appear on other entities but not on AuditLog, so they are
-- deliberately NOT columns and no JSONB column or child table is created. In
-- particular `details` is a plain String in Mongo, so mapping it to JSONB would
-- change the API shape the React page renders; TEXT is the faithful mapping.
--
-- Foreign keys: NONE, deliberately.
--   * user_id → users(id) is NOT created even though users exists in
--     PostgreSQL (Phase 2A) and the Mongo schema declares ref: 'User'. An audit
--     record is append-only history and must stay valid after the referenced
--     user is deleted; MongoDB enforces no referential integrity here and
--     keeps such records orphaned. Every FK strategy would change that
--     behaviour for the worse:
--       - ON DELETE RESTRICT would block deleting a user who ever performed an
--         audited action, a hard break of current behaviour;
--       - ON DELETE CASCADE would destroy audit history, which is exactly what
--         an audit log must never do;
--       - ON DELETE SET NULL is impossible because user_id is NOT NULL, and
--         making it nullable would weaken a required Mongo field.
--     The same reasoning that kept inventory_logs.user_id a plain indexed TEXT
--     (see 011) applies here, and audit semantics make it stronger: an audit
--     record is a historical fact about who acted, not a live pointer.
--   * No other id is referenced by the schema, so no other FK is possible.
--
-- Retention / deletion: the Mongo schema declares NO TTL index
-- (expireAfterSeconds) and there is NO expiresAt/retention field, no cleanup
-- job and no delete path anywhere in the application (the repository does not
-- expose a destroy operation either). Nothing is invented here: no TTL column,
-- no partition pruning and no expires_at column.
--
-- Uniqueness semantics: the Mongo schema declares no unique index on AuditLog,
-- so none is created. Multiple records for the same user/action/module are the
-- audit history, not a constraint.
--
-- Indexes. The Mongo model declares no explicit index, but the single read
-- query has a fixed shape, so the indexes below mirror exactly the access
-- pattern that query produces (and nothing more):
--   * date DESC                       — the only sort: .sort({ date: -1 })
--   * (user_id)                       — the equality filter { user }
--   * (module)                        — the equality filter { module }
-- No index is created on action: its only filter is an unanchored,
-- case-insensitive $regex, which a btree index cannot serve.
--
-- Monetary values: none — AuditLog carries no amount field.
--
-- Embedded/nested data: none (see Completeness above), so no normalization is
-- required.

CREATE TABLE IF NOT EXISTS audit_logs (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: date Date — required, default Date.now. Actual event timestamp.
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongo: user ObjectId ref 'User' — required. Plain indexed TEXT, no FK:
  -- audit history must survive deletion of the referenced user (see header).
  user_id TEXT NOT NULL,
  -- Mongo: action String — required. FREE TEXT (no enum in the model).
  action TEXT NOT NULL,
  -- Mongo: module String — required. FREE TEXT (no enum in the model).
  module TEXT NOT NULL,
  -- Mongo: details String — optional free text (NOT JSONB: the model stores a
  -- String and the API returns it verbatim).
  details TEXT,
  -- Mongo: ipAddress String — default '127.0.0.1'.
  ip_address TEXT NOT NULL DEFAULT '127.0.0.1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- getAuditLogs: AuditLog.find(query).sort({ date: -1 }) — the only sort in the
-- domain, and the only endpoint that reads this table.
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs (date DESC);

-- getAuditLogs user filter: { user } (equality, only when a 24-char id is
-- supplied). Also serves the repository's populate-style user join.
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);

-- getAuditLogs module filter: { module } (exact equality).
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs (module);
