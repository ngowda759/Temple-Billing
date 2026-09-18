const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const AttendanceSetting = require("../models/AttendanceSetting");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const COLUMNS = [
  "id",
  "temple_latitude",
  "temple_longitude",
  "allowed_radius",
  "late_threshold",
  "early_check_in_window",
  "created_at",
  "updated_at",
];

// The five persisted schema paths, in schema order. Every one of them is
// `required: true` WITH a `default`, so Mongoose fills the default on insert
// and never rejects an omitted value; narrowing to these keys keeps the
// repository identical to Mongoose strict mode for a caller that spreads a
// request body (the same rule every Phase 2 repository applies).
const PERSISTED_KEYS = [
  "templeLatitude",
  "templeLongitude",
  "allowedRadius",
  "lateThreshold",
  "earlyCheckInWindow",
];

// The schema defaults, mirrored exactly from backend/src/models/AttendanceSetting.js.
const DEFAULTS = {
  templeLatitude: 0,
  templeLongitude: 0,
  allowedRadius: 100,
  lateThreshold: 15,
  earlyCheckInWindow: 30,
};

// NUMERIC columns arrive from the driver as strings while the Mongoose model
// hands the application JS Numbers (attendanceController feeds them straight
// into the haversine maths and the settings page renders them), so every
// numeric column is converted back.
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    templeLatitude: Number(row.temple_latitude),
    templeLongitude: Number(row.temple_longitude),
    allowedRadius: Number(row.allowed_radius),
    lateThreshold: Number(row.late_threshold),
    earlyCheckInWindow: Number(row.early_check_in_window),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Mongoose casts these paths to Number; the repository mirrors the cast and
// rejects non-finite input with the same shape of error, exactly as
// attendanceController's callers experience it today.
const toNumberOr = (value, fallback, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  return num;
};

const pickPersisted = (data) => {
  const picked = {};
  for (const key of PERSISTED_KEYS) {
    if (data && data[key] !== undefined) picked[key] = data[key];
  }
  return picked;
};

// Builds the full column payload for an insert, applying the schema defaults.
const toRow = (data, id = newId()) => ({
  id,
  temple_latitude: toNumberOr(data.templeLatitude, DEFAULTS.templeLatitude, "templeLatitude"),
  temple_longitude: toNumberOr(data.templeLongitude, DEFAULTS.templeLongitude, "templeLongitude"),
  allowed_radius: toNumberOr(data.allowedRadius, DEFAULTS.allowedRadius, "allowedRadius"),
  late_threshold: toNumberOr(data.lateThreshold, DEFAULTS.lateThreshold, "lateThreshold"),
  early_check_in_window: toNumberOr(
    data.earlyCheckInWindow,
    DEFAULTS.earlyCheckInWindow,
    "earlyCheckInWindow"
  ),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

const validate = (data) => {
  const payload = pickPersisted(data || {});
  for (const key of PERSISTED_KEYS) {
    toNumberOr(payload[key], DEFAULTS[key], key);
  }
};

/**
 * Mirrors AttendanceSetting.findOne() — the single global settings document.
 *
 * The Mongo schema declares NO unique index here, so the singleton is an
 * application convention rather than a database constraint and several rows are
 * physically possible. `findOne()` resolves to the first document in natural
 * insertion order, which is reproduced here with
 * `ORDER BY created_at ASC, id ASC LIMIT 1` so the same document is returned on
 * both datasources.
 */
const findOne = async () => {
  if (!dbConfig.isDbConnected()) return AttendanceSetting.findOne();
  const { rows } = await query(
    `SELECT ${COLUMNS.join(", ")} FROM attendance_settings ORDER BY created_at ASC, id ASC LIMIT 1`
  );
  return toDoc(rows[0]);
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return AttendanceSetting.findById(String(id));
  const { rows } = await query(
    `SELECT ${COLUMNS.join(", ")} FROM attendance_settings WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// Mirrors the lazy materialisation both call sites perform
// (attendanceSettingsController.getSettings and attendanceController
// .markAttendance: `let settings = await AttendanceSetting.findOne();
// if (!settings) settings = await AttendanceSetting.create({})`). The insert
// carries the schema defaults, so a freshly created singleton is identical on
// either datasource.
const findOneOrCreate = async () => {
  const existing = await findOne();
  if (existing) return existing;
  return create({});
};

// Mirrors AttendanceSetting.create(payload). The INSERT is a single atomic
// statement, so a failure cannot leave a partial row behind.
const create = async (data) => {
  const payload = pickPersisted(data || {});
  validate(payload);

  if (!dbConfig.isDbConnected()) return AttendanceSetting.create(payload);

  const id = (data && data.id) || newId();
  const row = toRow(payload, id);
  await query(
    `INSERT INTO attendance_settings (${COLUMNS.join(", ")})
     VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
    COLUMNS.map((col) => row[col])
  );
  return findById(id);
};

// Field → column mapping used by the partial update. `undefined` and `null`
// both leave a column untouched, which is exactly what
// attendanceSettingsController.updateSettings relies on: it assigns
// `req.body.x ?? settings.x`, so an omitted OR null field keeps its stored
// value rather than falling back to the schema default.
const ASSIGNMENTS = {
  templeLatitude: ["temple_latitude", "templeLatitude"],
  templeLongitude: ["temple_longitude", "templeLongitude"],
  allowedRadius: ["allowed_radius", "allowedRadius"],
  lateThreshold: ["late_threshold", "lateThreshold"],
  earlyCheckInWindow: ["early_check_in_window", "earlyCheckInWindow"],
};

const updateById = async (id, updates = {}) => {
  if (!id) return null;

  const narrowed = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined || value === null) continue;
    if (!ASSIGNMENTS[key]) continue;
    narrowed[key] = value;
  }

  if (!dbConfig.isDbConnected()) {
    if (!Object.keys(narrowed).length) return AttendanceSetting.findById(String(id));
    return AttendanceSetting.findByIdAndUpdate(String(id), narrowed, { new: true });
  }

  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(narrowed)) {
    const [col, label] = ASSIGNMENTS[key];
    values.push(toNumberOr(value, DEFAULTS[key], label));
    setClauses.push(`${col} = $${values.length}`);
  }
  if (!setClauses.length) return findById(id);

  setClauses.push("updated_at = now()");
  values.push(String(id));
  await query(
    `UPDATE attendance_settings SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
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
