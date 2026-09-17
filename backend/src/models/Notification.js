const mongoose = require("mongoose");
const { dispatchNotificationEmail } = require("../utils/notificationEmail");

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

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ date: -1 });
notificationSchema.index({ audienceEmail: 1, createdAt: -1 });
notificationSchema.index({ audienceRole: 1, createdAt: -1 });

// Post-save hook: send the automated email for a newly created notification and
// stamp emailSent/emailSentAt/emailRecipient. The implementation is shared with
// the PostgreSQL path (utils/notificationEmail.js) so both datasources send the
// same email; this hook only supplies the Mongo-side persistence callback.
//
// The dispatch is intentionally NOT awaited: the original hook resolved the
// recipient but fired the send detached, so a save (and therefore the HTTP
// request that triggered it) never blocks on SMTP.
notificationSchema.post("save", function (doc) {
  dispatchNotificationEmail(doc, async (fields) => {
    await mongoose.model("Notification").updateOne({ _id: doc._id }, { $set: fields });
  });
});

module.exports = mongoose.model("Notification", notificationSchema);

