const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const RepairRequest = require("../models/RepairRequest");
const repairRequestRepository = require("../repositories/repairRequestRepository");

// Mirrors the enums declared in backend/src/models/RepairRequest.js exactly.
const STATUSES = new Set(["Pending", "In Progress", "Completed", "Cancelled"]);

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

// cost has NO min in Mongo ({ type: Number, default: 0 }) — only finiteness is
// checked, exactly like the schema.
const assertMoney = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), which the tests pin to select a branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure, so tests can swap the function after this
// module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the RepairRequest path: PostgreSQL is used
// when the datasource seam is connected AND PostgreSQL is actually reachable.
// If either condition fails the existing Mongoose model handles the operation,
// so an unavailable PostgreSQL can never take the app down.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * Validates and normalizes repair-request data so the PostgreSQL repository
 * and the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - description is required.
 *  - asset is a reference id (required by createRepair at the controller
 *    boundary; stored as supplied).
 *  - vendor / invoiceNumber default to '' (Mongo `default: ""`).
 *  - cost defaults to 0 with no minimum (negatives allowed in Mongo).
 *  - status defaults to 'Pending' and belongs to the 4-value enum.
 *  - completionDate is optional (unset until completeRepair stamps it).
 *  - createdBy is an optional plain String (not an ObjectId ref).
 */
const normalizeRepairRequest = (data) => {
  if (!data) throw new Error("Repair request data is required");
  assertId(data.description, "description");
  const status = data.status === undefined || data.status === null || data.status === ""
    ? "Pending"
    : data.status;
  assertEnum(status, STATUSES, "status");
  assertMoney(data.cost, "cost");

  const normalized = { ...data };
  normalized.description = String(data.description).trim();
  normalized.status = status;
  if (normalized.vendor === undefined || normalized.vendor === null) normalized.vendor = "";
  else normalized.vendor = String(normalized.vendor).trim();
  if (normalized.invoiceNumber === undefined || normalized.invoiceNumber === null) normalized.invoiceNumber = "";
  else normalized.invoiceNumber = String(normalized.invoiceNumber).trim();
  if (normalized.cost === undefined) normalized.cost = 0;
  if (normalized.asset === undefined || normalized.asset === null || String(normalized.asset).trim() === "") {
    delete normalized.asset;
  } else {
    normalized.asset = String(normalized.asset).trim();
  }
  if (normalized.createdBy === undefined || normalized.createdBy === null || String(normalized.createdBy).trim() === "") {
    delete normalized.createdBy;
  } else {
    normalized.createdBy = String(normalized.createdBy).trim();
  }
  if (normalized.completionDate === undefined || normalized.completionDate === null) {
    delete normalized.completionDate;
  } else {
    normalized.completionDate = normalized.completionDate instanceof Date ? normalized.completionDate : new Date(normalized.completionDate);
  }
  return normalized;
};

const validate = (data) => {
  normalizeRepairRequest(data);
};

const create = async (data) => {
  const normalized = normalizeRepairRequest(data);
  if (await usePostgres()) return repairRequestRepository.create(normalized);
  return RepairRequest.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? repairRequestRepository.findById(id) : RepairRequest.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? repairRequestRepository.findOne(filter) : RepairRequest.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? repairRequestRepository.findMany(options)
    : RepairRequest.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.description !== undefined) assertId(updates.description, "description");
    assertEnum(updates.status, STATUSES, "status");
    assertMoney(updates.cost, "cost");
  }
  if (await usePostgres()) return repairRequestRepository.updateById(id, updates);
  return RepairRequest.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? repairRequestRepository.count(filter) : RepairRequest.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? repairRequestRepository.destroy(id) : Boolean(await RepairRequest.findByIdAndDelete(id));

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
  count,
  destroy,
};