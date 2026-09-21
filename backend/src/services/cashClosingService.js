const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const CashClosing = require("../models/CashClosing");
const cashClosingRepository = require("../repositories/cashClosingRepository");

// isConnected() exposes the datasource-selection seam. It is read through the
// config module (dbConfig.isDbConnected()) rather than a require-time
// destructure (const { isDbConnected } = ...), so the datasource can change at
// runtime — tests flip it after this module is loaded — without the module
// capturing a stale function reference.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Cash Closing path: PostgreSQL is used
// only when the established datasource seam is connected AND PostgreSQL is
// actually reachable. If either condition fails the path routes back to the
// existing Mongoose model, so an unavailable PostgreSQL can never take the
// cash-closing endpoints down.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * Validates a cash-closing payload with the same rules the Mongo schema
 * applies, so the PostgreSQL repository and the Mongoose model receive the
 * same payload.
 *
 * `date`, `openingCash`, `cashCollected`, `closingCash` and `recordedBy` are
 * required. The required check mirrors Mongoose's validator exactly: undefined,
 * null and '' fail, while 0 passes — 0 is a legal money amount.
 *
 * Nothing is coerced here. The money buckets and `cashCollected` are computed
 * by the controller on the server side; this layer only validates and routes.
 */
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

const normalizeCashClosing = (data) => {
  if (!data) throw new Error("Cash closing data is required");
  assertDate(data.date, "date");
  assertRequired(data.date, "date");
  assertRequired(data.openingCash, "openingCash");
  assertRequired(data.cashCollected, "cashCollected");
  assertRequired(data.closingCash, "closingCash");
  assertRequired(data.recordedBy, "recordedBy");
  return { ...data };
};

const validate = (data) => {
  normalizeCashClosing(data);
};

const create = async (data) => {
  const normalized = normalizeCashClosing(data);
  if (await usePostgres()) return cashClosingRepository.create(normalized);
  return CashClosing.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? cashClosingRepository.findById(id) : CashClosing.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? cashClosingRepository.findOne(filter) : CashClosing.findOne(filter);

/**
 * The listing behind GET /api/accounts/cash-closing.
 *
 * `populate` requests the `.populate('recordedBy','name')
 * .populate('verifiedBy','name')` shape the controller uses. It defaults to
 * false so the plain service surface returns the referenced ids as strings,
 * exactly like a Mongoose document that has not been populated. When true the
 * Mongoose fallback performs the real populate, so both datasources return the
 * identical document shape.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1 }, limit, offset, populate = false } = options;
  if (await usePostgres()) return cashClosingRepository.findMany(options);

  let q = CashClosing.find(filter).sort(sort);
  if (populate) q = q.populate("recordedBy", "name").populate("verifiedBy", "name");
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

const updateById = async (id, updates = {}) => {
  if (await usePostgres()) return cashClosingRepository.updateById(id, updates);
  return CashClosing.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? cashClosingRepository.count(filter) : CashClosing.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? cashClosingRepository.destroy(id) : CashClosing.findByIdAndDelete(String(id));

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