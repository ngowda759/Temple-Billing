const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const GoodsReceivedNote = require("../models/GoodsReceivedNote");
const goodsReceivedNoteRepository = require("../repositories/goodsReceivedNoteRepository");

// Mirrors the enum declared in backend/src/models/GoodsReceivedNote.js.
const STATUSES = new Set([
  "Draft", "Pending Quality Check", "Pending Approval", "Approved", "Rejected",
]);

// isConnected() mirrors the other Phase 2 services (purchaseOrder/
// inventoryRequest/booking/donation/pooja/prasadam/batch/log/consumption): it
// exposes the repository datasource-selection seam, which is mongoose's
// connectivity flag. That flag is what the tests pin to select the PostgreSQL
// branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure (const { isDbConnected } = ...), so tests can
// swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Goods Received Note path. This is the
// Phase 2N fallback boundary: the service uses PostgreSQL when the established
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

// The Mongo schema declares totalAmount as Number, required, min: 0 — zero is
// legal at the model layer, while negatives are rejected, mirroring the
// Mongoose min: 0 validator exactly.
const assertAmount = (value, label) => {
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

// Mirrors the embedded item validation declared in the Mongo GoodsReceivedNote
// receivedItems[] sub-documents:
//   * item { ObjectId ref 'InventoryItem', required }
//   * poQuantity { Number, default 0, NO min }
//   * receivedQuantity { Number, required, min: 0 }
//   * acceptedQuantity { Number, required, min: 0 }
//   * rejectedQuantity { Number, default 0, min: 0 }
//   * unitPrice { Number, required, min: 0 }
//   * batchNumber { String, optional }
//   * expiryDate { Date, optional }
//   * remarks { String, optional }
const assertItem = (item) => {
  if (!item || typeof item !== "object") {
    throw new Error("receivedItems: each item must be an object");
  }
  assertId(item.item, "receivedItems.item");
  assertItemQuantity(item.poQuantity, "receivedItems.poQuantity", null, true);
  assertItemQuantity(item.receivedQuantity, "receivedItems.receivedQuantity", 0, false);
  assertItemQuantity(item.acceptedQuantity, "receivedItems.acceptedQuantity", 0, false);
  assertItemQuantity(item.rejectedQuantity, "receivedItems.rejectedQuantity", 0, true);
  assertItemQuantity(item.unitPrice, "receivedItems.unitPrice", 0, false);
};

const assertItemQuantity = (value, label, min, optional) => {
  if (value === undefined || value === null) {
    if (optional) return;
    throw new Error(`${label} is required`);
  }
  if (String(value).trim() === "" && !optional) {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (min !== null && num < min) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= ${min} (Mongo schema min: ${min})`);
  }
};

/**
 * Validates and normalizes goods received note data so the PostgreSQL
 * repository and the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - supplier / totalAmount are required (totalAmount min: 0); receivedItems[]
 *    is an array of sub-documents with item / receivedQuantity (min: 0) /
 *    acceptedQuantity (min: 0) / unitPrice (min: 0) required; poQuantity and
 *    rejectedQuantity default to 0 (poQuantity has NO min, rejectedQuantity
 *    min: 0).
 *  - grnNumber defaults to `GRN-${count + 1}` padded to 5 (the exact format
 *    the createGRN controller derives from countDocuments — see repository).
 *  - status defaults to 'Draft' and belongs to the 5-value enum.
 *  - purchaseOrder / supplierInvoiceNumber / supplierInvoiceDate /
 *    receivedBy / approvedBy / notes are optional.
 */
const normalizeGrn = (data) => {
  if (!data) throw new Error("Goods received note data is required");
  const supplier = assertId(data.supplier, "supplier");
  assertAmount(data.totalAmount, "totalAmount");
  if (data.receivedItems !== undefined && data.receivedItems !== null) {
    for (const item of Array.isArray(data.receivedItems) ? data.receivedItems : [data.receivedItems]) {
      assertItem(item);
    }
  }
  if (data.status !== undefined && data.status !== null && data.status !== "") {
    assertEnum(data.status, STATUSES, "status");
  }
  if (data.grnNumber !== undefined && data.grnNumber !== null && String(data.grnNumber).trim() !== "") {
    assertText(data.grnNumber, "grnNumber");
  }

  const normalized = { ...data };
  normalized.supplier = supplier;
  if (data.status === undefined || data.status === null) {
    normalized.status = "Draft";
  }
  if (data.receivedItems !== undefined && data.receivedItems !== null) {
    normalized.receivedItems = (Array.isArray(data.receivedItems) ? data.receivedItems : [data.receivedItems]).map((item) => ({
      ...item,
      item: String(item.item).trim(),
      poQuantity: item.poQuantity ?? 0,
      rejectedQuantity: item.rejectedQuantity ?? 0,
    }));
  }
  if (normalized.grnNumber === undefined || normalized.grnNumber === null || String(normalized.grnNumber).trim() === "") {
    delete normalized.grnNumber; // the repository derives it from the current row count
  } else {
    normalized.grnNumber = String(normalized.grnNumber).trim();
  }
  return normalized;
};

const validate = (data) => {
  normalizeGrn(data);
};

const create = async (data) => {
  const normalized = normalizeGrn(data);
  if (await usePostgres()) return goodsReceivedNoteRepository.create(normalized);
  return GoodsReceivedNote.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? goodsReceivedNoteRepository.findById(id) : GoodsReceivedNote.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? goodsReceivedNoteRepository.findOne(filter) : GoodsReceivedNote.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? goodsReceivedNoteRepository.findMany(options)
    : GoodsReceivedNote.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.supplier !== undefined && updates.supplier !== null && String(updates.supplier).trim() === "") {
      throw new Error("supplier is required");
    }
    if (updates.totalAmount !== undefined) assertAmount(updates.totalAmount, "totalAmount");
    assertEnum(updates.status, STATUSES, "status");
    if (updates.receivedItems !== undefined && updates.receivedItems !== null) {
      for (const item of Array.isArray(updates.receivedItems) ? updates.receivedItems : [updates.receivedItems]) {
        assertItem(item);
      }
    }
  }
  if (await usePostgres()) return goodsReceivedNoteRepository.updateById(id, updates);
  return GoodsReceivedNote.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const replaceItems = async (id, items) => {
  const normalized = (items === undefined || items === null) ? [] : (Array.isArray(items) ? items : [items]);
  for (const item of normalized) assertItem(item);
  if (await usePostgres()) return goodsReceivedNoteRepository.replaceItems(id, normalized);
  const grn = await GoodsReceivedNote.findById(String(id));
  if (!grn) return null;
  grn.receivedItems = normalized;
  await grn.save();
  return grn;
};

const count = async (filter = {}) =>
  (await usePostgres()) ? goodsReceivedNoteRepository.count(filter) : GoodsReceivedNote.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? goodsReceivedNoteRepository.destroy(id) : Boolean(await GoodsReceivedNote.findByIdAndDelete(id));

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
  replaceItems,
  count,
  destroy,
};