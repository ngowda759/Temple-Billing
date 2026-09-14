const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const DamageNote = require("../models/DamageNote");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/DamageNote.js. The
// reason enum is NOT asserted in the repository because Mongoose enum errors
// are only raised when the invalid value reaches the model — mirroring that at
// the storage layer would surface a different, earlier error than the app's
// existing Mongo path. The status enum IS asserted here (the approve workflow
// branches on exact status values), matching the other Phase 2 repositories.
const STATUSES = new Set(["Pending Approval", "Approved", "Rejected"]);

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

// Mirrors the Mongo schema's quantity Number + min: 1 validator exactly:
// required, numeric, and must be >= 1. Zero and negatives are rejected.
const assertQuantity = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 1) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 1 (Mongo schema min: 1)`);
  }
};

// writeOffAmount has NO min in Mongo ({ type: Number, default: 0 } permits
// negatives) — only finiteness is checked, exactly like the schema.
const assertWriteOffAmount = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const DAMAGE_NOTE_COLS = [
  "id", "damage_number", "inventory_item_id", "inventory_batch_id", "quantity",
  "reason", "description", "photo_url", "reported_by", "status", "approved_by",
  "write_off_amount", "expense_id", "created_at", "updated_at",
];

const REASONS = [
  "Expired", "Broken/Damaged", "Lost/Stolen", "Spoiled", "Quality Issue", "Other",
];

// Generates the next damage number in the same `DAMAGE-${count + 1}` format
// the damageNoteService derives for the Mongo path. The controller that
// creates damage notes (not yet wired) will follow the createGRN convention of
// deriving the number from the current row count.
const defaultDamageNumber = async () => {
  const existing = await count({});
  return `DAMAGE-${String(existing + 1).padStart(4, "0")}`;
};

// Converts a damage_notes row into the shape the application receives from
// Mongoose (camelCase, Mongo _id). Nullable fields come back as undefined when
// unset, matching null/default-null Mongo behaviour.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    damageNumber: row.damage_number,
    item: row.inventory_item_id,
    batch: row.inventory_batch_id || undefined,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    reason: row.reason,
    description: row.description,
    photoUrl: row.photo_url || undefined,
    reportedBy: row.reported_by,
    status: row.status,
    approvedBy: row.approved_by || undefined,
    writeOffAmount: row.write_off_amount === null || row.write_off_amount === undefined ? undefined : Number(row.write_off_amount),
    expenseId: row.expense_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  damage_number: assertId(data.damageNumber, "damageNumber"),
  inventory_item_id: assertId(data.item, "item"),
  // batch is optional in Mongo — null when unset.
  inventory_batch_id: data.batch === undefined || data.batch === null || String(data.batch).trim() === "" ? null : String(data.batch).trim(),
  // Pass the original value (string or number) straight to NUMERIC so the
  // driver preserves the supplied scale (e.g. 1.50 stays 1.50, not 1.5).
  quantity: data.quantity,
  reason: assertId(data.reason, "reason"),
  description: assertId(data.description, "description"),
  photo_url: data.photoUrl === undefined || data.photoUrl === null || String(data.photoUrl).trim() === "" ? null : String(data.photoUrl).trim(),
  reported_by: assertId(data.reportedBy, "reportedBy"),
  status: data.status || "Pending Approval",
  approved_by: data.approvedBy === undefined || data.approvedBy === null || String(data.approvedBy).trim() === "" ? null : String(data.approvedBy).trim(),
  write_off_amount: data.writeOffAmount ?? 0,
  expense_id: data.expenseId === undefined || data.expenseId === null || String(data.expenseId).trim() === "" ? null : String(data.expenseId).trim(),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The Mongo
// model exposes only the scalar fields below; the default for damage lists
// follows the app-wide createdAt DESC convention. No column outside this
// whitelist can ever be injected into ORDER BY.
const SORT_COLUMNS = {
  damageNumber: "damage_number",
  item: "inventory_item_id",
  batch: "inventory_batch_id",
  quantity: "quantity",
  reason: "reason",
  status: "status",
  reportedBy: "reported_by",
  approvedBy: "approved_by",
  writeOffAmount: "write_off_amount",
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

// Supports the standard CRUD filter surface plus the Mongo-style operator
// filters the application could use against DamageNote:
//   * { id } / { id: { $in: [...] } }
//   * { damageNumber } / { damageNumber: { $in: [...] } } — unique number
//     lookups
//   * { item } / { item: { $in: [...] } } — per-item write-off history
//   * { batch } / { batch: { $in: [...] } } — per-batch write-off history
//   * { reason } / { reason: { $in: [...] } } — reason reporting
//   * { status } / { status: { $in: [...] } } — status filtering (the admin
//     pending-damages review list)
//   * { reportedBy } / { approvedBy } — who created/approved
//   * { createdAt } / { updatedAt } / { quantity } / { writeOffAmount } range
//     filters
const buildDamageNoteFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.reason === "object" && !Array.isArray(filter.reason) && filter.reason.$in) {
    pushIn(conditions, values, "reason", filter.reason.$in);
  } else if (filter.reason) {
    pushCond(conditions, values, "reason", "=", String(filter.reason).trim());
  }

  if (typeof filter.item === "object" && !Array.isArray(filter.item) && filter.item.$in) {
    pushIn(conditions, values, "inventory_item_id", filter.item.$in);
  } else if (filter.item) {
    pushCond(conditions, values, "inventory_item_id", "=", String(filter.item).trim());
  }

  if (typeof filter.batch === "object" && !Array.isArray(filter.batch) && filter.batch.$in) {
    pushIn(conditions, values, "inventory_batch_id", filter.batch.$in);
  } else if (filter.batch) {
    pushCond(conditions, values, "inventory_batch_id", "=", String(filter.batch).trim());
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

  if (typeof filter.damageNumber === "object" && !Array.isArray(filter.damageNumber) && filter.damageNumber.$in) {
    pushIn(conditions, values, "damage_number", filter.damageNumber.$in);
  } else if (filter.damageNumber) {
    pushCond(conditions, values, "damage_number", "=", String(filter.damageNumber).trim());
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  pushRangeOrEquals(conditions, values, "created_at", filter.createdAt, true);
  pushRangeOrEquals(conditions, values, "updated_at", filter.updatedAt, true);
  pushRangeOrEquals(conditions, values, "quantity", filter.quantity, false);
  pushRangeOrEquals(conditions, values, "write_off_amount", filter.writeOffAmount, false);

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return DamageNote.findById(String(id));
  const { rows } = await query(`SELECT ${DAMAGE_NOTE_COLS.join(", ")} FROM damage_notes WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return DamageNote.findOne(filter);
  const { where, values } = buildDamageNoteFilter(filter);
  const { rows } = await query(`SELECT ${DAMAGE_NOTE_COLS.join(", ")} FROM damage_notes ${where} ORDER BY created_at DESC, id DESC LIMIT 1`, values);
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = DamageNote.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildDamageNoteFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const finalOrder = `${orderBy}, id ASC`;
  let sql = `SELECT ${DAMAGE_NOTE_COLS.join(", ")} FROM damage_notes ${where} ORDER BY ${finalOrder}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  assertId(data.item, "item");
  assertQuantity(data.quantity, "quantity");
  assertId(data.reason, "reason");
  assertId(data.description, "description");
  assertId(data.reportedBy, "reportedBy");
  assertEnum(data.status, STATUSES, "status");
  if (data.batch !== undefined && data.batch !== null && String(data.batch).trim() !== "") {
    assertId(data.batch, "batch");
  }
  assertWriteOffAmount(data.writeOffAmount, "writeOffAmount");

  const normalized = { ...data };
  if (normalized.damageNumber === undefined || normalized.damageNumber === null || String(normalized.damageNumber).trim() === "") {
    if (dbConfig.isDbConnected()) {
      // Derived from the current PostgreSQL row count, mirroring the
      // createGRN numbering convention (one numbering domain per datasource).
      normalized.damageNumber = await defaultDamageNumber();
    } else {
      const existing = await DamageNote.countDocuments();
      normalized.damageNumber = `DAMAGE-${String(existing + 1).padStart(4, "0")}`;
    }
  }
  normalized.damageNumber = String(normalized.damageNumber).trim();

  if (!dbConfig.isDbConnected()) {
    return DamageNote.create(normalized);
  }

  const id = normalized.id || newId();
  const row = toRow(normalized, id);
  await query(
    `INSERT INTO damage_notes (${DAMAGE_NOTE_COLS.join(", ")})
     VALUES (${DAMAGE_NOTE_COLS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (id) DO NOTHING`,
    DAMAGE_NOTE_COLS.map((col) => row[col])
  );
  return findById(id);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.item !== undefined) assertId(updates.item, "item");
  if (updates.quantity !== undefined) assertQuantity(updates.quantity, "quantity");
  if (updates.reason !== undefined) assertId(updates.reason, "reason");
  if (updates.description !== undefined) assertId(updates.description, "description");
  if (updates.reportedBy !== undefined) assertId(updates.reportedBy, "reportedBy");
  assertEnum(updates.status, STATUSES, "status");
  assertWriteOffAmount(updates.writeOffAmount, "writeOffAmount");

  if (!dbConfig.isDbConnected()) {
    return DamageNote.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
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
  const applyNumber = (dbCol, value) => {
    if (value !== undefined) {
      fields.push(`${dbCol} = $${fields.length + 1}`);
      values.push(value === null || value === "" ? null : value);
    }
  };

  if (updates.damageNumber !== undefined && updates.damageNumber !== null) {
    if (String(updates.damageNumber).trim() === "") throw new Error("damageNumber is required");
    apply("damage_number", String(updates.damageNumber).trim());
  }
  if (updates.item !== undefined) apply("inventory_item_id", String(updates.item).trim());
  if (updates.batch !== undefined) applyNullable("inventory_batch_id", updates.batch);
  if (updates.quantity !== undefined) applyNumber("quantity", updates.quantity);
  if (updates.reason !== undefined) apply("reason", String(updates.reason).trim());
  if (updates.description !== undefined) apply("description", String(updates.description).trim());
  if (updates.photoUrl !== undefined) applyNullable("photo_url", updates.photoUrl);
  if (updates.reportedBy !== undefined) apply("reported_by", String(updates.reportedBy).trim());
  if (updates.status !== undefined) apply("status", updates.status);
  if (updates.approvedBy !== undefined) applyNullable("approved_by", updates.approvedBy);
  if (updates.writeOffAmount !== undefined) applyNumber("write_off_amount", updates.writeOffAmount);
  if (updates.expenseId !== undefined) applyNullable("expense_id", updates.expenseId);

  if (values.length === 0) return existing;
  fields.push(`updated_at = now()`);
  values.push(id);
  await query(`UPDATE damage_notes SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return DamageNote.countDocuments(filter);
  const { where, values } = buildDamageNoteFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM damage_notes ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (!dbConfig.isDbConnected()) return Boolean(await DamageNote.findByIdAndDelete(String(id)));
  const { rows } = await query(`DELETE FROM damage_notes WHERE id = $1 RETURNING id`, [String(id)]);
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
  REASONS,
  STATUSES,
  defaultDamageNumber,
};