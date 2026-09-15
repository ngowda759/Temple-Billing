const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Attendance = require("../models/Attendance");
const attendanceRepository = require("../repositories/attendanceRepository");

// Mirrors the enum declared in backend/src/models/Attendance.js exactly.
const STATUSES = new Set([
  "Present", "Absent", "Half Day", "Leave", "Pending",
  "Working", "Holiday", "Late", "Weekly Off", "Compensatory Off",
]);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

// workingMinutes / overtimeMinutes / latitude / longitude / distanceFromTemple
// are bare Numbers with no min in Mongo — only finiteness is checked, exactly
// like the schema.
const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const assertDateKey = (value, label = "dateKey") => {
  const text = assertId(value, label);
  if (!DATE_KEY_PATTERN.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a YYYY-MM-DD calendar key`);
  }
  return text;
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Attendance path: PostgreSQL is used when
// the datasource seam is connected AND PostgreSQL is actually reachable. If
// either condition fails the existing Mongoose model handles the operation.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * Validates and normalizes attendance data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - staffId / staffName / dateKey are required (trim; an all-whitespace value
 *    is rejected by Mongo's trim-then-required check).
 *  - dateKey is the 'YYYY-MM-DD' calendar key every write path produces.
 *  - status defaults to 'Absent' and must belong to the 10-value enum.
 *  - checkIn / checkOut default to '--', workingHours / overtimeHours to '--',
 *    shift to 'Morning', source to 'manual', the remaining Strings to ''.
 *  - workingMinutes / overtimeMinutes default to 0 with no minimum.
 *  - employeeId / staffEmail are optional; blank optional strings collapse to
 *    undefined so they read back exactly as an unset Mongo field.
 *  - checkInAt / checkOutAt / correctionDate / latitude / longitude /
 *    distanceFromTemple are optional and keep their null default.
 */
const normalizeAttendance = (data) => {
  if (!data) throw new Error("Attendance data is required");
  assertId(data.staffId, "staffId");
  assertId(data.staffName, "staffName");
  assertDateKey(data.dateKey);
  const status = data.status === undefined || data.status === null || data.status === ""
    ? "Absent"
    : data.status;
  assertEnum(status, STATUSES, "status");
  assertNumber(data.workingMinutes, "workingMinutes");
  assertNumber(data.overtimeMinutes, "overtimeMinutes");
  assertNumber(data.latitude, "latitude");
  assertNumber(data.longitude, "longitude");
  assertNumber(data.distanceFromTemple, "distanceFromTemple");

  const normalized = { ...data };
  normalized.staffId = String(data.staffId).trim();
  normalized.staffName = String(data.staffName).trim();
  normalized.dateKey = assertDateKey(data.dateKey);
  normalized.status = status;

  const optionalText = ["employeeId", "staffEmail"];
  for (const field of optionalText) {
    if (normalized[field] === undefined || normalized[field] === null || String(normalized[field]).trim() === "") {
      delete normalized[field];
    } else {
      normalized[field] = String(normalized[field]).trim();
    }
  }
  for (const field of ["checkInAt", "checkOutAt", "correctionDate"]) {
    if (normalized[field] === undefined || normalized[field] === null || String(normalized[field]).trim() === "") {
      delete normalized[field];
    } else {
      normalized[field] = normalized[field] instanceof Date ? normalized[field] : new Date(normalized[field]);
    }
  }
  for (const field of ["latitude", "longitude", "distanceFromTemple"]) {
    if (normalized[field] === undefined || normalized[field] === null || String(normalized[field]).trim() === "") {
      delete normalized[field];
    }
  }
  return normalized;
};

const validate = (data) => {
  normalizeAttendance(data);
};

const create = async (data) => {
  const normalized = normalizeAttendance(data);
  if (await usePostgres()) return attendanceRepository.create(normalized);
  return Attendance.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? attendanceRepository.findById(id) : Attendance.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? attendanceRepository.findOne(filter) : Attendance.findOne(filter);

// The dashboards' standing order is { dateKey: -1, createdAt: -1 } on both
// datasources; the caller supplies the exact Mongo sort it needs. limit/offset
// preserve the existing pagination semantics (employee detail history reads the
// latest 100 records).
const findMany = async (options = {}) => {
  if (await usePostgres()) return attendanceRepository.findMany(options);
  const { filter = {}, sort = { dateKey: -1, createdAt: -1 }, limit, offset } = options;
  let q = Attendance.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// Patches the supplied fields only, on whichever datasource is selected — the
// PostgreSQL equivalent of mutating the loaded Mongoose document and calling
// save() (the check-out and admin-correction flows).
const updateById = async (id, updates) => {
  if (updates) {
    if (updates.staffId !== undefined) assertId(updates.staffId, "staffId");
    if (updates.staffName !== undefined) assertId(updates.staffName, "staffName");
    if (updates.dateKey !== undefined) assertDateKey(updates.dateKey);
    assertEnum(updates.status, STATUSES, "status");
    assertNumber(updates.workingMinutes, "workingMinutes");
    assertNumber(updates.overtimeMinutes, "overtimeMinutes");
    assertNumber(updates.latitude, "latitude");
    assertNumber(updates.longitude, "longitude");
    assertNumber(updates.distanceFromTemple, "distanceFromTemple");
  }
  if (await usePostgres()) return attendanceRepository.updateById(id, updates);
  return Attendance.findByIdAndUpdate(id, updates, { new: true });
};

// Mirrors Attendance.create(payload) on the check-in path, keeping the existing
// Mongoose contract on the fallback branch.
const createOrUpdate = async (filter, data) => {
  const normalized = normalizeAttendance(data);
  if (await usePostgres()) {
    const existing = await attendanceRepository.findOne(filter);
    if (existing?._id) return attendanceRepository.updateById(existing._id, normalized);
    return attendanceRepository.create(normalized);
  }
  if (filter && Object.keys(filter).length) {
    return Attendance.findOneAndUpdate(filter, normalized, { new: true, upsert: true, setDefaultsOnInsert: true });
  }
  return Attendance.create(normalized);
};

const count = async (filter = {}) =>
  (await usePostgres()) ? attendanceRepository.count(filter) : Attendance.countDocuments(filter);

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
  createOrUpdate,
  count,
};