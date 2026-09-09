import { useState, useEffect } from "react";
import { getFestivalDuties, markFestivalDutyAttendance, completeFestivalDuty } from "../../services/priestService";
import { FiCalendar, FiClock, FiMapPin, FiCheckCircle, FiUserCheck } from "react-icons/fi";

const FestivalDuties = () => {
 const [duties, setDuties] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");

 const loadDuties = async () => {
 try {
 setLoading(true);
 setError("");
 const data = await getFestivalDuties();
 setDuties(data || []);
 } catch (err) {
 setError(err.response?.data?.message || "Failed to load festival duties");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadDuties();
 }, []);

 const handleAttendance = async (id) => {
 try {
 await markFestivalDutyAttendance(id);
 loadDuties();
 } catch (err) {
 alert("Failed to mark attendance");
 }
 };

 const handleComplete = async (id) => {
 try {
 await completeFestivalDuty(id);
 loadDuties();
 } catch (err) {
 alert("Failed to complete festival duty");
 }
 };

 return (
 <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
 <div>
 <h1 className="text-2xl font-bold text-slate-900">Festival Duties</h1>
 <p className="text-slate-500">View and manage your assigned duties for upcoming temple festivals.</p>
 </div>

 {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4 text-sm font-medium text-rose-700">{error}</div>}

 {loading ? (
 <div className="p-10 text-center text-slate-500">Loading festival duties...</div>
 ) : duties.length === 0 ? (
 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-10 text-center shadow-sm">
 <p className="text-slate-500">No festival duties assigned to you currently.</p>
 </div>
 ) : (
 <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
 {duties.map((duty) => (
 <div key={duty.id} className="flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-sm transition-all hover:shadow-md">
 <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-br from-amber-50 to-orange-50">
 <span className="inline-flex rounded-full bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-amber-800 mb-2">
 {duty.festivalName}
 </span>
 <h3 className="text-xl font-bold text-slate-900">{duty.role}</h3>
 {duty.description && <p className="text-sm text-slate-600 mt-2">{duty.description}</p>}
 </div>
 
 <div className="flex-1 p-6 space-y-4">
 <div className="flex items-start gap-3">
 <div className="mt-0.5 rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2 text-slate-500"><FiCalendar /></div>
 <div>
 <p className="text-xs font-medium text-slate-500">Date</p>
 <p className="text-sm font-semibold text-slate-900">{duty.date}</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <div className="mt-0.5 rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2 text-slate-500"><FiClock /></div>
 <div>
 <p className="text-xs font-medium text-slate-500">Timing</p>
 <p className="text-sm font-semibold text-slate-900">{duty.startTime} - {duty.endTime}</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <div className="mt-0.5 rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2 text-slate-500"><FiMapPin /></div>
 <div>
 <p className="text-xs font-medium text-slate-500">Location</p>
 <p className="text-sm font-semibold text-slate-900">{duty.location}</p>
 </div>
 </div>
 </div>
 
 <div className="border-t border-slate-100 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4">
 {duty.status === "Pending" && (
 <button
 onClick={() => handleAttendance(duty.id)}
 className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
 >
 <FiUserCheck /> Mark Attendance
 </button>
 )}
 {duty.status === "Attended" && (
 <button
 onClick={() => handleComplete(duty.id)}
 className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
 >
 <FiCheckCircle /> Complete Duty
 </button>
 )}
 {duty.status === "Completed" && (
 <div className="flex items-center justify-center gap-2 text-sm font-bold text-emerald-600">
 <FiCheckCircle /> Duty Completed
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
};

export default FestivalDuties;
