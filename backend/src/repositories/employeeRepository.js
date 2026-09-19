const { query } = require("../config/postgres");
const dbConfig = require("../config/db");
const Employee = require("../models/Employee");
const crypto = require("crypto");

const now = () => new Date();

const newId = () => crypto.randomBytes(12).toString("hex");

const normalizeEmail = (email) => String(email || "").toLowerCase().trim();

const CURRENT_DUTY_PRIORITIES = new Set(["Low", "Medium", "High", "Urgent"]);

const assertCurrentDutyPriority = (currentDuty) => {
  if (currentDuty === undefined || currentDuty === null) return;
  if (typeof currentDuty === "string") {
    try { currentDuty = JSON.parse(currentDuty); } catch { throw new Error("currentDuty must be valid JSON"); }
  }
  if (typeof currentDuty !== "object") return;
  const priority = currentDuty.priority;
  if (priority !== undefined && !CURRENT_DUTY_PRIORITIES.has(priority)) {
    throw new Error(`Invalid currentDuty.priority: ${priority}. Allowed: Low, Medium, High, Urgent`);
  }
};

const EMP_COLS = [
  "id", "employee_id", "username", "user_id", "name", "email", "password", "role",
  "gender", "dob", "blood_group", "aadhaar", "phone", "address", "emergency_contact",
  "shift", "department", "salary", "joining_date", "bank_name", "account_number",
  "employment_type", "default_shift", "default_duty", "duty_location", "biometric_id",
  "current_duty", "photo", "profile_photo", "face_registered", "face_descriptor",
  "face_photos", "attendance_location", "status", "attendance_status", "leave_balance",
  "experience", "veda_shakha", "specializations", "languages", "certification",
  "created_by", "updated_by", "deleted_at", "deleted_by", "weekly_off",
  "comp_off_balance", "eligible_poojas", "created_at", "updated_at",
];

const toDoc = (row) => {
  if (!row) return null;
  const currentDuty = (() => {
    try {
      return typeof row.current_duty === "string" ? JSON.parse(row.current_duty || "{}") : (row.current_duty || {});
    } catch { return {}; }
  })();
  return {
    _id: row.id,
    id: row.id,
    employeeId: row.employee_id || undefined,
    username: row.username || undefined,
    userId: row.user_id || null,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role,
    gender: row.gender || undefined,
    dob: row.dob || undefined,
    bloodGroup: row.blood_group || undefined,
    aadhaar: row.aadhaar || undefined,
    phone: row.phone || undefined,
    address: row.address || undefined,
    emergencyContact: row.emergency_contact || undefined,
    shift: row.shift || undefined,
    department: row.department || undefined,
    salary: row.salary === null || row.salary === undefined ? undefined : Number(row.salary),
    joiningDate: row.joining_date || undefined,
    bankName: row.bank_name || undefined,
    accountNumber: row.account_number || undefined,
    employmentType: row.employment_type || "Full Time",
    defaultShift: row.default_shift || undefined,
    defaultDuty: row.default_duty || undefined,
    dutyLocation: row.duty_location || undefined,
    biometricId: row.biometric_id || undefined,
    currentDuty: currentDuty,
    photo: row.photo || "",
    profilePhoto: row.profile_photo || "",
    faceRegistered: row.face_registered,
    faceDescriptor: row.face_descriptor || [],
    facePhotos: row.face_photos || [],
    attendanceLocation: row.attendance_location || null,
    status: row.status,
    attendanceStatus: row.attendance_status || "Not Marked",
    leaveBalance: row.leave_balance === null || row.leave_balance === undefined ? 0 : Number(row.leave_balance),
    experience: row.experience || undefined,
    vedaShakha: row.veda_shakha || undefined,
    specializations: row.specializations || [],
    languages: row.languages || [],
    certification: row.certification || undefined,
    createdBy: row.created_by || "Admin",
    updatedBy: row.updated_by || "Admin",
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by || "",
    weeklyOff: row.weekly_off || "",
    compOffBalance: row.comp_off_balance === null || row.comp_off_balance === undefined ? 0 : Number(row.comp_off_balance),
    eligiblePoojas: row.eligible_poojas || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fromDbToPlain = (row) => {
  const doc = toDoc(row);
  if (!doc) return null;
  const { password, ...rest } = doc;
  return rest;
};

const toRow = (data, id = newId()) => {
  const currentDuty = typeof data.currentDuty === "string" ? data.currentDuty : (data.currentDuty || {});
  return {
    id,
    employee_id: data.employeeId || null,
    username: data.username || null,
    user_id: data.userId || null,
    name: data.name,
    email: normalizeEmail(data.email),
    password: data.password,
    role: data.role || "staff",
    gender: data.gender || null,
    dob: data.dob || null,
    blood_group: data.bloodGroup || null,
    aadhaar: data.aadhaar || null,
    phone: data.phone || null,
    address: data.address || null,
    emergency_contact: data.emergencyContact || null,
    shift: data.shift || null,
    department: data.department || null,
    salary: data.salary,
    joining_date: data.joiningDate || null,
    bank_name: data.bankName || null,
    account_number: data.accountNumber || null,
    employment_type: data.employmentType || "Full Time",
    default_shift: data.defaultShift || null,
    default_duty: data.defaultDuty || null,
    duty_location: data.dutyLocation || null,
    biometric_id: data.biometricId || null,
    current_duty: currentDuty,
    photo: data.photo || "",
    profile_photo: data.profilePhoto || "",
    face_registered: Boolean(data.faceRegistered),
    face_descriptor: Array.isArray(data.faceDescriptor) ? data.faceDescriptor : [],
    face_photos: Array.isArray(data.facePhotos) ? data.facePhotos : [],
    attendance_location: data.attendanceLocation || null,
    status: data.status || "Active",
    attendance_status: data.attendanceStatus || "Not Marked",
    leave_balance: data.leaveBalance ?? 0,
    experience: data.experience || null,
    veda_shakha: data.vedaShakha || null,
    specializations: Array.isArray(data.specializations) ? data.specializations : [],
    languages: Array.isArray(data.languages) ? data.languages : [],
    certification: data.certification || null,
    created_by: data.createdBy || "Admin",
    updated_by: data.updatedBy || "Admin",
    deleted_at: data.deletedAt || null,
    deleted_by: data.deletedBy || "",
    weekly_off: data.weeklyOff || "",
    comp_off_balance: data.compOffBalance ?? 0,
    eligible_poojas: Array.isArray(data.eligiblePoojas) ? data.eligiblePoojas : [],
    created_at: data.createdAt || now(),
    updated_at: data.updatedAt || now(),
  };
};

const findById = async (id) => {
  if (!id) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`SELECT ${EMP_COLS.join(", ")} FROM employees WHERE id = $1 LIMIT 1`, [String(id)]);
    return toDoc(rows[0]);
  }
  return Employee.findById(String(id));
};

const findByEmployeeId = async (employeeId) => {
  if (!employeeId) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`SELECT ${EMP_COLS.join(", ")} FROM employees WHERE employee_id = $1 LIMIT 1`, [String(employeeId)]);
    return toDoc(rows[0]);
  }
  return Employee.findOne({ employeeId: String(employeeId) });
};

const findByEmail = async (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`SELECT ${EMP_COLS.join(", ")} FROM employees WHERE email = $1 LIMIT 1`, [normalized]);
    return toDoc(rows[0]);
  }
  return Employee.findOne({ email: normalized });
};

const findByIdOrEmployeeId = async (identifier) => {
  if (!identifier) return null;
  const byId = dbConfig.isDbConnected() ? await findById(identifier) : null;
  if (byId) return byId;
  const byEmpId = await findByEmployeeId(identifier);
  if (byEmpId) return byEmpId;

  if (!dbConfig.isDbConnected()) {
    const byEmail = await findByEmail(identifier);
    if (byEmail) return byEmail;
  }
  return null;
};

const exists = async (filter) => {
  if (!dbConfig.isDbConnected()) return Boolean(await Employee.exists(filter));
  const conditions = [];
  const values = [];
  for (const [key, value] of Object.entries(filter || {})) {
    if (value === undefined) continue;
    if (key === "_id" || key === "id") { conditions.push(`id = $${values.length + 1}`); values.push(String(value)); }
    else if (key === "employeeId") { conditions.push(`employee_id = $${values.length + 1}`); values.push(String(value)); }
    else if (key === "username") { conditions.push(`username = $${values.length + 1}`); values.push(String(value)); }
    else if (key === "email") { conditions.push(`email = $${values.length + 1}`); values.push(normalizeEmail(value)); }
    else if (key === "aadhaar") { conditions.push(`aadhaar = $${values.length + 1}`); values.push(String(value)); }
    else if (key === "userId") { conditions.push(`user_id = $${values.length + 1}`); values.push(String(value)); }
  }
  if (!conditions.length) return false;
  const { rows } = await query(`SELECT 1 FROM employees WHERE ${conditions.join(" AND ")} LIMIT 1`, values);
  return rows.length > 0;
};

const create = async (data) => {
  const id = data.id || newId();
  assertCurrentDutyPriority(data.currentDuty);
  const row = toRow(data, id);
  if (dbConfig.isDbConnected()) {
    await query(
      `INSERT INTO employees (${EMP_COLS.join(", ")})
       VALUES (${EMP_COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (id) DO NOTHING`,
      EMP_COLS.map((col) => row[col])
    );
    const existing = await findById(id);
    if (existing) return existing;
  } else {
    return Employee.create(data);
  }
  return toDoc(row);
};

const updateById = async (id, updates, { returnDoc = true } = {}) => {
  if (!id) return null;
  if (dbConfig.isDbConnected()) {
    const fields = [];
    const values = [];
    const apply = (dbCol, value) => {
      if (value !== undefined) {
        fields.push(`${dbCol} = $${fields.length + 1}`);
        values.push(value);
      }
    };

    for (const [key, value] of Object.entries(updates || {})) {
      if (value === undefined) continue;
      switch (key) {
        case "employeeId": apply("employee_id", value || null); break;
        case "username": apply("username", value || null); break;
        case "userId": apply("user_id", value || null); break;
        case "name": apply("name", value); break;
        case "email": apply("email", normalizeEmail(value)); break;
        case "password": apply("password", value); break;
        case "role": apply("role", value); break;
        case "gender": apply("gender", value ?? null); break;
        case "dob": apply("dob", value ?? null); break;
        case "bloodGroup": apply("blood_group", value ?? null); break;
        case "aadhaar": apply("aadhaar", value ?? null); break;
        case "phone": apply("phone", value ?? null); break;
        case "address": apply("address", value ?? null); break;
        case "emergencyContact": apply("emergency_contact", value ?? null); break;
        case "shift": apply("shift", value ?? null); break;
        case "department": apply("department", value ?? null); break;
        case "salary": apply("salary", value); break;
        case "joiningDate": apply("joining_date", value ?? null); break;
        case "bankName": apply("bank_name", value ?? null); break;
        case "accountNumber": apply("account_number", value ?? null); break;
        case "employmentType": apply("employment_type", value || "Full Time"); break;
        case "defaultShift": apply("default_shift", value ?? null); break;
        case "defaultDuty": apply("default_duty", value ?? null); break;
        case "dutyLocation": apply("duty_location", value ?? null); break;
        case "biometricId": apply("biometric_id", value ?? null); break;
        case "currentDuty":
          assertCurrentDutyPriority(value);
          apply("current_duty", typeof value === "string" ? value : (value || {}));
          break;
        case "photo": apply("photo", value || ""); break;
        case "profilePhoto": apply("profile_photo", value || ""); break;
        case "faceRegistered": apply("face_registered", Boolean(value)); break;
        case "faceDescriptor": apply("face_descriptor", Array.isArray(value) ? value : []); break;
        case "facePhotos": apply("face_photos", Array.isArray(value) ? value : []); break;
        case "attendanceLocation": apply("attendance_location", value ?? null); break;
        case "status": apply("status", value); break;
        case "attendanceStatus": apply("attendance_status", value || "Not Marked"); break;
        case "leaveBalance": apply("leave_balance", value ?? 0); break;
        case "experience": apply("experience", value ?? null); break;
        case "vedaShakha": apply("veda_shakha", value ?? null); break;
        case "specializations": apply("specializations", Array.isArray(value) ? value : []); break;
        case "languages": apply("languages", Array.isArray(value) ? value : []); break;
        case "certification": apply("certification", value ?? null); break;
        case "createdBy": apply("created_by", value || "Admin"); break;
        case "updatedBy": apply("updated_by", value || "Admin"); break;
        case "deletedAt": apply("deleted_at", value ?? null); break;
        case "deletedBy": apply("deleted_by", value || ""); break;
        case "weeklyOff": apply("weekly_off", value || ""); break;
        case "compOffBalance": apply("comp_off_balance", value ?? 0); break;
        case "eligiblePoojas": apply("eligible_poojas", Array.isArray(value) ? value : []); break;
        default: break;
      }
    }

    if (values.length > 0) {
      fields.push(`updated_at = now()`);
      values.push(id);
      await query(`UPDATE employees SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    }
    if (!returnDoc) return true;
    const existing = await findById(id);
    return existing;
  }
  const updated = await Employee.findByIdAndUpdate(
    String(id),
    updates,
    { new: true, runValidators: true }
  );
  return updated ? toDoc(updated) : null;
};

const SORT_COLUMNS = {
  createdAt: "created_at",
  name: "name",
  employeeId: "employee_id",
  department: "department",
  salary: "salary",
  joiningDate: "joining_date",
  status: "status",
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

const buildEmployeeFilter = (filter) => {
  const conditions = [];
  const values = [];
  const pushCond = (col, op, value) => {
    conditions.push(`${col} ${op} $${values.length + 1}`);
    values.push(value);
  };

  const mapFilter = (key, value) => {
    if (value === undefined) return;
    switch (key) {
      case "role": pushCond("role", "=", String(value).toLowerCase()); break;
      case "status": pushCond("status", "=", value); break;
      case "department": pushCond("department", "=", value); break;
      case "employmentType": pushCond("employment_type", "=", value); break;
      case "shift": {
        // Mongo semantics: match shift OR default_shift OR current_duty.shift
        if (Array.isArray(value)) {
          value.forEach((v) => {
            conditions.push(`(shift = $${values.length + 1} OR default_shift = $${values.length + 2} OR current_duty->>'shift' = $${values.length + 3})`);
            values.push(v, v, v);
          });
        } else {
          conditions.push(`(shift = $${values.length + 1} OR default_shift = $${values.length + 2} OR current_duty->>'shift' = $${values.length + 3})`);
          values.push(value, value, value);
        }
        break;
      }
      case "joiningDate": {
        if (value.$gte) pushCond("joining_date", ">=", value.$gte);
        if (value.$lte) pushCond("joining_date", "<=", value.$lte);
        break;
      }
      case "salary": {
        if (value.$gte) pushCond("salary", ">=", value.$gte);
        if (value.$lte) pushCond("salary", "<=", value.$lte);
        break;
      }
      case "search": {
        const term = String(value || "").trim();
        if (term) {
          conditions.push(
            `(employee_id ILIKE $${values.length + 1} OR name ILIKE $${values.length + 2} OR email ILIKE $${values.length + 3} OR phone ILIKE $${values.length + 4} OR department ILIKE $${values.length + 5} OR role ILIKE $${values.length + 6})`
          );
          const pattern = `%${term}%`;
          values.push(pattern, pattern, pattern, pattern, pattern, pattern);
        }
        break;
      }
      case "statusIn": {
        if (Array.isArray(value) && value.length) {
          conditions.push(`status IN (${value.map((_, i) => `$${values.length + i + 1}`).join(", ")})`);
          values.push(...value);
        }
        break;
      }
      case "roleNot": {
        if (value) pushCond("role", "<>", value);
        break;
      }
      default: break;
    }
  };

  for (const [key, value] of Object.entries(filter)) mapFilter(key, value);
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
};

const findMany = async (options = {}) => {
  const { filter = {}, sort = { createdAt: -1 }, limit, offset } = options;
  if (!dbConfig.isDbConnected()) {
    let q = Employee.find(filter).sort(sort);
    if (limit) q = q.limit(limit);
    if (offset) q = q.skip(offset);
    const docs = await q;
    return docs.map((d) => toDoc(d));
  }

  const { where, values } = buildEmployeeFilter(filter);
  const orderBy = resolveOrderBy(sort);

  let sql = `SELECT ${EMP_COLS.join(", ")} FROM employees ${where} ORDER BY ${orderBy}`;
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  if (offset) sql += ` OFFSET ${Number(offset)}`;
  const { rows } = await query(sql, values);
  return rows.map(toDoc);
};

const count = async (filter = {}) => {
  if (!dbConfig.isDbConnected()) return Employee.countDocuments(filter);
  const { where, values } = buildEmployeeFilter(filter);
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM employees ${where}`, values);
  return rows[0]?.count || 0;
};

const removeById = async (id) => {
  if (!id) return false;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`DELETE FROM employees WHERE id = $1 RETURNING id`, [String(id)]);
    return rows.length > 0;
  }
  return false;
};

const destroyUser = async (id) => {
  if (!id) return false;
  if (dbConfig.isDbConnected()) {
    const { rows } = await query(`DELETE FROM employees WHERE id = $1 RETURNING id`, [String(id)]);
    return rows.length > 0;
  }
  return false;
};

const latestEmployeeIdInPrefix = async (prefix) => {
  if (!dbConfig.isDbConnected()) {
    const doc = await Employee.findOne({ employeeId: { $regex: `^${prefix}` } }).sort({ employeeId: -1 }).select("employeeId").lean();
    return doc?.employeeId || null;
  }
  const { rows } = await query(
    `SELECT employee_id FROM employees WHERE employee_id LIKE $1 ORDER BY employee_id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  return rows[0]?.employee_id || null;
};

module.exports = {
  findById,
  findByEmployeeId,
  findByEmail,
  findByIdOrEmployeeId,
  exists,
  create,
  updateById,
  findMany,
  count,
  removeById,
  destroyUser,
  latestEmployeeIdInPrefix,
  fromDbToPlain,
};