import { useState, useEffect } from "react";
import axios from "axios";
import {
 FaClipboardList,
 FaSpinner,
 FaCheck,
 FaExchangeAlt,
 FaTimes,
 FaCalendarDay,
 FaUserClock,
 FaMapMarkerAlt,
 FaCheckCircle,
 FaExclamationCircle,
 FaSearch,
 FaHourglassHalf,
 FaPlay,
 FaInfoCircle,
 FaPhoneAlt,
 FaCalendarAlt,
 FaEnvelope,
} from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import {
 getAssignedPoojas,
 startPooja,
 completePooja,
 putPoojaPending,
 getAvailablePriests,
} from "../../services/priestService";

const API_BASE = "http://localhost:5000/api";

const MyDuties = ({ darkMode }) => {
 const { user } = useAuth();
 const [activeTab, setActiveTab] = useState("schedule"); // "schedule", "poojas"
 
 // --- STATE FOR MY DUTIES (SCHEDULE & TRANSFERS) ---
 const [duties, setDuties] = useState([]);
 const [priests, setPriests] = useState([]);
 const [dutiesLoading, setDutiesLoading] = useState(true);
 const [incomingTransfers, setIncomingTransfers] = useState([]);
 const [showTransferModal, setShowTransferModal] = useState(false);
 const [selectedDuty, setSelectedDuty] = useState(null);
 const [transferForm, setTransferForm] = useState({
 requestedPriestId: "",
 reason: "",
 remarks: "",
 });
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [notification, setNotification] = useState({ show: false, message: "", type: "success" });

 // --- STATE FOR ASSIGNED POOJAS ---
 const [poojas, setPoojas] = useState([]);
 const [poojasLoading, setPoojasLoading] = useState(true);
 const [poojasError, setPoojasError] = useState(null);
 const [searchQuery, setSearchQuery] = useState("");
 const [filterStatus, setFilterStatus] = useState("All");
 
 // Pending Modal state for Poojas
 const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
 const [selectedPoojaId, setSelectedPoojaId] = useState(null);
 const [pendingReason, setPendingReason] = useState("");
 const [pendingModalError, setPendingModalError] = useState("");

 const showNotification = (message, type = "success") => {
 setNotification({ show: true, message, type });
 setTimeout(() => setNotification({ show: false, message: "", type: "success" }), 4000);
 };

 // --- FETCH FUNCTIONS FOR MY DUTIES ---
 const fetchDuties = async () => {
 try {
 setDutiesLoading(true);
 const res = await axios.get(`${API_BASE}/priest/my-duties`, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setDuties(res.data);
 } catch (error) {
 console.error("Error fetching duties:", error);
 } finally {
 setDutiesLoading(false);
 }
 };

 const fetchIncomingTransfers = async () => {
 try {
 const res = await axios.get(`${API_BASE}/priest/my-duties/incoming-transfers`, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setIncomingTransfers(res.data);
 } catch (error) {
 console.error("Error fetching incoming transfers:", error);
 }
 };

 const fetchPriests = async () => {
 try {
 const res = await axios.get(`${API_BASE}/priest/priests-list`, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setPriests(res.data);
 } catch (error) {
 console.error("Error fetching priests:", error);
 }
 };

 // --- FETCH FUNCTIONS FOR POOJAS ---
 const fetchPoojas = async () => {
 try {
 setPoojasLoading(true);
 setPoojasError(null);
 const data = await getAssignedPoojas(filterStatus, searchQuery);
 setPoojas(data || []);
 } catch (err) {
 console.error("Error fetching assigned poojas:", err);
 setPoojasError("Failed to fetch assigned poojas. Please try again.");
 } finally {
 setPoojasLoading(false);
 }
 };

 // UseEffects
 useEffect(() => {
 fetchDuties();
 fetchPriests();
 fetchIncomingTransfers();
 }, []);

 useEffect(() => {
 const delayDebounceFn = setTimeout(() => {
 fetchPoojas();
 }, 300);
 return () => clearTimeout(delayDebounceFn);
 }, [filterStatus, searchQuery]);

 // --- HANDLERS FOR DUTIES & TRANSFERS ---
 const handleRespondTransfer = async (transferId, status) => {
 try {
 await axios.post(`${API_BASE}/priest/my-duties/transfer/${transferId}/respond`, { status }, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 showNotification(`Transfer request ${status.toLowerCase()} successfully.`);
 fetchIncomingTransfers();
 fetchDuties();
 } catch (error) {
 showNotification(error.response?.data?.message || "Failed to respond", "error");
 }
 };

 const submitTransfer = async (e) => {
 e.preventDefault();
 if (!transferForm.requestedPriestId || !transferForm.reason) {
 return showNotification("Please fill all required fields.", "error");
 }
 // Check 5 hours on frontend for good UX
 let dutyDateStr = selectedDuty.rawDate;
 if (selectedDuty.referenceType === "DefaultDuty" && transferForm.targetDate) {
 // Parse time to check 5-hour rule accurately
 const timeStr = selectedDuty.time || "09:00 AM";
 const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
 let hours = 9, minutes = 0;
 if (match) {
 hours = parseInt(match[1], 10);
 minutes = parseInt(match[2], 10);
 if (match[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
 if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
 }
 
 const d = new Date(transferForm.targetDate);
 d.setHours(hours, minutes, 0, 0);
 dutyDateStr = d.toISOString();
 }
 
 const dutyDate = new Date(dutyDateStr);
 if (!isNaN(dutyDate.getTime())) {
 const fiveHoursBefore = new Date(dutyDate.getTime() - (5 * 60 * 60 * 1000));
 if (new Date() > fiveHoursBefore) {
 return showNotification("Transfers must be requested at least 5 hours in advance.", "error");
 }
 }

 try {
 setIsSubmitting(true);
 const res = await axios.post(`${API_BASE}/priest/my-duties/transfer`, {
 referenceType: selectedDuty.referenceType,
 referenceId: selectedDuty.id,
 dateStr: dutyDateStr,
 ...transferForm
 }, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 if (res.data.warning) {
 showNotification(res.data.warning, "warning"); 
 } else {
 showNotification("Transfer request submitted successfully.");
 }
 setShowTransferModal(false);
 fetchDuties();
 } catch (error) {
 showNotification(error.response?.data?.message || "Failed to request transfer", "error");
 } finally {
 setIsSubmitting(false);
 }
 };

 const fetchAvailablePriestsForDate = async (dateStr, timeStr) => {
 try {
 const available = await getAvailablePriests(dateStr, timeStr);
 setPriests(available);
 } catch (error) {
 console.error("Failed to load available priests", error);
 showNotification("Could not load available priests", "warning");
 }
 };

 const openTransferModal = async (duty) => {
 setSelectedDuty(duty);
 const defaultDate = duty.rawDate ? new Date(duty.rawDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
 setTransferForm({ requestedPriestId: "", reason: "", remarks: "", targetDate: defaultDate });
 setShowTransferModal(true);
 
 fetchAvailablePriestsForDate(defaultDate, duty.time || "06:00 AM");
 };

 const isTransferable = (duty) => {
 if (duty.referenceType === "DefaultDuty") return true; // Can transfer for any future date
 if (!duty.rawDate) return true;
 
 let dutyDate = new Date(duty.rawDate);
 if (isNaN(dutyDate.getTime())) return true;
 
 const fiveHoursBefore = new Date(dutyDate.getTime() - (5 * 60 * 60 * 1000));
 return new Date() < fiveHoursBefore;
 };

 // --- HANDLERS FOR POOJAS ---
 const handleStartPooja = async (id) => {
 try {
 await startPooja(id);
 fetchPoojas();
 } catch (err) {
 console.error("Error starting pooja:", err);
 alert("Failed to start pooja. Please try again.");
 }
 };

 const handleCompletePooja = async (id) => {
 try {
 await completePooja(id);
 fetchPoojas();
 } catch (err) {
 console.error("Error completing pooja:", err);
 alert("Failed to complete pooja. Please try again.");
 }
 };

 const openPendingModal = (id) => {
 setSelectedPoojaId(id);
 setPendingReason("");
 setPendingModalError("");
 setIsPendingModalOpen(true);
 };

 const handlePendingSubmit = async (e) => {
 e.preventDefault();
 if (!pendingReason.trim()) {
 setPendingModalError("Reason is mandatory to mark as pending.");
 return;
 }
 try {
 await putPoojaPending(selectedPoojaId, pendingReason);
 setIsPendingModalOpen(false);
 fetchPoojas();
 } catch (err) {
 console.error("Error setting pooja to pending:", err);
 setPendingModalError("Failed to update status. Please try again.");
 }
 };

 const getStatusBadgeClass = (status) => {
 switch (status) {
 case "Completed":
 return "text-emerald-600 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30";
 case "In Progress":
 return "text-amber-600 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30";
 case "Pending":
 return "text-rose-600 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-rose-100 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30";
 case "Upcoming":
 case "Assigned":
 case "Confirmed":
 return "text-blue-600 bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30";
 default:
 return "text-slate-500 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-100 dark:bg-[#0f172a] dark:text-slate-300 dark:border-slate-700 ";
 }
 };

 const formatDate = (dateStr) => {
 if (!dateStr) return "N/A";
 const date = new Date(dateStr);
 if (isNaN(date.getTime())) return dateStr;
 return date.toLocaleDateString("en-GB", {
 day: "numeric",
 month: "short",
 year: "numeric",
 });
 };

 const glassClass = darkMode 
 ? "bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 shadow-xl shadow-slate-900/20" 
 : "bg-temple-100/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-xl border border-white/40 shadow-xl shadow-slate-200/50";
 
 const inputClass = darkMode
 ? "bg-slate-800/50 border-slate-700 text-slate-100 focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all placeholder:text-slate-500"
 : "bg-temple-100/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-200 text-slate-900 focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all placeholder:text-slate-400";

 return (
 <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
 {/* Toast Notification */}
 {notification.show && (
 <div className={`fixed top-6 right-6 z-[9999] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-right-8 fade-in duration-300 backdrop-blur-xl border ${
 notification.type === 'error' ? 'bg-rose-500/90 border-rose-400 text-white' :
 notification.type === 'warning' ? 'bg-amber-500/90 border-amber-400 text-white' :
 'bg-emerald-500/90 border-emerald-400 text-white'
 }`}>
 {notification.type === 'error' ? <FaExclamationCircle className="text-xl" /> : <FaCheckCircle className="text-xl" />}
 <p className="font-bold">{notification.message}</p>
 </div>
 )}

 {/* Header Section */}
 <div className={`p-8 rounded-[2rem] relative overflow-hidden ${glassClass}`}>
 <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-orange-500/20 blur-3xl rounded-full pointer-events-none"></div>
 <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-blue-500/20 blur-3xl rounded-full pointer-events-none"></div>
 
 <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
 <div>
 <h2 className="text-3xl font-black flex items-center gap-3 bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">
 <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30">
 <FaClipboardList className="text-xl text-white" />
 </span>
 My Duties & Poojas
 </h2>
 <p className={`text-sm mt-3 font-medium ${darkMode ? "text-slate-400" : "text-slate-500"} max-w-xl`}>
 View and manage all your assigned Poojas, Sevas, and Special Duties in one centralized location.
 </p>
 </div>
 <button 
 onClick={() => {
 if (activeTab === "poojas") fetchPoojas();
 else { fetchDuties(); fetchIncomingTransfers(); }
 }} 
 className="px-6 py-3 rounded-2xl text-sm font-bold bg-temple-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:shadow-lg hover:-translate-y-0.5 transition-all active:scale-95 flex items-center gap-2 w-fit"
 >
 <FaExchangeAlt className="rotate-90" /> Refresh List
 </button>
 </div>

 {/* Tabs */}
 <div className="relative z-10 flex flex-wrap gap-3 mt-8">
 {[
 { id: "schedule", label: "Daily Duties", icon: <FaCalendarDay /> },
 { id: "poojas", label: "Assigned Poojas", icon: <FaCalendarAlt /> }
 ].map((tab) => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-300 ${
 activeTab === tab.id
 ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30 translate-y-[-2px]"
 : darkMode
 ? "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
 : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
 }`}
 >
 {tab.icon}
 {tab.label}
 </button>
 ))}
 </div>
 </div>

 {/* --- ASSIGNED POOJAS TAB --- */}
 {activeTab === "poojas" && (
 <div className="space-y-6 fade-in">
 <div className={`p-6 rounded-2xl border transition-colors flex flex-col md:flex-row gap-4 items-center justify-between ${
 darkMode ? "bg-slate-900/60 backdrop-blur-xl border-slate-700/50" : "bg-temple-100/70 backdrop-blur-xl border-white/40"
 }`}>
 {/* Search bar */}
 <div className={`relative px-4 py-2.5 border rounded-xl flex items-center gap-2 w-full md:max-w-xs transition-all ${
 darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-800"
 }`}>
 <FaSearch className="text-slate-450 shrink-0" />
 <input
 type="text"
 placeholder="Search pooja, devotee..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="bg-transparent outline-none text-sm w-full font-medium"
 />
 </div>
 
 {/* Status Filters */}
 <div className="flex flex-wrap gap-2">
 {["All", "Upcoming", "In Progress", "Completed", "Pending"].map((status) => (
 <button
 key={status}
 onClick={() => setFilterStatus(status)}
 className={`px-4 py-2 rounded-xl text-xs font-extrabold tracking-wide transition-all ${
 filterStatus === status
 ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
 : darkMode
 ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
 : "bg-white dark:bg-slate-800 text-slate-750 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
 }`}
 >
 {status}
 </button>
 ))}
 </div>
 </div>

 <div className={`rounded-2xl border transition-colors overflow-hidden ${
 darkMode ? "bg-slate-900/60 border-slate-700/50" : "bg-temple-100/70 border-slate-200"
 }`}>
 {poojasLoading ? (
 <div className="flex flex-col items-center justify-center py-20 space-y-4">
 <FaSpinner className="animate-spin text-4xl text-orange-500" />
 <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-500"} font-medium`}>Loading poojas...</p>
 </div>
 ) : poojasError ? (
 <div className="flex flex-col items-center justify-center p-16 space-y-4">
 <p className="text-rose-500 font-semibold text-center">{poojasError}</p>
 <button onClick={fetchPoojas} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition-colors">Retry</button>
 </div>
 ) : poojas.length === 0 ? (
 <div className="p-16 text-center">
 <div className="text-4xl mb-3">📿</div>
 <h3 className={`text-base font-bold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>No Poojas Assigned</h3>
 <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"} mt-1`}>
 There are no poojas matching your current filter. Keep performing your daily duties!
 </p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead>
 <tr className={`border-b text-xs font-extrabold uppercase tracking-wider ${
 darkMode ? "border-slate-700 bg-slate-800/50 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"
 }`}>
 <th className="py-4 px-5">Booking ID</th>
 <th className="py-4 px-4">Date & Time</th>
 <th className="py-4 px-4">Pooja Name</th>
 <th className="py-4 px-4">Devotee</th>
 <th className="py-4 px-4">Status</th>
 <th className="py-4 px-5 text-center">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
 {poojas.map((pooja) => (
 <tr key={pooja.id} className={`transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/40 ${darkMode ? "text-slate-350" : "text-slate-700"}`}>
 <td className="py-4 px-5 font-mono text-xs font-bold">
 {pooja.bookingId?.toString().substring(18) || pooja.bookingId}
 </td>
 <td className="py-4 px-4">
 <div className="flex flex-col gap-0.5">
 <span className={`font-bold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{formatDate(pooja.date)}</span>
 <span className="text-xs text-orange-500 font-semibold">{pooja.time}</span>
 </div>
 </td>
 <td className={`py-4 px-4 font-extrabold ${darkMode ? "text-white" : "text-slate-900"}`}>
 <div className="flex flex-col gap-1.5">
 <span>{pooja.pooja}</span>
 {pooja.templeMaterialRequests && pooja.templeMaterialRequests.length > 0 && (
 <div className={`mt-1 p-2 rounded-lg text-xs font-medium border ${darkMode ? "bg-slate-800/50 border-slate-700" : "bg-orange-50/50 border-orange-100"}`}>
 <p className={`font-bold mb-1 ${darkMode ? "text-slate-300" : "text-orange-700"}`}>Materials:</p>
 <ul className="list-disc pl-4 space-y-0.5">
 {pooja.templeMaterialRequests.map((mat, idx) => (
 <li key={idx} className={darkMode ? "text-slate-400" : "text-slate-600"}>
 {mat.itemName} - <span className="font-semibold">{mat.qty}</span>
 </li>
 ))}
 </ul>
 {pooja.materialStatus && (
 <p className={`mt-1.5 text-[10px] font-bold uppercase ${pooja.materialStatus === "Issued" ? "text-emerald-500" : pooja.materialStatus === "Ready for Collection" ? "text-amber-500" : "text-rose-500"}`}>
 Status: {pooja.materialStatus}
 </p>
 )}
 </div>
 )}
 </div>
 </td>
 <td className="py-4 px-4">
 <div className="font-semibold">{pooja.devotee}</div>
 <div className="inline-flex items-center gap-1 text-xs font-semibold mt-1 opacity-70">
 <FaPhoneAlt size={10} /> {pooja.mobile}
 </div>
 {pooja.email && pooja.email !== "N/A" && (
 <div className="flex items-center gap-1 text-xs font-semibold mt-0.5 opacity-70">
 <FaEnvelope size={10} className="shrink-0" /> <span className="truncate max-w-[130px]" title={pooja.email}>{pooja.email}</span>
 </div>
 )}
 </td>
 <td className="py-4 px-4">
 <div className="flex flex-col gap-1 items-start">
 <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${getStatusBadgeClass(pooja.status)}`}>
 {pooja.status}
 </span>
 {pooja.status === "Pending" && pooja.pendingReason && (
 <span className="text-[11px] text-rose-500 italic max-w-[150px] truncate" title={pooja.pendingReason}>
 Reason: {pooja.pendingReason}
 </span>
 )}
 </div>
 </td>
 <td className="py-4 px-5">
 <div className="flex flex-col items-center justify-center gap-2">
 {pooja.status !== "Completed" ? (
 <>
 {pooja.status !== "In Progress" ? (
 <button onClick={() => handleStartPooja(pooja.id)} className="w-full px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5">
 <FaPlay size={8} /> Start
 </button>
 ) : (
 <button onClick={() => handleCompletePooja(pooja.id)} className="w-full px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1.5">
 <FaCheckCircle size={10} /> Complete
 </button>
 )}
 <button onClick={() => openPendingModal(pooja.id)} className="w-full px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-450 hover:bg-rose-100 transition-colors border border-rose-100 dark:border-rose-900/30 flex items-center justify-center gap-1">
 <FaHourglassHalf size={10} /> Hold
 </button>
 </>
 ) : (
 <span className="text-xs text-slate-400 font-extrabold flex items-center gap-1">
 <FaCheckCircle className="text-emerald-500" /> Completed
 </span>
 )}
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 )}

 {/* --- DAILY SCHEDULE TAB --- */}
 {activeTab === "schedule" && (
 <div className={`rounded-2xl p-6 border transition-colors fade-in ${darkMode ? "bg-slate-900/60 backdrop-blur-xl border-slate-700/50" : "bg-temple-100 border-[#ece8e1]"}`}>
 <div className="flex items-center justify-between mb-6">
 <h3 className={`text-lg font-bold flex items-center gap-2 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>
 <FaCalendarDay className="text-orange-500" /> Daily Duty Schedule
 </h3>
 </div>

 {dutiesLoading ? (
 <div className="py-20 flex flex-col items-center justify-center gap-4">
 <FaSpinner className="animate-spin text-4xl text-orange-500" />
 <p className={`font-bold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Loading your schedule...</p>
 </div>
 ) : duties.length === 0 ? (
 <div className={`py-20 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed ${darkMode ? "border-slate-800 bg-slate-900/30" : "border-slate-200 bg-slate-50/50"}`}>
 <div className="w-20 h-20 rounded-full bg-slate-200/50 flex items-center justify-center">
 <FaClipboardList className="text-3xl text-slate-400" />
 </div>
 <p className="text-xl font-bold text-slate-500">No duties assigned</p>
 <p className="text-sm text-slate-400">You are all caught up for now!</p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm min-w-[900px]">
 <thead>
 <tr className={`border-b ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"}`}>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Time</th>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Pooja / Duty</th>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Location</th>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Type</th>
 <th className={`text-center px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Actions</th>
 </tr>
 </thead>
 <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
 {duties.map((duty) => (
 <tr key={duty.id} className={`transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/40 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
 <td className="px-4 py-4 whitespace-nowrap">
 <div className="font-bold text-orange-500">{duty.time}</div>
 <div className="text-[10px] text-slate-400 font-semibold">{duty.date.split(",")[0]}</div>
 </td>
 <td className={`px-4 py-4 font-bold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
 {duty.poojaName}
 </td>
 <td className="px-4 py-4">{duty.area}</td>
 <td className="px-4 py-4">
 <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
 {duty.referenceType}
 </span>
 </td>
 <td className="px-4 py-4 text-center">
 <div className="flex items-center justify-center gap-2">
 {duty.status !== "Transfer Requested" && duty.status !== "Transferred" ? (
 isTransferable(duty) ? (
 <button
 onClick={() => openTransferModal(duty)}
 className="px-3 py-1.5 border border-orange-500/50 text-orange-600 dark:text-orange-400 bg-orange-500/5 dark:bg-orange-950/20 text-[11px] font-bold rounded-lg hover:bg-orange-500/10 dark:hover:bg-orange-950/40 transition-all active:scale-95"
 >
 Transfer
 </button>
 ) : (
 <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg" title="Transfers must be requested at least 5 hours in advance">
 Not Transferable
 </span>
 )
 ) : (
 <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
 Transfer Pending
 </span>
 )}
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* --- INCOMING TRANSFERS TAB --- */}
 {activeTab === "transfers" && (
 <div className={`rounded-2xl p-6 border transition-colors fade-in ${darkMode ? "bg-slate-900/60 backdrop-blur-xl border-slate-700/50" : "bg-temple-100 border-[#ece8e1]"}`}>
 <div className="flex items-center justify-between mb-6">
 <h3 className={`text-lg font-bold flex items-center gap-2 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>
 <FaExchangeAlt className="text-orange-500" /> Incoming Duty Transfers
 </h3>
 </div>
 {incomingTransfers.length === 0 ? (
 <div className={`py-16 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed ${darkMode ? "border-slate-800 bg-slate-900/30" : "border-slate-200 bg-slate-50/50"}`}>
 <FaExchangeAlt className="text-3xl text-slate-400 opacity-50" />
 <p className="text-sm font-bold text-slate-500">No incoming transfer requests</p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm min-w-[700px]">
 <thead>
 <tr className={`border-b ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"}`}>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Requested By</th>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Reason</th>
 <th className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Remarks</th>
 <th className={`text-center px-4 py-3 text-xs font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Actions</th>
 </tr>
 </thead>
 <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
 {incomingTransfers.map((req) => (
 <tr key={req._id} className={`transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/40 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
 <td className={`px-4 py-4 font-bold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
 {req.originalPriest?.name || "Unknown"}
 </td>
 <td className="px-4 py-4">{req.reason}</td>
 <td className="px-4 py-4">{req.remarks || "-"}</td>
 <td className="px-4 py-4 text-center">
 <div className="flex items-center justify-center gap-2">
 <button
 onClick={() => handleRespondTransfer(req._id, "Approved")}
 className="px-3 py-1.5 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 dark:bg-emerald-950/20 text-[11px] font-bold rounded-lg hover:bg-emerald-500/10 dark:hover:bg-emerald-950/40 transition-all active:scale-95"
 >
 Approve
 </button>
 <button
 onClick={() => handleRespondTransfer(req._id, "Rejected")}
 className="px-3 py-1.5 border border-rose-500/50 text-rose-600 dark:text-rose-400 bg-rose-500/5 dark:bg-rose-950/20 text-[11px] font-bold rounded-lg hover:bg-rose-500/10 dark:hover:bg-rose-950/40 transition-all active:scale-95"
 >
 Reject
 </button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* --- MODALS --- */}

 {/* Transfer Duty Modal */}
 {showTransferModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" onClick={() => setShowTransferModal(false)}></div>
 <div className={`relative w-full max-w-lg rounded-[2rem] p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${glassClass} border-slate-200/50 dark:border-slate-700`}>
 <div className="absolute top-0 right-0 -mr-20 -mt-20 w-40 h-40 bg-orange-500/20 blur-3xl rounded-full pointer-events-none"></div>
 <div className="flex justify-between items-center mb-6 relative z-10">
 <h3 className="text-2xl font-black flex items-center gap-3 text-slate-800 dark:text-slate-100">
 <span className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center">
 <FaExchangeAlt />
 </span>
 Transfer Duty
 </h3>
 <button onClick={() => setShowTransferModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-rose-500 hover:bg-rose-50 transition-colors">
 <FaTimes />
 </button>
 </div>
 
 <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium mb-6 relative z-10">
 Request to transfer <strong className="font-black">{selectedDuty?.poojaName}</strong> to another priest. The transfer requires admin approval.
 </div>
 
 <form onSubmit={submitTransfer} className="space-y-5 relative z-10">
 {selectedDuty?.referenceType === "DefaultDuty" && (
 <div>
 <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Transfer Date *</label>
 <input
 type="date"
 required
 value={transferForm.targetDate || ""}
 onChange={(e) => {
 setTransferForm({ ...transferForm, targetDate: e.target.value });
 fetchAvailablePriestsForDate(e.target.value, selectedDuty.time || "06:00 AM");
 }}
 min={new Date().toISOString().split("T")[0]}
 className={`w-full p-3.5 rounded-2xl border text-sm outline-none ${inputClass}`}
 />
 </div>
 )}
 <div>
 <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Select Priest *</label>
 <select
 required
 value={transferForm.requestedPriestId}
 onChange={(e) => setTransferForm({ ...transferForm, requestedPriestId: e.target.value })}
 className={`w-full p-3.5 rounded-2xl border text-sm outline-none appearance-none ${inputClass}`}
 style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='${darkMode ? '%2394a3b8' : '%2364748b'}'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1.2em' }}
 >
 <option value="">-- Choose a Priest --</option>
 {priests
 .filter(p => p._id !== user.id && p._id !== user._id)
 .map(p => (
 <option key={p._id} value={p._id}>{p.name} ({p.email})</option>
 ))}
 </select>
 </div>
 <div>
 <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Reason *</label>
 <input
 type="text"
 required
 placeholder="e.g., Sick leave, emergency"
 value={transferForm.reason}
 onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
 className={`w-full p-3.5 rounded-2xl border text-sm outline-none ${inputClass}`}
 />
 </div>
 <div>
 <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Additional Remarks</label>
 <textarea
 rows="3"
 placeholder="Any details the admin or other priest should know..."
 value={transferForm.remarks}
 onChange={(e) => setTransferForm({ ...transferForm, remarks: e.target.value })}
 className={`w-full p-3.5 rounded-2xl border text-sm resize-none outline-none ${inputClass}`}
 ></textarea>
 </div>
 <div className="flex gap-4 pt-4 mt-2">
 <button type="button" onClick={() => setShowTransferModal(false)} className="flex-1 py-3.5 rounded-2xl text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-colors">
 Cancel
 </button>
 <button type="submit" disabled={isSubmitting} className="flex-1 py-3.5 rounded-2xl text-sm font-bold bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/25 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2">
 {isSubmitting ? <FaSpinner className="animate-spin" /> : "Submit Request"}
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 {/* Pending Reason Modal */}
 {isPendingModalOpen && (
 <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
 <div className={`w-full max-w-md p-6 rounded-2xl border shadow-xl mx-4 transition-colors ${
 darkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-temple-100 border-[#ece8e1] text-[#1d1b19]"
 }`}>
 <div className="flex items-center gap-2.5 text-rose-500 mb-4">
 <FaInfoCircle size={20} />
 <h3 className="text-lg font-bold">Put Pooja on Hold</h3>
 </div>
 
 <form onSubmit={handlePendingSubmit} className="space-y-4">
 <div>
 <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
 Reason for delay/pending status <span className="text-rose-500">*</span>
 </label>
 <textarea
 rows="3"
 required
 placeholder="e.g. Awaiting devotee presence, missing pooja materials..."
 value={pendingReason}
 onChange={(e) => {
 setPendingReason(e.target.value);
 if (e.target.value.trim()) setPendingModalError("");
 }}
 className={`w-full px-3.5 py-2.5 rounded-xl border outline-none text-sm transition-all resize-none ${
 darkMode
 ? "bg-slate-800 border-slate-700 text-slate-100 focus:border-rose-500"
 : "bg-[#fcfbf9] border-slate-200 text-[#1d1b19] focus:border-rose-500"
 }`}
 ></textarea>
 {pendingModalError && (
 <p className="text-rose-500 text-xs font-semibold mt-1">{pendingModalError}</p>
 )}
 </div>

 <div className="flex items-center justify-end gap-2.5 pt-2">
 <button type="button" onClick={() => setIsPendingModalOpen(false)} className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${
 darkMode ? "bg-transparent border-slate-700 text-slate-350 hover:bg-slate-800" : "bg-transparent border-slate-200 text-slate-600 hover:bg-slate-50"
 }`}>
 Cancel
 </button>
 <button type="submit" className="px-4.5 py-2 rounded-xl text-xs font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors shadow-sm">
 Save Reason
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 </div>
 );
};

export default MyDuties;
