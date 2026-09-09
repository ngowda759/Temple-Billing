import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
 MdCalendarMonth,
 MdOutlineCalendarToday,
 MdOutlineTaskAlt,
 MdOutlineVerified,
 MdOutlineCurrencyRupee,
 MdOutlineSearch,
 MdOutlineClose,
} from "react-icons/md";
import { FaDownload } from "react-icons/fa6";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadReceiptPDF } from "../../utils/receiptGenerator";
import { getDevoteeDonations } from "../../services/devoteeService";
import { getDashboardBookings, updateBookingStatusAdmin, getBookingReceipt } from "../../services/bookingService";
import { getPoojaTypes, savePoojaType, updatePoojaType, removePoojaType } from "../../services/poojaTypeService";
import PoojaTypeSetupModal from "./components/PoojaTypeSetupModal";

const formatCurrency = (value) => `Rs ${Number(value || 0).toLocaleString()}`;

const statusTheme = {
 Confirmed: "bg-[#e8f6e9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#187a3b] dark:text-slate-200 ",
 Pending: "bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ea580c] dark:text-slate-200 ",
 Booked: "bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ea580c] dark:text-slate-200 ",
 Approved: "bg-[#e0f2fe] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#0369a1] dark:text-slate-200 ",
 Assigned: "bg-[#ede9fe] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#6d28d9] dark:text-slate-200 ",
 "In Progress": "bg-[#fef3c7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#92400e] dark:text-slate-200 ",
 Completed: "bg-[#e9efff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#2454c9] dark:text-slate-200 ",
 Rejected: "bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#a12525] dark:text-slate-200 ",
 Cancelled: "bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#a12525] dark:text-slate-200 ",
};

const PoojaManagement = () => {
 const [bookings, setBookings] = useState([]);
 const [statsData, setStatsData] = useState(null);
 const [donations, setDonations] = useState([]);
 const [query, setQuery] = useState("");
 const [poojaTypes, setPoojaTypes] = useState([]);
 const [editingType, setEditingType] = useState(null);
 const [showTypeModal, setShowTypeModal] = useState(false);
 const [viewingBooking, setViewingBooking] = useState(null);

 const loadPoojaTypes = async () => {
 const data = await getPoojaTypes();
 setPoojaTypes(data.poojas || data || []);
 };

 useEffect(() => {
 loadPoojaTypes();
 }, []);

 const handleSaveType = async (payload) => {
 try {
 if (editingType) {
 await updatePoojaType(editingType._id, payload);
 } else {
 await savePoojaType(payload);
 }
 await loadPoojaTypes();
 setShowTypeModal(false);
 setEditingType(null);
 } catch (err) {
 alert("Error saving Pooja: " + (err.response?.data?.message || err.message));
 }
 };

 const handleEditType = (type) => {
 setEditingType(type);
 setShowTypeModal(true);
 };

 const handleDeleteType = async (id) => {
 if (window.confirm("Are you sure you want to delete this Pooja?")) {
 await removePoojaType(id);
 await loadPoojaTypes();
 }
 };

 useEffect(() => {
 const load = async () => {
 try {
 const [bRes, dRes] = await Promise.all([getDashboardBookings(), getDevoteeDonations()]);
 setBookings(bRes.latestBookings || []);
 setStatsData(bRes.stats || null);
 setDonations(dRes.donations || []);
 } catch (error) {
 console.warn("Unable to load pooja management data", error);
 }
 };
 load();
 }, []);

 const reloadData = async () => {
 const [bRes, dRes] = await Promise.all([getDashboardBookings(), getDevoteeDonations()]);
 setBookings(bRes.latestBookings || []);
 setStatsData(bRes.stats || null);
 setDonations(dRes.donations || []);
 };

 const handleStatusChange = async (id, status) => {
 try {
 await updateBookingStatusAdmin(id, status);
 await reloadData();
 } catch (error) {
 console.warn("Unable to update booking status", error);
 }
 };

 const handleDownloadReceipt = async (row) => {
 try {
 const rawBooking = row.raw || {};
 
 let poojaBookings = [];
 let prasadamOrders = [];
 if (rawBooking.isCombined && rawBooking.items && rawBooking.items.length > 0) {
 poojaBookings = rawBooking.items.filter(i => i.type !== "prasadam").map((i, idx) => ({
 slNo: idx + 1,
 name: i.description || i.name,
 date: i.date || (rawBooking.datetime ? new Date(rawBooking.datetime).toLocaleDateString() : "-"),
 qty: i.quantity || 1,
 amount: (i.price || 0) * (i.quantity || 1)
 }));
 prasadamOrders = rawBooking.items.filter(i => i.type === "prasadam").map((i, idx) => ({
 slNo: idx + 1,
 name: i.description || i.name,
 date: "-",
 qty: i.quantity || 1,
 amount: (i.price || 0) * (i.quantity || 1)
 }));
 } else {
 poojaBookings = [{
 slNo: 1,
 name: rawBooking.service || "Pooja Booking",
 date: rawBooking.datetime ? new Date(rawBooking.datetime).toLocaleDateString() : "-",
 qty: 1,
 amount: rawBooking.amount || 0
 }];
 }

 const receiptPayload = {
 isOnline: rawBooking.source === "Online Portal" || false,
 receiptNo: row.receiptId || `RC-BK${String(rawBooking._id || '').slice(-6).toUpperCase()}`,
 bookingDate: rawBooking.createdAt ? new Date(rawBooking.createdAt).toLocaleDateString() : new Date().toLocaleDateString(),
 paymentMode: row.method || rawBooking.paymentMethod || "UPI",
 transactionId: rawBooking.transactionId || "-",
 cashierName: "Admin",
 devoteeName: row.devotee || rawBooking.devoteeName || rawBooking.customerName || "-",
 mobile: rawBooking.devoteePhone || rawBooking.contactNumber || "-",
 email: rawBooking.devoteeEmail || "-",
 address: rawBooking.devoteeAddress || "-",
 poojaBookings,
 prasadamOrders,
 subTotal: rawBooking.amount || 0,
 templeCharges: 0,
 grandTotal: (rawBooking.amount || 0) + (rawBooking.gst || 0),
 amountInWords: `Rs. ${(rawBooking.amount || 0) + (rawBooking.gst || 0)}`,
 devoteeMaterials: [],
 templeMaterials: [],
 notes: rawBooking.notes ? [String(rawBooking.notes)] : []
 };

 await downloadReceiptPDF(receiptPayload, `receipt-${receiptPayload.receiptNo}.pdf`);

 } catch (error) {
 console.error("Error generating receipt:", error);
 alert("Failed to generate receipt. Please try again.");
 }
 };

 const filteredBookings = useMemo(() => {
 const q = query.trim().toLowerCase();
 const rows = bookings.map((b, idx) => ({
 id: `BK${b._id ? String(b._id).slice(-6).toUpperCase() : String(1000 + idx + 1)}`,
 devotee: b.devoteeName || b.customerName,
 pooja: b.service,
 date: b.datetime ? new Date(b.datetime).toLocaleDateString() : "-",
 slot: b.datetime ? new Date(b.datetime).toLocaleTimeString() : "-",
 amount: Number(b.amount || 0),
 status: b.status || "Pending",
 createdAt: b.createdAt,
 raw: b,
 }));
 if (!q) return rows;
 return rows.filter((r) => (r.devotee || "").toLowerCase().includes(q) || (r.pooja || "").toLowerCase().includes(q) || (r.id || "").toLowerCase().includes(q));
 }, [bookings, query]);

 const todays = statsData?.todays || 0;
 const upcoming = statsData?.upcoming || 0;
 const completed = statsData?.completed || 0;
 const revenue = statsData?.totalRevenue || 0;

 const stats = [
 { title: "Today's Bookings", value: todays, icon: MdOutlineCalendarToday, iconBg: "bg-[#fff1e2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ", iconText: "text-[#f97316]" },
 { title: "Upcoming Poojas", value: upcoming, icon: MdOutlineTaskAlt, iconBg: "bg-[#eaf6e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ", iconText: "text-[#15803d]" },
 { title: "Completed Services", value: completed, icon: MdOutlineVerified, iconBg: "bg-[#efe9ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ", iconText: "text-[#6d28d9]" },
 { title: "Booking Revenue", value: formatCurrency(revenue), icon: MdOutlineCurrencyRupee, iconBg: "bg-[#fff3db] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ", iconText: "text-[#ea580c]" },
 ];

 const receipts = filteredBookings.slice(0, 8).map((b, idx) => ({
 receiptId: `RC${String(2000 + idx + 1)}`,
 bookingId: b.id,
 devotee: b.devotee,
 amount: formatCurrency(b.amount),
 method: donations.find((d) => (d.donorName || "") === b.devotee)?.paymentMethod || "UPI",
 date: b.createdAt ? new Date(b.createdAt).toLocaleString() : "-",
 raw: b.raw,
 }));

 return (
 <div className="mt-5 space-y-4">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
 <div>
 <h1 className="text-[42px] leading-tight font-bold text-[#15141f] dark:text-slate-200 ">Pooja Booking Management</h1>
 <p className="mt-1 text-[20px] text-[#5d6674] dark:text-slate-200 ">Live pooja schedules, bookings, receipts and seva operations.</p>
 </div>

 <div className="inline-flex h-12 items-center gap-2 rounded-xl border border-[#f0e1d2] dark:border-slate-700 bg-[#fff7ee] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 text-[20px] font-semibold text-[#a64b0f] dark:text-slate-200 ">
 <MdCalendarMonth size={22} />
 {new Date().toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
 </div>
 </div>

 <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
 {stats.map((card) => {
 const Icon = card.icon;
 return (
 <div key={card.title} className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <div className="flex items-center gap-4">
 <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${card.iconBg}`}><Icon className={card.iconText} size={30} /></div>
 <div>
 <p className="text-[20px] font-medium text-[#323946] dark:text-slate-200 ">{card.title}</p>
 <p className="text-[38px] leading-none font-bold text-[#111827] dark:text-slate-200 ">{card.value}</p>
 </div>
 </div>
 </div>
 );
 })}
 </div>

 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-4 mb-4">
 <div>
 <h2 className="text-[30px] font-bold text-[#15141f] dark:text-slate-200 ">Manage Pooja Types</h2>
 <p className="mt-1 text-sm text-[#5d6674] dark:text-slate-200 ">Add, edit or remove pooja services and their booking prices.</p>
 </div>
 <button
 type="button"
 onClick={() => {
 setEditingType(null);
 setShowTypeModal(true);
 }}
 className="flex items-center gap-1.5 rounded-xl bg-[#1b7f77] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#146059]"
 >
 + Add Pooja Type
 </button>
 </div>

 <div className="mt-6 overflow-x-auto">
 <table className="w-full text-left text-sm text-[#3f3f3f] dark:text-slate-200 ">
 <thead className="bg-[#fafafa] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#575757] dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3 font-semibold">Pooja Type</th>
 <th className="px-4 py-3 font-semibold">Price</th>
 <th className="px-4 py-3 font-semibold">Actions</th>
 </tr>
 </thead>
 <tbody>
 {poojaTypes.length > 0 ? (
 poojaTypes.map((type) => (
 <tr key={type.name} className="border-t border-[#f0ece6] dark:border-slate-700 ">
 <td className="px-4 py-3 font-medium">{type.name}</td>
 <td className="px-4 py-3">{`₹ ${type.price.toLocaleString()}`}</td>
 <td className="px-4 py-3 space-x-2">
 <button type="button" onClick={() => handleEditType(type)} className="rounded-lg bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-sm font-semibold text-[#1f2937] dark:text-slate-200 hover:bg-[#f1f5f9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-600">Edit</button>
 <button type="button" onClick={() => handleDeleteType(type._id)} className="rounded-lg bg-[#fef2f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-sm font-semibold text-[#b91c1c] dark:text-slate-200 hover:bg-[#fee2e2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-rose-800/50">Delete</button>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="3" className="px-4 py-6 text-center text-[#5d5d5d] dark:text-slate-200 ">No pooja types available.</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>

 <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
 <div className="xl:col-span-8 space-y-4">
 <div className="overflow-hidden rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <div className="flex flex-col gap-3 border-b border-[#f0ece6] dark:border-slate-700 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
 <div className="flex items-center gap-4">
 <h2 className="text-[36px] font-bold text-[#15141f] dark:text-slate-200 ">Pooja Bookings</h2>
 <Link to="/admin/pooja/all-bookings" className="rounded-xl bg-[#15141f] dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">View All Bookings</Link>
 </div>
 <div className="flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 text-[#858b96] dark:text-slate-200 ">
 <MdOutlineSearch size={20} />
 <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-[220px] bg-transparent text-[16px] text-[#242938] dark:text-slate-200 outline-none placeholder:text-[#9ca3af]" placeholder="Search booking..." />
 </div>
 </div>

 <div className="overflow-auto">
 <table className="w-full min-w-[920px] text-[15px]">
 <thead className="bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#2b3240] dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3 text-left font-semibold">Booking ID</th>
 <th className="px-4 py-3 text-left font-semibold">Devotee</th>
 <th className="px-4 py-3 text-left font-semibold">Pooja</th>
 <th className="px-4 py-3 text-left font-semibold">Date</th>
 <th className="px-4 py-3 text-left font-semibold">Slot</th>
 <th className="px-4 py-3 text-left font-semibold">Amount</th>
 </tr>
 </thead>
 <tbody>
 {filteredBookings.map((row) => (
 <tr key={row.id} className="border-t border-[#f0ece6] dark:border-slate-700 text-[#2f3645] dark:text-slate-200 ">
 <td className="px-4 py-3">{row.id}</td>
 <td className="px-4 py-3 font-medium">{row.devotee}</td>
 <td className="px-4 py-3">{row.pooja}</td>
 <td className="px-4 py-3">{row.date}</td>
 <td className="px-4 py-3">{row.slot}</td>
 <td className="px-4 py-3 font-semibold">{formatCurrency(row.amount)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 <div className="overflow-auto rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <h2 className="mb-3 text-[32px] font-bold text-[#15141f] dark:text-slate-200 ">Recent Receipts</h2>
 <table className="w-full min-w-[860px] text-[15px]">
 <thead className="text-[#2b3240] dark:text-slate-200 ">
 <tr className="border-b border-[#f0ece6] dark:border-slate-700 ">
 <th className="py-2 text-left font-semibold">Receipt ID</th>
 <th className="py-2 text-left font-semibold">Booking ID</th>
 <th className="py-2 text-left font-semibold">Devotee</th>
 <th className="py-2 text-left font-semibold">Amount</th>
 <th className="py-2 text-left font-semibold">Payment Method</th>
 <th className="py-2 text-left font-semibold">Date</th>
 <th className="py-2 text-left font-semibold">Actions</th>
 </tr>
 </thead>
 <tbody>
 {receipts.map((row) => (
 <tr key={row.receiptId} className="border-b border-[#f0ece6] dark:border-slate-700 text-[#2f3645] dark:text-slate-200 ">
 <td className="py-2">{row.receiptId}</td>
 <td className="py-2">{row.bookingId}</td>
 <td className="py-2">{row.devotee}</td>
 <td className="py-2 font-semibold">{row.amount}</td>
 <td className="py-2">{row.method}</td>
 <td className="py-2">{row.date}</td>
 <td className="py-2 text-[#f97316] cursor-pointer" onClick={() => handleDownloadReceipt(row)}>
 <FaDownload />
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 <div className="xl:col-span-4 rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <h3 className="text-[30px] font-bold text-[#15141f] dark:text-slate-200 ">Booking Overview</h3>
 <div className="mt-4 space-y-2 text-[15px] text-[#2f3645] dark:text-slate-200 ">
 <div className="flex items-center justify-between"><span>Total Bookings</span><span>{statsData?.totalBookings || 0}</span></div>
 <div className="flex items-center justify-between"><span>Confirmed</span><span>{statsData?.confirmed || 0}</span></div>
 <div className="flex items-center justify-between"><span>Pending</span><span>{statsData?.pending || 0}</span></div>
 <div className="flex items-center justify-between"><span>Completed</span><span>{statsData?.completed || 0}</span></div>
 <div className="flex items-center justify-between"><span>Cancelled</span><span>{statsData?.cancelled || 0}</span></div>
 <div className="border-t border-[#f0ece6] dark:border-slate-700 pt-2"><p className="text-[14px] text-[#6b7280] dark:text-slate-200 ">Total Revenue</p><p className="text-[34px] leading-none font-bold text-[#f97316]">{formatCurrency(revenue)}</p></div>
 </div>
 </div>
 </div>

 {/* ── Manage Pooja Types Popup Modal ───────────────────────────────────── */}
 {showTypeModal && (
 <PoojaTypeSetupModal
 editingPooja={editingType}
 onClose={() => {
 setShowTypeModal(false);
 setEditingType(null);
 }}
 onSave={handleSaveType}
 />
 )}

 {/* ── Booking Details View Modal ───────────────────────────────────────── */}
 {viewingBooking && (
 <BookingDetailsModal
 booking={viewingBooking}
 onClose={() => setViewingBooking(null)}
 />
 )}
 </div>
 );
};

// Sub-component: BookingDetailsModal
const BookingDetailsModal = ({ booking, onClose }) => {
 if (!booking) return null;
 const dateStr = booking.datetime ? new Date(booking.datetime).toLocaleDateString() : "-";
 const slotStr = booking.datetime ? new Date(booking.datetime).toLocaleTimeString() : "-";
 
 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
 <div className="w-full max-w-lg rounded-3xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl relative">
 <button
 type="button"
 onClick={onClose}
 className="absolute top-4 right-4 text-[#858b96] dark:text-slate-200 hover:text-[#15141f] dark:text-slate-200 text-2xl font-bold"
 >
 &times;
 </button>
 <h3 className="text-2xl font-bold text-[#15141f] dark:text-slate-200 mb-4">Booking Details</h3>
 
 <div className="space-y-3 text-[15px] text-[#2f3645] dark:text-slate-200 ">
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Booking ID:</span>
 <span>BK{String(booking._id).slice(-6).toUpperCase()}</span>
 </div>
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Devotee Name:</span>
 <span>{booking.devoteeName || booking.customerName}</span>
 </div>
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Pooja Service:</span>
 <span>{booking.service}</span>
 </div>
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Pooja Date:</span>
 <span>{dateStr}</span>
 </div>
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Time Slot:</span>
 <span>{slotStr}</span>
 </div>
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Amount:</span>
 <span className="font-bold text-[#f97316]">Rs {Number(booking.amount || 0).toLocaleString()}</span>
 </div>
 {booking.paymentMethod && (
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Payment Method:</span>
 <span>{booking.paymentMethod}</span>
 </div>
 )}
 <div className="flex justify-between border-b border-[#f0ece6] dark:border-slate-700 pb-2">
 <span className="font-semibold text-gray-500 dark:text-slate-200 ">Status:</span>
 <span className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold ${statusTheme[booking.status] || statusTheme.Pending}`}>
 {booking.status || "Pending"}
 </span>
 </div>
 </div>
 
 <div className="mt-6 flex justify-end">
 <button
 type="button"
 onClick={onClose}
 className="rounded-2xl border border-[#d1d5db] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-2.5 text-sm font-semibold text-[#374151] dark:text-slate-200 hover:bg-[#f9fafb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Close
 </button>
 </div>
 </div>
 </div>
 );
};

export default PoojaManagement;
