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

const sendBroadcastEmail = async ({ title, message, category, attachment, bccEmails, isEmployee = false }) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanedBcc = [
    ...new Set(
      (bccEmails || [])
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => emailRegex.test(e))
    ),
  ];
  if (!cleanedBcc.length) return;

  const attachments = [];
  const attachmentDetails = {
    hasImage: false,
    imageSrc: "",
    isPdf: false,
    filename: "",
  };

  if (attachment && typeof attachment === "string") {
    const trimmedAtt = attachment.trim();
    if (trimmedAtt.startsWith("data:image/")) {
      const match = trimmedAtt.match(/^data:(image\/([a-zA-Z0-9+]+));base64,(.+)$/);
      if (match) {
        const contentType = match[1];
        const rawExt = match[2].toLowerCase();
        const ext = rawExt === "jpeg" ? "jpg" : rawExt;
        const buffer = Buffer.from(match[3], "base64");
        const cid = "temple_invitation_banner";
        const filename = `invitation_banner.${ext}`;

        attachments.push({
          filename,
          content: buffer,
          contentType,
          cid,
        });

        attachmentDetails.hasImage = true;
        attachmentDetails.imageSrc = `cid:${cid}`;
        attachmentDetails.filename = filename;
      }
    } else if (trimmedAtt.startsWith("data:application/pdf")) {
      const match = trimmedAtt.match(/^data:application\/pdf;base64,(.+)$/);
      if (match) {
        const buffer = Buffer.from(match[1], "base64");
        const safeTitle = (title || "Event").replace(/[^a-zA-Z0-9_-]/g, "_");
        const filename = `Invitation_${safeTitle}.pdf`;

        attachments.push({
          filename,
          content: buffer,
          contentType: "application/pdf",
        });

        attachmentDetails.isPdf = true;
        attachmentDetails.filename = filename;
      }
    } else if (trimmedAtt.startsWith("http://") || trimmedAtt.startsWith("https://")) {
      if (/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i.test(trimmedAtt) || trimmedAtt.includes("/image/")) {
        attachmentDetails.hasImage = true;
        attachmentDetails.imageSrc = trimmedAtt;
      } else if (/\.pdf($|\?)/i.test(trimmedAtt)) {
        attachmentDetails.isPdf = true;
        attachmentDetails.filename = "Invitation.pdf";
      }
    }
  }

  const formattedDate = new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8"></head>
      <body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: 'Segoe UI', Arial, sans-serif; color: #2d1b08;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #faf6f0; padding: 30px 15px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(184, 94, 0, 0.08); border: 1px solid #f4e4d0;">
                <tr>
                  <td style="background: linear-gradient(135deg, #b46a13 0%, #ea580c 100%); padding: 28px 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800;">Sri Shanti Mahadev Mandir</h1>
                    <p style="color: #fde8cc; margin: 6px 0 0 0; font-size: 13px; font-weight: 600; text-transform: uppercase;">Temple Services</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 35px 35px 25px 35px;">
                    <div style="display: inline-block; background-color: #fcf0e4; color: #b46a13; font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 20px; text-transform: uppercase; margin-bottom: 15px;">
                      ${(category || "EVENT").toUpperCase()}
                    </div>
                    <h2 style="color: #2d1b08; margin: 0 0 15px 0; font-size: 22px; font-weight: 700;">
                      ${title}
                    </h2>
                    ${attachmentDetails.hasImage ? `
                      <div style="margin: 18px 0 24px 0; text-align: center; border-radius: 12px; overflow: hidden; border: 1px solid #ebd8c3;">
                        <img src="${attachmentDetails.imageSrc}" alt="${title}" style="max-width: 100%; width: 100%; height: auto; display: block;" />
                      </div>
                    ` : ""}
                    ${attachmentDetails.isPdf ? `
                      <div style="background-color: #fff9f2; border: 1.5px dashed #ea580c; border-radius: 12px; padding: 18px 20px; margin: 18px 0 22px 0; text-align: center;">
                        <h3 style="margin: 0; color: #9a3412; font-size: 16px;">📄 Official Invitation (PDF Attached)</h3>
                      </div>
                    ` : ""}
                    <div style="background-color: #fbf8f5; border-left: 4px solid #ea580c; border-radius: 8px; padding: 18px 20px; margin: 15px 0 25px 0;">
                      <p style="margin: 0; color: #4a3828; font-size: 15px; line-height: 1.6; white-space: pre-line;">
                        ${message}
                      </p>
                    </div>
                    <p style="color: #8c7b6c; font-size: 13px; margin: 0 0 25px 0;">
                      📅 Date: <strong>${formattedDate}</strong>
                    </p>
                    <p style="margin: 0; color: #5a4b3d; font-size: 13px;">
                      ${isEmployee
                        ? 'You can view this notice in the <a href="http://localhost:5173" style="color: #ea580c; font-weight: 600;">Temple Portal</a>.'
                        : 'You can view this notification in your <a href="http://localhost:5173/devotee" style="color: #ea580c; font-weight: 600;">Devotee Portal</a>.'}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f7efe6; padding: 20px 30px; text-align: center;">
                    <p style="margin: 0; color: #7f6e5e; font-size: 12px;">
                      With divine blessings,<br>
                      <strong>Sri Shanti Mahadev Mandir Administration</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return sendEmail({
    to: process.env.EMAIL_USER || "ganga.mca2002@gmail.com",
    bcc: cleanedBcc,
    subject: `[Sri Shanti Mahadev Mandir] ${title}`,
    html: emailHtml,
    text: `${title}\n\n${message}\n\nSri Shanti Mahadev Mandir`,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
};

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

  const validEmails = [...new Set([...recipients.values()].map((r) => r.audienceEmail).filter(Boolean))];
  if (validEmails.length > 0) {
    sendBroadcastEmail({
      title,
      message,
      category,
      attachment,
      bccEmails: validEmails,
      isEmployee: true,
    }).catch((err) => console.warn("Employee broadcast BCC email error:", err.message));
  }

  const docs = [...recipients.values()].map((recipient) => ({
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: recipient.audienceId,
    audienceEmail: recipient.audienceEmail || undefined,
    audienceRole: recipient.audienceRole || "staff",
    category: category ? String(category).trim() : "event",
    attachment: attachment || undefined,
    read: false,
    emailSent: Boolean(recipient.audienceEmail),
    emailSentAt: recipient.audienceEmail ? new Date() : null,
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

  const validEmails = [...new Set([...recipients.values()].map((r) => r.audienceEmail).filter(Boolean))];
  if (validEmails.length > 0) {
    sendBroadcastEmail({
      title,
      message,
      category,
      attachment,
      bccEmails: validEmails,
      isEmployee: false,
    }).catch((err) => console.warn("Devotee broadcast BCC email error:", err.message));
  }

  const docs = [...recipients.values()].map((recipient) => ({
    title: String(title).trim(),
    message: String(message).trim(),
    audienceId: recipient.audienceId,
    audienceEmail: recipient.audienceEmail || undefined,
    audienceRole: recipient.audienceRole || "devotee",
    category: category ? String(category).trim() : "event",
    attachment: attachment || undefined,
    read: false,
    emailSent: Boolean(recipient.audienceEmail),
    emailSentAt: recipient.audienceEmail ? new Date() : null,
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
