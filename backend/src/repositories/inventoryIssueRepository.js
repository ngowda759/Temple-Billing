const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const InventoryIssue = require("../models/InventoryIssue");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Optional pooled client supplied by a service-level unit of work. When given,
// the query joins the caller's PostgreSQL transaction instead of checking out
// its own connection. Repositories never probe PostgreSQL themselves.
const run = (sql, params, client) => (client ? client.query(sql, params) : query(sql, params));

// Mirrors the enum declared in backend/src/models/InventoryIssue.js.
const ISSUE_STATUSES = new Set(["Active", "Completed"]);

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
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

// issuedQuantity is a Number, required, min: 0 in the Mongo schema. Zero is
// legal at the model layer, negatives are refused — mirroring the Mongoose
// min: 0 validator exactly. Non-finite values are rejected like a Mongoose cast
// error.
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

const INVENTORY_ISSUE_COLS = [
  "id", "request_id", "inventory_item_id", "item_name", "user_id", "user_name",
  "role", "issued_quantity", "unit", "issue_date", "issued_by", "purpose",
  "status", "created_at", "updated_at",
];

// Converts an inventory_issues row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). The id is the preserved 24-hex ObjectId hex
// so inventory_consumptions.issue_id keeps resolving unchanged.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    request: row.request_id || undefined,
    item: row.inventory_item_id,
    itemName: row.item_name,
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    issuedQuantity: row.issued_quantity === null || row.issued_quantity === undefined ? undefined : Number(row.issued_quantity),
    unit: row.unit,
    issueDate: row.issue_date,
    issuedBy: row.issued_by,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  request_id: data.request === undefined || data.request === null || String(data.request).trim() === "" ? null : String(data.request).trim(),
  inventory_item_id: String(data.item).trim(),
  item_name: data.itemName,
  user_id: String(data.userId).trim(),
  user_name: data.userName,
  role: data.role,
  // Pass the original value straight to NUMERIC so the driver preserves the
  // supplied scale (e.g. 10.50 stays 10.50, not 10.5).
  issued_quantity: data.issuedQuantity,
  unit: data.unit,
  issue_date: data.issueDate === undefined || data.issueDate === null ? new Date() : new Date(data.issueDate),
  issued_by: data.issuedBy,
  purpose: data.purpose ?? "",
  status: data.status ?? "Active",
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns so dynamic ordering can never inject SQL.
const SORT_COLUMNS = {
  issueDate: "issue_date",
  createdAt: "created_at",
  updatedAt: "updated_at",
  issuedQuantity: "issued_quantity",
  item: "inventory_item_id",
  itemName: "item_name",
  userId: "user_id",
  userName: "user_name",
  role: "role",
  status: "status",
};

const resolveOrderBy = (sort) => {
  const defaultOrder = "issue_date DESC";
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
// surface:
//   * { userId } / { userId: { $in: [...] } } — getInventoryIssues (the only
//     real filter: find(userId ? { userId } : {}))
//   * { status } / { status: { $in: [...] } }
//   * { item } / { item: { $in: [...] } } — per-item inspection
//   * { request } / { request: { $in: [...] } }
//   * { id: { $in: [...] } }
//   * { issueDate } / { createdAt } range filters and { issuedQuantity } ranges
const buildInventoryIssueFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.userId === "object" && !Array.isArray(filter.userId) && filter.userId.$in) {
    pushIn(conditions, values, "user_id", filter.userId.$in);
  } else if (filter.userId) {
    pushCond(conditions, values, "user_id", "=", String(filter.userId).trim());
  }

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    for (const value of filter.status.$in) assertEnum(value, ISSUE_STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, ISSUE_STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.item === "object" && !Array.isArray(filter.item) && filter.item.$in) {
    pushIn(conditions, values, "inventory_item_id", filter.item.$in);
  } else if (filter.item) {
    pushCond(conditions, values, "inventory_item_id", "=", String(filter.item).trim());
  }

  if (typeof filter.request === "object" && !Array.isArray(filter.request) && filter.request.$in) {
    pushIn(conditions, values, "request_id", filter.request.$in);
  } else if (filter.request) {
    pushCond(conditions, values, "request_id", "=", String(filter.request).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "issue_date", filter.issueDate, true);
  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "issued_quantity", filter.issuedQuantity, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id, client) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return InventoryIssue.findById(String(id));
  const { rows } = await run(`SELECT ${INVENTORY_ISSUE_COLS.join(", ")} FROM inventory_issues WHERE id = $1 LIMIT 1`, [String(id)], client);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { issueDate: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = InventoryIssue.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildInventoryIssueFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${INVENTORY_ISSUE_COLS.join(", ")} FROM inventory_issues ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

/**
 * Creates an inventory issue. Mirrors the Mongo model validation (item,
 * itemName, userId, userName, role, issuedQuantity, unit and issuedBy are
 * required; issuedQuantity is min: 0; request is optional; issueDate defaults to
 * now; purpose defaults to ""; status defaults to "Active") and the single real
 * write path (inventoryRequestController.issueInventoryRequest).
 *
 * An optional `client` makes the INSERT join the caller's PostgreSQL
 * transaction, so issue creation commits or rolls back together with the stock
 * movement and the request transition.
 */
const create = async (data, client) => {
  assertId(data.item, "item");
  assertText(data.itemName, "itemName");
  assertId(data.userId, "userId");
  assertText(data.userName, "userName");
  assertText(data.role, "role");
  assertRequiredQuantity(data.issuedQuantity, "issuedQuantity");
  assertText(data.unit, "unit");
  assertText(data.issuedBy, "issuedBy");
  assertEnum(data.status, ISSUE_STATUSES, "status");

  if (!dbConfig.isDbConnected()) {
    // Trim userId/userName/itemName exactly like the Mongo path does, so both
    // datasources persist the same cleaned payload.
    const mongoData = {
      ...data,
      item: String(data.item).trim(),
      userId: String(data.userId).trim(),
      itemName: String(data.itemName).trim(),
    };
    return InventoryIssue.create(mongoData);
  }

  const id = data.id || newId();
  const row = toRow(data, id);

  await run(
    `INSERT INTO inventory_issues (${INVENTORY_ISSUE_COLS.join(", ")})
     VALUES (${INVENTORY_ISSUE_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    INVENTORY_ISSUE_COLS.map((col) => row[col]),
    client
  );
  return findById(id, client);
};

/**
 * Updates an issue's status — the only mutable field in the application
 * (inventoryIssueController.completeUsage sets `status = 'Completed'`). Mirrors
 * `issue.status = ...; issue.save()`, which touches updatedAt and nothing else.
 * An optional `client` joins the caller's PostgreSQL transaction.
 */
const updateStatus = async (id, status, client) => {
  if (!id) return null;
  assertId(id, "id");
  assertText(status, "status");
  assertEnum(status, ISSUE_STATUSES, "status");

  if (!dbConfig.isDbConnected()) {
    return InventoryIssue.findByIdAndUpdate(String(id), { status }, { new: true, runValidators: true });
  }

  const { rows } = await run(
    `UPDATE inventory_issues SET status = $1, updated_at = now() WHERE id = $2 RETURNING ${INVENTORY_ISSUE_COLS.join(", ")}`,
    [status, String(id)],
    client
  );
  return toDoc(rows[0]);
};

module.exports = {
  ISSUE_STATUSES,
  findById,
  findMany,
  create,
  updateStatus,
};
