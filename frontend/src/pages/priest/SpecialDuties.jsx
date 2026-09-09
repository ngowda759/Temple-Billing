import { useState, useEffect } from "react";
import { getSpecialDuties, acceptSpecialDuty, rejectSpecialDuty, completeSpecialDuty } from "../../services/priestService";
import { FiCheck, FiX, FiCheckCircle, FiClock, FiCalendar, FiMapPin } from "react-icons/fi";

const SpecialDuties = () => {
 const [duties, setDuties] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const [rejectModalId, setRejectModalId] = useState(null);
 const [rejectionReason, setRejectionReason] = useState("");

 const loadDuties = async () => {
 try {
 setLoading(true);
 setError("");
 const data = await getSpecialDuties();
 setDuties(data || []);
 } catch (err) {
 setError(err.response?.data?.message || "Failed to load special duties");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadDuties();
 }, []);

 const handleAccept = async (id) => {
 try {
 await acceptSpecialDuty(id);
 loadDuties();
 } catch (err) {
 alert("Failed to accept duty");
 }
 };

 const handleReject = async (e) => {
 e.preventDefault();
 if (!rejectionReason.trim()) return alert("Reason is required");
 try {
 await rejectSpecialDuty(rejectModalId, rejectionReason);
 setRejectModalId(null);
 setRejectionReason("");
 loadDuties();
 } catch (err) {
 alert("Failed to reject duty");
 }
 };

 const handleComplete = async (id) => {
 try {
 await completeSpecialDuty(id);
 loadDuties();
 } catch (err) {
 alert("Failed to complete duty");
 }
 };

 return (
 <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
 <div>
 <h1 className="text-2xl font-bold text-slate-900">Special Duties</h1>
 <p className="text-slate-500">Manage VIP arrangements, festival preparations, and other special duties.</p>
 </div>

 {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4 text-sm font-medium text-rose-700">{error}</div>}

 {loading ? (
 <div className="p-10 text-center text-slate-500">Loading duties...</div>
 ) : duties.length === 0 ? (
 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-10 text-center shadow-sm">
 <p className="text-slate-500">No special duties assigned to you currently.</p>
 </div>
 ) : (
 <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
 {duties.map((duty) => (
 <div key={duty.id} className="flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-sm transition-all hover:shadow-md">
 <div className={`px-6 py-4 border-b border-slate-100 ${
 duty.status === "Completed" ? "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " :
 duty.status === "Rejected" ? "bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " :
 duty.status === "Accepted" ? "bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " : "bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}>
 <div className="flex items-center justify-between">
 <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
 duty.status === "Completed" ? "text-emerald-700" :
 duty.status === "Rejected" ? "text-rose-700" :
 duty.status === "Accepted" ? "text-blue-700" : "text-amber-700"
 }`}>
 {duty.status}
 </span>
 {duty.priority === "High" && (
 <span className="inline-flex rounded-full bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
 High Priority
 </span>
 )}
 </div>
 <h3 className="mt-2 text-lg font-bold text-slate-900">{duty.title}</h3>
 <p className="text-sm text-slate-500 line-clamp-2 mt-1">{duty.description}</p>
 </div>
 <div className="flex-1 p-6 space-y-3">
 <div className="flex items-center gap-2 text-sm text-slate-600">
 <FiCalendar className="text-slate-400" />
 <span>{duty.date || "Any Day"}</span>
 </div>
 <div className="flex items-center gap-2 text-sm text-slate-600">
 <FiClock className="text-slate-400" />
 <span>{duty.startTime} - {duty.endTime}</span>
 </div>
 <div className="flex items-center gap-2 text-sm text-slate-600">
 <FiMapPin className="text-slate-400" />
 <span>Assigned by: {duty.assignedBy}</span>
 </div>
 </div>
 
 <div className="border-t border-slate-100 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4">
 {duty.status === "Pending" && (
 <div className="flex gap-2">
 <button
 onClick={() => handleAccept(duty.id)}
 className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
 >
 <FiCheck /> Accept
 </button>
 <button
 onClick={() => setRejectModalId(duty.id)}
 className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FiX /> Reject
 </button>
 </div>
 )}
 {duty.status === "Accepted" && (
 <button
 onClick={() => handleComplete(duty.id)}
 className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
 >
 <FiCheckCircle /> Mark Completed
 </button>
 )}
 {(duty.status === "Completed" || duty.status === "Rejected") && (
 <div className="text-center text-sm font-medium text-slate-500">
 Task {duty.status}
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 )}

 {/* Reject Modal */}
 {rejectModalId && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
 <div className="w-full max-w-md rounded-[32px] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-8 shadow-2xl">
 <h3 className="text-xl font-bold text-slate-900">Reject Duty</h3>
 <p className="mt-2 text-sm text-slate-500">Please provide a reason for rejecting this special duty assignment.</p>
 <form onSubmit={handleReject} className="mt-6">
 <textarea
 value={rejectionReason}
 onChange={(e) => setRejectionReason(e.target.value)}
 placeholder="Reason for rejection..."
 className="w-full min-h-[120px] rounded-2xl border border-slate-200 p-4 text-sm outline-none transition focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
 required
 />
 <div className="mt-6 flex gap-3">
 <button
 type="button"
 onClick={() => setRejectModalId(null)}
 className="flex-1 rounded-xl border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Cancel
 </button>
 <button
 type="submit"
 className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700"
 >
 Submit Rejection
 </button>
 </div>
 </form>
 </div>
 </div>
 )}
 </div>
 );
};

export default SpecialDuties;
