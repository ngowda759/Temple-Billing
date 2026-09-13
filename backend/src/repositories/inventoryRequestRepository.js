const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const InventoryRequest = require("../models/InventoryRequest");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/InventoryRequest.js.
const PRIORITIES = new Set(["High", "Medium", "Low"]);
const REQUEST_STATUSES = new Set(["Pending", "Approved", "Rejected", "Issued"]);

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

const assertText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

// quantity is a Number, required, min: 0 in the Mongo schema. Zero is legal at
// the model layer (the HTTP controller additionally rejects <= 0 before the
// model is reached — request validation, not a model restriction). Only
// non-finite values are rejected (mirrors the Mongoose Number cast error) and
// negatives are refused, mirroring the Mongoose min: 0 validator exactly.
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

const INVENTORY_REQUEST_COLS = [
  "id", "user_id", "user_name", "role", "requested_by", "item_name", "quantity",
  "unit", "reason", "purpose", "expected_date", "priority", "status",
  "admin_reason", "rejection_reason", "rejected_at", "approved_by", "approved_at",
  "reviewed_by", "reviewed_at", "issued_at", "created_at", "updated_at",
];

// Converts an inventory_requests row into the shape the application receives
// from Mongoose (camelCase, Mongo _id). Nullable date columns come back as
// undefined when unset, matching null/default-null Mongo behaviour.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    requestedBy: row.requested_by,
    itemName: row.item_name,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    unit: row.unit,
    reason: row.reason,
    purpose: row.purpose,
    expectedDate: row.expected_date,
    priority: row.priority,
    status: row.status,
    adminReason: row.admin_reason,
    rejectionReason: row.rejection_reason,
    rejectedAt: row.rejected_at || undefined,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at || undefined,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at || undefined,
    issuedAt: row.issued_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  user_id: String(data.userId).trim(),
  user_name: data.userName,
  role: data.role ?? "Staff",
  requested_by: data.requestedBy ?? "",
  item_name: data.itemName,
  // Pass the original value straight to NUMERIC so the driver preserves the
  // supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  quantity: data.quantity,
  unit: data.unit,
  reason: data.reason ?? "",
  purpose: data.purpose ?? "",
  expected_date: data.expectedDate === undefined || data.expectedDate === null ? new Date() : new Date(data.expectedDate),
  priority: data.priority ?? "Medium",
  status: data.status ?? "Pending",
  admin_reason: data.adminReason ?? "",
  rejection_reason: data.rejectionReason ?? "",
  rejected_at: data.rejectedAt === undefined || data.rejectedAt === null ? null : new Date(data.rejectedAt),
  approved_by: data.approvedBy ?? "",
  approved_at: data.approvedAt === undefined || data.approvedAt === null ? null : new Date(data.approvedAt),
  reviewed_by: data.reviewedBy ?? "",
  reviewed_at: data.reviewedAt === undefined || data.reviewedAt === null ? null : new Date(data.reviewedAt),
  issued_at: data.issuedAt === undefined || data.issuedAt === null ? null : new Date(data.issuedAt),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  expectedDate: "expected_date",
  rejectedAt: "rejected_at",
  approvedAt: "approved_at",
  reviewedAt: "reviewed_at",
  issuedAt: "issued_at",
  quantity: "quantity",
  priority: "priority",
  status: "status",
  userId: "user_id",
  userName: "user_name",
  role: "role",
  itemName: "item_name",
  unit: "unit",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "created_at DESC";
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
//   * { userId } / { userId: { $in: [...] } } — getInventoryRequests /
//     getInventorySummary, the priest/staff request screens
//   * { status } / { status: { $in: [...] } } — pending/admin filtering
//   * { itemName } / { itemName: { $in: [...] } }
//   * { priority } / { priority: { $in: [...] } }
//   * { id: { $in: [...] } }
//   * { createdAt } range — the createInventoryRequest duplicate check:
//     { userId, itemName, status: 'Pending', createdAt: { $gte, $lte } }
//   * { expectedDate }, { approvedAt }, { reviewedAt }, { rejectedAt },
//     { issuedAt } range filters and { quantity } range filters
const buildInventoryRequestFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.userId === "object" && !Array.isArray(filter.userId) && filter.userId.$in) {
    pushIn(conditions, values, "user_id", filter.userId.$in);
  } else if (filter.userId) {
    pushCond(conditions, values, "user_id", "=", String(filter.userId).trim());
  }

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, REQUEST_STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, REQUEST_STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.itemName === "object" && !Array.isArray(filter.itemName) && filter.itemName.$in) {
    pushIn(conditions, values, "item_name", filter.itemName.$in);
  } else if (filter.itemName) {
    pushCond(conditions, values, "item_name", "=", String(filter.itemName).trim());
  }

  if (typeof filter.priority === "object" && !Array.isArray(filter.priority) && filter.priority.$in) {
    assertEnumOrArray(filter.priority.$in, PRIORITIES, "priority.$in");
    pushIn(conditions, values, "priority", filter.priority.$in);
  } else if (filter.priority) {
    assertEnum(filter.priority, PRIORITIES, "priority");
    pushCond(conditions, values, "priority", "=", filter.priority);
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "expected_date", filter.expectedDate, true);
  pushRangeOrEquals(conditions, values, "approved_at", filter.approvedAt, true);
  pushRangeOrEquals(conditions, values, "reviewed_at", filter.reviewedAt, true);
  pushRangeOrEquals(conditions, values, "rejected_at", filter.rejectedAt, true);
  pushRangeOrEquals(conditions, values, "issued_at", filter.issuedAt, true);
  pushRangeOrEquals(conditions, values, "quantity", filter.quantity, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return InventoryRequest.findById(String(id));
  const { rows } = await query(`SELECT ${INVENTORY_REQUEST_COLS.join(", ")} FROM inventory_requests WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryRequest.findOne(filter);
  const { where, values } = buildInventoryRequestFilter(filter);
  const { rows } = await query(`SELECT ${INVENTORY_REQUEST_COLS.join(", ")} FROM inventory_requests ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = InventoryRequest.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildInventoryRequestFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${INVENTORY_REQUEST_COLS.join(", ")} FROM inventory_requests ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates an inventory request. Mirrors the Mongo model validation (userId,
 * userName, itemName, quantity, unit, reason and purpose required; quantity
 * min: 0; role defaults to 'Staff', priority to 'Medium', status to
 * 'Pending') and the real write paths (inventoryRequestController.create,
 * devoteeController/poojaBookingController system-generated requests). The
 * INSERT is a single atomic statement — a failure cannot leave a partial row.
 */
const create = async (data) => {
  assertId(data.userId, "userId");
  assertText(data.userName, "userName");
  assertText(data.itemName, "itemName");
  assertRequiredQuantity(data.quantity, "quantity");
  assertText(data.unit, "unit");
  assertText(data.reason, "reason");
  assertText(data.purpose, "purpose");
  assertEnum(data.priority, PRIORITIES, "priority");
  assertEnum(data.status, REQUEST_STATUSES, "status");

  if (!dbConfig.isDbConnected()) {
    // Trim userId/userName exactly like the controller does before delegating
    // to Mongo, so both paths persist the same cleaned payload.
    const mongoData = { ...data, userId: String(data.userId).trim(), userName: data.userName };
    return InventoryRequest.create(mongoData);
  }

  const id = data.id || newId();
  const row = toRow(data, id);

  await query(
    `INSERT INTO inventory_requests (${INVENTORY_REQUEST_COLS.join(", ")})
     VALUES (${INVENTORY_REQUEST_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    INVENTORY_REQUEST_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.userId !== undefined && updates.userId !== null && String(updates.userId).trim() === "") {
    throw new Error("userId is required");
  }
  if (updates.userName !== undefined && updates.userName !== null && String(updates.userName).trim() === "") {
    throw new Error("userName is required");
  }
  if (updates.itemName !== undefined && updates.itemName !== null && String(updates.itemName).trim() === "") {
    throw new Error("itemName is required");
  }
  if (updates.unit !== undefined && updates.unit !== null && String(updates.unit).trim() === "") {
    throw new Error("unit is required");
  }
  if (updates.reason !== undefined && updates.reason !== null && String(updates.reason).trim() === "") {
    throw new Error("reason is required");
  }
  if (updates.purpose !== undefined && updates.purpose !== null && String(updates.purpose).trim() === "") {
    throw new Error("purpose is required");
  }
  if (updates.quantity !== undefined) assertRequiredQuantity(updates.quantity, "quantity");
  assertEnum(updates.priority, PRIORITIES, "priority");
  assertEnum(updates.status, REQUEST_STATUSES, "status");

  if (!dbConfig.isDbConnected()) {
    return InventoryRequest.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
      values.push(value === null || String(value).trim() === "" ? "" : String(value).trim());
    }
  };
  const applyNullable = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : new Date(value));
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };

  if (updates.userId !== undefined) apply("user_id", String(updates.userId).trim());
  if (updates.userName !== undefined) apply("user_name", updates.userName);
  if (updates.role !== undefined) applyBlankable("role", updates.role);
  if (updates.requestedBy !== undefined) applyBlankable("requested_by", updates.requestedBy);
  if (updates.itemName !== undefined) apply("item_name", String(updates.itemName).trim());
  if (updates.quantity !== undefined) applyNumber("quantity", updates.quantity);
  if (updates.unit !== undefined) apply("unit", String(updates.unit).trim());
  if (updates.reason !== undefined) apply("reason", updates.reason);
  if (updates.purpose !== undefined) apply("purpose", updates.purpose);
  if (updates.expectedDate !== undefined) applyNullable("expected_date", updates.expectedDate);
  if (updates.priority !== undefined) applyBlankable("priority", updates.priority);
  if (updates.status !== undefined) applyBlankable("status", updates.status);
  if (updates.adminReason !== undefined) applyBlankable("admin_reason", updates.adminReason);
  if (updates.rejectionReason !== undefined) applyBlankable("rejection_reason", updates.rejectionReason);
  if (updates.rejectedAt !== undefined) applyNullable("rejected_at", updates.rejectedAt);
  if (updates.approvedBy !== undefined) applyBlankable("approved_by", updates.approvedBy);
  if (updates.approvedAt !== undefined) applyNullable("approved_at", updates.approvedAt);
  if (updates.reviewedBy !== undefined) applyBlankable("reviewed_by", updates.reviewedBy);
  if (updates.reviewedAt !== undefined) applyNullable("reviewed_at", updates.reviewedAt);
  if (updates.issuedAt !== undefined) applyNullable("issued_at", updates.issuedAt);

  if (values.length === 0) return existing;

  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE inventory_requests SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return InventoryRequest.countDocuments(filter);
  const { where, values } = buildInventoryRequestFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM inventory_requests ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await InventoryRequest.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM inventory_requests WHERE id = $1 RETURNING id`, [String(id)]);
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