import { useState, useEffect } from "react";
import axios from "axios";
import { FaExchangeAlt, FaCheck, FaTimes, FaSpinner } from "react-icons/fa";

const API_BASE = "http://localhost:5000/api";

const DutyTransferRequests = ({ darkMode }) => {
 const [requests, setRequests] = useState([]);
 const [loading, setLoading] = useState(true);
 const [actionLoading, setActionLoading] = useState(null);
 
 // Tab state
 const [activeTab, setActiveTab] = useState("incoming"); // "incoming" or "outgoing"

 // Reject Modal state
 const [rejectModalOpen, setRejectModalOpen] = useState(false);
 const [rejectRequestId, setRejectRequestId] = useState(null);
 const [rejectReason, setRejectReason] = useState("");

 useEffect(() => {
 fetchRequests();
 }, []);

 const fetchRequests = async () => {
 try {
 setLoading(true);
 const res = await axios.get(`${API_BASE}/priest/my-duties/transfers`, {
 headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
 });
 setRequests(res.data);
 } catch (error) {
 console.error("Error fetching transfer requests:", error);
 } finally {
 setLoading(false);
 }
 };

 const handleRespond = async (id, status, reason = "") => {
 try {
 setActionLoading(id);
 await axios.post(
 `${API_BASE}/priest/my-duties/transfer/${id}/respond`,
 { status, rejectReason: reason },
 { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
 );
 
 alert(`Request ${status.toLowerCase()} successfully.`);
 fetchRequests();
 } catch (error) {
 alert(error.response?.data?.message || "Failed to respond to request.");
 } finally {
 setActionLoading(null);
 setRejectModalOpen(false);
 setRejectRequestId(null);
 setRejectReason("");
 }
 };

 const openRejectModal = (id) => {
 setRejectRequestId(id);
 setRejectReason("");
 setRejectModalOpen(true);
 };

 const getStatusBadge = (status) => {
 switch (status) {
 case "Pending": return "bg-yellow-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
 case "Approved": return "bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-700 dark:bg-green-900/30 dark:text-green-400";
 case "Rejected": return "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
 default: return "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 dark:bg-[#0f172a] dark:text-slate-300";
 }
 };

 const filteredRequests = requests.filter(req => req.type.toLowerCase() === activeTab);

 return (
 <div className="space-y-6 fade-in">
 <div className={`p-6 rounded-2xl border transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700 text-slate-100" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-[#1d1b19]"}`}>
 <h2 className="text-2xl font-extrabold flex items-center gap-2">
 <FaExchangeAlt className="text-orange-500" /> Duty Transfer Requests
 </h2>
 <p className={`text-sm mt-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 View and manage your duty reassignment requests.
 </p>
 </div>

 {/* Tabs */}
 <div className="flex border-b border-slate-200 dark:border-slate-700 ">
 <button
 className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${
 activeTab === "incoming"
 ? "border-orange-500 text-orange-600 dark:text-orange-400"
 : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
 }`}
 onClick={() => setActiveTab("incoming")}
 >
 Requested By Others
 </button>
 <button
 className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${
 activeTab === "outgoing"
 ? "border-orange-500 text-orange-600 dark:text-orange-400"
 : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
 }`}
 onClick={() => setActiveTab("outgoing")}
 >
 Requested By Me
 </button>
 </div>

 <div className={`rounded-2xl border overflow-hidden transition-colors ${darkMode ? "bg-[#1f2937] border-slate-700" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1]"}`}>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead>
 <tr className={`border-b ${darkMode ? "bg-slate-800/50 border-slate-700 text-slate-300" : "bg-[#fdfaf5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-[#ece8e1] text-slate-600"}`}>
 <th className="p-4 font-bold">Duty Details</th>
 <th className="p-4 font-bold">Other Priest</th>
 <th className="p-4 font-bold">Reason</th>
 <th className="p-4 font-bold">Status</th>
 <th className="p-4 font-bold text-center">Action</th>
 </tr>
 </thead>
 <tbody className={`divide-y ${darkMode ? "divide-slate-700 text-slate-300" : "divide-slate-100 text-slate-700"}`}>
 {loading ? (
 <tr>
 <td colSpan="5" className="text-center p-8">
 <FaSpinner className="animate-spin text-orange-500 mx-auto text-2xl" />
 </td>
 </tr>
 ) : filteredRequests.length === 0 ? (
 <tr>
 <td colSpan="5" className="text-center p-8 text-slate-500">
 No transfer requests found in this tab.
 </td>
 </tr>
 ) : (
 filteredRequests.map((req) => (
 <tr key={req.id} className={`hover:bg-orange-50/30 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors ${darkMode ? "hover:bg-slate-800/50" : ""}`}>
 <td className="p-4">
 <div className={`font-bold text-sm ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{req.dutyName}</div>
 <div className="text-xs opacity-75">{req.date} at {req.time}</div>
 <div className="text-xs text-orange-500 mt-0.5">({req.referenceType})</div>
 </td>
 <td className="p-4">
 <div className="font-semibold">{req.type === "Outgoing" ? req.requestedPriest?.name : req.originalPriest?.name}</div>
 </td>
 <td className="p-4">
 <div className="text-sm">{req.reason}</div>
 {req.remarks && <div className="text-xs opacity-70 mt-1 italic">"{req.remarks}"</div>}
 {req.status === "Rejected" && req.rejectReason && (
 <div className="mt-2 text-xs p-2 rounded bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700 border border-rose-100 dark:bg-rose-900/20 dark:border-rose-800/30 dark:text-rose-400">
 <span className="font-bold">Rejection Reason:</span> {req.rejectReason}
 </div>
 )}
 </td>
 <td className="p-4">
 <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusBadge(req.status)}`}>
 {req.status}
 </span>
 </td>
 <td className="p-4 text-center">
 {req.type === "Incoming" && req.status === "Pending" ? (
 <div className="flex justify-center gap-2">
 <button
 onClick={() => handleRespond(req.id, "Approved")}
 disabled={actionLoading === req.id}
 className="p-2 bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-800/40 rounded transition-colors disabled:opacity-50"
 title="Accept Transfer"
 >
 {actionLoading === req.id ? <FaSpinner className="animate-spin" /> : <FaCheck />}
 </button>
 <button
 onClick={() => openRejectModal(req.id)}
 disabled={actionLoading === req.id}
 className="p-2 bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-800/40 rounded transition-colors disabled:opacity-50"
 title="Reject Transfer"
 >
 {actionLoading === req.id ? <FaSpinner className="animate-spin" /> : <FaTimes />}
 </button>
 </div>
 ) : (
 <span className="text-xs opacity-50 font-semibold italic">
 {req.status === "Pending" ? "Waiting for action" : "Resolved"}
 </span>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Reject Modal */}
 {rejectModalOpen && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
 <div className={`w-full max-w-md rounded-2xl p-6 shadow-xl ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-800"}`}>
 <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-rose-500">
 <FaTimes /> Reject Transfer
 </h3>
 <p className={`text-sm mb-4 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
 Please provide a reason for rejecting this duty transfer request. This will be visible to the requesting priest.
 </p>
 <textarea
 value={rejectReason}
 onChange={(e) => setRejectReason(e.target.value)}
 placeholder="Enter rejection reason..."
 className={`w-full p-3 rounded-xl border outline-none min-h-[100px] mb-4 text-sm ${
 darkMode
 ? "bg-slate-700 border-slate-600 focus:border-rose-500 text-white placeholder-slate-400"
 : "bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-slate-200 focus:border-rose-500 text-slate-900"
 }`}
 autoFocus
 />
 <div className="flex justify-end gap-3">
 <button
 onClick={() => setRejectModalOpen(false)}
 className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
 darkMode ? "bg-slate-700 hover:bg-slate-600" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 Cancel
 </button>
 <button
 onClick={() => handleRespond(rejectRequestId, "Rejected", rejectReason)}
 disabled={!rejectReason.trim()}
 className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
 >
 Confirm Reject
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default DutyTransferRequests;
