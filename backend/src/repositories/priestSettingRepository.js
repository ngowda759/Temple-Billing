const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const PriestSetting = require("../models/PriestSetting");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const COLUMNS = [
  "id",
  "priest_id",
  "sms_notifications",
  "duty_reminders",
  "calendar_widget",
  "agama_reference_module",
  "created_at",
  "updated_at",
];

// The four persisted preference paths. Each is a Boolean with a schema default,
// so Mongoose fills the default on insert and never rejects an omitted value;
// narrowing to these keys keeps the repository identical to Mongoose strict
// mode for a caller that spreads a request body.
const PERSISTED_KEYS = [
  "smsNotifications",
  "dutyReminders",
  "calendarWidget",
  "agamaReferenceModule",
];

// The schema defaults, mirrored exactly from backend/src/models/PriestSetting.js.
const DEFAULTS = {
  smsNotifications: true,
  dutyReminders: true,
  calendarWidget: true,
  agamaReferenceModule: false,
};

// priestId is `required: true` on an ObjectId path, so the repository accepts
// the 24-hex string form the application holds and rejects missing / blank
// values with the same "Path `priestId` is required" semantics.
const assertPriestId = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("priestId is required");
  }
  return String(value).trim();
};

// Mongoose's Boolean cast, reproduced exactly (verified against the model):
//   * any other value is Boolean(value), EXCEPT the exact strings 'false' and
//     '0', which cast to false. There is no trimming and no case folding, so
//     'FALSE', 'No', 'off' and '  false  ' all cast to true.
// A missing value falls back to the schema default, which is what Mongoose
// applies on insert.
const toBoolean = (value) => {
  if (typeof value === "string" && (value === "false" || value === "0")) return false;
  return Boolean(value);
};

// `undefined` means "not supplied", so the schema default applies. An explicit
// null is coerced to the schema default rather than written as NULL: every
// Phase 2 migration represents a Boolean path that declares a `default` as
// NOT NULL DEFAULT <default> (see notifications.viewed / read / emailSent), and
// no caller sends null here. This is the single documented divergence from
// Mongo, which would store null for a client that deliberately posts null.
const toBooleanOrDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return toBoolean(value);
};

const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    priestId: row.priest_id,
    smsNotifications: row.sms_notifications,
    dutyReminders: row.duty_reminders,
    calendarWidget: row.calendar_widget,
    agamaReferenceModule: row.agama_reference_module,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const pickPersisted = (data) => {
  const picked = {};
  for (const key of PERSISTED_KEYS) {
    if (data && data[key] !== undefined) picked[key] = data[key];
  }
  return picked;
};

const toRow = (data, id = newId()) => ({
  id,
  priest_id: assertPriestId(data.priestId),
  sms_notifications: toBooleanOrDefault(data.smsNotifications, DEFAULTS.smsNotifications),
  duty_reminders: toBooleanOrDefault(data.dutyReminders, DEFAULTS.dutyReminders),
  calendar_widget: toBooleanOrDefault(data.calendarWidget, DEFAULTS.calendarWidget),
  agama_reference_module: toBooleanOrDefault(
    data.agamaReferenceModule,
    DEFAULTS.agamaReferenceModule
  ),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const validate = (data) => {
  if (!data) throw new Error("PriestSetting data is required");
  assertPriestId(data.priestId);
  const payload = pickPersisted(data);
  for (const key of PERSISTED_KEYS) {
    toBooleanOrDefault(payload[key], DEFAULTS[key]);
  }
};

// A duplicate priestId surfaces as a unique-constraint violation (23505).
// priestController has no Mongo-11000 branch today (the schema's unique index
// is the only guard), but the code is re-mapped anyway so a duplicate can never
// be silently ignored or upserted on either datasource.
const rethrowDuplicatePriestId = (error) => {
  if (
    error &&
    error.code === "23505" &&
    /priest_settings_priest_id_key|priest_settings_priest_id/.test(
      error.constraint || error.message || ""
    )
  ) {
    error.code = 11000;
  }
  throw error;
};

/**
 * Mirrors PriestSetting.findOne({ priestId }) — the per-priest lookup used by
 * both priestController.getSettings and priestController.updateSettings.
 * Mongo's unique index on priestId means at most one row can match, so the
 * LIMIT 1 here is a formality that keeps the read identical in shape.
 */
const findOne = async (filter = {}) => {
  const priestId = filter.priestId;

  if (!dbConfig.isDbConnected()) return PriestSetting.findOne(filter);

  if (priestId === undefined || priestId === null || String(priestId).trim() === "") return null;
  const { rows } = await query(
    `SELECT ${COLUMNS.join(", ")} FROM priest_settings WHERE priest_id = $1 LIMIT 1`,
    [String(priestId).trim()]
  );
  return toDoc(rows[0]);
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return PriestSetting.findById(String(id));
  const { rows } = await query(
    `SELECT ${COLUMNS.join(", ")} FROM priest_settings WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// Mirrors the lazy materialisation in priestController.getSettings:
// `let settings = await PriestSetting.findOne({ priestId });
//  if (!settings) settings = await PriestSetting.create({ priestId })`.
const findOneOrCreate = async (priestId) => {
  const existing = await findOne({ priestId });
  if (existing) return existing;
  return create({ priestId });
};

const create = async (data) => {
  const payload = pickPersisted(data || {});
  const priestId = data && data.priestId;
  validate({ priestId, ...payload });

  if (!dbConfig.isDbConnected()) return PriestSetting.create({ priestId, ...payload });

  const id = (data && data.id) || newId();
  const row = toRow({ priestId, ...payload }, id);
  try {
    await query(
      `INSERT INTO priest_settings (${COLUMNS.join(", ")})
       VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
      COLUMNS.map((col) => row[col])
    );
  } catch (error) {
    rethrowDuplicatePriestId(error);
  }
  return findById(id);
};

// Field → column mapping for the partial update. priestController.updateSettings
// only assigns fields that are `!== undefined`, so an omitted toggle keeps its
// stored value and `false` is preserved (it is never treated as "absent").
const ASSIGNMENTS = {
  smsNotifications: "sms_notifications",
  dutyReminders: "duty_reminders",
  calendarWidget: "calendar_widget",
  agamaReferenceModule: "agama_reference_module",
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;

  // `undefined` and `null` both leave a toggle untouched. `undefined` matches
  // priestController's `!== undefined` guard; `null` is dropped because the
  // columns are NOT NULL with the schema default (the convention every Phase 2
  // migration follows for a Boolean path that declares a default) and because
  // resetting a toggle is not something any caller asks for. The settings UI
  // only ever sends real booleans, so this only diverges from Mongo for a
  // client that deliberately posts null — where Mongo would store null.
  const narrowed = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined || value === null) continue;
    if (!ASSIGNMENTS[key]) continue;
    narrowed[key] = value;
  }

  if (!dbConfig.isDbConnected()) {
    if (!Object.keys(narrowed).length) return PriestSetting.findById(String(id));
    return PriestSetting.findByIdAndUpdate(String(id), narrowed, { new: true });
  }

  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(narrowed)) {
    values.push(toBooleanOrDefault(value, DEFAULTS[key]));
    setClauses.push(`${ASSIGNMENTS[key]} = $${values.length}`);
  }
  if (!setClauses.length) return findById(id);

  setClauses.push("updated_at = now()");
  values.push(String(id));
  await query(
    `UPDATE priest_settings SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
    values
  );
  return findById(id);
};

module.exports = {
  DEFAULTS,
  validate,
  findOne,
  findById,
  findOneOrCreate,
  create,
  updateById,
};
