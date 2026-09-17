const Employee = require("../models/Employee");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const notificationPersistenceService = require("../services/notificationPersistenceService");

const ALLOWED_AUTH_ROLES = ["admin", "accountant", "cashier", "priest", "staff"];
const STAFF_PROFILE_EDITABLE_FIELDS = [
  "name", "email", "gender", "dob", "bloodGroup", 
  "phone", "emergencyContact", "address", "photo", "profilePhoto",
  "bankName", "accountNumber",
];

const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(String(email || "").trim());
const isValidDate = (value) => {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const isPastOrToday = (value) => {
  if (!isValidDate(value)) return false;
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date <= today;
};

const sanitizeEmployee = (employeeDoc) => {
  if (!employeeDoc) return null;
  const employee = employeeDoc.toObject ? employeeDoc.toObject() : { ...employeeDoc };
  delete employee.password;
  return employee;
};

const findUserAndEmployeeByUserId = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const employee = await Employee.findById(userId);
    if (!employee) {
      return {};
    }

    const linkedUser = await User.findOne({ email: employee.email });
    return { user: linkedUser, employee };
  }

  let employee = await Employee.findOne({ email: user.email });
  if (!employee && ["admin", "priest", "accountant", "cashier", "staff"].includes(user.role)) {
    const employeeId = "EMP-" + String(user._id).slice(-6).toUpperCase();
    employee = new Employee({
      employeeId,
      userId: user._id,
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      salary: 0,
      joiningDate: new Date(),
    });
    await employee.save();
  }
  return { user, employee };
};

// CREATE EMPLOYEE
exports.createEmployee = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      shift,
      defaultShift,
      defaultDuty,
      dutyLocation,
      department,
      gender,
      dob,
      bloodGroup,
      aadhaar,
      phone,
      address,
      emergencyContact,
      salary,
      joiningDate,
      employmentType,
      photo,
      biometricId,
      bankName,
      accountNumber,
      attendanceLocation,
      faceRegistered,
      faceDescriptor,
      profilePhoto,
      weeklyOff,
    } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();
    const normalizedRole = String(role || "").toLowerCase().trim();
    const normalizedShift = String(shift || defaultShift || "").trim();
    const normalizedDefaultShift = String(defaultShift || shift || "").trim();
    const normalizedDefaultDuty = String(defaultDuty || "").trim();
    const normalizedDutyLocation = String(dutyLocation || "").trim();

    if (!name || !normalizedEmail || !password || !normalizedRole) {
      return res.status(400).json({ message: "Name, email, password and role are required." });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email address." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    if (!ALLOWED_AUTH_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role. Please choose a valid employee role." });
    }

    if (aadhaar && !/^[0-9]{12}$/.test(aadhaar)) {
      return res.status(400).json({
      message: "Aadhaar number must be exactly 12 digits."
      });
    }

    if (!dob || !isValidDate(dob) || !isPastOrToday(dob)) {
      return res.status(400).json({ message: "Date of birth is required and must be a valid past date." });
    }
    
    if (!salary || Number(salary) <= 0) {
  return res.status(400).json({
    message: "Salary must be greater than 0."
  });
}
    if (
  !emergencyContact ||
  !/^[0-9]{10}$/.test(emergencyContact)
) {
  return res.status(400).json({
    message: "Valid emergency contact is required."
  });
}

    if (!bankName || bankName.trim() === "") {
      return res.status(400).json({ message: "Bank Name is required." });
    }

    if (!accountNumber || accountNumber.trim() === "" || !/^[0-9]{9,18}$/.test(accountNumber)) {
      return res.status(400).json({ message: "Valid Account Number (9-18 digits) is required." });
    }

    // joiningDate is optional and may be a future date (planned join).
    // If provided, ensure it's a valid date and consistent with DOB.
    if (!joiningDate || !isValidDate(joiningDate)) {
  return res.status(400).json({
    message: "Joining Date is required."
  });
}

    const dobDate = new Date(dob);
const joiningDateObj = new Date(joiningDate);

// Employee age validation
const today = new Date();

let currentAge =
  today.getFullYear() -
  dobDate.getFullYear();

if (
  today.getMonth() < dobDate.getMonth() ||
  (today.getMonth() === dobDate.getMonth() &&
    today.getDate() < dobDate.getDate())
) {
  currentAge--;
}

if (currentAge < 18) {
  return res.status(400).json({
    message: "Employee must be at least 18 years old."
  });
}

// Employee must complete 18 years before joining

const eighteenthBirthday = new Date(dobDate);

eighteenthBirthday.setFullYear(
  eighteenthBirthday.getFullYear() + 18
);

if (joiningDateObj < eighteenthBirthday) {
  return res.status(400).json({
    message:
      "Joining date must be after employee turns 18 years old."
  });
}

// Joining date cannot be future

if (joiningDateObj > today) {
  return res.status(400).json({
    message:
      "Joining date cannot be in the future."
  });
}

    if (aadhaar) {
  const existingAadhaar = await Employee.findOne({
    aadhaar
  });

  if (existingAadhaar) {
    return res.status(400).json({
      message: "Aadhaar number already exists."
    });
  }
}

    const existingEmployee = await Employee.findOne({ email: normalizedEmail });
    if (existingEmployee) {
      return res.status(400).json({ message: "Employee already exists." });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: "A login account already exists for this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const employee = await Employee.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: normalizedRole,
      shift: normalizedShift,
      defaultShift: normalizedDefaultShift,
      department,
      gender,
      dob,
      bloodGroup,
      aadhaar,
      phone,
      address,
      emergencyContact,
      salary,
      joiningDate,
      employmentType,
      defaultDuty: normalizedDefaultDuty,
      dutyLocation: normalizedDutyLocation,
      biometricId,
      photo,
      profilePhoto,
      bankName: bankName.trim(),
      accountNumber: accountNumber.trim(),
      attendanceLocation: attendanceLocation || null,
      faceRegistered: faceRegistered || false,
      faceDescriptor: faceDescriptor || [],
      weeklyOff: weeklyOff || "",
    });

    await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: normalizedRole,
      provider: "local",
      mustChangePassword: false,
    });

    await notificationPersistenceService.create({
  title: "New Employee Added",
  message: `${name} has been added as ${normalizedRole}`,
  audienceRole: "admin",
  category: "employee",
});

    res.status(201).json({ message: "Employee created successfully", employee: sanitizeEmployee(employee) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// LOGIN
exports.loginEmployee = async (req, res) => {
  try {
    const { email, password } = req.body;

    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.status(400).json({ message: "Employee not found" });
    }

    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign({ id: employee._id, role: employee.role }, "temple_secret_key", { expiresIn: "7d" });
    res.json({ token, employee: sanitizeEmployee(employee) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET ALL EMPLOYEES
exports.getEmployees = async (req, res) => {
  try {
    const employees = await Employee.find().sort({ createdAt: -1 });
    res.json(employees.map(sanitizeEmployee));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET EMPLOYEE BY ID
exports.getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    res.json(sanitizeEmployee(employee));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// UPDATE EMPLOYEE (ADMIN)
exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingEmployee = await Employee.findById(id);
    if (!existingEmployee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (updateData.email) {
      const normalizedEmail = String(updateData.email).toLowerCase().trim();
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: "Invalid email address." });
      }
      if (normalizedEmail !== existingEmployee.email) {
        const duplicateEmployee = await Employee.findOne({ email: normalizedEmail, _id: { $ne: existingEmployee._id } });
        if (duplicateEmployee) {
          return res.status(400).json({ message: "Email is already used by another employee." });
        }
        const duplicateUser = await User.findOne({ email: normalizedEmail });
        if (duplicateUser) {
          return res.status(400).json({ message: "Email is already used by another account." });
        }
      }
      updateData.email = normalizedEmail;
    }

    if (updateData.bankName !== undefined) {
      if (!updateData.bankName || String(updateData.bankName).trim() === "") {
        return res.status(400).json({ message: "Bank Name is required." });
      }
      updateData.bankName = String(updateData.bankName).trim();
    }

    if (updateData.accountNumber !== undefined) {
      const acc = String(updateData.accountNumber).trim();
      if (!acc || !/^[0-9]{9,18}$/.test(acc)) {
        return res.status(400).json({ message: "Valid Account Number (9-18 digits) is required." });
      }
      updateData.accountNumber = acc;
    }

    if (updateData.weeklyOff !== undefined) {
      updateData.weeklyOff = String(updateData.weeklyOff).trim();
    }


    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    const employee = await Employee.findByIdAndUpdate(id, updateData, { new: true });

    const userUpdate = {};
    if (updateData.name) userUpdate.name = updateData.name;
    if (updateData.email) userUpdate.email = updateData.email;
    if (updateData.role) userUpdate.role = updateData.role;
    if (updateData.password) userUpdate.password = updateData.password;
    if (Object.keys(userUpdate).length > 0) {
      await User.findOneAndUpdate({ email: existingEmployee.email }, userUpdate, { new: true });
    }

    res.json({ message: "Employee updated successfully", employee: sanitizeEmployee(employee) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// STAFF PROFILE BY AUTH USER ID
exports.getEmployeeProfileByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const { user, employee } = await findUserAndEmployeeByUserId(userId);

    if (!user || !employee) {
      return res.status(404).json({ message: "Employee profile not found" });
    }

    return res.json({
      message: "Profile loaded",
      profile: sanitizeEmployee(employee),
      authUser: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// STAFF PROFILE UPDATE BY AUTH USER ID
exports.updateEmployeeProfileByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const { user, employee } = await findUserAndEmployeeByUserId(userId);

    if (!user || !employee) {
      return res.status(404).json({ message: "Employee profile not found" });
    }

    const updateData = {};
    STAFF_PROFILE_EDITABLE_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updateData[field] = req.body[field];
      }
    });

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No editable profile fields provided." });
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "name")) {
      const normalizedName = String(updateData.name || "").trim();
      if (!normalizedName) {
        return res.status(400).json({ message: "Name is required." });
      }
      updateData.name = normalizedName;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "email")) {
      const normalizedEmail = String(updateData.email || "").toLowerCase().trim();
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: "Invalid email address." });
      }
      if (normalizedEmail !== employee.email) {
        const existingEmployee = await Employee.findOne({ email: normalizedEmail, _id: { $ne: employee._id } });
        if (existingEmployee) {
          return res.status(400).json({ message: "Email is already used by another employee." });
        }
        const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
        if (existingUser) {
          return res.status(400).json({ message: "Email is already used by another account." });
        }
      }
      updateData.email = normalizedEmail;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "bloodGroup")) {
      updateData.bloodGroup = String(updateData.bloodGroup || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "dob")) {
      if (updateData.dob && (!isValidDate(updateData.dob) || !isPastOrToday(updateData.dob))) {
        return res.status(400).json({ message: "Date of birth must be a valid past date." });
      }
      updateData.dob = String(updateData.dob || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "phone")) {
      updateData.phone = String(updateData.phone || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "emergencyContact")) {
      updateData.emergencyContact = String(updateData.emergencyContact || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "address")) {
      updateData.address = String(updateData.address || "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(updateData, "photo")) {
      updateData.photo = String(updateData.photo || "").trim();
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(employee._id, updateData, { new: true });

    const userUpdates = {};
    if (Object.prototype.hasOwnProperty.call(updateData, "name")) userUpdates.name = updateData.name;
    if (Object.prototype.hasOwnProperty.call(updateData, "email")) userUpdates.email = updateData.email;
    if (Object.prototype.hasOwnProperty.call(updateData, "photo")) userUpdates.photo = updateData.photo;
    if (Object.prototype.hasOwnProperty.call(updateData, "phone")) userUpdates.phone = updateData.phone;
    if (Object.prototype.hasOwnProperty.call(updateData, "address")) userUpdates.address = updateData.address;
    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(user._id, userUpdates, { new: true });
    }

    return res.json({
      message: "Profile updated successfully",
      profile: sanitizeEmployee(updatedEmployee),
      authUser: {
        id: user._id.toString(),
        name: userUpdates.name || user.name,
        email: userUpdates.email || user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// STAFF PASSWORD CHANGE BY AUTH USER ID
exports.changeEmployeePasswordByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters." });
    }

    const { user, employee } = await findUserAndEmployeeByUserId(userId);
    if (!user || !employee) {
      return res.status(404).json({ message: "Employee profile not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(user._id, { password: hashedPassword, mustChangePassword: false }, { new: true });
    await Employee.findByIdAndUpdate(employee._id, { password: hashedPassword }, { new: true });

    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// DELETE EMPLOYEE
exports.deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findByIdAndDelete(id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    await User.deleteMany({
      $or: [
        { email: employee.email },
        { employeeId: employee.employeeId }
      ]
    });
    res.json({ message: "Employee deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
