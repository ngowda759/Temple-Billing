/**
 * Communication Service - Handles Email, SMS, and Message Notifications
 * This service integrates with email providers (like SendGrid/Nodemailer)
 * and SMS providers (like Twilio)
 */

// Mock implementations for demonstration
// In production, replace with actual provider integrations

let transporter = null;
let currentEmailUser = null;
let currentEmailPass = null;

const initTransporter = () => {
  const emailUser = process.env.EMAIL_USER || "ganga.mca2002@gmail.com";
  const emailPass = process.env.EMAIL_PASS || "qawd ofst qnve vhjj";
  const emailService = process.env.EMAIL_SERVICE || "gmail";

  if (transporter && currentEmailUser === emailUser && currentEmailPass === emailPass) {
    return transporter;
  }

  try {
    const nodemailer = require("nodemailer");
    if (emailUser && emailPass) {
      transporter = nodemailer.createTransport({
        service: emailService,
        auth: {
          user: emailUser,
          pass: emailPass,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });
      currentEmailUser = emailUser;
      currentEmailPass = emailPass;
      console.log(`Real NodeMailer SMTP transporter initialized for ${emailUser}`);
    }
  } catch (error) {
    console.error("Failed to initialize real email transporter:", error.message);
  }
  return transporter;
};

const sendEmail = async ({ to, bcc, subject, html, text, attachments }) => {
  try {
    const mailTransporter = initTransporter();
    if (mailTransporter) {
      const fromEmail = process.env.EMAIL_USER || "ganga.mca2002@gmail.com";
      await mailTransporter.sendMail({
        from: `"Sri Shanti Mahadev Mandir" <${fromEmail}>`,
        to: to || fromEmail,
        bcc: bcc && bcc.length ? bcc : undefined,
        subject,
        html,
        text,
        attachments,
      });
      console.log(`📧 Real Email sent to ${to || "BCC list"}${bcc ? ` (${bcc.length} BCC recipients)` : ""}`);
    } else {
      console.log(`📧 (Mock) Email sent to ${to || "BCC recipients"}`);
      console.log(`Subject: ${subject}`);
      console.log(`Message: ${text || html}`);
    }

    // Log to file for testing
    const fs = require("fs");
    const path = require("path");
    const logsDir = path.join(__dirname, "..", "logs");
    if (!require("fs").existsSync(logsDir)) {
      require("fs").mkdirSync(logsDir, { recursive: true });
    }

    const logEntry = `[${new Date().toISOString()}] EMAIL\nTo: ${to}\nSubject: ${subject}\n${text || html}\n\n`;
    fs.appendFileSync(path.join(logsDir, "communications.log"), logEntry);

    return { success: true, type: "email", recipient: to };
  } catch (error) {
    console.error("Email error:", error.message);
    return { success: false, type: "email", error: error.message };
  }
};

const sendSMS = async ({ to, message }) => {
  try {
    // TODO: Integrate with actual SMS service (Twilio, AWS SNS, etc.)
    // Example with Twilio:
    // const twilio = require('twilio')(accountSid, authToken);
    // await twilio.messages.create({ body: message, from: twilioNumber, to });

    console.log(`📱 SMS sent to ${to}`);
    console.log(`Message: ${message}`);

    // Log to file for testing
    const fs = require("fs");
    const path = require("path");
    const logsDir = path.join(__dirname, "..", "logs");
    if (!require("fs").existsSync(logsDir)) {
      require("fs").mkdirSync(logsDir, { recursive: true });
    }

    const logEntry = `[${new Date().toISOString()}] SMS\nTo: ${to}\nMessage: ${message}\n\n`;
    fs.appendFileSync(path.join(logsDir, "communications.log"), logEntry);

    return { success: true, type: "sms", recipient: to };
  } catch (error) {
    console.error("SMS error:", error.message);
    return { success: false, type: "sms", error: error.message };
  }
};

const sendNotification = async ({ to, subject, message, messageType = "text" }) => {
  try {
    console.log(`🔔 Notification to ${to}`);
    console.log(`Message: ${message}`);

    const fs = require("fs");
    const path = require("path");
    const logsDir = path.join(__dirname, "..", "logs");
    if (!require("fs").existsSync(logsDir)) {
      require("fs").mkdirSync(logsDir, { recursive: true });
    }

    const logEntry = `[${new Date().toISOString()}] NOTIFICATION\nTo: ${to}\nSubject: ${subject}\nMessage: ${message}\n\n`;
    fs.appendFileSync(path.join(logsDir, "communications.log"), logEntry);

    return { success: true, type: "notification", recipient: to };
  } catch (error) {
    console.error("Notification error:", error.message);
    return { success: false, type: "notification", error: error.message };
  }
};

const { generateBookingReceiptPDF } = require("./pdfGenerator");

/**
 * Send booking confirmation across multiple channels
 * @param {Object} devotee - Devotee information
 * @param {Object} booking - Booking details
 */
const sendBookingConfirmation = async (devotee, booking) => {
  const subject = "Pooja Booking Confirmation";
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #d4a574;">Pooja Booking Confirmation</h2>
      <p>Dear ${devotee.name},</p>
      <p>Your pooja booking has been confirmed!</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Service:</strong> ${booking.service}</p>
        <p><strong>Date & Time:</strong> ${booking.datetime}</p>
        <p><strong>Amount:</strong> ₹${booking.amount}</p>
        <p><strong>Status:</strong> ${booking.status}</p>
      </div>
      <p style="font-weight: bold; color: #d4a574; font-size: 1.1em; padding: 10px; border-left: 4px solid #d4a574; background: #fff8f0;">
        Please bring the receipt at the time of visiting the temple to perform the pooja.
      </p>
      <p>Thank you for choosing our temple. We look forward to serving you!</p>
      <p>Best regards,<br>Temple Management</p>
    </div>
  `;

  const textMessage = `Pooja Booking Confirmation\nService: ${booking.service}\nDate & Time: ${booking.datetime}\nAmount: ₹${booking.amount}\n\nPlease bring the receipt at the time of visiting the temple to perform the pooja.\nThank you!`;

  const smsMessage = `Pooja booking confirmed! Service: ${booking.service} on ${booking.datetime}. Amount: ₹${booking.amount}. Please bring receipt at temple. -Temple`;

  const results = [];

  let attachments = [];
  try {
    const pdfBuffer = await generateBookingReceiptPDF(devotee, booking);
    attachments.push({
      filename: `Receipt_${(booking.service || 'Pooja').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    });
  } catch (err) {
    console.error("Failed to generate PDF for email attachment:", err.message);
  }

  // Send email
  if (devotee.email) {
    results.push(
      await sendEmail({
        to: devotee.email,
        subject,
        html: emailHtml,
        text: textMessage,
        attachments,
      })
    );
  }

  // Send SMS
  if (devotee.phone) {
    results.push(
      await sendSMS({
        to: devotee.phone,
        message: smsMessage,
      })
    );
  }

  return results;
};

/**
 * Send donation receipt across multiple channels
 * @param {Object} devotee - Devotee information
 * @param {Object} donation - Donation details
 */
const sendDonationReceipt = async (devotee, donation) => {
  const subject = "Donation Receipt";
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #d4a574;">Donation Receipt</h2>
      <p>Dear ${devotee.name},</p>
      <p>Thank you for your generous donation to our temple!</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Amount:</strong> ₹${donation.amount}</p>
        <p><strong>Category:</strong> ${donation.category}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        <p><strong>Transaction ID:</strong> ${donation.paymentMethod === "Cash" ? "Offline Payment" : (donation.transactionId || "N/A")}</p>
      </div>
      <p>Your contribution helps us maintain and serve the community better. May you be blessed!</p>
      <p>Best regards,<br>Temple Management</p>
    </div>
  `;

  const textMessage = `Donation Receipt\nAmount: ₹${donation.amount}\nCategory: ${donation.category}\nTransaction ID: ${donation.paymentMethod === "Cash" ? "Offline Payment" : (donation.transactionId || "N/A")}\nThank you for your donation!`;

  const smsMessage = `Donation received! Amount: ₹${donation.amount}. Transaction ID: ${donation.paymentMethod === "Cash" ? "Offline Payment" : (donation.transactionId || "N/A")}. Thank you! -Temple`;

  const results = [];

  // Send email
  if (devotee.email) {
    results.push(
      await sendEmail({
        to: devotee.email,
        subject,
        html: emailHtml,
        text: textMessage,
      })
    );
  }

  // Send SMS
  if (devotee.phone) {
    results.push(
      await sendSMS({
        to: devotee.phone,
        message: smsMessage,
      })
    );
  }

  return results;
};

/**
 * Send Prasadam order confirmation
 * @param {Object} devotee - Devotee information
 * @param {Object} order - Order details
 */
const sendPrasadamOrderConfirmation = async (devotee, order) => {
  const subject = "Prasadam Order Confirmation";
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #d4a574;">Prasadam Order Confirmation</h2>
      <p>Dear ${devotee.name},</p>
      <p>Your Prasadam order has been received and confirmed!</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Item:</strong> ${order.item || "Prasadam"}</p>
        <p><strong>Quantity:</strong> ${order.quantity || 1}</p>
        <p><strong>Amount:</strong> ₹${order.amount || 0}</p>
        <p><strong>Status:</strong> ${order.status}</p>
      </div>
      <p>Your order will be ready for pickup soon. Thank you!</p>
      <p>Best regards,<br>Temple Management</p>
    </div>
  `;

  const textMessage = `Prasadam Order Confirmed\nItem: ${order.item || "Prasadam"}\nQuantity: ${order.quantity || 1}\nAmount: ₹${order.amount || 0}\nThank you!`;

  const smsMessage = `Prasadam order confirmed! Item: ${order.item || "Prasadam"}. Qty: ${order.quantity || 1}. Ready soon! -Temple`;

  const results = [];

  // Send email
  if (devotee.email) {
    results.push(
      await sendEmail({
        to: devotee.email,
        subject,
        html: emailHtml,
        text: textMessage,
      })
    );
  }

  // Send SMS
  if (devotee.phone) {
    results.push(
      await sendSMS({
        to: devotee.phone,
        message: smsMessage,
      })
    );
  }

  return results;
};

/**
 * Send Consolidated Bill receipt across multiple channels
 * @param {Object} bill - Bill details (with items, amount, etc.)
 */
const sendBillReceipt = async (bill) => {
  const subject = "Temple Billing Receipt";
  const itemsHtml = (bill.items || []).map(i => `<tr><td>${i.itemType}</td><td>${i.itemName}</td><td>₹${i.amount}</td></tr>`).join('');
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #d4a574;">Consolidated Receipt</h2>
      <p>Dear ${bill.devoteeName},</p>
      <p>Thank you for your booking! Here are your receipt details:</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Receipt No:</strong> ${bill.referenceNo}</p>
        <p><strong>Date:</strong> ${new Date(bill.billDate || bill.createdAt).toLocaleString()}</p>
        <p><strong>Payment Mode:</strong> ${bill.paymentMode}</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background: #e2e8f0; text-align: left;"><th>Type</th><th>Item</th><th>Amount</th></tr>
          ${itemsHtml}
          ${bill.sevaType && bill.items?.length === 0 ? `<tr><td>Service</td><td>${bill.sevaType}</td><td>₹${bill.amount}</td></tr>` : ''}
        </table>
        <p style="text-align: right; font-size: 1.2em; margin-top: 10px;"><strong>Total Amount:</strong> ₹${bill.amount}</p>
      </div>
      <p>You can also download a PDF receipt by logging into your portal or requesting it from the counter.</p>
      <p>Best regards,<br>Temple Management</p>
    </div>
  `;

  const textMessage = `Receipt ${bill.referenceNo}\nTotal Amount: ₹${bill.amount}\nThank you!`;
  const smsMessage = `Receipt ${bill.referenceNo} generated for ₹${bill.amount}. -Temple`;

  const results = [];
  if (bill.devoteeEmail) {
    results.push(await sendEmail({ to: bill.devoteeEmail, subject, html: emailHtml, text: textMessage }));
  }
  if (bill.devoteePhone) {
    results.push(await sendSMS({ to: bill.devoteePhone, message: smsMessage }));
  }
  return results;
};

/**
 * Send Festival Notification to Devotees
 * @param {Object} event - Event details
 * @param {Array} devotees - List of devotee objects
 */
const sendFestivalNotification = async (event, devotees) => {
  const subject = `Upcoming Festival: ${event.title}`;
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #d4a574;">New Festival Announcement</h2>
      <p>Dear Devotee,</p>
      <p>We are delighted to invite you to <strong>${event.title}</strong> at our temple.</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
        <p><strong>Location:</strong> ${event.location}</p>
        <p><strong>Description:</strong> ${event.description}</p>
      </div>
      <p>Join us to seek blessings. We look forward to your presence.</p>
      <p>Best regards,<br>Temple Management</p>
    </div>
  `;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validDevoteeEmails = [
    ...new Set(
      (devotees || [])
        .map((d) => String(d?.email || "").trim().toLowerCase())
        .filter((em) => emailRegex.test(em))
    ),
  ];

  if (validDevoteeEmails.length > 0) {
    await sendEmail({
      to: process.env.EMAIL_USER || "ganga.mca2002@gmail.com",
      bcc: validDevoteeEmails,
      subject,
      html: emailHtml,
      text: textMessage,
    }).catch((err) => console.warn("sendFestivalNotification BCC error:", err.message));
  }

  for (const devotee of devotees || []) {
    if (devotee?.phone) {
      await sendSMS({ to: devotee.phone, message: smsMessage }).catch(() => {});
    }
  }
};

module.exports = {
  sendEmail,
  sendSMS,
  sendNotification,
  sendBookingConfirmation,
  sendDonationReceipt,
  sendPrasadamOrderConfirmation,
  sendBillReceipt,
  sendFestivalNotification,
};
