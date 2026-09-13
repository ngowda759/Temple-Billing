const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const InventoryLog = require("../models/InventoryLog");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enum declared in backend/src/models/InventoryLog.js.
const ACTIONS = new Set(["Added", "Updated", "Consumed", "Restocked", "Issue", "Damage", "Expire", "Return", "Lost", "Adjusted"]);

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

const assertRequiredNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  assertNumber(value, label);
};

const INVENTORY_LOG_COLS = [
  "id", "inventory_item_id", "action", "quantity", "old_stock", "new_stock",
  "user_id", "date", "created_at", "updated_at",
];

// Converts an inventory_logs row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). The description field is intentionally not
// present: the Mongo model does not declare it and Mongoose strict mode strips
// it, so repository rows (like Mongo documents) never carry it.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.inventory_item_id,
    action: row.action,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    oldStock: row.old_stock === null || row.old_stock === undefined ? undefined : Number(row.old_stock),
    newStock: row.new_stock === null || row.new_stock === undefined ? undefined : Number(row.new_stock),
    user: row.user_id || undefined,
    date: row.date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  inventory_item_id: String(data.item).trim(),
  action: data.action,
  // Pass the original value straight to NUMERIC so the driver preserves the
  // supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  quantity: data.quantity,
  old_stock: data.oldStock ?? 0,
  new_stock: data.newStock ?? 0,
  user_id: data.user === undefined || data.user === null || String(data.user).trim() === "" ? null : String(data.user).trim(),
  date: data.date === undefined || data.date === null ? new Date() : new Date(data.date),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  date: "date",
  createdAt: "created_at",
  updatedAt: "updated_at",
  quantity: "quantity",
  action: "action",
  item: "inventory_item_id",
  user: "user_id",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "date DESC, created_at DESC";
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

// Applies a Mongo comparison operator object ({ $gte/$gt/$lte/$lt })
// to a column, or an exact equality for a plain value.
const pushRangeOrEquals = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  }
};

// Supports the real filters used by the application plus the standard CRUD
// filter surface:
//   * { item } / { item: { $in: [...] } } — getItemDetails stock movement
//   * { action } / { action: { $in: [...] } } — log type filtering
//   * { date: { $gte, $lt, $lte } } — dashboard consumption count and report
//     date ranges
//   * { user } / { user: { $in: [...] } }
//   * { id: { $in: [...] } }
//   * { createdAt: { $gte, $lt, $lte } } and { quantity } range filters
const buildInventoryLogFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.item === "object" && !Array.isArray(filter.item) && filter.item.$in) {
    pushIn(conditions, values, "inventory_item_id", filter.item.$in);
  } else if (filter.item) {
    pushCond(conditions, values, "inventory_item_id", "=", String(filter.item).trim());
  }

  if (typeof filter.user === "object" && !Array.isArray(filter.user) && filter.user.$in) {
    pushIn(conditions, values, "user_id", filter.user.$in);
  } else if (filter.user) {
    pushCond(conditions, values, "user_id", "=", String(filter.user).trim());
  }

  if (typeof filter.action === "object" && !Array.isArray(filter.action) && filter.action.$in) {
    assertEnumOrArray(filter.action.$in, ACTIONS, "action.$in");
    pushIn(conditions, values, "action", filter.action.$in);
  } else if (filter.action) {
    assertEnum(filter.action, ACTIONS, "action");
    pushCond(conditions, values, "action", "=", filter.action);
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "date", filter.date, true);
  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "quantity", filter.quantity, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return InventoryLog.findById(String(id));
  const { rows } = await query(`SELECT ${INVENTORY_LOG_COLS.join(", ")} FROM inventory_logs WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryLog.findOne(filter);
  const { where, values } = buildInventoryLogFilter(filter);
  const { rows } = await query(`SELECT ${INVENTORY_LOG_COLS.join(", ")} FROM inventory_logs ${where} ORDER BY date DESC, created_at DESC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1, createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = InventoryLog.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildInventoryLogFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${INVENTORY_LOG_COLS.join(", ")} FROM inventory_logs ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates an inventory log. Mirrors the Mongo model validation (item and
 * action required, action enum, quantity required, oldStock/newStock default
 * 0) and the real write paths (inventoryHelper, inventoryItemController). The
 * INSERT is a single atomic statement — a failure cannot leave a partial row.
 */
const create = async (data) => {
  assertId(data.item, "item");
  const action = String(data.action || "").trim();
  if (action === "") {
    throw new Error("action is required");
  }
  assertEnum(action, ACTIONS, "action");
  assertRequiredNumber(data.quantity, "quantity");
  assertNumber(data.oldStock, "oldStock");
  assertNumber(data.newStock, "newStock");

  if (!dbConfig.isDbConnected()) return InventoryLog.create(data);

  const id = data.id || newId();
  const row = toRow({ ...data, action }, id);

  await query(
    `INSERT INTO inventory_logs (${INVENTORY_LOG_COLS.join(", ")})
     VALUES (${INVENTORY_LOG_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    INVENTORY_LOG_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
    throw new Error("item is required");
  }
  if (updates.action !== undefined) {
    const action = String(updates.action || "").trim();
    if (action === "") {
      throw new Error("action is required");
    }
    assertEnum(action, ACTIONS, "action");
  }
  if (updates.quantity !== undefined) assertRequiredNumber(updates.quantity, "quantity");
  assertNumber(updates.oldStock, "oldStock");
  assertNumber(updates.newStock, "newStock");

  if (!dbConfig.isDbConnected()) {
    return InventoryLog.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyBlankable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || String(value).trim() === "" ? null : String(value).trim());
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

  if (updates.item !== undefined) apply("inventory_item_id", String(updates.item).trim());
  if (updates.action !== undefined) apply("action", String(updates.action).trim());
  if (updates.quantity !== undefined) applyNumber("quantity", updates.quantity);
  if (updates.oldStock !== undefined) applyNumber("old_stock", updates.oldStock);
  if (updates.newStock !== undefined) applyNumber("new_stock", updates.newStock);
  if (updates.user !== undefined) applyBlankable("user_id", updates.user);
  if (updates.date !== undefined) applyDate("date", updates.date);

  if (values.length === 0) return existing;

  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE inventory_logs SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryLog.countDocuments(filter);
  const { where, values } = buildInventoryLogFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM inventory_logs ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await InventoryLog.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM inventory_logs WHERE id = $1 RETURNING id`, [String(id)]);
  return rows.length > 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  destroy,
};