import { useEffect, useMemo, useState } from "react";
import { 
 FiCalendar, 
 FiClock, 
 FiUser, 
 FiUsers,
 FiLayers,
 FiCheckCircle,
 FiAlertTriangle, 
 FiPlus, 
 FiTrash2, 
 FiEdit2, 
 FiArrowLeft, 
 FiArrowRight, 
 FiInfo,
 FiX
} from "react-icons/fi";
import { FaExchangeAlt, FaCheck, FaTimes, FaSpinner } from "react-icons/fa";
import axios from "axios";
import SectionCard from "../../../components/admin/employee/SectionCard";
import { 
 getShiftDashboard, 
 createShift, 
 updateShift, 
 deleteShift, 
 assignShift, 
 deleteAssignment 
} from "../../../services/shiftService";
import { getEmployees } from "../../../services/employeeService";

const CATEGORIES = [
 "Priest Services", 
 "Pooja Services", 
 "Accounts", 
 "Billing", 
 "Prasadam", 
 "Maintenance", 
 "Security", 
 "Devotee Services", 
 "General"
];

const ASSIGNMENT_TYPES = [
 "Extra Duty",
 "Festival Duty",
 "Emergency Duty",
 "Replacement Duty",
];

const parseTime = (timeStr) => {
 if (!timeStr) return { hour: "09", minute: "00", meridiem: "AM" };
 const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
 if (!match) return { hour: "09", minute: "00", meridiem: "AM" };
 return {
 hour: String(match[1]).padStart(2, "0"),
 minute: match[2],
 meridiem: match[3].toUpperCase(),
 };
};

const getBadgeClass = (status, type) => {
 if (status === "Completed") return "bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-500 border border-green-500/20";
 if (status === "Cancelled") return "bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-gray-500 dark:text-slate-200 border border-gray-500/20";
 if (type === "Extra Duty") return "bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-500 border border-blue-500/20";
 if (type === "Festival Duty") return "bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-orange-500 border border-orange-500/20";
 if (type === "Emergency Duty") return "bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-500 border border-red-500/20";
 if (type === "Replacement Duty") return "bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-purple-500 border border-purple-500/20";

 switch (status) {
 case "Checked Out":
 return "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-500 border border-emerald-500/20";
 case "Checked In":
 return "bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-sky-500 border border-sky-500/20";
 case "Employee unavailable":
 return "bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-500 border border-rose-500/20";
 case "Absent":
 case "Shift Missed":
 case "Missed":
 return "bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-500 border border-red-500/20";
 case "Pending":
 default:
 return "bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-500 dark:text-slate-200 border border-slate-500/20";
 }
};

const getCurrentWeekStartKey = () => {
 const today = new Date();
 const dayIndex = today.getDay();
 const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
 const monday = new Date(today);
 monday.setDate(today.getDate() + mondayOffset);
 monday.setHours(0, 0, 0, 0);
 return monday.toISOString().slice(0, 10);
};

const ShiftManagement = () => {
 const loggedInUser = useMemo(() => JSON.parse(localStorage.getItem("user") || "null"), []);
 const assignedByDefault = useMemo(() => {
 const role = String(loggedInUser?.role || "admin").trim();
 const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
 return loggedInUser?.name ? `${roleLabel} (${loggedInUser.name})` : roleLabel;
 }, [loggedInUser]);

 // Database state
 const [shifts, setShifts] = useState([]);
 const [assignments, setAssignments] = useState([]);
 const [planner, setPlanner] = useState([]);
 const [upcomingAssignments, setUpcomingAssignments] = useState([]);
 const [alerts, setAlerts] = useState([]);
 const [stats, setStats] = useState({
 totalShifts: 0,
 completedShifts: 0,
 missedShifts: 0,
 overtimeHours: 0,
 manpowerAvailable: 0,
 });

  const summaryCards = useMemo(() => [
    {
      title: "Total Shift Types",
      value: stats.totalShifts,
      icon: FiLayers,
      iconBg: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60",
      valueColor: "text-slate-900 dark:text-slate-100",
    },
    {
      title: "Completed Shifts",
      value: stats.completedShifts,
      icon: FiCheckCircle,
      iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60",
      valueColor: "text-emerald-600 dark:text-emerald-400",
    },
    {
      title: "Missed Shifts",
      value: stats.missedShifts,
      icon: FiAlertTriangle,
      iconBg: "bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/60",
      valueColor: "text-rose-600 dark:text-rose-400",
    },
    {
      title: "Overtime Hours",
      value: `${stats.overtimeHours} hrs`,
      icon: FiClock,
      iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/60",
      valueColor: "text-sky-600 dark:text-sky-400",
    },
    {
      title: "Active Staff Available",
      value: stats.manpowerAvailable,
      icon: FiUsers,
      iconBg: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60",
      valueColor: "text-amber-600 dark:text-amber-400",
    },
  ], [stats]);
 
 const [employees, setEmployees] = useState([]);
 const [weekStart, setWeekStart] = useState(getCurrentWeekStartKey);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const [activeTab, setActiveTab] = useState("planner");
 const [requests, setRequests] = useState([]);
 const [transferLoading, setTransferLoading] = useState(false);
 const [actionLoading, setActionLoading] = useState(null);
 const [selectedPriest, setSelectedPriest] = useState({});

 // Modals state
 const [showShiftModal, setShowShiftModal] = useState(false);
 const [editingShift, setEditingShift] = useState(null);
 const [showAssignModal, setShowAssignModal] = useState(false);

 // Shift Type Form State
 const [shiftForm, setShiftForm] = useState({
 shiftName: "",
 startHour: "09",
 startMinute: "00",
 startMeridiem: "AM",
 endHour: "05",
 endMinute: "00",
 endMeridiem: "PM",
 category: "General",
 requiredStaff: 1,
 notes: "",
 });

 // Shift Assignment Form State
 const [assignForm, setAssignForm] = useState({
 employeeId: "",
 shiftId: "",
 assignmentType: "Extra Duty",
 date: "",
 dutyName: "",
 dutyArea: "",
 notes: "",
 assignedBy: assignedByDefault,
 priority: "Medium",
 reason: "",
 status: "Assigned",
 });
 const [assignError, setAssignError] = useState("");
 const [shiftTypeError, setShiftTypeError] = useState("");
 const [availableEmployees, setAvailableEmployees] = useState([]);
 const [fetchingAvailable, setFetchingAvailable] = useState(false);

 useEffect(() => {
 if (assignForm.date && assignForm.shiftId) {
 const selectedShift = shifts.find(s => s.id === assignForm.shiftId);
 if (selectedShift) {
 fetchAvailable(assignForm.date, selectedShift.startTime, selectedShift.endTime, assignForm.assignmentType);
 }
 } else {
 setAvailableEmployees([]);
 }
 }, [assignForm.date, assignForm.shiftId, shifts, assignForm.assignmentType]);

 const fetchAvailable = async (date, startTime, endTime, assignmentType) => {
 try {
 setFetchingAvailable(true);
 const res = await axios.get(`http://localhost:5000/api/shifts/available-employees?date=${date}&startTime=${startTime}&endTime=${endTime}&assignmentType=${assignmentType}`, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setAvailableEmployees(res.data.employees || []);
 if (!res.data.employees?.find(e => e._id === assignForm.employeeId)) {
 setAssignForm(prev => ({ ...prev, employeeId: "" }));
 }
 } catch (error) {
 console.error(error);
 } finally {
 setFetchingAvailable(false);
 }
 };

 // Load Dashboard Data
 const loadData = async (targetWeekStart) => {
 try {
 setLoading(true);
 setError("");
 
 const dashboard = await getShiftDashboard(targetWeekStart);
 setShifts(dashboard.shifts || []);
 setAssignments(dashboard.assignments || []);
 setPlanner(dashboard.planner || []);
 setUpcomingAssignments(dashboard.upcomingAssignments || []);
 setAlerts(dashboard.alerts || []);
 setStats(dashboard.stats || {
 totalShifts: 0,
 completedShifts: 0,
 missedShifts: 0,
 overtimeHours: 0,
 manpowerAvailable: 0,
 });
 
 const empData = await getEmployees();
 setEmployees(Array.isArray(empData) ? empData : empData.employees || []);
 
 // Fetch transfers
 setTransferLoading(true);
 const res = await axios.get("http://localhost:5000/api/transfers/requests", {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setRequests(res.data);
 } catch (err) {
 console.error("ShiftManagement load error", err);
 setError("Failed to load shift dashboard. Please try again.");
 } finally {
 setLoading(false);
 setTransferLoading(false);
 }
 };

 useEffect(() => {
 loadData(weekStart);
 }, [weekStart]);

 // Navigate Weeks
 const handlePrevWeek = () => {
 if (!weekStart) return;
 const current = new Date(`${weekStart}T00:00:00`);
 current.setDate(current.getDate() - 7);
 setWeekStart(current.toISOString().slice(0, 10));
 };

 const handleNextWeek = () => {
 if (!weekStart) return;
 const current = new Date(`${weekStart}T00:00:00`);
 current.setDate(current.getDate() + 7);
 setWeekStart(current.toISOString().slice(0, 10));
 };

 const handleCurrentWeek = () => {
 setWeekStart(getCurrentWeekStartKey());
 };

 // Open Add Shift Modal
 const handleAddShiftClick = () => {
 setEditingShift(null);
 setShiftForm({
 shiftName: "",
 startHour: "09",
 startMinute: "00",
 startMeridiem: "AM",
 endHour: "05",
 endMinute: "00",
 endMeridiem: "PM",
 category: "General",
 requiredStaff: 1,
 notes: "",
 });
 setShiftTypeError("");
 setShowShiftModal(true);
 };

 // Open Edit Shift Modal
 const handleEditShiftClick = (shift) => {
 const start = parseTime(shift.startTime);
 const end = parseTime(shift.endTime);
 setEditingShift(shift);
 setShiftForm({
 shiftName: shift.shiftName,
 startHour: start.hour,
 startMinute: start.minute,
 startMeridiem: start.meridiem,
 endHour: end.hour,
 endMinute: end.minute,
 endMeridiem: end.meridiem,
 category: shift.category || "General",
 requiredStaff: shift.requiredStaff || 1,
 notes: shift.notes || "",
 });
 setShiftTypeError("");
 setShowShiftModal(true);
 };

 // Delete Shift Type
 const handleDeleteShiftClick = async (shiftId) => {
 if (!window.confirm("Are you sure you want to delete this shift type? This will also remove all its assignments.")) return;
 try {
 await deleteShift(shiftId);
 loadData(weekStart);
 } catch (err) {
 alert(err.response?.data?.message || "Failed to delete shift type");
 }
 };

 // Save Shift Type (Create/Update)
 const handleShiftFormSubmit = async (e) => {
 e.preventDefault();
 setShiftTypeError("");
 
 // Combine hours and minutes
 const startTimeStr = `${Number(shiftForm.startHour)}:${shiftForm.startMinute} ${shiftForm.startMeridiem}`;
 const endTimeStr = `${Number(shiftForm.endHour)}:${shiftForm.endMinute} ${shiftForm.endMeridiem}`;
 
 const payload = {
 shiftName: shiftForm.shiftName.trim(),
 startTime: startTimeStr,
 endTime: endTimeStr,
 category: shiftForm.category,
 requiredStaff: Number(shiftForm.requiredStaff) || 1,
 notes: shiftForm.notes.trim(),
 };

 if (!payload.shiftName) {
 setShiftTypeError("Shift Name is required");
 return;
 }

 try {
 if (editingShift) {
 await updateShift(editingShift.id, payload);
 } else {
 await createShift(payload);
 }
 setShowShiftModal(false);
 loadData(weekStart);
 } catch (err) {
 setShiftTypeError(err.response?.data?.message || "Failed to save shift type");
 }
 };

 // Open Assign Shift Modal
 const handleAssignClick = () => {
 setAssignForm({
 employeeId: "",
 shiftId: "",
 assignmentType: "Extra Duty",
 date: "",
 dutyName: "",
 dutyArea: "",
 notes: "",
 assignedBy: assignedByDefault,
 priority: "Medium",
 reason: "",
 status: "Assigned",
 });
 setAssignError("");
 setShowAssignModal(true);
 };

 // Save Assignment
 const handleAssignSubmit = async (e) => {
 e.preventDefault();
 setAssignError("");

 if (!assignForm.employeeId) {
 setAssignError("Please select an employee");
 return;
 }
 if (!assignForm.shiftId) {
 setAssignError("Please select a shift type");
 return;
 }
 if (!assignForm.date) {
 setAssignError("Please select a date");
 return;
 }

 const selectedShift = shifts.find((shift) => shift.id === assignForm.shiftId);
 const assignmentType = assignForm.assignmentType || "Special Duty";
 const isTemporaryShiftChange = assignmentType === "Temporary Shift Change";

 if (!isTemporaryShiftChange && !assignForm.dutyName.trim()) {
 setAssignError("Please enter a duty name");
 return;
 }
 if (!isTemporaryShiftChange && !assignForm.dutyArea.trim()) {
 setAssignError("Please enter a duty area or location");
 return;
 }
 const today = new Date();
 today.setHours(0, 0, 0, 0);

 const selectedDate = new Date(assignForm.date);
 selectedDate.setHours(0, 0, 0, 0);

 if (selectedDate < today) {
 setAssignError("Cannot assign shifts for previous dates.");
 return;
 }

 try {
 const dutyName = isTemporaryShiftChange
 ? assignForm.dutyName.trim() || selectedShift?.shiftName || "Temporary Shift Change"
 : assignForm.dutyName.trim();
 const dutyArea = isTemporaryShiftChange
 ? assignForm.dutyArea.trim() || "Temporary Shift"
 : assignForm.dutyArea.trim();

 await assignShift({
 shiftId: assignForm.shiftId,
 employeeId: assignForm.employeeId,
 assignmentType,
 date: assignForm.date,
 dutyName,
 dutyArea,
 notes: assignForm.notes,
 assignedBy: assignForm.assignedBy.trim() || assignedByDefault,
 reportingTime: selectedShift?.startTime || "",
 priority: assignForm.priority,
 reason: assignForm.reason,
 status: assignForm.status,
 });
 setShowAssignModal(false);
 loadData(weekStart);
 } catch (err) {
 setAssignError(err.response?.data?.message || "Failed to assign shift");
 }
 };

 const fetchRequests = async () => {
 try {
 setTransferLoading(true);
 const res = await axios.get("http://localhost:5000/api/transfers/requests", {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setRequests(res.data);
 } catch (error) {
 console.error("Error fetching transfer requests:", error);
 } finally {
 setTransferLoading(false);
 }
 };

 const handleResolveTransfer = async (id, status, assignedPriestId = null) => {
 try {
 setActionLoading(id);
 const payload = { status };
 if (status === "Approved" && assignedPriestId) {
 payload.assignToPriestId = assignedPriestId;
 }

 await axios.put(`http://localhost:5000/api/transfers/requests/${id}/resolve`, payload, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 
 alert(`Request ${status} successfully.`);
 fetchRequests();
 } catch (error) {
 alert(error.response?.data?.message || "Failed to resolve request.");
 } finally {
 setActionLoading(null);
 }
 };

 const getStatusBadgeTransfer = (status) => {
 switch (status) {
 case "Pending": return "bg-yellow-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-yellow-700";
 case "Approved": return "bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-700";
 case "Rejected": return "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700";
 default: return "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 ";
 }
 };

 // Unassign/Delete Assignment
 const handleUnassignClick = async (assignmentId) => {
 if (!window.confirm("Are you sure you want to delete this shift assignment?")) return;
 try {
 await deleteAssignment(assignmentId);
 loadData(weekStart);
 } catch (err) {
 alert(err.response?.data?.message || "Failed to unassign shift");
 }
 };

 // Helpers to select options
 const hoursOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
 const minutesOptions = ["00", "15", "30", "45"];
 const activeEmployees = employees.filter(emp => emp.status === "Active");
 const isTemporaryShiftChange = assignForm.assignmentType === "Temporary Shift Change";

 if (loading && !shifts.length) {
 return (
 <div className="flex h-64 items-center justify-center rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-sm">
 <div className="text-center">
 <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-600 border-t-transparent mx-auto"></div>
 <p className="mt-4 text-sm text-slate-500 dark:text-slate-200 ">Loading Duty & Shift Management data...</p>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-8">
 {/* 1. Header Banner */}
 <SectionCard
 title="Temporary & Extra Duty Assignment"
 subtitle="Schedule temporary shifts and duties for festivals, emergencies, and extra work. Default duties are assigned in Employee Management."
 className="bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 text-[#4a2b0f] dark:text-slate-200 border border-amber-200/60 shadow-md backdrop-blur-md"
 topRight={
 <button
 onClick={handleAssignClick}
 className="flex items-center gap-2 rounded-2xl bg-amber-600 px-6 py-3 text-sm font-extrabold text-white shadow-md transition hover:bg-amber-700 hover:scale-105 active:scale-95"
 >
 <FiPlus size={16} /> Assign Duty & Shift
 </button>
 }
 >
        {/* Statistics Cards */}
        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-[24px] border border-amber-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-5 shadow-sm hover:shadow-md transition-all duration-300 backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {card.title}
                    </p>
                    <p className={`mt-2 text-2xl sm:text-3xl font-black tracking-tight ${card.valueColor}`}>
                      {card.value}
                    </p>
                  </div>
                  <div className={`flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl ${card.iconBg}`}>
                    <Icon className="text-lg sm:text-xl" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
 </SectionCard>

 {error && (
 <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm text-red-700 flex items-center gap-3">
 <FiAlertTriangle size={18} className="text-red-500 flex-shrink-0" />
 <span>{error}</span>
 </div>
 )}

 {/* Tabs */}
 <div className="flex gap-4 border-b border-slate-200 dark:border-slate-700 ">
 <button
 onClick={() => setActiveTab("planner")}
 className={`pb-3 text-sm font-semibold transition-colors ${ activeTab === "planner" ? "border-b-2 border-violet-600 text-violet-700" : "text-slate-500 dark:text-slate-200 hover:text-slate-700 dark:text-slate-200 " }`}
 >
 Shift Planner
 </button>
 <button
 onClick={() => setActiveTab("transfers")}
 className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${ activeTab === "transfers" ? "border-b-2 border-orange-500 text-orange-600" : "text-slate-500 dark:text-slate-200 hover:text-slate-700 dark:text-slate-200 " }`}
 >
 <FaExchangeAlt /> Duty Transfers
 </button>
 </div>

 {/* 2. Main Weekly Planner Calendar */}
 {activeTab === "planner" && (
 <>
 <SectionCard 
 title="Weekly Shift Planner" 
 subtitle="Manage and view roster schedules in a weekly layout."
 topRight={
 <div className="flex items-center gap-3">
 <button 
 onClick={handlePrevWeek} 
 className="rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-2.5 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition active:scale-95"
 title="Previous Week"
 >
 <FiArrowLeft size={16} />
 </button>
 <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 bg-slate-100/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2">
 Week start: {weekStart ? new Date(`${weekStart}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Loading..."}
 </span>
 <button 
 onClick={handleNextWeek} 
 className="rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-2.5 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition active:scale-95"
 title="Next Week"
 >
 <FiArrowRight size={16} />
 </button>
 <button 
 onClick={handleCurrentWeek} 
 className="text-xs font-semibold text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 border border-violet-100 transition"
 >
 This Week
 </button>
 </div>
 }
 >
 <div className="overflow-x-auto pb-4">
 <div className="grid grid-cols-7 gap-4 min-w-[1024px]">
 {planner.map((day) => (
 <div key={day.dateKey} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-sm min-h-[360px] flex flex-col">
 <div className="text-center border-b border-slate-200 dark:border-slate-700 pb-2 mb-3">
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 uppercase tracking-widest">{day.label.split(",")[0]}</p>
 <p className="text-sm font-bold text-slate-900 dark:text-slate-200 mt-0.5">{day.label.split(",")[1] || day.dateKey.split("-")[2]}</p>
 </div>
 
 <div className="flex-1 space-y-3">
 {day.items.map((item) => (
 <div 
 key={item.id} 
 className={`relative rounded-2xl border p-3 shadow-sm flex flex-col gap-1.5 transition-all hover:-translate-y-0.5 ${ item.conflict ? "bg-rose-50/60 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-rose-200/60 text-slate-900 dark:text-slate-200 " : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 " }`}
 >
 <div className="flex justify-between items-start gap-2">
 <span className="text-xs font-bold leading-snug">{item.employeeName}</span>
 <button 
 onClick={() => handleUnassignClick(item.id)}
 className="text-slate-400 hover:text-rose-600 p-0.5 rounded transition self-start"
 title="Unassign shift"
 >
 <FiTrash2 size={12} />
 </button>
 </div>
 
 <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 ">
 <FiUser size={12} className="text-slate-400 flex-shrink-0" />
 <span className="font-semibold truncate">{item.shiftName}</span>
 </div>

 <span className="inline-flex self-start rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2.5 py-1 text-[10px] font-semibold text-slate-600 dark:text-slate-200 ">
 {item.assignmentType || "Extra Duty"}
 </span>
 
 <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-200 ">
 <FiClock size={11} className="text-slate-400 flex-shrink-0" />
 <span>{item.shiftName}</span>
 </div>

 <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-200 ">
 <FiInfo size={11} className="text-slate-400 flex-shrink-0" />
 <span>{item.dutyName}</span>
 </div>

 <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-200 ">
 <FiClock size={11} className="text-slate-400 flex-shrink-0" />
 <span>{item.reportingTime || item.startTime} • {item.dutyArea}</span>
 </div>
 
 {item.conflict && (
 <div className="flex items-center gap-1 text-[10px] text-rose-600 font-semibold mt-1">
 <FiAlertTriangle size={11} className="flex-shrink-0" />
 <span>Duty/Shift Overlap</span>
 </div>
 )}
 
 <span className={`text-[9px] font-semibold tracking-wider uppercase inline-block self-start rounded-full px-2 py-0.5 mt-1 border ${getBadgeClass(item.status || item.attendanceStatus, item.assignmentType)}`}>
 {item.status || item.attendanceStatus}
 </span>
 </div>
 ))}
 
 {day.items.length === 0 && (
 <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
 <FiCalendar size={20} className="stroke-[1.5] text-slate-300" />
 <p className="text-[11px] mt-1.5 italic">No duty assignments scheduled</p>
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 </SectionCard>

 {/* 3. Shift Types Configuration Table & Alerts / Upcoming columns */}
 <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
 {/* Shift Types Catalog */}
 <SectionCard 
 title="Shift Types" 
 subtitle="Configure default roster periods and staff requirements."
 topRight={
 <button 
 onClick={handleAddShiftClick}
 className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 px-3.5 py-2 text-xs font-semibold text-white transition active:scale-95"
 >
 <FiPlus size={14} /> Add Shift Type
 </button>
 }
 >
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-xs text-slate-600 dark:text-slate-200 ">
 <thead className="bg-slate-100/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-500 dark:text-slate-200 rounded-xl">
 <tr>
 <th className="px-4 py-3 rounded-l-xl">Shift Name</th>
 <th className="px-4 py-3">Timings</th>
 <th className="px-4 py-3">Category</th>
 <th className="px-4 py-3">Required Staff</th>
 <th className="px-4 py-3 rounded-r-xl text-center">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100">
 {shifts.length === 0 ? (
 <tr>
 <td colSpan="5" className="px-4 py-6 text-center text-slate-400 italic">No shift types created. Click "+ Add Shift Type" to get started.</td>
 </tr>
 ) : (
 shifts.map((s) => (
 <tr key={s.id} className="hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition">
 <td className="px-4 py-3.5 font-bold text-slate-800 dark:text-slate-200 ">{s.shiftName}</td>
 <td className="px-4 py-3.5 text-slate-700 dark:text-slate-200 font-medium">{s.startTime} - {s.endTime}</td>
 <td className="px-4 py-3.5">
 <span className="inline-block rounded-xl bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2.5 py-1 font-semibold text-slate-600 dark:text-slate-200 text-[10px]">
 {s.category}
 </span>
 </td>
 <td className="px-4 py-3.5 text-slate-700 dark:text-slate-200 font-semibold">{s.requiredStaff} staff</td>
 <td className="px-4 py-3.5 text-center">
 <div className="flex justify-center gap-2">
 <button 
 onClick={() => handleEditShiftClick(s)}
 className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 hover:text-violet-600 hover:border-violet-200 transition"
 title="Edit shift settings"
 >
 <FiEdit2 size={13} />
 </button>
 <button 
 onClick={() => handleDeleteShiftClick(s.id)}
 className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 hover:text-rose-600 hover:border-rose-200 transition"
 title="Delete shift type"
 >
 <FiTrash2 size={13} />
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

 {/* Alerts & Upcoming Duties */}
 <div className="space-y-5">
 {/* Shift Alerts Panel */}
 <SectionCard title="Assignment Alerts" subtitle="Conflicts, leaves, and staff capacity warnings.">
 <div className="space-y-3">
 {alerts.length === 0 ? (
 <div className="rounded-[22px] border border-slate-100 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-center text-xs text-slate-500 dark:text-slate-200 ">
 <FiInfo size={16} className="mx-auto text-slate-400 mb-1" />
 No roster conflicts or low capacity issues detected.
 </div>
 ) : (
 alerts.map((alert, idx) => (
 <div 
 key={idx} 
 className={`rounded-[20px] border p-4 text-xs transition-all shadow-sm ${ alert.tone === "danger" ? "border-rose-100 bg-rose-50/60 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-rose-800" : "border-amber-100 bg-amber-50/60 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-800" }`}
 >
 <div className="flex items-center gap-2 font-bold mb-1">
 <FiAlertTriangle size={14} className={alert.tone === "danger" ? "text-rose-600" : "text-amber-600"} />
 <span>{alert.title}</span>
 </div>
 <p className="leading-relaxed opacity-90">{alert.message}</p>
 </div>
 ))
 )}
 </div>
 </SectionCard>

 {/* Upcoming Shifts Panel */}
 <SectionCard title="Upcoming Roster" subtitle="Next scheduled duties and shifts.">
 <div className="space-y-2.5">
 {upcomingAssignments.length === 0 ? (
 <div className="rounded-[22px] border border-slate-100 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-center text-xs text-slate-500 dark:text-slate-200 ">
 No upcoming shifts scheduled.
 </div>
 ) : (
 upcomingAssignments.map((a) => (
 <div key={a.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3.5 shadow-sm hover:border-slate-300 dark:border-slate-700 transition flex items-center justify-between gap-3 text-xs">
 <div>
 <p className="font-bold text-slate-800 dark:text-slate-200 ">{a.employeeName}</p>
 <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-0.5">
 {a.assignmentType || "Extra Duty"}
 </p>
 <p className="text-slate-500 dark:text-slate-200 font-medium mt-0.5">{a.shiftName}</p>
 <p className="text-slate-500 dark:text-slate-200 font-medium mt-0.5">{a.dutyName}</p>
 <p className="text-[10px] text-slate-400 mt-1">{new Date(`${a.dateKey}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })} • {a.reportingTime || a.startTime} • {a.dutyArea}</p>
 </div>
 <span className={`text-[9px] font-bold tracking-wider rounded-full px-2 py-0.5 border ${getBadgeClass(a.status || a.attendanceStatus, a.assignmentType)}`}>
 {a.status || a.attendanceStatus}
 </span>
 </div>
 ))
 )}
 </div>
 </SectionCard>
 </div>
 </div>
 </>
 )}

 {/* Duty Transfers Tab */}
 {activeTab === "transfers" && (
 <SectionCard 
 title="Duty Transfer Requests" 
 subtitle="Review and approve duty reassignment requests from priests."
 >
 <div className="overflow-x-auto pb-4">
 <table className="w-full text-left border-collapse text-xs">
 <thead>
 <tr className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-600 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 ">
 <th className="p-3 font-bold rounded-tl-xl">Duty Details</th>
 <th className="p-3 font-bold">Requested By</th>
 <th className="p-3 font-bold">Target Priest</th>
 <th className="p-3 font-bold">Reason</th>
 <th className="p-3 font-bold">Status</th>
 <th className="p-3 font-bold text-center rounded-tr-xl">Admin Action</th>
 </tr>
 </thead>
 <tbody>
 {transferLoading ? (
 <tr>
 <td colSpan="6" className="text-center p-8">
 <FaSpinner className="animate-spin text-orange-500 mx-auto text-xl" />
 </td>
 </tr>
 ) : requests.length === 0 ? (
 <tr>
 <td colSpan="6" className="text-center p-8 text-slate-500 dark:text-slate-200 italic">
 No transfer requests found.
 </td>
 </tr>
 ) : (
 requests.map((req) => (
 <tr key={req.id} className="border-b last:border-0 border-slate-100 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition-colors">
 <td className="p-3">
 <div className="font-bold text-slate-800 dark:text-slate-200 ">{req.dutyName}</div>
 <div className="text-[10px] text-slate-500 dark:text-slate-200 ">{req.date} at {req.time}</div>
 <div className="text-[10px] text-orange-500 mt-0.5 font-semibold">({req.referenceType})</div>
 </td>
 <td className="p-3">
 <div className="font-semibold text-slate-800 dark:text-slate-200 ">{req.originalPriest?.name || "Unknown"}</div>
 </td>
 <td className="p-3">
 <div className="font-semibold text-slate-800 dark:text-slate-200 ">{req.requestedPriest?.name || "Unknown"}</div>
 {req.status === "Pending" && (
 <div className="mt-1.5">
 <select
 className="text-[10px] border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1 w-full max-w-[150px] outline-none"
 value={selectedPriest[req.id] || req.requestedPriest?._id || ""}
 onChange={(e) => setSelectedPriest({ ...selectedPriest, [req.id]: e.target.value })}
 >
 <option value={req.requestedPriest?._id}>Requested: {req.requestedPriest?.name}</option>
 <optgroup label="Or Assign to Others:">
 {employees.filter(p => p._id !== req.originalPriest?._id && p.status === "Active").map(p => (
 <option key={p._id} value={p._id}>{p.name}</option>
 ))}
 </optgroup>
 </select>
 </div>
 )}
 </td>
 <td className="p-3">
 <div className="text-slate-700 dark:text-slate-200 ">{req.reason}</div>
 {req.remarks && <div className="text-[10px] text-slate-400 mt-0.5 italic">"{req.remarks}"</div>}
 </td>
 <td className="p-3">
 <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeTransfer(req.status)}`}>
 {req.status}
 </span>
 </td>
 <td className="p-3 text-center">
 {req.status === "Pending" ? (
 <div className="flex justify-center gap-1.5">
 <button
 onClick={() => handleResolveTransfer(req.id, "Approved", selectedPriest[req.id] || req.requestedPriest?._id)}
 disabled={actionLoading === req.id}
 className="p-1.5 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-emerald-600 hover:bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
 title="Approve & Assign"
 >
 {actionLoading === req.id ? <FaSpinner className="animate-spin" /> : <FaCheck size={12} />}
 </button>
 <button
 onClick={() => handleResolveTransfer(req.id, "Rejected")}
 disabled={actionLoading === req.id}
 className="p-1.5 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-rose-600 hover:bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
 title="Reject Transfer"
 >
 {actionLoading === req.id ? <FaSpinner className="animate-spin" /> : <FaTimes size={12} />}
 </button>
 </div>
 ) : (
 <span className="text-[10px] text-slate-400 font-semibold italic">Resolved</span>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>
 )}

 {/* 4. Add/Edit Shift Modal */}
 {showShiftModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
 <div className="w-full max-w-lg rounded-[32px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
 <div className="flex items-center justify-between border-b border-slate-100 pb-3">
 <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 ">{editingShift ? "Edit Shift Type" : "Add Shift Type"}</h3>
 <button 
 onClick={() => setShowShiftModal(false)}
 className="rounded-xl border border-slate-100 p-2 text-slate-400 hover:text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition"
 >
 <FiX size={16} />
 </button>
 </div>
 
 <form onSubmit={handleShiftFormSubmit} className="mt-4 space-y-4 text-xs">
 {shiftTypeError && (
 <div className="rounded-xl bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-rose-100 p-3 text-rose-600 font-semibold">
 {shiftTypeError}
 </div>
 )}

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Shift Name</label>
 <input 
 type="text" 
 value={shiftForm.shiftName}
 onChange={(e) => setShiftForm({ ...shiftForm, shiftName: e.target.value })}
 placeholder="e.g. Morning Pooja"
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none focus:border-violet-600 font-medium text-slate-800 dark:text-slate-200 transition"
 />
 </div>

 <div className="grid gap-3 sm:grid-cols-2">
 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Start Time</label>
 <div className="flex gap-1.5">
 <select 
 value={shiftForm.startHour}
 onChange={(e) => setShiftForm({ ...shiftForm, startHour: e.target.value })}
 className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-2.5 outline-none font-medium text-slate-800 dark:text-slate-200 transition"
 >
 {hoursOptions.map(h => <option key={h} value={h}>{h}</option>)}
 </select>
 <select 
 value={shiftForm.startMinute}
 onChange={(e) => setShiftForm({ ...shiftForm, startMinute: e.target.value })}
 className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-2.5 outline-none font-medium text-slate-800 dark:text-slate-200 transition"
 >
 {minutesOptions.map(m => <option key={m} value={m}>{m}</option>)}
 </select>
 <select 
 value={shiftForm.startMeridiem}
 onChange={(e) => setShiftForm({ ...shiftForm, startMeridiem: e.target.value })}
 className="rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-2.5 outline-none font-bold text-slate-800 dark:text-slate-200 transition"
 >
 <option value="AM">AM</option>
 <option value="PM">PM</option>
 </select>
 </div>
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">End Time</label>
 <div className="flex gap-1.5">
 <select 
 value={shiftForm.endHour}
 onChange={(e) => setShiftForm({ ...shiftForm, endHour: e.target.value })}
 className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-2.5 outline-none font-medium text-slate-800 dark:text-slate-200 transition"
 >
 {hoursOptions.map(h => <option key={h} value={h}>{h}</option>)}
 </select>
 <select 
 value={shiftForm.endMinute}
 onChange={(e) => setShiftForm({ ...shiftForm, endMinute: e.target.value })}
 className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-2.5 outline-none font-medium text-slate-800 dark:text-slate-200 transition"
 >
 {minutesOptions.map(m => <option key={m} value={m}>{m}</option>)}
 </select>
 <select 
 value={shiftForm.endMeridiem}
 onChange={(e) => setShiftForm({ ...shiftForm, endMeridiem: e.target.value })}
 className="rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-2.5 outline-none font-bold text-slate-800 dark:text-slate-200 transition"
 >
 <option value="AM">AM</option>
 <option value="PM">PM</option>
 </select>
 </div>
 </div>
 </div>

 <div className="grid gap-3 sm:grid-cols-2">
 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Category</label>
 <select 
 value={shiftForm.category}
 onChange={(e) => setShiftForm({ ...shiftForm, category: e.target.value })}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-medium text-slate-800 dark:text-slate-200 transition"
 >
 {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
 </select>
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Required Staff</label>
 <input 
 type="number" 
 min="1"
 value={shiftForm.requiredStaff}
 onChange={(e) => setShiftForm({ ...shiftForm, requiredStaff: e.target.value })}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-medium text-slate-800 dark:text-slate-200 transition"
 />
 </div>
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Notes (Optional)</label>
 <textarea 
 value={shiftForm.notes}
 onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })}
 placeholder="Notes about location or specific duties"
 rows="2"
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none focus:border-violet-600 font-medium text-slate-800 dark:text-slate-200 transition resize-none"
 />
 </div>

 <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 mt-2">
 <button 
 type="button" 
 onClick={() => setShowShiftModal(false)}
 className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition"
 >
 Cancel
 </button>
 <button 
 type="submit"
 className="rounded-xl bg-violet-600 hover:bg-violet-700 px-5 py-2.5 font-semibold text-white transition active:scale-95 shadow-md shadow-violet-600/10"
 >
 Save Shift
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 {/* 5. Assign Shift Modal */}
 {showAssignModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
 <div className="w-full max-w-md max-h-[95vh] overflow-y-auto rounded-[32px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
 <div className="flex items-center justify-between border-b border-slate-100 pb-3">
 <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 ">Assign Duty & Shift</h3>
 <button 
 onClick={() => setShowAssignModal(false)}
 className="rounded-xl border border-slate-100 p-2 text-slate-400 hover:text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition"
 >
 <FiX size={16} />
 </button>
 </div>
 
 <form onSubmit={handleAssignSubmit} className="mt-4 space-y-4 text-xs">
 {assignError && (
 <div className="rounded-xl bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-rose-100 p-3 text-rose-600 font-semibold flex items-center gap-2 leading-relaxed">
 <FiAlertTriangle size={15} className="flex-shrink-0" />
 <span>{assignError}</span>
 </div>
 )}

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Assignment Type</label>
 <select
 value={assignForm.assignmentType}
 onChange={(e) => setAssignForm({ ...assignForm, assignmentType: e.target.value })}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition"
 >
 {ASSIGNMENT_TYPES.map((type) => (
 <option key={type} value={type}>
 {type}
 </option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Date</label>
 <input
 type="date"
 value={assignForm.date}
 min={new Date().toISOString().split("T")[0]}
 onChange={(e) =>
 setAssignForm({ ...assignForm, date: e.target.value })
 }
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-850 transition"
 />
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Select Shift Type</label>
 <select 
 value={assignForm.shiftId}
 onChange={(e) => setAssignForm({ ...assignForm, shiftId: e.target.value })}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition"
 >
 <option value="">-- Select Shift Type --</option>
 {shifts.map(s => (
 <option key={s.id} value={s.id}>
 {s.shiftName} ({s.startTime} - {s.endTime})
 </option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5 flex justify-between">
 <span>Select Employee</span>
 {fetchingAvailable && <span className="text-[10px] text-violet-500 flex items-center gap-1"><FaSpinner className="animate-spin" /> Checking availability...</span>}
 </label>
 <select 
 value={assignForm.employeeId}
 onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })}
 disabled={!assignForm.date || !assignForm.shiftId || fetchingAvailable}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition disabled:opacity-60 disabled:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <option value="">
 {!assignForm.date || !assignForm.shiftId ? "-- Select Date & Shift First --" : "-- Select Available Employee --"}
 </option>
 {availableEmployees.map(emp => (
 <option key={emp.id || emp._id} value={emp.id || emp._id}>
 {emp.name} ({emp.role})
 </option>
 ))}
 </select>
 {assignForm.date && assignForm.shiftId && availableEmployees.length === 0 && !fetchingAvailable && (
 <p className="text-[10px] text-rose-500 font-semibold mt-1">No employees available for this shift.</p>
 )}
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">
 {isTemporaryShiftChange ? "Shift Note" : "Duty Name"}
 </label>
 <input
 type="text"
 value={assignForm.dutyName}
 onChange={(e) => setAssignForm({ ...assignForm, dutyName: e.target.value })}
 placeholder={isTemporaryShiftChange ? "Optional note for the shift change" : "e.g. Arrange Flowers"}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition"
 />
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">
 {isTemporaryShiftChange ? "Shift Location" : "Duty Area / Location"}
 </label>
 <input
 type="text"
 value={assignForm.dutyArea}
 onChange={(e) => setAssignForm({ ...assignForm, dutyArea: e.target.value })}
 placeholder={isTemporaryShiftChange ? "Optional shift location" : "e.g. Temple Hall"}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition"
 />
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Reason</label>
 <input
 type="text"
 value={assignForm.reason}
 onChange={(e) => setAssignForm({ ...assignForm, reason: e.target.value })}
 placeholder="e.g. Special Poojas, Sick Cover"
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition"
 />
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Assigned By</label>
 <input
 type="text"
 value={assignForm.assignedBy}
 onChange={(e) => setAssignForm({ ...assignForm, assignedBy: e.target.value })}
 placeholder="Admin"
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none font-semibold text-slate-800 dark:text-slate-200 transition"
 />
 </div>

 <div>
 <label className="block text-slate-600 dark:text-slate-200 font-semibold mb-1.5">Assignment Notes (Optional)</label>
 <textarea 
 value={assignForm.notes}
 onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
 placeholder="Special instructions for the duty"
 rows="2"
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3.5 py-2.5 outline-none focus:border-violet-600 font-medium text-slate-800 dark:text-slate-200 transition resize-none"
 />
 </div>

 <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 mt-2">
 <button 
 type="button" 
 onClick={() => setShowAssignModal(false)}
 className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition"
 >
 Cancel
 </button>
 <button 
 type="submit"
 className="rounded-xl bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:bg-amber-600 px-5 py-2.5 font-semibold text-white transition active:scale-95 shadow-md shadow-amber-500/10"
 >
 Save Duty & Shift
 </button>
 </div>
 </form>
 </div>
 </div>
 )}
 </div>
 );
};

export default ShiftManagement;
