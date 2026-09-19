const attendanceSettingService = require("../services/attendanceSettingService");

// The AttendanceSetting singleton is read and written through
// attendanceSettingService so it follows the selected datasource: PostgreSQL
// when it is reachable, otherwise the existing Mongoose model. Response shapes,
// status codes and the lazy singleton creation are unchanged.

exports.getSettings = async (req, res) => {
  try {
    const settings = await attendanceSettingService.getOrCreate();
    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await attendanceSettingService.updateSettings(req.body);
    res.status(200).json({ success: true, message: "Attendance settings updated", settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
