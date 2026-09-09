import React, { useState, useEffect } from "react";
import { FaRupeeSign } from "react-icons/fa";
import { FiSearch, FiFilter, FiChevronLeft, FiChevronRight, FiTrendingUp, FiTrendingDown, FiAlertCircle } from "react-icons/fi";
import { toast } from "react-toastify";
import axios from "axios";
import { getDashboardMetrics } from "../../../services/accountService";

const AuditLogs = () => {
 const [logs, setLogs] = useState([]);
 const [loading, setLoading] = useState(true);
 const [searchTerm, setSearchTerm] = useState("");
 const [filterUser, setFilterUser] = useState("All Users");
 const [filterAction, setFilterAction] = useState("All Actions");
 const [filterModule, setFilterModule] = useState("All Modules");

 const [metrics, setMetrics] = useState({
 todayIncome: 0,
 todayExpense: 0,
 todayProfit: 0,
 cashInHand: 0,
 pendingPayments: 0,
 });

 // Pagination
 const [currentPage, setCurrentPage] = useState(1);
 const itemsPerPage = 8;

 const [employees, setEmployees] = useState([]);

 useEffect(() => {
 fetchLogs();
 fetchMetrics();
 fetchEmployees();
 }, []);

 const fetchEmployees = async () => {
 try {
 const token = localStorage.getItem("token");
 const res = await axios.get("http://localhost:5000/api/employees", {
 headers: { Authorization: `Bearer ${token}` }
 });
 if (res.data.success) {
 setEmployees(res.data.data);
 } else {
 // fallback if it's an array directly
 if (Array.isArray(res.data)) {
 setEmployees(res.data);
 }
 }
 } catch (error) {
 console.warn("Failed to fetch employees for filter");
 }
 };

 const fetchMetrics = async () => {
 try {
 const data = await getDashboardMetrics();
 setMetrics(data);
 } catch (error) {
 console.error("Failed to fetch dashboard metrics", error);
 }
 };

 const formatCurrency = (amount) => {
 return new Intl.NumberFormat("en-IN", {
 style: "currency",
 currency: "INR",
 }).format(amount);
 };

 const fetchLogs = async () => {
 try {
 setLoading(true);
 const token = localStorage.getItem("token");
 const res = await axios.get("http://localhost:5000/api/audit-logs", {
 headers: { Authorization: `Bearer ${token}` }
 });
 setLogs(res.data);
 } catch (error) {
 toast.error("Failed to load audit logs");
 } finally {
 setLoading(false);
 }
 };

 const [showFilters, setShowFilters] = useState(false);
 const [startDate, setStartDate] = useState("");
 const [endDate, setEndDate] = useState("");

 const applyFilters = async () => {
 // Send filters to backend instead of just frontend filtering
 setShowFilters(false);
 setCurrentPage(1);
 try {
 setLoading(true);
 const token = localStorage.getItem("token");
 let url = "http://localhost:5000/api/audit-logs?";
 if (startDate) url += `startDate=${startDate}&`;
 if (endDate) url += `endDate=${endDate}&`;
 
 const res = await axios.get(url, {
 headers: { Authorization: `Bearer ${token}` }
 });
 setLogs(res.data);
 } catch (error) {
 toast.error("Failed to load audit logs");
 } finally {
 setLoading(false);
 }
 };

 const filteredLogs = logs.filter(log => {
 const matchSearch = log.details?.toLowerCase().includes(searchTerm.toLowerCase()) || 
 log.action?.toLowerCase().includes(searchTerm.toLowerCase());
 const matchUser = filterUser === "All Users" || log.user?.name === filterUser;
 const matchAction = filterAction === "All Actions" || log.action === filterAction;
 const matchModule = filterModule === "All Modules" || log.module === filterModule;
 return matchSearch && matchUser && matchAction && matchModule;
 });

 const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
 const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

 const getPageNumbers = () => {
 const pages = [];
 if (totalPages <= 7) {
 for (let i = 1; i <= totalPages; i++) {
 pages.push(i);
 }
 } else {
 if (currentPage <= 4) {
 pages.push(1, 2, 3, 4, 5, '...', totalPages);
 } else if (currentPage >= totalPages - 3) {
 pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
 } else {
 pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
 }
 }
 return pages;
 };

 // Derive unique users from employees + existing logs
 const employeeNames = employees.map(emp => emp.user?.name || emp.name).filter(Boolean);
 const logUserNames = logs.map(log => log.user?.name).filter(Boolean);
 const uniqueUsers = ["All Users", ...new Set([...employeeNames, ...logUserNames])];
 
 // Standard actions & modules for the dropdowns
 const uniqueActions = ["All Actions", "Create", "Update", "Delete", "Export", "Approve", "Reject", "Status Change"];
 const uniqueModules = ["All Modules", "Authentication", "Accounts", "Inventory", "Prasadam", "Donations", "Employees", "Rooms", "Pooja", "Settings", "Devotees"];

 return (
 <div className="p-4 md:p-8 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] min-h-screen font-sans">
 
 {/* Accounts Dashboard Section */}
 <div className="mb-10">
 <h2 className="text-2xl font-bold text-[#1d1b19] dark:text-slate-200 mb-6">Accounts Dashboard</h2>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-slate-500 dark:text-slate-200 text-sm font-medium">Today's Income</h3>
 <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-emerald-500">
 <FiTrendingUp className="text-sm" />
 </div>
 </div>
 <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{formatCurrency(metrics.todayIncome)}</p>
 </div>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-slate-500 dark:text-slate-200 text-sm font-medium">Today's Expense</h3>
 <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-red-500">
 <FiTrendingDown className="text-sm" />
 </div>
 </div>
 <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{formatCurrency(metrics.todayExpense)}</p>
 </div>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-slate-500 dark:text-slate-200 text-sm font-medium">Today's Profit</h3>
 <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-blue-500">
 <FaRupeeSign className="text-xs" />
 </div>
 </div>
 <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{formatCurrency(metrics.todayProfit)}</p>
 </div>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-slate-500 dark:text-slate-200 text-sm font-medium">Cash In Hand</h3>
 <div className="w-8 h-8 rounded-full bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-purple-500">
 <FaRupeeSign className="text-xs" />
 </div>
 </div>
 <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{formatCurrency(metrics.cashInHand)}</p>
 </div>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-slate-500 dark:text-slate-200 text-sm font-medium">Pending Approvals</h3>
 <div className="w-8 h-8 rounded-full bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-orange-500">
 <FiAlertCircle className="text-sm" />
 </div>
 </div>
 <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{metrics.pendingPayments}</p>
 </div>
 </div>
 </div>

 <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <h1 className="text-2xl font-bold text-[#1d1b19] dark:text-slate-200 ">Audit Logs</h1>
 <p className="text-sm text-[#5c6675]">Accounts & Finance &gt; Audit Logs</p>
 </div>
 </div>

 {/* Controls */}
 <div className="flex flex-wrap items-center gap-4 mb-6 relative">
 <div className="flex items-center bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 flex-grow max-w-md">
 <FiSearch className="text-slate-400 mr-2" />
 <input
 type="text"
 placeholder="Search logs..."
 className="bg-transparent border-none outline-none text-sm w-full"
 value={searchTerm}
 onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
 />
 </div>
 
 <div className="relative ml-auto">
 <button 
 onClick={() => setShowFilters(!showFilters)}
 className="flex items-center gap-2 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <FiFilter /> Filters {(filterUser !== "All Users" || filterAction !== "All Actions" || filterModule !== "All Modules") && "(Active)"}
 </button>

 {showFilters && (
 <div className="absolute right-0 top-full mt-2 w-72 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-4 z-50">
 <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4">Filter Logs</h4>
 
 <div className="space-y-4">
 <div>
 <label className="block text-xs text-slate-500 dark:text-slate-200 mb-1">Start Date</label>
 <input 
 type="date" 
 value={startDate}
 onChange={(e) => setStartDate(e.target.value)}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 outline-none" 
 />
 </div>
 <div>
 <label className="block text-xs text-slate-500 dark:text-slate-200 mb-1">End Date</label>
 <input 
 type="date" 
 value={endDate}
 onChange={(e) => setEndDate(e.target.value)}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 outline-none" 
 />
 </div>
 <div>
 <label className="block text-xs text-slate-500 dark:text-slate-200 mb-1">User</label>
 <select 
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 outline-none"
 value={filterUser}
 onChange={(e) => setFilterUser(e.target.value)}
 >
 {uniqueUsers.map(u => <option key={u}>{u}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-slate-500 dark:text-slate-200 mb-1">Action</label>
 <select 
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 outline-none"
 value={filterAction}
 onChange={(e) => setFilterAction(e.target.value)}
 >
 {uniqueActions.map(a => <option key={a}>{a}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-slate-500 dark:text-slate-200 mb-1">Module</label>
 <select 
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 outline-none"
 value={filterModule}
 onChange={(e) => setFilterModule(e.target.value)}
 >
 {uniqueModules.map(m => <option key={m}>{m}</option>)}
 </select>
 </div>
 </div>
 
 <div className="flex gap-2 mt-6">
 <button 
 onClick={() => {
 setFilterUser("All Users");
 setFilterAction("All Actions");
 setFilterModule("All Modules");
 setStartDate("");
 setEndDate("");
 setSearchTerm("");
 setCurrentPage(1);
 fetchLogs();
 }}
 className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 rounded-lg text-sm hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 Clear
 </button>
 <button 
 onClick={applyFilters}
 className="flex-1 px-3 py-2 bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-white rounded-lg text-sm hover:bg-[#e67e00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Apply
 </button>
 </div>
 </div>
 )}
 </div>
 </div>

 {/* Table */}
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm text-slate-600 dark:text-slate-200 ">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-xs uppercase font-medium text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-6 py-4">Date & Time</th>
 <th className="px-6 py-4">User</th>
 <th className="px-6 py-4">Action</th>
 <th className="px-6 py-4">Module</th>
 <th className="px-6 py-4">Details</th>
 <th className="px-6 py-4">IP Address</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100">
 {loading ? (
 <tr>
 <td colSpan="6" className="px-6 py-8 text-center text-slate-400">Loading audit logs...</td>
 </tr>
 ) : paginatedLogs.length === 0 ? (
 <tr>
 <td colSpan="6" className="px-6 py-8 text-center text-slate-400">No logs found</td>
 </tr>
 ) : (
 paginatedLogs.map((log) => (
 <tr key={log._id} className="hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-slate-200 ">
 {new Date(log.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}
 </td>
 <td className="px-6 py-4 font-medium text-slate-800 dark:text-slate-200 ">{log.user?.name || "System"}</td>
 <td className="px-6 py-4 text-slate-700 dark:text-slate-200 ">{log.action}</td>
 <td className="px-6 py-4">{log.module}</td>
 <td className="px-6 py-4 text-slate-500 dark:text-slate-200 max-w-md truncate" title={log.details}>{log.details}</td>
 <td className="px-6 py-4 font-mono text-xs text-slate-400">{log.ipAddress}</td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 
 {/* Pagination */}
 <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">
 Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredLogs.length)} to {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length} entries
 </p>
 <div className="flex gap-1">
 <button 
 disabled={currentPage === 1}
 onClick={() => setCurrentPage(p => p - 1)}
 className="p-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] disabled:opacity-50"
 >
 <FiChevronLeft size={18} />
 </button>
 {getPageNumbers().map((page, index) => (
 <button
 key={index}
 onClick={() => typeof page === 'number' && setCurrentPage(page)}
 disabled={page === '...'}
 className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${ currentPage === page ? "bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white border border-[#ff8b00]" : page === '...' ? "text-slate-400 cursor-default" : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " }`}
 >
 {page}
 </button>
 ))}
 <button 
 disabled={currentPage === totalPages || totalPages === 0}
 onClick={() => setCurrentPage(p => p + 1)}
 className="p-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] disabled:opacity-50"
 >
 <FiChevronRight size={18} />
 </button>
 </div>
 </div>
 </div>
 </div>
 );
};

export default AuditLogs;
