const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Attendance = require("../models/Attendance");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

// Mirrors the enum declared in backend/src/models/Attendance.js exactly.
const STATUSES = new Set([
  "Present", "Absent", "Half Day", "Leave", "Pending",
  "Working", "Holiday", "Late", "Weekly Off", "Compensatory Off",
]);

// dateKey is a timezone-free 'YYYY-MM-DD' calendar key on every write path
// (attendanceController.toDateKey, leave.fromDate / toDate, shift assignment
// dateKey). The shape is enforced here and by the attendance_date_key_check
// constraint so the text contract the application relies on stays pinned.
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

// Mirrors Mongo's `required: true` on a trimmed String path: missing, null and
// whitespace-only values are all rejected (trim runs before the required check,
// so an all-whitespace String fails validation in Mongo too).
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

const assertDateKey = (value, label = "dateKey") => {
  const text = assertId(value, label);
  if (!DATE_KEY_PATTERN.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a YYYY-MM-DD calendar key`);
  }
  return text;
};

const ATTENDANCE_COLS = [
  "id", "staff_id", "staff_name", "employee_id", "staff_email", "date_key",
  "check_in", "check_out", "check_in_at", "check_out_at", "shift",
  "shift_start_time", "shift_end_time", "assignment_type", "duty_name",
  "duty_area", "status", "is_late_check_in", "working_minutes",
  "working_hours", "overtime_minutes", "overtime_hours", "is_overtime",
  "note", "source", "corrected_by", "correction_date", "correction_reason",
  "latitude", "longitude", "location_verified", "face_verified",
  "distance_from_temple", "device_info", "browser", "ip_address",
  "check_in_photo", "check_out_photo", "created_at", "updated_at",
];

// employee_id / staff_email are optional trimmed Strings with no default in
// Mongo: blank input collapses to NULL so an unset field reads back as
// undefined, exactly like an absent Mongo path.
const optionalText = (value) =>
  value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();

const toOptionalText = (value) =>
  value === null || value === undefined ? undefined : value;

const toOptionalNumber = (value) =>
  value === null || value === undefined ? undefined : Number(value);

// checkInAt / checkOutAt / correctionDate / latitude / longitude /
// distanceFromTemple all default to null in Mongo, so an unset value reads back
// as null rather than undefined.
const toNumberOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);

const toDateOrNull = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a date`);
  }
  return date;
};

// Mongoose applies each schema default whenever the field is absent, and no
// write path stores null on a defaulted path, so an absent value is stored as
// the schema's own default. That keeps the NOT NULL columns honest without
// changing any value the application can produce.
const textOrDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === "" ? fallback : text;
};

const numberOrDefault = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return value;
};

const booleanOrDefault = (value, fallback) =>
  value === undefined || value === null || value === "" ? fallback : Boolean(value);

// Converts an attendance row into the shape the application receives from
// Mongoose (camelCase, Mongo _id, unset optionals as undefined / null exactly
// as the schema defaults dictate).
const toDoc = (row) => {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    employeeId: toOptionalText(row.employee_id),
    staffEmail: toOptionalText(row.staff_email),
    dateKey: row.date_key,
    checkIn: row.check_in,
    checkOut: row.check_out,
    checkInAt: row.check_in_at === undefined ? null : row.check_in_at,
    checkOutAt: row.check_out_at === undefined ? null : row.check_out_at,
    shift: row.shift,
    shiftStartTime: row.shift_start_time,
    shiftEndTime: row.shift_end_time,
    assignmentType: row.assignment_type,
    dutyName: row.duty_name,
    dutyArea: row.duty_area,
    status: row.status,
    isLateCheckIn: Boolean(row.is_late_check_in),
    workingMinutes: Number(row.working_minutes),
    workingHours: row.working_hours,
    overtimeMinutes: Number(row.overtime_minutes),
    overtimeHours: row.overtime_hours,
    isOvertime: Boolean(row.is_overtime),
    note: row.note,
    source: row.source,
    correctedBy: row.corrected_by,
    correctionDate: row.correction_date === undefined ? null : row.correction_date,
    correctionReason: row.correction_reason,
    latitude: toNumberOrNull(row.latitude),
    longitude: toNumberOrNull(row.longitude),
    locationVerified: Boolean(row.location_verified),
    faceVerified: Boolean(row.face_verified),
    distanceFromTemple: toNumberOrNull(row.distance_from_temple),
    deviceInfo: row.device_info,
    browser: row.browser,
    ipAddress: row.ip_address,
    checkInPhoto: row.check_in_photo,
    checkOutPhoto: row.check_out_photo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own.
const toRow = (data, id = newId()) => ({
  id,
  staff_id: assertId(data.staffId, "staffId"),
  staff_name: assertId(data.staffName, "staffName"),
  employee_id: optionalText(data.employeeId),
  staff_email: optionalText(data.staffEmail),
  date_key: assertDateKey(data.dateKey),
  check_in: textOrDefault(data.checkIn, "--"),
  check_out: textOrDefault(data.checkOut, "--"),
  check_in_at: toDateOrNull(data.checkInAt, "checkInAt"),
  check_out_at: toDateOrNull(data.checkOutAt, "checkOutAt"),
  shift: textOrDefault(data.shift, "Morning"),
  shift_start_time: textOrDefault(data.shiftStartTime, ""),
  shift_end_time: textOrDefault(data.shiftEndTime, ""),
  assignment_type: textOrDefault(data.assignmentType, ""),
  duty_name: textOrDefault(data.dutyName, ""),
  duty_area: textOrDefault(data.dutyArea, ""),
  status: textOrDefault(data.status, "Absent"),
  is_late_check_in: booleanOrDefault(data.isLateCheckIn, false),
  working_minutes: numberOrDefault(data.workingMinutes, 0),
  working_hours: textOrDefault(data.workingHours, "--"),
  overtime_minutes: numberOrDefault(data.overtimeMinutes, 0),
  overtime_hours: textOrDefault(data.overtimeHours, "--"),
  is_overtime: booleanOrDefault(data.isOvertime, false),
  note: textOrDefault(data.note, ""),
  source: textOrDefault(data.source, "manual"),
  corrected_by: textOrDefault(data.correctedBy, ""),
  correction_date: toDateOrNull(data.correctionDate, "correctionDate"),
  correction_reason: textOrDefault(data.correctionReason, ""),
  latitude: toNumberOrNull(data.latitude),
  longitude: toNumberOrNull(data.longitude),
  location_verified: booleanOrDefault(data.locationVerified, false),
  face_verified: booleanOrDefault(data.faceVerified, false),
  distance_from_temple: toNumberOrNull(data.distanceFromTemple),
  device_info: textOrDefault(data.deviceInfo, ""),
  browser: textOrDefault(data.browser, ""),
  ip_address: textOrDefault(data.ipAddress, ""),
  check_in_photo: textOrDefault(data.checkInPhoto, ""),
  check_out_photo: textOrDefault(data.checkOutPhoto, ""),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns. The standing
// attendance orders are { dateKey: -1, createdAt: -1 } (both dashboards),
// { dateKey: -1 } (employee detail history) and { dateKey: 1 } (shift planner),
// so `date_key DESC, created_at DESC` is the default.
const SORT_COLUMNS = {
  staffId: "staff_id",
  staffName: "staff_name",
  employeeId: "employee_id",
  staffEmail: "staff_email",
  dateKey: "date_key",
  checkIn: "check_in",
  checkOut: "check_out",
  checkInAt: "check_in_at",
  checkOutAt: "check_out_at",
  shift: "shift",
  status: "status",
  workingMinutes: "working_minutes",
  overtimeMinutes: "overtime_minutes",
  source: "source",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "date_key DESC, created_at DESC";

// Resolves a Mongo sort object/key into a whitelisted ORDER BY clause. Every
// key is whitelisted (unknown keys are dropped) and the original direction is
// preserved, so a multi-key sort such as { dateKey: -1, createdAt: -1 } keeps
// its exact Mongo tie-breaking.
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

// Applies a Mongo comparison operator object ({ $in/$gte/$gt/$lte/$lt }) to a
// column, or an exact equality for a plain value, or IS NULL for an explicit
// null (Mongo `{ field: null }` also matches documents where the field is
// missing).
const pushComparison = (conditions, values, col, input, dateCol = false) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      pushIn(conditions, values, col, input.$in);
      return;
    }
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        pushCond(conditions, values, col, sqlOp, dateCol ? new Date(opVal) : opVal);
      }
    }
  } else if (input !== undefined && input !== null) {
    pushCond(conditions, values, col, "=", dateCol ? new Date(input) : input);
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  }
};

// The identifier/date columns the standing $or clauses match on. Attendance
// references no single table (see the migration header): the application
// matches the same person across { staffId, employeeId, staffEmail } with an
// $or, so each clause is translated to its column.
const OR_CLAUSE_COLUMNS = {
  staffId: "staff_id",
  employeeId: "employee_id",
  staffEmail: "staff_email",
  dateKey: "date_key",
  status: "status",
};

// Supports the filter surface the application actually uses against
// Attendance:
//   * { id } / { id: { $in: [...] } }
//   * { staffId } / { employeeId } / { staffEmail } / { dateKey } / { status }
//     / { shift } / { source } — equality or $in
//   * { status: { $in: [...] } } — enum-checked
//   * { dateKey: { $gte, $lte } } — the month/dashboard range scan
//   * { checkInAt } / { createdAt } / { updatedAt } range filters
//   * { isOvertime } / { isLateCheckIn } / { faceVerified } /
//     { locationVerified } booleans
//   * { $or: [ { staffId: { $in } }, { employeeId: { $in } },
//     { staffEmail: { $in } } ] } — buildAttendanceQuery and
//     getAttendanceForAssignment
const buildAttendanceFilter = (filter = {}) => {
  const conditions = [];
  const values = [];

  if (typeof filter.status === "object" && !Array.isArray(filter.status) && filter.status.$in) {
    assertEnumOrArray(filter.status.$in, STATUSES, "status.$in");
    pushIn(conditions, values, "status", filter.status.$in);
  } else if (filter.status) {
    assertEnum(filter.status, STATUSES, "status");
    pushCond(conditions, values, "status", "=", filter.status);
  }

  if (typeof filter.id === "object" && !Array.isArray(filter.id) && filter.id.$in) {
    pushIn(conditions, values, "id", filter.id.$in);
  } else if (filter.id) {
    pushCond(conditions, values, "id", "=", String(filter.id).trim());
  }

  for (const [key, col] of Object.entries(OR_CLAUSE_COLUMNS)) {
    if (key === "status") continue;
    pushComparison(conditions, values, col, filter[key]);
  }

  if (filter.shift !== undefined) pushComparison(conditions, values, "shift", filter.shift);
  if (filter.source !== undefined) pushComparison(conditions, values, "source", filter.source);

  // Mongo-style { $or: [...] } — the identity lookup shape used by
  // buildAttendanceQuery and getAttendanceForAssignment. The clauses are OR'd
  // inside one parenthesized group so the surrounding date filter still ANDs.
  const orConditions = Array.isArray(filter.$or) ? filter.$or : [];
  const orParts = [];
  for (const clause of orConditions) {
    if (!clause || typeof clause !== "object") continue;
    for (const [key, col] of Object.entries(OR_CLAUSE_COLUMNS)) {
      const input = clause[key];
      if (input === undefined) continue;
      if (key === "status") assertEnum(input, STATUSES, "status");
      if (input && typeof input === "object" && !Array.isArray(input) && input.$in !== undefined) {
        const vals = (Array.isArray(input.$in) ? input.$in : [input.$in])
          .filter((v) => v !== undefined && v !== null)
          .map((v) => String(v));
        if (vals.length) {
          orParts.push(`${col} IN (${vals.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
          values.push(...vals);
        } else {
          orParts.push("1 = 0");
        }
      } else if (input !== null) {
        orParts.push(`${col} = $${values.length + 1}`);
        values.push(String(input));
      } else {
        orParts.push(`${col} IS NULL`);
      }
    }
  }
  if (orParts.length) {
    conditions.push(`(${orParts.join(" OR ")})`);
  }

  pushComparison(conditions, values, "check_in_at", filter.checkInAt, true);
  pushComparison(conditions, values, "created_at", filter.createdAt, true);
  pushComparison(conditions, values, "updated_at", filter.updatedAt, true);

  for (const [key, col] of [["isOvertime", "is_overtime"], ["isLateCheckIn", "is_late_check_in"],
    ["faceVerified", "face_verified"], ["locationVerified", "location_verified"]]) {
    const input = filter[key];
    if (input === undefined || input === null || input === "") continue;
    pushCond(conditions, values, col, "=", Boolean(input));
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Attendance.findById(String(id));
  const { rows } = await query(`SELECT ${ATTENDANCE_COLS.join(", ")} FROM attendance WHERE id = $1 LIMIT 1`, [String(id)]);
  return toDoc(rows[0]);
};

const findOne = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Attendance.findOne(filter);
  const { where, values } = buildAttendanceFilter(filter);
  const { rows } = await query(
    `SELECT ${ATTENDANCE_COLS.join(", ")} FROM attendance ${where} ORDER BY date_key DESC, created_at DESC, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { dateKey: -1, createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Attendance.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildAttendanceFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${ATTENDANCE_COLS.join(", ")} FROM attendance ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const validate = (data) => {
  if (!data) throw new Error("Attendance data is required");
  assertId(data.staffId, "staffId");
  assertId(data.staffName, "staffName");
  assertDateKey(data.dateKey);
  assertEnum(data.status, STATUSES, "status");
  assertNumber(data.workingMinutes, "workingMinutes");
  assertNumber(data.overtimeMinutes, "overtimeMinutes");
  assertNumber(data.latitude, "latitude");
  assertNumber(data.longitude, "longitude");
  assertNumber(data.distanceFromTemple, "distanceFromTemple");
};

const create = async (data) => {
  validate(data);
  if (!dbConfig.isDbConnected()) {
    return Attendance.create(data);
  }
  const id = data.id || newId();
  const row = toRow(data, id);
  // A duplicate (staffId, dateKey) surfaces as a unique-constraint violation,
  // exactly as Mongoose raises a 11000 duplicate-key error for the Mongo unique
  // index. Nothing is silently replaced.
  await query(
    `INSERT INTO attendance (${ATTENDANCE_COLS.join(", ")})
     VALUES (${ATTENDANCE_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
    ATTENDANCE_COLS.map((col) => row[col])
  );
  return findById(id);
};

// Patches only the supplied fields, replicating the `attendanceDoc.save()` /
// `findByIdAndUpdate` semantics of the check-out and admin-correction flows.
// `undefined` leaves a column untouched; an explicit value is written, and an
// explicit null on a nullable column clears it (the correction path nulls
// checkInAt/checkOutAt when the clock string is cleared).
const updateById = async (id, updates = {}) => {
  if (!id) return null;
  if (updates.staffId !== undefined) assertId(updates.staffId, "staffId");
  if (updates.staffName !== undefined) assertId(updates.staffName, "staffName");
  if (updates.dateKey !== undefined) assertDateKey(updates.dateKey);
  assertEnum(updates.status, STATUSES, "status");
  assertNumber(updates.workingMinutes, "workingMinutes");
  assertNumber(updates.overtimeMinutes, "overtimeMinutes");
  assertNumber(updates.latitude, "latitude");
  assertNumber(updates.longitude, "longitude");
  assertNumber(updates.distanceFromTemple, "distanceFromTemple");

  if (!dbConfig.isDbConnected()) {
    return Attendance.findByIdAndUpdate(String(id), updates, { new: true });
  }

  const existing = await findById(id);
  if (!existing) return null;

  const fields = [];
  const values = [];
  const apply = (col, value) => {
    fields.push(`${col} = $${values.length + 1}`);
    values.push(value);
  };
  const applyRequiredText = (col, label, value) => apply(col, assertId(value, label));
  const applyOptionalText = (col, value) => apply(col, optionalText(value));
  const applyText = (col, value, fallback) => apply(col, textOrDefault(value, fallback));
  const applyNumber = (col, value) => apply(col, numberOrDefault(value, 0));
  const applyNullableNumber = (col, value) => apply(col, toNumberOrNull(value));
  const applyBoolean = (col, value) => apply(col, booleanOrDefault(value, false));
  const applyDate = (col, label, value) => apply(col, toDateOrNull(value, label));

  if (updates.staffId !== undefined) applyRequiredText("staff_id", "staffId", updates.staffId);
  if (updates.staffName !== undefined) applyRequiredText("staff_name", "staffName", updates.staffName);
  if (updates.employeeId !== undefined) applyOptionalText("employee_id", updates.employeeId);
  if (updates.staffEmail !== undefined) applyOptionalText("staff_email", updates.staffEmail);
  if (updates.dateKey !== undefined) apply("date_key", assertDateKey(updates.dateKey));
  if (updates.checkIn !== undefined) applyText("check_in", updates.checkIn, "--");
  if (updates.checkOut !== undefined) applyText("check_out", updates.checkOut, "--");
  if (updates.checkInAt !== undefined) applyDate("check_in_at", "checkInAt", updates.checkInAt);
  if (updates.checkOutAt !== undefined) applyDate("check_out_at", "checkOutAt", updates.checkOutAt);
  if (updates.shift !== undefined) applyText("shift", updates.shift, "Morning");
  if (updates.shiftStartTime !== undefined) applyText("shift_start_time", updates.shiftStartTime, "");
  if (updates.shiftEndTime !== undefined) applyText("shift_end_time", updates.shiftEndTime, "");
  if (updates.assignmentType !== undefined) applyText("assignment_type", updates.assignmentType, "");
  if (updates.dutyName !== undefined) applyText("duty_name", updates.dutyName, "");
  if (updates.dutyArea !== undefined) applyText("duty_area", updates.dutyArea, "");
  if (updates.status !== undefined) applyText("status", updates.status, "Absent");
  if (updates.isLateCheckIn !== undefined) applyBoolean("is_late_check_in", updates.isLateCheckIn);
  if (updates.workingMinutes !== undefined) applyNumber("working_minutes", updates.workingMinutes);
  if (updates.workingHours !== undefined) applyText("working_hours", updates.workingHours, "--");
  if (updates.overtimeMinutes !== undefined) applyNumber("overtime_minutes", updates.overtimeMinutes);
  if (updates.overtimeHours !== undefined) applyText("overtime_hours", updates.overtimeHours, "--");
  if (updates.isOvertime !== undefined) applyBoolean("is_overtime", updates.isOvertime);
  if (updates.note !== undefined) applyText("note", updates.note, "");
  if (updates.source !== undefined) applyText("source", updates.source, "manual");
  if (updates.correctedBy !== undefined) applyText("corrected_by", updates.correctedBy, "");
  if (updates.correctionDate !== undefined) applyDate("correction_date", "correctionDate", updates.correctionDate);
  if (updates.correctionReason !== undefined) applyText("correction_reason", updates.correctionReason, "");
  if (updates.latitude !== undefined) applyNullableNumber("latitude", updates.latitude);
  if (updates.longitude !== undefined) applyNullableNumber("longitude", updates.longitude);
  if (updates.locationVerified !== undefined) applyBoolean("location_verified", updates.locationVerified);
  if (updates.faceVerified !== undefined) applyBoolean("face_verified", updates.faceVerified);
  if (updates.distanceFromTemple !== undefined) applyNullableNumber("distance_from_temple", updates.distanceFromTemple);
  if (updates.deviceInfo !== undefined) applyText("device_info", updates.deviceInfo, "");
  if (updates.browser !== undefined) applyText("browser", updates.browser, "");
  if (updates.ipAddress !== undefined) applyText("ip_address", updates.ipAddress, "");
  if (updates.checkInPhoto !== undefined) applyText("check_in_photo", updates.checkInPhoto, "");
  if (updates.checkOutPhoto !== undefined) applyText("check_out_photo", updates.checkOutPhoto, "");

  if (values.length > 0) {
    fields.push("updated_at = now()");
    values.push(String(id));
    await query(`UPDATE attendance SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
  }
  return findById(id);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Attendance.countDocuments(filter);
  const { where, values } = buildAttendanceFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM attendance ${where}`, values);
  return rows[0]?.count || 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  count,
  validate,
  STATUSES,
};