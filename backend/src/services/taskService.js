const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Task = require("../models/Task");
const taskRepository = require("../repositories/taskRepository");

// Mirrors the `required: true` checks declared in backend/src/models/Task.js.
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Task path: PostgreSQL is used when the
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
 * Validates and normalizes Task data so the PostgreSQL repository and the Mongo
 * model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - staffId / staffName / duty / area / time / assignedBy are required (trim; an
 *    all-whitespace value is rejected by Mongo's trim-then-required check too).
 *  - Every other path is optional and its default belongs to the schema
 *    ('Duty & Shift', '', 'Pending', 'Medium', 1, 0, false).
 *  - startTime / endTime / time / reportingTime / shiftStartTime / shiftEndTime
 *    are 12-hour meridiem display strings. Their format is NOT validated here:
 *    the Mongoose schema declares them as free Strings and Mongo enforces
 *    nothing, so rejecting a differently-shaped value would make PostgreSQL
 *    stricter than the source of truth.
 *  - dateKey / dueDate are "YYYY-MM-DD" day strings, compared lexicographically
 *    by the controllers; they are NOT parsed into Dates here for the same reason.
 *  - No uniqueness rule is applied: the schema declares no unique index, so the
 *    application detects duty conflicts in code rather than rejecting writes.
 *
 * The result is passed to the repository, which re-derives the same defaults
 * when building the row.
 */
const normalizeTask = (data) => {
  if (!data) throw new Error("Task data is required");
  assertId(data.staffId, "staffId");
  assertId(data.staffName, "staffName");
  assertId(data.duty, "duty");
  assertId(data.area, "area");
  assertId(data.time, "time");
  assertId(data.assignedBy, "assignedBy");
  assertNumber(data.requiredStaff, "requiredStaff");
  assertNumber(data.durationMinutes, "durationMinutes");
  assertNumber(data.completionDuration, "completionDuration");

  const normalized = { ...data };
  for (const key of ["staffId", "staffName", "duty", "area", "time", "assignedBy"]) {
    normalized[key] = String(data[key]).trim();
  }
  return normalized;
};

const validate = (data) => {
  normalizeTask(data);
};

// Mirrors Task.create({...}). Note that the Mongoose schema's strict mode drops
// fields it does not declare (employeeName/employeeEmail/category in
// shiftController.assignShift, category in transferController.resolveTransferRequest);
// the repository reproduces that by simply not mapping them.
const create = async (data) => {
  const normalized = normalizeTask(data);
  if (await usePostgres()) return taskRepository.create(normalized);
  return Task.create(normalized);
};

// Mirrors Task.find(filter).sort(sort) with the optional limit the callers chain.
// The caller supplies the exact Mongo filter and sort it needs.
const findMany = async (options = {}) => {
  if (await usePostgres()) return taskRepository.findMany(options);
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  let q = Task.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// Mirrors Task.findById(id).
const findById = async (id) =>
  (await usePostgres()) ? taskRepository.findById(id) : Task.findById(id);

// Mirrors Task.findOne({...}).sort({...}) — the duty status transitions in
// priestController pass { _id, $or: [{ staffId }, { staffEmail }] }.
const findOne = async (filter = {}, sort = { createdAt: -1 }) =>
  (await usePostgres()) ? taskRepository.findOne(filter, sort) : Task.findOne(filter).sort(sort);

// Mirrors the loaded-document mutation + save() that the controllers perform
// (accept/reject/complete, startMyDuty/completeMyDuty, directAdminTransfer). On
// PostgreSQL this becomes a single UPDATE of the supplied fields.
const updateById = async (id, updates) => {
  if (updates) {
    for (const label of ["staffId", "staffName", "duty", "area", "time", "assignedBy"]) {
      if (updates[label] !== undefined) assertId(updates[label], label);
    }
    for (const label of ["requiredStaff", "durationMinutes", "completionDuration"]) {
      if (updates[label] !== undefined) assertNumber(updates[label], label);
    }
  }
  if (await usePostgres()) return taskRepository.updateById(id, updates);
  return Task.findByIdAndUpdate(id, updates, { new: true });
};

// Mirrors Task.updateMany(filter, updates) — getSevaSchedule's dateKey rollover.
const updateMany = async (filter, updates) =>
  (await usePostgres())
    ? taskRepository.updateMany(filter, updates)
    : Task.updateMany(filter, updates);

// Mirrors Task.findByIdAndDelete(id).
const destroy = async (id) =>
  (await usePostgres()) ? taskRepository.destroy(id) : Task.findByIdAndDelete(id);

// Mirrors Task.deleteMany({ shiftId }) — the application-level cascade
// shiftController.deleteShift performs once the shift itself is removed. Both
// the shift and its tasks can live on either datasource, and the service is the
// authority: PostgreSQL is selected only when the seam says both are reachable.
const deleteMany = async (filter = {}) =>
  (await usePostgres()) ? taskRepository.deleteMany(filter) : Task.deleteMany(filter);

const count = async (filter = {}) =>
  (await usePostgres()) ? taskRepository.count(filter) : Task.countDocuments(filter);

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  updateMany,
  destroy,
  deleteMany,
  count,
};