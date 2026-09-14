const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Asset = require("../models/Asset");
const assetRepository = require("../repositories/assetRepository");

// Mirrors the enums declared in backend/src/models/Asset.js.
const CATEGORIES = new Set(["Electrical", "Furniture", "Electronics", "Utensils", "Machinery", "Other"]);
const STATUSES = new Set(["Active", "Under Repair", "Retired"]);

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

// purchaseCost has NO min in Mongo ({ type: Number, default: 0 }) — only
// finiteness is checked, exactly like the schema.
const assertMoney = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// isConnected() mirrors the other Phase 2 services: it exposes the
// datasource-selection seam, which is mongoose's connectivity flag. That flag
// is what the tests pin to select the PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure, so tests can swap the function after this
// module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Asset path. This is the Phase 2P
// fallback boundary: the service uses PostgreSQL when the established
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

const normalizeMaintenanceHistory = (list) => {
  if (list === undefined || list === null) return undefined;
  return list.map((entry) => {
    assertMoney(entry.cost, "maintenanceHistory.cost");
    const normalized = { ...entry };
    if (entry.repairDate === undefined || entry.repairDate === null) {
      delete normalized.repairDate;
    } else {
      normalized.repairDate = entry.repairDate instanceof Date ? entry.repairDate : new Date(entry.repairDate);
    }
    if (entry.description === undefined || entry.description === null) {
      delete normalized.description;
    } else {
      normalized.description = String(entry.description).trim();
    }
    if (entry.vendor === undefined || entry.vendor === null) {
      delete normalized.vendor;
    } else {
      normalized.vendor = String(entry.vendor).trim();
    }
    return normalized;
  });
};

/**
 * Validates and normalizes asset data so the PostgreSQL repository and the
 * Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - assetId and name are required (Mongo `required: true`); duplicates are
 *    surfaced by the underlying datasource (Mongo 11000 / PG 23505).
 *  - category defaults to 'Other' and belongs to the 6-value enum.
 *  - status defaults to 'Active' and belongs to the 3-value enum.
 *  - qrCode / invoiceNumber / warranty / assignedLocation / serialNumber
 *    default to '' (Mongo `default: ""`, assignedLocation 'Main Temple').
 *  - purchaseDate is optional (default null in Mongo).
 *  - supplier is an optional Mongo-backed reference (plain TEXT id).
 *  - purchaseCost defaults to 0 with no minimum (negatives allowed in Mongo).
 *  - maintenanceHistory is an embedded array of { repairDate, description,
 *    cost, vendor } — all optional.
 */
const normalizeAsset = (data) => {
  if (!data) throw new Error("Asset data is required");
  const category = data.category === undefined || data.category === null || data.category === ""
    ? "Other"
    : data.category;
  const status = data.status === undefined || data.status === null || data.status === ""
    ? "Active"
    : data.status;
  assertEnum(category, CATEGORIES, "category");
  assertEnum(status, STATUSES, "status");
  assertId(data.assetId, "assetId");
  assertId(data.name, "name");
  assertMoney(data.purchaseCost, "purchaseCost");

  const normalized = { ...data };
  normalized.assetId = String(data.assetId).trim();
  normalized.name = String(data.name).trim();
  normalized.category = category;
  normalized.status = status;
  if (normalized.qrCode === undefined || normalized.qrCode === null) normalized.qrCode = "";
  else normalized.qrCode = String(normalized.qrCode).trim();
  if (normalized.invoiceNumber === undefined || normalized.invoiceNumber === null) normalized.invoiceNumber = "";
  else normalized.invoiceNumber = String(normalized.invoiceNumber).trim();
  if (normalized.warranty === undefined || normalized.warranty === null) normalized.warranty = "";
  else normalized.warranty = String(normalized.warranty).trim();
  if (normalized.assignedLocation === undefined || normalized.assignedLocation === null) normalized.assignedLocation = "Main Temple";
  else normalized.assignedLocation = String(normalized.assignedLocation).trim();
  if (normalized.serialNumber === undefined || normalized.serialNumber === null) normalized.serialNumber = "";
  else normalized.serialNumber = String(normalized.serialNumber).trim();
  if (normalized.purchaseDate === undefined || normalized.purchaseDate === null) {
    delete normalized.purchaseDate;
  } else {
    normalized.purchaseDate = normalized.purchaseDate instanceof Date ? normalized.purchaseDate : new Date(normalized.purchaseDate);
  }
  if (normalized.supplier === undefined || normalized.supplier === null || String(normalized.supplier).trim() === "") {
    delete normalized.supplier;
  } else {
    normalized.supplier = String(normalized.supplier).trim();
  }
  if (normalized.purchaseCost === undefined) normalized.purchaseCost = 0;
  const maintenanceHistory = normalizeMaintenanceHistory(data.maintenanceHistory);
  if (maintenanceHistory === undefined) {
    delete normalized.maintenanceHistory;
  } else {
    normalized.maintenanceHistory = maintenanceHistory;
  }
  return normalized;
};

const validate = (data) => {
  normalizeAsset(data);
};

const create = async (data) => {
  const normalized = normalizeAsset(data);
  if (await usePostgres()) return assetRepository.create(normalized);
  return Asset.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? assetRepository.findById(id) : Asset.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? assetRepository.findOne(filter) : Asset.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? assetRepository.findMany(options)
    : Asset.find(options.filter || {}).sort(options.sort || { name: 1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.assetId !== undefined && updates.assetId !== null && String(updates.assetId).trim() === "") {
      throw new Error("assetId is required");
    }
    if (updates.name !== undefined && updates.name !== null && String(updates.name).trim() === "") {
      throw new Error("name is required");
    }
    assertEnum(updates.category, CATEGORIES, "category");
    assertEnum(updates.status, STATUSES, "status");
    assertMoney(updates.purchaseCost, "purchaseCost");
  }
  if (await usePostgres()) return assetRepository.updateById(id, updates);
  return Asset.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const addMaintenanceRecord = async (assetId, entry) => {
  assertMoney(entry?.cost, "maintenanceHistory.cost");
  if (await usePostgres()) return assetRepository.addMaintenanceRecord(assetId, entry);
  const asset = await Asset.findById(assetId);
  if (!asset) return null;
  asset.maintenanceHistory.push(entry);
  await asset.save();
  return asset.maintenanceHistory[asset.maintenanceHistory.length - 1];
};

const count = async (filter = {}) =>
  (await usePostgres()) ? assetRepository.count(filter) : Asset.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? assetRepository.destroy(id) : Boolean(await Asset.findByIdAndDelete(id));

module.exports = {
  isConnected,
  usePostgres,
  CATEGORIES,
  STATUSES,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  addMaintenanceRecord,
  count,
  destroy,
};