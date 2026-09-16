const mongoose = require("mongoose");
const Employee = require("../models/Employee");
const attendanceService = require("../services/attendanceService");
const leaveService = require("../services/leaveService");
const Task = require("../models/Task");
const PayrollRecord = require("../models/PayrollRecord");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const clean = (value) => String(value || "").trim();
const normalizeEmail = (email) => clean(email).toLowerCase();
const toDateKey = (date) => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
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

const getMonthRange = (monthValue) => {
  const monthKey = /^\d{4}-\d{2}$/.test(monthValue) ? monthValue : toDateKey(new Date()).slice(0, 7);
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
    daysInMonth: endDate.getDate(),
    monthLabel: startDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  };
};

const getEffectiveStatus = (attendance, leave, shiftStartTime = "09:00 AM") => {
  if (leave) return "Leave";
  if (!attendance) return "Absent";
  if (attendance.status === "Holiday") return "Holiday";
  if (attendance.status === "Leave") return "Leave";
  if (attendance.status === "Half Day") return "Half Day";

  const isLate =
    attendance.isLateCheckIn ||
    (attendance.checkIn &&
      attendance.checkIn !== "--" &&
      shiftStartTime &&
      parseTimeToMinutes(attendance.checkIn) > parseTimeToMinutes(shiftStartTime));

  if (isLate && attendance.checkOut && attendance.checkOut !== "--") return "Late";
  if (attendance.checkIn && attendance.checkIn !== "--" && (!attendance.checkOut || attendance.checkOut === "--")) {
    return "Working";
  }
  if (attendance.checkIn && attendance.checkIn !== "--" && attendance.checkOut && attendance.checkOut !== "--") {
    return isLate ? "Late" : "Present";
  }
  return attendance.status || "Absent";
};

const matchesEmployee = (record, employee) => {
  const employeeId = employee._id.toString();
  const employeeCode = clean(employee.employeeId);
  const employeeEmail = normalizeEmail(employee.email);
  const ids = [employeeId, employeeCode].filter(Boolean);
  const recordIds = [clean(record.employeeId), clean(record.staffId)].filter(Boolean);
  const recordEmail = normalizeEmail(record.staffEmail);
  return ids.some((id) => recordIds.includes(id)) || (employeeEmail && recordEmail === employeeEmail);
};

const isExtraDutyAssignment = (assignmentType = "") =>
  /overtime|extra duty|special duty|festival duty|temporary shift/i.test(clean(assignmentType));

const roundMoney = (value) => Math.round(Number(value || 0));

const buildEmployeePayroll = ({ employee, monthRange, attendanceDocs, leaveDocs, taskDocs, savedRecord }) => {
  const employeeId = employee._id.toString();
  const joiningKey = employee.joiningDate ? toDateKey(new Date(employee.joiningDate)) : "";
  const todayKey = toDateKey(new Date());
  const monthEndKey =
    monthRange.monthKey === todayKey.slice(0, 7) ? todayKey : toDateKey(monthRange.endDate);

  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let halfDays = 0;
  let lateDays = 0;
  let overtimeHours = 0;

  let previouslyTakenLeaves = 0;

  const attendanceByDate = new Map();
  attendanceDocs.filter((doc) => matchesEmployee(doc, employee)).forEach((doc) => {
    attendanceByDate.set(doc.dateKey, doc);
    overtimeHours += Number(doc.overtimeMinutes || 0) / 60;
    if (doc.isOvertime) overtimeHours += 0.5;
  });

  const leaveByDate = new Map();
  leaveDocs
    .filter((leave) => matchesEmployee({ staffId: leave.staffId, staffEmail: leave.staffEmail }, employee))
    .forEach((leave) => {
      const fromDate = new Date(`${leave.fromDate}T00:00:00`);
      const toDate = new Date(`${leave.toDate}T00:00:00`);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return;
      for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setDate(cursor.getDate() + 1)) {
        const dKey = toDateKey(cursor);
        if (dKey >= `${monthRange.year}-01-01` && dKey < toDateKey(monthRange.startDate)) {
          if (!joiningKey || dKey >= joiningKey) {
            previouslyTakenLeaves += 1;
          }
        } else if (dKey >= toDateKey(monthRange.startDate) && dKey <= monthEndKey) {
          leaveByDate.set(dKey, leave);
        }
      }
    });

  for (
    let cursor = new Date(monthRange.startDate);
    toDateKey(cursor) <= monthEndKey;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = toDateKey(cursor);
    if (joiningKey && dateKey < joiningKey) continue;

    const attendance = attendanceByDate.get(dateKey);
    const leave = leaveByDate.get(dateKey);
    const status = getEffectiveStatus(attendance, leave, attendance?.shiftStartTime || "09:00 AM");

    const dayName = cursor.toLocaleDateString('en-US', { weekday: 'long' });
    const isWeeklyOff = employee.weeklyOff === dayName;

    if (isWeeklyOff && !attendance && !leave) {
      presentDays += 1; // Weekly Off is paid
    }
    else if (status === "Present" || status === "Working") presentDays += 1;
    else if (status === "Late") {
      presentDays += 1;
      lateDays += 1;
    } else if (status === "Leave") leaveDays += 1;
    else if (status === "Half Day") halfDays += 1;
    else if (status === "Holiday") presentDays += 1;
    else absentDays += 1;
  }

  const extraDutyDays = taskDocs.filter(
    (task) => matchesEmployee(task, employee) && isExtraDutyAssignment(task.assignmentType)
  ).length;

  let casualQuota = 12;
  if (employee.joiningDate) {
    const joinDate = new Date(employee.joiningDate);
    if (joinDate.getFullYear() === monthRange.year) {
      casualQuota = 12 - joinDate.getMonth();
    }
  }
  const totalQuota = casualQuota + 2 + (employee.compOffBalance || 0);

  const remainingPaidLeaves = Math.max(0, totalQuota - previouslyTakenLeaves);
  const unpaidLeaveDays = Math.max(0, leaveDays - remainingPaidLeaves);

  const baseSalary = roundMoney(employee.salary || 0);
  const dailyRate = baseSalary / Math.max(1, monthRange.daysInMonth);
  const hourlyRate = baseSalary / (Math.max(1, monthRange.daysInMonth) * 8);
  const deduction = roundMoney((absentDays + unpaidLeaveDays) * dailyRate + halfDays * dailyRate * 0.5);
  const calculatedExtraDutyPay = overtimeHours * hourlyRate;
  const extraDutyPay =
    savedRecord?.extraDutyPay != null ? roundMoney(savedRecord.extraDutyPay) : roundMoney(calculatedExtraDutyPay);
  const bonus = savedRecord?.bonus != null ? roundMoney(savedRecord.bonus) : 0;
  const netSalary = roundMoney(baseSalary - deduction + extraDutyPay + bonus);

  return {
    employeeId,
    employeeName: employee.name,
    department: employee.department || "General",
    role: employee.role || "staff",
    joiningDate: employee.joiningDate || null,
    baseSalary,
    presentDays,
    absentDays,
    leaveDays,
    halfDays,
    lateDays,
    extraDutyDays,
    overtimeHours: Number(overtimeHours.toFixed(1)),
    deduction,
    extraDutyPay,
    bonus,
    netSalary,
    status: savedRecord?.status || "Pending",
    paymentMethod: savedRecord?.paymentMethod || "Bank Transfer",
    transactionId: savedRecord?.transactionId || "",
    paidAt: savedRecord?.paidAt || null,
    payrollId: savedRecord?._id?.toString() || "",
  };
};

const buildPerformanceEntry = (payrollEntry, taskDocs, employee) => {
  const eligibleDays = payrollEntry.presentDays + payrollEntry.absentDays + payrollEntry.leaveDays + payrollEntry.halfDays;
  const attendanceScore = eligibleDays
    ? Math.round(((payrollEntry.presentDays + payrollEntry.leaveDays + payrollEntry.halfDays * 0.5) / eligibleDays) * 100)
    : 0;

  const employeeTasks = taskDocs.filter((task) => matchesEmployee(task, employee));
  const completedTasks = employeeTasks.filter((task) =>
    ["Completed", "Accepted", "Attended"].includes(clean(task.status))
  ).length;
  const taskCompletionRate = employeeTasks.length
    ? Math.round((completedTasks / employeeTasks.length) * 100)
    : attendanceScore;

  const disciplineScore = Math.max(
    0,
    Math.min(100, 100 - payrollEntry.absentDays * 8 - payrollEntry.lateDays * 3 - payrollEntry.halfDays * 4)
  );
  const qualityScore = Math.round(taskCompletionRate * 0.6 + attendanceScore * 0.4);
  const overallScore = Math.round(attendanceScore * 0.4 + disciplineScore * 0.3 + qualityScore * 0.3);

  let disciplineLabel = "Good";
  if (disciplineScore >= 90) disciplineLabel = "Excellent";
  else if (disciplineScore < 70) disciplineLabel = "Needs Improvement";

  let qualityLabel = "Average";
  if (qualityScore >= 85) qualityLabel = "High";
  else if (qualityScore < 65) qualityLabel = "Low";

  return {
    employeeId: payrollEntry.employeeId,
    name: payrollEntry.employeeName,
    department: payrollEntry.department,
    role: payrollEntry.role,
    attendance: `${attendanceScore}%`,
    discipline: disciplineLabel,
    quality: qualityLabel,
    rating: Number((overallScore / 20).toFixed(1)),
    score: overallScore,
    presentDays: payrollEntry.presentDays,
    absentDays: payrollEntry.absentDays,
    extraDutyDays: payrollEntry.extraDutyDays,
    completedTasks,
    totalTasks: employeeTasks.length,
  };
};

const loadPayrollContext = async (monthValue) => {
  const monthRange = getMonthRange(monthValue);
  const startKey = toDateKey(monthRange.startDate);
  const endKey = toDateKey(monthRange.endDate);
  const startOfYear = `${monthRange.year}-01-01`;

  const [employees, attendanceDocs, leaveDocs, taskDocs, payrollRecords] = await Promise.all([
    Employee.find({ role: { $ne: "admin" }, status: { $in: ["Active", "On Leave"] } }).sort({ name: 1 }),
    attendanceService.findMany({
      filter: { dateKey: { $gte: startKey, $lte: endKey } },
      sort: { dateKey: -1, createdAt: -1 },
    }),
    leaveService.findMany({
      filter: { status: "Approved", fromDate: { $lte: endKey }, toDate: { $gte: startOfYear } },
    }),
    Task.find({
      $or: [{ dateKey: { $gte: startKey, $lte: endKey } }, { dueDate: { $gte: startKey, $lte: endKey } }],
    }),
    PayrollRecord.find({ monthKey: monthRange.monthKey }),
  ]);

  const payrollMap = new Map(payrollRecords.map((record) => [record.employeeId.toString(), record]));

  const employeePayrolls = employees.map((employee) =>
    buildEmployeePayroll({
      employee,
      monthRange,
      attendanceDocs,
      leaveDocs,
      taskDocs,
      savedRecord: payrollMap.get(employee._id.toString()),
    })
  );

  return { monthRange, employees, employeePayrolls, taskDocs, payrollRecords };
};

exports.getPayrollDashboard = async (req, res) => {
  try {
    const { monthRange, employeePayrolls } = await loadPayrollContext(req.query.month);

    const monthlyPayroll = employeePayrolls.reduce((sum, item) => sum + item.netSalary, 0);
    const pendingSalary = employeePayrolls
      .filter((item) => item.status !== "Paid")
      .reduce((sum, item) => sum + item.netSalary, 0);
    const paidEmployees = employeePayrolls.filter((item) => item.status === "Paid").length;
    const bonusDistribution = employeePayrolls.reduce((sum, item) => sum + item.bonus, 0);

    const departmentMap = {};
    employeePayrolls.forEach((item) => {
      const key = item.department || "General";
      departmentMap[key] = (departmentMap[key] || 0) + item.netSalary;
    });

    const trendMonths = [];
    const now = new Date();
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      trendMonths.push({
        month: date.toLocaleString("default", { month: "short" }),
        monthKey: toDateKey(date).slice(0, 7),
      });
    }

    const trendRecords = await PayrollRecord.find({
      monthKey: { $in: trendMonths.map((item) => item.monthKey) },
      status: "Paid",
    });

    const trend = trendMonths.map(({ month, monthKey }) => {
      const salary = trendRecords
        .filter((record) => record.monthKey === monthKey)
        .reduce((sum, record) => sum + Number(record.netSalary || 0), 0);
      return { month, salary };
    });

    const upcomingPayments = employeePayrolls
      .filter((item) => item.status !== "Paid")
      .slice(0, 6)
      .map((item) => ({
        employeeId: item.employeeId,
        name: item.employeeName,
        role: item.role,
        netSalary: item.netSalary,
        dueLabel: monthRange.monthLabel,
      }));

    return res.json({
      success: true,
      monthKey: monthRange.monthKey,
      monthLabel: monthRange.monthLabel,
      summary: {
        monthlyPayroll,
        pendingSalary,
        paidEmployees,
        bonusDistribution,
      },
      trend,
      departmentBreakdown: Object.entries(departmentMap)
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value),
      employees: employeePayrolls,
      upcomingPayments,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.payEmployeePayroll = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { monthKey, paymentMethod, bonus = 0, extraDutyPay = 0, transactionId = "", notes = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee ID." });
    }
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ success: false, message: "Valid monthKey (YYYY-MM) is required." });
    }

    const allowedMethods = ["Bank Transfer", "UPI", "Cash", "Cheque", "Card", "Net Banking"];
    const method = clean(paymentMethod) || "Bank Transfer";
    if (!allowedMethods.includes(method)) {
      return res.status(400).json({ success: false, message: "Invalid payment method." });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });

    const monthRange = getMonthRange(monthKey);
    const startKey = toDateKey(monthRange.startDate);
    const endKey = toDateKey(monthRange.endDate);
    const [attendanceDocs, leaveDocs, taskDocs, existingRecord] = await Promise.all([
      attendanceService.findMany({
      filter: { dateKey: { $gte: startKey, $lte: endKey } },
      sort: { dateKey: -1, createdAt: -1 },
    }),
      leaveService.findMany({
        filter: { status: "Approved", fromDate: { $lte: endKey }, toDate: { $gte: startKey } },
      }),
      Task.find({
        $or: [{ dateKey: { $gte: startKey, $lte: endKey } }, { dueDate: { $gte: startKey, $lte: endKey } }],
      }),
      PayrollRecord.findOne({ employeeId: employee._id, monthKey }),
    ]);

    const computed = buildEmployeePayroll({
      employee,
      monthRange,
      attendanceDocs,
      leaveDocs,
      taskDocs,
      savedRecord: existingRecord,
    });

    const finalBonus = roundMoney(bonus);
    const finalExtraDutyPay = roundMoney(extraDutyPay);
    const netSalary = roundMoney(computed.baseSalary - computed.deduction + finalExtraDutyPay + finalBonus);

    const hasKeys = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
    const isOnline = method !== "Cash";
    const recordStatus = (hasKeys && isOnline) ? "Pending" : "Paid";

    const payload = {
      employeeId: employee._id,
      employeeName: employee.name,
      department: employee.department || "General",
      role: employee.role || "staff",
      monthKey,
      baseSalary: computed.baseSalary,
      presentDays: computed.presentDays,
      absentDays: computed.absentDays,
      leaveDays: computed.leaveDays,
      halfDays: computed.halfDays,
      lateDays: computed.lateDays,
      extraDutyDays: computed.extraDutyDays,
      overtimeHours: computed.overtimeHours,
      deduction: computed.deduction,
      extraDutyPay: finalExtraDutyPay,
      bonus: finalBonus,
      netSalary,
      status: recordStatus,
      paymentMethod: method,
      transactionId: (hasKeys && isOnline) ? "" : clean(transactionId),
      paidAt: (hasKeys && isOnline) ? null : new Date(),
      paidBy: req.user?.name || req.user?.id || "Admin",
      notes: clean(notes),
    };

    const record = existingRecord
      ? await PayrollRecord.findByIdAndUpdate(existingRecord._id, payload, { new: true })
      : await PayrollRecord.create(payload);

    if (hasKeys && isOnline) {
      const razorpayClient = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const orderOptions = {
        amount: Math.round(netSalary * 100),
        currency: "INR",
        receipt: `payroll_${Date.now()}`,
        payment_capture: 1,
      };

      const order = await razorpayClient.orders.create(orderOptions);
      record.razorpayOrderId = order.id;
      await record.save();

      return res.json({
        success: true,
        message: "Razorpay order created for salary payment.",
        record,
        order,
        key: process.env.RAZORPAY_KEY_ID || "",
        simulated: false,
        employee: {
          ...computed,
          bonus: finalBonus,
          netSalary,
          status: "Pending",
          paymentMethod: method,
          payrollId: record._id.toString(),
          extraDutyPay: finalExtraDutyPay,
        },
      });
    }

    const { recordTransaction } = require("../services/accountingService");
    await recordTransaction({
      transactionType: "Debit",
      source: "Payroll",
      category: "Salaries",
      amount: netSalary,
      paymentMethod: method,
      description: `Salary for ${employee.name} (${monthKey})`,
      referenceId: record._id,
      referenceModel: "PayrollRecord",
      recordedBy: req.user ? req.user.id : null,
      status: "Completed"
    });

    return res.json({
      success: true,
      message: "Salary payment recorded successfully.",
      record,
      simulated: true,
      employee: {
        ...computed,
        bonus: finalBonus,
        netSalary,
        status: "Paid",
        paymentMethod: method,
        transactionId: clean(transactionId),
        payrollId: record._id.toString(),
        extraDutyPay: finalExtraDutyPay,
      },
    });
  } catch (error) {
    console.error("payEmployeePayroll error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyPayrollPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, recordId } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing Razorpay verification fields." });
    }

    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "").update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid signature." });
    }

    let record = null;
    if (recordId) record = await PayrollRecord.findById(recordId);
    if (!record) record = await PayrollRecord.findOne({ razorpayOrderId: razorpay_order_id });
    if (!record) return res.status(404).json({ success: false, message: "Payroll record not found." });

    record.status = "Paid";
    record.transactionId = razorpay_payment_id;
    record.razorpayPaymentId = razorpay_payment_id;
    record.razorpaySignature = razorpay_signature;
    record.paidAt = new Date();
    await record.save();

    const { recordTransaction } = require("../services/accountingService");
    await recordTransaction({
      transactionType: "Debit",
      source: "Payroll",
      category: "Salaries",
      amount: record.netSalary,
      paymentMethod: record.paymentMethod || "Bank Transfer",
      description: `Salary for ${record.employeeName} (${record.monthKey})`,
      referenceId: record._id,
      referenceModel: "PayrollRecord",
      recordedBy: req.user ? req.user.id : null,
      status: "Completed"
    });

    return res.json({ success: true, message: "Salary payment verified successfully.", record });
  } catch (error) {
    console.error("verifyPayrollPayment error:", error);
    return res.status(500).json({ success: false, message: "Failed to verify payroll payment." });
  }
};

exports.getPerformanceDashboard = async (req, res) => {
  try {
    const { monthRange, employees, employeePayrolls, taskDocs } = await loadPayrollContext(req.query.month);

    const performanceEntries = employees.map((employee) => {
      const payrollEntry = employeePayrolls.find((item) => item.employeeId === employee._id.toString());
      return buildPerformanceEntry(payrollEntry, taskDocs, employee);
    });

    const leaderboardScore = (item) => item.presentDays + item.extraDutyDays * 2;
    const sorted = [...performanceEntries].sort(
      (left, right) => leaderboardScore(right) - leaderboardScore(left) || right.presentDays - left.presentDays
    );
    const topPerformers = sorted.filter((item) => item.presentDays > 0 || item.extraDutyDays > 0).length;
    const avgPerformanceScore = performanceEntries.length
      ? Number(
          (
            performanceEntries.reduce((sum, item) => sum + item.score, 0) / performanceEntries.length
          ).toFixed(1)
        )
      : 0;
    const avgAttendanceScore = performanceEntries.length
      ? Number(
          (
            performanceEntries.reduce((sum, item) => sum + Number(String(item.attendance).replace("%", "")), 0) /
            performanceEntries.length
          ).toFixed(1)
        )
      : 0;
    const taskCompletionRate = performanceEntries.length
      ? Math.round(
          performanceEntries.reduce((sum, item) => {
            if (!item.totalTasks) return sum + Number(String(item.attendance).replace("%", ""));
            return sum + Math.round((item.completedTasks / item.totalTasks) * 100);
          }, 0) / performanceEntries.length
        )
      : 0;

    return res.json({
      success: true,
      monthKey: monthRange.monthKey,
      monthLabel: monthRange.monthLabel,
      summary: {
        topPerformers,
        performanceScore: avgPerformanceScore,
        attendanceScore: avgAttendanceScore,
        taskCompletionRate,
      },
      leaderboard: sorted
        .filter((item) => item.presentDays > 0 || item.extraDutyDays > 0)
        .map((item, index) => ({
          rank: index + 1,
          name: item.name,
          department: item.department,
          presentDays: item.presentDays,
          extraDutyDays: item.extraDutyDays,
          score: leaderboardScore(item),
          metric: `${item.presentDays} present · ${item.extraDutyDays} extra duty`,
        })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
