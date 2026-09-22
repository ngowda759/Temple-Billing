const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const SupportRequest = require("../models/SupportRequest");
const supportRequestRepository = require("../repositories/supportRequestRepository");

// isConnected() exposes the datasource-selection seam. It is read through the
// config module (dbConfig.isDbConnected()) rather than a require-time
// destructure, so the datasource can change at runtime — tests flip it after
// this module is loaded — without the module capturing a stale function
// reference.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Support Request path: PostgreSQL is used
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

// Mirrors the Mongoose `required: true` + `trim` check: an omitted, null, empty
// or whitespace-only value fails validation (trim runs before the required
// check). The four required text paths are name/email/subject/message.
const assertRequired = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

/**
 * Validates and normalizes a support-request payload with the same rules the
 * Mongo schema applies, so the PostgreSQL repository and the Mongoose model
 * receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - `name`, `email`, `subject` and `message` are required; a blank or
 *    whitespace-only value is rejected.
 *  - `reply` is an optional String trimmed by the schema and is NOT validated
 *    or reformatted.
 *  - `status` is not validated here: the controller already resolves the
 *    fallback-to-'Closed' rule and the CHECK constraint (and Mongoose's enum)
 *    reject an out-of-enum value.
 *  - No uniqueness rule is applied: the schema declares no unique index, so a
 *    devotee may raise many requests from one email.
 *  - No email-format rule is applied: the schema declares none.
 *
 * Nothing else is coerced here; the repository applies the same defaults when
 * building the row.
 */
const normalizeSupportRequest = (data) => {
  if (!data) throw new Error("Support request data is required");
  assertRequired(data.name, "name");
  assertRequired(data.email, "email");
  assertRequired(data.subject, "subject");
  assertRequired(data.message, "message");
  const normalized = { ...data };
  normalized.name = String(data.name).trim();
  normalized.email = String(data.email).trim();
  normalized.subject = String(data.subject).trim();
  normalized.message = String(data.message).trim();
  if (normalized.reply !== undefined && normalized.reply !== null) {
    normalized.reply = String(data.reply).trim();
  }
  return normalized;
};

const validate = (data) => {
  normalizeSupportRequest(data);
};

const create = async (data) => {
  const normalized = normalizeSupportRequest(data);
  if (await usePostgres()) return supportRequestRepository.create(normalized);
  return SupportRequest.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? supportRequestRepository.findById(id) : SupportRequest.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? supportRequestRepository.findOne(filter) : SupportRequest.findOne(filter);

/**
 * The listing behind GET /support. Mirrors
 * SupportRequest.find(filter).sort({ createdAt: -1 }) where `filter` is
 * `{ email }` when the optional `?email=` query is present (the controller has
 * already trimmed and lowercased it) and `{}` otherwise.
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
 * Persists the reply/read mutation surface. The controller loads the document
 * first (findById), resolves the new reply/status/read, then writes — this
 * mirrors the original `findById` + `save()` and the `findByIdAndUpdate(id,
 * { read: true }, { new: true })` call without inventing new business rules.
 *
 * Like the Mongoose `findByIdAndUpdate` the controller originally used (which
 * passes no `runValidators`), this path does NOT re-validate the full document:
 * it applies the update verbatim, so an empty string does not raise a required
 * error. The status CHECK still rejects an out-of-enum value, exactly as
 * Mongoose's enum validator rejects it on a save().
 */
const updateById = async (id, updates = {}) => {
  if (await usePostgres()) return supportRequestRepository.updateById(id, updates);
  return SupportRequest.findByIdAndUpdate(String(id), updates, { new: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? supportRequestRepository.count(filter) : SupportRequest.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? supportRequestRepository.destroy(id) : SupportRequest.findByIdAndDelete(String(id));

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};
