-- Phase 2W: notifications (MongoDB → PostgreSQL migration).
--
-- Mirrors backend/src/models/Notification.js and every real usage of the
-- Notification model:
--   * Notification.js — the Mongoose model: title (String, trim, required),
--     message (String, trim, required), audienceId (String, trim, index),
--     audienceEmail (String, trim, lowercase), audienceRole (String, trim,
--     lowercase), category (String, trim), date (Date, default Date.now),
--     viewed (Boolean, default false), viewedAt (Date, default null), read
--     (Boolean, default false), readAt (Date, default null), attachment
--     (String), emailSent (Boolean, default false), emailSentAt (Date, default
--     null), emailRecipient (String, trim, lowercase), timestamps. There are NO
--     virtuals and NO embedded sub-documents.
--     The schema declares FIVE indexes — { audienceId: 1 } from `index: true`,
--     { createdAt: -1 }, { date: -1 }, { audienceEmail: 1, createdAt: -1 } and
--     { audienceRole: 1, createdAt: -1 }. There is NO unique index and NO TTL
--     index.
--   * notificationController.js — the dedicated /api/notifications router:
--       getNotifications(role, userId) reads
--       Notification.find({ $or: [{ audienceRole: role }, { audienceId: userId }] })
--       (plus `category: { $nin: ['event','events','festival','festivals'] }`
--       for the admin role) sorted { createdAt: -1 }.
--       markNotificationRead(id) writes { read: true, readAt: new Date() } via
--       findByIdAndUpdate.
--   * staffController.js — getStaffNotifications (find with a $or of
--     audienceRole/audienceId $in/audienceEmail $in, sorted
--     { date: -1, createdAt: -1 }), getStaffUnreadCount (countDocuments of the
--     same filter + read: false), markStaffNotificationRead (findByIdAndUpdate),
--     markStaffNotificationsRead (updateMany read: false → read: true, readAt),
--     markStaffNotificationsViewed (updateMany viewed: false → viewed: true,
--     viewedAt) and a direct Notification.create for a completed task.
--   * priestController.js — getNotifications (find with a $or of
--     audienceId/audienceEmail/audienceRole 'priest'), readNotification
--     (findById then read=true, viewed=true, readAt, viewedAt, save()),
--     readAllNotifications (updateMany read: false → read: true, viewed: true,
--     readAt, viewedAt) and direct Notification.create calls for duty transfers.
--   * devoteeController.js — getNotifications (find with a $or that includes an
--     email alias lookup, the general-broadcast predicate
--     audienceRole ∈ {devotee, all} + audienceEmail/audienceId ∈ {null, ''} and
--     audienceId = userId), markNotificationAsRead (findByIdAndUpdate),
--     sendNotificationEmail (findById then sets emailSent/emailSentAt/
--     emailRecipient and saves) and many direct Notification.create calls for
--     booking/donation/prasadam/event/profile flows.
--   * utils/notificationService.js — the shared creation funnel
--     (createNotification, createStaffNotification, createEmployeeBroadcast-
--     Notifications, createStaffBroadcastNotifications, createBroadcast-
--     Notifications). Broadcasts create ONE document per recipient and pre-set
--     emailSent when an audienceEmail exists (the separate BCC broadcast is
--     sent by sendBroadcastEmail), so the model's post-save hook skips them.
--   * Notification.js — the post-save email hook (resolves a recipient email
--     from audienceEmail, else User/Employee by audienceId, then sends the
--     temple HTML and sets emailSent/emailSentAt/emailRecipient).
--
-- This migration is strictly additive: it introduces an alternate persistence
-- path (backed by notificationRepository, reachable through
-- notificationPersistenceService) that is selected only when the service is
-- used AND PostgreSQL is reachable. MongoDB stays the source of truth and the
-- fallback path; no Mongo → PostgreSQL switch happens anywhere in the
-- application and no production data is migrated. Direct Notification.create
-- calls embedded in other domains' controllers remain on Mongoose (the
-- coexistence boundary documented in Phases 2A–2V).
--
-- Primary keys are 24-char hex strings so they remain compatible with the
-- MongoDB ObjectIds returned by the existing model.
--
-- Mongo → PostgreSQL field mapping — notifications (every persisted Mongo
-- field):
--   * _id            → id TEXT PRIMARY KEY (24-hex Mongo-compatible id)
--   * title          → title TEXT NOT NULL (required, trim; CHECK non-empty,
--                      because Mongoose trims before the required check, so a
--                      whitespace-only title is rejected there too)
--   * message        → message TEXT NOT NULL (required, trim; CHECK non-empty)
--   * audienceId     → audience_id TEXT (nullable; a POLYMORPHIC reference — a
--                      User OR an Employee ObjectId as its 24-hex string —
--                      deliberately NO FK, see the relationship note)
--   * audienceEmail  → audience_email TEXT (nullable; a value reference, not an
--                      id)
--   * audienceRole   → audience_role TEXT (nullable; free text — the role
--                      strings are not an enum on Notification, so no CHECK)
--   * category       → category TEXT (nullable; FREE TEXT — the observed values
--                      span inventory/Pooja/transfer/event/booking/task/leave/
--                      prasadam/attendance/donation/billing/festival/employee/
--                      registration/meeting/Duty/… and arbitrary request input,
--                      so no enum CHECK is invented)
--   * date           → date TIMESTAMPTZ NOT NULL DEFAULT now() (the schema
--                      default Date.now)
--   * viewed         → viewed BOOLEAN NOT NULL DEFAULT false
--   * viewedAt       → viewed_at TIMESTAMPTZ (nullable, default null)
--   * read           → read BOOLEAN NOT NULL DEFAULT false
--   * readAt         → read_at TIMESTAMPTZ (nullable, default null)
--   * attachment     → attachment TEXT (nullable; a data-URI or http(s) URL)
--   * emailSent      → email_sent BOOLEAN NOT NULL DEFAULT false
--   * emailSentAt    → email_sent_at TIMESTAMPTZ (nullable, default null)
--   * emailRecipient → email_recipient TEXT (nullable)
--   * createdAt      → created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   * updatedAt      → updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Completeness: every persisted Mongo field has a column and there are exactly
-- 18 columns (id + the 15 schema fields + the two timestamps). The model has no
-- type/priority/severity/status enum, no delivery channel or delivery status,
-- no metadata/payload object, no source/reference fields, no expiresAt or
-- retention field, no recipients[] array, no readBy/viewedBy list and no
-- recipient sub-document. Those concepts appear on other entities but not on
-- Notification, so they are deliberately NOT columns and no child table is
-- created — a notification is a single-table row addressed by one of
-- audienceId / audienceEmail / audienceRole.
--
-- Read / unread semantics. Mongo carries TWO independent flags: `read`
-- (default false) with the nullable `readAt`, and `viewed` (default false) with
-- the nullable `viewedAt`. Both are preserved one-for-one, and their existing
-- relationship is untouched: notifications are created read=false/viewed=false,
-- marking read sets read=true + readAt (and, in the priest path, also
-- viewed=true + viewedAt) while the staff "view-all" path sets only viewed.
-- There is NO mark-as-unread, NO delete and NO clear-all path in the
-- application, so no such operation is added here.
--
-- Expiration / retention. The Mongo schema declares NO TTL index and there is
-- NO expiresAt/retention field or cleanup job. No expiresAt column and no TTL
-- behaviour is invented; the existing schema creates nothing to reproduce.
--
-- Indexes. Exactly the five the Mongo schema declares, mapped to the same
-- columns and directions (see the CREATE INDEX statements below). No
-- speculative index is added.

CREATE TABLE IF NOT EXISTS notifications (
  -- Mongo: _id — 24-hex ObjectId-compatible id.
  id TEXT PRIMARY KEY,
  -- Mongo: title String — required, trim.
  title TEXT NOT NULL,
  -- Mongo: message String — required, trim.
  message TEXT NOT NULL,
  -- Mongo: audienceId String — trim, index. POLYMORPHIC (User OR Employee
  -- ObjectId), so deliberately NO foreign key.
  audience_id TEXT,
  -- Mongo: audienceEmail String — trim, lowercase. A value reference.
  audience_email TEXT,
  -- Mongo: audienceRole String — trim, lowercase. Free text.
  audience_role TEXT,
  -- Mongo: category String — trim. FREE TEXT (no enum), so no CHECK.
  category TEXT,
  -- Mongo: date Date — default Date.now.
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongo: viewed Boolean — default false.
  viewed BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: viewedAt Date — default null.
  viewed_at TIMESTAMPTZ,
  -- Mongo: read Boolean — default false.
  read BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: readAt Date — default null.
  read_at TIMESTAMPTZ,
  -- Mongo: attachment String — data-URI or http(s) URL, nullable.
  attachment TEXT,
  -- Mongo: emailSent Boolean — default false.
  email_sent BOOLEAN NOT NULL DEFAULT false,
  -- Mongo: emailSentAt Date — default null.
  email_sent_at TIMESTAMPTZ,
  -- Mongo: emailRecipient String — trim, lowercase, nullable.
  email_recipient TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mongoose runs `trim: true` before the `required: true` check, so a
  -- whitespace-only title/message is rejected there as well. The repository
  -- trims before insert, so these CHECKs reproduce exactly what Mongo already
  -- rejects and narrow no value the application can currently persist.
  CONSTRAINT notifications_title_check CHECK (title <> ''),
  CONSTRAINT notifications_message_check CHECK (message <> '')
);

-- The Mongo non-unique { audienceId: 1 } index (from `index: true`), serving the
-- audienceId branches of notificationController/devoteeController/priestController
-- and the ranked { audienceId: { $in: [...] } } branch in staffController.
CREATE INDEX IF NOT EXISTS idx_notifications_audience_id
  ON notifications (audience_id);

-- The Mongo { audienceEmail: 1, createdAt: -1 } compound index, serving the
-- audienceEmail branches (equality and $in) plus the standing createdAt order.
CREATE INDEX IF NOT EXISTS idx_notifications_audience_email_created_at
  ON notifications (audience_email, created_at DESC);

-- The Mongo { audienceRole: 1, createdAt: -1 } compound index, serving the
-- audienceRole branches (equality and $in) plus the standing createdAt order.
CREATE INDEX IF NOT EXISTS idx_notifications_audience_role_created_at
  ON notifications (audience_role, created_at DESC);

-- The Mongo { createdAt: -1 } index — the standing newest-first ordering every
-- listing query applies.
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);

-- The Mongo { date: -1 } index — staffController sorts { date: -1, createdAt: -1 }.
CREATE INDEX IF NOT EXISTS idx_notifications_date
  ON notifications (date DESC);
