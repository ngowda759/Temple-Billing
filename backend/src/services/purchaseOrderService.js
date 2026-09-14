const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const PurchaseOrder = require("../models/PurchaseOrder");
const purchaseOrderRepository = require("../repositories/purchaseOrderRepository");

// Mirrors the enum declared in backend/src/models/PurchaseOrder.js.
const STATUSES = new Set([
  "Draft", "Pending Approval", "Approved", "Sent",
  "Partially Received", "Received", "Cancelled", "Closed",
]);

// isConnected() mirrors the other Phase 2 services (inventoryRequest/booking/
// donation/pooja/prasadam/batch/log/consumption): it exposes the repository
// datasource-selection seam, which is mongoose's connectivity flag. That flag
// is what the tests pin to select the PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure (const { isDbConnected } = ...), so tests can
// swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Purchase Order path. This is the
// Phase 2M fallback boundary: the service uses PostgreSQL when the established
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

// Mirrors the embedded item validation declared in the Mongo PurchaseOrder
// items[] sub-documents:
//   * item { ObjectId ref 'InventoryItem', required }
//   * orderedQuantity { Number, required, min: 1 }
//   * unitPrice { Number, required, min: 0 }
//   * totalPrice { Number, required, min: 0 }
//   * receivedQuantity { Number, default 0, min: 0 }
const assertItem = (item) => {
  if (!item || typeof item !== "object") {
    throw new Error("items: each item must be an object");
  }
  assertId(item.item, "items.item");
  assertItemQuantity(item.orderedQuantity, "items.orderedQuantity", 1);
  assertItemQuantity(item.unitPrice, "items.unitPrice", 0);
  assertItemQuantity(item.totalPrice, "items.totalPrice", 0);
  if (item.receivedQuantity !== undefined && item.receivedQuantity !== null) {
    assertItemQuantity(item.receivedQuantity, "items.receivedQuantity", 0);
  }
};

const assertItemQuantity = (value, label, min) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < min) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= ${min} (Mongo schema min: ${min})`);
  }
};

/**
 * Validates and normalizes purchase order data so the PostgreSQL repository
 * and the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - poNumber / supplier / totalAmount are required (totalAmount min: 0);
 *    items[] is an array of sub-documents with item / orderedQuantity
 *    (min: 1) / unitPrice (min: 0) / totalPrice (min: 0) required and
 *    receivedQuantity defaulting to 0 (min: 0).
 *  - status defaults to 'Draft' and belongs to the 8-value enum.
 *  - expectedDeliveryDate / notes / createdBy / approvedBy are optional.
 */
const normalizePurchaseOrder = (data) => {
  if (!data) throw new Error("Purchase order data is required");
  const poNumber = assertId(data.poNumber, "poNumber");
  const supplier = assertId(data.supplier, "supplier");
  assertAmount(data.totalAmount, "totalAmount");
  if (data.items !== undefined && data.items !== null) {
    for (const item of Array.isArray(data.items) ? data.items : [data.items]) {
      assertItem(item);
    }
  }
  assertEnum(data.status, STATUSES, "status");

  const normalized = { ...data };
  normalized.poNumber = poNumber;
  normalized.supplier = supplier;
  if (data.status === undefined || data.status === null) {
    normalized.status = "Draft";
  }
  if (data.items !== undefined && data.items !== null) {
    normalized.items = (Array.isArray(data.items) ? data.items : [data.items]).map((item) => ({
      ...item,
      item: String(item.item).trim(),
      receivedQuantity: item.receivedQuantity ?? 0,
    }));
  }
  return normalized;
};

const validate = (data) => {
  normalizePurchaseOrder(data);
};

const create = async (data) => {
  const normalized = normalizePurchaseOrder(data);
  if (await usePostgres()) return purchaseOrderRepository.create(normalized);
  return PurchaseOrder.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? purchaseOrderRepository.findById(id) : PurchaseOrder.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? purchaseOrderRepository.findOne(filter) : PurchaseOrder.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? purchaseOrderRepository.findMany(options)
    : PurchaseOrder.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.poNumber !== undefined && updates.poNumber !== null && String(updates.poNumber).trim() === "") {
      throw new Error("poNumber is required");
    }
    if (updates.supplier !== undefined && updates.supplier !== null && String(updates.supplier).trim() === "") {
      throw new Error("supplier is required");
    }
    if (updates.totalAmount !== undefined) assertAmount(updates.totalAmount, "totalAmount");
    assertEnum(updates.status, STATUSES, "status");
    if (updates.items !== undefined && updates.items !== null) {
      for (const item of Array.isArray(updates.items) ? updates.items : [updates.items]) {
        assertItem(item);
      }
    }
  }
  if (await usePostgres()) return purchaseOrderRepository.updateById(id, updates);
  return PurchaseOrder.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const replaceItems = async (id, items) => {
  const normalized = (items === undefined || items === null) ? [] : (Array.isArray(items) ? items : [items]);
  for (const item of normalized) assertItem(item);
  if (await usePostgres()) return purchaseOrderRepository.replaceItems(id, normalized);
  const po = await PurchaseOrder.findById(String(id));
  if (!po) return null;
  po.items = normalized;
  await po.save();
  return po;
};

const count = async (filter = {}) =>
  (await usePostgres()) ? purchaseOrderRepository.count(filter) : PurchaseOrder.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? purchaseOrderRepository.destroy(id) : Boolean(await PurchaseOrder.findByIdAndDelete(id));

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