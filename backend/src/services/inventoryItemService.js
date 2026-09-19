const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const InventoryItem = require("../models/InventoryItem");
const inventoryItemRepository = require("../repositories/inventoryItemRepository");

// Mirrors the enums + unit list declared in backend/src/models/InventoryItem.js.
const ITEM_TYPES = new Set(["Raw Material", "Finished Good", "Asset", "Consumable", "Other"]);
const INVENTORY_UNITS = [
  "Piece (Pc)", "Number (Nos)", "Unit", "Pair", "Set", "Bundle", "Packet", "Pack", "Box", "Carton", "Roll", "Dozen", "Tray", "Sack", "Bag", "Pieces",
  "Gram (g)", "Kilogram (kg)", "Kg", "Quintal", "Ton",
  "Millilitre (ml)", "Litre (L)", "Liter", "Can", "Drum", "Barrel",
  "Bottle", "Jar", "Tin", "Container", "Bucket", "Cylinder",
  "Meter", "Feet",
  "Square Feet", "Square Meter",
];
const UNITS = new Set(INVENTORY_UNITS);
const CATEGORIES = new Set([
  "Pooja Items", "Prasadam Ingredients", "Cleaning Materials",
  "Office & Stationery", "Electrical & Maintenance", "Festival Materials",
  "Miscellaneous Items", "Cooking / Annaprasada",
]);

// isConnected() mirrors the other Phase 2 services (booking/donation/pooja/
// prasadam): it exposes the repository datasource-selection seam, which is
// mongoose's connectivity flag. That flag is what the tests pin to select the
// PostgreSQL branch deterministically.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for this phase. This is the Phase 2H fallback
// boundary: the service uses PostgreSQL when the established datasource seam is
// connected AND PostgreSQL is actually reachable. If either condition fails it
// routes back to the existing Mongoose model — so an unavailable PostgreSQL can
// never take the app down nor cause a partial write.
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

const assertStockCounter = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number >= 0 (Mongo schema min: 0)`);
  }
};

// shelfLifeDays and the price fields have NO min in the Mongo schema
// ({ type: Number, default: 0 }); negatives are allowed, so only reject
// non-numeric values.
const assertPrice = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

/**
 * Validates and normalizes inventory item data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the real write paths
 * (inventoryItemController.createInventoryItem / updateInventoryItem,
 * inventoryItemController.restockItem / adjustStock, inventoryHelper):
 *  - name is required and trimmed.
 *  - type / unit / category belong to the Mongo enum/unit value sets; unit is
 *    required and defaults to 'Pack', type defaults to 'Consumable', category
 *    defaults to 'Miscellaneous Items'.
 *  - the ten stock counters with Mongo min: 0 (availableStock, reservedStock,
 *    issuedStock, consumedStock, damagedStock, expiredStock, returnedStock,
 *    minimumStock, reorderLevel, maximumStock) are >= 0 with default 0.
 *  - shelfLifeDays and prices (shelfLifeDays, purchasePrice, sellingPrice,
 *    gstRate, lastPurchasePrice) default to 0 and have NO min in the Mongo
 *    schema, so negatives remain allowed.
 */
const normalizeInventoryItem = (data) => {
  if (!data) throw new Error("Inventory item data is required");
  if (!data.name || !String(data.name).trim()) {
    throw new Error("name is required");
  }
  assertEnum(data.type, ITEM_TYPES, "type");
  if (data.unit !== undefined && data.unit !== null) assertEnum(data.unit, UNITS, "unit");
  assertEnum(data.category, CATEGORIES, "category");
  for (const key of [
    "availableStock", "reservedStock", "issuedStock", "consumedStock",
    "damagedStock", "expiredStock", "returnedStock", "minimumStock",
    "reorderLevel", "maximumStock",
  ]) {
    assertStockCounter(data[key], key);
  }
  for (const key of ["shelfLifeDays", "purchasePrice", "sellingPrice", "gstRate", "lastPurchasePrice"]) {
    assertPrice(data[key], key);
  }

  const normalized = { ...data };
  normalized.name = String(data.name).trim();
  if (data.unit === undefined || data.unit === null || String(data.unit).trim() === "") {
    normalized.unit = "Pack";
  }
  if (data.type === undefined || data.type === null || String(data.type).trim() === "") {
    normalized.type = "Consumable";
  }
  if (data.category === undefined || data.category === null || String(data.category).trim() === "") {
    normalized.category = "Miscellaneous Items";
  }
  if (data.availableStock !== undefined && data.availableStock !== null) {
    normalized.availableStock = Number(data.availableStock);
  }
  if (data.minimumStock !== undefined && data.minimumStock !== null) {
    normalized.minimumStock = Number(data.minimumStock);
  }
  return normalized;
};

const validate = (data) => {
  normalizeInventoryItem(data);
};

const create = async (data) => {
  const normalized = normalizeInventoryItem(data);
  if (await usePostgres()) return inventoryItemRepository.create(normalized);
  return InventoryItem.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? inventoryItemRepository.findById(id) : InventoryItem.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? inventoryItemRepository.findOne(filter) : InventoryItem.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? inventoryItemRepository.findMany(options)
    : InventoryItem.find(options.filter || {}).sort(options.sort || { name: 1 });

// issueInventoryRequest resolves an item by exact name (case-insensitive).
const findByName = async (name) => {
  if (!name) return [];
  if (await usePostgres()) return inventoryItemRepository.findByName(name);
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return InventoryItem.find({ name: { $regex: new RegExp(`^${escaped}$`, "i") } });
};

const updateById = async (id, updates) => {
  if (updates) {
    assertEnum(updates.type, ITEM_TYPES, "type");
    assertEnum(updates.unit, UNITS, "unit");
    assertEnum(updates.category, CATEGORIES, "category");
    for (const key of [
      "availableStock", "reservedStock", "issuedStock", "consumedStock",
      "damagedStock", "expiredStock", "returnedStock", "minimumStock",
      "reorderLevel", "maximumStock",
    ]) {
      assertStockCounter(updates[key], key);
    }
    for (const key of ["shelfLifeDays", "purchasePrice", "sellingPrice", "gstRate", "lastPurchasePrice"]) {
      assertPrice(updates[key], key);
    }
    // Booleans mirror the Mongo cast semantics: Mongoose Boolean accepts any
    // truthy/falsy value and the real update path (inventoryItemController)
    // passes Boolean(isActive), so no enum-style rejection is applied here.
  }
  if (await usePostgres()) return inventoryItemRepository.updateById(id, updates);
  return InventoryItem.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? inventoryItemRepository.count(filter) : InventoryItem.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? inventoryItemRepository.destroy(id) : Boolean(await InventoryItem.findByIdAndDelete(id));

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  findByName,
  updateById,
  count,
  destroy,
};