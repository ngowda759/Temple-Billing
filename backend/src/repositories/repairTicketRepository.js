const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const RepairTicket = require("../models/RepairTicket");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/RepairTicket.js exactly.
const STATUSES = new Set([
  "Reported", "Pending Approval", "Approved", "In Progress", "Completed", "Rejected", "Closed",
]);
const PRIORITIES = new Set(["Low", "Medium", "High", "Critical"]);

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

// vendorBillAmount has NO min in Mongo ({ type: Number, default: 0 } permits
// negatives) — only finiteness is checked, exactly like the schema.
const assertMoney = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// sparePartsUsed[].quantity has NO min in Mongo ({ type: Number, default: 1 })
// — only finiteness is checked.
const assertQuantity = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const TICKET_COLS = [
  "id", "ticket_number", "asset_id", "reported_by", "issue_description",
  "status", "priority", "vendor", "vendor_bill_amount", "vendor_bill_photo",
  "repair_expense_id", "approved_by", "resolution_notes", "created_at",
  "updated_at",
];

const SPARE_PART_COLS = [
  "id", "ticket_id", "position", "inventory_item_id", "quantity",
  "created_at", "updated_at",
];

const nullIfEmpty = (value) =>
  value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();

// Converts a repair_ticket_spare_parts row into the shape the application
// receives from a Mongoose sub-document (camelCase, Mongo _id).
const toSparePartDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.inventory_item_id || undefined,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toSparePartRow = (data, ticketId, position, id = newId()) => ({
  id,
  ticket_id: ticketId,
  position,
  inventory_item_id: nullIfEmpty(data.item),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale.
  quantity: data.quantity ?? 1,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Converts a repair_tickets row into the shape the application receives from
// Mongoose (camelCase, Mongo _id, embedded sparePartsUsed array).
const toDoc = (row, sparePartsUsed = []) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    ticketNumber: row.ticket_number,
    asset: row.asset_id,
    reportedBy: row.reported_by,
    issueDescription: row.issue_description,
    status: row.status,
    priority: row.priority,
    sparePartsUsed: Array.isArray(sparePartsUsed) ? sparePartsUsed : [],
    vendor: row.vendor || undefined,
    vendorBillAmount: row.vendor_bill_amount === null || row.vendor_bill_amount === undefined ? undefined : Number(row.vendor_bill_amount),
    vendorBillPhoto: row.vendor_bill_photo || undefined,
    repairExpenseId: row.repair_expense_id || undefined,
    approvedBy: row.approved_by || undefined,
    resolutionNotes: row.resolution_notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  ticket_number: assertId(data.ticketNumber, "ticketNumber"),
  // Both required ObjectId refs are never populated away on a write path, so
  // they mirror the Mongo required scalars with NOT NULL columns.
  asset_id: assertId(data.asset, "asset"),
  reported_by: assertId(data.reportedBy, "reportedBy"),
  issue_description: assertId(data.issueDescription, "issueDescription"),
  status: data.status || "Reported",
  priority: data.priority || "Medium",
  vendor: nullIfEmpty(data.vendor),
  vendor_bill_amount: data.vendorBillAmount ?? 0,
  vendor_bill_photo: nullIfEmpty(data.vendorBillPhoto),
  repair_expense_id: nullIfEmpty(data.repairExpenseId),
  approved_by: nullIfEmpty(data.approvedBy),
  resolution_notes: data.resolutionNotes === undefined || data.resolutionNotes === null ? null : String(data.resolutionNotes),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The standing
// ticket sorts in the codebase are `sort({ createdAt: -1 })` (the public asset
// maintenance history), which is the default here.
const SORT_COLUMNS = {
  ticketNumber: "ticket_number",
  asset: "asset_id",
  reportedBy: "reported_by",
  issueDescription: "issue_description",
  status: "status",
  priority: "priority",
  vendor: "vendor",
  vendorBillAmount: "vendor_bill_amount",
  approvedBy: "approved_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
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

// Applies a Mongo comparison operator object ({ $gte/$gt/$lte/$lt }) to a
// column, or an exact equality for a plain value.
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
  } else if (input === null) {
    // Mongo `{ field: null }` matches documents where the field is null OR
    // missing.
    conditions.push(`${col} IS NULL`);
  }
};

// Supports the standard CRUD filter surface plus the Mongo-style operator
// filters the application uses (or could use) against RepairTicket:
//   * { id } / { id: { $in: [...] } }
//   * { ticketNumber } / { ticketNumber: { $in: [...] } } — unique lookups
//   * { asset } / { asset: { $in: [...] } } — the public asset maintenance
//     history query RepairTicket.find({ asset })
//   * { reportedBy } / { approvedBy } — "my tickets" / approver queues
//   * { status } / { status: { $in: [...] } } — the ticket workflow tabs
//   * { priority } / { priority: { $in: [...] } } — priority filtering
//   * { vendor }, { repairExpenseId } filters
//   * { vendorBillAmount } range filters (NUMERIC)
//   * { createdAt } / { updatedAt } range filters
const buildRepairTicketFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.priority === "object" && !Array.isArray(filter.priority) && filter.priority.$in) {
    assertEnumOrArray(filter.priority.$in, PRIORITIES, "priority.$in");
    pushIn(conditions, values, "priority", filter.priority.$in);
  } else if (filter.priority) {
    assertEnum(filter.priority, PRIORITIES, "priority");
    pushCond(conditions, values, "priority", "=", filter.priority);
  }

  if (typeof filter.asset === "object" && !Array.isArray(filter.asset) && filter.asset.$in) {
    pushIn(conditions, values, "asset_id", filter.asset.$in);
  } else if (filter.asset !== undefined && filter.asset !== null) {
    pushCond(conditions, values, "asset_id", "=", String(filter.asset).trim());
  }

  if (typeof filter.reportedBy === "object" && !Array.isArray(filter.reportedBy) && filter.reportedBy.$in) {
    pushIn(conditions, values, "reported_by", filter.reportedBy.$in);
  } else if (filter.reportedBy) {
    pushCond(conditions, values, "reported_by", "=", String(filter.reportedBy).trim());
  }

  if (typeof filter.approvedBy === "object" && !Array.isArray(filter.approvedBy) && filter.approvedBy.$in) {
    pushIn(conditions, values, "approved_by", filter.approvedBy.$in);
  } else if (filter.approvedBy) {
    pushCond(conditions, values, "approved_by", "=", String(filter.approvedBy).trim());
  }

  if (typeof filter.ticketNumber === "object" && !Array.isArray(filter.ticketNumber) && filter.ticketNumber.$in) {
    pushIn(conditions, values, "ticket_number", filter.ticketNumber.$in);
  } else if (filter.ticketNumber) {
    pushCond(conditions, values, "ticket_number", "=", String(filter.ticketNumber).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  if (typeof filter.vendor === "object" && !Array.isArray(filter.vendor) && filter.vendor.$in) {
    pushIn(conditions, values, "vendor", filter.vendor.$in);
  } else if (filter.vendor) {
    pushCond(conditions, values, "vendor", "=", String(filter.vendor).trim());
  }

  if (typeof filter.repairExpenseId === "object" && !Array.isArray(filter.repairExpenseId) && filter.repairExpenseId.$in) {
    pushIn(conditions, values, "repair_expense_id", filter.repairExpenseId.$in);
  } else if (filter.repairExpenseId) {
    pushCond(conditions, values, "repair_expense_id", "=", String(filter.repairExpenseId).trim());
  }

  pushRangeOrEquals(conditions, values, "vendor_bill_amount", filter.vendorBillAmount, false);
  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "updated_at", filter.updatedAt, true);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// Child-table access. `client` lets the create/update transactions share one
// connection so a failed child insert rolls the parent row back too.
const loadSpareParts = async (ticketId, client = null) => {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT ${SPARE_PART_COLS.join(", ")} FROM repair_ticket_spare_parts WHERE ticket_id = $1 ORDER BY position ASC, id ASC`,
    [String(ticketId)]
  );
  return rows.map(toSparePartDoc);
};

const replaceSpareParts = async (client, ticketId, entries = []) => {
  await client.query("DELETE FROM repair_ticket_spare_parts WHERE ticket_id = $1", [String(ticketId)]);
  for (const [index, entry] of entries.entries()) {
    const row = toSparePartRow(entry, ticketId, index, entry.id || newId());
    await client.query(
      `INSERT INTO repair_ticket_spare_parts (${SPARE_PART_COLS.join(", ")})
       VALUES (${SPARE_PART_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
      SPARE_PART_COLS.map((col) => row[col])
    );
  }
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return RepairTicket.findById(String(id));
  const { rows } = await query(`SELECT ${TICKET_COLS.join(", ")} FROM repair_tickets WHERE id = $1 LIMIT 1`, [String(id)]);
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadSpareParts(rows[0].id));
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return RepairTicket.findOne(filter);
  const { where, values } = buildRepairTicketFilter(filter);
  const { rows } = await query(`SELECT ${TICKET_COLS.join(", ")} FROM repair_tickets ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadSpareParts(rows[0].id));
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = RepairTicket.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildRepairTicketFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${TICKET_COLS.join(", ")} FROM repair_tickets ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => toDoc(row, await loadSpareParts(row.id))));
};

/**
 * Inserts a ticket plus its embedded sparePartsUsed rows atomically. The
 * parent and every child row are written through one connection inside a
 * single transaction, so a failed child insert cannot leave a partial ticket
 * behind — mirroring the all-or-nothing Mongo document write.
 */
const create = async (data) => {
  assertId(data.ticketNumber, "ticketNumber");
  assertId(data.asset, "asset");
  assertId(data.reportedBy, "reportedBy");
  assertId(data.issueDescription, "issueDescription");
  assertEnum(data.status, STATUSES, "status");
  assertEnum(data.priority, PRIORITIES, "priority");
  assertMoney(data.vendorBillAmount, "vendorBillAmount");
  for (const entry of data.sparePartsUsed || []) {
    assertQuantity(entry.quantity, "sparePartsUsed.quantity");
  }

  if (!dbConfig.isDbConnected()) {
    return RepairTicket.create(data);
  }

  const id = data.id || newId();
  const row = toRow(data, id);
  const spareParts = Array.isArray(data.sparePartsUsed) ? data.sparePartsUsed : [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO repair_tickets (${TICKET_COLS.join(", ")})
       VALUES (${TICKET_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      TICKET_COLS.map((col) => row[col])
    );
    await replaceSpareParts(client, id, spareParts);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.ticketNumber !== undefined) assertId(updates.ticketNumber, "ticketNumber");
  if (updates.asset !== undefined) assertId(updates.asset, "asset");
  if (updates.reportedBy !== undefined) assertId(updates.reportedBy, "reportedBy");
  if (updates.issueDescription !== undefined) assertId(updates.issueDescription, "issueDescription");
  assertEnum(updates.status, STATUSES, "status");
  assertEnum(updates.priority, PRIORITIES, "priority");
  assertMoney(updates.vendorBillAmount, "vendorBillAmount");
  for (const entry of updates.sparePartsUsed || []) {
    assertQuantity(entry.quantity, "sparePartsUsed.quantity");
  }

  if (!dbConfig.isDbConnected()) {
    return RepairTicket.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
      values.push(nullIfEmpty(value));
    }
  };
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };

  if (updates.ticketNumber !== undefined) apply("ticket_number", String(updates.ticketNumber).trim());
  if (updates.asset !== undefined) apply("asset_id", String(updates.asset).trim());
  if (updates.reportedBy !== undefined) apply("reported_by", String(updates.reportedBy).trim());
  if (updates.issueDescription !== undefined) apply("issue_description", String(updates.issueDescription).trim());
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.priority !== undefined) apply("priority", updates.priority);
  if (updates.vendor !== undefined) applyNullable("vendor", updates.vendor);
  if (updates.vendorBillAmount !== undefined) applyNumber("vendor_bill_amount", updates.vendorBillAmount);
  if (updates.vendorBillPhoto !== undefined) applyNullable("vendor_bill_photo", updates.vendorBillPhoto);
  if (updates.repairExpenseId !== undefined) applyNullable("repair_expense_id", updates.repairExpenseId);
  if (updates.approvedBy !== undefined) applyNullable("approved_by", updates.approvedBy);
  if (updates.resolutionNotes !== undefined) {
    // resolutionNotes is an optional free-text String with no default in
    // Mongo — store it verbatim (an empty string is a legal value).
    apply("resolution_notes", updates.resolutionNotes === null ? null : String(updates.resolutionNotes));
  }

  const replaceParts = updates.sparePartsUsed !== undefined;

  // A sparePartsUsed update replaces the embedded array in Mongo, so the
  // parent field update and the child replacement run in one transaction and
  // either both land or neither does.
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (values.length > 0) {
      fields.push(`updated_at = now()`);
      values.push(id);
      await client.query(`UPDATE repair_tickets SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    }
    if (replaceParts) {
      await replaceSpareParts(client, id, Array.isArray(updates.sparePartsUsed) ? updates.sparePartsUsed : []);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return RepairTicket.countDocuments(filter);
  const { where, values } = buildRepairTicketFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM repair_tickets ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await RepairTicket.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM repair_tickets WHERE id = $1 RETURNING id`, [String(id)]);
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
  STATUSES,
  PRIORITIES,
};