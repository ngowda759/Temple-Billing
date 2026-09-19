const dbConfig = require("../config/db");
const Booking = require("../models/Booking");
const bookingRepository = require("../repositories/bookingRepository");

const PAYMENT_METHODS = new Set(["UPI", "Cash", "Card", "Bank Transfer", "Net Banking"]);
const PAYMENT_STATUSES = new Set(["Pending", "Paid", "Failed", "Refunded"]);
const STATUSES = new Set([
  "Booked", "Pending", "Approved", "Confirmed", "Assigned", "In Progress",
  "Completed", "Rejected", "Cancelled", "Upcoming", "Transfer Requested", "Transferred",
]);
const MATERIAL_STATUSES = new Set([
  "N/A", "Pending Approval", "Approved", "Ready for Collection", "Issued",
  "Acknowledged", "Consumed", "Cancelled", "Pending", "Reserved", "Ready",
]);

const isConnected = () => dbConfig.isDbConnected();

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertAmount = (amount) => {
  if (amount === undefined || amount === null) return;
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number >= 0 (Mongo schema min: 0).`);
  }
};

/**
 * Validates and normalizes booking data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (devoteeController.createBooking, verifyBookingPayment, bookingController
 * status transitions, priestController, roomRoutes.allotRoom):
 *  - devoteeName / service / datetime are required.
 *  - amount is required and must be a non-negative number.
 *  - devoteeEmail is trimmed and lowercased (the Mongo schema declares
 *    lowercase: true).
 *  - paymentMethod / paymentStatus / status / materialStatus default as the
 *    Mongo schema does and must belong to the enum value sets.
 */
const normalizeBooking = (data) => {
  if (!data) throw new Error("Booking data is required");
  if (!data.devoteeName || !String(data.devoteeName).trim()) {
    throw new Error("devoteeName is required");
  }
  if (!data.service || !String(data.service).trim()) {
    throw new Error("service is required");
  }
  if (!data.datetime || !String(data.datetime).trim()) {
    throw new Error("datetime is required");
  }
  if (data.amount === undefined || data.amount === null) {
    throw new Error("amount is required");
  }
  assertAmount(data.amount);
  assertAmount(data.gst);
  assertAmount(data.templeMaterialCharge);
  assertAmount(data.completionDuration);
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.paymentStatus, PAYMENT_STATUSES, "paymentStatus");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.materialStatus, MATERIAL_STATUSES, "materialStatus");

  const normalized = { ...data };
  normalized.devoteeName = String(data.devoteeName).trim();
  if (data.devoteeEmail !== undefined && data.devoteeEmail !== null && String(data.devoteeEmail).trim() !== "") {
    normalized.devoteeEmail = String(data.devoteeEmail).trim().toLowerCase();
  } else if (data.devoteeEmail !== undefined) {
    normalized.devoteeEmail = undefined;
  }
  if (data.devoteePhone !== undefined && data.devoteePhone !== null) {
    normalized.devoteePhone = String(data.devoteePhone).trim();
  }
  if (data.paymentMethod === undefined || data.paymentMethod === null || String(data.paymentMethod).trim() === "") {
    normalized.paymentMethod = "UPI";
  }
  if (data.paymentStatus === undefined || data.paymentStatus === null || String(data.paymentStatus).trim() === "") {
    normalized.paymentStatus = "Paid";
  }
  if (data.status === undefined || data.status === null || String(data.status).trim() === "") {
    normalized.status = "Completed";
  }
  if (data.materialStatus === undefined || data.materialStatus === null || String(data.materialStatus).trim() === "") {
    normalized.materialStatus = "N/A";
  }
  if (data.bookingHistory === undefined) normalized.bookingHistory = [];
  if (data.templeMaterialRequests === undefined) normalized.templeMaterialRequests = [];
  if (data.items === undefined) normalized.items = [];
  return normalized;
};

const validate = (data) => {
  normalizeBooking(data);
};

const create = async (data) => {
  const normalized = normalizeBooking(data);
  if (isConnected()) return bookingRepository.create(normalized);
  return Booking.create(normalized);
};

const findById = async (id) =>
  isConnected() ? bookingRepository.findById(id) : Booking.findById(id);

const findOne = async (filter = {}) =>
  isConnected() ? bookingRepository.findOne(filter) : Booking.findOne(filter);

const findMany = async (options = {}) =>
  isConnected()
    ? bookingRepository.findMany(options)
    : Booking.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    assertAmount(updates.amount);
    assertAmount(updates.gst);
    assertAmount(updates.templeMaterialCharge);
    assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
    assertEnum(updates.paymentStatus, PAYMENT_STATUSES, "paymentStatus");
    assertEnum(updates.status, STATUSES, "status");
    assertEnum(updates.materialStatus, MATERIAL_STATUSES, "materialStatus");
  }
  return isConnected()
    ? bookingRepository.updateById(id, updates)
    : Booking.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  isConnected() ? bookingRepository.count(filter) : Booking.countDocuments(filter);

const destroy = async (id) =>
  isConnected() ? bookingRepository.destroy(id) : Boolean(await Booking.findByIdAndDelete(id));

module.exports = {
  isConnected,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};