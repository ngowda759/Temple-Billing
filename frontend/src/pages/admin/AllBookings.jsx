import React, { useState, useEffect } from "react";
import { MdOutlineSearch, MdOutlineFilterAlt, MdChevronLeft, MdChevronRight } from "react-icons/md";
import { getAllBookings, assignPriestToBooking } from "../../services/bookingService";
import AssignPriestModal from "../../components/admin/AssignPriestModal";

const formatCurrency = (value) => `₹ ${Number(value || 0).toLocaleString()}`;

const statusTheme = {
 Confirmed: "bg-[#e8f6e9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#187a3b]",
 Pending: "bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#ea580c]",
 Completed: "bg-[#e9efff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#2454c9]",
 Cancelled: "bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#a12525]",
};

const AllBookings = () => {
 const [bookings, setBookings] = useState([]);
 const [loading, setLoading] = useState(false);
 const [query, setQuery] = useState("");
 const [statusFilter, setStatusFilter] = useState("");
 const [dateFilter, setDateFilter] = useState("");
 const [page, setPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const [selectedBookingForPriest, setSelectedBookingForPriest] = useState(null);
 const limit = 10;

 const loadData = async () => {
 setLoading(true);
 try {
 const response = await getAllBookings({
 page,
 limit,
 search: query,
 status: statusFilter,
 dateRange: dateFilter
 });
 setBookings(response.bookings || []);
 setTotalPages(response.totalPages || 1);
 } catch (error) {
 console.error("Failed to load all bookings:", error);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 }, [page, statusFilter, dateFilter]);

 // Handle search with debounce
 useEffect(() => {
 const handler = setTimeout(() => {
 setPage(1);
 loadData();
 }, 500);
 return () => clearTimeout(handler);
 }, [query]);

 return (
 <div className="mt-5 space-y-4">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
 <div>
 <h1 className="text-[42px] leading-tight font-bold text-[#15141f] dark:text-slate-200 ">All Pooja Bookings</h1>
 <p className="mt-1 text-[20px] text-[#5d6674] dark:text-slate-200 ">View complete booking history and detailed records.</p>
 </div>
 </div>

 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4">
 <div className="flex flex-wrap items-center gap-3">
 <div className="flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 text-[#858b96] dark:text-slate-200 ">
 <MdOutlineSearch size={20} />
 <input
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 className="w-[240px] bg-transparent text-[15px] text-[#242938] dark:text-slate-200 outline-none placeholder:text-[#9ca3af]"
 placeholder="Search ID, Name or Pooja..."
 />
 </div>


 <select
 value={dateFilter}
 onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
 className="h-11 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 text-[15px] text-[#4b5563] dark:text-slate-200 outline-none"
 >
 <option value="">All Time</option>
 <option value="Today">Today</option>
 <option value="Last 7 Days">Last 7 Days</option>
 <option value="This Month">This Month</option>
 </select>
 </div>
 </div>

 <div className="overflow-auto min-h-[400px]">
 <table className="w-full min-w-[920px] text-[15px]">
 <thead className="bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#2b3240] dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3 text-left font-semibold">Booking ID</th>
 <th className="px-4 py-3 text-left font-semibold">Devotee</th>
 <th className="px-4 py-3 text-left font-semibold">Pooja</th>
 <th className="px-4 py-3 text-left font-semibold">Booking Date</th>
 <th className="px-4 py-3 text-left font-semibold">Pooja Date</th>
 <th className="px-4 py-3 text-left font-semibold">Amount</th>
 <th className="px-4 py-3 text-left font-semibold">Payment</th>
 <th className="px-4 py-3 text-left font-semibold">Status</th>
 <th className="px-4 py-3 text-left font-semibold">Priest</th>
 <th className="px-4 py-3 text-left font-semibold">Materials</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="9" className="py-8 text-center text-gray-500 dark:text-slate-200 ">Loading bookings...</td>
 </tr>
 ) : bookings.length === 0 ? (
 <tr>
 <td colSpan="10" className="py-8 text-center text-gray-500 dark:text-slate-200 ">No bookings found.</td>
 </tr>
 ) : (
 bookings.map((row) => (
 <tr key={row._id} className="border-t border-[#f0ece6] dark:border-slate-700 text-[#2f3645] dark:text-slate-200 ">
 <td className="px-4 py-3">BK{String(row._id).slice(-6).toUpperCase()}</td>
 <td className="px-4 py-3 font-medium">{row.devoteeName || row.customerName}</td>
 <td className="px-4 py-3">{row.service}</td>
 <td className="px-4 py-3">{new Date(row.createdAt).toLocaleDateString()}</td>
 <td className="px-4 py-3">{row.datetime ? new Date(row.datetime).toLocaleDateString() : "-"}</td>
 <td className="px-4 py-3 font-semibold">{formatCurrency(row.amount)}</td>
 <td className="px-4 py-3">{row.paymentMethod || "UPI"}</td>
 <td className="px-4 py-3">
 <span className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold ${statusTheme[row.status] || statusTheme.Pending}`}>
 {row.status}
 </span>
 </td>
 <td className="px-4 py-3">
 {row.priestName ? (
 <div className="flex flex-col">
 <span className="font-semibold text-violet-700">{row.priestName}</span>
 <button onClick={() => setSelectedBookingForPriest(row)} className="text-[11px] text-blue-600 hover:underline text-left mt-0.5">Reassign</button>
 </div>
 ) : (
 <button 
 onClick={() => setSelectedBookingForPriest(row)}
 className="rounded bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-2 py-1 text-xs font-bold text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition"
 >
 Assignment Pending
 </button>
 )}
 </td>
 <td className="px-4 py-3">
 {row.materialStatus && row.materialStatus !== "N/A" ? (
 <span className={`text-[12px] font-bold ${row.materialStatus === "Issued" ? "text-emerald-600" : row.materialStatus === "Ready for Collection" ? "text-amber-600" : "text-rose-500" }`}>
 {row.materialStatus}
 </span>
 ) : (
 <span className="text-gray-400 text-sm">-</span>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>

 {!loading && totalPages > 1 && (
 <div className="mt-4 flex items-center justify-between border-t border-[#f0ece6] dark:border-slate-700 pt-4">
 <span className="text-sm text-[#5d6674] dark:text-slate-200 ">
 Page <span className="font-semibold text-[#15141f] dark:text-slate-200 ">{page}</span> of <span className="font-semibold text-[#15141f] dark:text-slate-200 ">{totalPages}</span>
 </span>
 <div className="flex items-center gap-2">
 <button
 disabled={page === 1}
 onClick={() => setPage(page - 1)}
 className="flex items-center gap-1 rounded-lg border border-[#e5e7eb] dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-[#374151] dark:text-slate-200 hover:bg-[#f9fafb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:opacity-50"
 >
 <MdChevronLeft size={18} /> Previous
 </button>
 <button
 disabled={page === totalPages}
 onClick={() => setPage(page + 1)}
 className="flex items-center gap-1 rounded-lg border border-[#e5e7eb] dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-[#374151] dark:text-slate-200 hover:bg-[#f9fafb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:opacity-50"
 >
 Next <MdChevronRight size={18} />
 </button>
 </div>
 </div>
 )}
 </div>
 {selectedBookingForPriest && (
 <AssignPriestModal
 booking={selectedBookingForPriest}
 onClose={() => setSelectedBookingForPriest(null)}
 onAssigned={() => {
 setSelectedBookingForPriest(null);
 loadData();
 }}
 />
 )}
 </div>
 );
};

export default AllBookings;
