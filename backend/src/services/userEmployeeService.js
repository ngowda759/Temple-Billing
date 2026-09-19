const bcrypt = require("bcryptjs");
const dbConfig = require("../config/db");
const userRepository = require("../repositories/userRepository");
const employeeRepository = require("../repositories/employeeRepository");
const User = require("../models/User");
const Employee = require("../models/Employee");
const { normalizeEmail, buildEmailLookup } = require("../utils/email");

const isConnected = () => dbConfig.isDbConnected();

const userToUpsert = (user) => {
  if (!user) return null;
  const plain = user.toObject ? user.toObject() : { ...user };
  return {
    id: String(plain._id || plain.id),
    name: plain.name,
    email: normalizeEmail(plain.email),
    username: plain.username || undefined,
    employeeId: plain.employeeId || undefined,
    phone: plain.phone || "",
    address: plain.address || "",
    place: plain.place || "",
    password: plain.password,
    role: plain.role || "devotee",
    photo: plain.photo || "",
    status: plain.status || "Active",
    accountEnabled: plain.accountEnabled !== false,
    permissions: plain.permissions || [],
    menuAccess: plain.menuAccess || [],
    lastLogin: plain.lastLogin || undefined,
    mustChangePassword: Boolean(plain.mustChangePassword),
    provider: plain.provider || "local",
    resetPasswordToken: plain.resetPasswordToken || undefined,
    resetPasswordExpiresAt: plain.resetPasswordExpiresAt || undefined,
    createdAt: plain.createdAt || undefined,
    updatedAt: plain.updatedAt || undefined,
  };
};

const employeeToUpsert = (employee) => {
  if (!employee) return null;
  const plain = employee.toObject ? employee.toObject() : { ...employee };
  const employeeId = plain.employeeId ||
    (plain.userId
      ? `EMP-${String(plain.userId).slice(-6).toUpperCase()}`
      : undefined);
  return {
    id: String(plain._id || plain.id),
    employeeId: employeeId || undefined,
    username: plain.username || undefined,
    userId: plain.userId ? String(plain.userId) : undefined,
    name: plain.name,
    email: normalizeEmail(plain.email),
    password: plain.password,
    role: plain.role || "staff",
    gender: plain.gender || undefined,
    dob: plain.dob || undefined,
    bloodGroup: plain.bloodGroup || undefined,
    aadhaar: plain.aadhaar || undefined,
    phone: plain.phone || undefined,
    address: plain.address || undefined,
    emergencyContact: plain.emergencyContact || undefined,
    shift: plain.shift || undefined,
    department: plain.department || undefined,
    salary: plain.salary,
    joiningDate: plain.joiningDate || undefined,
    bankName: plain.bankName || undefined,
    accountNumber: plain.accountNumber || undefined,
    employmentType: plain.employmentType || "Full Time",
    defaultShift: plain.defaultShift || undefined,
    defaultDuty: plain.defaultDuty || undefined,
    dutyLocation: plain.dutyLocation || undefined,
    biometricId: plain.biometricId || undefined,
    currentDuty: plain.currentDuty || undefined,
    photo: plain.photo || "",
    profilePhoto: plain.profilePhoto || "",
    faceRegistered: Boolean(plain.faceRegistered),
    faceDescriptor: plain.faceDescriptor || [],
    facePhotos: plain.facePhotos || [],
    attendanceLocation: plain.attendanceLocation ? String(plain.attendanceLocation) : undefined,
    status: plain.status || "Active",
    attendanceStatus: plain.attendanceStatus || "Not Marked",
    leaveBalance: plain.leaveBalance ?? 0,
    experience: plain.experience || undefined,
    vedaShakha: plain.vedaShakha || undefined,
    specializations: plain.specializations || [],
    languages: plain.languages || [],
    certification: plain.certification || undefined,
    createdBy: plain.createdBy || "Admin",
    updatedBy: plain.updatedBy || "Admin",
    deletedAt: plain.deletedAt || undefined,
    deletedBy: plain.deletedBy || "",
    weeklyOff: plain.weeklyOff || "",
    compOffBalance: plain.compOffBalance ?? 0,
    eligiblePoojas: plain.eligiblePoojas
      ? plain.eligiblePoojas.map((p) => String(p))
      : [],
    createdAt: plain.createdAt || undefined,
    updatedAt: plain.updatedAt || undefined,
  };
};

// ---------------------------------------------------------------------------
// User lifecycle helpers (dual-write: PostgreSQL primary, Mongo compat mirror,
// file store remains the last-resort fallback when no DB is connected).
// ---------------------------------------------------------------------------

const resolveUser = async (email) => {
  const normalized = normalizeEmail(email);
  if (isConnected()) {
    const pgUser = await userRepository.findUserByEmail(normalized);
    if (pgUser) return pgUser;
  }
  const mongoUser = await User.findOne(
    buildEmailLookup("email", normalized).select("_id name email phone address place username employeeId photo role status permissions menuAccess lastLogin mustChangePassword provider resetPasswordToken resetPasswordExpiresAt")
  );
  if (mongoUser) {
    await userRepository.createUser(userToUpsert(mongoUser)).catch(() => {});
    return mongoUser;
  }
  return userRepository.findUserByEmail(normalized);
};

const resolveUserById = async (id) => {
  if (isConnected()) {
    const pgUser = await userRepository.findUserById(id);
    if (pgUser) return pgUser;
  }
  const mongoUser = await User.findById(id);
  if (mongoUser) return mongoUser;
  return userRepository.findUserById(id);
};

const createUserRecord = async (data) => {
  const record = await userRepository.createUser(data);
  if (isConnected() && record?._id) {
    const payload = {
      ...data,
      id: String(record._id),
      createdAt: record.createdAt || data.createdAt,
      updatedAt: record.updatedAt || data.updatedAt,
    };
    if (data.id) {
      // Deterministic write: same id for Mongo mirror (e.g. created from employee creation).
      await User.create({ ...payload, _id: data.id, email: normalizeEmail(data.email)} ).catch((err) => {
        if (err?.code !== 11000) console.error("Mongo user mirror write failed:", err.message);
      });
    } else {
      await User.findOneAndUpdate(
        buildEmailLookup("email", data.email),
        { $setOnInsert: { ...payload, email: normalizeEmail(data.email)} },
        { upsert: true }
      ).catch((err) => console.error("Mongo user mirror upsert failed:", err.message));
    }
  }
  return record;
};

const updateUserRecord = async (id, updates) => {
  const updated = await userRepository.updateUserById(id, updates);
  if (isConnected() && updated?._id) {
    const mongoId = String(updated._id);
    await User.findByIdAndUpdate(mongoId, updates, { new: true }).catch(() => {});
    // Some writes target the user by email/employeeId (e.g. employee profile updates);
    if (updates.email || updates.employeeId) {
      const filter = updates.email
        ? buildEmailLookup("email", updates.email)
        : { employeeId: updates.employeeId };
      await User.updateOne(filter, { $set: updates }, { multi: false }).catch(() => {});
    }
  }
  return updated;
};

const saveUserLastLogin = async (id, lastLogin) => {
  const updated = await userRepository.updateUserById(id, { lastLogin });
  if (isConnected() && updated?._id) {
    await User.findByIdAndUpdate(String(updated._id), { lastLogin }, { new: true }).catch(() => {});
  }
  return updated;
};

const resolveEmployee = async (email) => {
  const normalized = normalizeEmail(email);
  if (isConnected()) {
    const pgEmp = await employeeRepository.findByEmail(normalized);
    if (pgEmp) return pgEmp;
  }
  const mongoEmp = await Employee.findOne({ email: normalized });
  if (mongoEmp) {
    await employeeRepository.create(employeeToUpsert(mongoEmp)).catch(() => {});
    return mongoEmp;
 
  }
  return employeeRepository.findByEmail(normalized);
};

const resolveEmployeeById = async (id) => {
  if (isConnected()) {
    const pgEmp = await employeeRepository.findById(id);
    if (pgEmp) return pgEmp;
 
  }
  const mongoEmp = await Employee.findById(id);
  if (mongoEmp) return mongoEmp;

  return employeeRepository.findById(id);
};

const createEmployeeRecord = async (data) => {
  const record = await employeeRepository.create(data);
  if (isConnected() && record?._id) {
    const payload = {
      ...data,
      ...(data.id ? { _id: data.id } : {}),
      id: String(record._id),
      createdAt: record.createdAt || data.createdAt,
      updatedAt: record.updatedAt || data.updatedAt,
    };
    if (data.id) {
      await Employee.create(payload).catch((err) => {
        if (err?.code !== 11000) console.error("Mongo employee mirror write failed:", err.message);
      });
    } else {
      await Employee.findOneAndUpdate(
        { email: normalizeEmail(data.email) },
        { $setOnInsert: payload },
        { upsert: true }
      ).catch((err) => console.error("Mongo employee mirror upsert failed:", err.message));
    }
  }
  return record;
};

const updateEmployeeRecord = async (id, updates) => {
  const updated = await employeeRepository.updateById(id, updates);
  if (isConnected() && updated?._id) {
    await Employee.findByIdAndUpdate(String(updated._id), updates, { new: true }).catch(() => {});
  }
   return updated;
};

module.exports = {
  isConnected,
  userToUpsert,
  employeeToUpsert,
  resolveUser,
  resolveUserById,
  createUserRecord,
  updateUserRecord,
  saveUserLastLogin,
  resolveEmployee,
  resolveEmployeeById,
  createEmployeeRecord,
  updateEmployeeRecord,
};