const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const InventoryRequest = require("../models/InventoryRequest");
const inventoryRequestRepository = require("../repositories/inventoryRequestRepository");

// Mirrors the enums declared in backend/src/models/InventoryRequest.js.
const PRIORITIES = new Set(["High", "Medium", "Low"]);
const REQUEST_STATUSES = new Set(["Pending", "Approved", "Rejected", "Issued"]);

// isConnected() mirrors the other Phase 2 services (inventoryItem/booking/
// donation/pooja/prasadam/batch/log/consumption): it exposes the repository
// datasource-selection seam, which is mongoose's connectivity flag. That flag
// is what the tests pin to select the PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure (const { isDbConnected } = ...), so tests can
// swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Inventory Request path. This is the
// Phase 2L fallback boundary: the service uses PostgreSQL when the established
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

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// The Mongo schema declares quantity as Number, required, min: 0 — zero is
// legal at the model layer (the HTTP controller rejects <= 0 before the model
// is reached), while negatives are rejected, mirroring the Mongoose min: 0
// validator exactly.
const assertQuantity = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0 (Mongo schema min: 0)`);
  }
};

/**
 * Validates and normalizes inventory request data so the PostgreSQL repository
 * and the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (inventoryRequestController.createInventoryRequest):
 *  - userId / userName / itemName / quantity / unit are required; reason and
 *    purpose are required by the schema (the controller normalizes them so at
 *    least one is present — it passes both).
 *  - quantity is min: 0 at the model level.
 *  - role defaults to 'Staff'.
 *  - priority defaults to 'Medium' and belongs to ['High','Medium','Low'].
 *  - status defaults to 'Pending' and belongs to ['Pending','Approved',
 *    'Rejected','Issued'].
 *  - requestedBy / adminReason / rejectionReason / approvedBy / reviewedBy
 *    default to ''.
 *  - rejectedAt / approvedAt / reviewedAt / issuedAt default to null.
 *  - expectedDate defaults to now (the controller passes `new Date()`).
 */
const normalizeInventoryRequest = (data) => {
  if (!data) throw new Error("Inventory request data is required");
  const userId = assertId(data.userId, "userId");
  assertText(data.userName, "userName");
  assertText(data.itemName, "itemName");
  assertQuantity(data.quantity, "quantity");
  assertText(data.unit, "unit");
  assertText(data.reason, "reason");
  assertText(data.purpose, "purpose");
  assertEnum(data.priority, PRIORITIES, "priority");
  assertEnum(data.status, REQUEST_STATUSES, "status");

  const normalized = { ...data };
  normalized.userId = userId;
  if (data.role === undefined || data.role === null) {
    normalized.role = "Staff";
  }
  if (data.requestedBy === undefined || data.requestedBy === null) {
    normalized.requestedBy = "";
  }
  if (data.priority === undefined || data.priority === null) {
    normalized.priority = "Medium";
  }
  if (data.status === undefined || data.status === null) {
    normalized.status = "Pending";
  }
  if (data.adminReason === undefined || data.adminReason === null) {
    normalized.adminReason = "";
  }
  if (data.rejectionReason === undefined || data.rejectionReason === null) {
    normalized.rejectionReason = "";
  }
  if (data.approvedBy === undefined || data.approvedBy === null) {
    normalized.approvedBy = "";
  }
  if (data.reviewedBy === undefined || data.reviewedBy === null) {
    normalized.reviewedBy = "";
  }
  if (data.expectedDate === undefined || data.expectedDate === null) {
    normalized.expectedDate = new Date();
  }
  return normalized;
};

const validate = (data) => {
  normalizeInventoryRequest(data);
};

const create = async (data, client) => {
  const normalized = normalizeInventoryRequest(data);
  if (await usePostgres()) return inventoryRequestRepository.create(normalized, client);
  return InventoryRequest.create(normalized);
};

const findById = async (id, client) =>
  (await usePostgres()) ? inventoryRequestRepository.findById(id, client) : InventoryRequest.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? inventoryRequestRepository.findOne(filter) : InventoryRequest.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? inventoryRequestRepository.findMany(options)
    : InventoryRequest.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates, client) => {
  if (updates) {
    if (updates.userId !== undefined && updates.userId !== null && String(updates.userId).trim() === "") {
      throw new Error("userId is required");
    }
    if (updates.userName !== undefined && updates.userName !== null && String(updates.userName).trim() === "") {
      throw new Error("userName is required");
    }
    if (updates.itemName !== undefined && updates.itemName !== null && String(updates.itemName).trim() === "") {
      throw new Error("itemName is required");
    }
    if (updates.unit !== undefined && updates.unit !== null && String(updates.unit).trim() === "") {
      throw new Error("unit is required");
    }
    if (updates.reason !== undefined && updates.reason !== null && String(updates.reason).trim() === "") {
      throw new Error("reason is required");
    }
    if (updates.purpose !== undefined && updates.purpose !== null && String(updates.purpose).trim() === "") {
      throw new Error("purpose is required");
    }
    if (updates.quantity !== undefined) assertQuantity(updates.quantity, "quantity");
    assertEnum(updates.priority, PRIORITIES, "priority");
    assertEnum(updates.status, REQUEST_STATUSES, "status");
  }
  if (await usePostgres()) return inventoryRequestRepository.updateById(id, updates, client);
  return InventoryRequest.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? inventoryRequestRepository.count(filter) : InventoryRequest.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? inventoryRequestRepository.destroy(id) : Boolean(await InventoryRequest.findByIdAndDelete(id));

module.exports = {
  isConnected,
  usePostgres,
  PRIORITIES,
  REQUEST_STATUSES,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};