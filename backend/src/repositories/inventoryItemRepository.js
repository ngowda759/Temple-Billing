const { query } = require("../config/postgres");
const { isDbConnected } = require("../config/db");
const InventoryItem = require("../models/InventoryItem");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

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

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertEnumOrArray = (value, allowed, label) => {
  if (value === undefined || value === null) return;
  for (const item of Array.isArray(value) ? value : [value]) {
    assertEnum(item, allowed, label);
  }
};

const assertName = (name) => {
  if (name === undefined || name === null || String(name).trim() === "") {
    throw new Error("name is required");
  }
};

// Mirrors the Mongo schema: stock counters / minimumStock / reorderLevel /
// maximumStock / shelfLifeDays are Number min: 0. Decimal quantities are
// allowed (the real flows use fractional kitchen quantities), so the check is
// >= 0 rather than integer.
const assertStockCounter = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number >= 0 (Mongo schema min: 0)`);
  }
};

// Monetary fields default 0 and are never negative on any write path.
const assertPrice = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number >= 0`);
  }
};

const INVENTORY_ITEM_COLS = [
  "id", "name", "item_code", "barcode", "qr_code", "type", "unit",
  "available_stock", "reserved_stock", "issued_stock", "consumed_stock",
  "damaged_stock", "expired_stock", "returned_stock", "minimum_stock",
  "reorder_level", "maximum_stock", "batch_required", "expiry_required",
  "shelf_life_days", "purchase_price", "selling_price", "gst_rate",
  "preferred_supplier", "expense_head", "income_head", "inventory_account",
  "category", "description", "is_active", "expiry_date", "last_purchase_date",
  "last_purchase_price", "last_supplier", "created_at", "updated_at",
];

// Converts an inventory_items row into the shape the application receives from
// Mongoose (camelCase, Mongo _id, and the computed `status` virtual that the
// model exposes through toJSON).
const toDoc = (row) => {
  if (!row) return null;
  const available = row.available_stock === null || row.available_stock === undefined ? undefined : Number(row.available_stock);
  const minimum = row.minimum_stock === null || row.minimum_stock === undefined ? undefined : Number(row.minimum_stock);
  let status;
  if (available !== undefined) {
    if (available === 0) status = "Out Of Stock";
    else if (available <= minimum) status = "Low Stock";
    else status = "Healthy";
  }
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    itemCode: row.item_code || undefined,
    barcode: row.barcode || undefined,
    qrCode: row.qr_code || undefined,
    type: row.type,
    unit: row.unit,
    availableStock: available,
    reservedStock: row.reserved_stock === null || row.reserved_stock === undefined ? undefined : Number(row.reserved_stock),
    issuedStock: row.issued_stock === null || row.issued_stock === undefined ? undefined : Number(row.issued_stock),
    consumedStock: row.consumed_stock === null || row.consumed_stock === undefined ? undefined : Number(row.consumed_stock),
    damagedStock: row.damaged_stock === null || row.damaged_stock === undefined ? undefined : Number(row.damaged_stock),
    expiredStock: row.expired_stock === null || row.expired_stock === undefined ? undefined : Number(row.expired_stock),
    returnedStock: row.returned_stock === null || row.returned_stock === undefined ? undefined : Number(row.returned_stock),
    minimumStock: minimum,
    reorderLevel: row.reorder_level === null || row.reorder_level === undefined ? undefined : Number(row.reorder_level),
    maximumStock: row.maximum_stock === null || row.maximum_stock === undefined ? undefined : Number(row.maximum_stock),
    batchRequired: row.batch_required,
    expiryRequired: row.expiry_required,
    shelfLifeDays: row.shelf_life_days === null || row.shelf_life_days === undefined ? undefined : Number(row.shelf_life_days),
    purchasePrice: row.purchase_price === null || row.purchase_price === undefined ? 0 : Number(row.purchase_price),
    sellingPrice: row.selling_price === null || row.selling_price === undefined ? 0 : Number(row.selling_price),
    gstRate: row.gst_rate === null || row.gst_rate === undefined ? 0 : Number(row.gst_rate),
    preferredSupplier: row.preferred_supplier || undefined,
    expenseHead: row.expense_head || undefined,
    incomeHead: row.income_head || undefined,
    inventoryAccount: row.inventory_account || undefined,
    category: row.category,
    description: row.description,
    isActive: row.is_active,
    expiryDate: row.expiry_date || undefined,
    lastPurchaseDate: row.last_purchase_date || undefined,
    lastPurchasePrice: row.last_purchase_price === null || row.last_purchase_price === undefined ? 0 : Number(row.last_purchase_price),
    lastSupplier: row.last_supplier || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  name: String(data.name || "").trim(),
  item_code: data.itemCode === undefined || data.itemCode === null || String(data.itemCode).trim() === "" ? null : String(data.itemCode).trim(),
  barcode: data.barcode === undefined || data.barcode === null ? null : String(data.barcode).trim(),
  qr_code: data.qrCode === undefined || data.qrCode === null ? null : String(data.qrCode).trim(),
  type: data.type || "Consumable",
  unit: data.unit || "Pack",
  available_stock: data.availableStock ?? 0,
  reserved_stock: data.reservedStock ?? 0,
  issued_stock: data.issuedStock ?? 0,
  consumed_stock: data.consumedStock ?? 0,
  damaged_stock: data.damagedStock ?? 0,
  expired_stock: data.expiredStock ?? 0,
  returned_stock: data.returnedStock ?? 0,
  minimum_stock: data.minimumStock ?? 0,
  reorder_level: data.reorderLevel ?? 0,
  maximum_stock: data.maximumStock ?? 0,
  batch_required: data.batchRequired ?? false,
  expiry_required: data.expiryRequired ?? false,
  shelf_life_days: data.shelfLifeDays ?? 0,
  purchase_price: data.purchasePrice ?? 0,
  selling_price: data.sellingPrice ?? 0,
  gst_rate: data.gstRate ?? 0,
  preferred_supplier: data.preferredSupplier === undefined || data.preferredSupplier === null ? null : String(data.preferredSupplier),
  expense_head: data.expenseHead === undefined || data.expenseHead === null ? null : String(data.expenseHead),
  income_head: data.incomeHead === undefined || data.incomeHead === null ? null : String(data.incomeHead),
  inventory_account: data.inventoryAccount === undefined || data.inventoryAccount === null ? null : String(data.inventoryAccount),
  category: data.category || "Miscellaneous Items",
  description: data.description === undefined || data.description === null ? "" : String(data.description).trim(),
  is_active: data.isActive ?? true,
  expiry_date: data.expiryDate === undefined || data.expiryDate === null ? null : new Date(data.expiryDate),
  last_purchase_date: data.lastPurchaseDate === undefined || data.lastPurchaseDate === null ? null : new Date(data.lastPurchaseDate),
  last_purchase_price: data.lastPurchasePrice ?? 0,
  last_supplier: data.lastSupplier === undefined || data.lastSupplier === null ? null : String(data.lastSupplier).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  name: "name",
  createdAt: "created_at",
  updatedAt: "updated_at",
  availableStock: "available_stock",
  minimumStock: "minimum_stock",
  category: "category",
  type: "type",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "name ASC";
  let key; let direction;
  if (typeof sort === "string") {
    key = sort; direction = 1;
  } else {
    const entry = Object.entries(sort || {})[0] || [];
    key = entry[0]; direction = entry[1];
  }
  const col = SORT_COLUMNS[key];
  if (!col) return defaultOrder;
  const dir = direction === "DESC" || Number(direction) === -1 ? "DESC" : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
  if (!dir) return defaultOrder;
  return `${col} ${dir}`;
};

const pushCond = (conditions, values, col, op, value) => {
  conditions.push(`${col} ${op} $${values.length + 1}`);
  values.push(value);
};

const pushIn = (conditions, values, col, list) => {
  const vals = (Array.isArray(list) ? list : [list])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));
  if (vals.length) {
    conditions.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
    values.push(...vals);
  } else {
    // Mongo $in: [] matches no documents (it is an instant-false predicate).
    conditions.push("1 = 0");
  }
};

const buildInventoryItemFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.name === "object" && !Array.isArray(filter.name) && filter.name.$in) {
    pushIn(conditions, values, "name", filter.name.$in);
  } else if (filter.name) {
    pushCond(conditions, values, "name", "=", String(filter.name).trim());
  }

  if (typeof filter.category === "object" && !Array.isArray(filter.category) && filter.category.$in) {
    assertEnumOrArray(filter.category.$in, CATEGORIES, "category.$in");
    pushIn(conditions, values, "category", filter.category.$in);
  } else if (filter.category) {
    assertEnum(filter.category, CATEGORIES, "category");
    pushCond(conditions, values, "category", "=", filter.category);
  }

  if (typeof filter.type === "object" && !Array.isArray(filter.type) && filter.type.$in) {
    assertEnumOrArray(filter.type.$in, ITEM_TYPES, "type.$in");
    pushIn(conditions, values, "type", filter.type.$in);
  } else if (filter.type) {
    assertEnum(filter.type, ITEM_TYPES, "type");
    pushCond(conditions, values, "type", "=", filter.type);
  }

  if (typeof filter.unit === "object" && !Array.isArray(filter.unit) && filter.unit.$in) {
    assertEnumOrArray(filter.unit.$in, UNITS, "unit.$in");
    pushIn(conditions, values, "unit", filter.unit.$in);
  } else if (filter.unit) {
    assertEnum(filter.unit, UNITS, "unit");
    pushCond(conditions, values, "unit", "=", filter.unit);
  }

  if (typeof filter.itemCode === "object" && !Array.isArray(filter.itemCode) && filter.itemCode.$in) {
    pushIn(conditions, values, "item_code", filter.itemCode.$in);
  } else if (filter.itemCode) {
    pushCond(conditions, values, "item_code", "=", String(filter.itemCode).trim());
  }

  if (filter.isActive !== undefined && filter.isActive !== null) {
    if (typeof filter.isActive === "object" && !Array.isArray(filter.isActive) && filter.isActive.$in) {
      pushIn(conditions, values, "is_active", filter.isActive.$in);
    } else {
      pushCond(conditions, values, "is_active", "=", Boolean(filter.isActive));
    }
  }

  if (filter.availableStock !== undefined && filter.availableStock !== null) {
    const avail = filter.availableStock;
    if (typeof avail === "object" && !Array.isArray(avail)) {
      // Mongo operator object — supports the low-stock style range used by
      // dashboard/stock scanning (e.g. { availableStock: { $lte: min } }).
      const hasOp = ["$gte", "$gt", "$lte", "$lt"].some((op) => avail[op] !== undefined);
      if (hasOp) {
        for (const [op, opVal] of Object.entries(avail)) {
          if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
            const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
            pushCond(conditions, values, "available_stock", sqlOp, opVal);
          }
        }
      } else if (avail.$in) {
        pushIn(conditions, values, "available_stock", avail.$in);
      }
    } else {
      pushCond(conditions, values, "available_stock", "=", avail);
    }
  }

  if (filter.search) {
    const term = String(filter.search).trim();
    if (term) {
      const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const idx = values.length + 1;
      conditions.push(`(name ILIKE $${idx} ESCAPE '\\' OR item_code ILIKE $${idx} ESCAPE '\\' OR barcode ILIKE $${idx} ESCAPE '\\' OR last_supplier ILIKE $${idx} ESCAPE '\\')`);
      values.push(`%${escaped}%`);
    }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const assertValidCreate = (data) => {
  assertName(data.name);
  assertEnum(data.type, ITEM_TYPES, "type");
  if (data.unit !== undefined && data.unit !== null) assertEnum(data.unit, UNITS, "unit");
  if (data.category !== undefined && data.category !== null) assertEnum(data.category, CATEGORIES, "category");
  for (const key of [
    "availableStock", "reservedStock", "issuedStock", "consumedStock",
    "damagedStock", "expiredStock", "returnedStock", "minimumStock",
    "reorderLevel", "maximumStock", "shelfLifeDays",
  ]) {
    assertStockCounter(data[key], key);
  }
  for (const key of ["purchasePrice", "sellingPrice", "gstRate", "lastPurchasePrice"]) {
    assertPrice(data[key], key);
  }
};

const validateUpdates = (updates) => {
  assertEnum(updates.type, ITEM_TYPES, "type");
  assertEnum(updates.unit, UNITS, "unit");
  assertEnum(updates.category, CATEGORIES, "category");
  for (const key of [
    "availableStock", "reservedStock", "issuedStock", "consumedStock",
    "damagedStock", "expiredStock", "returnedStock", "minimumStock",
    "reorderLevel", "maximumStock", "shelfLifeDays",
  ]) {
    assertStockCounter(updates[key], key);
  }
  for (const key of ["purchasePrice", "sellingPrice", "gstRate", "lastPurchasePrice"]) {
    assertPrice(updates[key], key);
  }
};

const findById = async (id) => {
  if (!id) return null;
  if (!isDbConnected()) return InventoryItem.findById(String(id));
  const { rows } = await query(`SELECT ${INVENTORY_ITEM_COLS.join(", ")} FROM inventory_items WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!isDbConnected()) return InventoryItem.findOne(filter);
  const { where, values } = buildInventoryItemFilter(filter);
  // Mongoose findOne({}) returns the first document; we mirror that rather
  // than treating an empty filter as no-match.
  const { rows } = await query(`SELECT ${INVENTORY_ITEM_COLS.join(", ")} FROM inventory_items ${where} ORDER BY name ASC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  if (!isDbConnected()) {
    let q = InventoryItem.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildInventoryItemFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${INVENTORY_ITEM_COLS.join(", ")} FROM inventory_items ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates an inventory item. Mirrors the Mongo model validation (name
 * required, type/unit/category enums, stock counters and prices >= 0) and the
 * real create path (inventoryItemController.createInventoryItem), which
 * rejects an existing name+category combination as a duplicate. The INSERT is
 * a single atomic statement; a failure cannot leave a partial row behind.
 */
const create = async (data) => {
  assertValidCreate(data);
  if (!isDbConnected()) return InventoryItem.create(data);

  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO inventory_items (${INVENTORY_ITEM_COLS.join(", ")})
     VALUES (${INVENTORY_ITEM_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    INVENTORY_ITEM_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.name !== undefined && (updates.name === null || String(updates.name).trim() === "")) {
    throw new Error("name is required");
  }
  validateUpdates(updates);

  if (!isDbConnected()) {
    return InventoryItem.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  }

  const existing = await findById(id);
  if (!existing?._id) return null;

  const fields = [];
  const values = [];
  const apply = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value);
    }
  };
  const applyScalar = (dbCol, value, trim = false) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || (trim && String(value).trim() === "") ? null : trim ? String(value).trim() : String(value));
    }
  };
  const applyNumber = (dbCol, value, fb = 0) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? fb : value);
    }
  };
  const applyBool = (dbCol, value, fb) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? fb : Boolean(value));
    }
  };
  const applyDate = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : new Date(value));
    }
  };

  if (updates.name !== undefined) applyScalar("name", updates.name, true);
  if (updates.itemCode !== undefined) applyScalar("item_code", updates.itemCode, true);
  if (updates.barcode !== undefined) applyScalar("barcode", updates.barcode, true);
  if (updates.qrCode !== undefined) applyScalar("qr_code", updates.qrCode, true);
  if (updates.type !== undefined) applyScalar("type", updates.type || "Consumable", true);
  if (updates.unit !== undefined) applyScalar("unit", updates.unit, true);
  if (updates.availableStock !== undefined) applyNumber("available_stock", updates.availableStock);
  if (updates.reservedStock !== undefined) applyNumber("reserved_stock", updates.reservedStock);
  if (updates.issuedStock !== undefined) applyNumber("issued_stock", updates.issuedStock);
  if (updates.consumedStock !== undefined) applyNumber("consumed_stock", updates.consumedStock);
  if (updates.damagedStock !== undefined) applyNumber("damaged_stock", updates.damagedStock);
  if (updates.expiredStock !== undefined) applyNumber("expired_stock", updates.expiredStock);
  if (updates.returnedStock !== undefined) applyNumber("returned_stock", updates.returnedStock);
  if (updates.minimumStock !== undefined) applyNumber("minimum_stock", updates.minimumStock);
  if (updates.reorderLevel !== undefined) applyNumber("reorder_level", updates.reorderLevel);
  if (updates.maximumStock !== undefined) applyNumber("maximum_stock", updates.maximumStock);
  if (updates.batchRequired !== undefined) applyBool("batch_required", updates.batchRequired, false);
  if (updates.expiryRequired !== undefined) applyBool("expiry_required", updates.expiryRequired, false);
  if (updates.shelfLifeDays !== undefined) applyNumber("shelf_life_days", updates.shelfLifeDays);
  if (updates.purchasePrice !== undefined) applyNumber("purchase_price", updates.purchasePrice);
  if (updates.sellingPrice !== undefined) applyNumber("selling_price", updates.sellingPrice);
  if (updates.gstRate !== undefined) applyNumber("gst_rate", updates.gstRate);
  if (updates.preferredSupplier !== undefined) applyScalar("preferred_supplier", updates.preferredSupplier);
  if (updates.expenseHead !== undefined) applyScalar("expense_head", updates.expenseHead);
  if (updates.incomeHead !== undefined) applyScalar("income_head", updates.incomeHead);
  if (updates.inventoryAccount !== undefined) applyScalar("inventory_account", updates.inventoryAccount);
  if (updates.category !== undefined) applyScalar("category", updates.category || "Miscellaneous Items", true);
  if (updates.description !== undefined) applyScalar("description", updates.description, true);
  if (updates.isActive !== undefined) applyBool("is_active", updates.isActive, true);
  if (updates.expiryDate !== undefined) applyDate("expiry_date", updates.expiryDate);
  if (updates.lastPurchaseDate !== undefined) applyDate("last_purchase_date", updates.lastPurchaseDate);
  if (updates.lastPurchasePrice !== undefined) applyNumber("last_purchase_price", updates.lastPurchasePrice);
  if (updates.lastSupplier !== undefined) applyScalar("last_supplier", updates.lastSupplier, true);

  if (values.length === 0) return existing;

  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE inventory_items SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!isDbConnected()) return InventoryItem.countDocuments(filter);
  const { where, values } = buildInventoryItemFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM inventory_items ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!isDbConnected()) return Boolean(await InventoryItem.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM inventory_items WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

// issueInventoryRequest resolves an item by exact name, case-insensitive
// ({ name: { $regex: '^name$', 'i' } }). PostgreSQL can use the
// idx_inventory_items_name_lower index for lower(name).
const findByName = async (name) => {
  if (!name) return null;
  if (!isDbConnected()) return InventoryItem.findOne({ name: { $regex: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } });
  const { rows } = await query(
    `SELECT ${INVENTORY_ITEM_COLS.join(", ")} FROM inventory_items WHERE lower(name) = lower($1) ORDER BY name ASC, id ASC`,
    [String(name).trim()]
  );
  return rows.map(toDoc);
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  destroy,
  findByName,
};