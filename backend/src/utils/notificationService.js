const Notification = require("../models/Notification");
const Employee = require("../models/Employee");
const User = require("../models/User");

const { isDbConnected } = require("../config/db");
const fileNotificationStore = require("../store/fileNotificationStore");
const { sendEmail } = require("./communicationService");

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const createNotification = async ({
  title,
  message,
  audienceId,
  audienceEmail,
  audienceRole,
  category,
  attachment,
}) => {
  if (!title || !message) return null;

  const data = {
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: audienceId ? String(audienceId).trim() : undefined,
    audienceEmail: audienceEmail ? normalizeEmail(audienceEmail) : undefined,
    audienceRole: audienceRole ? String(audienceRole).trim().toLowerCase() : undefined,
    category: category ? String(category).trim() : undefined,
    attachment: attachment || undefined,
    read: false,
  };

  if (isDbConnected()) {
    return Notification.create(data);
  }

  // Fallback for file store when DB is disconnected
  if (data.audienceEmail) {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #d4a574;">${data.title}</h2>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p>${data.message}</p>
        </div>
        <p>Best regards,<br>Temple Management</p>
      </div>
    `;
    sendEmail({
      to: data.audienceEmail,
      subject: data.title,
      html: emailHtml,
      text: data.message,
    }).catch((err) => console.error("Failed to send notification email:", err));
  }

  return fileNotificationStore.createNotification(data);
};

const createStaffNotification = (payload) =>
  createNotification({
    ...payload,
    audienceRole: payload.audienceRole,
  });

/**
 * Broadcast notification to all temple employees (admin, priest, accountant, cashier, staff)
 */
const createEmployeeBroadcastNotifications = async ({ title, message, category, attachment }) => {
  if (!title || !message) return [];

  const employeeRoles = ["admin", "priest", "accountant", "cashier", "staff"];
  const [users, employees] = await Promise.all([
    User.find({ role: { $in: employeeRoles } }).select("_id email name role"),
    Employee.find({ status: { $ne: "Inactive" } }).select("_id email name role"),
  ]);

  const recipients = new Map();

  users.forEach((user) => {
    const email = normalizeEmail(user.email);
    const key = email || user._id.toString();
    recipients.set(key, {
      audienceId: user._id.toString(),
      audienceEmail: email || undefined,
      audienceRole: user.role || "staff",
    });
  });

  employees.forEach((employee) => {
    const email = normalizeEmail(employee.email);
    const key = email || employee._id.toString();
    if (recipients.has(key)) {
      const existing = recipients.get(key);
      if (!existing.audienceRole && employee.role) {
        existing.audienceRole = employee.role;
      }
    } else {
      recipients.set(key, {
        audienceId: employee._id.toString(),
        audienceEmail: email || undefined,
        audienceRole: employee.role || "staff",
      });
    }
  });

  const docs = [...recipients.values()].map((recipient) => ({
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: recipient.audienceId,
    audienceEmail: recipient.audienceEmail || undefined,
    audienceRole: recipient.audienceRole || "staff",
    category: category ? String(category).trim() : "event",
    attachment: attachment || undefined,
    read: false,
  }));

  if (!docs.length) {
    return Notification.create({
      title: String(title).trim(),
      message: String(message).trim(),
      audienceRole: "staff",
      category: category ? String(category).trim() : "event",
      attachment: attachment || undefined,
      read: false,
    });
  }

  // Notification.create with array executes save hooks so automated emails are sent!
  return Notification.create(docs);
};

const createStaffBroadcastNotifications = createEmployeeBroadcastNotifications;

/**
 * Broadcast notification to all registered devotees (or specified role)
 */
const createBroadcastNotifications = async ({ title, message, category, role = "devotee", attachment }) => {
  if (!title || !message) return [];

  const filter = role ? { role: String(role).trim().toLowerCase() } : { role: "devotee" };
  const users = await User.find(filter).select("_id email name role");

  const recipients = new Map();
  users.forEach((user) => {
    const email = normalizeEmail(user.email);
    const key = email || user._id.toString();
    recipients.set(key, {
      audienceId: user._id.toString(),
      audienceEmail: email || undefined,
      audienceRole: user.role || "devotee",
    });
  });

  const docs = [...recipients.values()].map((recipient) => ({
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: recipient.audienceId,
    audienceEmail: recipient.audienceEmail || undefined,
    audienceRole: recipient.audienceRole || "devotee",
    category: category ? String(category).trim() : "event",
    attachment: attachment || undefined,
    read: false,
  }));

  if (!docs.length) {
    return Notification.create({
      title: String(title).trim(),
      message: String(message).trim(),
      audienceRole: role ? String(role).trim().toLowerCase() : "devotee",
      category: category ? String(category).trim() : "event",
      attachment: attachment || undefined,
      read: false,
    });
  }

  return Notification.create(docs);
};

module.exports = {
  createNotification,
  createStaffNotification,
  createStaffBroadcastNotifications,
  createEmployeeBroadcastNotifications,
  createBroadcastNotifications,
};
