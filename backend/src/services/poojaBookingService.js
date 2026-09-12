const { isDbConnected } = require("../config/db");
const PoojaBooking = require("../models/PoojaBooking");
const poojaBookingRepository = require("../repositories/poojaBookingRepository");

// Mirrors the enums declared in backend/src/models/PoojaBooking.js.
const PAYMENT_METHODS = new Set(["UPI", "Cash", "Card"]);
const STATUSES = new Set(["Booked", "Completed", "Cancelled"]);
const MATERIAL_STATUSES = new Set(["N/A", "Pending", "Approved", "Reserved", "Ready", "Issued", "Consumed", "Cancelled"]);

const isConnected = () => isDbConnected();

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
    throw new Error(`Invalid amount: ${amount}. Amount must be a number >= 0.`);
  }
};

/**
 * Validates and normalizes pooja booking data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (poojaBookingController.createBooking, cancelBooking):
 *  - customerName / service / amount / paymentMethod / contactNumber /
 *    bookingDate / createdBy are required.
 *  - bookingNumber is unique and auto-generated (PB1001 onwards) by the Mongo
 *    pre-validate hook; when absent the same algorithm is applied.
 *  - paymentMethod / status / materialStatus / priestChecklist /
 *    templeArrangement / templeMaterialCharge / notes default as the Mongo
 *    schema does and must belong to the enum value sets where applicable.
 */
const normalizePoojaBooking = (data) => {
  if (!data) throw new Error("Pooja booking data is required");
  if (!data.customerName || !String(data.customerName).trim()) {
    throw new Error("customerName is required");
  }
  if (!data.service || !String(data.service).trim()) {
    throw new Error("service is required");
  }
  if (data.amount === undefined || data.amount === null) {
    throw new Error("amount is required");
  }
  if (data.paymentMethod === undefined || data.paymentMethod === null || String(data.paymentMethod).trim() === "") {
    throw new Error("paymentMethod is required");
  }
  if (data.contactNumber === undefined || data.contactNumber === null || String(data.contactNumber).trim() === "") {
    throw new Error("contactNumber is required");
  }
  if (data.bookingDate === undefined || data.bookingDate === null || Number.isNaN(new Date(data.bookingDate).getTime())) {
    throw new Error("bookingDate is required");
  }
  if (data.createdBy === undefined || data.createdBy === null || String(data.createdBy).trim() === "") {
    throw new Error("createdBy is required");
  }
  assertAmount(data.amount);
  assertAmount(data.templeMaterialCharge);
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.materialStatus, MATERIAL_STATUSES, "materialStatus");

  const normalized = { ...data };
  normalized.customerName = String(data.customerName).trim();
  normalized.service = String(data.service).trim();
  if (data.createdBy !== undefined && data.createdBy !== null) {
    normalized.createdBy = String(data.createdBy).trim();
  }
  if (data.contactNumber !== undefined && data.contactNumber !== null) {
    normalized.contactNumber = String(data.contactNumber).trim();
  }
  if (data.email !== undefined && data.email !== null && String(data.email).trim() !== "") {
    normalized.email = String(data.email).trim();
  } else if (data.email !== undefined) {
    normalized.email = undefined;
  }
  if (data.address !== undefined && data.address !== null && String(data.address).trim() !== "") {
    normalized.address = String(data.address).trim();
  } else if (data.address !== undefined) {
    normalized.address = undefined;
  }
  if (data.status === undefined || data.status === null || String(data.status).trim() === "") {
    normalized.status = "Booked";
  }
  if (data.materialStatus === undefined || data.materialStatus === null || String(data.materialStatus).trim() === "") {
    normalized.materialStatus = "N/A";
  }
  if (data.notes === undefined || data.notes === null) {
    normalized.notes = "";
  }
  if (data.templeArrangement === undefined || data.templeArrangement === null) {
    normalized.templeArrangement = false;
  }
  if (data.templeMaterialCharge === undefined || data.templeMaterialCharge === null) {
    normalized.templeMaterialCharge = 0;
  }
  if (data.priestChecklist === undefined || data.priestChecklist === null) {
    normalized.priestChecklist = {
      devoteeArrived: false,
      templeMaterialsReceived: false,
      devoteeMaterialsChecked: false,
      poojaStarted: false,
      poojaCompleted: false,
      inventoryConsumed: false,
    };
  }
  if (data.templeMaterialRequests === undefined) {
    normalized.templeMaterialRequests = [];
  }
  if (!normalized.bookingNumber) {
    normalized.bookingNumber = generateBookingNumber(data.existingBookingNumbers, data.highestBookingNumber);
  }
  return normalized;
};

// Mirrors the Mongo pre-validate hook: PB1001 onwards, nextNumber = last + 1.
const generateBookingNumber = (existingNumbers, highest) => {
  let nextNumber = 1001;
  if (highest) {
    const parsed = parseInt(String(highest).replace("PB", "").trim(), 10);
    if (!Number.isNaN(parsed)) nextNumber = parsed + 1;
  } else if (Array.isArray(existingNumbers)) {
    for (const num of existingNumbers) {
      const parsed = parseInt(String(num).replace("PB", "").trim(), 10);
      if (!Number.isNaN(parsed) && parsed >= nextNumber) nextNumber = parsed + 1;
    }
  }
  return `PB${nextNumber}`;
};

const validate = (data) => {
  normalizePoojaBooking(data);
};

const create = async (data) => {
  const normalized = normalizePoojaBooking(data);
  if (isConnected()) return poojaBookingRepository.create(normalized);
  return PoojaBooking.create(normalized);
};

const findById = async (id) =>
  isConnected() ? poojaBookingRepository.findById(id) : PoojaBooking.findById(id);

const findOne = async (filter = {}) =>
  isConnected() ? poojaBookingRepository.findOne(filter) : PoojaBooking.findOne(filter);

const findMany = async (options = {}) =>
  isConnected()
    ? poojaBookingRepository.findMany(options)
    : PoojaBooking.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    assertAmount(updates.amount);
    assertAmount(updates.templeMaterialCharge);
    assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
    assertEnum(updates.status, STATUSES, "status");
    assertEnum(updates.materialStatus, MATERIAL_STATUSES, "materialStatus");
  }
  return isConnected()
    ? poojaBookingRepository.updateById(id, updates)
    : PoojaBooking.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  isConnected() ? poojaBookingRepository.count(filter) : PoojaBooking.countDocuments(filter);

const destroy = async (id) =>
  isConnected() ? poojaBookingRepository.destroy(id) : Boolean(await PoojaBooking.findByIdAndDelete(id));

module.exports = {
  isConnected,
  validate,
  generateBookingNumber,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};