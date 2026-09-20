const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Employee = require("../models/Employee");
const User = require("../models/User");
const attendanceService = require("../services/attendanceService");
const leaveService = require("../services/leaveService");
const taskService = require("../services/taskService");
const notificationPersistenceService = require("../services/notificationPersistenceService");
const { canLoginForStatus, getRoleAccess } = require("../utils/employeeAccess");
const { sendEmail } = require("../utils/communicationService");

const ALLOWED_AUTH_ROLES = ["admin", "accountant", "cashier", "priest", "staff"];
const EMPLOYEE_STATUSES = ["Active", "On Leave", "Inactive", "Suspended", "Resigned", "Retired"];
const STAFF_PROFILE_EDITABLE_FIELDS = [
  "name", "email", "gender", "dob", "bloodGroup", 
  "phone", "emergencyContact", "address", "photo", "profilePhoto",
  "bankName", "accountNumber",
];
const MAX_PHOTO_LENGTH = 7 * 1024 * 1024;

const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(String(email || "").trim());
const isValidDate = (value) => value && !Number.isNaN(new Date(value).getTime());
const isPastOrToday = (value) => {
  if (!isValidDate(value)) return false;
  const date = new Date(value);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date <= today;
};
const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeStatus = (value, fallback = "Active") => {
  const match = EMPLOYEE_STATUSES.find(
    (status) => status.toLowerCase() === String(value || "").trim().toLowerCase()
  );
  return match || fallback;
};
const isValidPhoto = (value) => {
  if (!value) return true;
  return (
    typeof value === "string" &&
    value.length <= MAX_PHOTO_LENGTH &&
    /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value)
  );
};

const sanitizeEmployee = (employeeDoc) => {
  if (!employeeDoc) return null;
  const employee = employeeDoc.toObject ? employeeDoc.toObject() : { ...employeeDoc };
  delete employee.password;
  return employee;
};

const getActorName = async (req) => {
  if (!req.user?.id) return "Admin";
  const actor = await User.findById(req.user.id).select("name");
  return actor?.name || "Admin";
};

const findUserAndEmployeeByUserId = async (userId) => {
  const user = mongoose.Types.ObjectId.isValid(userId) ? await User.findById(userId) : null;
  if (!user) {
    const employee = mongoose.Types.ObjectId.isValid(userId) ? await Employee.findById(userId) : null;
    if (!employee) return {};
    const linkedUser = employee.userId
      ? await User.findById(employee.userId)
      : await User.findOne({ email: employee.email });
    return { user: linkedUser, employee };
  }

  const employee =
    (user.employeeId && await Employee.findOne({ employeeId: user.employeeId })) ||
    await Employee.findOne({ $or: [{ userId: user._id }, { email: user.email }] });
  return { user, employee };
};

const authorizeProfileOwner = (req, user) =>
  req.user?.role === "admin" || String(req.user?.id || "") === String(user?._id || "");

const generateEmployeeIdentity = async () => {
  const year = new Date().getFullYear();
  const prefix = `EMP-${year}-`;
  const latest = await Employee.findOne({ employeeId: { $regex: `^${prefix}` } })
    .sort({ employeeId: -1 })
    .select("employeeId")
    .lean();
  const previousNumber = Number.parseInt(String(latest?.employeeId || "").split("-").pop(), 10) || 0;
  let sequence = previousNumber + 1;

  while (sequence < 100000) {
    const employeeId = `${prefix}${String(sequence).padStart(4, "0")}`;
    const exists = await Employee.exists({ employeeId });
    if (!exists) return { employeeId };
    sequence += 1;
  }
  throw new Error("Unable to generate employee identity.");
};

const generateTemporaryPassword = () => {
  const randomStr = crypto.randomBytes(3).toString("hex");
  return `Temp@${randomStr}`;
};

const validateCoreEmployee = (payload, existingEmployee = null) => {
  const normalizedEmail = String(payload.email || existingEmployee?.email || "").toLowerCase().trim();
  const normalizedRole = String(payload.role || existingEmployee?.role || "staff").toLowerCase().trim();
  if (!String(payload.name || existingEmployee?.name || "").trim() || !normalizedEmail || !normalizedRole) {
    return "Name, email and role are required.";
  }
  if (!isValidEmail(normalizedEmail)) return "Invalid email address.";
  if (!ALLOWED_AUTH_ROLES.includes(normalizedRole)) return "Invalid employee role.";
  if (payload.photo !== undefined && !isValidPhoto(payload.photo)) {
    return "Profile photo must be a JPG, PNG, or WebP image up to 5 MB.";
  }
  if (payload.aadhaar && !/^[0-9]{12}$/.test(String(payload.aadhaar))) {
    return "Aadhaar number must be exactly 12 digits.";
  }
  if (payload.phone && !/^\+?[0-9]{10,15}$/.test(String(payload.phone).replace(/[\s-]/g, ""))) {
    return "Please enter a valid phone number.";
  }
  if (payload.emergencyContact && !/^[0-9]{10}$/.test(String(payload.emergencyContact).replace(/\D/g, ""))) {
    return "Valid emergency contact is required.";
  }
  if (!existingEmployee && (!payload.emergencyContact || !payload.dob || !payload.joiningDate)) {
    return "Date of birth, joining date, and emergency contact are required.";
  }
  if (payload.dob && (!isValidDate(payload.dob) || !isPastOrToday(payload.dob))) {
    return "Date of birth must be a valid past date.";
  }
  if (payload.joiningDate && !isValidDate(payload.joiningDate)) return "Joining date is invalid.";
  if (payload.salary !== undefined && Number(payload.salary) <= 0) return "Salary must be greater than 0.";

  const dob = payload.dob || existingEmployee?.dob;
  const joiningDate = payload.joiningDate || existingEmployee?.joiningDate;
  if (dob && joiningDate) {
    const eighteenthBirthday = new Date(dob);
    eighteenthBirthday.setFullYear(eighteenthBirthday.getFullYear() + 18);
    if (new Date(joiningDate) < eighteenthBirthday) {
      return "Joining date must be after employee turns 18 years old.";
    }
  }
  return "";
};

const buildCurrentDuty = (payload, existingEmployee = {}) => {
  const supplied = payload.currentDuty || {};
  const proposedPriority = supplied.priority ?? payload.priority;
  return {
    dutyName: String(supplied.dutyName ?? payload.defaultDuty ?? existingEmployee.defaultDuty ?? "").trim(),
    shift: String(
      supplied.shift ?? payload.defaultShift ?? payload.shift ??
      existingEmployee.defaultShift ?? existingEmployee.shift ?? ""
    ).trim(),
    dutyLocation: String(
      supplied.dutyLocation ?? payload.dutyLocation ?? existingEmployee.dutyLocation ?? ""
    ).trim(),
    reportingTime: String(
      supplied.reportingTime ?? payload.reportingTime ?? existingEmployee.currentDuty?.reportingTime ?? ""
    ).trim(),
    workingHours: String(
      supplied.workingHours ?? payload.workingHours ?? existingEmployee.currentDuty?.workingHours ?? ""
    ).trim(),
    supervisor: String(
      supplied.supervisor ?? payload.supervisor ?? existingEmployee.currentDuty?.supervisor ?? ""
    ).trim(),
    priority: ["Low", "Medium", "High", "Urgent"].includes(proposedPriority)
      ? proposedPriority
      : existingEmployee.currentDuty?.priority || "Medium",
  };
};

exports.createEmployee = async (req, res) => {
  let createdEmployee;
  try {
    const validationError = validateCoreEmployee(req.body);
    if (validationError) return res.status(400).json({ message: validationError });

    const email = String(req.body.email).toLowerCase().trim();
    const role = String(req.body.role).toLowerCase().trim();
    const [existingEmployee, existingUser] = await Promise.all([
      Employee.findOne({ email }),
      User.findOne({ email }),
    ]);
    if (existingEmployee) return res.status(400).json({ message: "Employee already exists." });
    if (existingUser) return res.status(400).json({ message: "A login account already exists for this email." });
    if (req.body.aadhaar && await Employee.exists({ aadhaar: req.body.aadhaar })) {
      return res.status(400).json({ message: "Aadhaar number already exists." });
    }

    const { employeeId } = await generateEmployeeIdentity();
    const username = email;
    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    const actorName = await getActorName(req);
    const defaultShift = String(req.body.defaultShift || req.body.shift || "").trim();
    const defaultDuty = String(req.body.defaultDuty || "").trim();
    const dutyLocation = String(req.body.dutyLocation || "").trim();
    const access = getRoleAccess(role);

    createdEmployee = await Employee.create({
      ...req.body,
      employeeId,
      username,
      name: String(req.body.name).trim(),
      email,
      password: hashedPassword,
      role,
      shift: String(req.body.shift || defaultShift).trim(),
      defaultShift,
      defaultDuty,
      dutyLocation,
      employmentType: req.body.employmentType || req.body.employeeType || "Full Time",
      status: "Active",
      currentDuty: buildCurrentDuty(req.body),
      createdBy: actorName,
      updatedBy: actorName,
      deletedAt: null,
      deletedBy: "",
    });

    const user = await User.create({
      name: createdEmployee.name,
      email,
      username,
      employeeId,
      phone: createdEmployee.phone || "",
      address: createdEmployee.address || "",
      password: hashedPassword,
      role,
      photo: createdEmployee.photo || "",
      status: "Active",
      accountEnabled: true,
      permissions: access.permissions,
      menuAccess: access.menuAccess,
      provider: "local",
      mustChangePassword: true,
    });
    createdEmployee.userId = user._id;
    await createdEmployee.save();

    await notificationPersistenceService.create({
      title: "New Employee Added",
      message: `${createdEmployee.name} has been added as ${role}`,
      audienceRole: "admin",
      category: "employee",
    });

    await sendEmail({
      to: email,
      subject: "Welcome to Sri Shanti Mahadev Mandir - Your Account Details",
      text: `Hello ${createdEmployee.name},\n\nYour employee profile has been successfully created.\n\nHere are your login credentials:\nEmployee ID: ${employeeId}\nUsername (Email): ${username}\nTemporary Password: ${temporaryPassword}\n\nPlease login using these credentials. You will be required to change your password upon your first login.\n\nBest regards,\nTemple Admin`,
    }).catch(err => console.error("Failed to send welcome email:", err.message));

    return res.status(201).json({
      message: "Employee and login account created successfully.",
      employee: sanitizeEmployee(createdEmployee),
      credentials: { employeeId, username, temporaryPassword },
    });
  } catch (error) {
    if (createdEmployee?._id) {
      await User.deleteOne({ employeeId: createdEmployee.employeeId }).catch(() => {});
      await Employee.deleteOne({ _id: createdEmployee._id }).catch(() => {});
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Employee ID, username, email, or Aadhaar already exists." });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.loginEmployee = async (req, res) => {
  try {
    const identifier = String(req.body.email || req.body.username || "").toLowerCase().trim();
    const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] });
    if (!user) return res.status(400).json({ message: "Employee account not found." });

    const employee =
      (user.employeeId && await Employee.findOne({ employeeId: user.employeeId })) ||
      await Employee.findOne({ email: user.email });
    if (!employee && user.role !== "admin") {
      return res.status(403).json({ message: "Login disabled: Employee record not found." });
    }
    if (!user.accountEnabled || !canLoginForStatus(employee.status)) {
      return res.status(403).json({
        message: `Login is disabled because employee status is ${employee.status}.`,
      });
    }
    const isMatch = await bcrypt.compare(req.body.password || "", user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid password." });

    const lastLogin = new Date();
    user.lastLogin = lastLogin;
    await user.save();
    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "7d" }
    );
    return res.json({ token, employee: { ...sanitizeEmployee(employee), lastLogin } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getEmployees = async (req, res) => {
  try {
    const query = {};
    const {
      search, role, department, status, shift, employmentType,
      joiningFrom, joiningTo, salaryMin, salaryMax,
    } = req.query;
    if (role) query.role = String(role).toLowerCase();
    if (department) query.department = department;
    if (status) query.status = normalizeStatus(status);
    if (shift) query.$or = [{ shift }, { defaultShift: shift }, { "currentDuty.shift": shift }];
    if (employmentType) query.employmentType = employmentType;
    if (joiningFrom || joiningTo) {
      query.joiningDate = {};
      if (joiningFrom) query.joiningDate.$gte = new Date(joiningFrom);
      if (joiningTo) {
        const end = new Date(joiningTo);
        end.setHours(23, 59, 59, 999);
        query.joiningDate.$lte = end;
      }
    }
    if (salaryMin || salaryMax) {
      query.salary = {};
      if (salaryMin) query.salary.$gte = Number(salaryMin);
      if (salaryMax) query.salary.$lte = Number(salaryMax);
    }
    if (search) {
      const matcher = new RegExp(escapeRegExp(search), "i");
      query.$and = [{
        $or: [
          { employeeId: matcher }, { name: matcher }, { email: matcher },
          { phone: matcher }, { department: matcher }, { role: matcher },
        ],
      }];
    }
    const employees = await Employee.find(query).sort({ createdAt: -1 });
    return res.json(employees.map(sanitizeEmployee));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getEmployeeById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid employee ID." });
    }
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: "Employee not found." });

    const user = employee.userId
      ? await User.findById(employee.userId).select("name lastLogin createdAt updatedAt")
      : await User.findOne({ email: employee.email }).select("name lastLogin createdAt updatedAt");
    const identifiers = [employee._id.toString(), employee.employeeId, user?._id?.toString()].filter(Boolean);
    const [attendance, leaveHistory, dutyHistory] = await Promise.all([
      attendanceService.findMany({
        filter: {
          $or: [
            { employeeId: { $in: identifiers } },
            { staffId: { $in: identifiers } },
            { staffEmail: employee.email },
          ],
        },
        sort: { dateKey: -1 },
        limit: 100,
      }),
      leaveService.findMany({
        filter: { staffId: { $in: identifiers } },
        sort: { fromDate: -1 },
        limit: 100,
      }),
      taskService.findMany({
        filter: {
          $or: [
            { employeeId: { $in: identifiers } },
            { staffId: { $in: identifiers } },
            { staffEmail: employee.email },
          ],
        },
        sort: { dueDate: -1, createdAt: -1 },
        limit: 100,
      }),
    ]);

    return res.json({
      ...sanitizeEmployee(employee),
      lastLogin: user?.lastLogin || null,
      details: {
        attendance,
        leaveHistory,
        payroll: {
          monthlySalary: employee.salary,
          employmentType: employee.employmentType,
          status: employee.status === "Active" ? "Active" : "On Hold",
        },
        performance: [],
        dutyHistory,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid employee ID." });
    }
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: "Employee not found." });

    const updateData = { ...req.body };
    [
      "employeeId", "username", "userId",
      "createdAt", "createdBy", "deletedAt", "deletedBy",
    ].forEach((field) => delete updateData[field]);
    const validationError = validateCoreEmployee(updateData, employee);
    if (validationError) return res.status(400).json({ message: validationError });

    if (updateData.email) {
      updateData.email = String(updateData.email).toLowerCase().trim();
      if (await Employee.exists({ email: updateData.email, _id: { $ne: employee._id } })) {
        return res.status(409).json({ message: "Email is already used by another employee." });
      }
      if (await User.exists({ email: updateData.email, _id: { $ne: employee.userId || null } })) {
        return res.status(409).json({ message: "Email is already used by another login account." });
      }
    }
    if (updateData.role) updateData.role = String(updateData.role).toLowerCase().trim();
    if (updateData.status) updateData.status = normalizeStatus(updateData.status, employee.status);
    if (
      updateData.defaultDuty !== undefined ||
      updateData.defaultShift !== undefined ||
      updateData.dutyLocation !== undefined ||
      updateData.currentDuty
    ) {
      updateData.currentDuty = buildCurrentDuty(updateData, employee);
    }
    if (updateData.password) updateData.password = await bcrypt.hash(updateData.password, 10);
    updateData.updatedBy = await getActorName(req);

    const updatedEmployee = await Employee.findByIdAndUpdate(employee._id, updateData, {
      new: true,
      runValidators: true,
    });
    const access = getRoleAccess(updatedEmployee.role);
    const userUpdate = {
      name: updatedEmployee.name,
      email: updatedEmployee.email,
      phone: updatedEmployee.phone || "",
      address: updatedEmployee.address || "",
      role: updatedEmployee.role,
      photo: updatedEmployee.photo || "",
      status: updatedEmployee.status,
      accountEnabled: canLoginForStatus(updatedEmployee.status),
      permissions: access.permissions,
      menuAccess: access.menuAccess,
    };
    if (updateData.password) userUpdate.password = updateData.password;
    await User.findOneAndUpdate(
      { $or: [{ _id: employee.userId }, { employeeId: employee.employeeId }, { email: employee.email }] },
      userUpdate,
      { new: true, runValidators: true }
    );
    return res.json({ message: "Employee updated successfully.", employee: sanitizeEmployee(updatedEmployee) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Email or Aadhaar already exists." });
    return res.status(500).json({ message: error.message });
  }
};

exports.getEmployeeProfileByUserId = async (req, res) => {
  try {
    const { user, employee } = await findUserAndEmployeeByUserId(req.params.userId);
    if (!user || !employee) return res.status(404).json({ message: "Employee profile not found." });
    if (!authorizeProfileOwner(req, user)) return res.status(403).json({ message: "Forbidden." });
    return res.json({
      message: "Profile loaded.",
      profile: { ...sanitizeEmployee(employee), lastLogin: user.lastLogin || null },
      authUser: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        username: user.username || "",
        employeeId: user.employeeId || employee.employeeId || "",
        role: user.role,
        photo: employee.photo || "",
        status: employee.status,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateEmployeeProfileByUserId = async (req, res) => {
  try {
    const { user, employee } = await findUserAndEmployeeByUserId(req.params.userId);
    if (!user || !employee) return res.status(404).json({ message: "Employee profile not found." });
    if (!authorizeProfileOwner(req, user)) return res.status(403).json({ message: "Forbidden." });

    const updateData = {};
    STAFF_PROFILE_EDITABLE_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) updateData[field] = req.body[field];
    });
    if (!Object.keys(updateData).length) {
      return res.status(400).json({ message: "No editable profile fields provided." });
    }
    if (updateData.name !== undefined && !String(updateData.name).trim()) {
      return res.status(400).json({ message: "Name is required." });
    }
    if (updateData.email !== undefined) {
      updateData.email = String(updateData.email).toLowerCase().trim();
      if (!isValidEmail(updateData.email)) return res.status(400).json({ message: "Invalid email address." });
      if (await Employee.exists({ email: updateData.email, _id: { $ne: employee._id } })) {
        return res.status(409).json({ message: "Email is already used by another employee." });
      }
      if (await User.exists({ email: updateData.email, _id: { $ne: user._id } })) {
        return res.status(409).json({ message: "Email is already used by another login account." });
      }
    }
    if (updateData.dob && (!isValidDate(updateData.dob) || !isPastOrToday(updateData.dob))) {
      return res.status(400).json({ message: "Date of birth must be a valid past date." });
    }
    if (updateData.photo !== undefined && !isValidPhoto(updateData.photo)) {
      return res.status(400).json({ message: "Profile photo must be a JPG, PNG, or WebP image up to 5 MB." });
    }
    updateData.updatedBy = user.name;

    const updatedEmployee = await Employee.findByIdAndUpdate(employee._id, updateData, {
      new: true,
      runValidators: true,
    });
    await User.findByIdAndUpdate(user._id, {
      name: updatedEmployee.name,
      email: updatedEmployee.email,
      phone: updatedEmployee.phone || "",
      address: updatedEmployee.address || "",
      photo: updatedEmployee.photo || "",
    });
    return res.json({
      message: "Profile updated successfully.",
      profile: sanitizeEmployee(updatedEmployee),
      authUser: {
        id: user._id.toString(),
        name: updatedEmployee.name,
        email: updatedEmployee.email,
        username: user.username || "",
        employeeId: user.employeeId || updatedEmployee.employeeId || "",
        role: user.role,
        photo: updatedEmployee.photo || "",
        status: updatedEmployee.status,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.changeEmployeePasswordByUserId = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required." });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters." });
    }
    const { user, employee } = await findUserAndEmployeeByUserId(req.params.userId);
    if (!user || !employee) return res.status(404).json({ message: "Employee profile not found." });
    if (!authorizeProfileOwner(req, user)) return res.status(403).json({ message: "Forbidden." });
    if (!await bcrypt.compare(currentPassword, user.password)) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await Promise.all([
      User.findByIdAndUpdate(user._id, { password: hashedPassword, mustChangePassword: false }),
      Employee.findByIdAndUpdate(employee._id, { password: hashedPassword }),
    ]);
    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid employee ID." });
    }
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: "Employee not found." });

    const requestedStatus = normalizeStatus(req.body?.status || req.query.status || "Inactive");
    const status = ["Inactive", "Resigned"].includes(requestedStatus) ? requestedStatus : "Inactive";
    const actorName = await getActorName(req);

    const updatedEmployee = await Employee.findByIdAndUpdate(
      employee._id,
      {
        status,
        deletedAt: new Date(),
        deletedBy: actorName,
        updatedBy: actorName,
      },
      { new: true }
    );

    const userQuery = [];
    if (employee.userId) userQuery.push({ _id: employee.userId });
    if (employee.employeeId) userQuery.push({ employeeId: employee.employeeId });
    if (employee.email) userQuery.push({ email: employee.email });

    if (userQuery.length > 0) {
      await User.findOneAndUpdate(
        { $or: userQuery },
        { status, accountEnabled: false }
      );
    }

    return res.json({
      message: `Employee marked as ${status}. Historical records were preserved.`,
      employee: sanitizeEmployee(updatedEmployee),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.registerFace = async (req, res) => {
  try {
    const { id } = req.params;
    const { faceDescriptor, profilePhoto, facePhotos } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid employee ID." });
    }
    
    if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
      return res.status(400).json({ message: "Valid face descriptor array is required." });
    }
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found." });
    }
    
    employee.faceDescriptor = faceDescriptor;
    employee.faceRegistered = true;
    if (profilePhoto) {
      employee.profilePhoto = profilePhoto;
    }
    if (facePhotos && Array.isArray(facePhotos)) {
      employee.facePhotos = facePhotos;
    }
    
    await employee.save();
    
    return res.status(200).json({ 
      success: true, 
      message: "Face registered successfully.",
      employee: sanitizeEmployee(employee)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
