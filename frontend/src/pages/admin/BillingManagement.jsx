import React, { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { 
 FaRupeeSign, 
 FaDonate, 
 FaBoxes, 
 FaBed, 
 FaFilePdf, 
 FaCalendarAlt, 
 FaCreditCard, 
 FaCheckCircle, 
 FaChartLine,
 FaExchangeAlt
} from "react-icons/fa";
import { MdTempleBuddhist, MdOutlinePayments } from "react-icons/md";
import { getDevoteeBookings, getDevoteeDonations, getPrasadamOrders } from "../../services/devoteeService";

const formatCurrency = (value) => `₹ ${Number(value || 0).toLocaleString("en-IN")}`;

const BillingManagement = () => {
 const [bookings, setBookings] = useState([]);
 const [donations, setDonations] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [loading, setLoading] = useState(true);
 const [fromDate, setFromDate] = useState(() => {
 const d = new Date();
 d.setDate(d.getDate() - 30);
 return d.toISOString().split("T")[0];
 });
 const [toDate, setToDate] = useState(() => {
 return new Date().toISOString().split("T")[0];
 });

 useEffect(() => {
 const loadData = async () => {
 try {
 const [bookingRes, donationRes, prasadamRes] = await Promise.all([
 getDevoteeBookings(),
 getDevoteeDonations(),
 getPrasadamOrders(),
 ]);
 setBookings(bookingRes.bookings || []);
 setDonations(donationRes.donations || []);
 setPrasadamOrders(prasadamRes.orders || []);
 } catch (error) {
 console.warn("Unable to load billing data", error);
 } finally {
 setLoading(false);
 }
 };
 loadData();
 }, []);

 const bookingRevenue = useMemo(
 () => bookings.reduce((total, item) => total + Number(item.amount || 0), 0),
 [bookings]
 );

 const donationRevenue = useMemo(
 () => donations.reduce((total, item) => total + Number(item.amount || 0), 0),
 [donations]
 );

 const prasadamRevenue = useMemo(
 () => prasadamOrders.reduce((total, item) => total + Number(item.amount || item.totalPrice || 0), 0),
 [prasadamOrders]
 );

 const totalRevenue = bookingRevenue + donationRevenue + prasadamRevenue;

 const filterByDate = (item, dateKeys) => {
 const rawDate = dateKeys.map((key) => item[key]).find(Boolean);
 if (!rawDate) return false;
 const parsed = new Date(rawDate).toISOString().split("T")[0];
 return (!fromDate || parsed >= fromDate) && (!toDate || parsed <= toDate);
 };

 const filteredBookings = useMemo(
 () => bookings.filter((item) => filterByDate(item, ["createdAt", "datetime"])),
 [bookings, fromDate, toDate]
 );

 const filteredDonations = useMemo(
 () => donations.filter((item) => filterByDate(item, ["createdAt", "date"])),
 [donations, fromDate, toDate]
 );

 const filteredPrasadamOrders = useMemo(
 () => prasadamOrders.filter((item) => filterByDate(item, ["createdAt", "orderDate", "date"])),
 [prasadamOrders, fromDate, toDate]
 );

 const reportBookingRevenue = useMemo(
 () => filteredBookings.reduce((total, item) => total + Number(item.amount || 0), 0),
 [filteredBookings]
 );

 const reportDonationRevenue = useMemo(
 () => filteredDonations.reduce((total, item) => total + Number(item.amount || 0), 0),
 [filteredDonations]
 );

 const reportPrasadamRevenue = useMemo(
 () => filteredPrasadamOrders.reduce((total, item) => total + Number(item.amount || item.totalPrice || 0), 0),
 [filteredPrasadamOrders]
 );

 const reportRevenue = reportBookingRevenue + reportDonationRevenue + reportPrasadamRevenue;

 const paymentMethods = useMemo(() => {
 const methodCounts = {};
 donations.forEach((item) => {
 const method = item.paymentMethod || "UPI";
 methodCounts[method] = (methodCounts[method] || 0) + 1;
 });
 prasadamOrders.forEach((item) => {
 const method = item.paymentMethod || "UPI";
 methodCounts[method] = (methodCounts[method] || 0) + 1;
 });
 return Object.entries(methodCounts).map(([method, count]) => ({ method, count }));
 }, [donations, prasadamOrders]);

 const recentTransactions = useMemo(() => {
 const mapped = [
 ...bookings.map((item) => ({
 id: item._id,
 category: "Pooja Booking",
 description: item.service || "Pooja Seva",
 amount: Number(item.amount || 0),
 paymentMethod: item.paymentMethod || "Offline",
 status: item.status || "Pending",
 date: item.createdAt || item.datetime || "",
 })),
 ...donations.map((item) => ({
 id: item._id,
 category: item.category || "Donation",
 description: item.notes || item.transactionId || "Temple Contribution",
 amount: Number(item.amount || 0),
 paymentMethod: item.paymentMethod || "UPI",
 status: item.status || "Completed",
 date: item.createdAt || "",
 })),
 ...prasadamOrders.map((item) => ({
 id: item._id,
 category: "Prasadam Order",
 description: item.itemName || "Prasadam Items",
 amount: Number(item.amount || item.totalPrice || 0),
 paymentMethod: item.paymentMethod || "UPI",
 status: item.status || "Pending",
 date: item.createdAt || item.orderDate || "",
 })),
 ];
 return mapped
 .sort((a, b) => new Date(b.date) - new Date(a.date))
 .slice(0, 10);
 }, [bookings, donations, prasadamOrders]);

 const reportTransactions = useMemo(() => {
 const mapped = [
 ...filteredBookings.map((item) => ({
 id: item._id,
 category: "Pooja Booking",
 description: item.service || "Pooja Seva",
 amount: Number(item.amount || 0),
 paymentMethod: item.paymentMethod || "Offline",
 status: item.status || "Pending",
 date: item.createdAt || item.datetime || "",
 })),
 ...filteredDonations.map((item) => ({
 id: item._id,
 category: item.category || "Donation",
 description: item.notes || item.transactionId || "Temple Contribution",
 amount: Number(item.amount || 0),
 paymentMethod: item.paymentMethod || "UPI",
 status: item.status || "Completed",
 date: item.createdAt || "",
 })),
 ...filteredPrasadamOrders.map((item) => ({
 id: item._id,
 category: "Prasadam Order",
 description: item.itemName || "Prasadam Items",
 amount: Number(item.amount || item.totalPrice || 0),
 paymentMethod: item.paymentMethod || "UPI",
 status: item.status || "Pending",
 date: item.createdAt || item.orderDate || "",
 })),
 ];
 return mapped.sort((a, b) => new Date(b.date) - new Date(a.date));
 }, [filteredBookings, filteredDonations, filteredPrasadamOrders]);

 const downloadPdfFile = (filename, lines) => {
 const doc = new jsPDF();
 let y = 20;
 doc.setFontSize(16);
 doc.text("Sri Shanti Mahadev Mandir - Billing & Financial Report", 20, y);
 doc.setFontSize(11);
 y += 10;

 lines.forEach((line) => {
 const split = doc.splitTextToSize(String(line), 170);
 split.forEach((text) => {
 if (y > 280) {
 doc.addPage();
 y = 20;
 }
 doc.text(text, 20, y);
 y += 8;
 });
 });
 doc.save(filename);
 };

 const handleDownloadReport = () => {
 const lines = [
 `Report Period: ${fromDate} to ${toDate}`,
 `Generated: ${new Date().toLocaleString()}`,
 "",
 "--- FINANCIAL SUMMARY ---",
 `Total Revenue: ${formatCurrency(reportRevenue)}`,
 `Pooja Booking Revenue: ${formatCurrency(reportBookingRevenue)}`,
 `Donation Revenue: ${formatCurrency(reportDonationRevenue)}`,
 `Prasadam Revenue: ${formatCurrency(reportPrasadamRevenue)}`,
 `Total Transactions in Range: ${reportTransactions.length}`,
 "",
 "--- TRANSACTION DETAILS ---",
 ];

 if (reportTransactions.length === 0) {
 lines.push("No transactions found for this period.");
 } else {
 reportTransactions.forEach((item) => {
 lines.push(
 `${item.date ? new Date(item.date).toLocaleDateString() : "-"} | ${item.category} | ${item.description} | ${formatCurrency(item.amount)} | ${item.paymentMethod} | ${item.status}`
 );
 });
 }

 downloadPdfFile(`temple-billing-report-${fromDate}-to-${toDate}.pdf`, lines);
 };

 const handlePresetFilter = (days) => {
 const today = new Date();
 const endStr = today.toISOString().split("T")[0];
 const start = new Date(today);
 start.setDate(today.getDate() - days);
 const startStr = start.toISOString().split("T")[0];
 setFromDate(startStr);
 setToDate(endStr);
 };

 return (
 <div className="mt-5 space-y-6 text-slate-800 dark:text-slate-200 ">
 {/* HERO BANNER */}
 <div className="relative overflow-hidden rounded-[32px] border border-amber-200/60 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 p-8 shadow-md backdrop-blur-md">
 <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
 <div className="max-w-2xl">
 <div className="flex items-center gap-2 text-xs uppercase tracking-[0.32em] font-extrabold text-amber-800">
 <MdOutlinePayments size={18} /> Financial Command Center
 </div>
 <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-slate-200 ">
 Billing & Payments
 </h1>
 <p className="mt-2 text-[#7a4918] font-medium text-base">
 Unified financial overview for Sri Shanti Mahadev Mandir: Pooja Bookings, Donations, Prasadam Sales, and Room Allocations.
 </p>
 </div>
 <div className="flex flex-wrap items-center gap-3">
 <div className="flex items-center gap-2 rounded-2xl bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-300 px-4 py-2.5 text-xs font-black text-amber-900 shadow-xs">
 <span className="h-2.5 w-2.5 rounded-full bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 animate-pulse" /> Live Ledger Sync
 </div>
 <button
 onClick={handleDownloadReport}
 className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-6 py-3 font-extrabold text-white shadow-md transition hover:bg-amber-700 hover:scale-105"
 >
 <FaFilePdf size={16} /> Download Report PDF
 </button>
 </div>
 </div>
 </div>

 {/* DATE RANGE FILTER BAR */}
 <div className="rounded-[28px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
 <div className="flex flex-wrap items-center gap-4">
 <div className="flex items-center gap-2">
 <FaCalendarAlt className="text-amber-700" />
 <label htmlFor="fromDate" className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 ">From</label>
 <input
 id="fromDate"
 type="date"
 value={fromDate}
 onChange={(e) => setFromDate(e.target.value)}
 className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 shadow-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
 />
 </div>
 <div className="flex items-center gap-2">
 <label htmlFor="toDate" className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 ">To</label>
 <input
 id="toDate"
 type="date"
 value={toDate}
 onChange={(e) => setToDate(e.target.value)}
 className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 shadow-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
 />
 </div>
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <span className="text-xs font-extrabold text-slate-500 dark:text-slate-200 mr-1 uppercase">Quick Presets:</span>
 <button
 onClick={() => handlePresetFilter(0)}
 className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition"
 >
 Today
 </button>
 <button
 onClick={() => handlePresetFilter(7)}
 className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition"
 >
 Last 7 Days
 </button>
 <button
 onClick={() => handlePresetFilter(30)}
 className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition"
 >
 Last 30 Days
 </button>
 </div>
 </div>

 {/* TOP METRICS CARDS GRID */}
 <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
 {/* TOTAL REVENUE CARD */}
 <div className="rounded-[28px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md transition hover:-translate-y-1">
 <div className="flex items-center justify-between">
 <p className="text-xs font-black uppercase tracking-wider text-amber-800">Total Revenue</p>
 <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md">
 <FaRupeeSign size={20} />
 </div>
 </div>
 <p className="mt-4 text-3xl font-black text-slate-900 dark:text-slate-200 ">{formatCurrency(totalRevenue)}</p>
 <p className="mt-2 text-xs font-semibold text-amber-700">Combined temple income</p>
 </div>

 {/* DONATION INCOME CARD */}
 <div className="rounded-[28px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md transition hover:-translate-y-1">
 <div className="flex items-center justify-between">
 <p className="text-xs font-black uppercase tracking-wider text-emerald-800">Donations</p>
 <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
 <FaDonate size={20} />
 </div>
 </div>
 <p className="mt-4 text-3xl font-black text-slate-900 dark:text-slate-200 ">{formatCurrency(donationRevenue)}</p>
 <p className="mt-2 text-xs font-semibold text-emerald-700">{donations.length} entries recorded</p>
 </div>

 {/* PRASADAM SALES CARD */}
 <div className="rounded-[28px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md transition hover:-translate-y-1">
 <div className="flex items-center justify-between">
 <p className="text-xs font-black uppercase tracking-wider text-orange-800">Prasadam Sales</p>
 <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-md">
 <FaBoxes size={20} />
 </div>
 </div>
 <p className="mt-4 text-3xl font-black text-slate-900 dark:text-slate-200 ">{formatCurrency(prasadamRevenue)}</p>
 <p className="mt-2 text-xs font-semibold text-orange-700">{prasadamOrders.length} orders completed</p>
 </div>

 {/* POOJA BOOKINGS CARD */}
 <div className="rounded-[28px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md transition hover:-translate-y-1">
 <div className="flex items-center justify-between">
 <p className="text-xs font-black uppercase tracking-wider text-purple-800">Pooja Bookings</p>
 <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-md">
 <MdTempleBuddhist size={22} />
 </div>
 </div>
 <p className="mt-4 text-3xl font-black text-slate-900 dark:text-slate-200 ">{formatCurrency(bookingRevenue)}</p>
 <p className="mt-2 text-xs font-semibold text-purple-700">{bookings.length} sevas booked</p>
 </div>

 {/* ROOM BOOKINGS CARD */}
 <div className="rounded-[28px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md transition hover:-translate-y-1">
 <div className="flex items-center justify-between">
 <p className="text-xs font-black uppercase tracking-wider text-teal-800">Room Bookings</p>
 <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-md">
 <FaBed size={20} />
 </div>
 </div>
 <p className="mt-4 text-3xl font-black text-slate-900 dark:text-slate-200 ">{formatCurrency(0)}</p>
 <p className="mt-2 text-xs font-semibold text-teal-700">Room allotment revenue</p>
 </div>
 </div>

 {/* FILTERED PERIOD SUMMARY CARD */}
 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md">
 <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200 ">Selected Period Revenue Breakdown</h2>
 <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200 ">Filtered financial metrics from {fromDate} to {toDate}.</p>
 </div>
 <span className="rounded-full bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-300 px-4 py-1.5 text-xs font-extrabold text-amber-900">
 {reportTransactions.length} Total Transactions
 </span>
 </div>

 <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <div className="rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-xs">
 <p className="text-xs font-extrabold uppercase text-slate-500 dark:text-slate-200 ">Filtered Revenue</p>
 <p className="mt-2 text-2xl font-black text-amber-700">{formatCurrency(reportRevenue)}</p>
 </div>
 <div className="rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-xs">
 <p className="text-xs font-extrabold uppercase text-slate-500 dark:text-slate-200 ">Booking Revenue</p>
 <p className="mt-2 text-2xl font-black text-purple-700">{formatCurrency(reportBookingRevenue)}</p>
 </div>
 <div className="rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-xs">
 <p className="text-xs font-extrabold uppercase text-slate-500 dark:text-slate-200 ">Donation Revenue</p>
 <p className="mt-2 text-2xl font-black text-emerald-700">{formatCurrency(reportDonationRevenue)}</p>
 </div>
 <div className="rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-xs">
 <p className="text-xs font-extrabold uppercase text-slate-500 dark:text-slate-200 ">Prasadam Revenue</p>
 <p className="mt-2 text-2xl font-black text-orange-700">{formatCurrency(reportPrasadamRevenue)}</p>
 </div>
 </div>
 </div>

 {/* TRANSACTIONS & PAYMENT METHODS GRID */}
 <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
 {/* RECENT TRANSACTIONS TABLE CARD */}
 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md">
 <div className="flex items-center justify-between mb-5">
 <div>
 <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200 ">Recent Transactions</h2>
 <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200 ">Real-time payment logs across all channels.</p>
 </div>
 <span className="rounded-full bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-300 px-3.5 py-1 text-xs font-extrabold text-amber-900">
 {recentTransactions.length} Latest
 </span>
 </div>

 <div className="overflow-x-auto rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200 ">
 <thead className="bg-amber-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b border-amber-200/80 text-amber-950 font-black">
 <tr>
 <th className="px-4 py-3.5">Category</th>
 <th className="px-4 py-3.5">Description</th>
 <th className="px-4 py-3.5">Amount</th>
 <th className="px-4 py-3.5">Payment</th>
 <th className="px-4 py-3.5">Status</th>
 <th className="px-4 py-3.5">Date</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-amber-100">
 {loading ? (
 <tr><td colSpan="6" className="px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-200 ">Loading live transactions…</td></tr>
 ) : recentTransactions.length === 0 ? (
 <tr><td colSpan="6" className="px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-200 ">No transactions recorded yet.</td></tr>
 ) : (
 recentTransactions.map((item, idx) => (
 <tr key={`${item.id}-${idx}`} className="hover:bg-amber-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition">
 <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-slate-200 ">{item.category}</td>
 <td className="px-4 py-3.5 text-slate-600 dark:text-slate-200 max-w-[200px] truncate font-medium">{item.description}</td>
 <td className="px-4 py-3.5 font-black text-amber-700">{formatCurrency(item.amount)}</td>
 <td className="px-4 py-3.5 font-semibold text-slate-700 dark:text-slate-200 ">{item.paymentMethod}</td>
 <td className="px-4 py-3.5">
 <span className={`rounded-lg px-2.5 py-1 text-xs font-black border ${ item.status === "Completed" || item.status === "Confirmed" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800 border-emerald-300" : item.status === "Pending" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-800 border-amber-300" : "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-800 border-rose-300" }`}>
 {item.status}
 </span>
 </td>
 <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-200 font-medium">{item.date ? new Date(item.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"}</td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* PAYMENT METHODS & INSIGHTS WIDGETS */}
 <div className="space-y-6">
 {/* PAYMENT METHODS CARD */}
 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md">
 <div className="flex items-center gap-2 text-2xl font-black text-slate-800 dark:text-slate-200 mb-1">
 <FaCreditCard className="text-amber-600" /> Payment Methods
 </div>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 mb-5">Channel distribution across transactions.</p>
 
 <div className="space-y-3">
 {paymentMethods.length > 0 ? paymentMethods.map((method) => (
 <div key={method.method} className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-xs">
 <span className="font-extrabold text-slate-800 dark:text-slate-200 ">{method.method}</span>
 <span className="rounded-xl bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-300 px-3 py-1 text-xs font-black text-amber-900">
 {method.count} Receipts
 </span>
 </div>
 )) : (
 <div className="p-4 rounded-xl bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 text-center text-xs font-semibold text-slate-400">
 No payment methods tracked yet.
 </div>
 )}
 </div>
 </div>

 {/* SYSTEM INSIGHTS CARD */}
 <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-md">
 <div className="flex items-center gap-2 text-2xl font-black text-slate-800 dark:text-slate-200 mb-1">
 <FaChartLine className="text-amber-600" /> Billing Insights
 </div>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 mb-5">Transaction counts by module.</p>
 
 <div className="space-y-3">
 <div className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-xs">
 <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 uppercase">Pooja Seva Bookings</span>
 <span className="text-lg font-black text-purple-700">{bookings.length}</span>
 </div>
 <div className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-xs">
 <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 uppercase">Devotee Donations</span>
 <span className="text-lg font-black text-emerald-700">{donations.length}</span>
 </div>
 <div className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-xs">
 <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 uppercase">Prasadam Counter Orders</span>
 <span className="text-lg font-black text-orange-700">{prasadamOrders.length}</span>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default BillingManagement;
