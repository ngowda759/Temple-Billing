const Event = require("../models/Event");
const User = require("../models/User");
const { createEmployeeBroadcastNotifications, createBroadcastNotifications } = require("../utils/notificationService");

exports.createEvent = async (req, res) => {
  try {
    const { title, date, endDate, location } = req.body;
    if (!title || !date || !location) {
      return res.status(400).json({ message: "Title, From Date and Location are required." });
    }

    const tomorrowStart = new Date();
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    const parsedStart = new Date(date);
    parsedStart.setHours(0, 0, 0, 0);

    if (parsedStart < tomorrowStart) {
      return res.status(400).json({ message: "Event date must be in the future (cannot be today or a past date)." });
    }

    if (endDate) {
      const parsedEnd = new Date(endDate);
      parsedEnd.setHours(0, 0, 0, 0);
      if (parsedEnd < parsedStart) {
        return res.status(400).json({ message: "To Date cannot be before From Date." });
      }
    }

    const event = await Event.create({
      ...req.body,
      endDate: endDate || date,
    });

    const formattedEventDate = new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    const eventAnnouncementMsg = event.description
      ? `A new temple event "${title}" has been scheduled on ${formattedEventDate} at ${location}.\n\n${event.description}`
      : `A new temple event "${title}" has been scheduled on ${formattedEventDate} at ${location}.`;

    // Send notifications along with banner to all employees
    await createEmployeeBroadcastNotifications({
      title: `New Event: ${title}`,
      message: eventAnnouncementMsg,
      category: "event",
      attachment: event.image || event.imageUrl || undefined,
    }).catch((err) => console.error("Employee event broadcast error:", err.message));

    // Send notifications along with banner to all registered devotees
    await createBroadcastNotifications({
      title: `New Event: ${title}`,
      message: eventAnnouncementMsg,
      category: "event",
      role: "devotee",
      attachment: event.image || event.imageUrl || undefined,
    }).catch((err) => console.error("Devotee event broadcast error:", err.message));
    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getEvents = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await Event.updateMany(
      { date: { $lt: todayStart }, status: { $in: ["Upcoming", "Active"] } },
      { $set: { status: "Completed" } }
    );
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const { title, date, endDate, location, description, imageUrl, slots, registrations, collection, status } = req.body;

    if (title != null) event.title = String(title).trim();
    if (date) event.date = date;
    if (endDate !== undefined) {
      event.endDate = endDate || date || event.date;
    }
    if (location != null) event.location = String(location).trim();
    if (description != null) event.description = String(description).trim();
    if (imageUrl != null) event.image = String(imageUrl).trim();
    if (slots != null) event.slots = Number(slots) || 0;
    if (registrations != null) event.registrations = Number(registrations) || 0;
    if (collection != null) event.collection = Number(collection) || 0;
    if (status && ["Upcoming", "Active", "Completed", "Cancelled"].includes(status)) {
      event.status = status;
    }

    await event.save();

    await createStaffBroadcastNotifications({
      title: "Festival Schedule Updated",
      message: `${event.title} schedule has been updated.`,
      category: "festival",
    });

    return res.json({ event });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateEventStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["Upcoming", "Active", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status provided" });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    event.status = status;
    await event.save();

    await createStaffBroadcastNotifications({
      title: "Festival Reminder",
      message: `${event.title} is now marked as ${status.toLowerCase()}.`,
      category: "festival",
    });

    return res.json({ event });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
