const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const AccountHead = require("../models/AccountHead");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const HEAD_TYPES = new Set(["Income", "Expense"]);

const assertHeadType = (type) => {
  if (type === undefined || type === null) return;
  if (!HEAD_TYPES.has(type)) {
    throw new Error(`Invalid account head type: ${type}. Allowed: Income, Expense`);
  }
};

const HEAD_COLS = [
  "id", "name", "type", "description", "is_active", "created_by", "created_at", "updated_at",
];

const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description || undefined,
    isActive: row.is_active,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRow = (data, id = newId()) => ({
  id,
  name: data.name,
  type: data.type,
  description: data.description ?? null,
  is_active: data.isActive !== false,
  created_by: data.createdBy || null,
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const findById = async (id) => {
  if (!id) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`SELECT ${HEAD_COLS.join(", ")} FROM account_heads WHERE id = $1 LIMIT 1`, [String(id)]);
    return toDoc(rows[0]);
  }
  return AccountHead.findById(String(id));
};

const findByName = async (name) => {
  if (!name) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`SELECT ${HEAD_COLS.join(", ")} FROM account_heads WHERE name = $1 LIMIT 1`, [String(name)]);
    return toDoc(rows[0]);
  }
  return AccountHead.findOne({ name: String(name) });
};

const SORT_COLUMNS = {
  name: "name",
  type: "type",
  createdAt: "created_at",
  isActive: "is_active",
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

const buildHeadFilter = (filter) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };

  for (const [key, value] of Object.entries(filter || {})) {
    if (value === undefined) continue;
    switch (key) {
      case "type": assertHeadType(value); pushCond("type", "=", value); break;
      case "isActive": pushCond("is_active", "=", Boolean(value)); break;
      case "name": pushCond("name", "=", value); break;
      case "createdBy": pushCond("created_by", "=", String(value)); break;
      case "search": {
        const term = String(value || "").trim();
        if (term) {
          const pattern = `%${term}%`;
          conditions.push(`(name ILIKE $${values.length + 1} OR COALESCE(description, '') ILIKE $${values.length + 2})`);
          values.push(pattern, pattern);
        }
        break;
      }
      default: break;
    }
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const create = async (data) => {
  assertHeadType(data.type);
  const id = data.id || newId();
  const row = toRow(data, id);
  if (dbConfig.isDbConnected()) {
    await query(
      `INSERT INTO account_heads (${HEAD_COLS.join(", ")})
       VALUES (${HEAD_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      HEAD_COLS.map((col) => row[col])
    );
    const existing = await findById(id);
    if (existing) return existing;
  } else {
    return AccountHead.create(data);
  }
  return toDoc(row);
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;
  assertHeadType(updates.type);
  if (dbConfig.isDbConnected()) {
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

    apply("name", updates.name);
    apply("type", updates.type);
    if (updates.description !== undefined) apply("description", updates.description ?? null);
    apply("is_active", updates.isActive);
    apply("created_by", updates.createdBy);

    if (values.length === 0) return existing;
    fields.push(`updated_at = now()`);
    values.push(id);
    await query(`UPDATE account_heads SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    return findById(id);
  }
  const updated = await AccountHead.findByIdAndUpdate(String(id), updates, { new: true, runValidators: true });
  return updated ? toDoc(updated) : null;
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = AccountHead.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    const docs = await q;
    return docs.map((d) => toDoc(d));
  }
  const { where, values } = buildHeadFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${HEAD_COLS.join(", ")} FROM account_heads ${where} ORDER BY ${orderBy}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return AccountHead.countDocuments(filter);
  const { where, values } = buildHeadFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM account_heads ${where}`, values);
  return rows[0]?.count || 0;
};

const destroy = async (id) => {
  if (!id) return false;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`DELETE FROM account_heads WHERE id = $1 RETURNING id`, [String(id)]);
    return rows.length > 0;
  }
  const deleted = await AccountHead.findByIdAndDelete(String(id));
  return Boolean(deleted);
};

module.exports = {
  findById,
  findByName,
  create,
  updateById,
  findMany,
  count,
  destroy,
};