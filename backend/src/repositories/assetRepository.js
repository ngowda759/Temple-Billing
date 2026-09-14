const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Asset = require("../models/Asset");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/Asset.js.
const CATEGORIES = new Set(["Electrical", "Furniture", "Electronics", "Utensils", "Machinery", "Other"]);
const STATUSES = new Set(["Active", "Under Repair", "Retired"]);

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

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// Mirrors the Mongo schema's required String fields (assetId, name).
const assertText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

// purchaseCost has NO min in Mongo ({ type: Number, default: 0 } permits
// negatives) — only finiteness is checked, same as every other money field.
const assertMoney = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const ASSET_COLS = [
  "id", "asset_id", "name", "category", "qr_code", "purchase_date", "supplier",
  "invoice_number", "warranty", "assigned_location", "status", "purchase_cost",
  "serial_number", "created_at", "updated_at",
];

const MAINTENANCE_ENTRY_COLS = [
  "id", "asset_id", "position", "repair_date", "description", "cost", "vendor",
  "created_at", "updated_at",
];

// Converts an asset_maintenance_history row into the shape the application
// receives from a Mongoose sub-document (camelCase, Mongo _id).
const toMaintenanceDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    repairDate: row.repair_date || undefined,
    description: row.description || undefined,
    cost: row.cost === null || row.cost === undefined ? undefined : Number(row.cost),
    vendor: row.vendor || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toMaintenanceRow = (data, assetId, position, id = newId()) => ({
  id,
  asset_id: assetId,
  position,
  repair_date: data.repairDate === undefined || data.repairDate === null ? null : new Date(data.repairDate),
  description: data.description === undefined || data.description === null || String(data.description).trim() === "" ? null : String(data.description).trim(),
  cost: data.cost === undefined || data.cost === null ? null : data.cost,
  vendor: data.vendor === undefined || data.vendor === null || String(data.vendor).trim() === "" ? null : String(data.vendor).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Converts an assets row into the shape the application receives from
// Mongoose (camelCase, Mongo _id, embedded maintenanceHistory array).
const toDoc = (row, maintenanceHistory = []) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    assetId: row.asset_id,
    name: row.name,
    category: row.category,
    qrCode: row.qr_code,
    purchaseDate: row.purchase_date || undefined,
    supplier: row.supplier || undefined,
    invoiceNumber: row.invoice_number,
    warranty: row.warranty,
    assignedLocation: row.assigned_location,
    status: row.status,
    purchaseCost: row.purchase_cost === null || row.purchase_cost === undefined ? undefined : Number(row.purchase_cost),
    serialNumber: row.serial_number,
    maintenanceHistory: Array.isArray(maintenanceHistory) ? maintenanceHistory : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  asset_id: assertId(data.assetId, "assetId"),
  name: assertId(data.name, "name"),
  category: data.category || "Other",
  qr_code: data.qrCode === undefined || data.qrCode === null || String(data.qrCode).trim() === "" ? "" : String(data.qrCode).trim(),
  purchase_date: data.purchaseDate === undefined || data.purchaseDate === null ? null : new Date(data.purchaseDate),
  supplier: data.supplier === undefined || data.supplier === null || String(data.supplier).trim() === "" ? null : String(data.supplier).trim(),
  invoice_number: data.invoiceNumber === undefined || data.invoiceNumber === null || String(data.invoiceNumber).trim() === "" ? "" : String(data.invoiceNumber).trim(),
  warranty: data.warranty === undefined || data.warranty === null || String(data.warranty).trim() === "" ? "" : String(data.warranty).trim(),
  assigned_location: data.assignedLocation === undefined || data.assignedLocation === null || String(data.assignedLocation).trim() === "" ? "Main Temple" : String(data.assignedLocation).trim(),
  status: data.status || "Active",
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale.
  purchase_cost: data.purchaseCost ?? 0,
  serial_number: data.serialNumber === undefined || data.serialNumber === null || String(data.serialNumber).trim() === "" ? "" : String(data.serialNumber).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The default
// for asset lists follows getAllAssets' Asset.find().sort({ name: 1 }), the
// only standing asset-list sort in the codebase.
const SORT_COLUMNS = {
  assetId: "asset_id",
  name: "name",
  category: "category",
  status: "status",
  assignedLocation: "assigned_location",
  purchaseDate: "purchase_date",
  purchaseCost: "purchase_cost",
  serialNumber: "serial_number",
  supplier: "supplier",
  createdAt: "created_at",
  updatedAt: "updated_at",
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

// Applies a Mongo comparison operator object ({ $gte/$gt/$lte/$lt/$ne })
// to a column, or an exact equality for a plain value. $exists/$ne are
// supported for TEXT columns (the app.js warranty cron queries
// { warranty: { $exists: true, $ne: null } }).
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      } else if (op === "$ne") {
        if (opVal === null) {
          // The app.js warranty cron queries { warranty: { $exists: true,
          // $ne: null } } — rewrites to a parameterless IS NOT NULL.
          conditions.push(`${col} IS NOT NULL`);
        } else {
          pushCond(conditions, values, col, "<>", dateCol ? new Date(opVal) : opVal);
        }
      } else if (op === "$exists") {
        // In PostgreSQL every column exists on every row; $exists: false —
        // the Mongo "field is absent" predicate — mirrors the Mongo
        // null/undefined unfilled state. The app only ever queries
        // { $exists: true, $ne: null }, which this satisfies trivially.
        if (opVal === false) {
          conditions.push("1 = 0");
        }
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  } else if (input === null) {
    // Mongo `{ field: null }` matches documents where the field is null OR
    // missing.
    conditions.push(`${col} IS NULL`);
  }
};

// Supports the standard CRUD filter surface plus the Mongo-style operator
// filters the application uses against Asset:
//   * { id } / { id: { $in: [...] } }
//   * { assetId } / { assetId: { $in: [...] } } — unique assetId lookups
//     (public QR scan uses findOne({ assetId }))
//   * { name } / { name: { $in: [...] } }
//   * { category } / { category: { $in: [...] } }
//   * { status } / { status: { $in: [...] } } — the AdminAssetManagement
//     status tabs (Active / Under Repair / Retired)
//   * { supplier }, { assignedLocation }, { serialNumber } filters
//   * { warranty: { $exists: true, $ne: null } } — the app.js warranty cron
//   * { purchaseDate } / { createdAt } / { updatedAt } / { purchaseCost }
//     range filters
const buildAssetFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.category === "object" && !Array.isArray(filter.category) && filter.category.$in) {
    assertEnumOrArray(filter.category.$in, CATEGORIES, "category.$in");
    pushIn(conditions, values, "category", filter.category.$in);
  } else if (filter.category) {
    assertEnum(filter.category, CATEGORIES, "category");
    pushCond(conditions, values, "category", "=", filter.category);
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  if (typeof filter.assetId === "object" && !Array.isArray(filter.assetId) && filter.assetId.$in) {
    pushIn(conditions, values, "asset_id", filter.assetId.$in);
  } else if (filter.assetId) {
    pushCond(conditions, values, "asset_id", "=", String(filter.assetId).trim());
  }

  if (typeof filter.name === "object" && !Array.isArray(filter.name) && filter.name.$in) {
    pushIn(conditions, values, "name", filter.name.$in);
  } else if (filter.name) {
    pushCond(conditions, values, "name", "=", String(filter.name).trim());
  }

  if (typeof filter.supplier === "object" && !Array.isArray(filter.supplier) && filter.supplier.$in) {
    pushIn(conditions, values, "supplier", filter.supplier.$in);
  } else if (filter.supplier) {
    pushCond(conditions, values, "supplier", "=", String(filter.supplier).trim());
  }

  if (typeof filter.assignedLocation === "object" && !Array.isArray(filter.assignedLocation) && filter.assignedLocation.$in) {
    pushIn(conditions, values, "assigned_location", filter.assignedLocation.$in);
  } else if (filter.assignedLocation) {
    pushCond(conditions, values, "assigned_location", "=", String(filter.assignedLocation).trim());
  }

  if (typeof filter.serialNumber === "object" && !Array.isArray(filter.serialNumber) && filter.serialNumber.$in) {
    pushIn(conditions, values, "serial_number", filter.serialNumber.$in);
  } else if (filter.serialNumber) {
    pushCond(conditions, values, "serial_number", "=", String(filter.serialNumber).trim());
  }

  // The app.js warranty cron: Asset.find({ warranty: { $exists: true,
  // $ne: null } }).
  pushComparison(conditions, values, "warranty", filter.warranty, false, true);

  pushComparison(conditions, values, "purchase_date", filter.purchaseDate, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);
  pushComparison(conditions, values, "purchase_cost", filter.purchaseCost, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const loadMaintenanceHistory = async (assetId) => {
  const { rows } = await query(
    `SELECT ${MAINTENANCE_ENTRY_COLS.join(", ")} FROM asset_maintenance_history WHERE asset_id = $1 ORDER BY position ASC, id ASC`,
    [String(assetId)]
  );
  return rows.map(toMaintenanceDoc);
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Asset.findById(String(id));
  const { rows } = await query(`SELECT ${ASSET_COLS.join(", ")} FROM assets WHERE id = $1 LIMIT 1`, [String(id)]);
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadMaintenanceHistory(rows[0].id));
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Asset.findOne(filter);
  const { where, values } = buildAssetFilter(filter);
  const { rows } = await query(`SELECT ${ASSET_COLS.join(", ")} FROM assets ${where} ORDER BY name ASC, id ASC LIMIT 1`, values);
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadMaintenanceHistory(rows[0].id));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Asset.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildAssetFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${ASSET_COLS.join(", ")} FROM assets ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  const assets = await Promise.all(rows.map(async (row) => toDoc(row, await loadMaintenanceHistory(row.id))));
  return assets;
};

const create = async (data) => {
  assertId(data.assetId, "assetId");
  assertId(data.name, "name");
  assertEnum(data.category, CATEGORIES, "category");
  assertEnum(data.status, STATUSES, "status");
  assertMoney(data.purchaseCost, "purchaseCost");
  for (const entry of data.maintenanceHistory || []) {
    assertMoney(entry.cost, "maintenanceHistory.cost");
  }

  if (!dbConfig.isDbConnected()) {
    return Asset.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO assets (${ASSET_COLS.join(", ")})
     VALUES (${ASSET_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    ASSET_COLS.map((col) => row[col])
  );
  const maintenanceHistory = Array.isArray(data.maintenanceHistory) ? data.maintenanceHistory : [];
  for (const [index, entry] of maintenanceHistory.entries()) {
    await addMaintenanceRecord(id, entry, index);
  }
  return findById(id);
};

/**
 * Appends an entry to an asset's embedded maintenanceHistory array. Called by
 * the completeRepair flow (the only writer of maintenance history) and by
 * create with embedded entries. Mirrors the Mongo push semantics.
 */
const addMaintenanceRecord = async (assetId, entry, position = null) => {
  const id = entry.id || newId();
  let index = position;
  if (index === null) {
    const { rows } = await query(
      "SELECT COALESCE(MAX(position), -1)::int + 1 AS next FROM asset_maintenance_history WHERE asset_id = $1",
      [String(assetId)]
    );
    index = rows[0]?.next ?? 0;
  }
  const row = toMaintenanceRow(entry, assetId, index, id);
  await query(
    `INSERT INTO asset_maintenance_history (${MAINTENANCE_ENTRY_COLS.join(", ")})
     VALUES (${MAINTENANCE_ENTRY_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    MAINTENANCE_ENTRY_COLS.map((col) => row[col])
  );
  const asset = await findById(assetId);
  const entryList = asset?.maintenanceHistory || [];
  return entryList[entryList.length - 1] || null;
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.assetId !== undefined && updates.assetId !== null && String(updates.assetId).trim() === "") {
    throw new Error("assetId is required");
  }
  if (updates.name !== undefined && updates.name !== null && String(updates.name).trim() === "") {
    throw new Error("name is required");
  }
  assertEnum(updates.category, CATEGORIES, "category");
  assertEnum(updates.status, STATUSES, "status");
  assertMoney(updates.purchaseCost, "purchaseCost");

  if (!dbConfig.isDbConnected()) {
    return Asset.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyNullable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || String(value).trim() === "" ? null : String(value).trim());
    }
  };
  const applyStringDefault = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === undefined || String(value).trim() === "" ? "" : String(value).trim());
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };
  const applyDate = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : new Date(value));
    }
  };

  if (updates.assetId !== undefined) apply("asset_id", String(updates.assetId).trim());
  if (updates.name !== undefined) apply("name", String(updates.name).trim());
  if (updates.category !== undefined) apply("category", updates.category);
  if (updates.qrCode !== undefined) applyStringDefault("qr_code", updates.qrCode);
  if (updates.purchaseDate !== undefined) applyDate("purchase_date", updates.purchaseDate);
  if (updates.supplier !== undefined) applyNullable("supplier", updates.supplier);
  if (updates.invoiceNumber !== undefined) applyStringDefault("invoice_number", updates.invoiceNumber);
  if (updates.warranty !== undefined) applyStringDefault("warranty", updates.warranty);
  if (updates.assignedLocation !== undefined) applyStringDefault("assigned_location", updates.assignedLocation);
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.purchaseCost !== undefined) applyNumber("purchase_cost", updates.purchaseCost);
  if (updates.serialNumber !== undefined) applyStringDefault("serial_number", updates.serialNumber);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE assets SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Asset.countDocuments(filter);
  const { where, values } = buildAssetFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM assets ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await Asset.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM assets WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  addMaintenanceRecord,
  updateById,
  count,
  destroy,
  CATEGORIES,
  STATUSES,
};