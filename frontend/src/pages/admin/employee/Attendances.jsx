import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { FiCalendar, FiClock, FiDownload, FiEdit2, FiSave, FiUsers, FiCheckCircle, FiXCircle } from "react-icons/fi";
import { FaCalendarCheck, FaRegTimesCircle, FaUserClock } from "react-icons/fa";

import SectionCard from "../../../components/admin/employee/SectionCard";
import AttendanceDetailsModal from "../../../components/admin/employee/AttendanceDetailsModal";
import { getAdminAttendanceDashboard, updateAttendance } from "../../../services/attendanceService";
import { getAdminEmployees } from "../../../services/adminService";

const formatMonthKey = (date) => {
 const year = date.getFullYear();
 const month = String(date.getMonth() + 1).padStart(2, "0");
 return `${year}-${month}`;
};

const getLocalDateKey = (date = new Date()) => {
 const year = date.getFullYear();
 const month = String(date.getMonth() + 1).padStart(2, "0");
 const day = String(date.getDate()).padStart(2, "0");
 return `${year}-${month}-${day}`;
};

const formatDisplayDate = (dateKey) => {
 if (!dateKey) return "--";
 const date = new Date(`${dateKey}T00:00:00`);
 if (Number.isNaN(date.getTime())) return dateKey || "--";
 return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const formatWorkingHours = (minutes) => {
 const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
 const hours = Math.floor(safeMinutes / 60);
 const remainder = safeMinutes % 60;
 return `${hours}h ${remainder}m`;
};

const statusColors = {
 Present: "text-emerald-700 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-emerald-200",
 Working: "text-blue-700 bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-blue-200",
 Late: "text-amber-700 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-amber-200",
 Absent: "text-rose-700 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-rose-200",
 Leave: "text-sky-700 bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-sky-200",
 Holiday: "text-slate-600 dark:text-slate-200 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-200 dark:border-slate-700 ",
};

const summaryIconMap = {
 "Total Employees": FiUsers,
 "Present Today": FaCalendarCheck,
 "Absent Today": FaRegTimesCircle,
 "On Leave": FaUserClock,
 "Late Check-in": FiClock,
};

const Attendances = () => {
 const [monthKey, setMonthKey] = useState(formatMonthKey(new Date()));
 const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
 const [filterRole, setFilterRole] = useState("all");
 const [filterDepartment, setFilterDepartment] = useState("all");
 const [filterStatus, setFilterStatus] = useState("all");

 const [employees, setEmployees] = useState([]);
 const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
 const [dashboard, setDashboard] = useState(null);
 const [loading, setLoading] = useState(true);
 const [savingId, setSavingId] = useState("");
 const [editingRecord, setEditingRecord] = useState(null);
 const [viewingDetailsRecord, setViewingDetailsRecord] = useState(null);
 const [correctionForm, setCorrectionForm] = useState({
 checkIn: "",
 checkOut: "",
 status: "Present",
 reason: "",
 });
 const [selectedCalDate, setSelectedCalDate] = useState(new Date().toISOString().slice(0, 10));
 const [error, setError] = useState("");

 // Fetch all employees on mount for selector
 useEffect(() => {
 const loadEmployees = async () => {
 try {
 const response = await getAdminEmployees();
 const list = Array.isArray(response) ? response : response?.employees || [];
 setEmployees(list);
 if (!selectedEmployeeId && list.length > 0) {
 setSelectedEmployeeId(list[0]._id || list[0].id || "");
 }
 } catch (requestError) {
 setEmployees([]);
 }
 };
 loadEmployees();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Fetch attendance data based on filters
 const loadDashboard = async () => {
 try {
 setLoading(true);
 setError("");
 const response = await getAdminAttendanceDashboard(monthKey, selectedEmployeeId || undefined, {
 role: filterRole,
 department: filterDepartment,
 status: filterStatus,
 date: filterDate,
 });
 setDashboard(response);
 } catch (requestError) {
 setError(requestError.response?.data?.message || "Failed to load attendance dashboard");
 setDashboard(null);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadDashboard();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [monthKey, selectedEmployeeId, filterRole, filterDepartment, filterStatus, filterDate]);

 // Derived list of departments
 const departments = useMemo(() => {
 const unique = new Set(
 employees.map((emp) => emp.department).filter(Boolean)
 );
 return Array.from(unique);
 }, [employees]);

 const selectedEmployee = useMemo(
 () => employees.find((emp) => String(emp._id || emp.id) === String(selectedEmployeeId)) || null,
 [employees, selectedEmployeeId]
 );

 const records = dashboard?.records || [];
 const todayRecords = dashboard?.todayRecords || [];
 const timeline = dashboard?.timeline || [];
 const monthLabel = dashboard?.monthLabel || monthKey;

 // Selected Employee Summary Calculations
 const selectedEmployeeSummary = useMemo(() => {
 if (!selectedEmployeeId) return null;

 const empRecords = records.filter(
 (r) => String(r.employeeId) === String(selectedEmployeeId)
 );

 const present = empRecords.filter(r => r.status === "Present").length;
 const working = empRecords.filter(r => r.status === "Working").length;
 const late = empRecords.filter(r => r.status === "Late").length;
 const absent = empRecords.filter(r => r.status === "Absent").length;
 const leave = empRecords.filter(r => r.status === "Leave").length;

 const presentDays = present + working;
 const totalPresent = presentDays + late;
 const workingDays = totalPresent + absent + leave;
 const attendancePercent = workingDays > 0 ? Math.round((totalPresent / workingDays) * 100) : 0;

 let totalMinutes = 0;
 let validDays = 0;
 empRecords.forEach((r) => {
 if (r.workingMinutes && r.workingMinutes > 0) {
 totalMinutes += r.workingMinutes;
 validDays += 1;
 }
 });

 const avgMinutes = validDays > 0 ? Math.round(totalMinutes / validDays) : 0;
 const avgWorkingHours = formatWorkingHours(avgMinutes);

 return {
 name: selectedEmployee?.name || "N/A",
 role: selectedEmployee?.role || "N/A",
 department: selectedEmployee?.department || "N/A",
 attendancePercent,
 presentDays: totalPresent,
 absentDays: absent,
 leaveDays: leave,
 lateDays: late,
 avgWorkingHours,
 };
 }, [selectedEmployeeId, selectedEmployee, records]);

 // Calendar Day Click List - status logic for selectedCalDate
 const calDayRecords = useMemo(() => {
 if (!selectedCalDate) return [];
 const todayStr = getLocalDateKey();

 // Build lists for only active employees matching top Role & Department filters
 return employees
 .filter((emp) => {
 if (filterRole !== "all" && String(emp.role).toLowerCase() !== filterRole.toLowerCase()) return false;
 if (filterDepartment !== "all" && emp.department !== filterDepartment) return false;
 return true;
 })
 .map((emp) => {
 const empId = emp._id || emp.id;
 const record = records.find(
 (r) => String(r.employeeId) === String(empId) && r.dateKey === selectedCalDate
 );

 let status = "Absent";
 let checkIn = "--";
 let checkOut = "--";

 if (record) {
 status = record.status;
 checkIn = record.checkIn || "--";
 checkOut = record.checkOut || "--";
 } else {
 if (selectedCalDate > todayStr) {
 status = "--";
 }
 }

 return {
 employeeId: empId,
 employeeName: emp.name,
 employeePhoto: emp.photo || "",
 checkIn,
 checkOut,
 status,
 };
 });
 }, [selectedCalDate, employees, records, filterRole, filterDepartment]);

 // Calendar Cells builder
 const calendarCells = useMemo(() => {
 const [yearPart, monthPart] = monthKey.split("-");
 const year = Number(yearPart);
 const monthIndex = Number(monthPart) - 1;
 const startDate = new Date(year, monthIndex, 1);
 const endDate = new Date(year, monthIndex + 1, 0);

 const offset = (startDate.getDay() + 6) % 7;
 const gridStart = new Date(startDate);
 gridStart.setDate(gridStart.getDate() - offset);

 const cells = [];
 for (let i = 0; i < 42; i++) {
 const cursor = new Date(gridStart);
 cursor.setDate(gridStart.getDate() + i);
 const dateKey = getLocalDateKey(cursor);

 const dayStats = timeline.find((t) => t.dateKey === dateKey) || {
 present: 0,
 absent: 0,
 leave: 0,
 holiday: 0,
 };

 const muted = cursor.getMonth() !== monthIndex;

 cells.push({
 dateKey,
 day: cursor.getDate(),
 muted,
 today: !muted && dateKey === getLocalDateKey(new Date()),
 stats: dayStats,
 });
 }
 return cells;
 }, [monthKey, timeline]);

 const openCorrection = (record) => {
 setEditingRecord(record);
 setCorrectionForm({
 checkIn: record.checkIn && record.checkIn !== "--" ? record.checkIn : "",
 checkOut: record.checkOut && record.checkOut !== "--" ? record.checkOut : "",
 status: record.status || "Present",
 reason: record.correctionReason || record.note || "",
 });
 };

 const saveCorrection = async () => {
 if (!editingRecord) return;

 try {
 setSavingId(editingRecord.id);
 await updateAttendance(editingRecord.id, {
 checkIn: correctionForm.checkIn || "--",
 checkOut: correctionForm.checkOut || "--",
 status: correctionForm.status,
 reason: correctionForm.reason,
 });
 await loadDashboard();
 setEditingRecord(null);
 } catch (requestError) {
 setError(requestError.response?.data?.message || "Unable to update attendance record");
 } finally {
 setSavingId("");
 }
 };

 const exportPdf = () => {
 const doc = new jsPDF({ unit: "pt", format: "a4" });
 let y = 40;

 doc.setFont("helvetica", "bold");
 doc.setFontSize(16);
 doc.text("Temple Billing System - Attendance Report", 40, y);
 y += 20;

 doc.setFont("helvetica", "normal");
 doc.setFontSize(10);
 doc.text(`Report Period: ${monthLabel}`, 40, y);
 y += 14;
 doc.text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, 40, y);
 y += 14;

 const filterText = `Filters: Role: ${filterRole}, Department: ${filterDepartment}, Status: ${filterStatus}`;
 doc.text(filterText, 40, y);
 y += 24;

 doc.setFont("helvetica", "bold");
 doc.setFontSize(9);
 doc.text("Date", 40, y);
 doc.text("Employee Name", 110, y);
 doc.text("Department", 230, y);
 doc.text("Shift", 320, y);
 doc.text("Check In", 390, y);
 doc.text("Check Out", 450, y);
 doc.text("Hours", 510, y);
 doc.text("Status", 550, y);

 y += 8;
 doc.setLineWidth(0.5);
 doc.line(40, y, 580, y);
 y += 14;

 doc.setFont("helvetica", "normal");
 records.forEach((record) => {
 if (y > 785) {
 doc.addPage();
 y = 40;
 doc.setFont("helvetica", "bold");
 doc.text("Date", 40, y);
 doc.text("Employee Name", 110, y);
 doc.text("Department", 230, y);
 doc.text("Shift", 320, y);
 doc.text("Check In", 390, y);
 doc.text("Check Out", 450, y);
 doc.text("Hours", 510, y);
 doc.text("Status", 550, y);
 y += 8;
 doc.line(40, y, 580, y);
 y += 14;
 doc.setFont("helvetica", "normal");
 }

 doc.text(record.date || record.dateKey || "", 40, y);

 const empName = record.employeeName || "";
 const truncatedName = empName.length > 20 ? empName.substring(0, 18) + ".." : empName;
 doc.text(truncatedName, 110, y);

 doc.text(record.department || "-", 230, y);
 doc.text(record.shift || "Morning", 320, y);
 doc.text(record.checkIn || "--", 390, y);
 doc.text(record.checkOut || "--", 450, y);
 doc.text(record.workingHours || "--", 510, y);
 doc.text(record.status || "", 550, y);
 y += 14;
 });

 doc.save(`attendance-report-${monthKey}.pdf`);
 };

 const summaryCards = useMemo(() => {
 return dashboard?.overview?.length
 ? dashboard.overview
 : [
 { label: "Total Employees", value: "0", tone: "info" },
 { label: "Present Today", value: "0", tone: "success" },
 { label: "Absent Today", value: "0", tone: "danger" },
 { label: "On Leave", value: "0", tone: "warning" },
 { label: "Late Check-in", value: "0", tone: "accent" },
 ];
 }, [dashboard]);

 return (
 <div className="space-y-6">
 {/* FILTERS PANEL */}
 <div className="rounded-[28px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
 <div>
 <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 ">Attendance Search Filters</h2>
 <p className="text-xs text-slate-500 dark:text-slate-200 ">Query and download attendance logs by parameters</p>
 </div>
 <button
 type="button"
 onClick={exportPdf}
 className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition duration-150"
 >
 <FiDownload /> Export PDF
 </button>
 </div>

 <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
 <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-200 ">
 Employee Profile
 <select
 value={selectedEmployeeId}
 onChange={(event) => setSelectedEmployeeId(event.target.value)}
 className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none"
 >
 <option value="">All Employees</option>
 {employees.map((employee) => (
 <option key={employee._id || employee.id} value={employee._id || employee.id}>
 {employee.name}
 </option>
 ))}
 </select>
 </label>

 <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-200 ">
 Organization Role
 <select
 value={filterRole}
 onChange={(event) => setFilterRole(event.target.value)}
 className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none"
 >
 <option value="all">All Roles</option>
 <option value="priest">Priest</option>
 <option value="staff">Staff</option>
 <option value="cashier">Cashier</option>
 <option value="accountant">Accountant</option>
 </select>
 </label>

 <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-200 ">
 Department
 <select
 value={filterDepartment}
 onChange={(event) => setFilterDepartment(event.target.value)}
 className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none"
 >
 <option value="all">All Departments</option>
 {departments.map((dept) => (
 <option key={dept} value={dept}>
 {dept}
 </option>
 ))}
 </select>
 </label>

 <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-200 ">
 Duty Status
 <select
 value={filterStatus}
 onChange={(event) => setFilterStatus(event.target.value)}
 className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none"
 >
 <option value="all">All Statuses</option>
 <option value="Present">Present</option>
 <option value="Working">Working</option>
 <option value="Absent">Absent</option>
 <option value="Leave">Leave</option>
 <option value="Late">Late</option>
 </select>
 </label>

 <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-200 ">
 Daily Date Filter
 <input
 type="date"
 value={filterDate}
 onChange={(event) => {
 setFilterDate(event.target.value);
 const ym = event.target.value.slice(0, 7);
 if (ym && ym !== monthKey) {
 setMonthKey(ym);
 }
 }}
 className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none"
 />
 </label>

 <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-200 ">
 Monthly Filter
 <input
 type="month"
 value={monthKey}
 onChange={(event) => setMonthKey(event.target.value)}
 className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none"
 />
 </label>
 </div>
 </div>

 {error ? (
 <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm font-medium text-rose-700">
 {error}
 </div>
 ) : null}

 {/* DASHBOARD SUMMARY CARDS */}
 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
 {summaryCards.map((card) => {
 const Icon = summaryIconMap[card.label || card.title] || FiClock;
 const tone = card.tone || "info";
 return (
 <div
 key={card.label || card.title}
 className="rounded-[28px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-5 shadow-lg shadow-slate-900/5"
 >
 <div className="flex items-start gap-4">
 <div
 className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone === "success" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-600" : tone === "danger" ? "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-600" : tone === "warning" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-600" : tone === "accent" ? "bg-violet-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-violet-600" : "bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-600" }`}
 >
 <Icon className="text-xl" />
 </div>
 <div className="min-w-0">
 <p className="text-sm font-medium text-slate-500 dark:text-slate-200 ">{card.label || card.title}</p>
 <p className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-200 ">{card.value}</p>
 </div>
 </div>
 </div>
 );
 })}
 </div>

 {/* MANUAL CORRECTION DRAWER / FORM */}
 {editingRecord ? (
 <SectionCard
 title={`Manual Correction - ${editingRecord.employeeName}`}
 subtitle="Update check-in, check-out times, or duty status and store correction audit info."
 className="overflow-hidden border-2 border-amber-300"
 >
 <div className="grid gap-3 md:grid-cols-2">
 <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-200 ">
 Check In Time
 <input
 type="text"
 value={correctionForm.checkIn}
 onChange={(event) => setCorrectionForm((current) => ({ ...current, checkIn: event.target.value }))}
 className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none"
 placeholder="e.g. 09:00 AM"
 />
 </label>
 <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-200 ">
 Check Out Time
 <input
 type="text"
 value={correctionForm.checkOut}
 onChange={(event) => setCorrectionForm((current) => ({ ...current, checkOut: event.target.value }))}
 className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none"
 placeholder="e.g. 05:00 PM"
 />
 </label>
 <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-200 ">
 Status Value
 <select
 value={correctionForm.status}
 onChange={(event) => setCorrectionForm((current) => ({ ...current, status: event.target.value }))}
 className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none"
 >
 <option value="Present">Present</option>
 <option value="Working">Working</option>
 <option value="Late">Late</option>
 <option value="Absent">Absent</option>
 <option value="Leave">Leave</option>
 <option value="Holiday">Holiday</option>
 </select>
 </label>
 <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-200 md:col-span-2">
 Correction Reason
 <textarea
 value={correctionForm.reason}
 onChange={(event) => setCorrectionForm((current) => ({ ...current, reason: event.target.value }))}
 className="min-h-[96px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none"
 placeholder="Reason for making manual changes"
 required
 />
 </label>
 </div>
 <div className="mt-4 flex flex-wrap gap-3">
 <button
 type="button"
 onClick={saveCorrection}
 disabled={savingId === editingRecord.id}
 className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
 >
 <FiSave /> {savingId === editingRecord.id ? "Saving..." : "Save Correction"}
 </button>
 <button
 type="button"
 onClick={() => setEditingRecord(null)}
 className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 Cancel
 </button>
 </div>
 </SectionCard>
 ) : null}

 {/* TODAY'S ATTENDANCE TABLE */}
 <SectionCard
 title={`Attendance Records - ${formatDisplayDate(filterDate)}`}
 subtitle="Roster showing check-in/out, automatic status logic, and action trigger."
 >
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm">
 <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3">Photo</th>
 <th className="px-4 py-3">Employee Name</th>
 <th className="px-4 py-3">Role</th>
 <th className="px-4 py-3">Department</th>
 <th className="px-4 py-3">Assigned Shift</th>
 <th className="px-4 py-3">Check In</th>
 <th className="px-4 py-3">Check Out</th>
 <th className="px-4 py-3">Working Hours</th>
 <th className="px-4 py-3">Verification</th>
 <th className="px-4 py-3">Status</th>
 <th className="px-4 py-3">Action</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td className="px-4 py-6 text-slate-500 dark:text-slate-200 text-center" colSpan="11">
 Loading attendance table...
 </td>
 </tr>
 ) : todayRecords.length === 0 ? (
 <tr>
 <td className="px-4 py-6 text-slate-500 dark:text-slate-200 text-center" colSpan="11">
 No attendance data is available for this date.
 </td>
 </tr>
 ) : (
 todayRecords.map((record) => (
 <tr key={record.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-4 py-4">
 <div className="h-10 w-10 overflow-hidden rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-slate-500 dark:text-slate-200 ">
 {record.employeePhoto ? (
 <img src={record.employeePhoto} alt={record.employeeName} className="h-full w-full object-cover" />
 ) : (
 <span className="text-sm font-semibold uppercase">
 {record.employeeName?.slice(0, 2) || "?"}
 </span>
 )}
 </div>
 </td>
 <td className="px-4 py-4 font-medium text-slate-900 dark:text-slate-200 ">{record.employeeName}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 capitalize">{record.role || "-"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.department || "-"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.shift || "-"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.checkIn || "--"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.checkOut || "--"}</td>
 <td className="px-4 py-4 text-slate-700 dark:text-slate-200 ">{record.workingHours || "--"}</td>
 <td className="px-4 py-4">
 <div className="flex flex-col gap-1 text-[10px] font-semibold uppercase">
 {record.faceVerified ? (
 <span className="text-emerald-600 flex items-center gap-1"><FiCheckCircle size={12}/> Face</span>
 ) : (
 <span className="text-slate-400 flex items-center gap-1"><FiXCircle size={12}/> Face</span>
 )}
 {record.locationVerified ? (
 <span className="text-emerald-600 flex items-center gap-1"><FiCheckCircle size={12}/> Loc</span>
 ) : (
 <span className="text-slate-400 flex items-center gap-1"><FiXCircle size={12}/> Loc</span>
 )}
 </div>
 </td>
 <td className="px-4 py-4">
 <span
 className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusColors[record.status] || "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-700 dark:text-slate-200 "}`}
 >
 {record.status}
 </span>
 </td>
 <td className="px-4 py-4">
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setViewingDetailsRecord(record)}
 className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Details
 </button>
 <button
 type="button"
 onClick={() => openCorrection(record)}
 className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <FiEdit2 /> Correct
 </button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>

 {/* MONTHLY HISTORY TABLE */}
 <SectionCard
 title="Monthly Attendance History"
 subtitle="Complete database log of historical records parsed by filters."
 >
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm">
 <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3">Date</th>
 <th className="px-4 py-3">Employee</th>
 <th className="px-4 py-3">Department</th>
 <th className="px-4 py-3">Shift</th>
 <th className="px-4 py-3">Check In</th>
 <th className="px-4 py-3">Check Out</th>
 <th className="px-4 py-3">Hours</th>
 <th className="px-4 py-3">Verification</th>
 <th className="px-4 py-3">Status</th>
 <th className="px-4 py-3">Action</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td className="px-4 py-6 text-slate-500 dark:text-slate-200 text-center" colSpan="9">
 Loading records history...
 </td>
 </tr>
 ) : records.length === 0 ? (
 <tr>
 <td className="px-4 py-6 text-slate-500 dark:text-slate-200 text-center" colSpan="9">
 No monthly records match the filter query.
 </td>
 </tr>
 ) : (
 records.map((record) => (
 <tr key={record.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-4 py-4 font-medium text-slate-900 dark:text-slate-200 ">{record.date}</td>
 <td className="px-4 py-4 text-slate-700 dark:text-slate-200 ">{record.employeeName || "Unknown"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.department || "-"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.shift || "-"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.checkIn || "--"}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{record.checkOut || "--"}</td>
 <td className="px-4 py-4 text-slate-700 dark:text-slate-200 ">{record.workingHours || "--"}</td>
 <td className="px-4 py-4">
 <div className="flex flex-col gap-1 text-[10px] font-semibold uppercase">
 {record.faceVerified ? (
 <span className="text-emerald-600 flex items-center gap-1"><FiCheckCircle size={12}/> Face</span>
 ) : (
 <span className="text-slate-400 flex items-center gap-1"><FiXCircle size={12}/> Face</span>
 )}
 {record.locationVerified ? (
 <span className="text-emerald-600 flex items-center gap-1"><FiCheckCircle size={12}/> Loc</span>
 ) : (
 <span className="text-slate-400 flex items-center gap-1"><FiXCircle size={12}/> Loc</span>
 )}
 </div>
 </td>
 <td className="px-4 py-4">
 <span
 className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusColors[record.status] || "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-700 dark:text-slate-200 "}`}
 >
 {record.status}
 </span>
 </td>
 <td className="px-4 py-4">
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setViewingDetailsRecord(record)}
 className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Details
 </button>
 <button
 type="button"
 onClick={() => openCorrection(record)}
 className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <FiEdit2 /> Correct
 </button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>

 {/* CALENDAR & EMPLOYEE SUMMARY GRID */}
 <div className="grid gap-6 lg:grid-cols-2">
 {/* CALENDAR */}
 <SectionCard
 title="Attendance Calendar"
 subtitle="Day-wise aggregate headcount. Click any cell to view employee listing."
 >
 <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-200 mb-3">
 {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((wd) => (
 <div key={wd} className="rounded-xl bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] py-2">
 {wd}
 </div>
 ))}
 </div>

 <div className="grid grid-cols-7 gap-2">
 {calendarCells.map((day, idx) => (
 <button
 key={`${day.dateKey}-${idx}`}
 type="button"
 onClick={() => setSelectedCalDate(day.dateKey)}
 className={`rounded-2xl border text-left p-2.5 transition flex flex-col justify-between ${day.muted ? "bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] opacity-40" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " } ${day.today ? "ring-2 ring-amber-400 border-amber-400" : "border-slate-200 dark:border-slate-700 " } ${selectedCalDate === day.dateKey ? "border-slate-800 ring-2 ring-slate-800" : "" } hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] `}
 >
 <span className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">{day.day}</span>
 <div className="w-full text-[9px] font-bold space-y-0.5">
 <div className="text-emerald-700 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded px-1 py-0.2">P: {day.stats.present}</div>
 <div className="text-rose-700 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded px-1 py-0.2">A: {day.stats.absent}</div>
 <div className="text-sky-700 bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded px-1 py-0.2">L: {day.stats.leave}</div>
 {day.stats.holiday > 0 ? (
 <div className="text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded px-1 py-0.2">H: {day.stats.holiday}</div>
 ) : null}
 </div>
 </button>
 ))}
 </div>
 </SectionCard>

 {/* CLICKED CELL DETAIL LIST */}
 {selectedCalDate ? (
 <SectionCard
 title={`Attendance Details - ${formatDisplayDate(selectedCalDate)}`}
 subtitle="Lists check-in/out and statuses for this day. Nothing else."
 >
 <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
 <table className="min-w-full text-left text-sm">
 <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3">Employee</th>
 <th className="px-4 py-3">Check In</th>
 <th className="px-4 py-3">Check Out</th>
 <th className="px-4 py-3">Status</th>
 </tr>
 </thead>
 <tbody>
 {calDayRecords.length === 0 ? (
 <tr>
 <td className="px-4 py-6 text-slate-500 dark:text-slate-200 text-center" colSpan="4">
 No employees match the filters.
 </td>
 </tr>
 ) : (
 calDayRecords.map((item) => (
 <tr key={item.employeeId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-4 py-4">
 <div className="flex items-center gap-3">
 <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-slate-500 dark:text-slate-200 text-xs">
 {item.employeePhoto ? (
 <img src={item.employeePhoto} alt={item.employeeName} className="h-full w-full object-cover" />
 ) : (
 <span className="font-semibold uppercase">
 {item.employeeName?.slice(0, 2) || "?"}
 </span>
 )}
 </div>
 <div className="font-medium text-slate-900 dark:text-slate-200 ">{item.employeeName}</div>
 </div>
 </td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{item.checkIn}</td>
 <td className="px-4 py-4 text-slate-600 dark:text-slate-200 ">{item.checkOut}</td>
 <td className="px-4 py-4">
 <span
 className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusColors[item.status] || "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-700 dark:text-slate-200 "}`}
 >
 {item.status}
 </span>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>
 ) : null}
 </div>

 {/* SELECTED EMPLOYEE SUMMARY */}
 {selectedEmployeeSummary ? (
 <SectionCard
 title="Selected Employee Summary"
 subtitle={`Monthly analytics summary and average statistics for ${selectedEmployeeSummary.name}.`}
 >
 <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 mb-4">
 <div className="rounded-2xl border border-slate-100 p-4 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="text-xs text-slate-500 dark:text-slate-200 font-medium">Employee Name</span>
 <p className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200 ">{selectedEmployeeSummary.name}</p>
 </div>
 <div className="rounded-2xl border border-slate-100 p-4 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="text-xs text-slate-500 dark:text-slate-200 font-medium">Role</span>
 <p className="mt-1 text-base font-bold text-slate-850 capitalize">{selectedEmployeeSummary.role}</p>
 </div>
 <div className="rounded-2xl border border-slate-100 p-4 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="text-xs text-slate-500 dark:text-slate-200 font-medium">Department</span>
 <p className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200 ">{selectedEmployeeSummary.department}</p>
 </div>
 <div className="rounded-2xl border border-slate-150 p-4 bg-emerald-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="text-xs text-emerald-600 font-semibold">Attendance Rate</span>
 <p className="mt-1 text-2xl font-bold text-emerald-700">{selectedEmployeeSummary.attendancePercent}%</p>
 </div>
 <div className="rounded-2xl border border-slate-150 p-4 bg-amber-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] col-span-1 md:col-span-2">
 <span className="text-xs text-amber-600 font-semibold">Average Working Hours</span>
 <p className="mt-1 text-2xl font-bold text-amber-700">{selectedEmployeeSummary.avgWorkingHours}</p>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
 <div className="rounded-2xl bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-center">
 <p className="text-sm font-semibold text-emerald-700">Present Days</p>
 <p className="mt-2 text-3xl font-bold text-emerald-750">{selectedEmployeeSummary.presentDays}</p>
 </div>
 <div className="rounded-2xl bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-center">
 <p className="text-sm font-semibold text-rose-700">Absent Days</p>
 <p className="mt-2 text-3xl font-bold text-rose-750">{selectedEmployeeSummary.absentDays}</p>
 </div>
 <div className="rounded-2xl bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-center">
 <p className="text-sm font-semibold text-sky-700">Leave Days</p>
 <p className="mt-2 text-3xl font-bold text-sky-750">{selectedEmployeeSummary.leaveDays}</p>
 </div>
 <div className="rounded-2xl bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-center">
 <p className="text-sm font-semibold text-amber-700">Late Check-ins</p>
 <p className="mt-2 text-3xl font-bold text-amber-750">{selectedEmployeeSummary.lateDays}</p>
 </div>
 </div>
 </SectionCard>
 ) : null}

 {viewingDetailsRecord && (
 <AttendanceDetailsModal
 record={viewingDetailsRecord}
 onClose={() => setViewingDetailsRecord(null)}
 />
 )}
 </div>
 );
};

export default Attendances;
