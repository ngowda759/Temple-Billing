const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Employee = require("../models/Employee");
const dbConfig = require("../config/db");
const {
  findUserByEmail: findFileUserByEmail,
  findUserById: findFileUserById,
  createUser: createFileUser,
  updateUser: updateFileUser,
  getAllUsers: getAllFileUsers,
} = require("../store/fileUserStore");
const { createStaffNotification } = require("../utils/notificationService");
const { buildEmailLookup, normalizeEmail } = require("../utils/email");
const { canLoginForStatus } = require("../utils/employeeAccess");


const ALLOWED_ROLES = ["admin", "accountant", "cashier", "priest", "staff", "devotee"];

const normalizeDevoteeEmail = normalizeEmail;

const sanitizeUser = (userDoc) => ({
  id: userDoc._id?.toString?.() || userDoc.id,
  name: userDoc.name,
  email: normalizeDevoteeEmail(userDoc.email),
  phone: userDoc.phone || "",
  address: userDoc.address || "",
  place: userDoc.place || "",
  role: userDoc.role,
  username: userDoc.username || "",
  employeeId: userDoc.employeeId || "",
  photo: userDoc.photo || "",
  status: userDoc.status || "Active",
  lastLogin: userDoc.lastLogin || null,
  permissions: userDoc.permissions || [],
  menuAccess: userDoc.menuAccess || [],
  createdAt: userDoc.createdAt || userDoc.createdAt?.toISOString?.() || undefined,
  mustChangePassword: Boolean(userDoc.mustChangePassword),
});

const findUserByEmail = async (email) => {
  const normalizedEmail = normalizeDevoteeEmail(email);
  if (!normalizedEmail) return null;

  if (dbConfig.isDbConnected()) {
    return User.findOne(buildEmailLookup("email", normalizedEmail));
  }

  return findFileUserByEmail(normalizedEmail);
};

const findUserByPhone = async (phone) => {
  const trimmedPhone = String(phone || "").trim();
  if (!trimmedPhone) return null;

  if (dbConfig.isDbConnected()) {
    return User.findOne({ phone: trimmedPhone });
  }

  const users = await getAllFileUsers();
  return users.find((user) => String(user.phone || "").trim() === trimmedPhone) || null;
};




const createUserRecord = async ({ name, email, password, role, phone, address, place }) => {
  const normalizedEmail = normalizeDevoteeEmail(email);
  if (dbConfig.isDbConnected()) {
    return User.create({ name, email: normalizedEmail, password, role, phone, address, place, provider: "local" });
  }
  return createFileUser({ name, email: normalizedEmail, password, role, phone, address, place, provider: "local" });
};

const updateUserRecord = async (id, updates) => {
  if (dbConfig.isDbConnected()) {
    return User.findByIdAndUpdate(id, updates, { new: true });
  }
  return updateFileUser(id, updates);
};

const findUserById = async (id) => {
  if (dbConfig.isDbConnected()) {
    return User.findById(id);
  }
  return findFileUserById(id);
};

const htmlTemplate = (title, message, isSuccess) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body {
      background: linear-gradient(135deg, #fef3c7, #ffedd5, #fef08a);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 24px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 50px rgba(120, 50, 0, 0.12);
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #7c2d12;
      font-size: 28px;
      margin: 0 0 10px 0;
    }
    p {
      color: #451a03;
      font-size: 16px;
      line-height: 1.6;
      margin: 0 0 30px 0;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(to right, #ea580c, #d97706);
      color: #fff;
      text-decoration: none;
      font-weight: bold;
      padding: 14px 28px;
      border-radius: 12px;
      transition: all 0.2s;
      box-shadow: 0 10px 20px rgba(234, 88, 12, 0.2);
    }
    .btn:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "✅" : "❌"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="http://localhost:5173/" class="btn">Go to Login</a>
  </div>
</body>
</html>
`;

const sendVerificationLink = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, phone, address, place, role } = req.body;
    const normalizedEmail = normalizeDevoteeEmail(email);
    const normalizedRole = String(role || "devotee").toLowerCase().trim();

    // Validate required fields
    if (!name || !email || !password || !confirmPassword || !phone || !place || !address) {
      return res.status(400).json({ message: "Name, email, phone number, place/city, address, password, and confirm password are required" });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    // Validate phone number: strictly 10 digits
    const cleanedPhone = phone.trim();
    if (!/^[0-9]{10}$/.test(cleanedPhone)) {
      return res.status(400).json({ message: "Phone number must be strictly 10 digits (numbers only)" });
    }

    // Validate place: characters and spaces only
    const cleanedPlace = place.trim();
    if (!/^[a-zA-Z\s]+$/.test(cleanedPlace)) {
      return res.status(400).json({ message: "Place/City must contain characters only" });
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    const existingUser = await findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(400).json({ message: "User already exists with this email" });
    }

    const existingUserByPhone = await findUserByPhone(cleanedPhone);
    if (existingUserByPhone) {
      return res.status(400).json({ message: "User already exists with this phone number" });
    }

    // Hash password now so we don't send raw passwords in JWT token
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a verification token valid for 15 minutes
    const token = jwt.sign(
      {
        name: name.trim(),
        email: normalizedEmail,
        phone: cleanedPhone,
        address: address.trim(),
        place: cleanedPlace,
        password: hashedPassword,
        role: normalizedRole,
      },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "15m" }
    );

    const verificationLink = `http://localhost:5000/api/auth/verify-registration?token=${token}`;

    const { sendEmail } = require("../utils/communicationService");

    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: "Verify Your Temple Devotee Registration",
      text: `Please click the following link to verify your email and complete devotee registration: ${verificationLink}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #451a03; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #ffedd5; border-radius: 16px; background-color: #fffbeb;">
          <div style="text-align: center; margin-bottom: 20px;">
            <span style="font-size: 40px;">🙏</span>
            <h2 style="color: #7c2d12; margin: 10px 0 0 0; font-size: 24px;">Temple Devotee Registration</h2>
          </div>
          <p>Dear <strong>${name.trim()}</strong>,</p>
          <p>Thank you for registering. Please click the button below to verify your email address and complete your devotee registration:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" style="background: linear-gradient(to right, #ea580c, #d97706); color: white; padding: 14px 30px; text-decoration: none; font-weight: bold; border-radius: 12px; box-shadow: 0 5px 15px rgba(234,88,12,0.3); display: inline-block;">Verify Email & Register</a>
          </div>
          <p style="font-size: 13px; color: #78350f; text-align: center; margin-top: 35px; border-top: 1px solid #ffedd5; padding-top: 15px;">
            This link is valid for <strong>15 minutes</strong>. If you did not request this, please ignore this email.
          </p>
        </div>
      `
    });

    if (emailResult && emailResult.success === false) {
      return res.status(500).json({ message: `Failed to send verification link: ${emailResult.error}` });
    }

    return res.status(200).json({
      message: "Verification link sent successfully to your email. Please check your inbox.",
      verificationLink: verificationLink
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const verifyRegistration = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(htmlTemplate("Verification Failed", "Verification token is missing.", false));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    } catch (err) {
      return res.status(400).send(htmlTemplate("Verification Failed", "Verification link is invalid or has expired. Please register again.", false));
    }

    const { name, email, phone, address, place, password, role } = decoded;

    // Check if user already registered in the meantime
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(400).send(htmlTemplate("Already Verified", "User with this email is already registered.", false));
    }

    const existingUserByPhone = await findUserByPhone(phone);
    if (existingUserByPhone) {
      return res.status(400).send(htmlTemplate("Already Verified", "User with this phone number is already registered.", false));
    }

    const user = await createUserRecord({
      name,
      email,
      phone,
      address,
      place,
      password, // Already hashed in sendVerificationLink
      role,
    });

    // Notify cashier role about new devotee registration
    createStaffNotification({
      title: "🙏 New Devotee Registered",
      message: `Devotee "${name}" (${phone}) has verified their email and registered successfully.`,
      audienceRole: "cashier",
      category: "registration",
    }).catch(() => {});

    return res.status(201).send(htmlTemplate("Verification Successful", "Your email has been verified and registration is complete! You can now log in.", true));
  } catch (error) {
    return res.status(500).send(htmlTemplate("Verification Failed", error.message, false));
  }
};

const registerUser = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, phone, address, place, role } = req.body;
    const normalizedEmail = normalizeDevoteeEmail(email);
    const normalizedRole = String(role || "").toLowerCase().trim();

    // Verify authorized context (Cashier or Admin only can use this endpoint directly)
    let isAuthorized = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
        if (decoded && ["admin", "cashier", "accountant", "staff"].includes(decoded.role)) {
          isAuthorized = true;
        }
      } catch (err) {
        // invalid token
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: "Direct devotee registration is not allowed. Please use the verification link." });
    }

    // Validate required fields
    if (!name || !email || !password || !confirmPassword || !phone || !place || !address) {
      return res.status(400).json({ message: "Name, email, phone number, place/city, address, password, and confirm password are required" });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    // Validate phone number: strictly 10 digits
    const cleanedPhone = phone.trim();
    if (!/^[0-9]{10}$/.test(cleanedPhone)) {
      return res.status(400).json({ message: "Phone number must be strictly 10 digits (numbers only)" });
    }

    // Validate place: characters and spaces only
    const cleanedPlace = place.trim();
    if (!/^[a-zA-Z\s]+$/.test(cleanedPlace)) {
      return res.status(400).json({ message: "Place/City must contain characters only" });
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    const existingUser = await findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(400).json({ message: "User already exists with this email" });
    }

    const existingUserByPhone = await findUserByPhone(cleanedPhone);
    if (existingUserByPhone) {
      return res.status(400).json({ message: "User already exists with this phone number" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await createUserRecord({
      name: name.trim(),
      email: normalizedEmail,
      phone: cleanedPhone,
      address: address.trim(),
      place: cleanedPlace,
      password: hashedPassword,
      role: normalizedRole,
    });

    // Notify cashier role about new devotee registration
    createStaffNotification({
      title: "🙏 New Devotee Registered",
      message: `Devotee "${name}" (${cleanedPhone}) has been registered successfully and can now log in.`,
      audienceRole: "cashier",
      category: "registration",
    }).catch(() => {});

    return res.status(201).json({
      message: "Registration successful",
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const issueAuthResponse = (res, user, message = "Login successful") => {
  const token = jwt.sign({ id: user._id?.toString?.() || user.id, role: user.role }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "7d",
  });

  return res.status(200).json({
    message,
    token,
    user: sanitizeUser(user),
  });
};

const loginUser = async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const normalizedEmail = normalizeDevoteeEmail(email);
    const normalizedRole = String(role || "").toLowerCase().trim();

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = dbConfig.isDbConnected()
      ? await User.findOne({
          $or: [
            buildEmailLookup("email", normalizedEmail),
            { username: normalizedEmail },
          ],
        })
      : await findUserByEmail(normalizedEmail);
    if (!user) {
      if (normalizedRole && normalizedRole !== "devotee") {
        return res.status(400).json({
          message: "Account not found for selected role. Please contact admin for role-assigned credentials.",
        });
      }
      return res.status(400).json({ message: "User not registered. Please register as devotee." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const employee = user.role !== "devotee"
      ? (
          (user.employeeId && await Employee.findOne({ employeeId: user.employeeId })) ||
          await Employee.findOne({ email: user.email })
        )
      : null;

    // Block login if employee record was deleted, unless the user is an admin or devotee
    if (user.role !== "devotee" && user.role !== "admin" && !employee) {
      return res.status(403).json({ message: "Login disabled: Employee record not found." });
    }

    const effectiveStatus = employee?.status || user.status || "Active";
    if (user.accountEnabled === false || !canLoginForStatus(effectiveStatus)) {
      return res.status(403).json({
        message: `Login is disabled because employee status is ${effectiveStatus}.`,
      });
    }

    const lastLogin = new Date();
    if (dbConfig.isDbConnected()) {
      user.lastLogin = lastLogin;
      user.status = effectiveStatus;
      if (employee?.photo) user.photo = employee.photo;
      await user.save();
    }

    if (normalizedRole) {
      const isStaffInternalRole = ["staff", "accountant", "cashier", "priest"].includes(user.role);
      
      let isRoleValid = false;
      if (normalizedRole === "staff" && isStaffInternalRole) {
        isRoleValid = true;
      } else if (normalizedRole === user.role) {
        isRoleValid = true;
      }

      if (!isRoleValid) {
        return res.status(403).json({
          message: "Please select correct role.",
        });
      }
    }

    return issueAuthResponse(res, user);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getUsersForAdmin = async (req, res) => {
  try {
    let users = [];
    if (dbConfig.isDbConnected()) {
      users = await User.find()
        .select("-password -resetPasswordToken -resetPasswordExpiresAt")
        .sort({ createdAt: -1 });
    } else {
      users = await getAllFileUsers();
    }
    const sanitizedUsers = users.map(sanitizeUser);
    return res.status(200).json(sanitizedUsers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const createUserByAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const normalizedEmail = normalizeDevoteeEmail(email);
    const normalizedRole = String(role || "").toLowerCase().trim();

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Name, email, password and role are required" });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    if (!ALLOWED_ROLES.includes(normalizedRole) || normalizedRole === "devotee") {
      return res.status(400).json({ message: "Admin can assign only non-devotee roles" });
    }

    const existingUser = await findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let user;
    if (dbConfig.isDbConnected()) {
      user = await User.create({
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: normalizedRole,
        provider: "local",
        mustChangePassword: false,
      });
    } else {
      user = await createFileUser({
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: normalizedRole,
        provider: "local",
        mustChangePassword: false,
      });
    }

    return res.status(201).json({ message: "User created by admin", user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updatedUser = await updateUserRecord(user._id?.toString?.() || user.id, {
      password: hashedPassword,
      mustChangePassword: false,
    });

    return issueAuthResponse(res, updatedUser, "Password changed successfully");
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const normalizedEmail = normalizeDevoteeEmail(req.body.email);
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }
    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const resetToken = crypto.randomBytes(24).toString("hex");
    const resetPasswordExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await updateUserRecord(user._id?.toString?.() || user.id, { resetPasswordToken: resetToken, resetPasswordExpiresAt });

    const resetLink = `http://localhost:5173/forgot-password?token=${resetToken}&email=${normalizedEmail}`;
    const { sendEmail } = require("../utils/communicationService");

    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: "Reset Your Temple Account Password",
      text: `Please click the following link to reset your account password: ${resetLink}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #451a03; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #ffedd5; border-radius: 16px; background-color: #fffbeb;">
          <div style="text-align: center; margin-bottom: 20px;">
            <span style="font-size: 40px;">🔑</span>
            <h2 style="color: #7c2d12; margin: 10px 0 0 0; font-size: 24px;">Password Reset Request</h2>
          </div>
          <p>Dear Devotee,</p>
          <p>We received a request to reset your password. Please click the button below to set a new password for your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background: linear-gradient(to right, #ea580c, #d97706); color: white; padding: 14px 30px; text-decoration: none; font-weight: bold; border-radius: 12px; box-shadow: 0 5px 15px rgba(234,88,12,0.3); display: inline-block;">Reset Password</a>
          </div>
          <p style="font-size: 13px; color: #78350f; text-align: center; margin-top: 35px; border-top: 1px solid #ffedd5; padding-top: 15px;">
            This password reset link is valid for <strong>15 minutes</strong>. If you did not request a password reset, please ignore this email.
          </p>
        </div>
      `
    });

    if (emailResult && emailResult.success === false) {
      return res.status(500).json({ message: `Failed to send reset link email: ${emailResult.error}` });
    }

    return res.status(200).json({
      message: "Password reset link sent successfully to your email. Please check your inbox.",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    const normalizedEmail = normalizeDevoteeEmail(email);
    if (!normalizedEmail || !token || !newPassword) {
      return res.status(400).json({ message: "Email, token and new password are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isExpired = !user.resetPasswordExpiresAt || new Date(user.resetPasswordExpiresAt).getTime() < Date.now();
    if (user.resetPasswordToken !== token || isExpired) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await updateUserRecord(user._id?.toString?.() || user.id, {
      password: hashedPassword,
      mustChangePassword: false,
      resetPasswordToken: null,
      resetPasswordExpiresAt: null,
    });

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const googleLogin = async (req, res) => {
  try {
    const normalizedEmail = normalizeDevoteeEmail(req.body.email);
    const name = String(req.body.name || "Devotee");
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Google email is required" });
    }

    let user = await findUserByEmail(normalizedEmail);
    if (!user) {
      const randomPassword = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
      if (dbConfig.isDbConnected()) {
        user = await User.create({
          name,
          email: normalizedEmail,
          password: randomPassword,
          role: "devotee",
          provider: "google",
          mustChangePassword: false,
        });
      } else {
        user = await createFileUser({
          name,
          email: normalizedEmail,
          password: randomPassword,
          role: "devotee",
          provider: "google",
          mustChangePassword: false,
        });
      }
    } else if (user.role !== "devotee") {
      return res.status(403).json({ message: "Google login is only allowed for devotee accounts" });
    }

    return issueAuthResponse(res, user, "Google login successful");
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getDevoteesForCashier = async (req, res) => {
  try {
    let users = [];
    if (dbConfig.isDbConnected()) {
      users = await User.find({ role: "devotee" })
        .select("-password -resetPasswordToken -resetPasswordExpiresAt")
        .sort({ createdAt: -1 });
    } else {
      users = (await getAllFileUsers()).filter(u => u.role === "devotee");
    }
    const sanitizedUsers = users.map(sanitizeUser);
    return res.status(200).json(sanitizedUsers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerUser,
  sendVerificationLink,
  verifyRegistration,
  loginUser,
  createUserByAdmin,
  getUsersForAdmin,
  changePassword,
  forgotPassword,
  resetPassword,
  googleLogin,
  getDevoteesForCashier,
};
