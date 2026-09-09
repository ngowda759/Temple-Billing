import React, { useState, useEffect } from "react";
import { FiX, FiCheckCircle } from "react-icons/fi";
import { getEmployees } from "../../services/employeeService";
import { assignPriestToBooking } from "../../services/bookingService";
import { toast } from "react-toastify";

const AssignPriestModal = ({ booking, onClose, onAssigned }) => {
 const [priests, setPriests] = useState([]);
 const [selectedPriest, setSelectedPriest] = useState("");
 const [loading, setLoading] = useState(false);
 const [fetching, setFetching] = useState(true);

 useEffect(() => {
 const fetchPriests = async () => {
 try {
 const data = await getEmployees({ role: "priest", status: "Active", limit: 100 });
 setPriests(data.employees || []);
 } catch (err) {
 console.error("Failed to fetch priests", err);
 toast.error("Failed to load priests list");
 } finally {
 setFetching(false);
 }
 };
 fetchPriests();
 }, []);

 const handleAssign = async () => {
 if (!selectedPriest) {
 toast.warning("Please select a priest first.");
 return;
 }

 setLoading(true);
 try {
 const priest = priests.find(p => p._id === selectedPriest);
 await assignPriestToBooking(booking._id, selectedPriest, priest.name);
 toast.success("Priest assigned successfully!");
 onAssigned();
 } catch (err) {
 console.error(err);
 toast.error(err.response?.data?.message || "Failed to assign priest");
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
 <div className="w-full max-w-md rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl">
 <div className="flex items-center justify-between mb-6">
 <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 ">Assign Priest</h2>
 <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition">
 <FiX size={20} />
 </button>
 </div>

 <div className="mb-4 text-sm text-slate-600 space-y-1">
 <p><strong>Booking ID:</strong> BK{String(booking._id).slice(-6).toUpperCase()}</p>
 <p><strong>Pooja:</strong> {booking.service}</p>
 <p><strong>Devotee:</strong> {booking.devoteeName || booking.customerName}</p>
 </div>

 <div className="mb-6">
 <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Select Priest</label>
 {fetching ? (
 <div className="animate-pulse bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] h-10 rounded-xl"></div>
 ) : (
 <select
 value={selectedPriest}
 onChange={(e) => setSelectedPriest(e.target.value)}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 outline-none focus:border-violet-500 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <option value="">-- Choose Priest --</option>
 {priests.map(p => (
 <option key={p._id} value={p._id}>{p.name}</option>
 ))}
 </select>
 )}
 </div>

 <button
 onClick={handleAssign}
 disabled={loading || fetching}
 className="w-full rounded-xl bg-violet-600 py-3 font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50 flex justify-center items-center gap-2"
 >
 {loading ? "Assigning..." : (
 <>
 Assign <FiCheckCircle size={18} />
 </>
 )}
 </button>
 </div>
 </div>
 );
};

export default AssignPriestModal;
