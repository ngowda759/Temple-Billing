const { isDbConnected } = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const InventoryBatch = require("../models/InventoryBatch");
const inventoryBatchRepository = require("../repositories/inventoryBatchRepository");

// Mirrors the enums declared in backend/src/models/InventoryBatch.js.
const STATUSES = new Set(["Active", "Quarantine", "Expired", "Consumed", "Returned", "Disposed"]);

// isConnected() mirrors the other Phase 2 services (inventoryItem/booking/
// donation/pooja/prasadam): it exposes the repository datasource-selection
// seam, which is mongoose's connectivity flag. That flag is what the tests pin
// to select the PostgreSQL branch deterministically.
const isConnected = () => isDbConnected();

// The explicit PostgreSQL gate for the Inventory Batch path. This is the
// Phase 2I fallback boundary: the service uses PostgreSQL when the established
// datasource seam is connected AND PostgreSQL is actually reachable. If either
// condition fails it routes back to the existing Mongoose model — so an
// unavailable PostgreSQL can never take the app down nor cause a partial write.
const usePostgres = async () => {
  if (!isDbConnected()) return false;
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

const assertQuantity = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number >= 0 (Mongo schema min: 0)`);
  }
};

// purchasePrice has NO min in the Mongo schema ({ type: Number, default: 0 }),
// so negatives are allowed exactly as Mongo; only non-numeric values are
// rejected.
const assertPrice = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

/**
 * Validates and normalizes inventory batch data so the PostgreSQL repository
 * and the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (inventoryWorkflowController.approveGRN / logKitchenProduction):
 *  - item is required (a 24-hex ObjectId in practice; any non-empty string is
 *    accepted like Mongoose does and is validated by the FK).
 *  - batchNumber is required (approveGRN falls back to `AUTO-${Date.now()}`).
 *  - originalQuantity / currentQuantity are required, min: 0, decimals
 *    allowed.
 *  - purchasePrice defaults to 0 and has NO min.
 *  - status defaults to 'Active' and belongs to the fixed enum.
 *  - grn / manufacturingDate / expiryDate / supplier are optional; expiryDate
 *    is a Mongoose Date instant.
 */
const normalizeInventoryBatch = (data) => {
  if (!data) throw new Error("Inventory batch data is required");
  assertId(data.item, "item");
  assertBatchNumber(data.batchNumber, "batchNumber");
  assertQuantity(data.originalQuantity, "originalQuantity");
  assertQuantity(data.currentQuantity, "currentQuantity");
  assertEnum(data.status, STATUSES, "status");
  assertPrice(data.purchasePrice, "purchasePrice");

  const normalized = { ...data };
  normalized.item = String(data.item).trim();
  normalized.batchNumber = String(data.batchNumber).trim();
  if (data.status === undefined || data.status === null || String(data.status).trim() === "") {
    normalized.status = "Active";
  }
  if (data.purchasePrice === undefined || data.purchasePrice === null) {
    normalized.purchasePrice = 0;
  }
  return normalized;
};

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertBatchNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

const validate = (data) => {
  normalizeInventoryBatch(data);
};

const create = async (data) => {
  const normalized = normalizeInventoryBatch(data);
  if (await usePostgres()) return inventoryBatchRepository.create(normalized);
  return InventoryBatch.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? inventoryBatchRepository.findById(id) : InventoryBatch.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? inventoryBatchRepository.findOne(filter) : InventoryBatch.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? inventoryBatchRepository.findMany(options)
    : InventoryBatch.find(options.filter || {}).sort(options.sort || { expiryDate: 1, createdAt: 1 });

const updateById = async (id, updates) => {
  if (updates) {
    assertEnum(updates.status, STATUSES, "status");
    if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
      throw new Error("item is required");
    }
    if (updates.batchNumber !== undefined && String(updates.batchNumber).trim() === "") {
      throw new Error("batchNumber is required");
    }
    if (updates.originalQuantity !== undefined) assertQuantity(updates.originalQuantity, "originalQuantity");
    if (updates.currentQuantity !== undefined) assertQuantity(updates.currentQuantity, "currentQuantity");
    assertPrice(updates.purchasePrice, "purchasePrice");
  }
  if (await usePostgres()) return inventoryBatchRepository.updateById(id, updates);
  return InventoryBatch.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? inventoryBatchRepository.count(filter) : InventoryBatch.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? inventoryBatchRepository.destroy(id) : Boolean(await InventoryBatch.findByIdAndDelete(id));

/**
 * Active FIFO batch list for an item — mirrors
 * inventoryWorkflowController.logKitchenProduction:
 *   InventoryBatch.find({ item, status: 'Active' }).sort({ expiryDate: 1, createdAt: 1 })
 */
const findActiveByItemFifo = async (itemId) => {
  if (!itemId) return [];
  if (await usePostgres()) return inventoryBatchRepository.findActiveByItemFifo(itemId);
  return InventoryBatch.find({ item: String(itemId), status: "Active" }).sort({ expiryDate: 1, createdAt: 1 });
};

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
  findActiveByItemFifo,
};