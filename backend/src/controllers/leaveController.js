const leaveService = require("../services/leaveService");
const Employee = require("../models/Employee");
const Notification = require("../models/Notification");
const { createNotification, createStaffNotification } = require("../utils/notificationService");
const mongoose = require("mongoose");
const LEAVE_STATUSES = ["Pending", "Approved", "Rejected"];

const parseISODate = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isEmployeeOnLeaveToday = (leave, today) => {
  if (leave.status !== "Approved") {
    return false;
  }

  const from = parseISODate(leave.fromDate);
  const to = parseISODate(leave.toDate);
  if (!from || !to) {
    return false;
  }

  return today >= from && today <= to;
};

const buildLeaveSummary = (leaves) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const summary = {
    total: leaves.length,
    approved: 0,
    rejected: 0,
    pending: 0,
    employeesOnLeave: 0,
  };

  const onLeaveEmployeeIds = new Set();

  leaves.forEach((leave) => {
    if (leave.status === "Approved") {
      summary.approved += 1;
      if (isEmployeeOnLeaveToday(leave, today)) {
        onLeaveEmployeeIds.add(leave.staffId);
      }
      return;
    }
    if (leave.status === "Rejected") {
      summary.rejected += 1;
      return;
    }
    summary.pending += 1;
  });

  summary.employeesOnLeave = onLeaveEmployeeIds.size;
  return summary;
};

// Returns today's date as "YYYY-MM-DD" using the server's LOCAL timezone
// (never use toISOString() here — that would give UTC which may be yesterday in IST)
const getLocalTodayStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getEmployeeYearlyQuota = async (staffId) => {
  let employee = null;
  if (mongoose.Types.ObjectId.isValid(staffId)) {
    employee = await Employee.findById(staffId);
  }
  if (!employee) {
    employee = await Employee.findOne({ employeeId: staffId });
  }

  let casualQuota = 12;
  const emergencyQuota = 2;
  
  if (employee && employee.joiningDate) {
    const currentYear = new Date().getFullYear();
    const joinDate = new Date(employee.joiningDate);
    if (joinDate.getFullYear() === currentYear) {
      casualQuota = 12 - joinDate.getMonth();
    }
  }

  return {
    casualQuota,
    emergencyQuota,
    totalQuota: casualQuota + emergencyQuota,
  };
};

const getLeaveDaysCount = (fromDateStr, toDateStr, year, weeklyOff = null) => {
  const startOfYear = new Date(`${year}-01-01T00:00:00`);
  const endOfYear = new Date(`${year}-12-31T00:00:00`);
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  
  const start = from < startOfYear ? startOfYear : from;
  const end = to > endOfYear ? endOfYear : to;
  
  if (start <= end) {
    let count = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
      if (weeklyOff !== dayName) {
        count++;
      }
    }
    return count;
  }
  return 0;
};

exports.applyLeave = async (req, res) => {
  try {
    const { staffId, staffName, reason, fromDate, toDate, leaveType } = req.body;

    // ── Required field presence ──────────────────────────────────────────────
    const missing = [];
    if (!staffId)   missing.push("staffId");
    if (!staffName) missing.push("staffName");
    if (!leaveType || !String(leaveType).trim()) missing.push("leaveType");
    if (!fromDate)  missing.push("fromDate");
    if (!toDate)    missing.push("toDate");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    // ── Reason validation ────────────────────────────────────────────────────
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      return res.status(400).json({
        success: false,
        message: "Reason is required and cannot be empty or whitespace.",
      });
    }
    if (trimmedReason.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Reason must be at least 10 characters long.",
      });
    }

    // ── Date format validation ───────────────────────────────────────────────
    const fromParsed = parseISODate(fromDate);
    const toParsed   = parseISODate(toDate);

    if (!fromParsed) {
      return res.status(400).json({
        success: false,
        message: "From Date is not a valid date (expected YYYY-MM-DD).",
      });
    }
    if (!toParsed) {
      return res.status(400).json({
        success: false,
        message: "To Date is not a valid date (expected YYYY-MM-DD).",
      });
    }

    // ── Date range validation (local timezone) ───────────────────────────────
    const todayStr   = getLocalTodayStr();
    const todayStart = parseISODate(todayStr); // midnight today in server local time
    const now = new Date();

    if (fromParsed < todayStart) {
      return res.status(400).json({
        success: false,
        message: `From Date (${fromDate}) cannot be before today (${todayStr}).`,
      });
    }

    // ── Same day 10:00 AM cutoff check ──────────────────────────────────────
    if (fromDate === todayStr && now.getHours() >= 10) {
      return res.status(400).json({
        success: false,
        message: "Same-day leave application is not allowed after 10:00 AM. Please select a future date.",
      });
    }

    if (toParsed < fromParsed) {
      return res.status(400).json({
        success: false,
        message: `To Date (${toDate}) cannot be before From Date (${fromDate}).`,
      });
    }

    // ── Overlapping / Duplicate Leave Check ─────────────────────────────────
    const overlappingLeave = await leaveService.findOne({
      staffId,
      status: { $ne: "Rejected" },
      fromDate: { $lte: toDate },
      toDate: { $gte: fromDate },
    });

    if (overlappingLeave) {
      return res.status(400).json({
        success: false,
        message: `You already have an active or pending leave request covering ${overlappingLeave.fromDate} to ${overlappingLeave.toDate}.`,
      });
    }

    // ── Quota Check ──────────────────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    let employee = null;
    if (mongoose.Types.ObjectId.isValid(staffId)) {
      employee = await Employee.findById(staffId);
    }
    if (!employee) {
      employee = await Employee.findOne({ employeeId: staffId });
    }
    const weeklyOff = employee?.weeklyOff || null;
    const { totalQuota } = await getEmployeeYearlyQuota(staffId);
    
    const existingLeaves = await leaveService.findMany({
      filter: {
        staffId,
        status: { $ne: "Rejected" },
        fromDate: { $lte: `${currentYear}-12-31` },
        toDate: { $gte: `${currentYear}-01-01` }
      },
    });
    
    let usedDays = 0;
    existingLeaves.forEach(l => {
      usedDays += getLeaveDaysCount(l.fromDate, l.toDate, currentYear, weeklyOff);
    });
    
    const requestedDays = getLeaveDaysCount(fromDate, toDate, currentYear, weeklyOff);
    const quotaExceeded = (usedDays + requestedDays) > totalQuota;

    // ── Save ─────────────────────────────────────────────────────────────────
    const leave = await leaveService.create({
      staffId,
      staffName,
      reason: trimmedReason,
      leaveType: String(leaveType).trim() || "General",
      fromDate,
      toDate,
      status: "Pending",
      adminReason: "",
      reviewedBy: "",
      reviewedAt: null,
    });

    await Notification.create({
      title: "Leave Request",
      message: `${leave.staffName} submitted a leave request`,
      audienceRole: "admin",
      category: "leave",
    });

    return res.json({
      success: true,
      leave,
      quotaExceeded,
      message: quotaExceeded 
        ? `Warning: You have exceeded your leave limit of ${totalQuota} days for the year. Salary will be deducted for extra leaves.` 
        : "Leave applied successfully."
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


exports.getLeaves = async (req, res) => {
  try {
    const { staffId } = req.params;
    const leaves = await leaveService.findMany({ filter: { staffId }, sort: { createdAt: -1 } });

    return res.json(leaves);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getLeaveStats = async (req, res) => {
  try {
    const { staffId } = req.params;
    const leaves = await leaveService.findMany({ filter: { staffId } });
    const summary = buildLeaveSummary(leaves);

    const currentYear = new Date().getFullYear();
    const quotaInfo = await getEmployeeYearlyQuota(staffId);
    
    let usedDays = 0;
    leaves.filter(l => l.status !== "Rejected").forEach(l => {
      usedDays += getLeaveDaysCount(l.fromDate, l.toDate, currentYear);
    });

    return res.json({
      ...summary,
      ...quotaInfo,
      usedDays,
      remainingDays: Math.max(0, quotaInfo.totalQuota - usedDays)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAdminLeaveOverview = async (req, res) => {
  try {
    const leaves = await leaveService.findMany({ sort: { createdAt: -1 } });
    const summary = buildLeaveSummary(leaves);

    return res.json({
      success: true,
      summary,
      leaves,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminReason, reviewedBy } = req.body;

    if (!LEAVE_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid leave status",
      });
    }

    if (status === "Rejected" && !String(adminReason || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when rejecting leave",
      });
    }

    const updatePayload = {
      status,
      adminReason: String(adminReason || "").trim(),
      reviewedBy: String(reviewedBy || "").trim(),
      reviewedAt: status === "Pending" ? null : new Date(),
    };

    if (status === "Pending") {
      updatePayload.adminReason = "";
      updatePayload.reviewedBy = "";
    }

    const updatedLeave = await leaveService.updateById(id, updatePayload);

    if (!updatedLeave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found",
      });
    }

    if (status === "Approved") {
      await createNotification({
        title: "Leave Approved",
        message: `${updatedLeave.staffName} has approved leave from ${updatedLeave.fromDate} to ${updatedLeave.toDate}.`,
        audienceRole: "admin",
        category: "leave",
      });

      await createStaffNotification({
        title: "Leave Approved",
        message: "Your leave request has been approved.",
        audienceId: updatedLeave.staffId,
        category: "leave",
      });
    }

    if (status === "Rejected") {
      await createStaffNotification({
        title: "Leave Rejected",
        message: `Your leave request has been rejected. Reason: ${updatePayload.adminReason}`,
        audienceId: updatedLeave.staffId,
        category: "leave",
      });
    }

    return res.json({
      success: true,
      leave: updatedLeave,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
