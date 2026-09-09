import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
 FaBell,
 FaCalendarCheck,
 FaCalendarAlt,
 FaClock,
 FaCheckCircle,
 FaHourglassHalf,
 FaUsers,
 FaPlus,
 FaEdit,
 FaClipboardList,
 FaBook,
 FaStar,
 FaCog,
 FaUser,
 FaSignOutAlt,
 FaSearch,
 FaMapMarkerAlt,
 FaPhoneAlt,
 FaEnvelope,
 FaLanguage,
 FaAward,
 FaBoxOpen,
} from "react-icons/fa";
import { MdTempleHindu, MdArrowForward, MdFestival } from "react-icons/md";
import { useAuth } from "../../context/AuthContext";
import PriestLayout from "../../layouts/PriestLayout";
import axios from "axios";
import "./PriestDashboard.css";
import {
 getPriestDashboard,
 updatePoojaStatus,
} from "../../services/priestService";
import MyDuties from "./MyDuties";
import PriestNotifications from "./PriestNotifications";
import PriestProfile from "./PriestProfile";
import PriestInventory from "./PriestInventory";
import Attendance from "../staff/Attendance";
import LeaveHistory from "../staff/LeaveHistory";
import LeaveRequest from "../staff/LeaveRequest";
import DutyTransferRequests from "./DutyTransferRequests";
import SevaSchedule from "./SevaSchedule";
import CompletedServices from "./CompletedServices";
import SpecialDuties from "./SpecialDuties";
import FestivalDuties from "./FestivalDuties";
import priestAvatar from "../../assets/logo.png";

const API_BASE = "http://localhost:5000/api";

const PriestDashboard = () => {
 const navigate = useNavigate();
 const location = useLocation();
 const { user } = useAuth();

 // State for dashboard data
 const [stats, setStats] = useState({
 todayPooja: 0,
 upcomingPooja: 0,
 completedToday: 0,
 pendingServices: 0,
 totalDevotees: 0,
 });

 const [todaySchedule, setTodaySchedule] = useState([]);
 const [upcomingPoojas, setUpcomingPoojas] = useState([]);
 const [completedServices, setCompletedServices] = useState([]);
 const [sevaDuties, setSevaDuties] = useState([]);
 const [announcements, setAnnouncements] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);

 const fetchDashboardData = async () => {
 try {
 setLoading(true);
 setError(null);
 const data = await getPriestDashboard();
 if (data) {
 if (data.stats) setStats(data.stats);
 if (data.todaySchedule) setTodaySchedule(data.todaySchedule);
 if (data.upcomingPoojas) setUpcomingPoojas(data.upcomingPoojas);
 if (data.completedServices) setCompletedServices(data.completedServices);
 if (data.sevaDuties) setSevaDuties(data.sevaDuties);
 if (data.announcements) setAnnouncements(data.announcements);
 }
 } catch (err) {
 console.error("Error fetching dashboard data:", err);
 setError("Failed to load dashboard data. Please try again.");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchDashboardData();
 }, []);

 const getStatusColor = (status) => {
 switch (status) {
 case "Completed":
 return "text-emerald-600 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-emerald-100";
 case "In Progress":
 return "text-amber-600 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-amber-100";
 case "Upcoming":
 return "text-blue-600 bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-blue-100";
 case "Pending":
 return "text-rose-600 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-rose-100";
 default:
 return "text-slate-500 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-100";
 }
 };

 const handleStatusChange = async (id, newStatus) => {
 try {
 await updatePoojaStatus(id, newStatus);
 await fetchDashboardData();
 } catch (err) {
 console.error("Error updating pooja status:", err);
 alert("Failed to update status. Please try again.");
 }
 };

 // 1. MAIN DASHBOARD VIEW
 const DashboardView = ({ darkMode }) => (
 <div className="space-y-6 fade-in">
 {/* Welcome Header */}
 <div className={`p-6 rounded-2xl border flex flex-col md:flex-row md:items-center md:justify-between transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}>
 <div>
 <h2 className="text-2xl md:text-3xl font-extrabold flex items-center gap-2">
 Welcome back, {user?.name || "Priest"}! 🙏
 </h2>
 <p className={`text-sm mt-1.5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 Here's your pooja schedule and duties for today.
 </p>
 </div>
 <div className={`mt-4 md:mt-0 px-4 py-2 rounded-xl text-sm font-semibold tracking-wide flex items-center gap-2 border ${darkMode ? "bg-slate-800 border-slate-700 text-orange-400" : "bg-[#fcfbf9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-orange-600"
 }`}>
 <span>📅</span> {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
 </div>
 </div>

 {/* Stats Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
 {[
 { icon: MdTempleHindu, label: "Today's Poojas", value: stats.todayPooja, color: "bg-purple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" },
 { icon: FaCalendarCheck, label: "Upcoming Poojas", value: stats.upcomingPooja, color: "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" },
 ].map((card, i) => (
 <div
 key={i}
 className={`rounded-2xl p-5 border transition-all duration-300 hover:shadow-md ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}
 >
 <div className="flex items-center gap-4">
 <div className={`p-3.5 rounded-xl shrink-0 ${card.color}`}>
 <card.icon size={22} />
 </div>
 <div className="min-w-0">
 <p className={`text-xs font-semibold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
 {card.label}
 </p>
 <p className={`text-2xl font-bold mt-1.5 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>
 {card.value}
 </p>
 </div>
 </div>
 <div className="mt-4 pt-3 border-t border-dashed border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs">
 <span className={darkMode ? "text-slate-400" : "text-slate-500"}>Live stats</span>
 <button
 onClick={() => {
 if (card.label.includes("Assigned") || card.label.includes("Today's")) navigate("/priest/my-duties");
 else if (card.label.includes("Upcoming")) navigate("/priest/my-duties");
 else if (card.label.includes("Completed")) navigate("/priest/completed-services");
 }}
 className="text-orange-500 font-bold hover:underline"
 >
 View Details
 </button>
 </div>
 </div>
 ))}
 </div>

 {/* Main Grid: Today's Schedule (spans 2), Upcoming Poojas (span 1) */}
 <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
 {/* Today's Schedule Table */}
 <div className={`rounded-2xl p-6 border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <div className="flex items-center justify-between mb-6">
 <h3 className={`text-lg font-bold flex items-center gap-2 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>
 <FaClock className="text-orange-500" /> Today's Schedule
 </h3>
 <button
 onClick={() => navigate("/priest/my-duties")}
 className="text-orange-500 text-xs font-bold hover:underline"
 >
 View Full Schedule →
 </button>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className={`border-b ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
 <th className={`text-left pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Time</th>
 <th className={`text-left pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Pooja / Service</th>
 <th className={`text-left pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Devotee</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
 {todaySchedule.slice(0, 8).map((item, index) => (
 <tr key={index} className="hover:bg-slate-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800/40">
 <td className={`py-3 px-1 font-medium ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{item.time}</td>
 <td className={`py-3 px-1 font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
 <div>{item.pooja}</div>
 {(item.templeArranged?.length > 0 || item.devoteeBrings?.length > 0) && (
 <div className="flex flex-col gap-0.5 mt-1">
 {item.templeArranged?.length > 0 && (
 <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-amber-200 px-1.5 py-0.5 rounded w-fit">
 Temple Arranged: {item.templeArranged.join(", ")}
 </span>
 )}
 {item.devoteeBrings?.length > 0 && (
 <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-emerald-200 px-1.5 py-0.5 rounded w-fit">
 Devotee Brings: {item.devoteeBrings.join(", ")}
 </span>
 )}
 </div>
 )}
 </td>
 <td className={`py-3 px-1 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{item.devotee}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 </div>

 {/* Row 4: Announcements */}
 <div className="grid grid-cols-1 gap-6">

 {/* Announcements */}
 <div className={`rounded-2xl p-6 border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <div className="flex items-center justify-between mb-5">
 <h3 className={`text-lg font-bold flex items-center gap-2 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>
 <FaBell className="text-sky-500" /> Announcements
 </h3>
 <button onClick={() => navigate("/priest/notifications")} className="text-sky-500 text-xs font-bold hover:underline">
 View All
 </button>
 </div>

 <div className="space-y-3.5">
 {announcements.map((item) => {
 const bgClass =
 item.type === "festival"
 ? "bg-amber-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-amber-100 text-amber-900 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400"
 : item.type === "event"
 ? "bg-blue-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-blue-100 text-blue-900 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-blue-400"
 : "bg-emerald-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-emerald-100 text-emerald-900 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-400";

 return (
 <div key={item.id} className={`p-4 rounded-xl border ${bgClass}`}>
 <div className="flex items-center justify-between">
 <p className="font-bold text-sm tracking-wide">{item.title}</p>
 <span className="text-[10px] opacity-75 font-semibold">{item.date}</span>
 </div>
 <p className="text-xs mt-2 leading-relaxed opacity-90">{item.description}</p>
 </div>
 );
 })}
 </div>
 </div>
 </div>
 </div>
 );

 // 2. ASSIGNED POOJAS VIEW
 const AssignedPoojasView = ({ darkMode }) => {
 const [filter, setFilter] = useState("All");
 const [searchQuery, setSearchQuery] = useState("");

 const filteredPoojas = todaySchedule.filter((pooja) => {
 const matchesFilter = filter === "All" || pooja.status === filter;
 const matchesSearch =
 pooja.pooja.toLowerCase().includes(searchQuery.toLowerCase()) ||
 pooja.devotee.toLowerCase().includes(searchQuery.toLowerCase());
 return matchesFilter && matchesSearch;
 });

 return (
 <div className="space-y-6 fade-in">
 <div className={`p-6 rounded-2xl border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}>
 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
 <div>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaClipboardList className="text-orange-500" /> Assigned Poojas & Sevas
 </h2>
 <p className={`text-sm mt-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 View and manage poojas assigned to you for today.
 </p>
 </div>

 {/* Search Input */}
 <div className={`relative px-4 py-2 border rounded-xl flex items-center gap-2 max-w-sm ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}>
 <FaSearch className="text-slate-400" />
 <input
 type="text"
 placeholder="Search pooja, devotee..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="bg-transparent outline-none text-sm w-full"
 />
 </div>
 </div>

 {/* Filters */}
 <div className="flex flex-wrap gap-2 mt-6">
 {["All", "Upcoming", "In Progress", "Completed", "Pending"].map((status) => (
 <button
 key={status}
 onClick={() => setFilter(status)}
 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${filter === status
 ? "bg-orange-500 text-white shadow-md"
 : darkMode
 ? "bg-slate-800 text-slate-300 hover:bg-slate-750"
 : "bg-slate-100 text-slate-700 hover:bg-slate-200"
 }`}
 >
 {status}
 </button>
 ))}
 </div>
 </div>

 {/* Assigned Poojas Table */}
 <div className={`rounded-2xl p-6 border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className={`border-b ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
 <th className={`text-left pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Time</th>
 <th className={`text-left pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Pooja Name</th>
 <th className={`text-left pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Devotee</th>
 <th className={`text-center pb-3 font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
 {filteredPoojas.length > 0 ? (
 filteredPoojas.map((pooja) => (
 <tr key={pooja.id} className="hover:bg-slate-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800/40">
 <td className={`py-4 px-2 font-medium ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{pooja.time}</td>
 <td className={`py-4 px-2 font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
 <div>{pooja.pooja}</div>
 {(pooja.templeArranged?.length > 0 || pooja.devoteeBrings?.length > 0) && (
 <div className="flex flex-col gap-1 mt-1.5">
 {pooja.templeArranged?.length > 0 && (
 <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-amber-200 px-2 py-0.5 rounded w-fit">
 Temple Arranged: {pooja.templeArranged.join(", ")}
 </span>
 )}
 {pooja.devoteeBrings?.length > 0 && (
 <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-emerald-200 px-2 py-0.5 rounded w-fit">
 Devotee Brings: {pooja.devoteeBrings.join(", ")}
 </span>
 )}
 </div>
 )}
 </td>
 <td className={`py-4 px-2 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{pooja.devotee}</td>
 <td className="py-4 px-2">
 <div className="flex items-center justify-center gap-2">
 <button
 onClick={() => navigate("/priest/my-duties")}
 className="px-3 py-1 rounded-lg text-xs font-semibold bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-purple-600 dark:bg-purple-950/20 dark:text-purple-400 hover:bg-purple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors border border-purple-100 dark:border-purple-900/30"
 >
 Assign to other priest
 </button>
 {pooja.status !== "Completed" && (
 <button
 onClick={async () => {
 try {
 const { updatePoojaStatus } = await import("../../services/priestService");
 await updatePoojaStatus(pooja.id, "Completed");
 window.location.reload();
 } catch (err) {
 alert("Failed to complete pooja");
 }
 }}
 className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 hover:bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors border border-emerald-100 dark:border-emerald-900/30"
 >
 ✓ Mark Complete
 </button>
 )}
 </div>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="4" className="py-8 text-center font-medium text-slate-400">
 No poojas found matching search.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
 };

 // 3. SEVA SCHEDULE VIEW
 const SevaScheduleView = ({ darkMode }) => (
 <div className="space-y-6 fade-in">
 <div className={`p-6 rounded-2xl border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaCalendarAlt className="text-orange-500" /> Daily Seva Schedule
 </h2>
 <p className={`text-sm mt-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 Follow the structural timeline for daily seva rituals in the mandir.
 </p>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 {/* Timeline Flow */}
 <div className={`lg:col-span-2 rounded-2xl p-6 border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
 🧭 Ritual Sequence
 </h3>

 <div className="relative pl-6 border-l-2 border-orange-500/20 space-y-6 ml-3">
 {sevaDuties.map((duty, idx) => (
 <div key={duty.id} className="relative group">
 {/* Dot */}
 <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-orange-500 border-4 border-white dark:border-slate-900 group-hover:scale-125 transition-transform" />

 <div className={`p-4 rounded-xl border ${darkMode ? "bg-slate-850 border-slate-700" : "bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-100"
 }`}>
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
 <p className={`font-extrabold text-base ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{duty.duty}</p>
 <span className="text-xs font-bold text-orange-600 dark:text-orange-400">{duty.time}</span>
 </div>
 <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"} mt-2`}>{duty.description}</p>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Special Instructions & Items Needed */}
 <div className="space-y-6">
 <div className={`rounded-2xl p-6 border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <h4 className="font-bold text-base mb-4">🔔 Special Instructions</h4>
 <ul className="space-y-3 text-sm list-disc pl-4 text-slate-600 dark:text-slate-300 leading-relaxed">
 <li>Ensure fresh flowers are sourced by 05:00 AM.</li>
 <li>Pure cow ghee must be used for deeparadhana.</li>
 <li>Panchamrutham quantities must match devotee count.</li>
 <li>Dress code: Traditional white dhoti and shawl.</li>
 </ul>
 </div>

 <div className={`rounded-2xl p-6 border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <h4 className="font-bold text-base mb-4">📦 Material inventory Checklist</h4>
 <div className="space-y-2.5 text-sm">
 {[
 { item: "Camphor (Karpur)", status: "Available" },
 { item: "Incense sticks (Agarbatti)", status: "Low Stock" },
 { item: "Coconut & Betel leaves", status: "Available" },
 { item: "Sandalwood paste (Chandan)", status: "Available" },
 { item: "Sacred thread (Janeu)", status: "Reorder Required" },
 ].map((inv, idx) => (
 <div key={idx} className="flex justify-between items-center py-1.5 border-b border-dashed border-slate-100 dark:border-slate-800">
 <span className={`font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{inv.item}</span>
 <span className={`text-xs font-bold ${inv.status === "Available"
 ? "text-emerald-600"
 : inv.status === "Low Stock"
 ? "text-amber-500"
 : "text-rose-500"
 }`}>{inv.status}</span>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 </div>
 );

 // 4. COMPLETED SERVICES VIEW — fully connected to API
 const CompletedServicesView = ({ darkMode }) => {
 const [data, setData] = useState([]);
 const [stats, setStats] = useState({ completedToday: 0, completedThisWeek: 0, completedThisMonth: 0, avgDuration: "0m" });
 const [loading, setLoading] = useState(true);
 const [fetchError, setFetchError] = useState("");
 const [search, setSearch] = useState("");
 const [filter, setFilter] = useState("all");
 const [sort, setSort] = useState("latest");
 const [startDate, setStartDate] = useState("");
 const [endDate, setEndDate] = useState("");
 const [page, setPage] = useState(1);
 const PAGE_SIZE = 10;

 const fetchCompleted = async () => {
 try {
 setLoading(true);
 setFetchError("");
 const token = localStorage.getItem("token");
 const params = new URLSearchParams({ sort });
 if (search.trim()) params.append("search", search.trim());
 if (filter !== "all") params.append("filter", filter);
 if (filter === "custom" && startDate && endDate) {
 params.append("startDate", startDate);
 params.append("endDate", endDate);
 }
 const res = await axios.get(`${API_BASE}/priest/completed-services?${params}`, {
 headers: { Authorization: `Bearer ${token}` },
 });
 setData(res.data.services || []);
 if (res.data.stats) setStats(res.data.stats);
 } catch (err) {
 setFetchError(err.response?.data?.message || "Failed to load completed services.");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchCompleted();
 setPage(1);
 }, [filter, sort, startDate, endDate]);

 const handleSearch = (e) => {
 e.preventDefault();
 fetchCompleted();
 setPage(1);
 };

 const totalPages = Math.ceil(data.length / PAGE_SIZE);
 const paged = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

 const getPageNumbers = () => {
 const pages = [];
 if (totalPages <= 7) {
 for (let i = 1; i <= totalPages; i++) {
 pages.push(i);
 }
 } else {
 if (page <= 4) {
 pages.push(1, 2, 3, 4, 5, '...', totalPages);
 } else if (page >= totalPages - 3) {
 pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
 } else {
 pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
 }
 }
 return pages;
 };

 const card = darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]";
 const txt = darkMode ? "text-slate-100" : "text-[#1d1b19]";
 const sub = darkMode ? "text-slate-400" : "text-slate-500";
 const row = darkMode ? "hover:bg-slate-800/40 border-slate-700" : "hover:bg-slate-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-100";
 const inp = darkMode ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-200 text-slate-800";

 const FILTERS = [
 { id: "all", label: "All Time" },
 { id: "today", label: "Today" },
 { id: "week", label: "This Week" },
 { id: "month", label: "This Month" },
 { id: "custom", label: "Custom Range" },
 ];

 const statCards = [
 { label: "Completed Today", value: stats.completedToday, color: "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-emerald-100 text-emerald-700", icon: "✅" },
 { label: "Completed This Week", value: stats.completedThisWeek, color: "bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-blue-100 text-blue-700", icon: "📅" },
 { label: "Completed This Month", value: stats.completedThisMonth, color: "bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-purple-100 text-purple-700", icon: "🗓️" },
 { label: "Avg Completion Time", value: stats.avgDuration, color: "bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-amber-100 text-amber-700", icon: "⏱️" },
 ];

 return (
 <div className="space-y-6 fade-in">

 {/* ── Header ── */}
 <div className={`p-6 rounded-2xl border transition-colors ${card} ${txt}`}>
 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
 <div>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaCheckCircle className="text-emerald-500" /> Completed Services
 </h2>
 <p className={`text-sm mt-1 ${sub}`}>
 Historical log of all pooja and seva bookings completed by you.
 </p>
 </div>
 <button
 onClick={fetchCompleted}
 className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 transition-colors shrink-0"
 >
 🔄 Refresh
 </button>
 </div>
 </div>

 {/* ── Stats Cards ── */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
 {statCards.map((s) => (
 <div key={s.label} className={`rounded-2xl border p-5 ${card}`}>
 <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border text-xl mb-3 ${s.color}`}>
 {s.icon}
 </div>
 <p className={`text-2xl font-extrabold ${txt}`}>{s.value}</p>
 <p className={`text-xs font-semibold mt-1 ${sub}`}>{s.label}</p>
 </div>
 ))}
 </div>

 {/* ── Search + Filters + Sort ── */}
 <div className={`rounded-2xl border p-5 ${card} space-y-4`}>
 {/* Search */}
 <form onSubmit={handleSearch} className="flex gap-2">
 <div className={`flex-1 flex items-center gap-2 px-4 py-2 rounded-xl border ${inp}`}>
 <FaSearch className="text-slate-400 shrink-0" />
 <input
 type="text"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Search by Booking ID, Devotee Name, or Pooja Name…"
 className="bg-transparent outline-none text-sm w-full"
 />
 </div>
 <button
 type="submit"
 className="px-5 py-2 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition-colors"
 >
 Search
 </button>
 </form>

 {/* Filter buttons */}
 <div className="flex flex-wrap items-center gap-2">
 <span className={`text-xs font-semibold ${sub} mr-1`}>Filter:</span>
 {FILTERS.map((f) => (
 <button
 key={f.id}
 onClick={() => { setFilter(f.id); setPage(1); }}
 className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${filter === f.id
 ? "bg-orange-500 text-white shadow-sm"
 : darkMode
 ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
 : "bg-slate-100 text-slate-600 hover:bg-slate-200"
 }`}
 >
 {f.label}
 </button>
 ))}

 {/* Sort toggle */}
 <div className="ml-auto flex items-center gap-2">
 <span className={`text-xs font-semibold ${sub}`}>Sort:</span>
 <button
 onClick={() => setSort(sort === "latest" ? "oldest" : "latest")}
 className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-200 text-slate-700"
 }`}
 >
 {sort === "latest" ? "⬇️ Latest First" : "⬆️ Oldest First"}
 </button>
 </div>
 </div>

 {/* Custom date range */}
 {filter === "custom" && (
 <div className="flex flex-wrap gap-3 items-center pt-1">
 <div className="flex items-center gap-2">
 <label className={`text-xs font-semibold ${sub}`}>From:</label>
 <input
 type="date"
 value={startDate}
 onChange={(e) => setStartDate(e.target.value)}
 className={`text-sm rounded-xl border px-3 py-1.5 outline-none ${inp}`}
 />
 </div>
 <div className="flex items-center gap-2">
 <label className={`text-xs font-semibold ${sub}`}>To:</label>
 <input
 type="date"
 value={endDate}
 onChange={(e) => setEndDate(e.target.value)}
 className={`text-sm rounded-xl border px-3 py-1.5 outline-none ${inp}`}
 />
 </div>
 </div>
 )}
 </div>

 {/* ── Table ── */}
 <div className={`rounded-2xl border transition-colors ${card}`}>
 {loading ? (
 <div className="flex flex-col items-center justify-center py-16 gap-3">
 <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
 <p className={`text-sm ${sub}`}>Loading completed services…</p>
 </div>
 ) : fetchError ? (
 <div className="flex flex-col items-center justify-center py-16 gap-3">
 <p className="text-rose-500 font-semibold text-sm">{fetchError}</p>
 <button
 onClick={fetchCompleted}
 className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600"
 >
 Retry
 </button>
 </div>
 ) : data.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 gap-2">
 <span className="text-5xl">🏛️</span>
 <p className={`font-bold ${txt}`}>No completed services found</p>
 <p className={`text-sm ${sub}`}>Try adjusting your search or filter.</p>
 </div>
 ) : (
 <>
 <div className="overflow-x-auto">
 <table className="w-full text-sm min-w-[900px]">
 <thead>
 <tr className={`border-b ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "}`}>
 {["Booking ID", "Date", "Pooja Name", "Devotee Name", "Mobile", "Started At", "Completed At", "Duration", "Status"].map((h) => (
 <th key={h} className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${sub}`}>
 {h}
 </th>
 ))}
 </tr>
 </thead>
 <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
 {paged.map((item) => (
 <tr key={String(item.bookingId)} className={`transition-colors ${row}`}>
 <td className={`px-4 py-3.5 font-mono text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 #{String(item.bookingId).slice(-6).toUpperCase()}
 </td>
 <td className={`px-4 py-3.5 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{item.date}</td>
 <td className={`px-4 py-3.5 font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{item.poojaName}</td>
 <td className={`px-4 py-3.5 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{item.devoteeName}</td>
 <td className={`px-4 py-3.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{item.devoteeMobile}</td>
 <td className={`px-4 py-3.5 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{item.startedAt}</td>
 <td className={`px-4 py-3.5 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{item.completedAt}</td>
 <td className="px-4 py-3.5">
 <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-700 border border-blue-100">
 {item.duration}
 </span>
 </td>
 <td className="px-4 py-3.5">
 <span className="px-2.5 py-1 rounded-full text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-emerald-100">
 ✓ Completed
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 {/* ── Pagination ── */}
 {totalPages > 1 && (
 <div className={`flex items-center justify-between px-5 py-4 border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
 <p className={`text-xs ${sub}`}>
 Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.length)} of {data.length} records
 </p>
 <div className="flex gap-1">
 <button
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 disabled={page === 1}
 className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 ← Prev
 </button>
 {getPageNumbers().map((p, index) => (
 <button
 key={index}
 onClick={() => typeof p === 'number' && setPage(p)}
 disabled={p === '...'}
 className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${p === page
 ? "bg-orange-500 text-white"
 : p === '...'
 ? "text-slate-400 cursor-default"
 : darkMode
 ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
 : "bg-slate-100 text-slate-600 hover:bg-slate-200"
 }`}
 >
 {p}
 </button>
 ))}
 <button
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 disabled={page === totalPages}
 className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 Next →
 </button>
 </div>
 </div>
 )}
 </>
 )}
 </div>
 </div>
 );
 };


 // 5. SPECIAL DUTIES VIEW
 const SpecialDutiesView = ({ darkMode }) => (
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 fade-in">
 <div className={`lg:col-span-2 rounded-2xl p-6 border transition-colors space-y-5 ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <div>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaStar className="text-yellow-500 animate-pulse" /> Special Duty Requests
 </h2>
 <p className={`text-sm mt-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 One-off special assignments requested by the admin or VIP devotees.
 </p>
 </div>

 <div className="space-y-4 pt-2">
 {[
 { id: 1, title: "VIP Rudrabhishekam Alankaram", desc: "Decorate the sanctum sanctorum with imported orchid garland and lotuses for a ministerial family visit.", date: "16 May 2025, 08:00 AM", reward: "Special honorarium", state: "Accepted" },
 { id: 2, title: "Sahasra Kalashabhishekam Assistance", desc: "Oversee coordination and installation of 1000 holy water kalashas alongside lead priests.", date: "18 May 2025, 06:00 AM", reward: "Temple legacy scroll", state: "Pending Approval" },
 ].map((duty) => (
 <div key={duty.id} className={`p-4 rounded-xl border flex flex-col justify-between ${darkMode ? "bg-slate-800/50 border-slate-700" : "bg-[#fcfbf9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-200/80"
 }`}>
 <div className="flex justify-between items-start gap-4">
 <div>
 <h4 className="font-extrabold text-base tracking-wide text-orange-600 dark:text-orange-400">{duty.title}</h4>
 <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"} mt-1`}>🕒 {duty.date}</p>
 <p className={`text-sm mt-3 leading-relaxed ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{duty.desc}</p>
 </div>
 <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${duty.state === "Accepted"
 ? "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-600 border border-emerald-100"
 : "bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-600 border border-amber-100"
 }`}>{duty.state}</span>
 </div>
 <div className="mt-5 pt-3.5 border-t border-dashed border-slate-200 dark:border-slate-700 flex justify-between items-center">
 <span className={`text-xs font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Compensation: <b className="text-orange-500">{duty.reward}</b></span>
 {duty.state !== "Accepted" && (
 <button className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-orange-500 text-white hover:bg-orange-600 transition-colors">
 Accept Duty
 </button>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Special Duties Note */}
 <div className={`rounded-2xl p-6 border transition-colors space-y-4 ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}>
 <h4 className="font-bold text-lg border-b pb-2">Duty Regulations</h4>
 <p className={`text-sm leading-relaxed ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 Special duties require formal acceptance at least 24 hours prior. In case of emergency leaves, please request a proxy replacement via the admin panel.
 </p>
 <div className="p-3 rounded-lg bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-orange-950/20 text-xs border border-orange-100/60 dark:border-orange-900/30 text-orange-800 dark:text-orange-300">
 ⚠️ <b>Note:</b> Extra shift hours will be compiled and appended to the monthly payroll invoice dynamically.
 </div>
 </div>
 </div>
 );

 // 6. FESTIVAL DUTIES VIEW
 const FestivalDutiesView = ({ darkMode }) => (
 <div className="space-y-6 fade-in">
 <div className={`p-6 rounded-2xl border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <MdFestival className="text-orange-500" /> Festival Duty Schedule (2025)
 </h2>
 <p className={`text-sm mt-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 Upcoming major festivals and rituals requiring priest coordination and service.
 </p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 {[
 { festival: "Vaikunta Ekadasi", date: "Jan 11, 2025", duty: "Uttara Dwara Pooja", description: "Decorating Uttara Dwara with flower arch and guiding devotees through Vaikunta Dwaram starting 04:00 AM." },
 { festival: "Maha Shivaratri", date: "Feb 26, 2025", duty: "Linga Udhbhava Abhishekam", description: "Conducting Maha Lingabhishekam at midnight with milk, honey, sugarcane juice, and holy water." },
 { festival: "Sri Rama Navami", date: "Apr 06, 2025", duty: "Sita Rama Kalyanam", description: "Performing celestial marriage ritual of Lord Rama and Goddess Sita in the main mandapa." },
 ].map((fest, idx) => (
 <div
 key={idx}
 className={`rounded-2xl p-5 border flex flex-col justify-between transition-all duration-300 hover:shadow-md ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}
 >
 <div>
 <div className="flex items-center justify-between">
 <span className="text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-orange-900/20 px-2.5 py-1 rounded-full">{fest.date}</span>
 <span className="text-sm">🚩</span>
 </div>
 <h3 className={`text-lg font-bold mt-3.5 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>{fest.festival}</h3>
 <h4 className="text-sm text-slate-500 font-semibold mt-1">Role: <span className="text-slate-700 dark:text-slate-300">{fest.duty}</span></h4>
 <p className={`text-xs mt-3 leading-relaxed ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{fest.description}</p>
 </div>
 <div className="mt-5 pt-3 border-t border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-between">
 <span className="text-xs text-slate-400">Festival Committee Duty</span>
 <button className="text-orange-500 text-xs font-bold hover:underline">Guidelines</button>
 </div>
 </div>
 ))}
 </div>
 </div>
 );

 // 7. NOTIFICATIONS VIEW
 const NotificationsView = ({ darkMode }) => (
 <div className="space-y-6 fade-in">
 <div className={`p-6 rounded-2xl border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaBell className="text-orange-500 animate-swing" /> Announcements & Notifications
 </h2>
 <p className={`text-sm mt-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 Stay updated with official temple declarations, system alerts, and pooja updates.
 </p>
 </div>

 <div className={`rounded-2xl p-6 border transition-colors space-y-4 ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 {announcements.map((note) => (
 <div
 key={note.id}
 className={`p-4 rounded-xl border flex items-start gap-4 transition-transform hover:-translate-x-1 ${darkMode ? "bg-slate-800/40 border-slate-700" : "bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-100"
 }`}
 >
 <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400 flex items-center justify-center shrink-0">
 <FaBell size={18} />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between">
 <h4 className="font-bold text-sm sm:text-base">{note.title}</h4>
 <span className="text-xs text-slate-400">{note.date}</span>
 </div>
 <p className={`text-xs sm:text-sm mt-2 leading-relaxed ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{note.description}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 );

 // 8. PROFILE VIEW
 const ProfileView = ({ darkMode }) => (
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 fade-in">
 {/* Profile summary card */}
 <div className={`rounded-2xl p-6 border transition-colors flex flex-col items-center text-center ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"
 }`}>
 <img
 src={user?.photo || priestAvatar}
 alt="Priest Avatar"
 className="w-28 h-28 rounded-2xl object-cover border-4 border-orange-500 shadow-md"
 onError={(e) => {
 e.currentTarget.src = priestAvatar;
 }}
 />
 <h3 className="text-xl font-bold mt-4">{user?.name || "Sri Ramakrishna Shastri"}</h3>
 <p className="text-sm text-orange-500 font-semibold mt-1">{user?.role === "priest" ? "Chief Priest (Archaka)" : user?.role || "Priest"}</p>

 <div className="w-full mt-6 space-y-3.5 text-sm">
 <div className="flex items-center gap-3 py-2 border-b border-dashed border-slate-100 dark:border-slate-800 text-left">
 <FaPhoneAlt className="text-orange-500 shrink-0" />
 <span className={darkMode ? "text-slate-300" : "text-slate-600"}>{user?.phone || "+91 98765 43210"}</span>
 </div>
 <div className="flex items-center gap-3 py-2 border-b border-dashed border-slate-100 dark:border-slate-800 text-left">
 <FaEnvelope className="text-orange-500 shrink-0" />
 <span className={darkMode ? "text-slate-300" : "text-slate-600"}>{user?.email || "r.shastri@mandirtemple.org"}</span>
 </div>
 <div className="flex items-center gap-3 py-2 border-b border-dashed border-slate-100 dark:border-slate-800 text-left">
 <FaMapMarkerAlt className="text-orange-500 shrink-0" />
 <span className={darkMode ? "text-slate-300" : "text-slate-600"}>{user?.address || "Quarter No. 4, Mandir Quarters, Devagiri"}</span>
 </div>
 </div>
 </div>

 {/* Professional Details & Qualifications */}
 <div className={`lg:col-span-2 rounded-2xl p-6 border transition-colors space-y-6 ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"
 }`}>
 <div>
 <h3 className="text-lg font-bold border-b pb-2 flex items-center gap-2">
 <FaAward className="text-orange-500" /> Professional Credentials & Expertise
 </h3>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4">
 <div>
 <h4 className="font-semibold text-sm text-slate-400">Veda Shakha</h4>
 <p className="text-sm font-bold mt-1 text-slate-800 dark:text-slate-200 ">Krishna Yajurveda (Taittiriya Samhita)</p>
 </div>
 <div>
 <h4 className="font-semibold text-sm text-slate-400">Experience</h4>
 <p className="text-sm font-bold mt-1 text-slate-800 dark:text-slate-200 ">18+ Years in Smartha Agama Shastra</p>
 </div>
 <div>
 <h4 className="font-semibold text-sm text-slate-400">Pooja Specializations</h4>
 <div className="flex flex-wrap gap-1.5 mt-1.5">
 {["Rudrabhishekam", "Chandi Homa", "Sudarshana Homam", "Kalyanotsavam", "Vastu Pooja"].map((spec, i) => (
 <span key={i} className="text-xs bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 font-bold px-2 py-0.5 rounded-md border border-orange-100 dark:border-orange-900/30">
 {spec}
 </span>
 ))}
 </div>
 </div>
 <div>
 <h4 className="font-semibold text-sm text-slate-400">Languages Spoken</h4>
 <p className="text-sm font-bold mt-1 text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
 <FaLanguage className="text-orange-500 text-base" /> Sanskrit, Telugu, Kannada, Hindi, English
 </p>
 </div>
 </div>
 </div>

 <div>
 <h3 className="text-lg font-bold border-b pb-2">Mandir Tenure Info</h3>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 text-sm">
 <div className="p-3 bg-slate-50/50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-850 text-center">
 <p className="text-slate-400 font-semibold text-xs">Date of Joining</p>
 <p className="font-bold mt-1">12 Feb 2012</p>
 </div>
 <div className="p-3 bg-slate-50/50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-850 text-center">
 <p className="text-slate-400 font-semibold text-xs">Monthly Shifts</p>
 <p className="font-bold mt-1">Morning & Evening</p>
 </div>
 <div className="p-3 bg-slate-50/50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-850 text-center">
 <p className="text-slate-400 font-semibold text-xs">Agama Certification</p>
 <p className="font-bold mt-1 text-emerald-600">Grade A-1</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );

 if (loading) {
 return (
 <PriestLayout>
 {({ darkMode }) => (
 <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
 <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
 <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Loading dashboard data...</p>
 </div>
 )}
 </PriestLayout>
 );
 }

 if (error) {
 return (
 <PriestLayout>
 {({ darkMode }) => (
 <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
 <p className="text-rose-500 font-semibold">{error}</p>
 <button
 onClick={fetchDashboardData}
 className="px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-bold shadow hover:bg-orange-600 transition-colors"
 >
 Retry
 </button>
 </div>
 )}
 </PriestLayout>
 );
 }

 return (
 <PriestLayout>
 {({ activeItem, setActiveItem, darkMode }) => {
 switch (activeItem) {
 case "Dashboard":
 return <DashboardView darkMode={darkMode} />;
 case "My Duties":
 return <MyDuties darkMode={darkMode} />;
 case "Inventory Requests":
 return <PriestInventory darkMode={darkMode} />;
 case "Attendance":
 return <Attendance darkMode={darkMode} />;
 case "Leave Requests":
 return <LeaveHistory darkMode={darkMode} onApply={() => setActiveItem("Apply Leave")} />;
 case "Apply Leave":
 return <LeaveRequest darkMode={darkMode} onBack={() => setActiveItem("Leave Requests")} />;
 case "Duty Transfer Requests":
 return <DutyTransferRequests darkMode={darkMode} />;
 case "Notifications":
 return <PriestNotifications darkMode={darkMode} />;
 case "Profile":
 return <PriestProfile darkMode={darkMode} />;
 case "Seva Schedule":
 return <SevaSchedule darkMode={darkMode} />;
 case "Completed Services":
 return <CompletedServices darkMode={darkMode} />;
 case "Special Duties":
 return <SpecialDuties darkMode={darkMode} />;
 case "Festival Duties":
 return <FestivalDuties darkMode={darkMode} />;
 default:
 return <DashboardView darkMode={darkMode} />;
 }
 }}
 </PriestLayout>
 );
};

export default PriestDashboard;
