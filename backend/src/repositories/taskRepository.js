const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Task = require("../models/Task");
const crypto = require("crypto");

const newId = () => crypto.randomBytes(12).toString("hex");

const TASK_COLS = [
  "id", "assignment_type", "shift_id", "shift_name", "shift_start_time",
  "shift_end_time", "date_key", "start_time", "end_time", "staff_id",
  "staff_name", "employee_id", "staff_email", "duty_name", "title",
  "description", "due_date", "duty", "area", "duty_area", "time",
  "reporting_time", "assigned_by", "supervisor", "priority", "working_hours",
  "status", "attendance_status", "conflict", "reason", "notes",
  "required_staff", "duration_minutes", "accepted_at", "rejected_at",
  "rejection_reason", "completed_at", "completion_remarks",
  "completion_duration", "created_at", "updated_at",
];

// Mirrors the Mongoose `required: true` check on a trimmed String path: missing,
// null and whitespace-only values are all rejected (trim runs before the
// required check in Mongo, so an all-whitespace String fails there too).
const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

// requiredStaff / durationMinutes / completionDuration are bare Numbers with no
// min in the Mongo schema, so only finiteness is checked and fractional values
// are preserved.
const assertNumber = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// Every defaulted column is NOT NULL and no write path stores null on one, so an
// absent value falls back to the schema's own default. This keeps the columns
// honest without changing any value the application can produce.
const textOrDefault = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === "" ? fallback : text;
};

// DISTINCT FROM textOrDefault: several Task paths have NO default in the Mongoose
// schema (shiftId, employeeId, staffEmail, title, description, dueDate), so an
// absent value must stay NULL rather than become a fallback string. An empty
// string is preserved verbatim because Mongo would store it verbatim too.
const optionalText = (value) => {
  if (value === undefined || value === null) return null;
  return String(value);
};

// trimmedOrNull mirrors a String path the schema declares with trim but no
// default: a supplied value is trimmed, an absent one stays NULL.
const trimmedOrNull = (value) => {
  if (value === undefined || value === null) return null;
  return String(value).trim();
};

const numberOrDefault = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return Number(value);
};

const toDateOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Converts a tasks row into the shape the application receives from Mongoose
// (camelCase, Mongo _id, NUMERIC read back as a Number, absent optional columns
// read back as undefined exactly as a schemaless Mongo read returns).
const toDoc = (row) => {
  if (!row) return null;
  const num = (value) => (value === null || value === undefined ? undefined : Number(value));
  const opt = (value) => (value === null || value === undefined ? undefined : value);
  return {
    _id: row.id,
    id: row.id,
    assignmentType: row.assignment_type,
    shiftId: opt(row.shift_id),
    shiftName: row.shift_name,
    shiftStartTime: row.shift_start_time,
    shiftEndTime: row.shift_end_time,
    dateKey: row.date_key,
    startTime: row.start_time,
    endTime: row.end_time,
    staffId: row.staff_id,
    staffName: row.staff_name,
    employeeId: opt(row.employee_id),
    staffEmail: opt(row.staff_email),
    dutyName: row.duty_name,
    title: opt(row.title),
    description: opt(row.description),
    dueDate: opt(row.due_date),
    duty: row.duty,
    area: row.area,
    dutyArea: row.duty_area,
    time: row.time,
    reportingTime: row.reporting_time,
    assignedBy: row.assigned_by,
    supervisor: row.supervisor,
    priority: row.priority,
    workingHours: row.working_hours,
    status: row.status,
    attendanceStatus: row.attendance_status,
    conflict: row.conflict,
    reason: row.reason,
    notes: row.notes,
    requiredStaff: num(row.required_staff),
    durationMinutes: num(row.duration_minutes),
    acceptedAt: opt(row.accepted_at),
    rejectedAt: opt(row.rejected_at),
    rejectionReason: opt(row.rejection_reason),
    completedAt: opt(row.completed_at),
    completionRemarks: row.completion_remarks,
    completionDuration: num(row.completion_duration),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Builds the full column payload for an insert. Every persisted Mongo field is
// mapped and the defaults are the schema's own. Fields the schema does not
// declare (employeeName, employeeEmail, category, role, compensation,
// assignedPriest) are deliberately absent so Mongoose strict-mode behaviour is
// preserved rather than silently widened.
const toRow = (data, id = newId()) => ({
  id,
  assignment_type: textOrDefault(data.assignmentType, "Duty & Shift"),
  shift_id: optionalText(data.shiftId),
  shift_name: textOrDefault(data.shiftName, ""),
  shift_start_time: textOrDefault(data.shiftStartTime, ""),
  shift_end_time: textOrDefault(data.shiftEndTime, ""),
  date_key: textOrDefault(data.dateKey, ""),
  start_time: textOrDefault(data.startTime, ""),
  end_time: textOrDefault(data.endTime, ""),
  staff_id: assertId(data.staffId, "staffId"),
  staff_name: assertId(data.staffName, "staffName"),
  employee_id: optionalText(data.employeeId),
  // Mongoose's `lowercase: true` setter is reproduced explicitly.
  staff_email: data.staffEmail === undefined || data.staffEmail === null
    ? null
    : String(data.staffEmail).trim().toLowerCase(),
  duty_name: textOrDefault(data.dutyName, ""),
  title: optionalText(data.title),
  description: optionalText(data.description),
  due_date: optionalText(data.dueDate),
  duty: assertId(data.duty, "duty"),
  area: assertId(data.area, "area"),
  duty_area: textOrDefault(data.dutyArea, ""),
  time: assertId(data.time, "time"),
  reporting_time: textOrDefault(data.reportingTime, ""),
  assigned_by: assertId(data.assignedBy, "assignedBy"),
  supervisor: textOrDefault(data.supervisor, ""),
  priority: textOrDefault(data.priority, "Medium"),
  working_hours: textOrDefault(data.workingHours, ""),
  status: textOrDefault(data.status, "Pending"),
  attendance_status: textOrDefault(data.attendanceStatus, "Pending"),
  conflict: data.conflict === undefined || data.conflict === null ? false : Boolean(data.conflict),
  reason: textOrDefault(data.reason, ""),
  notes: textOrDefault(data.notes, ""),
  required_staff: numberOrDefault(data.requiredStaff, 1),
  duration_minutes: numberOrDefault(data.durationMinutes, 0),
  accepted_at: toDateOrNull(data.acceptedAt),
  rejected_at: toDateOrNull(data.rejectedAt),
  rejection_reason: trimmedOrNull(data.rejectionReason),
  completed_at: toDateOrNull(data.completedAt),
  completion_remarks: textOrDefault(data.completionRemarks, ""),
  completion_duration: numberOrDefault(data.completionDuration, 0),
  created_at: data.createdAt || new Date(),
  updated_at: data.updatedAt || new Date(),
});

// Whitelisted sort columns mirroring the actual query patterns: { createdAt: -1 },
// { dateKey: 1, startTime: 1 }, { dueDate: 1, time: 1, createdAt: -1 } and
// { dueDate: -1, createdAt: -1 }. Unknown keys are dropped.
const SORT_COLUMNS = {
  assignmentType: "assignment_type",
  shiftId: "shift_id",
  dateKey: "date_key",
  startTime: "start_time",
  endTime: "end_time",
  staffId: "staff_id",
  dutyName: "duty_name",
  dueDate: "due_date",
  time: "time",
  priority: "priority",
  status: "status",
  attendanceStatus: "attendance_status",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const DEFAULT_ORDER = "created_at DESC";

// Resolves a Mongo sort object into a whitelisted ORDER BY clause. The original
// direction is preserved and `id ASC` is always appended by the callers so the
// ordering is total (Mongo's ordering among equal keys is unspecified; a stable
// tie-break keeps pagination and the LIMIT-1 lookups deterministic).
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

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every Task column the application filters on, and its SQL type class. TEXT
// columns are compared as bound text (preserving the lexicographic semantics the
// application relies on for dateKey/dueDate), dateCol marks the real
// TIMESTAMPTZ columns.
const TEXT_COLUMNS = {
  assignmentType: "assignment_type",
  shiftId: "shift_id",
  shiftName: "shift_name",
  dateKey: "date_key",
  startTime: "start_time",
  endTime: "end_time",
  staffId: "staff_id",
  staffName: "staff_name",
  employeeId: "employee_id",
  staffEmail: "staff_email",
  dutyName: "duty_name",
  title: "title",
  dueDate: "due_date",
  duty: "duty",
  area: "area",
  dutyArea: "duty_area",
  time: "time",
  reportingTime: "reporting_time",
  assignedBy: "assigned_by",
  supervisor: "supervisor",
  priority: "priority",
  workingHours: "working_hours",
  status: "status",
  attendanceStatus: "attendance_status",
  reason: "reason",
  notes: "notes",
};

const DATE_COLUMNS = {
  acceptedAt: "accepted_at",
  rejectedAt: "rejected_at",
  completedAt: "completed_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  conflict: "conflict",
};

// Applies a Mongo operator object ({ $in/$nin/$gte/$gt/$lte/$lt/$ne/$regex }) to a
// column, an exact equality for a plain value, or IS NULL for an explicit null
// (Mongo `{ field: null }` also matches documents where the field is missing).
const pushCondition = (conditions, values, col, input, dateCol = false) => {
  if (input instanceof RegExp) {
    // getAvailablePriestsForTransfer queries
    // { dateKey: { $regex: new RegExp(date, "i") } }, i.e. an unanchored
    // case-insensitive substring match. The pattern is never interpolated into
    // SQL: the regex source is reduced to a literal and matched with ILIKE.
    const source = input.source.replace(/^\^|\$$/g, "");
    values.push(`%${escapeRegex(source)}%`);
    conditions.push(
      `${col} ${input.ignoreCase ? "ILIKE" : "LIKE"} $${values.length} ESCAPE '\\'`
    );
    return;
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.$in !== undefined) {
      const list = (Array.isArray(input.$in) ? input.$in : [input.$in])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => (dateCol ? new Date(v) : String(v)));
      if (list.length) {
        conditions.push(`${col} IN (${list.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
        values.push(...list);
      } else {
        // Mongo $in: [] matches no documents (an instant-false predicate).
        conditions.push("1 = 0");
      }
      return;
    }
    if (input.$nin !== undefined) {
      const list = (Array.isArray(input.$nin) ? input.$nin : [input.$nin])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => (dateCol ? new Date(v) : String(v)));
      if (list.length) {
        conditions.push(`(${col} IS NULL OR ${col} NOT IN (${list.map((_, i) => `$${values.length + i + 1}`).join(", ")}))`);
        values.push(...list);
      }
      // Mongo $nin: [] matches every document, so no condition is added.
      return;
    }
    if (input.$ne !== undefined) {
      if (input.$ne === null) {
        conditions.push(`${col} IS NOT NULL`);
      } else {
        values.push(dateCol ? new Date(input.$ne) : input.$ne);
        conditions.push(`(${col} IS NULL OR ${col} <> $${values.length})`);
      }
      return;
    }
    if (input.$regex !== undefined) {
      const regex = input.$regex instanceof RegExp ? input.$regex : new RegExp(input.$regex, input.$options || "");
      pushCondition(conditions, values, col, regex, dateCol);
      return;
    }
    for (const [op, opVal] of Object.entries(input)) {
      if (["$gte", "$gt", "$lte", "$lt"].includes(op) && opVal !== undefined && opVal !== null) {
        const sqlOp = op === "$gte" ? ">=" : op === "$gt" ? ">" : op === "$lte" ? "<=" : "<";
        values.push(dateCol ? new Date(opVal) : String(opVal));
        conditions.push(`${col} ${sqlOp} $${values.length}`);
      }
    }
    return;
  }

  if (input !== undefined && input !== null) {
    values.push(dateCol ? new Date(input) : String(input));
    conditions.push(`${col} = $${values.length}`);
  } else if (input === null) {
    conditions.push(`${col} IS NULL`);
  }
};

// id / _id are the same identity in the API surface (Mongo returns _id; the
// controllers pass either). Both spellings resolve to the primary key column.
const pushIdCondition = (conditions, values, input) => {
  if (input === undefined) return;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const list = (Array.isArray(input.$in) ? input.$in : [input.$in])
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v));
    if (list.length) {
      conditions.push(`id IN (${list.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
      values.push(...list);
    } else {
      conditions.push("1 = 0");
    }
    return;
  }
  if (input === null) {
    conditions.push("id IS NULL");
    return;
  }
  values.push(String(input));
  conditions.push(`id = $${values.length}`);
};

// Translates a single Mongo condition object into a SQL predicate. Supports the
// exact filter surface the application uses against Task:
//   * { _id } / { id } — equality (incl. strings cast to text)
//   * { $or: [...] } — including the identity triad
//     { $or: [{staffId}, {employeeId}, {staffEmail}] } built by
//     attendanceController.buildTaskQuery and employeeManagementController, and
//     the nested-range form { $or: [{dateKey: {$gte,$lte}}, {dueDate: {$gte,$lte}}] }
//     from payrollController
//   * { assignmentType } — equality or $in
//   * { dateKey } / { dueDate } — equality, $in, $nin, ranges, $regex
//   * { staffId } / { employeeId } / { staffEmail } — equality or $in
//   * { status } — equality, $in or $nin
//   * { shiftId } — equality
// Every value is bound as a parameter; nothing is interpolated into SQL.
const buildCondition = (filter, conditions, values) => {
  if (!filter || typeof filter !== "object") return;

  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;

    if (key === "$or") {
      const branches = (Array.isArray(value) ? value : [value]).filter(
        (branch) => branch && typeof branch === "object"
      );
      if (!branches.length) {
        // Mongo $or: [] matches no documents.
        conditions.push("1 = 0");
        continue;
      }
      const parts = [];
      for (const branch of branches) {
        const branchConditions = [];
        buildCondition(branch, branchConditions, values);
        if (branchConditions.length) parts.push(`(${branchConditions.join(" AND ")})`);
      }
      if (parts.length) conditions.push(`(${parts.join(" OR ")})`);
      continue;
    }

    if (key === "$and") {
      for (const branch of (Array.isArray(value) ? value : [value])) {
        buildCondition(branch, conditions, values);
      }
      continue;
    }

    if (key === "_id" || key === "id") {
      pushIdCondition(conditions, values, value);
      continue;
    }

    if (key === "conflict") {
      pushCondition(conditions, values, "conflict", value);
      continue;
    }

    const dateCol = DATE_COLUMNS[key];
    if (dateCol && key !== "conflict") {
      pushCondition(conditions, values, dateCol, value, true);
      continue;
    }

    const textCol = TEXT_COLUMNS[key];
    if (!textCol) continue;
    pushCondition(conditions, values, textCol, value);
  }
};

const buildTaskFilter = (filter = {}) => {
  const conditions = [];
  const values = [];
  buildCondition(filter, conditions, values);
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const validate = (data) => {
  if (!data) throw new Error("Task data is required");
  assertId(data.staffId, "staffId");
  assertId(data.staffName, "staffName");
  assertId(data.duty, "duty");
  assertId(data.area, "area");
  assertId(data.time, "time");
  assertId(data.assignedBy, "assignedBy");
};

const findById = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Task.findById(String(id));
  const { rows } = await query(
    `SELECT ${TASK_COLS.join(", ")} FROM tasks WHERE id = $1 LIMIT 1`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// Single-document lookup used by the duty status transitions in priestController
// (Task.findOne({ _id, $or: [{ staffId }, { staffEmail }] })). The caller supplies
// the exact Mongo filter; the caller's $or and _id semantics are reproduced by
// buildTaskFilter.
const findOne = async (filter = {}, sort = { createdAt: -1 }) => {
  if (!dbConfig.isDbConnected()) return Task.findOne(filter).sort(sort);
  const { where, values } = buildTaskFilter(filter);
  const orderBy = resolveOrderBy(sort);
  const { rows } = await query(
    `SELECT ${TASK_COLS.join(", ")} FROM tasks ${where} ORDER BY ${orderBy}, id ASC LIMIT 1`,
    values
  );
  return toDoc(rows[0]);
};

// Mirrors Task.find(filter).sort(sort) with the optional limit/skip the callers
// chain (employeeManagementController uses .limit(100)).
const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Task.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    return q;
  }
  const { where, values } = buildTaskFilter(filter);
  const orderBy = resolveOrderBy(sort);
  let sql = `SELECT ${TASK_COLS.join(", ")} FROM tasks ${where} ORDER BY ${orderBy}, id ASC`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const create = async (data) => {
  validate(data);
  if (!dbConfig.isDbConnected()) return Task.create(data);
  const id = data.id || newId();
  const row = toRow(data, id);
  await query(
    `INSERT INTO tasks (${TASK_COLS.join(", ")})
     VALUES (${TASK_COLS.map((_, i) => `$${i + 1}`).join(", ")})`,
    TASK_COLS.map((col) => row[col])
  );
  return findById(id);
};

// The columns a client may patch, mirroring the fields the controllers update.
// Names absent from the Mongoose schema are deliberately NOT listed: Mongoose
// strict mode silently drops them, so refusing to map them preserves the
// existing behaviour instead of widening the persisted surface.
const UPDATE_COLUMNS = {
  assignmentType: "assignment_type",
  shiftId: "shift_id",
  shiftName: "shift_name",
  shiftStartTime: "shift_start_time",
  shiftEndTime: "shift_end_time",
  dateKey: "date_key",
  startTime: "start_time",
  endTime: "end_time",
  staffId: "staff_id",
  staffName: "staff_name",
  employeeId: "employee_id",
  staffEmail: "staff_email",
  dutyName: "duty_name",
  title: "title",
  description: "description",
  dueDate: "due_date",
  duty: "duty",
  area: "area",
  dutyArea: "duty_area",
  time: "time",
  reportingTime: "reporting_time",
  assignedBy: "assigned_by",
  supervisor: "supervisor",
  priority: "priority",
  workingHours: "working_hours",
  status: "status",
  attendanceStatus: "attendance_status",
  conflict: "conflict",
  reason: "reason",
  notes: "notes",
  requiredStaff: "required_staff",
  durationMinutes: "duration_minutes",
  acceptedAt: "accepted_at",
  rejectedAt: "rejected_at",
  rejectionReason: "rejection_reason",
  completedAt: "completed_at",
  completionRemarks: "completion_remarks",
  completionDuration: "completion_duration",
};

const REQUIRED_IN_UPDATE = {
  staffId: "staffId",
  staffName: "staffName",
  duty: "duty",
  area: "area",
  time: "time",
  assignedBy: "assignedBy",
};

// Patches only the supplied fields, on whichever datasource is selected — the
// PostgreSQL equivalent of mutating the loaded Mongoose document and calling
// save() (the duty status transitions, startMyDuty/completeMyDuty and
// directAdminTransfer).
const updateById = async (id, updates) => {
  if (updates) {
    for (const [key, label] of Object.entries(REQUIRED_IN_UPDATE)) {
      if (updates[key] !== undefined) assertId(updates[key], label);
    }
    for (const key of ["requiredStaff", "durationMinutes", "completionDuration"]) {
      if (updates[key] !== undefined) assertNumber(updates[key], key);
    }
  }
  if (!dbConfig.isDbConnected()) {
    return Task.findByIdAndUpdate(id, updates, { new: true });
  }

  const assignments = [];
  const values = [];
  const apply = (col, value) => {
    values.push(value);
    assignments.push(`${col} = $${values.length}`);
  };

  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    const col = UPDATE_COLUMNS[key];
    if (!col) continue;
    switch (key) {
      case "staffId": apply(col, assertId(value, "staffId")); break;
      case "staffName": apply(col, assertId(value, "staffName")); break;
      case "duty": apply(col, assertId(value, "duty")); break;
      case "area": apply(col, assertId(value, "area")); break;
      case "time": apply(col, assertId(value, "time")); break;
      case "assignedBy": apply(col, assertId(value, "assignedBy")); break;
      case "shiftId": apply(col, optionalText(value)); break;
      case "employeeId": apply(col, optionalText(value)); break;
      case "title": apply(col, optionalText(value)); break;
      case "description": apply(col, optionalText(value)); break;
      case "dueDate": apply(col, optionalText(value)); break;
      case "rejectionReason": apply(col, trimmedOrNull(value)); break;
      case "staffEmail":
        apply(col, value === null ? null : String(value).trim().toLowerCase());
        break;
      case "priority": apply(col, textOrDefault(value, "Medium")); break;
      case "status": apply(col, textOrDefault(value, "Pending")); break;
      case "attendanceStatus": apply(col, textOrDefault(value, "Pending")); break;
      case "assignmentType": apply(col, textOrDefault(value, "Duty & Shift")); break;
      case "conflict": apply(col, Boolean(value)); break;
      case "requiredStaff": apply(col, numberOrDefault(value, 1)); break;
      case "durationMinutes": apply(col, numberOrDefault(value, 0)); break;
      case "completionDuration": apply(col, numberOrDefault(value, 0)); break;
      case "acceptedAt":
      case "rejectedAt":
      case "completedAt": apply(col, toDateOrNull(value)); break;
      default: apply(col, textOrDefault(value, "")); break;
    }
  }

  if (!assignments.length) return findById(id);

  assignments.push("updated_at = now()");
  values.push(String(id));
  await query(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
  return findById(id);
};

// Mirrors Task.find({...}).sort(...) followed by a per-document patch — used by
// getSevaSchedule's dateKey rollover (Task.updateMany(filter, { dateKey })).
const updateMany = async (filter, updates) => {
  if (!dbConfig.isDbConnected()) return Task.updateMany(filter, updates);
  const assignments = [];
  const values = [];
  const apply = (col, value) => {
    values.push(value);
    assignments.push(`${col} = $${values.length}`);
  };

  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue;
    const col = UPDATE_COLUMNS[key];
    if (!col) continue;
    if (key === "dateKey") apply(col, textOrDefault(value, ""));
    else if (key === "status") apply(col, textOrDefault(value, "Pending"));
    else if (key === "attendanceStatus") apply(col, textOrDefault(value, "Pending"));
    else if (key === "conflict") apply(col, Boolean(value));
    else if (["acceptedAt", "rejectedAt", "completedAt"].includes(key)) apply(col, toDateOrNull(value));
    else if (["requiredStaff", "durationMinutes", "completionDuration"].includes(key)) apply(col, numberOrDefault(value, 0));
    else apply(col, optionalText(value));
  }

  if (!assignments.length) return { acknowledged: true, modifiedCount: 0 };

  const { where, values: filterValues } = buildTaskFilter(filter);
  const shift = values.length;
  assignments.push("updated_at = now()");
  const sql = `UPDATE tasks SET ${assignments.join(", ")} ${where
    .replace(/\$(\d+)/g, (_, n) => `$${Number(n) + shift}`)}`;
  const { rowCount } = await query(sql, [...values, ...filterValues]);
  return { acknowledged: true, modifiedCount: rowCount, matchedCount: rowCount };
};

// Mirrors Task.findByIdAndDelete(id).
const destroy = async (id) => {
  if (!id) return null;
  if (!dbConfig.isDbConnected()) return Task.findByIdAndDelete(String(id));
  const { rows } = await query(
    `DELETE FROM tasks WHERE id = $1 RETURNING ${TASK_COLS.join(", ")}`,
    [String(id)]
  );
  return toDoc(rows[0]);
};

// Mirrors Task.deleteMany({ shiftId }) — the application-level cascade
// shiftController.deleteShift performs after removing a shift.
const deleteMany = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Task.deleteMany(filter);
  const { where, values } = buildTaskFilter(filter);
  const { rowCount } = await query(`DELETE FROM tasks ${where}`, values);
  return { acknowledged: true, deletedCount: rowCount };
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Task.countDocuments(filter);
  const { where, values } = buildTaskFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM tasks ${where}`, values);
  return rows[0]?.count || 0;
};

module.exports = {
  findById,
  findOne,
  findMany,
  create,
  updateById,
  updateMany,
  destroy,
  deleteMany,
  count,
  validate,
  resolveOrderBy,
};
