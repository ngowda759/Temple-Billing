const { sendEmail } = require("./communicationService");

// Helper to generate a temple-branded email HTML
const buildTempleNotificationEmail = (
  title,
  message,
  category,
  date,
  attachmentDetails = null,
  isEmployee = false
) => {
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

  const portalLinkHtml = isEmployee
    ? `You are receiving this notification as an employee / staff member of Sri Shanti Mahadev Mandir. You can also view all temple announcements in your <a href="http://localhost:5173" style="color: #ea580c; font-weight: 600; text-decoration: none;">Temple Portal</a>.`
    : `You are receiving this email because you are a registered devotee of Sri Shanti Mahadev Mandir. You can also view this notification and invitations in your <a href="http://localhost:5173/devotee" style="color: #ea580c; font-weight: 600; text-decoration: none;">Devotee Portal</a>.`;

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

                    <h2 style="color: #2d1b08; margin: 0 0 15px 0; font-size: 22px; font-weight: 700; line-height: 1.4;">
                      ${title}
                    </h2>

                    ${
                      attachmentDetails?.hasImage
                        ? `
                    <!-- Event Banner / Invitation Card Image -->
                    <div style="margin: 18px 0 24px 0; text-align: center; border-radius: 12px; overflow: hidden; border: 1px solid #ebd8c3; box-shadow: 0 6px 18px rgba(184, 94, 0, 0.1); background-color: #fdfaf6;">
                      <img src="${attachmentDetails.imageSrc}" alt="${title} Invitation Banner" style="max-width: 100%; width: 100%; height: auto; display: block; border: 0; object-fit: contain; margin: 0 auto;" />
                    </div>
                    `
                        : ""
                    }

                    ${
                      attachmentDetails?.isPdf
                        ? `
                    <!-- PDF Invitation Attachment Box -->
                    <div style="background-color: #fff9f2; border: 1.5px dashed #ea580c; border-radius: 12px; padding: 18px 20px; margin: 18px 0 22px 0; text-align: center;">
                      <div style="font-size: 32px; margin-bottom: 6px;">📄</div>
                      <h3 style="margin: 0 0 6px 0; color: #9a3412; font-size: 16px; font-weight: 700;">Official Event Invitation (PDF Attached)</h3>
                      <p style="margin: 0; color: #7c2d12; font-size: 13px; line-height: 1.5;">
                        Please find the complete invitation card and program schedule attached to this email (${attachmentDetails.filename || "Invitation.pdf"}).
                      </p>
                    </div>
                    `
                        : ""
                    }

                    <div style="background-color: #fbf8f5; border-left: 4px solid #ea580c; border-radius: 8px; padding: 18px 20px; margin: 15px 0 25px 0;">
                      <p style="margin: 0; color: #4a3828; font-size: 15px; line-height: 1.6; white-space: pre-line;">
                        ${message}
                      </p>
                    </div>

                    <p style="color: #8c7b6c; font-size: 13px; margin: 0 0 25px 0;">
                      📅 Date &amp; Time: <strong>${formattedDate}</strong>
                    </p>

                    <div style="border-top: 1px dashed #e8ded3; padding-top: 20px;">
                      <p style="margin: 0; color: #5a4b3d; font-size: 14px; line-height: 1.5;">
                        ${portalLinkHtml}
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

// Parses the notification's attachment (a data-URI image/PDF or an http(s) URL)
// into nodemailer attachments plus the template hints the email builder needs.
const buildAttachmentDetails = (attachment, title) => {
  const attachments = [];
  const attachmentDetails = {
    hasImage: false,
    imageSrc: "",
    isPdf: false,
    filename: "",
  };

  if (!attachment || typeof attachment !== "string") {
    return { attachments, attachmentDetails };
  }

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

      attachments.push({ filename, content: buffer, contentType, cid });
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

      attachments.push({ filename, content: buffer, contentType: "application/pdf" });
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

  return { attachments, attachmentDetails };
};

// Resolves the recipient for a notification document: the explicit audienceEmail
// first, otherwise the audienceId looked up on User and then Employee. The id
// lookup is a MongoDB read, so it is only attempted when MongoDB is connected —
// exactly the situation the model's post-save hook always ran in.
const resolveRecipient = async (doc, mongoConnected) => {
  let recipientEmail = doc.audienceEmail;
  let recipientRole = doc.audienceRole;

  if (!recipientEmail && doc.audienceId && mongoConnected) {
    const User = require("../models/User");
    const Employee = require("../models/Employee");

    const user = await User.findById(doc.audienceId).select("email role").lean();
    if (user?.email) {
      recipientEmail = String(user.email).trim().toLowerCase();
      if (!recipientRole) recipientRole = user.role;
    } else {
      const emp = await Employee.findById(doc.audienceId).select("email role").lean();
      if (emp?.email) {
        recipientEmail = String(emp.email).trim().toLowerCase();
        if (!recipientRole) recipientRole = emp.role;
      }
    }
  }

  return { recipientEmail, recipientRole };
};

// Sends the automated temple notification email for a newly created
// notification and then hands the email metadata back to the caller so it can
// persist emailSent/emailSentAt/emailRecipient on whichever datasource it owns.
//
// This is the shared implementation of the Mongoose model's post-save hook, so
// the PostgreSQL path reproduces the same side effect. It never throws: a failed
// send must not affect the notification write.
const dispatchNotificationEmail = async (doc, persist) => {
  if (!doc || doc.emailSent) return;

  try {
    const mongoConnected = require("../config/db").isDbConnected();
    const { recipientEmail, recipientRole } = await resolveRecipient(doc, mongoConnected);
    if (!recipientEmail) return;

    const { attachments, attachmentDetails } = buildAttachmentDetails(doc.attachment, doc.title);
    const isEmployee = recipientRole && recipientRole !== "devotee";
    const emailHtml = buildTempleNotificationEmail(
      doc.title,
      doc.message,
      doc.category,
      doc.date || doc.createdAt,
      attachmentDetails,
      isEmployee
    );

    const textSummary = `${doc.title}\n\n${doc.message}${
      attachmentDetails.hasImage
        ? "\n\n[Invitation Banner Image Included]"
        : attachmentDetails.isPdf
        ? "\n\n[Invitation PDF Document Attached]"
        : ""
    }\n\nSri Shanti Mahadev Mandir`;

    const res = await sendEmail({
      to: recipientEmail,
      subject: `[Sri Shanti Mahadev Mandir] ${doc.title}`,
      html: emailHtml,
      text: textSummary,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (res?.success && persist) {
      await persist({ emailSent: true, emailSentAt: new Date(), emailRecipient: recipientEmail });
    }
  } catch (error) {
    console.warn("Automated notification email failed:", error.message);
  }
};

module.exports = {
  buildTempleNotificationEmail,
  buildAttachmentDetails,
  resolveRecipient,
  dispatchNotificationEmail,
};
