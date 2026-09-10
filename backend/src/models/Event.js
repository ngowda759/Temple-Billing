const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true },
    date: { type: Date, required: true },
    endDate: { type: Date },
    location: { type: String, trim: true, required: true },
    description: { type: String, trim: true },
    image: { type: String, trim: true },
    slots: { type: Number, default: 0 },
    registrations: { type: Number, default: 0 },
    collection: { type: Number, default: 0 },
    status: { type: String, enum: ["Upcoming", "Active", "Completed", "Cancelled"], default: "Upcoming" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Event", eventSchema);
