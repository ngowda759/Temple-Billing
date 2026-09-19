const dbConfig = require("../config/db");
const Donation = require("../models/Donation");
const donationRepository = require("../repositories/donationRepository");

const PAYMENT_METHODS = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Debit Card", "Credit Card", "Net Banking"]);
const STATUSES = new Set(["Collected", "Not Collected", "Completed", "Pending", "Failed"]);

const isConnected = () => dbConfig.isDbConnected();

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount === undefined || amount === null || !Number.isFinite(num) || num <= 0) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number > 0 (Mongo schema min: 0, application requires > 0).`);
  }
};

/**
 * Validates and normalizes donation data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (donationController.createDonation, devoteeController.createDonation,
 * devoteeController.createRazorpayOrder / verifyRazorpayPayment / webhook):
 *  - `donorName` is required and trimmed.
 *  - `amount` is required and must be a positive number.
 *  - `donorEmail` is trimmed and lowercased (the Mongo schema declares
 *    lowercase: true).
 *  - `category` defaults to "General"; `paymentMethod` defaults to "UPI";
 *    `status` defaults to "Not Collected" (all Mongo defaults).
 *  - `paymentMethod` and `status` must be one of the Mongo enum values.
 */
const normalizeDonation = (data) => {
  if (!data || !data.donorName || !String(data.donorName).trim()) {
    throw new Error("donorName is required");
  }
  if (data.amount === undefined || data.amount === null) {
    throw new Error("amount is required");
  }
  assertAmount(data.amount);
  assertEnum(data.paymentMethod, PAYMENT_METHODS, "paymentMethod");
  assertEnum(data.status, STATUSES, "status");

  const normalized = { ...data };
  normalized.donorName = String(data.donorName).trim();
  if (data.donorEmail !== undefined && data.donorEmail !== null && String(data.donorEmail).trim() !== "") {
    normalized.donorEmail = String(data.donorEmail).trim().toLowerCase();
  } else if (data.donorEmail !== undefined) {
    normalized.donorEmail = undefined;
  }
  if (data.contactNumber !== undefined && data.contactNumber !== null) {
    normalized.contactNumber = String(data.contactNumber).trim();
  }
  if (data.donorPhone !== undefined && data.donorPhone !== null) {
    normalized.donorPhone = String(data.donorPhone).trim();
  }
  if (data.category === undefined || data.category === null || String(data.category).trim() === "") {
    normalized.category = "General";
  } else if (typeof data.category === "string") {
    normalized.category = data.category.trim();
  }
  if (data.paymentMethod === undefined || data.paymentMethod === null || String(data.paymentMethod).trim() === "") {
    normalized.paymentMethod = "UPI";
  }
  if (data.status === undefined || data.status === null || String(data.status).trim() === "") {
    normalized.status = "Not Collected";
  }
  return normalized;
};

const validate = (data) => {
  normalizeDonation(data);
};

const create = async (data) => {
  const normalized = normalizeDonation(data);
  if (isConnected()) return donationRepository.create(normalized);
  return Donation.create(normalized);
};

const findById = async (id) =>
  isConnected() ? donationRepository.findById(id) : Donation.findById(id);

const findOne = async (filter = {}) =>
  isConnected() ? donationRepository.findOne(filter) : Donation.findOne(filter);

const findMany = async (options = {}) =>
  isConnected()
    ? donationRepository.findMany(options)
    : Donation.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.amount !== undefined) assertAmount(updates.amount);
    assertEnum(updates.paymentMethod, PAYMENT_METHODS, "paymentMethod");
    assertEnum(updates.status, STATUSES, "status");
  }
  return isConnected()
    ? donationRepository.updateById(id, updates)
    : Donation.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  isConnected() ? donationRepository.count(filter) : Donation.countDocuments(filter);

const destroy = async (id) =>
  isConnected() ? donationRepository.destroy(id) : Boolean(await Donation.findByIdAndDelete(id));

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