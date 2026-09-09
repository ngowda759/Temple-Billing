import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FiSearch, FiFilter, FiUpload, FiPlus } from "react-icons/fi";
import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Tooltip } from "recharts";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import SectionCard from "../../../components/admin/employee/SectionCard";
import EmployeeTable from "../../../components/admin/employee/EmployeeTable";
import FaceRegistration from "../../../components/admin/employee/FaceRegistration";
import { attendanceTrend } from "./employeeData";
import { getEmployees, getEmployee, deleteEmployee } from "../../../services/employeeService";
import { getAdminAttendanceDashboard } from "../../../services/attendanceService";
import { useAuth } from "../../../context/AuthContext";
import templeLogo from "../../../assets/logo.png";
import EditEmployeeModal from "../../../components/admin/employee/EditEmployeeModal";
import { FiEdit } from "react-icons/fi";

const chartColors = ["#7c3aed", "#f5449c", "#38bdf8", "#f59e0b", "#10b981"];
const roleFilterOptions = ["All", "Priest", "Staff", "Cashier", "Accountant"];
const statusFilterOptions = ["Active", "On Leave", "Inactive", "Suspended", "Resigned", "Retired"];
const employmentTypeOptions = ["Full Time", "Part Time", "Contract"];

const emptyFilters = {
 role: "",
 department: "",
 status: "",
 shift: "",
 employmentType: "",
 joiningDate: "",
 salaryMin: "",
 salaryMax: "",
};

const formatDate = (value) => {
 if (!value) return "-";
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
};

const formatCurrency = (value) => `₹ ${Number(value || 0).toLocaleString("en-IN")}`;

const matchesRole = (employee, role) => {
 if (!role || role === "All") return true;
 return String(employee.role || "").toLowerCase() === role.toLowerCase();
};

const AllEmployees = () => {
 const navigate = useNavigate();
 const { user } = useAuth();
 const [employees, setEmployees] = useState([]);
 const [searchTerm, setSearchTerm] = useState("");
 const [filters, setFilters] = useState(emptyFilters);
 const [showFilters, setShowFilters] = useState(false);
 const [selectedEmployee, setSelectedEmployee] = useState(null);
 const [selectedTab, setSelectedTab] = useState("Profile");
 const [isEditModalOpen, setIsEditModalOpen] = useState(false);
 const [payrollRoleFilter, setPayrollRoleFilter] = useState("All");
 const [attendanceFilters, setAttendanceFilters] = useState({
 role: "All",
 department: "",
 month: String(new Date().getMonth() + 1).padStart(2, "0"),
 year: String(new Date().getFullYear()),
 });
 const [departmentRoleFilter, setDepartmentRoleFilter] = useState("All");
 const [recentRoleFilter, setRecentRoleFilter] = useState("All");
 const [attendanceDashboard, setAttendanceDashboard] = useState(null);
 const [loading, setLoading] = useState(false);

 const fetchEmployees = async () => {
 setLoading(true);
 try {
 const response = await getEmployees();
 setEmployees(response);
 } catch (error) {
 console.error("Failed to load employees", error);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchEmployees();
 }, []);

 useEffect(() => {
 let active = true;
 const loadAttendance = async () => {
 try {
 const response = await getAdminAttendanceDashboard(attendanceFilters.month, null, {
 role: attendanceFilters.role,
 department: attendanceFilters.department,
 year: attendanceFilters.year,
 });
 if (active) setAttendanceDashboard(response);
 } catch (error) {
 if (active) setAttendanceDashboard(null);
 console.error("Failed to load attendance dashboard", error);
 }
 };

 loadAttendance();
 return () => {
 active = false;
 };
 }, [attendanceFilters]);

 const filterOptions = useMemo(() => {
 const unique = (field) =>
 [...new Set(employees.map((employee) => employee[field]).filter(Boolean))].sort();
 return {
 departments: unique("department"),
 shifts: [...new Set(employees.flatMap((employee) => [
 employee.currentDuty?.shift,
 employee.defaultShift,
 employee.shift,
 ]).filter(Boolean))].sort(),
 };
 }, [employees]);

 const filteredEmployees = useMemo(() => {
 const query = searchTerm.toLowerCase().trim();
 return employees.filter((employee) => {
 const searchable = [
 employee.employeeId,
 employee.name,
 employee.email,
 employee.phone,
 employee.department,
 employee.role,
 ].join(" ").toLowerCase();
 const shift = employee.currentDuty?.shift || employee.defaultShift || employee.shift || "";
 const salary = Number(employee.salary || 0);
 const joiningDate = employee.joiningDate ? new Date(employee.joiningDate).toISOString().slice(0, 10) : "";

 return (
 (!query || searchable.includes(query)) &&
 (!filters.role || matchesRole(employee, filters.role)) &&
 (!filters.department || employee.department === filters.department) &&
 (!filters.status || employee.status === filters.status) &&
 (!filters.shift || shift === filters.shift) &&
 (!filters.employmentType || employee.employmentType === filters.employmentType) &&
 (!filters.joiningDate || joiningDate === filters.joiningDate) &&
 (!filters.salaryMin || salary >= Number(filters.salaryMin)) &&
 (!filters.salaryMax || salary <= Number(filters.salaryMax))
 );
 });
 }, [employees, filters, searchTerm]);

 const handleDeleteEmployee = async (id) => {
 if (!window.confirm("Mark this employee as Inactive? Existing attendance, payroll and leave records will be preserved.")) return;
 try {
 const response = await deleteEmployee(id, "Inactive");
 setEmployees((current) => current.map((employee) => (
 employee._id === id ? response.employee || { ...employee, status: "Inactive" } : employee
 )));
 setSelectedEmployee((current) => (current?._id === id ? response.employee || { ...current, status: "Inactive" } : current));
 } catch (error) {
 console.error("Delete failed", error);
 }
 };

 const handleViewEmployee = async (employee) => {
 try {
 const latestEmployee = await getEmployee(employee._id);
 setSelectedTab("Profile");
 setSelectedEmployee(latestEmployee);
 } catch (error) {
 console.error("Failed to load employee details", error);
 setSelectedTab("Profile");
 setSelectedEmployee(employee);
 }
 };

 const handleExport = () => {
 if (user?.role !== "admin") {
 alert("Only Admin can export employee reports.");
 return;
 }
 if (!filteredEmployees.length) return;

 const generatedAt = new Date();
 const generatedLabel = generatedAt.toLocaleString("en-IN");
 const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
 const pageWidth = doc.internal.pageSize.getWidth();
 const appliedFilters = [
 filters.role && `Role: ${filters.role}`,
 filters.department && `Department: ${filters.department}`,
 filters.status && `Status: ${filters.status}`,
 filters.shift && `Shift: ${filters.shift}`,
 filters.employmentType && `Employment Type: ${filters.employmentType}`,
 filters.joiningDate && `Joining Date: ${formatDate(filters.joiningDate)}`,
 filters.salaryMin && `Salary From: ${formatCurrency(filters.salaryMin)}`,
 filters.salaryMax && `Salary To: ${formatCurrency(filters.salaryMax)}`,
 searchTerm && `Search: ${searchTerm}`,
 ].filter(Boolean);
 const summaryCounts = {
 total: filteredEmployees.length,
 active: filteredEmployees.filter((employee) => employee.status === "Active").length,
 onLeave: filteredEmployees.filter((employee) => employee.status === "On Leave").length,
 suspended: filteredEmployees.filter((employee) => employee.status === "Suspended").length,
 resigned: filteredEmployees.filter((employee) => employee.status === "Resigned").length,
 };

 doc.setFillColor(35, 27, 61);
 doc.rect(0, 0, pageWidth, 92, "F");
 try {
 doc.addImage(templeLogo, "PNG", 40, 22, 48, 48);
 } catch (_) {}
 doc.setTextColor(255, 255, 255);
 doc.setFontSize(18);
 doc.text("Sri Shanti Mahadev Mandir", 104, 34);
 doc.setFontSize(14);
 doc.text("Employee Management Report", 104, 56);
 doc.setFontSize(9);
 doc.text(`Generated: ${generatedLabel}`, 104, 74);
 doc.text(`Generated By: ${user?.name || "Admin"}`, pageWidth - 190, 74);

 doc.setTextColor(30, 41, 59);
 doc.setFontSize(11);
 doc.text("Applied Filters", 40, 122);
 doc.setFontSize(9);
 doc.text(appliedFilters.length ? appliedFilters.join(" | ") : "Filters: All Employees", 40, 140, {
 maxWidth: pageWidth - 80,
 });

 autoTable(doc, {
 startY: 164,
 margin: { left: 40, right: 40 },
 head: [["Total Employees", "Active Employees", "On Leave", "Suspended", "Resigned"]],
 body: [[summaryCounts.total, summaryCounts.active, summaryCounts.onLeave, summaryCounts.suspended, summaryCounts.resigned]],
 theme: "grid",
 styles: { fontSize: 9, cellPadding: 7, halign: "center" },
 headStyles: { fillColor: [245, 158, 11], textColor: [15, 23, 42] },
 });

 autoTable(doc, {
 startY: doc.lastAutoTable.finalY + 22,
 margin: { left: 24, right: 24 },
 head: [[
 "Employee ID",
 "Photo",
 "Employee Name",
 "Role",
 "Department",
 "Phone",
 "Email",
 "Shift",
 "Joining Date",
 "Employment Type",
 "Salary",
 "Status",
 ]],
 body: filteredEmployees.map((employee) => [
 employee.employeeId || employee._id || "-",
 employee.photo ? "Uploaded" : "Default",
 employee.name || "-",
 employee.role || "-",
 employee.department || "-",
 employee.phone || employee.emergencyContact || "-",
 employee.email || "-",
 employee.currentDuty?.shift || employee.defaultShift || employee.shift || "-",
 formatDate(employee.joiningDate),
 employee.employmentType || "-",
 formatCurrency(employee.salary),
 employee.status || "Active",
 ]),
 theme: "grid",
 styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", valign: "middle" },
 headStyles: { fillColor: [35, 27, 61], textColor: [255, 255, 255], fontStyle: "bold" },
 alternateRowStyles: { fillColor: [248, 250, 252] },
 columnStyles: {
 0: { cellWidth: 52 },
 1: { cellWidth: 34 },
 2: { cellWidth: 65 },
 5: { cellWidth: 54 },
 6: { cellWidth: 76 },
 10: { halign: "right" },
 },
 didDrawPage: (data) => {
 const pageHeight = doc.internal.pageSize.getHeight();
 doc.setFontSize(8);
 doc.setTextColor(100, 116, 139);
 doc.text("Sri Shanti Mahadev Mandir", 40, pageHeight - 28);
 doc.text("Employee Management Report", pageWidth / 2, pageHeight - 28, { align: "center" });
 doc.text(`Generated on ${generatedLabel}`, 40, pageHeight - 14);
 },
 });

 const pageCount = doc.internal.getNumberOfPages();
 for (let page = 1; page <= pageCount; page += 1) {
 doc.setPage(page);
 doc.setFontSize(8);
 doc.setTextColor(100, 116, 139);
 doc.text(`Page ${page} of ${pageCount}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 14, { align: "right" });
 }

 doc.save(`employee-management-report-${generatedAt.toISOString().slice(0, 10)}.pdf`);
 };

 const attendanceChartData = useMemo(() => {
 const timeline = attendanceDashboard?.timeline || [];
 if (timeline.length > 0) {
 return timeline.slice(-7).map((item) => ({
 month: item.date,
 value: item.attendancePercent || 0,
 }));
 }

 return attendanceTrend.map((item) => ({
 month: item.day,
 value: item.value,
 }));
 }, [attendanceDashboard]);

 const payrollTrendData = useMemo(() => {
 const scope = payrollRoleFilter === "All"
 ? employees
 : employees.filter((employee) => matchesRole(employee, payrollRoleFilter));
 const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
 const currentYear = new Date().getFullYear();

 return months.map((month, index) => {
 const monthNumber = index + 1;
 const salary = scope.reduce((total, employee) => {
 if (!employee.salary) return total;
 if (!employee.joiningDate) return total + Number(employee.salary);
 const joiningDate = new Date(employee.joiningDate);
 if (Number.isNaN(joiningDate.getTime())) return total;
 const joinedYear = joiningDate.getFullYear();
 const joinedMonth = joiningDate.getMonth() + 1;
 if (joinedYear > currentYear) return total;
 if (joinedYear === currentYear && joinedMonth > monthNumber) return total;
 return total + Number(employee.salary);
 }, 0);
 return { month, salary };
 });
 }, [employees, payrollRoleFilter]);

 const departmentStrength = useMemo(() => {
 const scope = departmentRoleFilter === "All"
 ? employees
 : employees.filter((employee) => matchesRole(employee, departmentRoleFilter));
 const counts = scope.reduce((total, employee) => {
 const department = employee.department || "Unassigned";
 total[department] = (total[department] || 0) + 1;
 return total;
 }, {});

 return Object.entries(counts).map(([department, value]) => ({ department, value }));
 }, [employees, departmentRoleFilter]);

 const distributionData = useMemo(() => {
 const counts = employees.reduce((total, employee) => {
 const role = employee.role || "Unknown";
 total[role] = (total[role] || 0) + 1;
 return total;
 }, {});

 return Object.entries(counts).map(([name, value]) => ({ name, value }));
 }, [employees]);

 const recentJoinings = useMemo(() => {
 const scope = recentRoleFilter === "All"
 ? employees
 : employees.filter((employee) => matchesRole(employee, recentRoleFilter));

 return scope
 .filter((employee) => employee.joiningDate)
 .slice()
 .sort((a, b) => new Date(b.joiningDate) - new Date(a.joiningDate))
 .slice(0, 3)
 .map((employee) => ({
 name: employee.name,
 role: employee.role,
 date: new Date(employee.joiningDate).toLocaleDateString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 }),
 }));
 }, [employees, recentRoleFilter]);

 const upcomingBirthdays = useMemo(() => {
 const today = new Date();
 const currentYear = today.getFullYear();
 return employees
 .filter((employee) => employee.dob)
 .map((employee) => {
 const dob = new Date(employee.dob);
 const birthdayThisYear = new Date(currentYear, dob.getMonth(), dob.getDate());
 const nextBirthday = birthdayThisYear < today ? new Date(currentYear + 1, dob.getMonth(), dob.getDate()) : birthdayThisYear;
 return {
 ...employee,
 nextBirthday,
 };
 })
 .sort((a, b) => a.nextBirthday - b.nextBirthday)
 .slice(0, 3)
 .map((employee) => ({
 name: employee.name,
 role: employee.role || employee.department || "Staff",
 date: employee.nextBirthday.toLocaleDateString("en-IN", {
 day: "2-digit",
 month: "short",
 }),
 }));
 }, [employees]);

 const employeeStats = useMemo(() => {
 const total = employees.length;
 const active = employees.filter((employee) => employee.status === "Active").length;
 const recent = Math.max(0, employees.filter((employee) => {
 if (!employee.joiningDate) return false;
 return new Date(employee.joiningDate) >= new Date(new Date().setMonth(new Date().getMonth() - 1));
 }).length);

 return [
 { title: "Total Employees", value: total, delta: total ? `${total > 0 ? "+2.8%" : "0%"}` : "0%", icon: "👥", accent: "from-violet-500 to-purple-600" },
 { title: "Active Employees", value: active, delta: active ? "+1.9%" : "0%", icon: "✅", accent: "from-cyan-500 to-blue-600" },
 { title: "New Joinings", value: recent, delta: recent ? "+1.2%" : "0%", icon: "✨", accent: "from-amber-400 to-orange-500" },
 ];
 }, [employees]);

 return (
 <div className="space-y-8">
 <div className="rounded-[32px] border border-amber-200/60 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 p-7 text-[#4a2b0f] dark:text-slate-200 shadow-md backdrop-blur-md">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <div>
 <p className="text-xs uppercase tracking-[0.28em] font-extrabold text-[#7a4918]">Employee Management</p>
 <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-slate-200 ">All Employees</h1>
 <p className="max-w-2xl text-[#7a4918] font-medium text-base mt-2">Temple HR dashboard with staff search, role-based insights, and workflow action controls for Sri Shanti Mahadev Mandir.</p>
 </div>
 <button onClick={() => navigate("/admin/employees/add")} className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-6 py-3 font-extrabold text-white shadow-md transition hover:bg-amber-700 hover:scale-105">
 <FiPlus /> Add Employee
 </button>
 </div>
 </div>

 <div className="grid gap-5 xl:grid-cols-[repeat(3,minmax(0,1fr))]">
 {employeeStats.map((metric) => (
 <motion.div
 key={metric.title}
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.4 }}
 className="rounded-[28px] border border-white/15 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-2xl shadow-slate-900/5 backdrop-blur-xl"
 >
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200 ">{metric.title}</p>
 <h3 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-200 ">{metric.value}</h3>
 </div>
 <div className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${metric.accent} text-white shadow-lg shadow-slate-900/10`}>
 <span>{metric.icon}</span>
 </div>
 </div>
 </motion.div>
 ))}
 </div>

 <SectionCard title="Employee roster" subtitle="Search employees, filter by status, or export a PDF report." topRight={<div className="flex flex-wrap items-center gap-3">
 <div className="inline-flex items-center gap-2 rounded-full bg-slate-100/90 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-slate-600 dark:text-slate-200 shadow-sm">
 <FiSearch /> <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} type="text" placeholder="Search employees..." className="w-48 bg-transparent text-sm outline-none" />
 </div>
 <button onClick={() => setShowFilters((current) => !current)} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-slate-800 transition">
 <FiFilter /> Filters
 </button>
 <button onClick={handleExport} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-amber-600 shadow-sm hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition">
 <FiUpload /> Export
 </button>
 </div>}>
 {showFilters && (
 <div className="mb-5 grid gap-3 rounded-[28px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 md:grid-cols-2 xl:grid-cols-4">
 <select value={filters.role} onChange={(e) => setFilters((prev) => ({ ...prev, role: e.target.value }))} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none">
 <option value="">Role</option>
 {roleFilterOptions.filter((role) => role !== "All").map((role) => <option key={role}>{role}</option>)}
 </select>
 <select value={filters.department} onChange={(e) => setFilters((prev) => ({ ...prev, department: e.target.value }))} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none">
 <option value="">Department</option>
 {filterOptions.departments.map((department) => <option key={department}>{department}</option>)}
 </select>
 <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none">
 <option value="">Status</option>
 {statusFilterOptions.map((status) => <option key={status}>{status}</option>)}
 </select>
 <select value={filters.shift} onChange={(e) => setFilters((prev) => ({ ...prev, shift: e.target.value }))} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none">
 <option value="">Shift</option>
 {filterOptions.shifts.map((shift) => <option key={shift}>{shift}</option>)}
 </select>
 <select value={filters.employmentType} onChange={(e) => setFilters((prev) => ({ ...prev, employmentType: e.target.value }))} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none">
 <option value="">Employment Type</option>
 {employmentTypeOptions.map((type) => <option key={type}>{type}</option>)}
 </select>
 <input type="date" value={filters.joiningDate} onChange={(e) => setFilters((prev) => ({ ...prev, joiningDate: e.target.value }))} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none" />
 <input type="number" min="0" value={filters.salaryMin} onChange={(e) => setFilters((prev) => ({ ...prev, salaryMin: e.target.value }))} placeholder="Salary Min" className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none" />
 <div className="flex gap-2">
 <input type="number" min="0" value={filters.salaryMax} onChange={(e) => setFilters((prev) => ({ ...prev, salaryMax: e.target.value }))} placeholder="Salary Max" className="min-w-0 flex-1 rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm outline-none" />
 <button type="button" onClick={() => setFilters(emptyFilters)} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-200 ">
 Clear
 </button>
 </div>
 </div>
 )}
 <EmployeeTable employees={filteredEmployees} onView={handleViewEmployee} onDelete={handleDeleteEmployee} loading={loading} />
 </SectionCard>

 {selectedEmployee && (
 <SectionCard title="Selected Employee" subtitle="Review detailed employee profile." className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-950 dark:text-slate-200 relative">
 <div className="absolute right-6 top-6">
 <button
 onClick={() => setIsEditModalOpen(true)}
 className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
 >
 <FiEdit size={16} /> Edit Employee
 </button>
 </div>
 <div className="grid gap-4 lg:grid-cols-3 mt-4">
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <div className="flex items-center gap-4">
 <div className="h-16 w-16 overflow-hidden rounded-2xl bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 {selectedEmployee.photo ? (
 <img src={selectedEmployee.photo} alt={selectedEmployee.name} className="h-full w-full object-cover" />
 ) : (
 <div className="grid h-full w-full place-items-center text-xl font-bold text-slate-600 dark:text-slate-200 ">
 {(selectedEmployee.name || "E").charAt(0).toUpperCase()}
 </div>
 )}
 </div>
 <div>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Name</p>
 <h3 className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.name}</h3>
 <p className="mt-1 text-sm text-slate-600 dark:text-slate-200 ">
 {selectedEmployee.role} | {selectedEmployee.status || "Active"}
 </p>
 </div>
 </div>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Department</p>
 <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.department || "-"}</p>
 <p className="mt-1 text-sm text-slate-600 dark:text-slate-200 ">Shift: {selectedEmployee.currentDuty?.shift || selectedEmployee.defaultShift || selectedEmployee.shift || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Contact</p>
 <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.phone || selectedEmployee.emergencyContact || "-"}</p>
 <p className="mt-1 text-sm text-slate-600 dark:text-slate-200 ">Joined: {formatDate(selectedEmployee.joiningDate || selectedEmployee.createdAt)}</p>
 </div>
 </div>

 <div className="mt-5 flex flex-wrap gap-2">
 {["Profile", "Attendance", "Leave History", "Payroll", "Performance", "Duty History", "Face Registration"].map((tab) => (
 <button
 key={tab}
 type="button"
 onClick={() => setSelectedTab(tab)}
 className={`rounded-full px-4 py-2 text-sm font-semibold transition ${selectedTab === tab ? "bg-slate-900 text-white" : "border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-600 dark:text-slate-200 "}`}
 >
 {tab}
 </button>
 ))}
 </div>

 {selectedTab === "Profile" && (
 <>
 <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Email</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.email || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Gender</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.gender || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Date of Birth</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.dob || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Blood Group</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.bloodGroup || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Aadhaar</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.aadhaar || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Emergency Contact</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.emergencyContact || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Employment Type</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.employmentType || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Salary</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{formatCurrency(selectedEmployee.salary)}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Bank Name</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.bankName || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Account Number</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.accountNumber || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Current Duty</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.currentDuty?.dutyName || selectedEmployee.defaultDuty || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Default Shift</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.defaultShift || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Default Duty</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.defaultDuty || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Duty Location</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.currentDuty?.dutyLocation || selectedEmployee.dutyLocation || "-"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Attendance Status</p>
 <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.attendanceStatus || "Not Marked"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Leave Balance</p>
 <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.leaveBalance ?? 0} days</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Created Date</p>
 <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-200 ">{formatDate(selectedEmployee.createdAt)}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Updated Date</p>
 <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-200 ">{formatDate(selectedEmployee.updatedAt)}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Created By</p>
 <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.createdBy || "Admin"}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Last Login</p>
 <p className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-200 ">{formatDate(selectedEmployee.lastLogin)}</p>
 </div>
 </div>

 <div className="mt-4 rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Address</p>
 <p className="mt-1 font-semibold text-slate-900 dark:text-slate-200 ">{selectedEmployee.address || "-"}</p>
 </div>
 </>
 )}

 {selectedTab === "Face Registration" && (
 <div className="mt-4">
 <FaceRegistration 
 employee={selectedEmployee} 
 onComplete={(updatedEmployee) => {
 setSelectedEmployee(updatedEmployee);
 setEmployees((current) => current.map((emp) => emp._id === updatedEmployee._id ? updatedEmployee : emp));
 }}
 />
 </div>
 )}

 {selectedTab !== "Profile" && selectedTab !== "Face Registration" && (
 <div className="mt-4 rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 {selectedTab === "Attendance" && (
 <DetailRows rows={selectedEmployee.details?.attendance || []} empty="No attendance records found." getKey={(row) => row._id || row.id} render={(row) => `${formatDate(row.dateKey)} - ${row.status || "Pending"} - ${row.checkIn || "--"} to ${row.checkOut || "--"}`} />
 )}
 {selectedTab === "Leave History" && (
 <DetailRows rows={selectedEmployee.details?.leaveHistory || []} empty="No leave history found." getKey={(row) => row._id || row.id} render={(row) => `${row.leaveType || "Leave"} - ${formatDate(row.fromDate)} to ${formatDate(row.toDate)} - ${row.status}`} />
 )}
 {selectedTab === "Payroll" && (
 <DetailRows rows={[selectedEmployee.details?.payroll || {}]} empty="No payroll details found." getKey={() => "payroll"} render={(row) => `Monthly Salary: ${formatCurrency(row.monthlySalary || selectedEmployee.salary)} - ${row.employmentType || selectedEmployee.employmentType || "-"} - ${row.status || "Active"}`} />
 )}
 {selectedTab === "Performance" && (
 <DetailRows rows={selectedEmployee.details?.performance || []} empty="No performance records found." getKey={(row, index) => row._id || index} render={(row) => `${row.metric || "Performance"} - ${row.rating || "-"}`} />
 )}
 {selectedTab === "Duty History" && (
 <DetailRows rows={selectedEmployee.details?.dutyHistory || []} empty="No duty history found." getKey={(row) => row._id || row.id} render={(row) => `${row.dutyName || row.duty || "-"} - ${row.dutyArea || row.area || "-"} - ${formatDate(row.dueDate || row.dateKey)}`} />
 )}
 </div>
 )}
 </SectionCard>
 )}

 <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
 <div className="space-y-5">
 <div className="grid gap-5 lg:grid-cols-2">
 <SectionCard
 title="Attendance Summary"
 subtitle="Daily employee attendance at a glance."
 className="h-full"
 topRight={
 <div className="flex flex-wrap items-center gap-2">
 <select value={attendanceFilters.role} onChange={(e) => setAttendanceFilters((prev) => ({ ...prev, role: e.target.value }))} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-xs outline-none">
 <option value="All">All Roles</option>
 {roleFilterOptions.filter((role) => role !== "All").map((role) => <option key={role}>{role}</option>)}
 </select>
 <select value={attendanceFilters.department} onChange={(e) => setAttendanceFilters((prev) => ({ ...prev, department: e.target.value }))} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-xs outline-none">
 <option value="">All Departments</option>
 {filterOptions.departments.map((department) => <option key={department}>{department}</option>)}
 </select>
 <select value={attendanceFilters.month} onChange={(e) => setAttendanceFilters((prev) => ({ ...prev, month: e.target.value }))} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-xs outline-none">
 {Array.from({ length: 12 }, (_, index) => {
 const monthNumber = String(index + 1).padStart(2, "0");
 const label = new Date(2026, index, 1).toLocaleDateString("en-IN", { month: "short" });
 return <option key={monthNumber} value={monthNumber}>{label}</option>;
 })}
 </select>
 <select value={attendanceFilters.year} onChange={(e) => setAttendanceFilters((prev) => ({ ...prev, year: e.target.value }))} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-xs outline-none">
 {Array.from({ length: 5 }, (_, index) => {
 const year = String(new Date().getFullYear() - index);
 return <option key={year} value={year}>{year}</option>;
 })}
 </select>
 </div>
 }
 >
 <ResponsiveContainer width="100%" height={220}>
 <AreaChart data={attendanceChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
 <defs>
 <linearGradient id="attendanceGradient" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.8} />
 <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.08} />
 </linearGradient>
 </defs>
 <Tooltip cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }} />
 <Area type="monotone" dataKey="value" stroke="#7c3aed" fill="url(#attendanceGradient)" strokeWidth={3} />
 </AreaChart>
 </ResponsiveContainer>
 </SectionCard>
 <SectionCard
 title="Department Strength"
 subtitle="Team distribution across temple departments."
 className="h-full"
 topRight={
 <select value={departmentRoleFilter} onChange={(e) => setDepartmentRoleFilter(e.target.value)} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-xs outline-none">
 {roleFilterOptions.map((role) => <option key={role}>{role}</option>)}
 </select>
 }
 >
 <div className="space-y-4">
 {departmentStrength.map((dept) => (
 <div key={dept.department} className="space-y-2">
 <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-200 ">
 <span>{dept.department}</span>
 <span>{dept.value}</span>
 </div>
 <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${(dept.value / 16) * 100}%` }} />
 </div>
 </div>
 ))}
 </div>
 </SectionCard>
 </div>


 </div>

 <div className="space-y-5">
 <SectionCard
 title="Recent Joinings"
 subtitle="Newest additions to the temple team."
 className="overflow-hidden"
 topRight={
 <select value={recentRoleFilter} onChange={(e) => setRecentRoleFilter(e.target.value)} className="rounded-full border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-xs outline-none">
 {roleFilterOptions.map((role) => <option key={role}>{role}</option>)}
 </select>
 }
 >
 <div className="space-y-4">
 {recentJoinings.map((item) => (
 <div key={item.name} className="rounded-[22px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{item.name}</p>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">{item.role}</p>
 </div>
 <span className="rounded-full bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-amber-700">{item.date}</span>
 </div>
 </div>
 ))}
 </div>
 </SectionCard>



 <SectionCard title="Employee Distribution" subtitle="Live role proportion in the temple workforce." className="text-center">
 <ResponsiveContainer width="100%" height={280}>
 <PieChart>
 <Pie data={distributionData} dataKey="value" cx="50%" cy="50%" innerRadius={52} outerRadius={90} paddingAngle={4}>
 {distributionData.map((entry, index) => (
 <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
 ))}
 </Pie>
 <Tooltip formatter={(value) => `${value} staff`} />
 </PieChart>
 </ResponsiveContainer>
 </SectionCard>
 </div>
 </div>
 {selectedEmployee && isEditModalOpen && (
 <EditEmployeeModal
 employee={selectedEmployee}
 onClose={() => setIsEditModalOpen(false)}
 onSave={() => {
 setIsEditModalOpen(false);
 fetchEmployees();
 setSelectedEmployee(null); // Deselect so they can see the updated list, or we could just fetch and re-select
 }}
 />
 )}
 </div>
 );
};

const DetailRows = ({ rows, empty, getKey, render }) => {
 if (!rows.length) {
 return <p className="text-sm text-slate-500 dark:text-slate-200 ">{empty}</p>;
 }

 return (
 <div className="space-y-3">
 {rows.slice(0, 8).map((row, index) => (
 <div key={getKey(row, index)} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-200 ">
 {render(row, index)}
 </div>
 ))}
 </div>
 );
};

export default AllEmployees;
