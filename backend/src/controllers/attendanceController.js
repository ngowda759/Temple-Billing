const mongoose = require("mongoose");
const attendanceService = require("../services/attendanceService");
const Employee = require("../models/Employee");
const leaveService = require("../services/leaveService");
const shiftService = require("../services/shiftService");
const taskService = require("../services/taskService");
const User = require("../models/User");
const attendanceSettingService = require("../services/attendanceSettingService");
const { createNotification, createStaffNotification } = require("../utils/notificationService");
const { canMarkAttendanceForStatus } = require("../utils/employeeAccess");

const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Half Day", "Leave"];
const CHECK_IN_LATE_TIME = { hour: 9, minute: 30 };

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; 
}

function getEuclideanDistance(desc1, desc2) {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    sum += Math.pow(desc1[i] - desc2[i], 2);
  }
  return Math.sqrt(sum);
}

const clean = (value) => String(value || "").trim();
const normalizeEmail = (value) => clean(value).toLowerCase();

const toDateKey = (date) => date.toISOString().slice(0, 10);

const parseDateKey = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateLabel = (date) =>
  date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const formatLongDateLabel = (date) =>
  date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

const formatTimeLabel = (date) =>
  date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatWorkingHours = (minutes) => {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}h ${remainder}m`;
};

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseClockTimeToDate = (dateKey, timeValue) => {
  const date = parseDateKey(dateKey);
  const value = clean(timeValue).toUpperCase();
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!date || !match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];

  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

const parseTimeToMinutes = (time) => {
  const value = clean(time).toUpperCase();
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return 0;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const resolveShiftDefinition = async (shiftName) => {
  const value = clean(shiftName);
  if (!value) return null;

  return shiftService.findOne(
    {
      shiftName: new RegExp(`^${escapeRegex(value)}$`, "i"),
      active: true,
    },
    { updatedAt: -1, createdAt: -1 }
  );
};

// Resolves the effective shift start time using defaultShift (falls back to 09:00 AM)
const resolveShiftStartMinutes = async (staff) => {
  const shiftName = staff?.defaultShift || staff?.shift;
  const shift = await resolveShiftDefinition(shiftName);
  return shift?.startTime ? parseTimeToMinutes(shift.startTime) : parseTimeToMinutes("09:00 AM");
};

// Resolves the full shift definition for an employee (defaultShift → Shift document)
const resolveEmployeeShift = async (employee) => {
  if (!employee) return null;
  const shiftName = clean(employee.defaultShift || employee.shift);
  return resolveShiftDefinition(shiftName);
};

const normalizeAssignmentType = (value) => clean(value).toLowerCase();

const isTemporaryShiftAssignment = (task) => {
  const assignmentType = normalizeAssignmentType(task?.assignmentType);
  return assignmentType.includes("temporary") || 
         assignmentType.includes("shift change") ||
         assignmentType.includes("extra") ||
         assignmentType.includes("festival") ||
         assignmentType.includes("emergency") ||
         assignmentType.includes("replacement") ||
         assignmentType.includes("special");
};

const resolveShiftDefinitionFromLookup = (shiftName, shiftLookup) => {
  if (!shiftLookup) return null;
  return shiftLookup.get(clean(shiftName).toLowerCase()) || null;
};

const buildDailyAssignmentContext = async (staff, tasks = [], shiftLookup = null) => {
  const defaultShiftName = clean(staff?.defaultShift || staff?.shift || "Morning") || "Morning";
  const temporaryShiftTask = tasks.find((task) => isTemporaryShiftAssignment(task)) || null;
  const dutyTasks = tasks.filter((task) => !isTemporaryShiftAssignment(task));
  const primaryDutyTask = dutyTasks[0] || null;
  const defaultDuty = clean(staff?.defaultDuty || "");
  const dutyLocation = clean(staff?.dutyLocation || "");

  let shiftDefinition = null;
  let shiftName = defaultShiftName;
  let shiftStartTime = "";
  let shiftEndTime = "";

  if (temporaryShiftTask) {
    shiftName = clean(temporaryShiftTask.shiftName || temporaryShiftTask.dutyName || defaultShiftName) || defaultShiftName;
    shiftStartTime = clean(temporaryShiftTask.shiftStartTime || temporaryShiftTask.reportingTime || temporaryShiftTask.startTime);
    shiftEndTime = clean(temporaryShiftTask.shiftEndTime || temporaryShiftTask.endTime);
    shiftDefinition =
      resolveShiftDefinitionFromLookup(shiftName, shiftLookup) ||
      (shiftStartTime && shiftEndTime
        ? { shiftName, startTime: shiftStartTime, endTime: shiftEndTime }
        : await resolveShiftDefinition(shiftName)) ||
      (shiftName !== defaultShiftName ? await resolveShiftDefinition(defaultShiftName) : null);
  } else {
    shiftDefinition = resolveShiftDefinitionFromLookup(defaultShiftName, shiftLookup) || (await resolveShiftDefinition(defaultShiftName));
  }

  if (shiftDefinition) {
    shiftName = shiftDefinition.shiftName || shiftName;
    shiftStartTime = shiftDefinition.startTime || shiftStartTime;
    shiftEndTime = shiftDefinition.endTime || shiftEndTime;
  }

  // Provide default timing if none is set
  if (!shiftStartTime) {
    shiftStartTime = "09:00 AM";
  }
  if (!shiftEndTime) {
    shiftEndTime = "05:00 PM";
  }

  const dutyName = clean(primaryDutyTask?.dutyName || primaryDutyTask?.duty || primaryDutyTask?.title || defaultDuty);
  const dutyArea = clean(primaryDutyTask?.dutyArea || primaryDutyTask?.area || primaryDutyTask?.description || dutyLocation);

  return {
    defaultShiftName,
    shiftDefinition,
    shiftName,
    shiftStartTime,
    shiftEndTime,
    temporaryShiftTask,
    dutyTasks,
    primaryDutyTask,
    dutyName,
    dutyArea,
    defaultDuty,
    dutyLocation,
  };
};

const matchesEmployeeRecord = (entry, employee) => {
  if (!entry || !employee) return false;
  const employeeId = employee.id?.toString();
  const employeeEmail = clean(employee.email).toLowerCase();
  const entryIds = [entry.staffId, entry.employeeId].map((value) => clean(value)).filter(Boolean);
  const entryEmail = clean(entry.staffEmail).toLowerCase();

  return entryIds.includes(employeeId) || (employeeEmail && entryEmail === employeeEmail);
};
const getMonthRange = (monthValue, referenceDate = new Date()) => {
  const monthKey = /^\d{4}-\d{2}$/.test(monthValue) ? monthValue : toDateKey(referenceDate).slice(0, 7);
  const [yearPart, monthPart] = monthKey.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const startDate = new Date(year, monthIndex, 1);
  const endDate = new Date(year, monthIndex + 1, 0);
  return {
    monthKey,
    year,
    monthIndex,
    startDate,
    endDate,
    monthLabel: startDate.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    }),
  };
};

const findByIdIfValid = async (Model, id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Model.findById(id);
};

const resolveStaffContext = async ({ staffId, staffName, staffEmail }) => {
  const normalizedEmail = normalizeEmail(staffEmail);

  let user =
    (await findByIdIfValid(User, staffId)) ||
    (normalizedEmail ? await User.findOne({ email: normalizedEmail }) : null);

  let employee =
    (await Employee.findById(staffId).populate("attendanceLocation")) ||
    (user?.email ? await Employee.findOne({ email: user.email }).populate("attendanceLocation") : null) ||
    (normalizedEmail ? await Employee.findOne({ email: normalizedEmail }).populate("attendanceLocation") : null);

  if (employee && !employee.populated("attendanceLocation")) {
    await employee.populate("attendanceLocation");
  }

  if (!user && employee?.email) {
    user = await User.findOne({ email: employee.email });
  }

  return {
    staffId: user?._id?.toString() || employee?._id?.toString() || clean(staffId),
    staffName: employee?.name || user?.name || clean(staffName),
    staffEmail: employee?.email || user?.email || normalizedEmail,
    employeeId: employee?._id?.toString() || "",
    // Use defaultShift (new) with fallback to old shift field for backwards compat
    shift: employee?.defaultShift || employee?.shift || "Morning",
    defaultShift: employee?.defaultShift || employee?.shift || "Morning",
    defaultDuty: employee?.defaultDuty || "",
    dutyLocation: employee?.dutyLocation || "",
    attendanceLocationName: employee?.attendanceLocation?.locationName || "Not Assigned",
    department: employee?.department || "",
    role: user?.role || employee?.role || "staff",
    weeklyOff: employee?.weeklyOff || "",
  };
};

const getStaffAttendanceTargets = async (staffId) => {
  const ids = new Set();
  const emails = new Set();

  const user = await findByIdIfValid(User, staffId);
  const employee = await findByIdIfValid(Employee, staffId);

  if (user?._id) ids.add(user._id.toString());
  if (employee?._id) ids.add(employee._id.toString());
  if (user?.email) emails.add(normalizeEmail(user.email));
  if (employee?.email) emails.add(normalizeEmail(employee.email));

  if (user?.email) {
    const linkedEmployee = await Employee.findOne({ email: user.email });
    if (linkedEmployee?._id) ids.add(linkedEmployee._id.toString());
    if (linkedEmployee?.email) emails.add(normalizeEmail(linkedEmployee.email));
  }

  if (employee?.email) {
    const linkedUser = await User.findOne({ email: employee.email });
    if (linkedUser?._id) ids.add(linkedUser._id.toString());
    if (linkedUser?.email) emails.add(normalizeEmail(linkedUser.email));
  }

  if (!ids.size && clean(staffId)) {
    ids.add(clean(staffId));
  }

  return {
    ids: [...ids].filter(Boolean),
    emails: [...emails].filter(Boolean),
  };
};

const buildAttendanceQuery = async (staffId, dateRange = {}) => {
  const targets = await getStaffAttendanceTargets(staffId);
  const filters = [];

  if (targets.ids.length) {
    filters.push({ staffId: { $in: targets.ids } });
    filters.push({ employeeId: { $in: targets.ids } });
  }

  if (targets.emails.length) {
    filters.push({ staffEmail: { $in: targets.emails } });
  }

  const query = filters.length ? { $or: filters } : { staffId: clean(staffId) };

  if (dateRange.dateKey) {
    query.dateKey = dateRange.dateKey;
  } else if (dateRange.startKey && dateRange.endKey) {
    query.dateKey = { $gte: dateRange.startKey, $lte: dateRange.endKey };
  }

  return query;
};

const buildLeaveQuery = async (staffId, startKey, endKey) => {
  const targets = await getStaffAttendanceTargets(staffId);
  const filters = [];

  if (targets.ids.length) {
    filters.push({ staffId: { $in: targets.ids } });
  }

  if (targets.emails.length) {
    filters.push({ staffEmail: { $in: targets.emails } });
  }

  const query = filters.length ? { $or: filters } : { staffId: clean(staffId) };
  query.status = "Approved";
  query.fromDate = { $lte: endKey };
  query.toDate = { $gte: startKey };
  return query;
};

const buildTaskQuery = async (staffId, dateKey) => {
  const targets = await getStaffAttendanceTargets(staffId);
  const filters = [];

  if (targets.ids.length) {
    filters.push({ staffId: { $in: targets.ids } });
    filters.push({ employeeId: { $in: targets.ids } });
  }

  if (targets.emails.length) {
    filters.push({ staffEmail: { $in: targets.emails } });
  }

  const query = filters.length ? { $or: filters } : { staffId: clean(staffId) };

  if (dateKey) {
    query.dueDate = dateKey;
  }

  return query;
};

const normalizeAttendanceStatus = (status) => {
  const value = clean(status);
  if (!value) return "Absent";
  if (value.toLowerCase() === "half day") return "Half Day";
  if (value.toLowerCase() === "late") return "Late"; // Keep for backward compatibility
  if (value.toLowerCase() === "leave") return "Leave";
  if (value.toLowerCase() === "pending") return "Pending";
  if (value.toLowerCase() === "present") return "Present";
  if (value.toLowerCase() === "absent") return "Absent";
  return ATTENDANCE_STATUSES.includes(value) ? value : "Absent";
};

const getEffectiveStatus = (attendance, leave, shiftStartTime) => {
  if (leave) return "Leave";
  if (!attendance) return "Absent";
  if (attendance.status === "Holiday") return "Holiday";
  if (attendance.status === "Leave") return "Leave";
  
  const isLate = attendance.isLateCheckIn || 
                 (attendance.checkIn && attendance.checkIn !== "--" && shiftStartTime && 
                  parseTimeToMinutes(attendance.checkIn) > parseTimeToMinutes(shiftStartTime));
  if (isLate) return "Late";
  
  if (attendance.checkIn && attendance.checkIn !== "--" && (!attendance.checkOut || attendance.checkOut === "--")) {
    return "Working";
  }
  if (attendance.checkIn && attendance.checkIn !== "--" && attendance.checkOut && attendance.checkOut !== "--") {
    return "Present";
  }
  return attendance.status || "Absent";
};

const buildCalendar = ({ monthIndex, startDate, endDate, statusByDate, todayKey, selectedKey }) => {
  const firstVisibleDate = new Date(startDate);
  const startOffset = (firstVisibleDate.getDay() + 6) % 7;
  firstVisibleDate.setDate(firstVisibleDate.getDate() - startOffset);

  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(firstVisibleDate);
    cellDate.setDate(firstVisibleDate.getDate() + index);
    const cellDateKey = toDateKey(cellDate);
    cells.push({
      day: cellDate.getDate(),
      muted: cellDate.getMonth() !== monthIndex,
      current: cellDateKey === todayKey,
      selected: cellDateKey === selectedKey,
      status: statusByDate.get(cellDateKey) || undefined,
    });
  }

  return {
    monthLabel: startDate.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    }),
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    days: cells,
  };
};

const createRecordPayload = (attendance, fallbackShift = {}) => {
  const fallback = typeof fallbackShift === "string" ? { shift: fallbackShift } : fallbackShift || {};
  const date = parseDateKey(attendance.dateKey);
  return {
    id: attendance._id.toString(),
    employeeId: attendance.employeeId || attendance.staffId || "",
    employeeName: attendance.staffName || "",
    employeeEmail: attendance.staffEmail || "",
    dateKey: attendance.dateKey,
    date: date ? formatDateLabel(date) : attendance.dateKey,
    checkIn: attendance.checkIn || "--",
    checkOut: attendance.checkOut || "--",
    shift: attendance.shift || fallback.shiftName || fallback.shift || "Morning",
    shiftStartTime: attendance.shiftStartTime || fallback.shiftStartTime || "",
    shiftEndTime: attendance.shiftEndTime || fallback.shiftEndTime || "",
    assignmentType: attendance.assignmentType || fallback.assignmentType || "",
    dutyName: attendance.dutyName || fallback.dutyName || "",
    dutyArea: attendance.dutyArea || fallback.dutyArea || "",
    defaultDuty: fallback.defaultDuty || "",
    dutyLocation: fallback.dutyLocation || "",
    status: normalizeAttendanceStatus(attendance.status),
    workingHours: attendance.workingHours || "--",
  };
};

const createLeavePayload = (leave, fallbackShift = {}) => {
  const fallback = typeof fallbackShift === "string" ? { shift: fallbackShift } : fallbackShift || {};
  const date = parseDateKey(leave.fromDate);
  return {
    id: leave._id.toString(),
    employeeId: leave.staffId || "",
    employeeName: leave.staffName || "",
    employeeEmail: leave.staffEmail || "",
    dateKey: leave.fromDate,
    date: date ? formatDateLabel(date) : leave.fromDate,
    checkIn: "--",
    checkOut: "--",
    shift: fallback.shiftName || fallback.shift || "Morning",
    status: "Leave",
    workingHours: "--",
  };
};

const createTaskPayload = (task) => ({
  id: task._id.toString(),
  staffId: task.staffId,
  employeeId: task.employeeId || "",
  staffEmail: task.staffEmail || "",
  staffName: task.staffName || "",
  assignmentType: task.assignmentType || "Special Duty",
  shiftId: task.shiftId || "",
  shiftName: task.shiftName || "",
  shiftStartTime: task.shiftStartTime || "",
  shiftEndTime: task.shiftEndTime || "",
  dateKey: task.dateKey || task.dueDate || "",
  dutyName: task.dutyName || task.title || task.duty || "",
  duty: task.title || task.duty || "",
  dutyArea: task.dutyArea || task.area || task.description || "",
  area: task.area || task.description || "",
  dueDate: task.dueDate || task.dateKey || task.time || "",
  reportingTime: task.reportingTime || task.time || task.startTime || "",
  time: task.time || task.reportingTime || task.dueDate || "",
  assignedBy: task.assignedBy || "",
  status: task.status || "Pending",
  attendanceStatus: task.attendanceStatus || task.status || "Pending",
  conflict: Boolean(task.conflict),
  notes: task.notes || "",
  startTime: task.startTime || "",
  endTime: task.endTime || "",
  requiredStaff: task.requiredStaff || 1,
});

const buildDashboardResponse = async (staffId, monthValue) => {
  const staff = await resolveStaffContext({ staffId });
  const { monthKey, year, monthIndex, startDate, endDate, monthLabel } = getMonthRange(monthValue);
  const currentMonthKey = toDateKey(new Date()).slice(0, 7);
  const analyticsEndDate = monthKey === currentMonthKey ? new Date() : endDate;
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(analyticsEndDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);
  const baseShiftDefinition = await resolveShiftDefinition(staff.defaultShift || staff.shift);
  const baseShiftContext = {
    shift: baseShiftDefinition?.shiftName || staff.defaultShift || staff.shift || "Morning",
    shiftName: baseShiftDefinition?.shiftName || staff.defaultShift || staff.shift || "Morning",
    shiftStartTime: baseShiftDefinition?.startTime || "",
    shiftEndTime: baseShiftDefinition?.endTime || "",
    defaultDuty: staff.defaultDuty || "",
    dutyLocation: staff.dutyLocation || "",
  };

  const [attendanceDocs, leaveDocs] = await Promise.all([
    attendanceService.findMany({
      filter: await buildAttendanceQuery(staffId, { startKey, endKey }),
      sort: { dateKey: -1, createdAt: -1 },
    }),
    leaveService.findMany({
      filter: await buildLeaveQuery(staffId, startKey, endKey),
      sort: { fromDate: -1, createdAt: -1 },
    }),
  ]);
  // Also load today's special assignments (for extra duty / temporary shifts)
  const todayTasks = await taskService.findMany({
    filter: await buildTaskQuery(staffId, todayKey),
    sort: { dueDate: 1, time: 1, createdAt: -1 },
  });
  const dailyContext = await buildDailyAssignmentContext(staff, todayTasks);

  const attendanceByDate = new Map();
  attendanceDocs.forEach((doc) => {
    attendanceByDate.set(doc.dateKey, doc);
  });

  const leaveByDate = new Map();
  leaveDocs.forEach((leave) => {
    const leaveStart = parseDateKey(leave.fromDate);
    const leaveEnd = parseDateKey(leave.toDate);
    if (!leaveStart || !leaveEnd) return;

    for (let cursor = new Date(leaveStart); cursor <= leaveEnd; cursor.setDate(cursor.getDate() + 1)) {
      const cursorKey = toDateKey(cursor);
      if (cursorKey < startKey || cursorKey > endKey) continue;
      if (!leaveByDate.has(cursorKey)) {
        leaveByDate.set(cursorKey, leave);
      }
    }
  });

  const statusByDate = new Map();
  const timeline = [];
  let presentDays = 0;
  let absentDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let lateDays = 0;

  for (let cursor = new Date(startDate); cursor <= analyticsEndDate; cursor.setDate(cursor.getDate() + 1)) {
    const currentKey = toDateKey(cursor);
    const attendance = attendanceByDate.get(currentKey);
    const leave = leaveByDate.get(currentKey);
    const hasPastDate = currentKey <= endKey;

    let status = null;
    let checkIn = "--";
    let checkOut = "--";
    let shift = baseShiftContext.shiftName || staff.shift || "Morning";
    let shiftStartTime = baseShiftContext.shiftStartTime || "";
    let shiftEndTime = baseShiftContext.shiftEndTime || "";
    let workingHours = "--";

    if (leave) {
      status = "Leave";
      leaveDays += 1;
    } else if (attendance) {
      status = normalizeAttendanceStatus(attendance.status);
      checkIn = attendance.checkIn || "--";
      checkOut = attendance.checkOut || "--";
      shift = attendance.shift || shift;
      shiftStartTime = attendance.shiftStartTime || shiftStartTime;
      shiftEndTime = attendance.shiftEndTime || shiftEndTime;
      workingHours = attendance.workingHours || "--";

      if (status === "Late") {
        presentDays += 1;
        lateDays += 1;
      } else if (status === "Present") {
        presentDays += 1;
      } else if (status === "Pending") {
        // Pending means checked in but not checked out yet - don't count as present/absent yet
        // Will only count once they check out and status is finalized
      } else if (status === "Half Day") {
        halfDays += 1;
      } else if (status === "Absent") {
        const cursorDayName = cursor.toLocaleDateString('en-US', { weekday: 'long' });
        if (staff.weeklyOff && staff.weeklyOff === cursorDayName) {
          status = "Weekly Off";
        } else {
          absentDays += 1;
        }
      } else if (status === "Leave") {
        leaveDays += 1;
      }
    } else if (hasPastDate) {
      const cursorDayName = cursor.toLocaleDateString('en-US', { weekday: 'long' });
      if (staff.weeklyOff && staff.weeklyOff === cursorDayName) {
        status = "Weekly Off";
      } else {
        status = "Absent";
        absentDays += 1;
      }
    }

    if (status) {
      statusByDate.set(currentKey, status);
    }

    if (status && (attendance || leave || status !== "Absent")) {
      timeline.push({
        dateKey: currentKey,
        date: formatDateLabel(cursor),
        checkIn,
        checkOut,
        shift,
        shiftStartTime,
        shiftEndTime,
        status,
        workingHours,
      });
    }
  }

  const workingDays = presentDays + absentDays + halfDays + leaveDays;
  const attendancePercent = workingDays > 0 ? Math.round((presentDays / workingDays) * 100) : 0;
  const latestStatusEntry = [...timeline].sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0];
  const recentRecordsMap = new Map();
  attendanceDocs.forEach((doc) => {
    recentRecordsMap.set(doc.dateKey, createRecordPayload(doc, baseShiftContext));
  });
  leaveDocs.forEach((leave) => {
    if (!recentRecordsMap.has(leave.fromDate)) {
      recentRecordsMap.set(leave.fromDate, createLeavePayload(leave, baseShiftContext));
    }
  });
  const recentRecords = [...recentRecordsMap.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  const todayAttendance = attendanceByDate.get(todayKey) || null;
  const todayLeave = leaveByDate.get(todayKey) || null;
  const todayTaskList = todayTasks.map((task) => createTaskPayload(task));
  const todayDutyTask = dailyContext.primaryDutyTask ? createTaskPayload(dailyContext.primaryDutyTask) : null;
  const todayDutySummary = todayDutyTask || (dailyContext.defaultDuty
    ? {
        id: `default-duty-${todayKey}`,
        dutyName: dailyContext.defaultDuty,
        duty: dailyContext.defaultDuty,
        dutyArea: dailyContext.dutyLocation || "",
        area: dailyContext.dutyLocation || "",
        assignmentType: "Default Duty",
      }
    : null);
  const todayStatus = todayLeave && !todayAttendance
    ? "Leave"
    : todayAttendance
      ? normalizeAttendanceStatus(todayAttendance.status)
      : "Not Started";
  const canCheckIn = !todayLeave && (!todayAttendance || !todayAttendance.checkIn || todayAttendance.checkIn === "--");
  const canCheckOut = !todayLeave && Boolean(todayAttendance?.checkIn) && todayAttendance.checkOut === "--";
  const attendanceCompleted = Boolean(todayAttendance?.checkIn && todayAttendance?.checkOut && todayAttendance.checkOut !== "--");

  const selectedKey = latestStatusEntry?.dateKey || todayKey;
  const calendar = buildCalendar({
    monthIndex,
    startDate,
    endDate,
    statusByDate,
    todayKey,
    selectedKey,
  });

  return {
    success: true,
    month: monthKey,
    monthLabel,
    headerDate: formatLongDateLabel(today),
    staff: {
      id: staff.staffId,
      name: staff.staffName,
      email: staff.staffEmail,
      role: staff.role,
      shift: dailyContext.shiftName,
      defaultShift: dailyContext.defaultShiftName,
      defaultDuty: dailyContext.defaultDuty,
      dutyLocation: dailyContext.dutyLocation,
      shiftStartTime: dailyContext.shiftStartTime || "",
      shiftEndTime: dailyContext.shiftEndTime || "",
      department: staff.department,
    },
    today: {
      dateKey: todayKey,
      dateLabel: formatLongDateLabel(today),
      status: todayStatus,
      shift: dailyContext.shiftName,
      shiftName: dailyContext.shiftName,
      shiftStartTime: dailyContext.shiftStartTime || "",
      shiftEndTime: dailyContext.shiftEndTime || "",
      defaultDuty: dailyContext.defaultDuty,
      dutyLocation: dailyContext.dutyLocation,
      attendanceLocationName: staff.attendanceLocationName,
      checkIn: todayAttendance?.checkIn || "--",
      checkOut: todayAttendance?.checkOut || "--",
      workingHours: todayAttendance?.workingHours || "--",
      duty: todayDutySummary,
      duties: todayTaskList,
      leaveReason: todayLeave?.reason || "",
      leaveType: todayLeave?.leaveType || "",
      isOnLeave: Boolean(todayLeave && !todayAttendance),
      canCheckIn,
      canCheckOut,
      completed: attendanceCompleted,
    },
    summary: {
      workingDays,
      presentDays,
      absentDays,
      halfDays,
      leaveDays,
      lateDays,
      attendancePercent,
    },
    overview: [
      { label: "Working Days", value: String(workingDays) },
      { label: "Present", value: String(presentDays), tone: "success" },
      { label: "Absent", value: String(absentDays), tone: "danger" },
      { label: "Leave", value: String(leaveDays), tone: "info" },
      { label: "Half Days", value: String(halfDays), tone: "warning" },
      { label: "Attendance", value: `${attendancePercent}%`, tone: "accent" },
    ],
    records: recentRecords.slice(0, 8),
    timeline,
    calendar,
    quickActions: [
      {
        key: "mark-attendance",
        title: "Mark Attendance",
        description: "Check In / Check Out",
      },
      {
        key: "download",
        title: "Download Report",
        description: "Download monthly report",
      },
    ],
  };
};

const buildAdminAttendanceDashboard = async (monthValue, filterEmployeeId = null, filters = {}) => {
  const { monthKey, monthIndex, startDate, endDate, monthLabel } = getMonthRange(monthValue);
  const currentMonthKey = toDateKey(new Date()).slice(0, 7);
  const analyticsEndDate = monthKey === currentMonthKey ? new Date() : endDate;
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(analyticsEndDate);
  
  // Set todayKey as filters.date if provided, otherwise the actual today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = filters.date ? filters.date : toDateKey(today);

  // Build employee query
  const employeeQuery = {
    role: { $ne: "admin" },
    status: { $in: ["Active", "On Leave"] },
  };
  if (filters.role && filters.role !== "all" && filters.role !== "All") {
    employeeQuery.role = String(filters.role).toLowerCase();
  }
  if (filters.department && filters.department !== "all" && filters.department !== "All") {
    employeeQuery.department = filters.department;
  }
  if (filterEmployeeId) {
    employeeQuery.$or = [
      { _id: mongoose.Types.ObjectId.isValid(filterEmployeeId) ? filterEmployeeId : null },
      { name: filterEmployeeId },
      { email: filterEmployeeId },
    ].filter(item => Object.values(item)[0] !== null);
  }

  const [employees, attendanceDocs, leaveDocs, dutyDocs, shiftDocs] = await Promise.all([
    Employee.find(employeeQuery).sort({ name: 1 }),
    attendanceService.findMany({
      filter: { dateKey: { $gte: startKey, $lte: endKey } },
      sort: { dateKey: -1, createdAt: -1 },
    }),
    leaveService.findMany({
      filter: {
        status: "Approved",
        fromDate: { $lte: endKey },
        toDate: { $gte: startKey },
      },
      sort: { fromDate: -1, createdAt: -1 },
    }),
    taskService.findMany({ filter: { dueDate: todayKey }, sort: { createdAt: -1 } }),
    shiftService.findMany({ filter: { active: true }, sort: { shiftName: 1 } }),
  ]);

  const shiftByName = new Map(
    shiftDocs.map((shift) => [clean(shift.shiftName).toLowerCase(), shift])
  );

  const employeeContexts = await Promise.all(
    employees.map(async (employee) => {
      const shiftKey = clean(employee.defaultShift || employee.shift).toLowerCase();
      const shiftDefinition = shiftByName.get(shiftKey) || null;
      const employeeTodayTasks = dutyDocs.filter((task) => matchesEmployeeRecord(task, employee));
      const todayContext = await buildDailyAssignmentContext(
        {
          defaultShift: employee.defaultShift || employee.shift,
          shift: employee.defaultShift || employee.shift,
          defaultDuty: employee.defaultDuty,
          dutyLocation: employee.dutyLocation,
        },
        employeeTodayTasks,
        shiftByName
      );

      return {
        id: employee._id.toString(),
        name: employee.name,
        email: employee.email,
        photo: employee.photo || "",
        shift: employee.defaultShift || employee.shift || "Morning",
        shiftStartTime: shiftDefinition?.startTime || "",
        shiftEndTime: shiftDefinition?.endTime || "",
        defaultDuty: employee.defaultDuty || "",
        dutyLocation: employee.dutyLocation || "",
        department: employee.department || "General",
        role: employee.role || "staff",
        status: employee.status || "Active",
        joiningDate: employee.joiningDate ? toDateKey(new Date(employee.joiningDate)) : "",
        todayContext,
      };
    })
  );

  const employeeList = employeeContexts.map(({ todayContext, ...employee }) => employee);

  const employeeById = new Map();
  const employeeByEmail = new Map();
  const employeeContextById = new Map();
  const employeeContextByEmail = new Map();
  employeeContexts.forEach((employee) => {
    employeeById.set(employee.id, employee);
    employeeByEmail.set(normalizeEmail(employee.email), employee);
    employeeContextById.set(employee.id, employee.todayContext);
    employeeContextByEmail.set(normalizeEmail(employee.email), employee.todayContext);
  });

  const attendanceMap = new Map();
  attendanceDocs.forEach((attendance) => {
    const recordKey = `${attendance.staffId || attendance.employeeId || attendance.staffEmail || ""}:${attendance.dateKey}`;
    attendanceMap.set(recordKey, attendance);
    
    // Also support lookup by employeeId directly
    const empId = attendance.employeeId || attendance.staffId;
    if (empId) {
      attendanceMap.set(`${empId}:${attendance.dateKey}`, attendance);
    }
  });

  const leaveMap = new Map();
  leaveDocs.forEach((leave) => {
    const fromDate = parseDateKey(leave.fromDate);
    const toDate = parseDateKey(leave.toDate);
    if (!fromDate || !toDate) return;

    for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setDate(cursor.getDate() + 1)) {
      const cursorKey = toDateKey(cursor);
      const recordKey = `${leave.staffId}:${cursorKey}`;
      if (!leaveMap.has(recordKey)) {
        leaveMap.set(recordKey, leave);
      }
    }
  });

  const buildEmployeeLookup = (attendance) => {
    const byId = attendance.staffId ? employeeById.get(attendance.staffId) : null;
    const byEmail = attendance.staffEmail ? employeeByEmail.get(normalizeEmail(attendance.staffEmail)) : null;
    return byId || byEmail || null;
  };

  const getEmployeeContext = (employee) =>
    employeeContextById.get(employee.id) || employeeContextByEmail.get(normalizeEmail(employee.email)) || null;

  // 1. Calculate Today's records and statuses for each employee on todayKey (filtered or today)
  const eligibleTodayEmployees = employeeList.filter(
    (employee) => !employee.joiningDate || employee.joiningDate <= todayKey
  );

  const todayRecords = eligibleTodayEmployees.map((employee) => {
    const attendance = attendanceMap.get(`${employee.id}:${todayKey}`);
    const leave = leaveMap.get(`${employee.id}:${todayKey}`);
    const employeeContext = getEmployeeContext(employee);
    const shiftStartTime = attendance?.shiftStartTime || employeeContext?.shiftStartTime || employee.shiftStartTime || "09:00 AM";
    const status = getEffectiveStatus(attendance, leave, shiftStartTime);

    return {
      id: attendance?._id?.toString() || `${employee.id}:${todayKey}`,
      employeeId: employee.id,
      employeePhoto: employee.photo || "",
      employeeName: employee.name,
      employeeEmail: employee.email,
      role: employee.role,
      department: employee.department,
      shift: attendance?.shift || employeeContext?.shiftName || employee.shift || "Morning",
      shiftStartTime: shiftStartTime,
      shiftEndTime: attendance?.shiftEndTime || employeeContext?.shiftEndTime || employee.shiftEndTime || "05:00 PM",
      assignmentType: attendance?.assignmentType || employeeContext?.temporaryShiftTask?.assignmentType || "Default Shift",
      dutyName: attendance?.dutyName || employeeContext?.dutyName || employee.defaultDuty || "",
      dutyArea: attendance?.dutyArea || employeeContext?.dutyArea || employee.dutyLocation || "",
      defaultDuty: employee.defaultDuty || "",
      dutyLocation: employee.dutyLocation || "",
      checkIn: attendance?.checkIn || "--",
      checkOut: attendance?.checkOut || "--",
      status,
      workingHours: attendance?.workingHours || "--",
      workingMinutes: attendance?.workingMinutes || 0,
      note: attendance?.note || "",
      correctedBy: attendance?.correctedBy || "",
      correctionDate: attendance?.correctionDate || null,
      correctionReason: attendance?.correctionReason || "",
      faceVerified: attendance?.faceVerified || false,
      locationVerified: attendance?.locationVerified || false,
      distanceFromTemple: attendance?.distanceFromTemple || null,
      checkInPhoto: attendance?.checkInPhoto || "",
    };
  });

  // Calculate today's summary metrics (before applying the status filter to the table records)
  const totalEmployeesCount = todayRecords.length;
  const todayPresentCount = todayRecords.filter(r => ["Present", "Working", "Late"].includes(r.status)).length;
  const todayAbsentCount = todayRecords.filter(r => r.status === "Absent").length;
  const todayLeaveCount = todayRecords.filter(r => r.status === "Leave").length;
  const todayLateCount = todayRecords.filter(r => r.status === "Late").length;

  const overview = [
    { label: "Total Employees", value: String(totalEmployeesCount), tone: "info" },
    { label: "Present Today", value: String(todayPresentCount), tone: "success" },
    { label: "Absent Today", value: String(todayAbsentCount), tone: "danger" },
    { label: "On Leave", value: String(todayLeaveCount), tone: "warning" },
    { label: "Late Check-in", value: String(todayLateCount), tone: "accent" },
  ];

  // Apply Status filter to Today's Records
  let filteredTodayRecords = todayRecords;
  if (filters.status && filters.status !== "all" && filters.status !== "All") {
    filteredTodayRecords = todayRecords.filter(r => r.status.toLowerCase() === filters.status.toLowerCase());
  }

  // 2. Build Monthly History records for all matching employees
  const employeeSet = new Set(employeeList.map(e => e.id));

  const attendanceRecords = attendanceDocs
    .filter(doc => {
      const emp = buildEmployeeLookup(doc);
      return emp && employeeSet.has(emp.id);
    })
    .map(doc => {
      const emp = buildEmployeeLookup(doc);
      const empContext = getEmployeeContext(emp);
      const shiftStartTime = doc.shiftStartTime || empContext?.shiftStartTime || emp?.shiftStartTime || "09:00 AM";
      const status = getEffectiveStatus(doc, null, shiftStartTime);
      return {
        id: doc._id.toString(),
        employeeId: emp.id,
        employeePhoto: emp.photo || "",
        employeeName: emp.name,
        employeeEmail: emp.email,
        dateKey: doc.dateKey,
        date: parseDateKey(doc.dateKey) ? formatDateLabel(parseDateKey(doc.dateKey)) : doc.dateKey,
        department: emp.department || "General",
        shift: doc.shift || emp.defaultShift || emp.shift || "Morning",
        shiftStartTime: shiftStartTime,
        shiftEndTime: doc.shiftEndTime || empContext?.shiftEndTime || emp?.shiftEndTime || "05:00 PM",
        checkIn: doc.checkIn || "--",
        checkOut: doc.checkOut || "--",
        workingHours: doc.workingHours || "--",
        workingMinutes: doc.workingMinutes || 0,
        status: status,
        correctedBy: doc.correctedBy || "",
        correctionDate: doc.correctionDate || null,
        correctionReason: doc.correctionReason || "",
        faceVerified: doc.faceVerified || false,
        locationVerified: doc.locationVerified || false,
        distanceFromTemple: doc.distanceFromTemple || null,
        checkInPhoto: doc.checkInPhoto || "",
      };
    });

  const leaveRecords = leaveDocs
    .filter(leave => {
      const emp = employeeById.get(leave.staffId) || employeeByEmail.get(normalizeEmail(leave.staffEmail));
      return emp && employeeSet.has(emp.id);
    })
    .filter(leave => {
      return !attendanceDocs.some(att => att.staffId === leave.staffId && att.dateKey === leave.fromDate);
    })
    .map(leave => {
      const emp = employeeById.get(leave.staffId) || employeeByEmail.get(normalizeEmail(leave.staffEmail));
      return {
        id: leave._id.toString(),
        employeeId: emp.id,
        employeePhoto: emp.photo || "",
        employeeName: emp.name,
        employeeEmail: emp.email,
        dateKey: leave.fromDate,
        date: parseDateKey(leave.fromDate) ? formatDateLabel(parseDateKey(leave.fromDate)) : leave.fromDate,
        department: emp.department || "General",
        shift: emp.defaultShift || emp.shift || "Morning",
        shiftStartTime: "",
        shiftEndTime: "",
        checkIn: "--",
        checkOut: "--",
        workingHours: "--",
        status: "Leave",
      };
    });

  const monthlyHistory = [...attendanceRecords, ...leaveRecords].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  
  // Apply Status filter to Monthly History
  let filteredMonthlyHistory = monthlyHistory;
  if (filters.status && filters.status !== "all" && filters.status !== "All") {
    filteredMonthlyHistory = monthlyHistory.filter(r => r.status.toLowerCase() === filters.status.toLowerCase());
  }

  // 3. Build Timeline (Calendar Days stats)
  const timeline = [];
  for (let cursor = new Date(startDate); cursor <= analyticsEndDate; cursor.setDate(cursor.getDate() + 1)) {
    const currentKey = toDateKey(cursor);
    let dayPresentCount = 0;
    let dayAbsentCount = 0;
    let dayLeaveCount = 0;
    let dayLateCount = 0;
    let dayHolidayCount = 0;

    employeeList.forEach((employee) => {
      if (employee.joiningDate && currentKey < employee.joiningDate) return;
      const attendance = attendanceMap.get(`${employee.id}:${currentKey}`);
      const leave = leaveMap.get(`${employee.id}:${currentKey}`);
      const employeeContext = getEmployeeContext(employee);
      const shiftStartTime = attendance?.shiftStartTime || employeeContext?.shiftStartTime || employee.shiftStartTime || "09:00 AM";

      const status = getEffectiveStatus(attendance, leave, shiftStartTime);
      if (status === "Present" || status === "Working" || status === "Late") {
        dayPresentCount += 1;
        if (status === "Late") {
          dayLateCount += 1;
        }
      } else if (status === "Leave") {
        dayLeaveCount += 1;
      } else if (status === "Holiday") {
        dayHolidayCount += 1;
      } else {
        dayAbsentCount += 1;
      }
    });

    timeline.push({
      dateKey: currentKey,
      date: formatDateLabel(cursor),
      present: dayPresentCount,
      absent: dayAbsentCount,
      leave: dayLeaveCount,
      holiday: dayHolidayCount,
      late: dayLateCount,
    });
  }

  const shiftSummary = employeeContexts.reduce((accumulator, employee) => {
    const label = employee.todayContext?.shiftName || employee.shift || "Morning";
    accumulator[label] = (accumulator[label] || 0) + 1;
    return accumulator;
  }, {});

  // For Employee Summary, if filtering a single employee, let's also pass their summary details
  let selectedEmployeeRecords = [];
  let selectedEmployee = null;
  if (filterEmployeeId && employees.length > 0) {
    selectedEmployee = employees[0];
    selectedEmployeeRecords = monthlyHistory.filter(
      (r) =>
        r.employeeId === selectedEmployee.id ||
        r.employeeEmail?.toLowerCase() === selectedEmployee.email?.toLowerCase() ||
        r.employeeName === selectedEmployee.name
    );
  }

  return {
    success: true,
    month: monthKey,
    monthLabel,
    headerDate: formatLongDateLabel(today),
    summary: {
      workingDays: timeline.length,
      presentDays: todayPresentCount, // fallback or general month stats if needed
      absentDays: todayAbsentCount,
      leaveDays: todayLeaveCount,
      lateDays: todayLateCount,
      totalEmployees: eligibleTodayEmployees.length,
      totalRecords: attendanceDocs.length,
    },
    overview,
    records: filteredMonthlyHistory,
    selectedEmployee,
    selectedEmployeeRecords,
    todayRecords: filteredTodayRecords,
    timeline,
    shiftSummary,
  };
};

exports.getStaffAttendanceDashboard = async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month } = req.query;

    if (!clean(staffId)) {
      return res.status(400).json({
        success: false,
        message: "staffId is required",
      });
    }

    const payload = await buildDashboardResponse(staffId, month);

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getStaffAttendanceRecords = async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month } = req.query;

    if (!clean(staffId)) {
      return res.status(400).json({
        success: false,
        message: "staffId is required",
      });
    }

    const payload = await buildDashboardResponse(staffId, month);

    return res.json({
      success: true,
      month: payload.month,
      monthLabel: payload.monthLabel,
      records: payload.records,
      summary: payload.summary,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getStaffAttendanceSummary = async (req, res) => {
  try {
    const { staffId } = req.params;
    const { month } = req.query;

    if (!clean(staffId)) {
      return res.status(400).json({
        success: false,
        message: "staffId is required",
      });
    }

    const payload = await buildDashboardResponse(staffId, month);

    return res.json({
      success: true,
      month: payload.month,
      monthLabel: payload.monthLabel,
      summary: payload.summary,
      overview: payload.overview,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAdminAttendanceDashboard = async (req, res) => {
  try {
    const { month, year, employeeId, role, department, date, status } = req.query;
    const monthValue = month && /^\d{4}-\d{2}$/.test(month)
      ? month
      : year && month
        ? `${year}-${String(month).padStart(2, "0")}`
        : month;
    const payload = await buildAdminAttendanceDashboard(
      monthValue,
      employeeId || null,
      { role, department, date, status }
    );

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.markAttendance = async (req, res) => {
  try {
    const { 
      staffId, staffName, staffEmail, action,
      faceDescriptor, latitude, longitude,
      browser, ipAddress, deviceInfo, photo
    } = req.body;
    const normalizedAction = clean(action).toLowerCase();

    if (!clean(staffId)) {
      return res.status(400).json({
        success: false,
        message: "staffId is required",
      });
    }

    if (!["check-in", "check-out"].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        message: "action must be check-in or check-out",
      });
    }

    const staff = await resolveStaffContext({ staffId, staffName, staffEmail });
    const now = new Date();
    const dateKey = toDateKey(now);
    const todayLeave = await leaveService.findOne(await buildLeaveQuery(staffId, dateKey, dateKey));

    if (todayLeave) {
      return res.status(409).json({
        success: false,
        message: "You are on approved leave today. Attendance cannot be marked.",
      });
    }

    const employee = await Employee.findOne({ email: staff.staffEmail }).populate("attendanceLocation") || await Employee.findById(staff.employeeId).populate("attendanceLocation");
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee profile not found" });
    }
    
    if (!employee.faceRegistered || !employee.faceDescriptor || !employee.faceDescriptor.length) {
      return res.status(403).json({ success: false, message: "No registered face found. Please contact the administrator to register your face." });
    }

    if (!canMarkAttendanceForStatus(employee.status)) {
      return res.status(403).json({
        success: false,
        message: employee.status === "On Leave"
          ? "Attendance is unavailable while employee status is On Leave"
          : `Attendance is disabled because employee status is ${employee.status || "Inactive"}`,
      });
    }
    if (employee.joiningDate) {
      const joiningKey = toDateKey(new Date(employee.joiningDate));
      if (dateKey < joiningKey) {
        return res.status(403).json({
          success: false,
          message: `Attendance becomes available on the joining date (${joiningKey})`,
        });
      }
    }
    const todayTasks = await taskService.findMany({ filter: await buildTaskQuery(staffId, dateKey) });
    const dailyContext = await buildDailyAssignmentContext(
      {
        defaultShift: employee?.defaultShift || employee?.shift || staff.defaultShift || staff.shift,
        shift: employee?.defaultShift || employee?.shift || staff.defaultShift || staff.shift,
        defaultDuty: employee?.defaultDuty || staff.defaultDuty,
        dutyLocation: employee?.dutyLocation || staff.dutyLocation,
      },
      todayTasks
    );
    const hasDefaultShift = Boolean(employee?.defaultShift || employee?.shift || staff.defaultShift || staff.shift);
    const hasDutyAssignment = Boolean(dailyContext.primaryDutyTask || dailyContext.defaultDuty);
    const hasTemporaryAssignment = Boolean(dailyContext.temporaryShiftTask);

    if (!hasDefaultShift && !hasDutyAssignment && !hasTemporaryAssignment) {
      return res.status(403).json({
        success: false,
        message: "No shift assigned for today.",
      });
    }

    if (employee.weeklyOff) {
      const currentDayName = now.toLocaleDateString('en-US', { weekday: 'long' });
      if (employee.weeklyOff === currentDayName) {
        const hasEmergencyDuty = todayTasks.some(t => clean(t.assignmentType) === "Emergency Duty");
        if (!hasEmergencyDuty) {
          return res.status(403).json({
            success: false,
            message: "Today is your Weekly Off. Attendance cannot be marked without an Emergency Duty assignment.",
          });
        }
      }
    }

    let settings = await attendanceSettingService.getOrCreate();

    let faceVerified = false;
    let locationVerified = false;
    let distanceFromTemple = null;

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      const distance = getEuclideanDistance(employee.faceDescriptor, faceDescriptor);
      console.log(`Face matching distance: ${distance}`);
      if (distance < 0.6) faceVerified = true;
    }

    if (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null) {
      if (employee.attendanceLocation) {
        distanceFromTemple = getHaversineDistance(latitude, longitude, employee.attendanceLocation.latitude, employee.attendanceLocation.longitude);
        if (distanceFromTemple <= employee.attendanceLocation.allowedRadius) locationVerified = true;
      } else {
        if (settings.templeLatitude === 0 && settings.templeLongitude === 0) {
          locationVerified = true;
        } else {
          distanceFromTemple = getHaversineDistance(latitude, longitude, settings.templeLatitude, settings.templeLongitude);
          if (distanceFromTemple <= settings.allowedRadius) locationVerified = true;
        }
      }
    }

    if (!faceVerified || !locationVerified) {
      return res.status(400).json({
        success: false,
        message: !faceVerified ? "Face Verification Failed" : "You are outside the allowed attendance area"
      });
    }

    const hasOvertimeAssignment = todayTasks.some((task) => normalizeAssignmentType(task.assignmentType).includes("overtime"));
    const isOvertime = hasOvertimeAssignment;

    const attendanceQuery = await buildAttendanceQuery(staffId, { dateKey });
    let attendance = await attendanceService.findOne(attendanceQuery);

    if (normalizedAction === "check-in") {
      if (attendance?.checkIn && attendance.checkIn !== "--") {
        return res.status(409).json({
          success: false,
          message: "You have already checked in for today",
          attendance,
        });
      }

      const shiftStartMinutes = dailyContext.shiftStartTime
        ? parseTimeToMinutes(dailyContext.shiftStartTime)
        : await resolveShiftStartMinutes({
            defaultShift: dailyContext.shiftName,
            shift: dailyContext.shiftName,
          });
      const checkInMinutes = now.getHours() * 60 + now.getMinutes();
      const isLate = checkInMinutes > (shiftStartMinutes + settings.lateThreshold);

      const payload = {
        staffId: staff.staffId,
        staffName: staff.staffName,
        employeeId: staff.employeeId || undefined,
        staffEmail: staff.staffEmail || undefined,
        dateKey,
        checkIn: formatTimeLabel(now),
        checkInAt: now,
        checkOut: "--",
        checkOutAt: null,
        shift: dailyContext.shiftName || staff.shift || "Morning",
        shiftStartTime: dailyContext.shiftStartTime || "",
        shiftEndTime: dailyContext.shiftEndTime || "",
        assignmentType: dailyContext.temporaryShiftTask?.assignmentType || dailyContext.primaryDutyTask?.assignmentType || "Default Shift",
        dutyName: dailyContext.dutyName || dailyContext.defaultDuty || "",
        dutyArea: dailyContext.dutyArea || dailyContext.dutyLocation || "",
        status: "Pending",
        workingMinutes: 0,
        workingHours: "--",
        isOvertime: isOvertime,
        overtimeMinutes: 0,
        overtimeHours: "--",
        source: "biometric",
        isLateCheckIn: isLate,
        latitude,
        longitude,
        distanceFromTemple,
        locationVerified,
        faceVerified,
        deviceInfo,
        browser,
        ipAddress,
        checkInPhoto: photo || "",
      };

      // The Mongoose path used findByIdAndUpdate(..., { upsert: true }); keep the
      // same "recreate if the record vanished between the read and the write"
      // behaviour on both datasources.
      if (attendance) {
        attendance = (await attendanceService.updateById(attendance._id, payload))
          || (await attendanceService.create(payload));
      } else {
        attendance = await attendanceService.create(payload);
      }

      await createNotification({
        title: isLate ? "Late Check-in Alert" : "Attendance Marked",
        message: `${staff.staffName} checked in for ${payload.shift} shift at ${payload.checkIn} on ${dateKey}.`,
        audienceRole: "admin",
        category: "attendance",
      });

      if (isLate) {
        await createStaffNotification({
          title: "Late Check-in Warning",
          message: `${staff.staffName} checked in late at ${payload.checkIn} on ${dateKey}.`,
          audienceId: staff.staffId,
          audienceEmail: staff.staffEmail,
          category: "attendance",
        });
      }

      return res.status(201).json({
        success: true,
        message: "Attendance check-in saved",
        attendance,
      });
    }

    if (!attendance || !attendance.checkIn || attendance.checkIn === "--") {
      return res.status(400).json({
        success: false,
        message: "Check-in is required before check-out",
      });
    }

    if (attendance.checkOut && attendance.checkOut !== "--") {
      return res.status(409).json({
        success: false,
        message: "You have already checked out for today",
        attendance,
      });
    }

    const checkInAt = attendance.checkInAt ? new Date(attendance.checkInAt) : now;
    const workingMinutes = Math.max(0, Math.round((now.getTime() - checkInAt.getTime()) / 60000));
    const workingHours = workingMinutes / 60;

    const checkOutUpdates = {
      checkOut: formatTimeLabel(now),
      checkOutAt: now,
      workingMinutes,
      workingHours: formatWorkingHours(workingMinutes),
    };
    if (photo) {
      checkOutUpdates.checkOutPhoto = photo;
    }

    if (workingHours >= 6) {
      checkOutUpdates.status = "Present";
    } else if (workingHours >= 4 && workingHours < 6) {
      checkOutUpdates.status = "Half Day";
    } else {
      checkOutUpdates.status = "Absent";
    }

    if (attendance.isOvertime) {
      const standardWorkingMinutes = 480;
      const overtimeMinutes = Math.max(0, workingMinutes - standardWorkingMinutes);
      checkOutUpdates.overtimeMinutes = overtimeMinutes;
      checkOutUpdates.overtimeHours = formatWorkingHours(overtimeMinutes);
    }

    let earnedCompOffNote = "";
    if ((checkOutUpdates.status === "Present" || checkOutUpdates.status === "Half Day") && clean(attendance.assignmentType) === "Emergency Duty") {
      if (employee.weeklyOff) {
        const checkOutDate = new Date(attendance.dateKey);
        const dayName = checkOutDate.toLocaleDateString('en-US', { weekday: 'long' });
        if (employee.weeklyOff === dayName) {
          const addedCompOff = checkOutUpdates.status === "Present" ? 1 : 0.5;
          employee.compOffBalance = (employee.compOffBalance || 0) + addedCompOff;
          await employee.save();
          earnedCompOffNote = `Earned ${addedCompOff} Comp Off for Emergency Duty on Weekly Off.`;
        }
      }
    }
    if (earnedCompOffNote) {
      checkOutUpdates.note = (attendance.note ? attendance.note + " | " : "") + earnedCompOffNote;
    }

    attendance = await attendanceService.updateById(attendance._id, checkOutUpdates);
    await createNotification({
      title: "Attendance Marked",
      message: `${staff.staffName} checked out from ${attendance.shift || dailyContext.shiftName || staff.shift || "Morning"} shift at ${attendance.checkOut} on ${dateKey}.`,
      audienceRole: "admin",
      category: "attendance",
    });

    return res.json({
      success: true,
      message: "Attendance check-out saved",
      attendance,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkIn, checkOut, status, note, reason, workingMinutes, shift } = req.body;

    if (!clean(id)) {
      return res.status(400).json({
        success: false,
        message: "Attendance id is required",
      });
    }

    const attendance = await attendanceService.findById(id);
    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    const updates = {};

    if (checkIn !== undefined) {
      updates.checkIn = clean(checkIn) || "--";
      updates.checkInAt = updates.checkIn !== "--" ? parseClockTimeToDate(attendance.dateKey, updates.checkIn) : null;
    }

    if (checkOut !== undefined) {
      updates.checkOut = clean(checkOut) || "--";
      updates.checkOutAt = updates.checkOut !== "--" ? parseClockTimeToDate(attendance.dateKey, updates.checkOut) : null;
    }

    if (shift !== undefined) {
      updates.shift = clean(shift) || attendance.shift || "Morning";
    }

    if (note !== undefined) {
      updates.note = clean(note);
    }

    const effectiveCheckInAt = updates.checkInAt !== undefined ? updates.checkInAt : attendance.checkInAt;
    const effectiveCheckOutAt = updates.checkOutAt !== undefined ? updates.checkOutAt : attendance.checkOutAt;

    if (workingMinutes !== undefined && workingMinutes !== null && workingMinutes !== "") {
      const numericMinutes = Math.max(0, Math.round(Number(workingMinutes) || 0));
      updates.workingMinutes = numericMinutes;
      updates.workingHours = formatWorkingHours(numericMinutes);
    } else if (effectiveCheckInAt && effectiveCheckOutAt) {
      const computedMinutes = Math.max(0, Math.round((new Date(effectiveCheckOutAt).getTime() - new Date(effectiveCheckInAt).getTime()) / 60000));
      updates.workingMinutes = computedMinutes;
      updates.workingHours = formatWorkingHours(computedMinutes);
    } else {
      updates.workingMinutes = 0;
      updates.workingHours = "--";
    }

    if (status !== undefined) {
      updates.status = clean(status) || attendance.status;
    }

    updates.correctedBy = req.user?.name || req.user?.email || "Admin";
    updates.correctionDate = new Date();
    updates.correctionReason = reason || note || "";
    updates.source = "admin-correction";

    const updated = await attendanceService.updateById(id, updates);

    return res.json({
      success: true,
      message: "Attendance updated successfully",
      attendance: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
