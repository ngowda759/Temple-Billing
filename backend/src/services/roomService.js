const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Room = require("../models/Room");
const roomRepository = require("../repositories/roomRepository");

// Mirrors the enum declared in backend/src/models/Room.js exactly.
const STATUSES = new Set(["Available", "Occupied", "Maintenance"]);

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

// price is { required: true, min: 0 } in Mongo — required, finite and >= 0.
const assertMoney = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0`);
  }
};

// capacity / days are bare Numbers with no min in Mongo.
const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time
// destructure, so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Room path: PostgreSQL is used when the
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
 * Validates and normalizes room data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - number and type are required (trim; an all-whitespace value is rejected by
 *    Mongo's trim-then-required check).
 *  - price is required and must be >= 0 (Mongo `min: 0`).
 *  - capacity defaults to 2, bedType to 'Double', amenities to [] and status to
 *    'Available'.
 *  - block / floor / devotee / phone / days / payMode / checkinDate /
 *    checkoutDate are optional; blank optional strings collapse to undefined so
 *    they read back exactly as an unset Mongo field.
 *  - status must belong to the 3-value enum.
 */
const normalizeRoom = (data) => {
  if (!data) throw new Error("Room data is required");
  assertId(data.number, "number");
  assertId(data.type, "type");
  assertMoney(data.price, "price");
  assertNumber(data.capacity, "capacity");
  assertNumber(data.days, "days");
  const status = data.status === undefined || data.status === null || data.status === "" ? "Available" : data.status;
  assertEnum(status, STATUSES, "status");

  const normalized = { ...data };
  normalized.number = String(data.number).trim();
  normalized.type = String(data.type).trim();
  normalized.status = status;
  if (normalized.capacity === undefined) normalized.capacity = 2;
  if (normalized.bedType === undefined || normalized.bedType === null) normalized.bedType = "Double";
  else normalized.bedType = String(normalized.bedType).trim();
  if (normalized.amenities === undefined || normalized.amenities === null) normalized.amenities = [];
  else normalized.amenities = (Array.isArray(normalized.amenities) ? normalized.amenities : [normalized.amenities])
    .map((entry) => (entry === undefined || entry === null ? null : String(entry)));

  const optionalText = ["block", "floor", "devotee", "phone", "payMode"];
  for (const field of optionalText) {
    if (normalized[field] === undefined || normalized[field] === null || String(normalized[field]).trim() === "") {
      delete normalized[field];
    } else {
      normalized[field] = String(normalized[field]).trim();
    }
  }
  for (const field of ["days", "checkinDate", "checkoutDate"]) {
    if (normalized[field] === undefined || normalized[field] === null) delete normalized[field];
  }
  if (normalized.checkinDate !== undefined) {
    normalized.checkinDate = normalized.checkinDate instanceof Date ? normalized.checkinDate : new Date(normalized.checkinDate);
  }
  if (normalized.checkoutDate !== undefined) {
    normalized.checkoutDate = normalized.checkoutDate instanceof Date ? normalized.checkoutDate : new Date(normalized.checkoutDate);
  }
  return normalized;
};

const validate = (data) => {
  normalizeRoom(data);
};

const create = async (data) => {
  const normalized = normalizeRoom(data);
  if (await usePostgres()) return roomRepository.create(normalized);
  return Room.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? roomRepository.findById(id) : Room.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? roomRepository.findOne(filter) : Room.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? roomRepository.findMany(options)
    : Room.find(options.filter || {}).sort(options.sort || { number: 1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.number !== undefined) assertId(updates.number, "number");
    if (updates.type !== undefined) assertId(updates.type, "type");
    if (updates.price !== undefined) assertMoney(updates.price, "price");
    assertNumber(updates.capacity, "capacity");
    assertNumber(updates.days, "days");
    assertEnum(updates.status, STATUSES, "status");
  }
  if (await usePostgres()) return roomRepository.updateById(id, updates);
  return Room.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

// Checkout semantics shared by POST /checkout/:roomNumber and the app.js
// auto-checkout scheduler: the guest fields are cleared and the room returns to
// 'Available'. Routed through the service so the write follows the selected
// datasource.
const release = async (id) => {
  if (await usePostgres()) return roomRepository.release(id);
  const room = await Room.findById(id);
  if (!room) return null;
  room.status = "Available";
  room.devotee = undefined;
  room.phone = undefined;
  room.days = undefined;
  room.payMode = undefined;
  room.checkinDate = undefined;
  room.checkoutDate = undefined;
  await room.save();
  return room;
};

// DELETE /api/rooms/:roomNumber deletes by room number, so the service exposes
// the same find-and-delete shape the route needs (the bare `destroy(id)` path
// is used by the by-id delete surfaces).
const findOneAndDelete = async (filter = {}) => {
  if (await usePostgres()) {
    const existing = await roomRepository.findOne(filter);
    if (existing?._id) {
      await roomRepository.destroy(existing._id);
      return existing;
    }
    return null;
  }
  return Room.findOneAndDelete(filter);
};

const count = async (filter = {}) =>
  (await usePostgres()) ? roomRepository.count(filter) : Room.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? roomRepository.destroy(id) : Boolean(await Room.findByIdAndDelete(id));

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
  release,
  findOneAndDelete,
  count,
  destroy,
};
