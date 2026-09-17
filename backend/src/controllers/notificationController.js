const notificationPersistenceService = require("../services/notificationPersistenceService");

const getNotifications = async (req, res) => {
  try {
    const { role, userId } = req.params;

    const query = {
      $or: [
        { audienceRole: role.toLowerCase() },
        { audienceId: userId }
      ]
    };

    // Admin only receives notifications from other roles (devotees, staff, etc.), not event announcements
    if (role.toLowerCase() === "admin") {
      query.category = { $nin: ["event", "events", "festival", "festivals"] };
    }

    const notifications = await notificationPersistenceService.findMany({
      filter: query,
      sort: { createdAt: -1 },
    });

    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    await notificationPersistenceService.findByIdAndUpdate(
      req.params.id,
      {
        read: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

module.exports = {
  getNotifications,
  markNotificationRead
};
