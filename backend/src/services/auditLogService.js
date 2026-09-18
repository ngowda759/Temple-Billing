const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const AuditLog = require("../models/AuditLog");
const auditLogRepository = require("../repositories/auditLogRepository");

// isConnected() exposes the datasource-selection seam. It is read through the
// config module (dbConfig.isDbConnected()) rather than a require-time
// destructure (const { isDbConnected } = ...), so the datasource can change at
// runtime — tests flip it after this module is loaded — without the module
// capturing a stale function reference.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Audit Log path: PostgreSQL is used only
// when the established datasource seam is connected AND PostgreSQL is actually
// reachable. If either condition fails the path routes back to the existing
// Mongoose model, so an unavailable PostgreSQL can never take the app down.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const assertRequired = (value, label) => {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required`);
  }
  return value;
};

const assertDate = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
};

/**
 * Validates an audit log payload with the same rules the Mongo schema applies,
 * so the PostgreSQL repository and the Mongoose model receive the same cleaned
 * payload. date/user/action/module are required (none is trimmed in the schema,
 * so a whitespace-only string remains legal exactly as it is in Mongo) and
 * details/ipAddress are optional.
 */
const normalizeAuditLog = (data) => {
  if (!data) throw new Error("Audit log data is required");
  assertDate(data.date, "date");
  assertRequired(data.user, "user");
  assertRequired(data.action, "action");
  assertRequired(data.module, "module");
  return { ...data };
};

const validate = (data) => {
  normalizeAuditLog(data);
};

const create = async (data) => {
  const normalized = normalizeAuditLog(data);
  if (await usePostgres()) return auditLogRepository.create(normalized);
  return AuditLog.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? auditLogRepository.findById(id) : AuditLog.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? auditLogRepository.findOne(filter) : AuditLog.findOne(filter);

// `populate` requests the `.populate('user', 'name role')` shape used by
// GET /api/audit-logs. It defaults to false so the plain service surface
// returns `user` as the id string, exactly like a Mongoose document that has
// not been populated. When true the Mongoose fallback performs the real
// populate, so both datasources return the identical document shape.
const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset, populate = false } = options;
  if (await usePostgres()) return auditLogRepository.findMany(options);

  let q = AuditLog.find(filter).sort(sort);
  if (populate) q = q.populate("user", "name role");
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

const count = async (filter = {}) =>
  (await usePostgres()) ? auditLogRepository.count(filter) : AuditLog.countDocuments(filter);

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  count,
};