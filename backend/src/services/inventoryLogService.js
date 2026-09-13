const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const InventoryLog = require("../models/InventoryLog");
const inventoryLogRepository = require("../repositories/inventoryLogRepository");

// Mirrors the enum declared in backend/src/models/InventoryLog.js.
const ACTIONS = new Set(["Added", "Updated", "Consumed", "Restocked", "Issue", "Damage", "Expire", "Return", "Lost", "Adjusted"]);

// isConnected() mirrors the other Phase 2 services (inventoryItem/booking/
// donation/pooja/prasadam/batch): it exposes the repository datasource-selection
// seam, which is mongoose's connectivity flag. That flag is what the tests pin
// to select the PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure (const { isDbConnected } = ...), so tests can
// swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Inventory Log path. This is the
// Phase 2J fallback boundary: the service uses PostgreSQL when the established
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

// quantity / oldStock / newStock are loose Numbers with NO min in the Mongo
// schema — zero and negatives are exactly as legal here as they are in Mongo.
// Only non-finite values are rejected (mirrors the Mongoose Number cast error).
const assertNumber = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

/**
 * Validates and normalizes inventory log data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (inventoryHelper.addStock/deductStock, inventoryItemController
 * createInventoryItem/restockItem/adjustStock):
 *  - item is required (a 24-hex ObjectId in practice; any non-empty string is
 *    accepted like Mongoose does and is validated by the FK on the PG path).
 *  - action is required and belongs to the fixed enum.
 *  - quantity is required; the Mongo schema declares NO min, so zero and
 *    negatives are permitted exactly like Mongo.
 *  - oldStock / newStock default to 0 and have NO min.
 *  - user is optional (req.user?._id in every real path).
 *  - date defaults to now (Mongo default Date.now).
 *  - description is intentionally dropped: the Mongo model does not declare it
 *    and Mongoose strict mode strips it, so it is never persisted.
 */
const normalizeInventoryLog = (data) => {
  if (!data) throw new Error("Inventory log data is required");
  const item = assertId(data.item, "item");
  const action = String(data.action ?? "").trim();
  if (action === "") {
    throw new Error("action is required");
  }
  assertEnum(action, ACTIONS, "action");
  assertNumber(data.quantity, "quantity");
  if (data.quantity === undefined || data.quantity === null || String(data.quantity).trim() === "") {
    throw new Error("quantity is required");
  }
  assertNumber(data.oldStock, "oldStock");
  assertNumber(data.newStock, "newStock");

  const normalized = { ...data };
  normalized.item = item;
  normalized.action = action;
  if (data.oldStock === undefined || data.oldStock === null) {
    normalized.oldStock = 0;
  }
  if (data.newStock === undefined || data.newStock === null) {
    normalized.newStock = 0;
  }
  if (data.date === undefined || data.date === null) {
    normalized.date = new Date();
  }
  return normalized;
};

const validate = (data) => {
  normalizeInventoryLog(data);
};

const create = async (data) => {
  const normalized = normalizeInventoryLog(data);
  if (await usePostgres()) return inventoryLogRepository.create(normalized);
  return InventoryLog.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? inventoryLogRepository.findById(id) : InventoryLog.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? inventoryLogRepository.findOne(filter) : InventoryLog.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? inventoryLogRepository.findMany(options)
    : InventoryLog.find(options.filter || {}).sort(options.sort || { date: -1, createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
      throw new Error("item is required");
    }
    if (updates.action !== undefined) {
      const action = String(updates.action ?? "").trim();
      if (action === "") {
        throw new Error("action is required");
      }
      assertEnum(action, ACTIONS, "action");
    }
    assertNumber(updates.quantity, "quantity");
    assertNumber(updates.oldStock, "oldStock");
    assertNumber(updates.newStock, "newStock");
  }
  if (await usePostgres()) return inventoryLogRepository.updateById(id, updates);
  return InventoryLog.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? inventoryLogRepository.count(filter) : InventoryLog.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? inventoryLogRepository.destroy(id) : Boolean(await InventoryLog.findByIdAndDelete(id));

module.exports = {
  isConnected,
  usePostgres,
  ACTIONS,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};