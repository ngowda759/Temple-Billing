const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const SupportRequest = require("../models/SupportRequest");
const supportRequestRepository = require("../repositories/supportRequestRepository");

// isConnected() exposes the datasource-selection seam. It is read through the
// config module (dbConfig.isDbConnected()) rather than a require-time
// destructure (const { isDbConnected } = ...), so the datasource can change at
// runtime — tests flip it after this module is loaded — without the module
// capturing a stale function reference.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the SupportRequest path: PostgreSQL is used
// only when the established datasource seam is connected AND PostgreSQL is
// actually reachable. If either condition fails the path routes back to the
// existing Mongoose model, so an unavailable PostgreSQL can never take the
// support endpoints down.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * Validates a support request payload with the same rules the Mongo schema
 * applies, so the PostgreSQL repository and the Mongoose model receive the same
 * cleaned payload. Delegated to the repository's own validator so the two paths
 * cannot drift.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - name / email / subject / message are required and trimmed; a blank or
 *    whitespace-only value is rejected (Mongoose's `trim` runs before its
 *    `required` check).
 *  - email is NOT validated as an email address and is NOT lowercased — the
 *    schema declares no validator and no `lowercase: true`, so the value is
 *    stored exactly as supplied.
 *  - reply is optional with no default; status is optional and must be one of
 *    Open / In Progress / Closed; read is optional and defaults to false.
 *  - No uniqueness rule is applied: the schema declares no unique index, so the
 *    same email may raise many requests.
 */
const validate = (data) => supportRequestRepository.validate(data);

// Mirrors SupportRequest.create(...) — submitSupportRequest. The controller
// supplies the name/email defaults, so a blank value reaching this service is a
// genuine caller error rather than a defaulted field.
const create = async (data) => {
  validate(data);
  if (await usePostgres()) return supportRequestRepository.create(data);
  return SupportRequest.create(data);
};

// Mirrors SupportRequest.findById(id) — replySupportRequest.
const findById = async (id) =>
  (await usePostgres()) ? supportRequestRepository.findById(id) : SupportRequest.findById(String(id));

/**
 * The listing behind GET /support. Mirrors
 * SupportRequest.find(filter).sort({ createdAt: -1 }) — the only listing query
 * the domain has. The caller passes the exact filter it needs ({} or
 * { email }); no pagination is applied because the controller applies none.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (await usePostgres()) return supportRequestRepository.findMany(options);

  let q = SupportRequest.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

/**
 * Mirrors replySupportRequest's `findById(id)` → mutate reply/status → `save()`.
 *
 * The controller has already enforced its own rules (reply present, status
 * coerced to 'Closed' when unrecognised), so the service forwards the two fields
 * as-is and lets the repository reproduce the save() semantics — including
 * returning null when the id does not exist, which is what the controller's 404
 * branch relies on.
 */
const updateById = async (id, updates = {}) => {
  if (await usePostgres()) return supportRequestRepository.updateById(id, updates);
  const doc = await SupportRequest.findById(String(id));
  if (!doc) return null;
  for (const field of ["reply", "status"]) {
    if (updates[field] !== undefined) doc[field] = updates[field];
  }
  await doc.save();
  return doc;
};

/**
 * Mirrors markSupportRequestAsRead's
 * `SupportRequest.findByIdAndUpdate(id, { read: true }, { new: true })`.
 */
const markRead = async (id) =>
  (await usePostgres()) ? supportRequestRepository.markRead(id) : SupportRequest.findByIdAndUpdate(String(id), { read: true }, { new: true });

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findMany,
  updateById,
  markRead,
};
