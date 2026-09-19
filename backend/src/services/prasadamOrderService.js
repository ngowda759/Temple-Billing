const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const PrasadamOrder = require("../models/PrasadamOrder");
const prasadamOrderRepository = require("../repositories/prasadamOrderRepository");

// Mirrors the enums declared in backend/src/models/PrasadamOrder.js.
const CHANNELS = new Set(["devotee", "cashier"]);
const PAYMENT_METHODS = new Set(["UPI", "Cash", "Card", "Bank Transfer", "Net Banking", "Debit Card", "Credit Card"]);
const STATUSES = new Set([
  "Collected", "Not Collected", "Pending", "Approved", "Rejected",
  "Processing", "Ready for Pickup", "Completed", "Cancelled", "Placed",
  "Preparing", "Ready", "Delivered",
]);

// isConnected() mirrors the other Phase 2 services (booking/donation/pooja):
// it exposes the repository datasource-selection seam, which is mongoose's
// connectivity flag. That flag is what the tests pin to select the PostgreSQL
// branch deterministically (see test/postgres-repositories.test.js).
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Prasadam Order path. This is the
// Phase 2G fallback boundary: the service uses PostgreSQL when the established
// datasource seam is connected AND PostgreSQL is actually reachable. If either
// condition fails it routes back to the existing Mongoose model — so an
// unavailable PostgreSQL can never take the app down nor cause a partial write.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertAmount = (amount, label) => {
  if (amount === undefined || amount === null) return;
  const num = Number(amount);
  const isQuantity = label === "quantity";
  if (!Number.isFinite(num) || (isQuantity ? num < 1 : num < 0)) {
    const hint = isQuantity ? "Quantity must be >= 1" : `${label[0].toUpperCase() + label.slice(1)} must be >= 0`;
    throw new Error(`Invalid ${label}: ${amount}. ${hint}`);
  }
};

/**
 * Validates and normalizes prasadam order data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (devoteeController.createPrasadamOrder):
 *  - devoteeName / itemName are required (trimmed).
 *  - quantity defaults to 1 and must be >= 1.
 *  - unitPrice / amount must be >= 0 (Mongo schema min: 0).
 *  - channel ('devotee' | 'cashier') defaults to 'devotee'.
 *  - paymentMethod defaults to 'UPI'; status defaults to 'Not Collected'.
 */
const normalizePrasadamOrder = (data) => {
  if (!data) throw new Error("Prasadam order data is required");
  if (!data.devoteeName || !String(data.devoteeName).trim()) {
    throw new Error("devoteeName is required");
  }
  if (!data.itemName || !String(data.itemName).trim()) {
    throw new Error("itemName is required");
  }
  if (data.quantity !== undefined && (Number.isNaN(Number(data.quantity)) || Number(data.quantity) < 1)) {
    throw new Error(`Invalid quantity: ${data.quantity}. Quantity must be >= 1`);
  }
  assertAmount(data.unitPrice, "unitPrice");
  assertAmount(data.amount, "amount");
  assertEnum(data.channel, CHANNELS, "channel");
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");

  const normalized = { ...data };
  normalized.devoteeName = String(data.devoteeName).trim();
  normalized.itemName = String(data.itemName).trim();
  if (data.devoteeId !== undefined && data.devoteeId !== null && String(data.devoteeId).trim() !== "") {
    normalized.devoteeId = String(data.devoteeId).trim();
  } else {
    normalized.devoteeId = undefined;
  }
  if (data.email !== undefined && data.email !== null && String(data.email).trim() !== "") {
    normalized.email = String(data.email).trim();
  } else if (data.email !== undefined) {
    normalized.email = undefined;
  }
  if (data.phone !== undefined && data.phone !== null) {
    normalized.phone = String(data.phone).trim();
  }
  if (data.address !== undefined && data.address !== null && String(data.address).trim() !== "") {
    normalized.address = String(data.address).trim();
  } else if (data.address !== undefined) {
    normalized.address = undefined;
  }
  if (data.channel === undefined || data.channel === null || String(data.channel).trim() === "") {
    normalized.channel = "devotee";
  }
  if (data.paymentMethod === undefined || data.paymentMethod === null || String(data.paymentMethod).trim() === "") {
    normalized.paymentMethod = "UPI";
  }
  if (data.status === undefined || data.status === null || String(data.status).trim() === "") {
    normalized.status = "Not Collected";
  }
  if (data.quantity === undefined || data.quantity === null) {
    normalized.quantity = 1;
  }
  return normalized;
};

const validate = (data) => {
  normalizePrasadamOrder(data);
};

/**
 * Creates a prasadam order. When the PostgreSQL data source for Prasadam
 * Orders is selected (PostgreSQL reachable while the explicit Prasadam Order
 * path is active) the PostgreSQL repository is used; otherwise the existing
 * Mongoose model is used unchanged. No dual write ever happens.
 */
const create = async (data) => {
  const normalized = normalizePrasadamOrder(data);
  if (await usePostgres()) return prasadamOrderRepository.create(normalized);
  return PrasadamOrder.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? prasadamOrderRepository.findById(id) : PrasadamOrder.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? prasadamOrderRepository.findOne(filter) : PrasadamOrder.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? prasadamOrderRepository.findMany(options)
    : PrasadamOrder.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const findOneByRazorpayOrderId = async (razorpayOrderId) => {
  if (!razorpayOrderId) return null;
  return findOne({ razorpayOrderId: String(razorpayOrderId).trim() });
};

const updateById = async (id, updates) => {
  if (updates) {
    assertEnum(updates.channel, CHANNELS, "channel");
    assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
    assertEnum(updates.status, STATUSES, "status");
    assertAmount(updates.quantity, "quantity");
    assertAmount(updates.unitPrice, "unitPrice");
    assertAmount(updates.amount, "amount");
  }
  if (await usePostgres()) return prasadamOrderRepository.updateById(id, updates);
  return PrasadamOrder.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? prasadamOrderRepository.count(filter) : PrasadamOrder.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? prasadamOrderRepository.destroy(id) : Boolean(await PrasadamOrder.findByIdAndDelete(id));

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  findOneByRazorpayOrderId,
  updateById,
  count,
  destroy,
};