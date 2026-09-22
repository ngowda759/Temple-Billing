const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const InventoryConsumption = require("../models/InventoryConsumption");
const inventoryConsumptionRepository = require("../repositories/inventoryConsumptionRepository");

// isConnected() mirrors the other Phase 2 services (inventoryItem/booking/
// donation/pooja/prasadam/batch/log): it exposes the repository
// datasource-selection seam, which is mongoose's connectivity flag. That flag
// is what the tests pin to select the PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure (const { isDbConnected } = ...), so tests can
// swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Inventory Consumption path. This is the
// Phase 2K fallback boundary: the service uses PostgreSQL when the established
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

// The Mongo schema declares the three quantities as Number, required, min: 0
// — zero is legal (an issue can be completed with everything returned), while
// negatives are rejected, mirroring the Mongoose min: 0 validator exactly.
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
 * Validates and normalizes inventory consumption data so the PostgreSQL
 * repository and the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write path
 * (inventoryIssueController.completeUsage):
 *  - item is required (the completeUsage flow loads the item by id first).
 *  - itemName is required (stored as the item's name).
 *  - userId / userName / role are required strings (userId is a STRING in the
 *    Mongo schema; completeUsage stores the issuing user's username).
 *  - issuedQuantity / usedQuantity / returnedQuantity are required numbers
 *    with min: 0 (zero legal, negatives rejected).
 *  - unit is required (copied from the issue at write time).
 *  - purpose / remarks default to "".
 *  - issue is optional (the InventoryIssue ObjectId ref).
 *  - date defaults to now (Mongo default Date.now).
 */
const normalizeInventoryConsumption = (data) => {
  if (!data) throw new Error("Inventory consumption data is required");
  const item = assertId(data.item, "item");
  assertText(data.itemName, "itemName");
  const userId = assertId(data.userId, "userId");
  assertText(data.userName, "userName");
  assertText(data.role, "role");
  assertQuantity(data.issuedQuantity, "issuedQuantity");
  assertQuantity(data.usedQuantity, "usedQuantity");
  assertQuantity(data.returnedQuantity, "returnedQuantity");
  assertText(data.unit, "unit");

  const normalized = { ...data };
  normalized.item = item;
  normalized.userId = userId;
  if (data.purpose === undefined || data.purpose === null) {
    normalized.purpose = "";
  }
  if (data.remarks === undefined || data.remarks === null) {
    normalized.remarks = "";
  }
  if (data.date === undefined || data.date === null) {
    normalized.date = new Date();
  }
  return normalized;
};

const validate = (data) => {
  normalizeInventoryConsumption(data);
};

const create = async (data, client) => {
  const normalized = normalizeInventoryConsumption(data);
  if (await usePostgres()) return inventoryConsumptionRepository.create(normalized, client);
  return InventoryConsumption.create(normalized);
};

const findById = async (id, client) =>
  (await usePostgres()) ? inventoryConsumptionRepository.findById(id, client) : InventoryConsumption.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? inventoryConsumptionRepository.findOne(filter) : InventoryConsumption.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? inventoryConsumptionRepository.findMany(options)
    : InventoryConsumption.find(options.filter || {}).sort(options.sort || { date: -1, createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
      throw new Error("item is required");
    }
    if (updates.itemName !== undefined && updates.itemName !== null && String(updates.itemName).trim() === "") {
      throw new Error("itemName is required");
    }
    if (updates.userId !== undefined && updates.userId !== null && String(updates.userId).trim() === "") {
      throw new Error("userId is required");
    }
    if (updates.userName !== undefined && updates.userName !== null && String(updates.userName).trim() === "") {
      throw new Error("userName is required");
    }
    if (updates.role !== undefined && updates.role !== null && String(updates.role).trim() === "") {
      throw new Error("role is required");
    }
    if (updates.unit !== undefined && updates.unit !== null && String(updates.unit).trim() === "") {
      throw new Error("unit is required");
    }
    for (const label of ["issuedQuantity", "usedQuantity", "returnedQuantity"]) {
      if (updates[label] !== undefined) assertQuantity(updates[label], label);
    }
  }
  if (await usePostgres()) return inventoryConsumptionRepository.updateById(id, updates);
  return InventoryConsumption.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? inventoryConsumptionRepository.count(filter) : InventoryConsumption.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? inventoryConsumptionRepository.destroy(id) : Boolean(await InventoryConsumption.findByIdAndDelete(id));

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
};