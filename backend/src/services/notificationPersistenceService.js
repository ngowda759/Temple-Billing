const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Notification = require("../models/Notification");
const notificationRepository = require("../repositories/notificationRepository");

// Mirrors Mongo's `required: true` on a trimmed String path. Notification.title
// and Notification.message are the only two required paths in the schema.
const assertRequiredText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertDate = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
};

/**
 * Validates a notification payload with the same rules the Mongo schema applies,
 * so the PostgreSQL repository and the Mongoose model receive the same cleaned
 * payload. Only title/message are required; every other path is optional with no
 * default in the schema, so it is left exactly as supplied.
 */
const normalizeNotification = (data) => {
  if (!data) throw new Error("Notification data is required");
  assertRequiredText(data.title, "title");
  assertRequiredText(data.message, "message");
  assertDate(data.date, "date");
  assertDate(data.viewedAt, "viewedAt");
  assertDate(data.readAt, "readAt");
  assertDate(data.emailSentAt, "emailSentAt");
  return { ...data };
};

const validate = (data) => {
  if (Array.isArray(data)) {
    for (const item of data) normalizeNotification(item);
    return;
  }
  normalizeNotification(data);
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Notification path: PostgreSQL is used
// when the datasource seam is connected AND PostgreSQL is actually reachable. If
// either condition fails the existing Mongoose model handles the operation, so
// an unavailable PostgreSQL can never take the app down nor cause a partial
// write.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

// Mirrors Notification.create(payload) / Notification.create([payloads]). On the
// Mongo path this keeps the model's post-save email hook; on the PostgreSQL path
// the repository reproduces that hook.
const create = async (data) => {
  validate(data);
  if (await usePostgres()) return notificationRepository.create(data);
  return Notification.create(data);
};

// Mirrors Notification.findById(id) — priestController.readNotification and
// devoteeController.sendNotificationEmail.
const findById = async (id) =>
  (await usePostgres()) ? notificationRepository.findById(id) : Notification.findById(id);

// Mirrors the listing queries (notificationController.getNotifications,
// staffController.getStaffNotifications, priestController.getNotifications,
// devoteeController.getNotifications). The caller supplies the exact Mongo
// filter/sort it needs; limit/offset preserve the existing pagination semantics
// (priestController's dashboard limit of 10).
const findMany = async (options = {}) => {
  if (await usePostgres()) return notificationRepository.findMany(options);
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  let q = Notification.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// Mirrors Notification.countDocuments(filter) — staffController.getStaffUnreadCount
// and seedPriestData's existence probe.
const countDocuments = async (filter = {}) =>
  (await usePostgres()) ? notificationRepository.countDocuments(filter) : Notification.countDocuments(filter);

// Mirrors Notification.findByIdAndUpdate(id, payload, { new: true }) — the
// mark-read paths and devoteeController.sendNotificationEmail's email stamp.
const findByIdAndUpdate = async (id, updates) => {
  if (updates) {
    const withoutUndefined = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );
    if (withoutUndefined.title !== undefined) assertRequiredText(withoutUndefined.title, "title");
    if (withoutUndefined.message !== undefined) assertRequiredText(withoutUndefined.message, "message");
    assertDate(withoutUndefined.date, "date");
    assertDate(withoutUndefined.viewedAt, "viewedAt");
    assertDate(withoutUndefined.readAt, "readAt");
    assertDate(withoutUndefined.emailSentAt, "emailSentAt");
  }
  if (await usePostgres()) return notificationRepository.findByIdAndUpdate(id, updates);
  return Notification.findByIdAndUpdate(id, updates, { new: true });
};

// Mirrors Notification.updateMany(filter, payload) — staffController's
// mark-all read / mark-all viewed and priestController's read-all.
const updateMany = async (filter = {}, updates = {}) => {
  if (updates) {
    const withoutUndefined = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );
    if (withoutUndefined.title !== undefined) assertRequiredText(withoutUndefined.title, "title");
    if (withoutUndefined.message !== undefined) assertRequiredText(withoutUndefined.message, "message");
    assertDate(withoutUndefined.date, "date");
    assertDate(withoutUndefined.viewedAt, "viewedAt");
    assertDate(withoutUndefined.readAt, "readAt");
    assertDate(withoutUndefined.emailSentAt, "emailSentAt");
  }
  if (await usePostgres()) return notificationRepository.updateMany(filter, updates);
  return Notification.updateMany(filter, updates);
};

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findMany,
  countDocuments,
  findByIdAndUpdate,
  updateMany,
};
