import { useEffect, useState } from "react";
import {
 FaCalendarAlt,
 FaMapMarkerAlt,
 FaClock,
 FaExclamationTriangle,
 FaCheckCircle,
 FaBoxOpen,
} from "react-icons/fa";
import {
 getSevaSchedule,
 getSevaInstructions,
 getMaterialChecklist,
} from "../../services/priestService";

const SevaSchedule = ({ darkMode }) => {
 const [schedule, setSchedule] = useState([]);
 const [instructions, setInstructions] = useState([]);
 const [checklist, setChecklist] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);

 const fetchScheduleData = async () => {
 try {
 setLoading(true);
 setError(null);
 
 const [scheduleData, instructionsData, checklistData] = await Promise.all([
 getSevaSchedule(),
 getSevaInstructions(),
 getMaterialChecklist(),
 ]);

 setSchedule(scheduleData || []);
 setInstructions(instructionsData || []);
 setChecklist(checklistData || []);
 } catch (err) {
 console.error("Error fetching Seva schedule data:", err);
 setError("Failed to load schedule information. Please try again later.");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchScheduleData();
 }, []);

 const getPriorityColor = (priority) => {
 switch (priority) {
 case "High":
 return "border-l-4 border-rose-500 bg-rose-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-900 dark:bg-rose-950/20 dark:text-rose-450 dark:border-rose-700";
 case "Medium":
 return "border-l-4 border-amber-500 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-900 dark:bg-amber-950/20 dark:text-amber-450 dark:border-amber-700";
 default:
 return "border-l-4 border-sky-500 bg-sky-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-sky-900 dark:bg-sky-950/20 dark:text-sky-450 dark:border-sky-700";
 }
 };

 const getInventoryStatusBadge = (status) => {
 switch (status) {
 case "Available":
 return "text-emerald-600 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30";
 case "Low Stock":
 return "text-amber-600 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30";
 case "Out Of Stock":
 return "text-rose-650 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-rose-100 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30";
 default:
 return "text-slate-500 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-100 dark:bg-[#0f172a] dark:text-slate-350 dark:border-slate-700 ";
 }
 };

 return (
 <div className="space-y-6 fade-in">
 {/* Title Header */}
 <div
 className={`p-6 rounded-2xl border transition-colors ${
 darkMode
 ? "bg-[#1f2937] border-slate-700 text-slate-100"
 : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}
 >
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaCalendarAlt className="text-orange-500" /> Daily Seva Schedule
 </h2>
 <p
 className={`text-sm mt-1.5 ${
 darkMode ? "text-slate-300" : "text-slate-650"
 }`}
 >
 Check assigned daily duties, review instructions from temple administration, and verify required materials.
 </p>
 </div>

 {loading ? (
 <div className="flex flex-col items-center justify-center p-20 space-y-4">
 <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
 <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-500"} font-medium`}>
 Loading Seva schedule and inventory...
 </p>
 </div>
 ) : error ? (
 <div className="flex flex-col items-center justify-center p-20 space-y-4">
 <p className="text-rose-500 font-semibold text-center">{error}</p>
 <button
 onClick={fetchScheduleData}
 className="px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-bold hover:bg-orange-600 transition-colors"
 >
 Retry
 </button>
 </div>
 ) : (
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 
 {/* Seva Duties Timeline */}
 <div
 className={`lg:col-span-2 rounded-2xl p-6 border transition-colors ${
 darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}
 >
 <h3 className="font-extrabold text-lg mb-6 flex items-center gap-2">
 <span>🧭</span> Scheduled Rituals Sequence
 </h3>

 {schedule.length === 0 ? (
 <div className="p-10 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
 <span className="text-3xl block mb-2">📅</span>
 <p className="text-sm font-bold text-slate-400">No Seva Duties Assigned Today</p>
 </div>
 ) : (
 <div className="relative pl-6 border-l-2 border-orange-500/20 space-y-6 ml-3">
 {schedule.map((item) => (
 <div key={item.id} className="relative group">
 {/* Time dot indicator */}
 <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-orange-500 border-4 border-white dark:border-slate-900 group-hover:scale-125 transition-transform" />
 
 <div
 className={`p-4.5 rounded-xl border transition-colors ${
 darkMode ? "bg-slate-800/40 border-slate-700/60" : "bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-100/80"
 }`}
 >
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
 <p className={`font-extrabold text-base ${darkMode ? "text-slate-200" : "text-slate-850"}`}>
 {item.sevaName}
 </p>
 <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-650 dark:text-orange-400 bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-orange-950/30 px-2.5 py-1 rounded-full border border-orange-100/30">
 <FaClock size={10} /> {item.startTime} - {item.endTime}
 </span>
 </div>
 <p className={`text-sm ${darkMode ? "text-slate-350" : "text-slate-600"} mt-2.5 leading-relaxed`}>
 {item.description}
 </p>
 <div className="flex items-center gap-1.5 mt-3.5 text-xs font-bold text-slate-400">
 <FaMapMarkerAlt className="text-slate-450" /> Location: 
 <span className={darkMode ? "text-slate-300" : "text-slate-700"}>{item.location}</span>
 </div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Special Instructions & Material Inventory */}
 <div className="space-y-6">
 
 {/* Special Instructions */}
 <div
 className={`rounded-2xl p-6 border transition-colors ${
 darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}
 >
 <h3 className="font-extrabold text-base mb-4 flex items-center gap-2">
 <FaExclamationTriangle className="text-orange-500" /> Special Instructions
 </h3>
 
 {instructions.length === 0 ? (
 <p className="text-xs text-slate-450 font-semibold text-center py-4">No special instructions for today.</p>
 ) : (
 <div className="space-y-3">
 {instructions.map((inst) => (
 <div
 key={inst.id}
 className={`p-3.5 rounded-xl border flex flex-col gap-1 transition-all ${getPriorityColor(
 inst.priority
 )}`}
 >
 <div className="flex items-center justify-between">
 <span className="font-extrabold text-sm">{inst.title}</span>
 <span className="text-[10px] font-extrabold tracking-wide uppercase px-2 py-0.5 rounded bg-temple-100/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-black/20">
 {inst.priority}
 </span>
 </div>
 <p className="text-xs leading-relaxed opacity-90">{inst.description}</p>
 <span className="text-[10px] opacity-75 font-semibold mt-1">
 Posted: {inst.date}
 </span>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Material Checklist */}
 <div
 className={`rounded-2xl p-6 border transition-colors ${
 darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}
 >
 <h3 className="font-extrabold text-base mb-4 flex items-center gap-2">
 <FaBoxOpen className="text-orange-500" /> Material Checklist
 </h3>
 
 {checklist.length === 0 ? (
 <p className="text-xs text-slate-450 font-semibold text-center py-4">No checklist available.</p>
 ) : (
 <div className="space-y-3">
 {checklist.map((inv) => (
 <div
 key={inv.id}
 className="flex flex-col gap-2 p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/20"
 >
 <div className="flex justify-between items-center">
 <span className="font-extrabold text-sm text-slate-800 dark:text-slate-200 ">
 {inv.itemName}
 </span>
 <span
 className={`text-[9px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full border ${getInventoryStatusBadge(
 inv.status
 )}`}
 >
 {inv.status}
 </span>
 </div>
 
 <div className="flex justify-between text-xs font-semibold text-slate-500 border-t border-dashed border-slate-200 dark:border-slate-700 /60 pt-2">
 <span>Required: <b className="text-slate-850 dark:text-slate-350">{inv.requiredQuantity}</b></span>
 <span>Available: <b className={inv.status === "Out Of Stock" ? "text-rose-500" : "text-slate-800 dark:text-slate-350"}>{inv.availableQuantity}</b></span>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 </div>

 </div>
 )}
 </div>
 );
};

export default SevaSchedule;
