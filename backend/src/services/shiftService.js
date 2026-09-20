const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Shift = require("../models/Shift");
const shiftRepository = require("../repositories/shiftRepository");

// Mirrors the `required: true` checks declared in backend/src/models/Shift.js.
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

// The explicit PostgreSQL gate for the Shift path: PostgreSQL is used when the
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
 * Validates and normalizes shift data so the PostgreSQL repository and the Mongo
 * model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - shiftName / startTime / endTime are required (trim; an all-whitespace value
 *    is rejected by Mongo's trim-then-required check).
 *  - category defaults to 'General', requiredStaff to 1, active to true and
 *    notes to ''.
 *  - startTime / endTime are the 12-hour meridiem display strings ("9:00 AM")
 *    the frontend form produces. Their format is NOT validated here: the Mongoose
 *    schema declares them as free Strings and Mongo enforces nothing, so
 *    rejecting a differently-shaped value would make PostgreSQL stricter than
 *    the source of truth.
 *  - No start/end ordering rule is applied: overnight shifts (end <= start) are
 *    a legitimate, supported case handled by normalizeRange in the controller.
 *
 * The result is passed to the repository, which re-derives the same defaults
 * when building the row.
 */
const normalizeShift = (data) => {
  if (!data) throw new Error("Shift data is required");
  assertId(data.shiftName, "shiftName");
  assertId(data.startTime, "startTime");
  assertId(data.endTime, "endTime");
  assertNumber(data.requiredStaff, "requiredStaff");

  const normalized = { ...data };
  normalized.shiftName = String(data.shiftName).trim();
  normalized.startTime = String(data.startTime).trim();
  normalized.endTime = String(data.endTime).trim();
  return normalized;
};

const validate = (data) => {
  normalizeShift(data);
};

// Mirrors Shift.create({...}) in shiftController.createShift.
const create = async (data) => {
  const normalized = normalizeShift(data);
  if (await usePostgres()) return shiftRepository.create(normalized);
  return Shift.create(normalized);
};

// Mirrors Shift.find().sort({ createdAt: -1 }) (getShifts / getShiftDashboard)
// and Shift.find({ active: true }).sort({ shiftName: 1 }) (the attendance
// dashboard). The caller supplies the exact Mongo filter and sort it needs;
// limit/offset preserve the existing pagination semantics.
const findMany = async (options = {}) => {
  if (await usePostgres()) return shiftRepository.findMany(options);
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  let q = Shift.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// Mirrors Shift.findById (updateShift / deleteShift / assignShift).
const findById = async (id) =>
  (await usePostgres()) ? shiftRepository.findById(id) : Shift.findById(id);

// Mirrors Shift.findOne({ ... }).sort({ ... }) — the default-shift conflict check
// in assignShift and the case-insensitive name resolution in
// attendanceController.resolveShiftDefinition.
const findOne = async (filter = {}, sort = { createdAt: -1 }) =>
  (await usePostgres()) ? shiftRepository.findOne(filter, sort) : Shift.findOne(filter).sort(sort);

// Mirrors Shift.findByIdAndUpdate(id, payload, { new: true }) — the PostgreSQL
// equivalent of the loaded-document save() that updateShift performs.
const updateById = async (id, updates) => {
  if (updates) {
    if (updates.shiftName !== undefined) assertId(updates.shiftName, "shiftName");
    if (updates.startTime !== undefined) assertId(updates.startTime, "startTime");
    if (updates.endTime !== undefined) assertId(updates.endTime, "endTime");
    if (updates.requiredStaff !== undefined) assertNumber(updates.requiredStaff, "requiredStaff");
  }
  if (await usePostgres()) return shiftRepository.updateById(id, updates);
  return Shift.findByIdAndUpdate(id, updates, { new: true });
};

// Mirrors Shift.findByIdAndDelete(id). The controller's follow-up Task cascade
// is unchanged and routes through taskService — Task is a different domain.
const destroy = async (id) =>
  (await usePostgres()) ? shiftRepository.destroy(id) : Shift.findByIdAndDelete(id);

const count = async (filter = {}) =>
  (await usePostgres()) ? shiftRepository.count(filter) : Shift.countDocuments(filter);

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  destroy,
  count,
};