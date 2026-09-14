const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const DamageNote = require("../models/DamageNote");
const damageNoteRepository = require("../repositories/damageNoteRepository");

// Mirrors the enums declared in backend/src/models/DamageNote.js.
const STATUSES = new Set(["Pending Approval", "Approved", "Rejected"]);

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

// Mirrors the Mongo schema's quantity Number + min: 1 validator exactly.
const assertQuantity = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 1) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 1 (Mongo schema min: 1)`);
  }
};

// writeOffAmount has NO min in Mongo ({ type: Number, default: 0 } permits
// negatives) — only finiteness is checked, matching the Mongoose schema.
const assertWriteOffAmount = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// isConnected() mirrors the other Phase 2 services (purchaseOrder/
// goodsReceivedNote/inventoryRequest/...): it exposes the datasource-selection
// seam, which is mongoose's connectivity flag. That flag is what the tests pin
// to select the PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure (const { isDbConnected } = ...), so tests can
// swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Damage Note path. This is the Phase 2O
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

/**
 * Validates and normalizes damage note data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - damageNumber defaults to `DAMAGE-${count + 1}` padded to 4 (the same
 *    numbering convention the repository derives from the row count).
 *  - item / quantity (min: 1) / reason / description / reportedBy are
 *    required.
 *  - status defaults to 'Pending Approval' and belongs to the 3-value enum.
 *  - batch / photoUrl / approvedBy / expenseId are optional.
 *  - writeOffAmount defaults to 0 and has NO min (negatives allowed in Mongo).
 */
const normalizeDamageNote = (data) => {
  if (!data) throw new Error("Damage note data is required");
  const status = data.status === undefined || data.status === null || data.status === ""
    ? "Pending Approval"
    : data.status;
  assertEnum(status, STATUSES, "status");
  assertId(data.item, "item");
  assertQuantity(data.quantity, "quantity");
  assertId(data.reason, "reason");
  assertId(data.description, "description");
  assertId(data.reportedBy, "reportedBy");
  if (data.batch !== undefined && data.batch !== null && String(data.batch).trim() !== "") {
    assertId(data.batch, "batch");
  }
  assertWriteOffAmount(data.writeOffAmount, "writeOffAmount");
  if (data.damageNumber !== undefined && data.damageNumber !== null && String(data.damageNumber).trim() !== "") {
    assertText(data.damageNumber, "damageNumber");
  }

  const normalized = { ...data };
  normalized.status = status;
  normalized.item = String(data.item).trim();
  normalized.reportedBy = String(data.reportedBy).trim();
  normalized.reason = String(data.reason).trim();
  normalized.description = String(data.description).trim();
  if (data.batch === undefined || data.batch === null || String(data.batch).trim() === "") {
    delete normalized.batch;
  } else {
    normalized.batch = String(data.batch).trim();
  }
  if (normalized.writeOffAmount === undefined) normalized.writeOffAmount = 0;
  if (normalized.damageNumber === undefined || normalized.damageNumber === null || String(normalized.damageNumber).trim() === "") {
    delete normalized.damageNumber; // the repository derives it from the current row count
  } else {
    normalized.damageNumber = String(normalized.damageNumber).trim();
  }
  return normalized;
};

const validate = (data) => {
  normalizeDamageNote(data);
};

const create = async (data) => {
  const normalized = normalizeDamageNote(data);
  if (await usePostgres()) return damageNoteRepository.create(normalized);
  return DamageNote.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? damageNoteRepository.findById(id) : DamageNote.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? damageNoteRepository.findOne(filter) : DamageNote.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? damageNoteRepository.findMany(options)
    : DamageNote.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
      throw new Error("item is required");
    }
    if (updates.quantity !== undefined) assertQuantity(updates.quantity, "quantity");
    if (updates.reason !== undefined && updates.reason !== null && String(updates.reason).trim() === "") {
      throw new Error("reason is required");
    }
    if (updates.description !== undefined && updates.description !== null && String(updates.description).trim() === "") {
      throw new Error("description is required");
    }
    if (updates.reportedBy !== undefined && updates.reportedBy !== null && String(updates.reportedBy).trim() === "") {
      throw new Error("reportedBy is required");
    }
    assertEnum(updates.status, STATUSES, "status");
    assertWriteOffAmount(updates.writeOffAmount, "writeOffAmount");
  }
  if (await usePostgres()) return damageNoteRepository.updateById(id, updates);
  return DamageNote.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? damageNoteRepository.count(filter) : DamageNote.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? damageNoteRepository.destroy(id) : Boolean(await DamageNote.findByIdAndDelete(id));

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