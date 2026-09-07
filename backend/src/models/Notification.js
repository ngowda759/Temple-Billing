const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true },
    message: { type: String, trim: true, required: true },
    audienceId: { type: String, trim: true, index: true },
    audienceEmail: { type: String, trim: true, lowercase: true },
    audienceRole: { type: String, trim: true, lowercase: true },
    category: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    viewed: { type: Boolean, default: false },
    viewedAt: { type: Date, default: null },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    attachment: { type: String },
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date, default: null },
    emailRecipient: { type: String, trim: true, lowercase: true },
  },
  { timestamps: true }
);

// Helper to generate a temple-branded email HTML
const buildTempleNotificationEmail = (title, message, category, date) => {
  const formattedDate = date
    ? new Date(date).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleString("en-IN");

  const catBadge = category ? category.toUpperCase() : "NOTIFICATION";

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: 'Segoe UI', Arial, sans-serif; color: #2d1b08;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #faf6f0; padding: 30px 15px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(184, 94, 0, 0.08); border: 1px solid #f4e4d0;">
                
                <!-- Mandir Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #b46a13 0%, #ea580c 100%); padding: 28px 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">Sri Shanti Mahadev Mandir</h1>
                    <p style="color: #fde8cc; margin: 6px 0 0 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px;">Temple Devotee Services</p>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 35px 35px 25px 35px;">
                    <div style="display: inline-block; background-color: #fcf0e4; color: #b46a13; font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 20px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 15px; border: 1px solid #f8dec3;">
                      ${catBadge}
                    </div>

                    <h2 style="color: #2d1b08; margin: 0 0 15px 0; font-size: 20px; font-weight: 700; line-height: 1.4;">
                      ${title}
                    </h2>

                    <div style="background-color: #fbf8f5; border-left: 4px solid #ea580c; border-radius: 8px; padding: 18px 20px; margin: 15px 0 25px 0;">
                      <p style="margin: 0; color: #4a3828; font-size: 15px; line-height: 1.6; white-space: pre-line;">
                        ${message}
                      </p>
                    </div>

                    <p style="color: #8c7b6c; font-size: 13px; margin: 0 0 25px 0;">
                      📅 Date & Time: <strong>${formattedDate}</strong>
                    </p>

                    <div style="border-top: 1px dashed #e8ded3; padding-top: 20px;">
                      <p style="margin: 0; color: #5a4b3d; font-size: 14px; line-height: 1.5;">
                        You are receiving this email because you are a registered devotee of Sri Shanti Mahadev Mandir. You can also view this notification and receipts in your <a href="http://localhost:5173/devotee" style="color: #ea580c; font-weight: 600; text-decoration: none;">Devotee Portal</a>.
                      </p>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f7efe6; padding: 20px 30px; text-align: center; border-top: 1px solid #eee4d7;">
                    <p style="margin: 0; color: #7f6e5e; font-size: 12px;">
                      With divine blessings,<br>
                      <strong>Sri Shanti Mahadev Mandir Administration</strong><br>
                      Temple Office • Phone: +91 98765 43210 • Email: ganga.mca2002@gmail.com
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
};

// Post-save hook to automatically send emails for newly created notifications
notificationSchema.post("save", async function (doc) {
  if (doc.emailSent) return;

  try {
    const { sendEmail } = require("../utils/communicationService");
    const User = require("./User");

    let recipientEmail = doc.audienceEmail;

    // If audienceEmail not directly provided, check audienceId
    if (!recipientEmail && doc.audienceId) {
      const user = await User.findById(doc.audienceId).select("email").lean();
      if (user?.email) {
        recipientEmail = String(user.email).trim().toLowerCase();
      }
    }

    if (recipientEmail) {
      const emailHtml = buildTempleNotificationEmail(doc.title, doc.message, doc.category, doc.date || doc.createdAt);
      sendEmail({
        to: recipientEmail,
        subject: `[Sri Shanti Mahadev Mandir] ${doc.title}`,
        html: emailHtml,
        text: `${doc.title}\n\n${doc.message}\n\nSri Shanti Mahadev Mandir`,
      })
        .then(async (res) => {
          if (res?.success) {
            await mongoose.model("Notification").updateOne(
              { _id: doc._id },
              { $set: { emailSent: true, emailSentAt: new Date(), emailRecipient: recipientEmail } }
            );
          }
        })
        .catch((err) => console.warn("Automated notification email failed:", err.message));
    }
  } catch (error) {
    console.warn("Notification post-save email hook error:", error.message);
  }
});

module.exports = mongoose.model("Notification", notificationSchema);

