const taskService = require("../services/taskService");
const Employee = require("../models/Employee");
const User = require("../models/User");
const mongoose = require("mongoose");
const notificationPersistenceService = require("../services/notificationPersistenceService");
const { createStaffNotification } = require("../utils/notificationService");

const TASK_STATUSES = ["Pending", "In Progress", "Completed"];

const clean = (value) => String(value || "").trim();

const findByIdIfValid = async (Model, id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Model.findById(id);
};

const getStaffNotificationTargets = async (staffId) => {
  const ids = new Set([staffId]);
  const emails = new Set();

  const user = await findByIdIfValid(User, staffId);
  if (user?.email) {
    emails.add(user.email);
    const employee = await Employee.findOne({ email: user.email });
    if (employee?._id) ids.add(employee._id.toString());
    if (employee?.email) emails.add(employee.email);
  }

  const employee = await findByIdIfValid(Employee, staffId);
  if (employee?.email) {
    emails.add(employee.email);
    const linkedUser = await User.findOne({ email: employee.email });
    if (linkedUser?._id) ids.add(linkedUser._id.toString());
    if (linkedUser?.email) emails.add(linkedUser.email);
  }

  return {
    ids: [...ids].filter(Boolean),
    emails: [...emails].filter(Boolean).map((email) => email.toLowerCase()),
  };
};

const getStaffIdCandidates = async (staffId) => {
  const targets = await getStaffNotificationTargets(staffId);
  return targets.ids;
};

const buildStaffNotificationQuery = async (staffId) => {
  const targets = await getStaffNotificationTargets(staffId);
  const filters = [{ audienceRole: "staff" }];

  if (targets.ids.length) {
    filters.push({ audienceId: { $in: targets.ids } });
  }
  if (targets.emails.length) {
    filters.push({ audienceEmail: { $in: targets.emails } });
  }

  return { $or: filters };
};

const resolveStaffForTask = async ({ staffId, employeeId, staffEmail, staffName }) => {
  const normalizedEmail = clean(staffEmail).toLowerCase();
  let employee =
    (await findByIdIfValid(Employee, employeeId)) ||
    (await findByIdIfValid(Employee, staffId)) ||
    (normalizedEmail ? await Employee.findOne({ email: normalizedEmail }) : null);

  let user =
    (employee?.email ? await User.findOne({ email: employee.email }) : null) ||
    (await findByIdIfValid(User, staffId));

  if (!employee && user?.email) {
    employee = await Employee.findOne({ email: user.email });
  }

  return {
    staffId: user?._id?.toString() || employee?._id?.toString() || clean(staffId),
    staffName: employee?.name || user?.name || clean(staffName),
    employeeId: employee?._id?.toString() || clean(employeeId),
    staffEmail: employee?.email || user?.email || normalizedEmail,
  };
};

exports.getAllTasks = async (req, res) => {
  try {
    const { staffId, status } = req.query;
    const query = {};

    if (staffId) {
      query.staffId = { $in: await getStaffIdCandidates(staffId) };
    }

    if (status && TASK_STATUSES.includes(status)) {
      query.status = status;
    }

    const tasks = await taskService.findMany({ filter: query, sort: { createdAt: -1 } });
    return res.json(tasks);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const { staffId } = req.params;
    const tasks = await taskService.findMany({
      filter: { staffId: { $in: await getStaffIdCandidates(staffId) } },
      sort: { createdAt: -1 },
    });

    return res.json(tasks);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task status",
      });
    }

    const updated = await taskService.updateById(id, { status });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (status === "In Progress" || status === "Completed") {
      await createStaffNotification({
        title: status === "Completed" ? "Duty Completed Confirmation" : "Duty Updated",
        message:
          status === "Completed"
            ? `${updated.title || updated.duty || "Assigned duty"} has been marked as completed.`
            : `${updated.title || updated.duty || "Assigned duty"} status changed to ${status}.`,
        audienceId: updated.staffId,
        audienceEmail: updated.staffEmail,
        category: "task",
      });
    }

    // SEND ADMIN NOTIFICATION WHEN TASK COMPLETED
    if (status === "Completed") {
      await notificationPersistenceService.create({
        title: "Task Completed",
        message: `${updated.staffName} completed assigned task`,
        audienceRole: "admin",
        category: "task",
      });
    }

    return res.json({
      success: true,
      task: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const deleted = await taskService.destroy(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    return res.json({
      success: true,
      message: "Task deleted successfully",
      task: deleted,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getStaffNotifications = async (req, res) => {
  try {
    const { staffId } = req.params;
    const query = await buildStaffNotificationQuery(staffId);
    const notifications = await notificationPersistenceService.findMany({
      filter: query,
      sort: { date: -1, createdAt: -1 },
    });

    return res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getStaffUnreadCount = async (req, res) => {
  try {
    const { staffId } = req.params;
    const query = await buildStaffNotificationQuery(staffId);
    const unreadCount = await notificationPersistenceService.countDocuments({ ...query, read: false });

    return res.json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.markStaffNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const notification = await notificationPersistenceService.findByIdAndUpdate(
      id,
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.json({
      success: true,
      notification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.markStaffNotificationsRead = async (req, res) => {
  try {
    const { staffId } = req.params;
    const query = await buildStaffNotificationQuery(staffId);
    await notificationPersistenceService.updateMany({ ...query, read: false }, { read: true, readAt: new Date() });

    return res.json({
      success: true,
      unreadCount: 0,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.markStaffNotificationsViewed = async (req, res) => {
  try {
    const { staffId } = req.params;
    const query = await buildStaffNotificationQuery(staffId);
    await notificationPersistenceService.updateMany({ ...query, viewed: false }, { viewed: true, viewedAt: new Date() });

    return res.json({
      success: true,
      message: "Notifications marked as viewed",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createInventoryRequestNotification = async (req, res) => {
  try {
    const { staffId, staffEmail, status, itemName, adminReason } = req.body;
    const normalizedStatus = clean(status);

    if (!["Approved", "Rejected"].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Inventory request status must be Approved or Rejected",
      });
    }

    if (!clean(staffId) && !clean(staffEmail)) {
      return res.status(400).json({
        success: false,
        message: "staffId or staffEmail is required for inventory request notification",
      });
    }

    const notification = await createStaffNotification({
      title: `Inventory Request ${normalizedStatus}`,
      message:
        normalizedStatus === "Rejected"
          ? `Inventory request${itemName ? ` for ${itemName}` : ""} rejected. Reason: ${clean(adminReason) || "Not specified"}`
          : `Inventory request${itemName ? ` for ${itemName}` : ""} approved.`,
      audienceId: staffId,
      audienceEmail: staffEmail,
      category: "inventory",
    });

    return res.status(201).json({
      success: true,
      notification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.assignTask = async (req, res) => {
  try {
    const {
      staffId,
      employeeId,
      staffEmail,
      staffName,
      shiftId,
      shiftName,
      shiftStartTime,
      shiftEndTime,
      dateKey,
      dutyName,
      dutyArea,
      reportingTime,
      assignedBy,
      title,
      description,
      dueDate,
      notes,
    } = req.body;

    const taskTitle = clean(title || dutyName);
    const taskDescription = clean(description || dutyArea);
    const taskDueDate = clean(dueDate || dateKey);
    const taskShiftName = clean(shiftName);
    const taskDutyName = clean(dutyName || title || shiftName);
    const taskDutyArea = clean(dutyArea || description || taskDescription);
    const taskReportingTime = clean(reportingTime || shiftStartTime);
    const taskAssignedBy = clean(assignedBy);
    const resolvedStaff = await resolveStaffForTask({ staffId, employeeId, staffEmail, staffName });

    if (!resolvedStaff.staffId || !resolvedStaff.staffName || !taskTitle || !taskDescription || !taskDueDate || !taskAssignedBy || !taskDutyName || !taskDutyArea) {
      return res.status(400).json({
        success: false,
        message: "Employee, shift, duty, date and assigned by are required",
      });
    }

    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const todayDate = today.toISOString().slice(0, 10);

    if (taskDueDate < todayDate) {
      return res.status(400).json({
        success: false,
        message: "Due date cannot be in the past",
      });
    }
     
    const task = await taskService.create({
      assignmentType: "Duty & Shift",
      staffId: resolvedStaff.staffId,
      staffName: resolvedStaff.staffName,
      employeeId: resolvedStaff.employeeId,
      staffEmail: resolvedStaff.staffEmail,
      shiftId: clean(shiftId),
      shiftName: taskShiftName || taskDutyName,
      shiftStartTime: clean(shiftStartTime),
      shiftEndTime: clean(shiftEndTime),
      dateKey: taskDueDate,
      startTime: taskReportingTime,
      endTime: clean(shiftEndTime),
      title: taskTitle || taskDutyName,
      description: taskDescription,
      dueDate: taskDueDate,
      dutyName: taskDutyName,
      duty: taskDutyName,
      area: taskDutyArea,
      dutyArea: taskDutyArea,
      time: taskReportingTime || taskDueDate,
      reportingTime: taskReportingTime || taskDueDate,
      assignedBy: taskAssignedBy,
      status: "Pending",
      attendanceStatus: "Pending",
      conflict: false,
      notes: clean(notes),
      requiredStaff: 1,
    });

    await createStaffNotification({
      title: "Task Assigned",
      message: "New duty assigned by Admin",
      audienceId: resolvedStaff.staffId,
      audienceEmail: resolvedStaff.staffEmail,
      category: "task",
    });

    return res.status(201).json({
      success: true,
      message: "Task assigned successfully",
      task,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
