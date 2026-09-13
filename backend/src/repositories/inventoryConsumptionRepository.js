const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const InventoryConsumption = require("../models/InventoryConsumption");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// The Mongo schema declares the three quantities as Number, required, min: 0.
// Like the value is parsed to a finite number, and negatives are rejected —
// mirroring the Mongoose min: 0 validator exactly.
const assertRequiredQuantity = (value, label) => {
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

const assertQuantity = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0 (Mongo schema min: 0)`);
  }
};

const assertText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

const INVENTORY_CONSUMPTION_COLS = [
  "id", "issue_id", "inventory_item_id", "item_name", "user_id", "user_name",
  "role", "issued_quantity", "used_quantity", "returned_quantity", "unit",
  "purpose", "remarks", "date", "created_at", "updated_at",
];

// Converts an inventory_consumptions row into the shape the application
// receives from Mongoose (camelCase, Mongo _id).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    issue: row.issue_id || undefined,
    item: row.inventory_item_id,
    itemName: row.item_name,
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    issuedQuantity: row.issued_quantity === null || row.issued_quantity === undefined ? undefined : Number(row.issued_quantity),
    usedQuantity: row.used_quantity === null || row.used_quantity === undefined ? undefined : Number(row.used_quantity),
    returnedQuantity: row.returned_quantity === null || row.returned_quantity === undefined ? undefined : Number(row.returned_quantity),
    unit: row.unit,
    purpose: row.purpose,
    remarks: row.remarks,
    date: row.date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  issue_id: data.issue === undefined || data.issue === null || String(data.issue).trim() === "" ? null : String(data.issue).trim(),
  inventory_item_id: String(data.item).trim(),
  item_name: data.itemName,
  user_id: String(data.userId).trim(),
  user_name: data.userName,
  role: data.role,
  // Pass the original value straight to NUMERIC so the driver preserves the
  // supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  issued_quantity: data.issuedQuantity,
  used_quantity: data.usedQuantity,
  returned_quantity: data.returnedQuantity,
  unit: data.unit,
  purpose: data.purpose ?? "",
  remarks: data.remarks ?? "",
  date: data.date === undefined || data.date === null ? new Date() : new Date(data.date),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  date: "date",
  createdAt: "created_at",
  updatedAt: "updated_at",
  issuedQuantity: "issued_quantity",
  usedQuantity: "used_quantity",
  returnedQuantity: "returned_quantity",
  item: "inventory_item_id",
  itemName: "item_name",
  userId: "user_id",
  userName: "user_name",
  role: "role",
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

// Supports the real filters, the standard CRUD surface and Mongo-compatible
// $in semantics:
//   * { item } / { item: { $in: [...] } } — per-item consumption inspection
//   * { userId } / { userId: { $in: [...] } } — the staff/priest inventory
//     issue screens list by userId
//   * { issue } / { issue: { $in: [...] } }
//   * { id: { $in: [...] } }
//   * { date: { $gte, $lt, $lte } } and { createdAt } range filters
//   * { issuedQuantity / usedQuantity / returnedQuantity } range filters
const buildInventoryConsumptionFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.item === "object" && !Array.isArray(filter.item) && filter.item.$in) {
    pushIn(conditions, values, "inventory_item_id", filter.item.$in);
  } else if (filter.item) {
    pushCond(conditions, values, "inventory_item_id", "=", String(filter.item).trim());
  }

  if (typeof filter.issue === "object" && !Array.isArray(filter.issue) && filter.issue.$in) {
    pushIn(conditions, values, "issue_id", filter.issue.$in);
  } else if (filter.issue) {
    pushCond(conditions, values, "issue_id", "=", String(filter.issue).trim());
  }

  if (typeof filter.userId === "object" && !Array.isArray(filter.userId) && filter.userId.$in) {
    pushIn(conditions, values, "user_id", filter.userId.$in);
  } else if (filter.userId) {
    pushCond(conditions, values, "user_id", "=", String(filter.userId).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "date", filter.date, true);
  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "issued_quantity", filter.issuedQuantity, false);
  pushRangeOrEquals(conditions, values, "used_quantity", filter.usedQuantity, false);
  pushRangeOrEquals(conditions, values, "returned_quantity", filter.returnedQuantity, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return InventoryConsumption.findById(String(id));
  const { rows } = await query(`SELECT ${INVENTORY_CONSUMPTION_COLS.join(", ")} FROM inventory_consumptions WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryConsumption.findOne(filter);
  const { where, values } = buildInventoryConsumptionFilter(filter);
  const { rows } = await query(`SELECT ${INVENTORY_CONSUMPTION_COLS.join(", ")} FROM inventory_consumptions ${where} ORDER BY date DESC, created_at DESC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { date: -1, createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = InventoryConsumption.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildInventoryConsumptionFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${INVENTORY_CONSUMPTION_COLS.join(", ")} FROM inventory_consumptions ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates an inventory consumption. Mirrors the Mongo model validation (item,
 * itemName, userId, userName, role, issuedQuantity, usedQuantity,
 * returnedQuantity and unit are required; the three quantities are min: 0;
 * purpose/remarks default to "") and the real write path
 * (inventoryIssueController.completeUsage). The INSERT is a single atomic
 * statement — a failure cannot leave a partial row.
 */
const create = async (data) => {
  assertId(data.item, "item");
  assertText(data.itemName, "itemName");
  assertId(data.userId, "userId");
  assertText(data.userName, "userName");
  assertText(data.role, "role");
  assertRequiredQuantity(data.issuedQuantity, "issuedQuantity");
  assertRequiredQuantity(data.usedQuantity, "usedQuantity");
  assertRequiredQuantity(data.returnedQuantity, "returnedQuantity");
  assertText(data.unit, "unit");

  if (!dbConfig.isDbConnected()) return InventoryConsumption.create(data);

  const id = data.id || newId();
  const row = toRow(data, id);

  await query(
    `INSERT INTO inventory_consumptions (${INVENTORY_CONSUMPTION_COLS.join(", ")})
     VALUES (${INVENTORY_CONSUMPTION_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    INVENTORY_CONSUMPTION_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.item !== undefined && updates.item !== null && String(updates.item).trim() === "") {
    throw new Error("item is required");
  }
  if (updates.userId !== undefined && updates.userId !== null && String(updates.userId).trim() === "") {
    throw new Error("userId is required");
  }
  if (updates.itemName !== undefined && updates.itemName !== null && String(updates.itemName).trim() === "") {
    throw new Error("itemName is required");
  }
  if (updates.userName !== undefined && updates.userName !== null && String(updates.userName).trim() === "") {
    throw new Error("userName is required");
  }
  if (updates.role !== undefined && updates.role !== null && String(updates.role).trim() === "") {
    throw new Error("role is required");
  }
  if (updates.unit !== undefined && updates.unit !== null && String(updates.unit).trim() === "") {
    throw new Error("unit is required");
  }
  if (updates.issuedQuantity !== undefined) assertRequiredQuantity(updates.issuedQuantity, "issuedQuantity");
  if (updates.usedQuantity !== undefined) assertRequiredQuantity(updates.usedQuantity, "usedQuantity");
  if (updates.returnedQuantity !== undefined) assertRequiredQuantity(updates.returnedQuantity, "returnedQuantity");

  if (!dbConfig.isDbConnected()) {
    return InventoryConsumption.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyText = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? "" : String(value));
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
  if (updates.issue !== undefined) applyBlankable("issue_id", updates.issue);
  if (updates.itemName !== undefined) apply("item_name", updates.itemName);
  if (updates.userId !== undefined) apply("user_id", String(updates.userId).trim());
  if (updates.userName !== undefined) apply("user_name", updates.userName);
  if (updates.role !== undefined) apply("role", updates.role);
  if (updates.issuedQuantity !== undefined) applyNumber("issued_quantity", updates.issuedQuantity);
  if (updates.usedQuantity !== undefined) applyNumber("used_quantity", updates.usedQuantity);
  if (updates.returnedQuantity !== undefined) applyNumber("returned_quantity", updates.returnedQuantity);
  if (updates.unit !== undefined) apply("unit", updates.unit);
  if (updates.purpose !== undefined) applyText("purpose", updates.purpose);
  if (updates.remarks !== undefined) applyText("remarks", updates.remarks);
  if (updates.date !== undefined) applyDate("date", updates.date);

  if (values.length === 0) return existing;

  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE inventory_consumptions SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryConsumption.countDocuments(filter);
  const { where, values } = buildInventoryConsumptionFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM inventory_consumptions ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await InventoryConsumption.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM inventory_consumptions WHERE id = $1 RETURNING id`, [String(id)]);
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