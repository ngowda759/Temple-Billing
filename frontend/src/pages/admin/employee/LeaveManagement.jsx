import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import SectionCard from "../../../components/admin/employee/SectionCard";

const API_BASE = "http://localhost:5000/api";

const toDateValue = (value) => {
 if (!value) return null;
 const parsed = new Date(`${value}T00:00:00`);
 return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getLeaveDays = (fromDate, toDate) => {
 const from = toDateValue(fromDate);
 const to = toDateValue(toDate);
 if (!from || !to || to < from) {
 return 0;
 }
 const oneDayMs = 24 * 60 * 60 * 1000;
 return Math.floor((to - from) / oneDayMs) + 1;
};

const formatPeriod = (fromDate, toDate) => {
 const from = toDateValue(fromDate);
 const to = toDateValue(toDate);
 if (!from || !to) {
 return `${fromDate || "-"} to ${toDate || "-"}`;
 }
 const fromLabel = from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
 const toLabel = to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
 return `${fromLabel} - ${toLabel}`;
};

const statusClasses = {
 Approved: "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700",
 Rejected: "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700",
 Pending: "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700",
};

const LeaveManagement = () => {
 const admin = JSON.parse(localStorage.getItem("user") || "null");
 const [leaves, setLeaves] = useState([]);
 const [summary, setSummary] = useState({
 total: 0,
 approved: 0,
 rejected: 0,
 pending: 0,
 employeesOnLeave: 0,
 });
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const [updatingId, setUpdatingId] = useState("");

 const fetchLeaveOverview = useCallback(async () => {
 try {
 setError("");
 const response = await axios.get(`${API_BASE}/leaves/admin/overview`);
 setLeaves(Array.isArray(response.data?.leaves) ? response.data.leaves : []);
 setSummary(
 response.data?.summary || {
 total: 0,
 approved: 0,
 rejected: 0,
 pending: 0,
 employeesOnLeave: 0,
 }
 );
 } catch (apiError) {
 setError(apiError.response?.data?.message || "Failed to load leave requests");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchLeaveOverview();
 }, [fetchLeaveOverview]);

 const leaveTiles = [
 { title: "Total Leave Requests", value: summary.total },
 { title: "Approved Leaves", value: summary.approved },
 { title: "Rejected Leaves", value: summary.rejected },
 { title: "Employees On Leave", value: summary.employeesOnLeave },
 ];

 const approvedUpcomingLeaves = useMemo(() => {
 return leaves
 .filter((leave) => leave.status === "Approved")
 .slice(0, 5)
 .map((leave) => ({
 id: leave._id,
 name: leave.staffName,
 type: leave.leaveType || "General",
 period: formatPeriod(leave.fromDate, leave.toDate),
 days: getLeaveDays(leave.fromDate, leave.toDate),
 }));
 }, [leaves]);

 const handleStatusUpdate = async (leave, status) => {
 const currentReason = leave.adminReason || "";
 const promptText =
 status === "Rejected"
 ? "Enter rejection reason (required):"
 : "Enter approval note for employee (optional):";
 const enteredReason = window.prompt(promptText, currentReason);

 if (enteredReason === null) {
 return;
 }
 if (status === "Rejected" && !enteredReason.trim()) {
 alert("Please enter rejection reason");
 return;
 }

 try {
 setUpdatingId(leave._id);
 await axios.put(`${API_BASE}/leaves/status/${leave._id}`, {
 status,
 adminReason: enteredReason.trim(),
 reviewedBy: admin?.name || "Admin",
 });
 await fetchLeaveOverview();
 } catch (apiError) {
 alert(apiError.response?.data?.message || "Failed to update leave status");
 } finally {
 setUpdatingId("");
 }
 };

 return (
 <div className="space-y-8">
 <SectionCard
 title="Leave Management"
 subtitle="Approve, review, and track employee leave requests for Sri Shanti Mahadev Mandir."
 className="bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 text-[#4a2b0f] dark:text-slate-200 border border-amber-200/60 shadow-md backdrop-blur-md"
 >
 <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
 {leaveTiles.map((tile) => (
 <div key={tile.title} className="rounded-[28px] border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-xs">
 <p className="text-xs font-black uppercase tracking-wider text-amber-800">{tile.title}</p>
 <p className="mt-3 text-3xl font-black text-slate-900 dark:text-slate-200 ">{tile.value}</p>
 </div>
 ))}
 </div>
 </SectionCard>

 {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-rose-700">{error}</div> : null}

 <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
 <SectionCard title="Leave Requests" subtitle="Review pending requests and update approval status." className="overflow-hidden">
 <div className="overflow-x-auto rounded-[28px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-sm">
 <table className="min-w-full text-left text-sm text-slate-600 dark:text-slate-200 ">
 <thead className="bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-5 py-4">Employee</th>
 <th className="px-5 py-4">Reason</th>
 <th className="px-5 py-4">Type</th>
 <th className="px-5 py-4">Days</th>
 <th className="px-5 py-4">Period</th>
 <th className="px-5 py-4">Status</th>
 <th className="px-5 py-4">Admin Reason</th>
 <th className="px-5 py-4">Action</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="8" className="px-5 py-6 text-center text-slate-500 dark:text-slate-200 ">
 Loading leave requests...
 </td>
 </tr>
 ) : leaves.length === 0 ? (
 <tr>
 <td colSpan="8" className="px-5 py-6 text-center text-slate-500 dark:text-slate-200 ">
 No leave requests found
 </td>
 </tr>
 ) : (
 leaves.map((leave) => {
 const statusClass = statusClasses[leave.status] || statusClasses.Pending;
 const days = getLeaveDays(leave.fromDate, leave.toDate);
 return (
 <tr key={leave._id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-5 py-4 font-semibold text-slate-900 dark:text-slate-200 ">{leave.staffName}</td>
 <td className="px-5 py-4">{leave.reason}</td>
 <td className="px-5 py-4">{leave.leaveType || "General"}</td>
 <td className="px-5 py-4">{days}</td>
 <td className="px-5 py-4">{formatPeriod(leave.fromDate, leave.toDate)}</td>
 <td className="px-5 py-4">
 <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{leave.status}</span>
 </td>
 <td className="px-5 py-4">{leave.adminReason || "-"}</td>
 <td className="px-5 py-4">
 {leave.status === "Pending" ? (
 <div className="flex gap-2">
 <button
 type="button"
 className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
 disabled={updatingId === leave._id}
 onClick={() => handleStatusUpdate(leave, "Approved")}
 >
 Approve
 </button>
 <button
 type="button"
 className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
 disabled={updatingId === leave._id}
 onClick={() => handleStatusUpdate(leave, "Rejected")}
 >
 Reject
 </button>
 </div>
 ) : (
 <span className="text-xs text-slate-500 dark:text-slate-200 ">{leave.reviewedBy ? `By ${leave.reviewedBy}` : "Action completed"}</span>
 )}
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>

 <SectionCard title="Upcoming Leaves" subtitle="Recently approved employee leaves." className="overflow-hidden">
 <div className="space-y-4">
 {approvedUpcomingLeaves.length === 0 ? (
 <div className="rounded-[22px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm text-slate-500 dark:text-slate-200 ">No approved leaves yet.</div>
 ) : (
 approvedUpcomingLeaves.map((leave) => (
 <div key={leave.id} className="rounded-[22px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="font-semibold text-slate-900 dark:text-slate-200 ">{leave.name}</p>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">
 {leave.type} - {leave.period}
 </p>
 </div>
 <span className="rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 ">{leave.days} days</span>
 </div>
 </div>
 ))
 )}
 </div>
 </SectionCard>
 </div>
 </div>
 );
};

export default LeaveManagement;
