const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Leave = require("../models/Leave");
const leaveRepository = require("../repositories/leaveRepository");

// Mirrors the enum declared in backend/src/models/Leave.js exactly.
const STATUSES = new Set(["Pending", "Approved", "Rejected"]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertDateKey = (value, label) => {
  const text = assertId(value, label);
  if (!DATE_PATTERN.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a YYYY-MM-DD calendar key`);
  }
  return text;
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Leave path: PostgreSQL is used when the
// datasource seam is connected AND PostgreSQL is actually reachable. If either
// condition fails the existing Mongoose model handles the operation.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * Validates and normalizes leave data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - staffId / staffName / reason / fromDate / toDate are required (trim; an
 *    all-whitespace value is rejected by Mongo's trim-then-required check).
 *  - leaveType defaults to 'General', status to 'Pending', adminReason and
 *    reviewedBy to '', reviewedAt to null.
 *  - fromDate / toDate are the 'YYYY-MM-DD' calendar strings every write path
 *    produces; the shape is validated so malformed values cannot break the
 *    lexicographic range comparisons the application relies on.
 *  - The 10-character reason rule, the future-date rule and the toDate >=
 *    fromDate rule are NOT applied here: they live in leaveController and Mongo
 *    itself does not enforce them, so applying them would make PostgreSQL
 *    stricter than the source of truth.
 *
 * The result is passed to the repository, which re-derives the same defaults
 * when building the row.
 */
const normalizeLeave = (data) => {
  if (!data) throw new Error("Leave data is required");
  assertId(data.staffId, "staffId");
  assertId(data.staffName, "staffName");
  assertId(data.reason, "reason");
  assertDateKey(data.fromDate, "fromDate");
  assertDateKey(data.toDate, "toDate");
  assertEnum(data.status, STATUSES, "status");
  return { ...data };
};

const validate = (data) => {
  normalizeLeave(data);
};

const create = async (data) => {
  const normalized = normalizeLeave(data);
  if (await usePostgres()) return leaveRepository.create(normalized);
  return Leave.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? leaveRepository.findById(id) : Leave.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? leaveRepository.findOne(filter) : Leave.findOne(filter);

// The standing orders are { createdAt: -1 } (the leave lists),
// { fromDate: -1, createdAt: -1 } (the attendance and admin dashboards) and
// { fromDate: -1 } (the employee detail history); the caller supplies the exact
// Mongo sort it needs. limit/offset preserve the existing pagination semantics
// (the employee detail history reads the latest 100 records).
const findMany = async (options = {}) => {
  if (await usePostgres()) return leaveRepository.findMany(options);
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  let q = Leave.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// Patches the supplied fields only, on whichever datasource is selected — the
// PostgreSQL equivalent of Leave.findByIdAndUpdate(id, payload, { new: true })
// used by updateLeaveStatus.
const updateById = async (id, updates) => {
  if (updates) {
    if (updates.staffId !== undefined) assertId(updates.staffId, "staffId");
    if (updates.staffName !== undefined) assertId(updates.staffName, "staffName");
    if (updates.reason !== undefined) assertId(updates.reason, "reason");
    if (updates.fromDate !== undefined) assertDateKey(updates.fromDate, "fromDate");
    if (updates.toDate !== undefined) assertDateKey(updates.toDate, "toDate");
    if (updates.status !== undefined) assertEnum(updates.status, STATUSES, "status");
  }
  if (await usePostgres()) return leaveRepository.updateById(id, updates);
  return Leave.findByIdAndUpdate(id, updates, { new: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? leaveRepository.count(filter) : Leave.countDocuments(filter);

module.exports = {
  isConnected,
  usePostgres,
  STATUSES,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
};