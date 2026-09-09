import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
 FiCalendar,
 FiClipboard,
 FiEdit3,
 FiEye,
 FiFileText,
 FiRefreshCw,
 FiSend,
 FiTrash2,
 FiUser,
 FiUserCheck,
} from "react-icons/fi";
import { getEmployees } from "../../services/employeeService";

const API_BASE = "http://localhost:5000/api";
const TASK_STATUSES = ["Pending", "In Progress", "Completed"];

const statusStyles = {
 Pending: "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700 border-amber-200",
 "In Progress": "bg-sky-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-sky-700 border-sky-200",
 Completed: "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700 border-emerald-200",
};

const getTodayInputDate = () => {
 const today = new Date();
 today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
 return today.toISOString().slice(0, 10);
};

const emptyForm = {
 employeeId: "",
 title: "",
 description: "",
 dueDate: "",
 assignedBy: "",
};

const formatDate = (value) => {
 if (!value) return "-";
 const normalizedValue = String(value);
 const date = new Date(normalizedValue.includes("T") ? normalizedValue : `${normalizedValue}T00:00:00`);
 if (Number.isNaN(date.getTime())) return normalizedValue;
 return date.toLocaleDateString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 });
};

const taskCode = (task, index) => {
 if (task?._id) return `TSK${task._id.slice(-4).toUpperCase()}`;
 return `TSK${String(index + 1).padStart(4, "0")}`;
};

const avatarPalette = ["#7c3aed", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444"];

const hashString = (value) =>
 String(value || "").split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);

const getEmployeeAvatar = (employee, fallback) => {
 if (employee?.photo) return employee.photo;
 const source = String(employee?.name || employee?.email || fallback || "Employee");
 const initial = source.trim().charAt(0).toUpperCase() || "E";
 const color = avatarPalette[Math.abs(hashString(source)) % avatarPalette.length];
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="${color}"/><text x="60" y="67" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${initial}</text></svg>`;
 return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const AssignTask = () => {
 const loggedInUser = useMemo(() => JSON.parse(localStorage.getItem("user") || "null"), []);
 const assignedByDefault = useMemo(() => {
 const role = String(loggedInUser?.role || "admin").trim();
 const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
 return loggedInUser?.name ? `${roleLabel} (${loggedInUser.name})` : roleLabel;
 }, [loggedInUser]);

 const todayDate = useMemo(getTodayInputDate, []);

 const [employees, setEmployees] = useState([]);
 const [tasks, setTasks] = useState([]);
 const [form, setForm] = useState({ ...emptyForm, assignedBy: assignedByDefault });
 const [employeeFilter, setEmployeeFilter] = useState("all");
 const [statusFilter, setStatusFilter] = useState("all");
 const [loading, setLoading] = useState(true);
 const [submitting, setSubmitting] = useState(false);
 const [updatingTaskId, setUpdatingTaskId] = useState("");
 const [deletingTaskId, setDeletingTaskId] = useState("");
 const [message, setMessage] = useState(null);

 const selectedEmployee = useMemo(
 () => employees.find((employee) => employee._id === form.employeeId),
 [employees, form.employeeId]
 );

 const filteredTasks = useMemo(() => {
 return tasks.filter((task) => {
 const matchesEmployee =
 employeeFilter === "all" ||
 task.employeeId === employeeFilter ||
 task.staffId === employeeFilter;
 const matchesStatus = statusFilter === "all" || task.status === statusFilter;
 return matchesEmployee && matchesStatus;
 });
 }, [employeeFilter, statusFilter, tasks]);

 const taskSummary = useMemo(() => {
 return tasks.reduce(
 (summary, task) => {
 summary.total += 1;
 if (task.status === "Pending") summary.pending += 1;
 if (task.status === "In Progress") summary.inProgress += 1;
 if (task.status === "Completed") summary.completed += 1;
 return summary;
 },
 { total: 0, pending: 0, inProgress: 0, completed: 0 }
 );
 }, [tasks]);

 const fetchPageData = async () => {
 try {
 setLoading(true);
 setMessage(null);
 const [employeeData, taskResponse] = await Promise.all([
 getEmployees(),
 axios.get(`${API_BASE}/staff/tasks`),
 ]);
 setEmployees(Array.isArray(employeeData) ? employeeData : []);
 setTasks(Array.isArray(taskResponse.data) ? taskResponse.data : []);
 } catch (error) {
 setMessage({
 type: "error",
 text: error.response?.data?.message || "Unable to load employees and tasks.",
 });
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchPageData();
 }, []);

 const updateField = (field) => (event) => {
 setForm((current) => ({ ...current, [field]: event.target.value }));
 };

 const resetForm = () => {
 setForm({ ...emptyForm, assignedBy: assignedByDefault });
 setMessage(null);
 };

 const handleSubmit = async (event) => {
 event.preventDefault();
 if (form.dueDate < todayDate) {
 setMessage({ type: "error", text: "Due date cannot be in the past." });
 return;
}
 if (!selectedEmployee || !form.title.trim() || !form.description.trim() || !form.dueDate || !form.assignedBy.trim()) {
 setMessage({ type: "error", text: "Please complete all required task details." });
 return;
 }

 try {
 setSubmitting(true);
 setMessage(null);
 const response = await axios.post(`${API_BASE}/staff/assign-task`, {
 employeeId: selectedEmployee._id,
 staffName: selectedEmployee.name,
 staffEmail: selectedEmployee.email,
 title: form.title.trim(),
 description: form.description.trim(),
 dueDate: form.dueDate,
 assignedBy: form.assignedBy.trim(),
 });

 setTasks((current) => [response.data.task, ...current]);
 setForm({ ...emptyForm, assignedBy: assignedByDefault });
 setMessage({ type: "success", text: "Task assigned successfully." });
 } catch (error) {
 setMessage({
 type: "error",
 text: error.response?.data?.message || "Failed to assign task.",
 });
 } finally {
 setSubmitting(false);
 }
 };

 const handleStatusChange = async (taskId, status) => {
 try {
 setUpdatingTaskId(taskId);
 await axios.put(`${API_BASE}/staff/task-status/${taskId}`, { status });
 setTasks((current) => current.map((task) => (task._id === taskId ? { ...task, status } : task)));
 } catch (error) {
 setMessage({
 type: "error",
 text: error.response?.data?.message || "Failed to update task status.",
 });
 } finally {
 setUpdatingTaskId("");
 }
 };

 const handleViewTask = (task) => {
 setEmployeeFilter(task.employeeId || task.staffId || "all");
 setStatusFilter(task.status || "all");
 setMessage({
 type: "info",
 text: `${task.title || task.duty} is assigned to ${task.staffName} and due on ${formatDate(task.dueDate || task.time)}.`,
 });
 };

 const handleReuseTask = (task) => {
 const employee = employees.find((item) => item._id === task.employeeId || item._id === task.staffId);
 setForm({
 employeeId: employee?._id || "",
 title: task.title || task.duty || "",
 description: task.description || task.area || "",
 dueDate: task.dueDate || task.time || "",
 assignedBy: task.assignedBy || assignedByDefault,
 });
 window.scrollTo({ top: 0, behavior: "smooth" });
 };

 const handleDeleteTask = async (task) => {
 if (!task?._id) return;
 const taskName = task.title || task.duty || "this task";
 if (!window.confirm(`Delete "${taskName}"? This task will no longer be visible to the employee.`)) {
 return;
 }

 try {
 setDeletingTaskId(task._id);
 setMessage(null);
 await axios.delete(`${API_BASE}/staff/tasks/${task._id}`);
 setTasks((current) => current.filter((item) => item._id !== task._id));
 setMessage({ type: "success", text: "Task deleted successfully." });
 } catch (error) {
 setMessage({
 type: "error",
 text: error.response?.data?.message || "Failed to delete task.",
 });
 } finally {
 setDeletingTaskId("");
 }
 };

 return (
 <div className="py-6">
 <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <div className="mb-2 flex items-center gap-3">
 <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#5f3a1f] text-white shadow-lg shadow-amber-900/20">
 <FiClipboard size={22} />
 </span>
 <div>
 <h1 className="text-3xl font-bold text-slate-950 dark:text-slate-200 ">Task Assign</h1>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">Employee Management &gt; Task Assign</p>
 </div>
 </div>
 <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-200 ">
 Assign duties to temple employees and track exactly what appears on each staff dashboard.
 </p>
 </div>

 <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
 {[
 ["Total", taskSummary.total],
 ["Pending", taskSummary.pending],
 ["In Progress", taskSummary.inProgress],
 ["Completed", taskSummary.completed],
 ].map(([label, value]) => (
 <div key={label} className="rounded-2xl border border-white/70 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 shadow-lg shadow-slate-900/5">
 <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
 <strong className="text-2xl text-slate-950 dark:text-slate-200 ">{value}</strong>
 </div>
 ))}
 </div>
 </div>

 {message ? (
 <div
 className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-medium ${ message.type === "success" ? "border-emerald-200 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-emerald-700" : message.type === "info" ? "border-sky-200 bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-sky-700" : "border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700" }`}
 >
 {message.text}
 </div>
 ) : null}

 <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
 <section className="rounded-[28px] border border-white/70 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl shadow-slate-900/5">
 <div className="mb-6">
 <h2 className="text-xl font-bold text-slate-950 dark:text-slate-200 ">Assign New Task</h2>
 <div className="mt-3 h-1 w-16 rounded-full bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " />
 </div>

 <form onSubmit={handleSubmit} className="space-y-5">
 <label className="block">
 <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Select Employee <b className="text-rose-500">*</b></span>
 <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="flex w-11 items-center justify-center border-r border-slate-200 dark:border-slate-700 text-[#5f3a1f]">
 <FiUser />
 </span>
 <select
 value={form.employeeId}
 onChange={updateField("employeeId")}
 className="min-h-12 flex-1 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 text-sm outline-none"
 disabled={loading}
 >
 <option value="">-- Select Employee --</option>
 {employees.map((employee) => (
 <option key={employee._id} value={employee._id}>
 {employee.name} {employee.role ? `(${employee.role})` : ""}
 </option>
 ))}
 </select>
 </div>
 </label>

 <label className="block">
 <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Task Title <b className="text-rose-500">*</b></span>
 <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="flex w-11 items-center justify-center border-r border-slate-200 dark:border-slate-700 text-[#5f3a1f]">
 <FiFileText />
 </span>
 <input
 type="text"
 value={form.title}
 onChange={updateField("title")}
 placeholder="Enter task title"
 className="min-h-12 flex-1 px-4 text-sm outline-none"
 />
 </div>
 </label>

 <label className="block">
 <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Task Description <b className="text-rose-500">*</b></span>
 <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="flex w-11 items-start justify-center border-r border-slate-200 dark:border-slate-700 pt-4 text-[#5f3a1f]">
 <FiEdit3 />
 </span>
 <textarea
 value={form.description}
 onChange={updateField("description")}
 placeholder="Enter task description here"
 rows={4}
 className="min-h-24 flex-1 resize-none px-4 py-3 text-sm outline-none"
 />
 </div>
 </label>

 <label className="block">
 <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Due Date <b className="text-rose-500">*</b></span>
 <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="flex w-11 items-center justify-center border-r border-slate-200 dark:border-slate-700 text-[#5f3a1f]">
 <FiCalendar />
 </span>
 <input
 type="date"
 min={todayDate}
 value={form.dueDate}
 onChange={updateField("dueDate")}
 className="min-h-12 flex-1 px-4 text-sm outline-none"
 />
 </div>
 </label>

 <label className="block">
 <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200 ">Assign By</span>
 <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <span className="flex w-11 items-center justify-center border-r border-slate-200 dark:border-slate-700 text-[#5f3a1f]">
 <FiUserCheck />
 </span>
 <input
 type="text"
 value={form.assignedBy}
 onChange={updateField("assignedBy")}
 placeholder="Admin"
 className="min-h-12 flex-1 bg-transparent px-4 text-sm outline-none"
 />
 </div>
 </label>

 {selectedEmployee ? (
 <div className="flex items-center gap-3 rounded-2xl bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3 text-sm text-amber-900">
 <img
 src={getEmployeeAvatar(selectedEmployee, "selected")}
 alt={selectedEmployee.name}
 className="h-10 w-10 rounded-full object-cover"
 />
 <div>
 <p className="font-semibold">{selectedEmployee.name}</p>
 <p className="text-xs text-amber-700">{selectedEmployee.email || selectedEmployee.department || "Employee selected"}</p>
 </div>
 </div>
 ) : null}

 <div className="flex flex-col gap-3 sm:flex-row">
 <button
 type="submit"
 disabled={submitting}
 className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
 >
 <FiSend /> {submitting ? "Assigning..." : "Assign Task"}
 </button>
 <button
 type="button"
 onClick={resetForm}
 className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <FiRefreshCw /> Reset
 </button>
 </div>
 </form>
 </section>

 <section className="rounded-[28px] border border-white/70 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl shadow-slate-900/5">
 <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
 <div>
 <h2 className="text-xl font-bold text-slate-950 dark:text-slate-200 ">Assigned Tasks</h2>
 <div className="mt-3 h-1 w-16 rounded-full bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " />
 </div>

 <div className="flex flex-col gap-3 sm:flex-row">
 <select
 value={employeeFilter}
 onChange={(event) => setEmployeeFilter(event.target.value)}
 className="min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 text-sm outline-none"
 >
 <option value="all">All Employees</option>
 {employees.map((employee) => (
 <option key={employee._id} value={employee._id}>
 {employee.name}
 </option>
 ))}
 </select>
 <select
 value={statusFilter}
 onChange={(event) => setStatusFilter(event.target.value)}
 className="min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 text-sm outline-none"
 >
 <option value="all">All Status</option>
 {TASK_STATUSES.map((status) => (
 <option key={status} value={status}>
 {status}
 </option>
 ))}
 </select>
 </div>
 </div>

 <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <div className="overflow-x-auto">
 <table className="min-w-[900px] w-full text-left text-sm">
 <thead className="bg-[#f8f1e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-4 font-bold">Task ID</th>
 <th className="px-4 py-4 font-bold">Employee</th>
 <th className="px-4 py-4 font-bold">Task Title</th>
 <th className="px-4 py-4 font-bold">Due Date</th>
 <th className="px-4 py-4 font-bold">Status</th>
 <th className="px-4 py-4 font-bold">Assigned On</th>
 <th className="px-4 py-4 font-bold">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100">
 {loading ? (
 <tr>
 <td colSpan="7" className="px-4 py-10 text-center text-slate-500 dark:text-slate-200 ">
 Loading assigned tasks...
 </td>
 </tr>
 ) : filteredTasks.length === 0 ? (
 <tr>
 <td colSpan="7" className="px-4 py-10 text-center text-slate-500 dark:text-slate-200 ">
 No assigned tasks found.
 </td>
 </tr>
 ) : (
 filteredTasks.map((task, index) => {
 const employee = employees.find((item) => item._id === task.employeeId || item._id === task.staffId);
 return (
 <tr key={task._id || index} className="align-middle transition hover:bg-orange-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <td className="px-4 py-4 font-bold text-orange-500">{taskCode(task, index)}</td>
 <td className="px-4 py-4">
 <div className="flex items-center gap-3">
 <img
 src={getEmployeeAvatar(employee, task.staffName)}
 alt={task.staffName}
 className="h-10 w-10 rounded-full object-cover"
 />
 <div>
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{task.staffName}</p>
 <p className="text-xs text-slate-500 dark:text-slate-200 ">{employee?.department || task.staffEmail || task.staffId}</p>
 </div>
 </div>
 </td>
 <td className="px-4 py-4 text-slate-800 dark:text-slate-200 ">
 <p className="font-semibold">{task.title || task.duty}</p>
 <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-200 ">{task.description || task.area}</p>
 </td>
 <td className="px-4 py-4 text-slate-700 dark:text-slate-200 ">
 <span className="inline-flex items-center gap-2">
 <FiCalendar className="text-[#5f3a1f]" /> {formatDate(task.dueDate || task.time)}
 </span>
 </td>
 <td className="px-4 py-4">
 <select
 value={task.status || "Pending"}
 onChange={(event) => handleStatusChange(task._id, event.target.value)}
 disabled={updatingTaskId === task._id}
 className={`rounded-xl border px-3 py-2 text-xs font-bold outline-none ${statusStyles[task.status] || statusStyles.Pending}`}
 >
 {TASK_STATUSES.map((status) => (
 <option key={status} value={status}>
 {status}
 </option>
 ))}
 </select>
 </td>
 <td className="px-4 py-4 text-slate-700 dark:text-slate-200 ">
 <span className="inline-flex items-center gap-2">
 <FiCalendar className="text-[#5f3a1f]" /> {formatDate(task.createdAt)}
 </span>
 </td>
 <td className="px-4 py-4">
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={() => handleViewTask(task)}
 className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-sky-600 transition hover:bg-sky-200"
 title="View task"
 >
 <FiEye />
 </button>
 <button
 type="button"
 onClick={() => handleReuseTask(task)}
 className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-emerald-600 transition hover:bg-emerald-200"
 title="Reuse task details"
 >
 <FiEdit3 />
 </button>
 <button
 type="button"
 onClick={() => handleDeleteTask(task)}
 disabled={deletingTaskId === task._id}
 className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-rose-600 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
 title="Delete task"
 >
 <FiTrash2 />
 </button>
 </div>
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>
 </div>

 <div className="mt-5 flex flex-col gap-3 text-sm text-slate-500 dark:text-slate-200 sm:flex-row sm:items-center sm:justify-between">
 <p>
 Showing {filteredTasks.length} of {tasks.length} tasks
 </p>
 <button
 type="button"
 onClick={fetchPageData}
 className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <FiRefreshCw /> Refresh
 </button>
 </div>
 </section>
 </div>
 </div>
 );
};

export default AssignTask;
