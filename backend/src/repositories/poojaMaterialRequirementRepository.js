const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const PoojaMaterialRequirement = require("../models/PoojaMaterialRequirement");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the `required: true` + `trim: true` poojaName path on
// backend/src/models/PoojaMaterialRequirement.js.
const assertRequiredText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// ObjectId paths cast a 24-char hex string and raise a CastError otherwise. A
// non-hex value is rejected rather than silently stored, because Mongoose
// rejects it too — BUT only when the value is present: this model's single
// writer does not run validators, so a missing item is persisted as absent
// rather than rejected. The distinction is what makes the column nullable.
const toObjectIdText = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "object" && typeof value.toString === "function"
    ? value.toString()
    : String(value);
  if (!/^[0-9a-fA-F]{24}$/.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a 24-character hex ObjectId`);
  }
  return text.toLowerCase();
};

// Number paths cast with Number(); an uncastable value is a CastError, while an
// absent/null/'' value stays null (the sub-schema's `required`/`min` validators
// are NOT run by saveRequirement, so they are deliberately not enforced here).
const toNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  return num;
};

// Mongoose casts Boolean paths with Boolean() and applies the sub-schema default
// when the field is absent; a null keeps null in the cast, but the columns are
// NOT NULL so it collapses to the default (the same choice roomRepository makes).
const toBoolean = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
};

const REQUIREMENT_COLS = ["id", "pooja_name", "created_at", "updated_at"];

const ITEM_COLS = [
  "id", "requirement_id", "position", "item", "quantity", "charge",
  "mandatory", "temple_arrange_available", "temple_charge", "created_at",
  "updated_at",
];

// Converts a pooja_material_requirement_items row into the shape the
// application receives from a Mongoose sub-document (camelCase, Mongo _id).
const toItemDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.item === null || row.item === undefined ? undefined : row.item,
    quantity: row.quantity === null || row.quantity === undefined ? undefined : Number(row.quantity),
    charge: row.charge === null || row.charge === undefined ? undefined : Number(row.charge),
    mandatory: row.mandatory,
    templeArrangeAvailable: row.temple_arrange_available,
    templeCharge: row.temple_charge === null || row.temple_charge === undefined ? undefined : Number(row.temple_charge),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Converts a pooja_material_requirements row into the shape the application
// receives from Mongoose (camelCase, Mongo _id, embedded requiredMaterials).
const toDoc = (row, requiredMaterials = []) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    poojaName: row.pooja_name,
    requiredMaterials: Array.isArray(requiredMaterials) ? requiredMaterials : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toItemRow = (data, requirementId, position, id = newId()) => {
  const entry = data || {};
  return {
    id: entry.id || entry._id || id,
    requirement_id: requirementId,
    position,
    item: toObjectIdText(entry.item, "requiredMaterials.item"),
    quantity: toNumber(entry.quantity, "requiredMaterials.quantity"),
    charge: toNumber(entry.charge, "requiredMaterials.charge") ?? 0,
    mandatory: toBoolean(entry.mandatory, false),
    temple_arrange_available: toBoolean(entry.templeArrangeAvailable, true),
    temple_charge: toNumber(entry.templeCharge, "requiredMaterials.templeCharge") ?? 0,
    created_at: entry.createdAt || new Date(),
    updated_at: entry.updatedAt || new Date(),
  };
};

// Replaces the whole embedded array, exactly as the Mongoose
// findOneAndUpdate({ poojaName }, { requiredMaterials }) $set does (there is no
// append path for this model). Accepts a transaction client so the parent and
// its children commit together.
const replaceItems = async (client, requirementId, materials) => {
  await client.query("DELETE FROM pooja_material_requirement_items WHERE requirement_id = $1", [String(requirementId)]);
  const list = Array.isArray(materials) ? materials : [];
  for (let index = 0; index < list.length; index += 1) {
    const row = toItemRow(list[index], requirementId, index);
    await client.query(
      `INSERT INTO pooja_material_requirement_items (${ITEM_COLS.join(", ")})
       VALUES (${ITEM_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
      ITEM_COLS.map((col) => row[col])
    );
  }
};

const loadItems = async (requirementId) => {
  const { rows } = await query(
    `SELECT ${ITEM_COLS.join(", ")} FROM pooja_material_requirement_items WHERE requirement_id = $1 ORDER BY position ASC, id ASC`,
    [String(requirementId)]
  );
  return rows.map(toItemDoc);
};

// Mirrors PoojaMaterialRequirement.findOne({ poojaName }) — the lookup behind
// GET /api/pooja-settings/:poojaName. As with the Pooja model, the query value is
// NOT trimmed (Mongoose does not apply trim setters to queries), so a
// whitespace-padded lookup finds nothing against a stored trimmed name.
const findOneByName = async (poojaName) => {
  if (poojaName === undefined || poojaName === null) return null;
  if (!dbConfig.isDbConnected()) return PoojaMaterialRequirement.findOne({ poojaName });
  const { rows } = await query(
    `SELECT ${REQUIREMENT_COLS.join(", ")} FROM pooja_material_requirements WHERE pooja_name = $1 LIMIT 1`,
    [String(poojaName)]
  );
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadItems(rows[0].id));
};

// Mirrors PoojaMaterialRequirement.find() — the unsorted listing behind
// GET /api/pooja-settings. Mongo natural order is unspecified, so the
// deterministic stand-in is createdAt ASC, id ASC.
const findMany = async (options = {}) => {
  const { filter = {}, sort, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = sort ? PoojaMaterialRequirement.find(filter).sort(sort) : PoojaMaterialRequirement.find(filter);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const conditions = [];
  const values = [];
  if (filter.poojaName !== undefined && filter.poojaName !== null) {
    conditions.push(`pooja_name = $${values.length + 1}`);
    values.push(String(filter.poojaName));
  }
  if (filter.id !== undefined && filter.id !== null) {
    conditions.push(`id = $${values.length + 1}`);
    values.push(String(filter.id));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const orderBy = (() => {
    const entries = typeof sort === "string" ? [[sort, 1]] : Object.entries(sort || {});
    const SORT_COLUMNS = { id: "id", poojaName: "pooja_name", createdAt: "created_at", updatedAt: "updated_at" };
    const parts = [];
    for (const [key, direction] of entries) {
      const col = SORT_COLUMNS[key];
      if (!col) continue;
      const dir = direction === "DESC" || Number(direction) === -1
        ? "DESC"
        : (direction === "ASC" || Number(direction) === 1 ? "ASC" : null);
      if (!dir) continue;
      parts.push(`${col} ${dir}`);
    }
    return parts.length ? parts.join(", ") : "created_at ASC, id ASC";
  })();

  let sql = `SELECT ${REQUIREMENT_COLS.join(", ")} FROM pooja_material_requirements ${where} ORDER BY ${orderBy}`;
  if (Number.isInteger(Number(limit)) && Number(limit) > 0) sql += ` LIMIT ${Number(limit)}`;
  if (Number.isInteger(Number(offset)) && Number(offset) > 0) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => toDoc(row, await loadItems(row.id))));
};

// Mirrors poojaSettingsController.saveRequirement's
// findOneAndUpdate({ poojaName: poojaName.trim() }, { requiredMaterials: items },
// { new: true, upsert: true }): trims the KEY, replaces the whole array, and
// creates the document when no name matches. Only `poojaName` and
// `requiredMaterials` are ever written by that controller, so no other column is
// accepted here.
//
// Note the asymmetry this preserves: the KEY is trimmed (the controller does
// `poojaName.trim()` explicitly in the filter), while GET lookups are not.
const upsertByName = async (poojaName, materials) => {
  if (!dbConfig.isDbConnected()) {
    const trimmed = assertRequiredText(poojaName, "poojaName");
    return PoojaMaterialRequirement.findOneAndUpdate(
      { poojaName: trimmed },
      { requiredMaterials: materials || [] },
      { new: true, upsert: true }
    );
  }

  const key = assertRequiredText(poojaName, "poojaName");
  const existing = await query(
    `SELECT ${REQUIREMENT_COLS.join(", ")} FROM pooja_material_requirements WHERE pooja_name = $1 LIMIT 1`,
    [key]
  );
  const id = existing.rows[0] ? existing.rows[0].id : newId();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (existing.rows[0]) {
      await client.query("UPDATE pooja_material_requirements SET updated_at = now() WHERE id = $1", [id]);
    } else {
      await client.query(
        `INSERT INTO pooja_material_requirements (${REQUIREMENT_COLS.join(", ")})
         VALUES (${REQUIREMENT_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
        [id, key, new Date(), new Date()]
      );
    }
    await replaceItems(client, id, materials);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const { rows } = await query(
    `SELECT ${REQUIREMENT_COLS.join(", ")} FROM pooja_material_requirements WHERE id = $1 LIMIT 1`,
    [id]
  );
  return toDoc(rows[0], await loadItems(id));
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return PoojaMaterialRequirement.countDocuments(filter);
  const values = [];
  const conditions = [];
  if (filter.poojaName !== undefined && filter.poojaName !== null) {
    conditions.push(`pooja_name = $${values.length + 1}`);
    values.push(String(filter.poojaName));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM pooja_material_requirements ${where}`, values);
  return rows[0] ? rows[0].count : 0;
};

module.exports = {
  findOneByName,
  findMany,
  upsertByName,
  count,
};