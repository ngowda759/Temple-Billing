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
}) => {
  if (!title || !message) return null;

  const data = {
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: audienceId ? String(audienceId).trim() : undefined,
    audienceEmail: audienceEmail ? normalizeEmail(audienceEmail) : undefined,
    audienceRole: audienceRole ? String(audienceRole).trim().toLowerCase() : undefined,
    category: category ? String(category).trim() : undefined,
    read: false,
  };

  // If an email is provided, send an email alert
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
    // We send it asynchronously so we don't block the notification creation
    sendEmail({
      to: data.audienceEmail,
      subject: data.title,
      html: emailHtml,
      text: data.message,
    }).catch(err => console.error("Failed to send notification email:", err));
  }

  if (isDbConnected()) {
    return Notification.create(data);
  }

  return fileNotificationStore.createNotification(data);
};

const createStaffNotification = (payload) =>
  createNotification({
    ...payload,
    audienceRole: payload.audienceRole,
  });

const createStaffBroadcastNotifications = async ({ title, message, category }) => {
  if (!title || !message) return [];

  const [users, employees] = await Promise.all([
    User.find({ role: "staff" }).select("_id email name"),
    Employee.find({ role: "staff" }).select("_id email name"),
  ]);

  const recipients = new Map();

  users.forEach((user) => {
    const key = normalizeEmail(user.email) || user._id.toString();
    recipients.set(key, {
      audienceId: user._id.toString(),
      audienceEmail: normalizeEmail(user.email),
    });
  });

  employees.forEach((employee) => {
    const key = normalizeEmail(employee.email) || employee._id.toString();
    if (!recipients.has(key)) {
      recipients.set(key, {
        audienceId: employee._id.toString(),
        audienceEmail: normalizeEmail(employee.email),
      });
    }
  });

  const docs = [...recipients.values()].map((recipient) => ({
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: recipient.audienceId,
    audienceEmail: recipient.audienceEmail || undefined,
    category: category ? String(category).trim() : undefined,
    read: false,
  }));

  if (!docs.length) {
    return Notification.create({
      title: String(title).trim(),
      message: String(message).trim(),
      audienceRole: "staff",
      category: category ? String(category).trim() : undefined,
      read: false,
    });
  }

  return Notification.insertMany(docs);
};

const createBroadcastNotifications = async ({ title, message, category, role }) => {
  if (!title || !message) return [];

  // target users by role or all users if no role provided
  const filter = role ? { role: String(role).trim().toLowerCase() } : {};
  const users = await User.find(filter).select("_id email name");

  const recipients = new Map();
  users.forEach((user) => {
    const key = normalizeEmail(user.email) || user._id.toString();
    recipients.set(key, {
      audienceId: user._id.toString(),
      audienceEmail: normalizeEmail(user.email),
    });
  });

  const docs = [...recipients.values()].map((recipient) => ({
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: recipient.audienceId,
    audienceEmail: recipient.audienceEmail || undefined,
    category: category ? String(category).trim() : undefined,
    read: false,
  }));

  if (!docs.length) {
    return Notification.create({
      title: String(title).trim(),
      message: String(message).trim(),
      audienceRole: role ? String(role).trim().toLowerCase() : undefined,
      category: category ? String(category).trim() : undefined,
      read: false,
    });
  }

  return Notification.create(docs);
};

module.exports = {
  createNotification,
  createStaffNotification,
  createStaffBroadcastNotifications,
  createBroadcastNotifications,
};
