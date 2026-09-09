import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { 
 FaSearch, 
 FaFilter, 
 FaEye, 
 FaTimesCircle, 
 FaFileInvoice,
 FaChevronLeft,
 FaChevronRight,
 FaRupeeSign
} from "react-icons/fa";

const MyBookingsPage = () => {
 const [bookings, setBookings] = useState([]);
 const [loading, setLoading] = useState(true);
 const [searchTerm, setSearchTerm] = useState("");
 const [statusFilter, setStatusFilter] = useState("");
 
 // Pagination
 const [currentPage, setCurrentPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const [totalBookings, setTotalBookings] = useState(0);

 const fetchBookings = useCallback(async () => {
 setLoading(true);
 try {
 const token = localStorage.getItem("token");
 const res = await axios.get(`http://localhost:5000/api/pooja/my-bookings`, {
 params: {
 page: currentPage,
 limit: 10,
 search: searchTerm,
 status: statusFilter
 },
 headers: { Authorization: `Bearer ${token}` }
 });
 
 setBookings(res.data.bookings);
 setTotalPages(res.data.totalPages);
 setTotalBookings(res.data.totalBookings);
 } catch (error) {
 console.error("Error fetching bookings:", error);
 toast.error("Failed to load your bookings");
 } finally {
 setLoading(false);
 }
 }, [currentPage, searchTerm, statusFilter]);

 useEffect(() => {
 // Debounce search slightly
 const delayDebounceFn = setTimeout(() => {
 fetchBookings();
 }, 400);

 return () => clearTimeout(delayDebounceFn);
 }, [fetchBookings]);

 const handleCancelBooking = async (id) => {
 if (!window.confirm("Are you sure you want to cancel this booking?")) return;

 try {
 const token = localStorage.getItem("token");
 await axios.delete(`http://localhost:5000/api/pooja/${id}`, {
 headers: { Authorization: `Bearer ${token}` }
 });
 toast.success("Booking cancelled successfully");
 fetchBookings();
 } catch (error) {
 console.error(error);
 toast.error(error.response?.data?.message || "Failed to cancel booking");
 }
 };

 const getStatusBadge = (status) => {
 switch(status) {
 case "Booked":
 return <span className="px-2.5 py-1 bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-700 text-xs font-bold rounded-full">Booked</span>;
 case "Completed":
 return <span className="px-2.5 py-1 bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-700 text-xs font-bold rounded-full">Completed</span>;
 case "Cancelled":
 return <span className="px-2.5 py-1 bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-700 text-xs font-bold rounded-full">Cancelled</span>;
 default:
 return <span className="px-2.5 py-1 bg-gray-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-gray-700 text-xs font-bold rounded-full">{status}</span>;
 }
 };

 return (
 <div className="max-w-7xl mx-auto p-4 md:p-6 bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 min-h-screen">
 
 {/* Header section */}
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-200">
 <div className="flex items-center gap-3">
 <div className="bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-3 rounded-lg text-amber-600">
 <FaFileInvoice size={24} />
 </div>
 <div>
 <h1 className="text-2xl font-bold text-gray-800 font-serif">My Bookings</h1>
 <p className="text-sm text-gray-500">Manage and view your generated pooja bookings</p>
 </div>
 </div>
 
 <div className="flex bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2 rounded-lg border border-gray-200 shadow-sm text-sm">
 <span className="text-gray-500 mr-2">Total Records:</span>
 <span className="font-bold text-amber-600">{totalBookings}</span>
 </div>
 </div>

 {/* Filters and Search */}
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
 
 <div className="relative w-full sm:w-80">
 <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
 <FaSearch className="text-gray-400" />
 </div>
 <input
 type="text"
 placeholder="Search by Booking No, Service, Name..."
 value={searchTerm}
 onChange={(e) => {
 setSearchTerm(e.target.value);
 setCurrentPage(1); // Reset to page 1 on search
 }}
 className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-gray-300 text-sm rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-colors"
 />
 </div>

 <div className="relative w-full sm:w-48">
 <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
 <FaFilter className="text-gray-400" />
 </div>
 <select
 value={statusFilter}
 onChange={(e) => {
 setStatusFilter(e.target.value);
 setCurrentPage(1); // Reset to page 1 on filter
 }}
 className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-gray-300 text-sm rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none appearance-none"
 >
 <option value="">All Statuses</option>
 <option value="Booked">Booked</option>
 <option value="Completed">Completed</option>
 <option value="Cancelled">Cancelled</option>
 </select>
 </div>

 </div>

 {/* Table Section */}
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl shadow-sm border border-gray-200 overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm text-gray-600">
 <thead className="bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-b border-gray-200 text-gray-700 text-xs uppercase font-semibold">
 <tr>
 <th className="px-6 py-4">Booking No</th>
 <th className="px-6 py-4">Customer Name</th>
 <th className="px-6 py-4">Service</th>
 <th className="px-6 py-4">Date & Time</th>
 <th className="px-6 py-4">Amount</th>
 <th className="px-6 py-4">Payment</th>
 <th className="px-6 py-4">Status</th>
 <th className="px-6 py-4 text-center">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-100">
 {loading ? (
 <tr>
 <td colSpan="8" className="px-6 py-10 text-center">
 <div className="flex justify-center items-center gap-2 text-gray-500">
 <svg className="animate-spin h-5 w-5 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
 </svg>
 Loading bookings...
 </div>
 </td>
 </tr>
 ) : bookings.length === 0 ? (
 <tr>
 <td colSpan="8" className="px-6 py-10 text-center text-gray-500">
 No bookings found matching your criteria.
 </td>
 </tr>
 ) : (
 bookings.map((booking) => (
 <tr key={booking._id} className="hover:bg-amber-50/30 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors">
 <td className="px-6 py-4 font-bold text-gray-800">{booking.bookingNumber}</td>
 <td className="px-6 py-4 font-medium">{booking.customerName}</td>
 <td className="px-6 py-4 text-amber-800 font-medium">{booking.service}</td>
 <td className="px-6 py-4 whitespace-nowrap">
 {new Date(booking.bookingDate).toLocaleString()}
 </td>
 <td className="px-6 py-4 font-bold text-gray-800">
 <div className="flex items-center">
 <FaRupeeSign size={10} className="mr-0.5" />
 {booking.amount}
 </div>
 </td>
 <td className="px-6 py-4">
 <span className="text-xs font-semibold bg-gray-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-gray-200 px-2 py-1 rounded text-gray-600">
 {booking.paymentMethod}
 </span>
 </td>
 <td className="px-6 py-4">
 {getStatusBadge(booking.status)}
 </td>
 <td className="px-6 py-4">
 <div className="flex items-center justify-center gap-2">
 <button 
 className="p-1.5 text-blue-600 bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-md transition-colors"
 title="View Details"
 onClick={() => toast.info(`Viewing details for ${booking.bookingNumber}`)}
 >
 <FaEye />
 </button>
 
 {booking.status !== "Cancelled" && (
 <button 
 className="p-1.5 text-red-600 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-md transition-colors"
 title="Cancel Booking"
 onClick={() => handleCancelBooking(booking._id)}
 >
 <FaTimesCircle />
 </button>
 )}
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 
 {/* Pagination */}
 {!loading && totalPages > 1 && (
 <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <span className="text-sm text-gray-500">
 Showing page <span className="font-semibold text-gray-800">{currentPage}</span> of <span className="font-semibold text-gray-800">{totalPages}</span>
 </span>
 
 <div className="flex gap-2">
 <button 
 onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
 disabled={currentPage === 1}
 className="p-2 border border-gray-300 rounded bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors"
 >
 <FaChevronLeft size={12} />
 </button>
 
 <button 
 onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
 disabled={currentPage === totalPages}
 className="p-2 border border-gray-300 rounded bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors"
 >
 <FaChevronRight size={12} />
 </button>
 </div>
 </div>
 )}
 </div>

 </div>
 );
};

export default MyBookingsPage;
