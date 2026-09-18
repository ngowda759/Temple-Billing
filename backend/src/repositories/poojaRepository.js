const { query, getPool } = require("../config/postgres");
const dbConfig = require("../config/db");
const Pooja = require("../models/Pooja");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enums declared in backend/src/models/Pooja.js exactly.
const STATUSES = new Set(["Active", "Inactive"]);
const MATERIAL_SOURCES = new Set(["TEMPLE_INVENTORY", "EXTERNAL_OR_DEVOTEE"]);
const RESPONSIBILITY_TYPES = new Set([
  "TEMPLE_PROVIDES", "DEVOTEE_MUST_BRING", "DEVOTEE_PREPARATION_REQUIRED", "DEVOTEE_OR_TEMPLE",
]);

// The schema's own default for availableDays. It is a Mongoose-level default
// (applied when the field is absent from a create payload), not a column
// default, so it is applied here on write — same split migration 019 used for
// rooms.amenities.
const DEFAULT_AVAILABLE_DAYS = ["Everyday"];

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertRequiredText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// Mirrors Mongo's `required: true` on an UNTRIMMED String path (itemName/unit on
// the embedded sub-schema declare no `trim`): only a null/undefined value is
// rejected — an empty or whitespace-only string is persisted by Mongoose today
// (verified: `{ itemName: "  " }` validates cleanly while `{ itemName: "" }`
// fails the required check because '' is falsy).
const assertRequiredRawText = (value, label) => {
  if (value === undefined || value === null) throw new Error(`${label} is required`);
  const text = String(value);
  if (text === "") throw new Error(`${label} is required`);
  return text;
};

// Mongoose casts numeric paths with Number() and raises a CastError on anything
// non-numeric. `min` is checked separately so the two failures stay distinct.
const toNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  return num;
};

// Mirrors the required numeric paths (price, qty): a missing/null/'' value fails
// the required check, anything non-numeric fails the cast.
const assertRequiredNumber = (value, label) => {
  const num = toNumber(value, label);
  if (num === null) throw new Error(`${label} is required`);
  return num;
};

// price is `{ type: Number, required: true, min: 0 }`.
const assertRequiredMoneyMinZero = (value, label) => {
  const num = assertRequiredNumber(value, label);
  if (num < 0) throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0`);
  return num;
};

// Mongoose casts Boolean paths with Boolean(), so any truthy/falsy value is
// accepted. Defaulted paths are NOT NULL in PostgreSQL, so a null collapses to
// the schema default (the same choice roomRepository makes for its defaulted
// columns) rather than writing a null the column would reject.
const toBoolean = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
};

// Mongoose casts a [String] path by mapping every element through String() and
// preserving the supplied order. A bare scalar is accepted and becomes a
// one-element array (verified: `{ rules: "R1" }` stores ["R1"]). A null array is
// preserved as null by the Mongoose cast, but the columns are NOT NULL, so it
// collapses to the empty array — the same choice roomRepository.amenities made.
const toTextArray = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => (entry === undefined || entry === null ? null : String(entry)));
};

// ObjectId paths cast a 24-char hex string (or an ObjectId-like value whose
// toString yields one) and raise a CastError otherwise. A non-hex value is
// rejected rather than silently stored, because Mongoose rejects it too.
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

// Defaulted trimmed Strings (description / duration / dressCode): absent and null
// both take the schema default ''.
const trimmedOrDefault = (value) => (value === undefined || value === null ? "" : String(value).trim());

// Defaulted untrimmed Strings (availableStartTime / availableEndTime): absent and
// null both take the schema default ''.
const rawOrDefault = (value) => (value === undefined || value === null ? "" : String(value));

const POOJA_COLS = [
  "id", "name", "description", "price", "duration", "available_days",
  "available_dates", "available_start_time", "available_end_time",
  "minimum_advance_booking_days", "strict_advance_preparation", "rules",
  "instructions", "dress_code", "status", "created_at", "updated_at",
];

const MATERIAL_COLS = [
  "id", "pooja_id", "position", "item", "material_source", "item_name", "qty",
  "unit", "responsibility_type", "preparation_days_before_pooja",
  "preparation_instructions", "requires_advance_collection",
  "collection_instructions", "mandatory", "temple_charge", "created_at",
  "updated_at",
];

// Converts a pooja_required_materials row into the shape the application
// receives from a Mongoose sub-document (camelCase, Mongo _id).
const toMaterialDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    item: row.item === null || row.item === undefined ? undefined : row.item,
    materialSource: row.material_source,
    itemName: row.item_name,
    qty: row.qty === null || row.qty === undefined ? undefined : Number(row.qty),
    unit: row.unit,
    responsibilityType: row.responsibility_type,
    preparationDaysBeforePooja: row.preparation_days_before_pooja === null || row.preparation_days_before_pooja === undefined
      ? undefined
      : Number(row.preparation_days_before_pooja),
    preparationInstructions: row.preparation_instructions,
    requiresAdvanceCollection: row.requires_advance_collection,
    collectionInstructions: row.collection_instructions,
    mandatory: row.mandatory,
    templeCharge: row.temple_charge === null || row.temple_charge === undefined ? undefined : Number(row.temple_charge),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Converts a poojas row into the shape the application receives from Mongoose
// (camelCase, Mongo _id, embedded requiredMaterials array).
const toDoc = (row, requiredMaterials = []) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price === null || row.price === undefined ? undefined : Number(row.price),
    duration: row.duration,
    availableDays: row.available_days || [],
    availableDates: row.available_dates || [],
    availableStartTime: row.available_start_time,
    availableEndTime: row.available_end_time,
    minimumAdvanceBookingDays: row.minimum_advance_booking_days === null || row.minimum_advance_booking_days === undefined
      ? undefined
      : Number(row.minimum_advance_booking_days),
    strictAdvancePreparation: row.strict_advance_preparation,
    requiredMaterials: Array.isArray(requiredMaterials) ? requiredMaterials : [],
    rules: row.rules || [],
    instructions: row.instructions || [],
    dressCode: row.dress_code,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// The persisted key set, exactly as the strict Mongoose schema defines it. The
// controllers spread `req.body` into the model, so unknown keys are silently
// discarded by Mongoose's strict mode — the repository discards them too.
const PERSISTED_KEYS = [
  "name", "description", "price", "duration", "availableDays", "availableDates",
  "availableStartTime", "availableEndTime", "minimumAdvanceBookingDays",
  "strictAdvancePreparation", "requiredMaterials", "rules", "instructions",
  "dressCode", "status", "createdAt", "updatedAt",
];

const MATERIAL_KEYS = [
  "id", "_id", "item", "materialSource", "itemName", "qty", "unit",
  "responsibilityType", "preparationDaysBeforePooja", "preparationInstructions",
  "requiresAdvanceCollection", "collectionInstructions", "mandatory",
  "templeCharge", "createdAt", "updatedAt",
];

const pickPersisted = (data) => {
  const picked = {};
  for (const key of PERSISTED_KEYS) {
    if (data[key] !== undefined) picked[key] = data[key];
  }
  return picked;
};

// Normalizes one embedded requiredMaterials entry. Mongoose applies the
// sub-schema defaults while casting, so the defaults below are the sub-schema's
// own. The four defaulted paths are NOT NULL columns, so a null collapses to its
// default; item and the required text/number paths keep the same
// required/cast rules Mongoose applies.
const toMaterialRow = (data, poojaId, position, id = newId()) => {
  const entry = data || {};
  return {
    id: entry.id || entry._id || id,
    pooja_id: poojaId,
    position,
    item: toObjectIdText(entry.item, "requiredMaterials.item"),
    material_source: entry.materialSource === undefined || entry.materialSource === null || entry.materialSource === ""
      ? "TEMPLE_INVENTORY"
      : String(entry.materialSource),
    item_name: assertRequiredRawText(entry.itemName, "requiredMaterials.itemName"),
    qty: assertRequiredNumber(entry.qty, "requiredMaterials.qty"),
    unit: assertRequiredRawText(entry.unit, "requiredMaterials.unit"),
    responsibility_type: entry.responsibilityType === undefined || entry.responsibilityType === null || entry.responsibilityType === ""
      ? "TEMPLE_PROVIDES"
      : String(entry.responsibilityType),
    preparation_days_before_pooja: toNumber(entry.preparationDaysBeforePooja, "requiredMaterials.preparationDaysBeforePooja") ?? 0,
    preparation_instructions: entry.preparationInstructions === undefined || entry.preparationInstructions === null
      ? ""
      : String(entry.preparationInstructions),
    requires_advance_collection: toBoolean(entry.requiresAdvanceCollection, false),
    collection_instructions: entry.collectionInstructions === undefined || entry.collectionInstructions === null
      ? ""
      : String(entry.collectionInstructions),
    mandatory: toBoolean(entry.mandatory, false),
    temple_charge: toNumber(entry.templeCharge, "requiredMaterials.templeCharge") ?? 0,
    created_at: entry.createdAt || new Date(),
    updated_at: entry.updatedAt || new Date(),
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  name: assertRequiredText(data.name, "name"),
  description: trimmedOrDefault(data.description),
  price: assertRequiredMoneyMinZero(data.price, "price"),
  duration: trimmedOrDefault(data.duration),
  available_days: toTextArray(data.availableDays, DEFAULT_AVAILABLE_DAYS),
  available_dates: toTextArray(data.availableDates, []),
  available_start_time: rawOrDefault(data.availableStartTime),
  available_end_time: rawOrDefault(data.availableEndTime),
  minimum_advance_booking_days: toNumber(data.minimumAdvanceBookingDays, "minimumAdvanceBookingDays") ?? 0,
  strict_advance_preparation: toBoolean(data.strictAdvancePreparation, false),
  rules: toTextArray(data.rules, []),
  instructions: toTextArray(data.instructions, []),
  dress_code: trimmedOrDefault(data.dressCode),
  status: data.status === undefined || data.status === null || data.status === "" ? "Active" : String(data.status),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Mirrors new Pooja(payload).save() / findByIdAndUpdate(..., { runValidators:
// true }). Mongoose validates the whole document on create and every modified
// path on update, so both branches run the same checks here.
const validate = (data) => {
  if (!data) throw new Error("Pooja data is required");
  assertRequiredText(data.name, "name");
  assertRequiredMoneyMinZero(data.price, "price");
  assertEnum(data.status, STATUSES, "status");
  toTextArray(data.availableDays, []);
  toTextArray(data.availableDates, []);
  toTextArray(data.rules, []);
  toTextArray(data.instructions, []);
  toNumber(data.minimumAdvanceBookingDays, "minimumAdvanceBookingDays");
  for (const entry of data.requiredMaterials || []) {
    toMaterialRow(entry, "validation", 0);
  }
};

const loadMaterials = async (poojaId) => {
  const { rows } = await query(
    `SELECT ${MATERIAL_COLS.join(", ")} FROM pooja_required_materials WHERE pooja_id = $1 ORDER BY position ASC, id ASC`,
    [String(poojaId)]
  );
  return rows.map(toMaterialDoc);
};

// Replaces the whole embedded array, exactly as a Mongoose $set on the array
// path does (the settings controller relies on that replace-don't-append
// behaviour). Accepts a transaction client so a parent write and its children
// commit together — the child rows are part of the parent document.
const replaceMaterials = async (client, poojaId, materials) => {
  await client.query("DELETE FROM pooja_required_materials WHERE pooja_id = $1", [String(poojaId)]);
  const list = Array.isArray(materials) ? materials : [];
  for (let index = 0; index < list.length; index += 1) {
    const row = toMaterialRow(list[index], poojaId, index);
    await client.query(
      `INSERT INTO pooja_required_materials (${MATERIAL_COLS.join(", ")})
       VALUES (${MATERIAL_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
      MATERIAL_COLS.map((col) => row[col])
    );
  }
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Pooja.findById(String(id));
  const { rows } = await query(`SELECT ${POOJA_COLS.join(", ")} FROM poojas WHERE id = $1 LIMIT 1`, [String(id)]);
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadMaterials(rows[0].id));
};

// Supports the filter surface the application actually uses against Pooja:
//   * { id }                          — findById
//   * { name }                        — Pooja.findOne({ name }) in
//                                       poojaBookingController, devoteeController
//                                       (twice) and priestController
//   * { name: { $in: [...] } }        — supported for parity with the other
//                                       repositories' filter translation
//   * { status } / { status: { $in: [...] } } — supported for the same reason
//                                       (no current caller filters by status)
//
// Name lookups are NOT trimmed here: Mongoose does not apply `trim` setters to
// query values (verified — findOne({ name: "  X  " }) sends the raw string), so
// a whitespace-padded lookup finds nothing against a stored trimmed name. The
// filter reproduces that exactly instead of "helpfully" trimming.
const buildPoojaFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  const pushIn = (col, list) => {
    const items = (Array.isArray(list) ? list : [list])
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => String(entry));
    if (!items.length) {
      // Mongo $in: [] matches no documents (an instant-false predicate).
      conditions.push("1 = 0");
      return;
    }
    conditions.push(`${col} IN (${items.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
    values.push(...items);
  };

  if (typeof filter.id === "object" && filter.id !== null && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn("id", filter.id.$in);
  } else if (filter.id !== undefined && filter.id !== null) {
    conditions.push(`id = $${values.length + 1}`);
    values.push(String(filter.id));
  }

  if (typeof filter.name === "object" && filter.name !== null && !Array.isArray(filter.name) && filter.name.$in) {
    pushIn("name", filter.name.$in);
  } else if (filter.name !== undefined && filter.name !== null) {
    conditions.push(`name = $${values.length + 1}`);
    values.push(String(filter.name));
  }

  if (typeof filter.status === "object" && filter.status !== null && !Array.isArray(filter.status) && filter.status.$in) {
    for (const entry of filter.status.$in) assertEnum(entry, STATUSES, "status");
    pushIn("status", filter.status.$in);
  } else if (filter.status !== undefined && filter.status !== null) {
    assertEnum(filter.status, STATUSES, "status");
    conditions.push(`status = $${values.length + 1}`);
    values.push(filter.status);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

// The only standing Pooja sort in the codebase is absent: getAllPoojas runs
// Pooja.find({}) with no sort. Mongo's natural order is unspecified, so the
// deterministic stand-in is createdAt ASC, id ASC (idx_poojas_created_at).
const DEFAULT_ORDER = "created_at ASC, id ASC";

const SORT_COLUMNS = {
  id: "id",
  name: "name",
  price: "price",
  status: "status",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const resolveOrderBy = (sort) => {
  const entries = typeof sort === "string" ? [[sort, 1]] : Object.entries(sort || {});
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
  return parts.length ? parts.join(", ") : DEFAULT_ORDER;
};

const findMany = async (options = {}) => {
  const { filter = {}, sort, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = sort ? Pooja.find(filter).sort(sort) : Pooja.find(filter);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildPoojaFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${POOJA_COLS.join(", ")} FROM poojas ${where} ORDER BY ${orderBy}`;
  if (Number.isInteger(Number(limit)) && Number(limit) > 0) sql += ` LIMIT ${Number(limit)}`;
  if (Number.isInteger(Number(offset)) && Number(offset) > 0) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return Promise.all(rows.map(async (row) => toDoc(row, await loadMaterials(row.id))));
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Pooja.findOne(filter);
  const { where, values } = buildPoojaFilter(filter);
  const { rows } = await query(
    `SELECT ${POOJA_COLS.join(", ")} FROM poojas ${where} ORDER BY ${DEFAULT_ORDER} LIMIT 1`,
    values
  );
  if (!rows[0]) return null;
  return toDoc(rows[0], await loadMaterials(rows[0].id));
};

// Mirrors new Pooja(req.body) → save(). The payload is narrowed to the strict
// schema's persisted key set first, so unknown body keys behave exactly as they
// do under Mongoose's strict mode. The parent row and its embedded
// requiredMaterials rows are one document in Mongo, so they are written in a
// single transaction — a failure cannot leave half a Pooja behind.
const create = async (data) => {
  if (!dbConfig.isDbConnected()) return Pooja.create(pickPersisted(data || {}));

  const payload = pickPersisted(data || {});
  validate(payload);
  const id = (data && data.id) || newId();
  const row = toRow(payload, id);
  const materials = Array.isArray(payload.requiredMaterials) ? payload.requiredMaterials : [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO poojas (${POOJA_COLS.join(", ")})
       VALUES (${POOJA_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      POOJA_COLS.map((col) => row[col])
    );
    await replaceMaterials(client, id, materials);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return findById(id);
};

// Field → column mapping used by every partial update, so the assignment rules
// are declared once. Each coercion mirrors the corresponding Mongoose cast +
// validator (runValidators runs on every modified path of this update).
const ASSIGNMENTS = {
  name: ["name", (v) => assertRequiredText(v, "name")],
  description: ["description", trimmedOrDefault],
  price: ["price", (v) => assertRequiredMoneyMinZero(v, "price")],
  duration: ["duration", trimmedOrDefault],
  availableDays: ["available_days", (v) => toTextArray(v, [])],
  availableDates: ["available_dates", (v) => toTextArray(v, [])],
  availableStartTime: ["available_start_time", rawOrDefault],
  availableEndTime: ["available_end_time", rawOrDefault],
  minimumAdvanceBookingDays: ["minimum_advance_booking_days", (v) => toNumber(v, "minimumAdvanceBookingDays") ?? 0],
  strictAdvancePreparation: ["strict_advance_preparation", (v) => toBoolean(v, false)],
  rules: ["rules", (v) => toTextArray(v, [])],
  instructions: ["instructions", (v) => toTextArray(v, [])],
  dressCode: ["dress_code", trimmedOrDefault],
  status: ["status", (v) => {
    assertEnum(v, STATUSES, "status");
    return v;
  }],
};

// Mirrors the controllers' findByIdAndUpdate(id, req.body, { new: true,
// runValidators: true }) flow (poojaController.updatePooja). Fields absent from
// `updates` are left untouched; an explicit undefined is skipped exactly as
// Mongoose skips an undefined assignment. `requiredMaterials` is handled
// separately because it is an embedded array (a $set replaces it wholesale).
const updateById = async (id, updates = {}) => {
  if (!id) return null;

  const narrowed = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    if (key === "requiredMaterials") {
      narrowed[key] = value;
      continue;
    }
    if (!ASSIGNMENTS[key]) continue;
    narrowed[key] = value;
  }

  if (!dbConfig.isDbConnected()) {
    return Pooja.findByIdAndUpdate(String(id), narrowed, { new: true, runValidators: true });
  }

  const existing = await findById(id);
  if (!existing?._id) return null;

  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(narrowed)) {
    if (key === "requiredMaterials") continue;
    const [col, coerce] = ASSIGNMENTS[key];
    setClauses.push(`${col} = $${values.length + 1}`);
    values.push(coerce(value));
  }

  const hasMaterials = Object.prototype.hasOwnProperty.call(narrowed, "requiredMaterials");
  if (!setClauses.length && !hasMaterials) return existing;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (setClauses.length) {
      setClauses.push(`updated_at = now()`);
      const idPlaceholder = `$${values.length + 1}`;
      await client.query(
        `UPDATE poojas SET ${setClauses.join(", ")} WHERE id = ${idPlaceholder}`,
        [...values, String(id)]
      );
    } else {
      await client.query("UPDATE poojas SET updated_at = now() WHERE id = $1", [String(id)]);
    }
    if (hasMaterials) {
      await replaceMaterials(client, id, narrowed.requiredMaterials);
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

// Mirrors Pooja.findByIdAndDelete(id) — a hard delete. The embedded
// requiredMaterials rows go with the document via ON DELETE CASCADE.
const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Pooja.findByIdAndDelete(String(id));
  const existing = await findById(id);
  if (!existing) return null;
  await query("DELETE FROM poojas WHERE id = $1", [String(id)]);
  return existing;
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Pooja.countDocuments(filter);
  const { where, values } = buildPoojaFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM poojas ${where}`, values);
  return rows[0] ? rows[0].count : 0;
};

module.exports = {
  STATUSES,
  MATERIAL_SOURCES,
  RESPONSIBILITY_TYPES,
  validate,
  findById,
  findOne,
  findMany,
  create,
  updateById,
  destroy,
  count,
};
