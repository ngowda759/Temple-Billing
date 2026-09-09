import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { useAuth } from "../../context/AuthContext";
import {
 getAdminBookings,
 getAdminDonations,
 getAdminPrasadamOrders,
 getAdminEventOverview,
 getAdminInventoryCatalog,
 getAdminAttendanceDashboard,
 getAdminEmployees,
 getAdminEvents,
} from "../../services/adminService";
import { getAdminUsers } from "../../services/authService";

const COLORS = ["#10b981", "#f97316", "#0ea5e9", "#8b5cf6", "#facc15", "#ef4444"];

const formatCurrency = (value) => {
 return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
};

const toDate = (value) => {
 if (!value) return null;
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateInput = (date) => {
 if (!date) return "";
 const iso = date.toISOString().slice(0, 10);
 return iso;
};

const toMonthLabel = (date) => date.toLocaleString("default", { month: "short", year: "numeric" });

const normalizeAmount = (value) => {
 if (value == null) return 0;
 const numeric = Number(String(value).replace(/[^0-9.-]+/g, ""));
 return Number.isNaN(numeric) ? 0 : numeric;
};

const getPrimaryDate = (item) => {
 const candidates = ["createdAt", "datetime", "date", "orderDate", "bookingDate"];
 for (const key of candidates) {
 if (item[key]) {
 const date = toDate(item[key]);
 if (date) return date;
 }
 }
 return null;
};

const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const ReportsAnalytics = () => {
 const { token } = useAuth();
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const [bookings, setBookings] = useState([]);
 const [donations, setDonations] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [employees, setEmployees] = useState([]);
 const [users, setUsers] = useState([]);
 const [inventoryItems, setInventoryItems] = useState([]);
 const [attendanceData, setAttendanceData] = useState(null);
 const [eventOverview, setEventOverview] = useState({});
 const [events, setEvents] = useState([]);
 const [startDate, setStartDate] = useState(() => {
 const today = new Date();
 const prior = new Date(today);
 prior.setDate(today.getDate() - 30);
 return prior;
 });
 const [endDate, setEndDate] = useState(() => new Date());

 useEffect(() => {
 const loadData = async () => {
 setLoading(true);
 setError("");

 try {
 const month = getMonthKey(new Date());
 const [bookingRes, donationRes, orderRes, eventRes, inventoryRes, attendanceRes, employeeRes, usersRes, eventsRes] = await Promise.all([
 getAdminBookings(),
 getAdminDonations(),
 getAdminPrasadamOrders(),
 getAdminEventOverview(),
 getAdminInventoryCatalog(),
 getAdminAttendanceDashboard(month),
 getAdminEmployees(),
 token ? getAdminUsers(token) : Promise.resolve([]),
 getAdminEvents(),
 ]);

 setBookings(bookingRes.bookings || []);
 setDonations(donationRes.donations || []);
 setPrasadamOrders(orderRes.orders || []);
 setEventOverview(eventRes || {});
 setInventoryItems(inventoryRes.items || []);
 setAttendanceData(attendanceRes || null);
 setEmployees(Array.isArray(employeeRes) ? employeeRes : []);
 setUsers(Array.isArray(usersRes) ? usersRes : []);
 setEvents(Array.isArray(eventsRes) ? eventsRes : []);
 } catch (loadError) {
 console.error("ReportsAnalytics load failed", loadError);
 setError("Unable to load reports data. Please refresh the page.");
 } finally {
 setLoading(false);
 }
 };

 loadData();
 }, [token]);

 const normalizedStart = useMemo(() => {
 const date = toDate(startDate);
 if (!date) return null;
 date.setHours(0, 0, 0, 0);
 return date;
 }, [startDate]);

 const normalizedEnd = useMemo(() => {
 const date = toDate(endDate);
 if (!date) return null;
 date.setHours(23, 59, 59, 999);
 return date;
 }, [endDate]);

 const filteredItems = useMemo(() => {
 const rangeStart = normalizedStart;
 const rangeEnd = normalizedEnd;
 if (!rangeStart || !rangeEnd) return { bookings, donations, prasadamOrders };

 const filterRange = (item) => {
 const date = getPrimaryDate(item);
 return date && date >= rangeStart && date <= rangeEnd;
 };

 return {
 bookings: bookings.filter(filterRange),
 donations: donations.filter(filterRange),
 prasadamOrders: prasadamOrders.filter(filterRange),
 };
 }, [bookings, donations, prasadamOrders, normalizedStart, normalizedEnd]);

 const totalRevenue = useMemo(
 () =>
 filteredItems.bookings.reduce((sum, item) => sum + normalizeAmount(item.amount), 0) +
 filteredItems.donations.reduce((sum, item) => sum + normalizeAmount(item.amount), 0) +
 filteredItems.prasadamOrders.reduce((sum, item) => sum + normalizeAmount(item.amount), 0),
 [filteredItems]
 );

 const totalDonations = useMemo(() => filteredItems.donations.length, [filteredItems.donations]);
 const poojaBookings = useMemo(() => filteredItems.bookings.length, [filteredItems.bookings]);
 const totalDevotees = useMemo(() => users.filter((user) => String(user.role).toLowerCase() === "devotee").length, [users]);
 const totalEmployees = useMemo(() => employees.length, [employees]);
 const salaryExpenses = useMemo(
 () => employees.reduce((sum, item) => sum + normalizeAmount(item.salary), 0),
 [employees]
 );

 const attendanceOverview = useMemo(() => {
 if (!attendanceData) return { present: 0, absent: 0, leave: 0, attendancePercent: 0 };
 return {
 present: attendanceData.today?.presentCount || 0,
 absent: attendanceData.today?.absentCount || 0,
 leave: attendanceData.today?.leaveCount || 0,
 attendancePercent: attendanceData.today?.attendancePercent || attendanceData.summary?.attendancePercent || 0,
 };
 }, [attendanceData]);

 const bookingChartData = useMemo(() => {
 const buckets = new Map();
 filteredItems.bookings.forEach((booking) => {
 const date = getPrimaryDate(booking);
 if (!date) return;
 const key = toMonthLabel(date);
 const bucket = buckets.get(key) || { month: key, revenue: 0 };
 bucket.revenue += normalizeAmount(booking.amount);
 buckets.set(key, bucket);
 });
 filteredItems.donations.forEach((donation) => {
 const date = getPrimaryDate(donation);
 if (!date) return;
 const key = toMonthLabel(date);
 const bucket = buckets.get(key) || { month: key, revenue: 0 };
 bucket.revenue += normalizeAmount(donation.amount);
 buckets.set(key, bucket);
 });
 filteredItems.prasadamOrders.forEach((order) => {
 const date = getPrimaryDate(order);
 if (!date) return;
 const key = toMonthLabel(date);
 const bucket = buckets.get(key) || { month: key, revenue: 0 };
 bucket.revenue += normalizeAmount(order.amount);
 buckets.set(key, bucket);
 });
 return Array.from(buckets.values()).sort((a, b) => new Date(a.month) - new Date(b.month));
 }, [filteredItems]);

 const donationSources = useMemo(() => {
 const grouped = {};
 filteredItems.donations.forEach((donation) => {
 const method = donation.paymentMethod || "UPI";
 grouped[method] = (grouped[method] || 0) + normalizeAmount(donation.amount);
 });
 const total = Object.values(grouped).reduce((sum, value) => sum + value, 0);
 return Object.entries(grouped).map(([method, amount], index) => ({
 name: method,
 value: total ? Math.round((amount / total) * 100) : 0,
 amount,
 color: COLORS[index % COLORS.length],
 }));
 }, [filteredItems.donations]);

 const poojaBookingAnalytics = useMemo(() => {
 const grouped = {};
 filteredItems.bookings.forEach((booking) => {
 const service = booking.service || "Unknown";
 grouped[service] = grouped[service] || { count: 0, revenue: 0 };
 grouped[service].count += 1;
 grouped[service].revenue += normalizeAmount(booking.amount);
 });
 return Object.entries(grouped)
 .map(([service, stats]) => ({ service, ...stats }))
 .sort((a, b) => b.count - a.count)
 .slice(0, 6);
 }, [filteredItems.bookings]);

 const festivalDonations = useMemo(
 () => filteredItems.donations.filter((donation) => donation.eventId).reduce((sum, donation) => sum + normalizeAmount(donation.amount), 0),
 [filteredItems.donations]
 );

 const upcomingFestivals = useMemo(
 () => events.filter((event) => String(event.status).toLowerCase() === "upcoming").length,
 [events]
 );

 const completedFestivals = useMemo(
 () => events.filter((event) => String(event.status).toLowerCase() === "completed").length,
 [events]
 );

 const activeDevotees = useMemo(() => {
 const activeEmails = new Set();
 const threshold = new Date();
 threshold.setDate(threshold.getDate() - 30);
 [...filteredItems.bookings, ...filteredItems.donations].forEach((item) => {
 if (!item.devoteeEmail && !item.email) return;
 const date = getPrimaryDate(item);
 if (!date || date < threshold) return;
 activeEmails.add((item.devoteeEmail || item.email || "").toLowerCase());
 });
 return activeEmails.size;
 }, [filteredItems.bookings, filteredItems.donations]);

 const newThisMonth = useMemo(() => {
 const now = new Date();
 return users.filter((user) => {
 const created = toDate(user.createdAt);
 return created && created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
 }).length;
 }, [users]);

 const recentTransactions = useMemo(() => {
 const mapped = [
 ...filteredItems.bookings.map((item) => ({
 id: item._id || item.id,
 date: getPrimaryDate(item),
 type: "Pooja",
 description: item.service || "Pooja Booking",
 amount: normalizeAmount(item.amount),
 })),
 ...filteredItems.donations.map((item) => ({
 id: item._id || item.id,
 date: getPrimaryDate(item),
 type: "Donation",
 description: item.donorName || item.category || "Donation",
 amount: normalizeAmount(item.amount),
 })),
 ...filteredItems.prasadamOrders.map((item) => ({
 id: item._id || item.id,
 date: getPrimaryDate(item),
 type: "Sale",
 description: item.itemName || "Prasadam Sale",
 amount: normalizeAmount(item.amount),
 })),
 ];
 return mapped
 .filter((item) => item.date)
 .sort((a, b) => b.date - a.date)
 .slice(0, 8);
 }, [filteredItems]);

 const reportsSummary = [
 { title: "Daily Collection Report", description: "Today's donations, bookings and revenue" },
 { title: "Donation Report", description: "Donor name, amount, date and payment mode" },
 { title: "Inventory Report", description: "Item stock, availability and low stock items" },
 { title: "Employee Attendance Report", description: "Present, absent, leave and attendance percentage" },
 ];

 const summaryCards = [
 { title: "Total Revenue", value: formatCurrency(totalRevenue), subtitle: "Donations + bookings + prasadam" },
 { title: "Total Donations", value: formatCurrency(filteredItems.donations.reduce((sum, item) => sum + normalizeAmount(item.amount), 0)), subtitle: `${totalDonations} donations` },
 { title: "Pooja Bookings", value: poojaBookings, subtitle: "Total bookings" },
 { title: "Total Devotees", value: totalDevotees, subtitle: "Registered devotees" },
 { title: "Total Employees", value: totalEmployees, subtitle: "Temple staff count" },
 { title: "Monthly Expenses", value: formatCurrency(salaryExpenses), subtitle: "Salary expense only" },
 ];

 const attendancePieData = [
 { name: "Present", value: attendanceOverview.present, color: "#22c55e" },
 { name: "Absent", value: attendanceOverview.absent, color: "#f97316" },
 { name: "Leave", value: attendanceOverview.leave, color: "#3b82f6" },
 ];

 const handleDownloadPdf = () => {
 const doc = new jsPDF({ unit: "pt", format: "a4" });
 let y = 40;
 doc.setFontSize(20);
 doc.text("Reports & Analytics", 40, y);
 doc.setFontSize(11);
 y += 30;
 doc.text(`Date range: ${formatDateInput(normalizedStart)} - ${formatDateInput(normalizedEnd)}`, 40, y);
 y += 25;

 const lines = [
 `Total Revenue: ${formatCurrency(totalRevenue)}`,
 `Total Donations: ${formatCurrency(filteredItems.donations.reduce((sum, item) => sum + normalizeAmount(item.amount), 0))}`,
 `Pooja Bookings: ${poojaBookings}`,
 `Total Devotees: ${totalDevotees}`,
 `Total Employees: ${totalEmployees}`,
 `Monthly Expenses: ${formatCurrency(salaryExpenses)}`,
 `Attendance rate: ${attendanceOverview.attendancePercent}%`,
 `Upcoming Festivals: ${upcomingFestivals}`,
 `Completed Festivals: ${completedFestivals}`,
 `Festival Revenue: ${formatCurrency(eventOverview.festivalRevenue || 0)}`,
 `Festival Donations: ${formatCurrency(festivalDonations)}`,
 `New Devotees This Month: ${newThisMonth}`,
 `Active Devotees: ${activeDevotees}`,
 ];

 lines.forEach((line) => {
 doc.text(line, 40, y);
 y += 18;
 if (y > 740) {
 doc.addPage();
 y = 40;
 }
 });

 y += 20;
 doc.setFontSize(14);
 doc.text("Recent Transactions", 40, y);
 y += 20;
 doc.setFontSize(10);
 recentTransactions.slice(0, 12).forEach((item) => {
 const text = `${item.date ? item.date.toLocaleDateString() : "-"} | ${item.type} | ${item.description} | ${formatCurrency(item.amount)}`;
 doc.text(text, 40, y);
 y += 16;
 if (y > 740) {
 doc.addPage();
 y = 40;
 }
 });

 doc.save(`temple-reports-${formatDateInput(normalizedStart)}-to-${formatDateInput(normalizedEnd)}.pdf`);
 };

 const handleDownloadExcel = () => {
 const workbook = XLSX.utils.book_new();

 const summarySheet = XLSX.utils.aoa_to_sheet([
 ["Metric", "Value"],
 ["Date range", `${formatDateInput(normalizedStart)} - ${formatDateInput(normalizedEnd)}`],
 ["Total Revenue", formatCurrency(totalRevenue)],
 ["Total Donations", totalDonations],
 ["Pooja Bookings", poojaBookings],
 ["Total Devotees", totalDevotees],
 ["Total Employees", totalEmployees],
 ["Monthly Expenses", formatCurrency(salaryExpenses)],
 ["Attendance %", `${attendanceOverview.attendancePercent}%`],
 ["Upcoming Festivals", upcomingFestivals],
 ["Completed Festivals", completedFestivals],
 ["Festival Revenue", formatCurrency(eventOverview.festivalRevenue || 0)],
 ["Festival Donations", formatCurrency(festivalDonations)],
 ["New This Month", newThisMonth],
 ["Active Devotees", activeDevotees],
 ]);
 XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

 const donationRows = filteredItems.donations.map((item) => ({
 "Donor Name": item.donorName || item.donorEmail || "Unknown",
 Amount: normalizeAmount(item.amount),
 Date: formatDateInput(getPrimaryDate(item)),
 Mode: item.paymentMethod || "UPI",
 }));
 XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(donationRows), "Donation Report");

 const inventoryRows = inventoryItems.map((item) => ({
 "Item Name": item.name,
 Stock: item.stock ?? "Unknown",
 Status: item.status || "Unknown",
 }));
 XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(inventoryRows), "Inventory Report");

 const attendanceRows = [
 { Metric: "Present", Value: attendanceOverview.present },
 { Metric: "Absent", Value: attendanceOverview.absent },
 { Metric: "Leave", Value: attendanceOverview.leave },
 { Metric: "Attendance %", Value: `${attendanceOverview.attendancePercent}%` },
 ];
 XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceRows), "Attendance Report");

 XLSX.writeFile(workbook, `temple-reports-${formatDateInput(normalizedStart)}-to-${formatDateInput(normalizedEnd)}.xlsx`);
 };

 const handlePrint = () => {
 window.print();
 };

 const revenueChart = useMemo(() => bookingChartData.length ? bookingChartData : [{ month: "No data", revenue: 0 }], [bookingChartData]);

 return (
 <div className="mt-5 space-y-8">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-8 shadow-sm">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <div>
 <h1 className="text-[34px] font-bold text-[#111827] dark:text-slate-200 ">Reports & Analytics</h1>
 <p className="mt-2 max-w-2xl text-sm leading-6 text-[#475569] dark:text-slate-200 ">
 Detailed temple performance metrics, finance analytics and report exports for the selected date range.
 </p>
 </div>
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
 <div className="grid gap-3 sm:grid-cols-2">
 <label className="flex flex-col text-sm text-[#334155] dark:text-slate-200 ">
 From
 <input
 type="date"
 value={formatDateInput(normalizedStart)}
 onChange={(e) => setStartDate(e.target.value)}
 className="mt-2 rounded-2xl border border-[#cbd5e1] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm text-[#0f172a] dark:text-slate-200 outline-none"
 />
 </label>
 <label className="flex flex-col text-sm text-[#334155] dark:text-slate-200 ">
 To
 <input
 type="date"
 value={formatDateInput(normalizedEnd)}
 onChange={(e) => setEndDate(e.target.value)}
 className="mt-2 rounded-2xl border border-[#cbd5e1] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm text-[#0f172a] dark:text-slate-200 outline-none"
 />
 </label>
 </div>
 <div className="flex flex-wrap gap-3">
 <button
 onClick={handleDownloadPdf}
 className="inline-flex items-center justify-center rounded-2xl bg-[#2563eb] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d4ed8]"
 >
 Download PDF
 </button>
 <button
 onClick={handleDownloadExcel}
 className="inline-flex items-center justify-center rounded-2xl bg-[#0f766e] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0f5f5a]"
 >
 Download Excel
 </button>
 <button
 onClick={handlePrint}
 className="inline-flex items-center justify-center rounded-2xl bg-[#f97316] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#ea580c] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Print Report
 </button>
 </div>
 </div>
 </div>
 </div>

 {error ? (
 <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 text-sm text-red-700">{error}</div>
 ) : loading ? (
 <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-8 text-center text-slate-600 dark:text-slate-200 ">Loading report data…</div>
 ) : (
 <>
 <div className="grid gap-4 xl:grid-cols-3">
 {summaryCards.map((card) => (
 <div key={card.title} className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#475569] dark:text-slate-200 ">{card.title}</p>
 <p className="mt-5 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{card.value}</p>
 <p className="mt-3 text-sm text-[#475569] dark:text-slate-200 ">{card.subtitle}</p>
 </div>
 ))}
 </div>

 <div className="grid gap-4 xl:grid-cols-2">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Revenue Overview (Monthly)</h2>
 <p className="mt-2 text-sm text-[#64748b]">Donations, bookings and prasadam sales for the selected range.</p>
 </div>
 </div>
 <div className="mt-6 h-[320px]">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={revenueChart} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
 <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
 <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 12 }} />
 <YAxis tickFormatter={(value) => `₹${value / 1000}k`} tick={{ fill: "#475569", fontSize: 12 }} />
 <Tooltip formatter={(value) => formatCurrency(value)} />
 <Bar dataKey="revenue" fill="#fb923c" radius={[12, 12, 0, 0]} />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </div>

 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Donation Sources</h2>
 <p className="mt-2 text-sm text-[#64748b]">Breakdown by payment method.</p>
 </div>
 </div>
 <div className="mt-6 flex flex-col items-center gap-6 md:flex-row md:items-start">
 <div className="h-[260px] w-full md:w-1/2">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie data={donationSources} dataKey="value" nameKey="name" innerRadius={52} outerRadius={92} paddingAngle={2}>
 {donationSources.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip formatter={(value) => `${value}%`} />
 </PieChart>
 </ResponsiveContainer>
 </div>
 <div className="w-full md:w-1/2">
 <div className="space-y-3">
 {donationSources.map((slice) => (
 <div key={slice.name} className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3">
 <span className="flex items-center gap-3 text-sm text-[#334155] dark:text-slate-200 ">
 <span className="h-3 w-3 rounded-full" style={{ backgroundColor: slice.color }} />
 {slice.name}
 </span>
 <span className="font-semibold text-[#0f172a] dark:text-slate-200 ">{slice.value}%</span>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 </div>

 <div className="grid gap-4 xl:grid-cols-2">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Pooja Booking Analytics</h2>
 <p className="mt-2 text-sm text-[#64748b]">Top booked pooja services in the selected period.</p>
 <div className="mt-6 space-y-4">
 {poojaBookingAnalytics.map((item, index) => (
 <div key={item.service} className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="font-semibold text-[#111827] dark:text-slate-200 ">{item.service}</p>
 <p className="text-sm text-[#475569] dark:text-slate-200 ">{item.count} bookings</p>
 </div>
 <div className="text-right">
 <p className="font-semibold text-[#111827] dark:text-slate-200 ">{formatCurrency(item.revenue)}</p>
 <p className="text-xs text-[#64748b]">Revenue</p>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>

 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Employee Attendance Overview</h2>
 <p className="mt-2 text-sm text-[#64748b]">Current attendance snapshot for the temple staff.</p>
 </div>
 <div className="rounded-full bg-[#eff6ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-sm font-semibold text-[#2563eb] dark:text-slate-200 ">{attendanceOverview.attendancePercent}%</div>
 </div>
 <div className="mt-6 flex flex-col gap-6 md:flex-row">
 <div className="h-[260px] w-full md:w-1/2">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie data={attendancePieData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={40} paddingAngle={4}>
 {attendancePieData.map((entry, index) => (
 <Cell key={`att-${index}`} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip formatter={(value) => `${value} staff`} />
 </PieChart>
 </ResponsiveContainer>
 </div>
 <div className="w-full md:w-1/2 space-y-3">
 {attendancePieData.map((item) => (
 <div key={item.name} className="flex items-center justify-between rounded-2xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-4">
 <div className="flex items-center gap-3">
 <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
 <span className="text-sm font-semibold text-[#111827] dark:text-slate-200 ">{item.name}</span>
 </div>
 <span className="text-sm text-[#475569] dark:text-slate-200 ">{item.value}</span>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>

 <div className="grid gap-4 xl:grid-cols-2">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Inventory Analytics</h2>
 <p className="mt-2 text-sm text-[#64748b]">Current stock status and low stock alerts.</p>
 <div className="mt-6 grid gap-3">
 {inventoryItems.map((item) => (
 <div key={item.name} className="grid gap-2 rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
 <div>
 <p className="font-semibold text-[#111827] dark:text-slate-200 ">{item.name}</p>
 <p className="text-sm text-[#475569] dark:text-slate-200 ">Available stock: {item.stock ?? "N/A"}</p>
 </div>
 <div className={`rounded-full px-3 py-1 text-xs font-semibold ${String(item.status || "").toLowerCase().includes("low") ? "bg-[#fee2e2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#b91c1c] dark:text-slate-200 " : "bg-[#e0f2fe] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#0369a1]"}`}>{item.status || "Unknown"}</div>
 </div>
 ))}
 </div>
 </div>

 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Festival Analytics</h2>
 <p className="mt-2 text-sm text-[#64748b]">Upcoming and completed festival activity.</p>
 <div className="mt-6 grid gap-4 sm:grid-cols-2">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-xs uppercase tracking-[0.28em] text-[#475569] dark:text-slate-200 ">Upcoming Festivals</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{upcomingFestivals}</p>
 </div>
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-xs uppercase tracking-[0.28em] text-[#475569] dark:text-slate-200 ">Completed Festivals</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{completedFestivals}</p>
 </div>
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-xs uppercase tracking-[0.28em] text-[#475569] dark:text-slate-200 ">Festival Revenue</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{formatCurrency(eventOverview.festivalRevenue || 0)}</p>
 </div>
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-xs uppercase tracking-[0.28em] text-[#475569] dark:text-slate-200 ">Festival Donations</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{formatCurrency(festivalDonations)}</p>
 </div>
 </div>
 </div>
 </div>

 <div className="grid gap-4 xl:grid-cols-3">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <p className="text-sm uppercase tracking-[0.24em] text-[#475569] dark:text-slate-200 ">Total Devotees</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{totalDevotees}</p>
 <p className="mt-2 text-sm text-[#475569] dark:text-slate-200 ">All registered devotees</p>
 </div>
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <p className="text-sm uppercase tracking-[0.24em] text-[#475569] dark:text-slate-200 ">New This Month</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{newThisMonth}</p>
 <p className="mt-2 text-sm text-[#475569] dark:text-slate-200 ">New devotee registrations</p>
 </div>
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <p className="text-sm uppercase tracking-[0.24em] text-[#475569] dark:text-slate-200 ">Active Devotees</p>
 <p className="mt-4 text-3xl font-bold text-[#111827] dark:text-slate-200 ">{activeDevotees}</p>
 <p className="mt-2 text-sm text-[#475569] dark:text-slate-200 ">Recent donations/bookings</p>
 </div>
 </div>

 <div className="grid gap-4 xl:grid-cols-2">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Recent Transactions</h2>
 <p className="mt-2 text-sm text-[#64748b]">Most recent donations, pooja payments, and prasadam sales.</p>
 <div className="mt-6 space-y-3">
 {recentTransactions.map((item) => (
 <div key={item.id} className="flex items-center justify-between rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3">
 <div>
 <p className="font-semibold text-[#111827] dark:text-slate-200 ">{item.type}</p>
 <p className="text-sm text-[#475569] dark:text-slate-200 ">{item.description}</p>
 </div>
 <div className="text-right">
 <p className="font-semibold text-[#111827] dark:text-slate-200 ">{formatCurrency(item.amount)}</p>
 <p className="text-xs text-[#64748b]">{item.date ? item.date.toLocaleDateString() : "-"}</p>
 </div>
 </div>
 ))}
 </div>
 </div>

 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h2 className="text-xl font-semibold text-[#111827] dark:text-slate-200 ">Reports Summary</h2>
 <p className="mt-2 text-sm text-[#64748b]">Quick access to downloadable report types.</p>
 <div className="mt-6 space-y-3">
 {reportsSummary.map((item) => (
 <div key={item.title} className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-4">
 <p className="font-semibold text-[#111827] dark:text-slate-200 ">{item.title}</p>
 <p className="mt-1 text-sm text-[#475569] dark:text-slate-200 ">{item.description}</p>
 </div>
 ))}
 </div>
 </div>
 </div>
 </>
 )}
 </div>
 );
};

export default ReportsAnalytics;
