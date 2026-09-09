import { useEffect, useMemo, useState } from "react";
import {
 FaDownload,
 FaReceipt,
 FaSearch,
 FaPrint,
 FaCreditCard,
 FaMoneyBillWave,
 FaChartPie,
 FaSyncAlt,
} from "react-icons/fa";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadReceiptPDF } from "../../utils/receiptGenerator";
import {
 Area,
 AreaChart,
 CartesianGrid,
 Cell,
 Pie,
 PieChart,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from "recharts";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import {
 fetchBills,
 fetchBookings,
 fetchDonations,
 fetchPrasadamOrders,
 formatCurrency,
 formatDateTime,
 getBillReference,
 inferBillType,
 updateBillStatus,
 isToday,
 sumBy,
 toDateKey,
} from "../../services/cashierService";

const receiptTabs = ["All", "Pooja Booking", "Donation", "Prasadam Sale", "Other"];

const receiptTone = {
 "Pooja Booking": "bg-[#eef4ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#234ea5]",
 Donation: "bg-[#e8f7ee] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]",
 "Prasadam Sale": "bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9a5a00]",
 Other: "bg-[#f4f4f5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#334155]",
};

const statusTone = {
 Paid: "bg-[#e8f7ee] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]",
 Pending: "bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9a5a00]",
 Cancelled: "bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9b1c1c]",
};

const paymentColors = {
 Cash: "#16a34a",
 UPI: "#7c3aed",
 Card: "#2563eb",
 "Bank Transfer": "#f59e0b",
 "Net Banking": "#f97316",
};

const buildLastDays = (days = 7) => {
 const rows = [];
 for (let offset = days - 1; offset >= 0; offset -= 1) {
 const date = new Date();
 date.setDate(date.getDate() - offset);
 rows.push({
 key: toDateKey(date),
 label: date.toLocaleDateString("en-IN", { weekday: "short" }),
 });
 }
 return rows;
};

const ReceiptsPage = () => {
 // Top-level Navigation Section: "ledger" | "payments" | "reports"
 const [activeSection, setActiveSection] = useState("ledger");

 const [bills, setBills] = useState([]);
 const [bookings, setBookings] = useState([]);
 const [donations, setDonations] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [loading, setLoading] = useState(true);

 // Ledger state
 const [query, setQuery] = useState("");
 const [tab, setTab] = useState("All");
 const [showAllReceipts, setShowAllReceipts] = useState(false);

 useEffect(() => {
 setShowAllReceipts(false);
 }, [tab, query]);

 // Reports state
 const [range, setRange] = useState("monthly");

 const loadData = async () => {
 setLoading(true);
 try {
 const [billRows, bookingRows, donationRows, orderRows] = await Promise.allSettled([
 fetchBills(),
 fetchBookings(),
 fetchDonations(),
 fetchPrasadamOrders(),
 ]);

 setBills(billRows.status === "fulfilled" ? billRows.value : []);
 setBookings(bookingRows.status === "fulfilled" ? bookingRows.value : []);
 setDonations(donationRows.status === "fulfilled" ? donationRows.value : []);
 setPrasadamOrders(orderRows.status === "fulfilled" ? orderRows.value : []);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 }, []);

 // Ledger grouping & filters
 const sections = useMemo(() => {
 const grouped = { "Pooja Booking": [], Donation: [], "Prasadam Sale": [], Other: [] };
 bills.forEach((bill, index) => {
 const type = inferBillType(bill);
 const key = grouped[type] ? type : "Other";
 grouped[key].push({ bill, index });
 });
 return grouped;
 }, [bills]);

 const filteredBills = useMemo(() => {
 const q = query.trim().toLowerCase();
 return [...bills]
 .filter((bill) => {
 const type = inferBillType(bill);
 const matchesType = tab === "All" || type === tab;
 const matchesQuery =
 !q ||
 [bill.referenceNo, bill.devoteeName, bill.sevaType, bill.paymentMode, bill.billType, bill.status]
 .filter(Boolean)
 .some((value) => String(value).toLowerCase().includes(q));
 return matchesType && matchesQuery;
 })
 .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0));
 }, [bills, query, tab]);

 // Payments overview logic
 const paymentSummary = useMemo(() => {
 const grouped = bills.reduce((acc, bill) => {
 const mode = bill.paymentMode || "Cash";
 if (!acc[mode]) acc[mode] = { total: 0, count: 0 };
 acc[mode].total += Number(bill.amount || 0);
 acc[mode].count += 1;
 return acc;
 }, {});

 return Object.entries(grouped)
 .map(([mode, data]) => ({ mode, ...data }))
 .sort((a, b) => b.total - a.total);
 }, [bills]);

 const recentPayments = useMemo(
 () =>
 [...bills]
 .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0))
 .slice(0, 12),
 [bills]
 );

 const pendingPaymentsCount = useMemo(
 () => bills.filter((bill) => (bill.status || "Paid") === "Pending").length,
 [bills]
 );

 // Reports range logic
 const rangeStart = useMemo(() => {
 const now = new Date();
 if (range === "weekly") return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
 if (range === "yearly") return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
 return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
 }, [range]);

 const rangeBills = useMemo(
 () => bills.filter((bill) => new Date(bill.billDate || bill.createdAt || 0) >= rangeStart),
 [bills, rangeStart]
 );

 const rangeBookings = useMemo(
 () => bookings.filter((booking) => new Date(booking.createdAt || booking.datetime || 0) >= rangeStart),
 [bookings, rangeStart]
 );
 const rangeDonations = useMemo(
 () => donations.filter((donation) => new Date(donation.createdAt || 0) >= rangeStart),
 [donations, rangeStart]
 );
 const rangePrasadamOrders = useMemo(
 () => prasadamOrders.filter((order) => new Date(order.createdAt || 0) >= rangeStart),
 [prasadamOrders, rangeStart]
 );

 const dailySeries = useMemo(() => {
 const days = buildLastDays(7);
 return days.map((day) => ({
 day: day.label,
 amount: sumBy(rangeBills.filter((bill) => toDateKey(bill.billDate || bill.createdAt) === day.key), (bill) => bill.amount),
 }));
 }, [rangeBills]);

 const paymentSeries = useMemo(() => {
 const totals = rangeBills.reduce((acc, bill) => {
 const mode = bill.paymentMode || "Cash";
 acc[mode] = (acc[mode] || 0) + Number(bill.amount || 0);
 return acc;
 }, {});

 return Object.entries(totals).map(([name, value]) => ({
 name,
 value,
 color: paymentColors[name] || "#f59e0b",
 }));
 }, [rangeBills]);

 const paymentTotals = paymentSeries.reduce((total, item) => total + item.value, 0);

 const bookingRevenue = useMemo(() => sumBy(rangeBills.filter((bill) => inferBillType(bill) === "Pooja Booking"), (bill) => bill.amount), [rangeBills]);
 const donationRevenue = useMemo(() => sumBy(rangeBills.filter((bill) => inferBillType(bill) === "Donation"), (bill) => bill.amount), [rangeBills]);
 const prasadamRevenue = useMemo(() => sumBy(rangeBills.filter((bill) => inferBillType(bill) === "Prasadam Sale"), (bill) => bill.amount), [rangeBills]);

 const recentReportRows = useMemo(
 () =>
 [...rangeBills]
 .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0))
 .slice(0, 10)
 .map((bill) => ({
 id: bill.referenceNo || bill._id,
 type: inferBillType(bill),
 service: bill.sevaType,
 amount: bill.amount,
 paymentMode: bill.paymentMode || "Cash",
 status: bill.status || "Paid",
 date: formatDateTime(bill.billDate || bill.createdAt),
 })),
 [rangeBills]
 );

 // Status & Print Action Handlers
 const handleMarkAsPaid = async (id) => {
 try {
 await updateBillStatus(id, "Paid");
 await loadData();
 } catch (err) {
 console.error("Failed to mark bill as paid", err);
 }
 };

 const handlePrintReceipt = async (bill, index) => {
 try {
 const type = inferBillType(bill);
 const isOnline = bill.source === "Online Portal" || false;
 const refNo = getBillReference(bill, index);
 const amount = Number(bill.amount) || 0;
 
 let poojaBookings = [];
 let prasadamOrders = [];
 
 if (type === "Pooja Booking" || type === "Combined") {
 poojaBookings = [{
 slNo: 1,
 name: bill.sevaType || "Pooja Booking",
 date: formatDateTime(bill.billDate || bill.createdAt),
 qty: 1,
 amount: amount
 }];
 } else if (type === "Prasadam Sale") {
 prasadamOrders = [{
 slNo: 1,
 name: bill.sevaType || "Prasadam",
 date: "-",
 qty: 1,
 amount: amount
 }];
 } else {
 poojaBookings = [{
 slNo: 1,
 name: bill.sevaType || type,
 date: formatDateTime(bill.billDate || bill.createdAt),
 qty: 1,
 amount: amount
 }];
 }

 const receiptData = {
 isOnline,
 receiptNo: refNo,
 bookingDate: formatDateTime(bill.billDate || bill.createdAt),
 paymentMode: bill.paymentMode || "Cash",
 transactionId: (bill.paymentMode === "Cash") ? "-" : (bill.transactionId || bill.razorpayPaymentId || bill.paymentId || "-"),
 cashierName: bill.cashierName || "Cashier",
 devoteeName: bill.devoteeName || bill.customerName || "-",
 mobile: bill.mobile || bill.devoteePhone || bill.contactNumber || "-",
 email: bill.email || bill.devoteeEmail || "-",
 address: bill.address || bill.devoteeAddress || "-",
 poojaBookings,
 prasadamOrders,
 subTotal: amount,
 templeCharges: 0,
 grandTotal: amount,
 amountInWords: `Rs. ${amount}`,
 devoteeMaterials: [],
 templeMaterials: [],
 notes: bill.notes ? [String(bill.notes)] : []
 };

 await downloadReceiptPDF(receiptData, `receipt-${refNo}.pdf`);
 } catch (err) {
 console.error("Failed to generate PDF:", err);
 alert("Failed to generate PDF receipt.");
 }
 };

 const renderTableRow = (bill, index) => {
 const type = inferBillType(bill);
 return (
 <tr key={bill._id || bill.referenceNo || index} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{getBillReference(bill, index)}</td>
 <td className="px-4 py-3 font-semibold text-slate-800">{bill.devoteeName}</td>
 <td className="px-4 py-3">{type}</td>
 <td className="px-4 py-3">{bill.sevaType}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(bill.amount)}</td>
 <td className="px-4 py-3">{bill.paymentMode || "-"}</td>
 <td className="px-4 py-3 text-slate-700">{formatDateTime(bill.billDate || bill.createdAt)}</td>
 <td className="px-4 py-3">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
 statusTone[bill.status || "Paid"] || statusTone.Paid
 }`}
 >
 {bill.status || "Paid"}
 </span>
 </td>
 <td className="px-4 py-3 text-center">
 <div className="flex items-center justify-center gap-2">

 <button
 type="button"
 onClick={() => handlePrintReceipt(bill, index)}
 className="inline-flex items-center gap-1 rounded-lg border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 title="Print Receipt"
 >
 <FaPrint className="text-xs" /> Print
 </button>
 </div>
 </td>
 </tr>
 );
 };

 // Export CSV and PDF Handlers
 const handleDownloadLedgerPdf = () => {
 const doc = new jsPDF();
 doc.text("Receipt Ledger", 14, 15);
 const tableColumn = ["Receipt", "Devotee", "Type", "Service", "Amount", "Payment", "Status", "Date"];
 const tableRows = [];

 filteredBills.forEach((bill, idx) => {
 const ticketData = [
 getBillReference(bill, idx),
 bill.devoteeName || "-",
 inferBillType(bill),
 bill.sevaType || "-",
 formatCurrency(bill.amount),
 bill.paymentMode || "-",
 bill.status || "Paid",
 formatDateTime(bill.billDate || bill.createdAt)
 ];
 tableRows.push(ticketData);
 });

 autoTable(doc, {
 head: [tableColumn],
 body: tableRows,
 startY: 20,
 });
 doc.save(`cashier-receipts-ledger.pdf`);
 };

 const handleDownloadLedgerCsv = () => {
 const rows = [
 ["Receipt", "Devotee", "Type", "Service", "Amount", "Payment", "Status", "Date"],
 ...filteredBills.map((bill, idx) => [
 getBillReference(bill, idx),
 bill.devoteeName,
 inferBillType(bill),
 bill.sevaType,
 bill.amount,
 bill.paymentMode,
 bill.status || "Paid",
 formatDateTime(bill.billDate || bill.createdAt),
 ]),
 ];

 const csv = rows
 .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
 .join("\r\n");

 const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.download = "cashier-receipts-ledger.csv";
 link.click();
 URL.revokeObjectURL(url);
 };

 const handleDownloadReportsCsv = () => {
 const rows = [
 ["Receipt", "Type", "Service", "Amount", "Payment", "Status", "Date"],
 ...recentReportRows.map((row) => [row.id, row.type, row.service, row.amount, row.paymentMode, row.status, row.date]),
 ];

 const csv = rows
 .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
 .join("\r\n");
 const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.download = `cashier-reports-summary-${range}.csv`;
 link.click();
 URL.revokeObjectURL(url);
 };

 // Dynamic Page Shell Configuration
 const shellProps = useMemo(() => {
 if (activeSection === "payments") {
 const todayTotal = sumBy(bills.filter((b) => isToday(b.billDate || b.createdAt)), (b) => b.amount);
 return {
 eyebrow: "Receipts > Payments",
 title: "Payments processing overview",
 description: "Review total income across payment modes (Cash, UPI, etc.) and check recent transaction statuses.",
 stats: [
 { title: "Today Amount", value: formatCurrency(todayTotal), note: "Live counter total", tone: "orange" },
 { title: "Bill Count", value: bills.length, note: "All payment records", tone: "gold" },
 { title: "Paid", value: bills.filter((b) => (b.status || "Paid") === "Paid").length, note: "Settled successfully", tone: "green" },
 { title: "Pending", value: pendingPaymentsCount, note: "Needs settlement", tone: "blue" },
 ],
 actions: (
 <button
 type="button"
 onClick={loadData}
 className="inline-flex items-center gap-2 rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 <FaSyncAlt /> Refresh Payments
 </button>
 ),
 };
 }

 if (activeSection === "reports") {
 const rangeTotal = sumBy(rangeBills, (b) => b.amount);
 return {
 eyebrow: "Receipts > Reports",
 title: "Cashier reports & analytics summary",
 description: "Set ranges, inspect collections trends, analyze payment methods, and download CSV reports.",
 stats: [
 { title: "Report Total", value: formatCurrency(rangeTotal), note: `For ${range} range`, tone: "orange" },
 { title: "Bookings", value: rangeBookings.length, note: `${rangeBookings.filter((b) => isToday(b.createdAt)).length} today`, tone: "gold" },
 { title: "Donations", value: rangeDonations.length, note: "Donation records", tone: "green" },
 { title: "Prasadam Orders", value: rangePrasadamOrders.length, note: "Sales records", tone: "blue" },
 ],
 actions: (
 <>
 <button
 type="button"
 onClick={loadData}
 className="inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaSyncAlt /> Refresh Reports
 </button>
 <button
 type="button"
 onClick={handleDownloadReportsCsv}
 className="inline-flex items-center gap-2 rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 <FaDownload /> Export CSV
 </button>
 </>
 ),
 };
 }

 // Default: ledger
 return {
 eyebrow: "Receipts",
 title: "Receipts ledger and cashier records",
 description: "Search and review temple receipts, download standard ledger CSV, and update payment statuses.",
 stats: [
 { title: "All Receipts", value: bills.length, note: "Combined ledger entries", tone: "orange" },
 { title: "Pooja Receipts", value: sections["Pooja Booking"].length, note: "Booking history", tone: "gold" },
 { title: "Donation Receipts", value: sections.Donation.length, note: "Donation history", tone: "green" },
 { title: "Prasadam Receipts", value: sections["Prasadam Sale"].length, note: "Prasadam sales", tone: "blue" },
 ],
 actions: (
 <>
 <button
 type="button"
 onClick={loadData}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Refresh Ledger
 </button>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={handleDownloadLedgerCsv}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 Download CSV
 </button>
 <button
 type="button"
 onClick={handleDownloadLedgerPdf}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 Download PDF
 </button>
 </div>
 </>
 ),
 };
 }, [activeSection, bills, rangeBills, rangeBookings, rangeDonations, rangePrasadamOrders, sections, range, pendingPaymentsCount]);

 return (
 <CashierPageShell
 eyebrow={shellProps.eyebrow}
 image={templeBg}
 imageAlt="Temple Receipts"
 stats={shellProps.stats}
 actions={shellProps.actions}
 >
 {/* Navigation Sub-Tabs */}
 <section className="flex border-b border-[#f2e7d7] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2 shadow-sm rounded-t-[22px]">
 {["ledger", "payments", "reports"].map((section) => (
 <button
 key={section}
 type="button"
 onClick={() => setActiveSection(section)}
 className={`px-5 py-3 text-sm font-extrabold transition-all border-b-2 capitalize ${
 activeSection === section
 ? "border-[#f28c18] text-[#8a5200]"
 : "border-transparent text-slate-500 hover:text-slate-900"
 }`}
 >
 {section === "ledger" ? "Receipts Ledger" : section === "payments" ? "Payments Overview" : "Reports & Analytics"}
 </button>
 ))}
 </section>

 {/* RENDER ACTIVE TAB */}
 {activeSection === "ledger" && !showAllReceipts && (
 <>
 <section className="rounded-b-[22px] border-x border-b border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Receipt sections</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Use the tabs to switch between pooja, donation and prasadam receipts.
 </p>
 </div>

 <div className="flex flex-wrap items-center gap-3">
 <div className="flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-700">
 <FaSearch />
 <input
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search receipt"
 className="w-[180px] bg-transparent outline-none"
 />
 </div>
 <button
 type="button"
 onClick={handleDownloadLedgerCsv}
 className="inline-flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaDownload /> CSV
 </button>
 <button
 type="button"
 onClick={handleDownloadLedgerPdf}
 className="inline-flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaDownload /> PDF
 </button>
 </div>
 </div>

 <div className="mt-5 flex flex-wrap gap-2">
 {receiptTabs.map((item) => (
 <button
 key={item}
 type="button"
 onClick={() => setTab(item)}
 className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
 tab === item
 ? "border-[#f28c18] bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#8a5200]"
 : "border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 {item}
 </button>
 ))}
 </div>
 </section>

 <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Receipt ledger</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Searchable bill register with all saved cashier receipts.
 </p>
 </div>
 <FaReceipt className="text-[#f28c18]" />
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[920px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Devotee</th>
 <th className="px-4 py-3 font-bold">Type</th>
 <th className="px-4 py-3 font-bold">Service</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Date</th>
 <th className="px-4 py-3 font-bold">Status</th>
 <th className="px-4 py-3 font-bold text-center">Actions</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="9" className="px-4 py-8 text-center text-slate-500">
 Loading receipts...
 </td>
 </tr>
 ) : filteredBills.length ? (
 filteredBills.slice(0, 5).map((bill, index) => renderTableRow(bill, index))
 ) : (
 <tr>
 <td colSpan="9" className="px-4 py-8 text-center text-slate-500">
 No receipts found for the selected filter.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 {filteredBills.length > 5 && (
 <div className="mt-6 flex justify-center pb-2">
 <button
 type="button"
 onClick={() => setShowAllReceipts(true)}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#d97706] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 View all {filteredBills.length} receipts
 </button>
 </div>
 )}
 </div>
 </section>

 <aside className="space-y-6">
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <h2 className="text-2xl font-extrabold text-slate-950">Receipt summary</h2>
 <div className="mt-4 space-y-3 text-sm">
 {shellProps.stats.map((item) => (
 <div key={item.title} className="flex items-center justify-between rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3">
 <span className="font-medium text-slate-600">{item.title}</span>
 <span className="font-extrabold text-slate-950">{item.value}</span>
 </div>
 ))}
 </div>
 </section>

 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <h2 className="text-2xl font-extrabold text-slate-950">Grouped sections</h2>
 <div className="mt-4 space-y-3">
 {receiptTabs
 .filter((item) => item !== "All")
 .map((item) => (
 <div key={item} className="flex items-center justify-between rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm">
 <span className="font-semibold text-slate-700">{item}</span>
 <span className="font-bold text-slate-950">{sections[item]?.length || 0}</span>
 </div>
 ))}
 </div>
 </section>
 </aside>
 </div>
 </>
 )}

 {activeSection === "ledger" && showAllReceipts && (
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm mt-4">
 <div className="mb-4">
 <button
 onClick={() => setShowAllReceipts(false)}
 className="text-[#f28c18] text-sm font-bold hover:underline inline-flex items-center gap-1"
 >
 &larr; Back to receipt page
 </button>
 </div>
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">All {tab === "All" ? "Receipts" : `${tab} Receipts`}</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Complete list of filtered receipts.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={handleDownloadLedgerCsv}
 className="inline-flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaDownload /> CSV
 </button>
 <button
 type="button"
 onClick={handleDownloadLedgerPdf}
 className="inline-flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaDownload /> PDF
 </button>
 </div>
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[920px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Devotee</th>
 <th className="px-4 py-3 font-bold">Type</th>
 <th className="px-4 py-3 font-bold">Service</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Date</th>
 <th className="px-4 py-3 font-bold">Status</th>
 <th className="px-4 py-3 font-bold text-center">Actions</th>
 </tr>
 </thead>
 <tbody>
 {filteredBills.map((bill, index) => renderTableRow(bill, index))}
 </tbody>
 </table>
 </div>
 </section>
 )}

 {activeSection === "payments" && (
 <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Payment channels</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Total value and count for each payment method.
 </p>
 </div>
 <FaCreditCard className="text-[#f28c18]" />
 </div>

 <div className="mt-5 space-y-3">
 {paymentSummary.length ? (
 paymentSummary.map((item) => (
 <div key={item.mode} className="rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-4">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="font-extrabold text-slate-950">{item.mode}</p>
 <p className="mt-1 text-sm text-slate-600">{item.count} transactions</p>
 </div>
 <FaMoneyBillWave className="text-[#f28c18]" />
 </div>
 <p className="mt-3 text-2xl font-extrabold text-slate-950">{formatCurrency(item.total)}</p>
 </div>
 ))
 ) : (
 <div className="rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-6 text-center text-slate-500">No payment data yet.</div>
 )}
 </div>
 </section>

 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Recent payments</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Latest ledger entries for bookings, donations and prasadam.
 </p>
 </div>
 <FaReceipt className="text-[#f28c18]" />
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[820px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Type</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Status</th>
 <th className="px-4 py-3 font-bold">Date</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
 Loading payments...
 </td>
 </tr>
 ) : recentPayments.length ? (
 recentPayments.map((bill, index) => (
 <tr key={bill._id || bill.referenceNo || index} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{bill.referenceNo || `RC-${String(index + 1).padStart(4, "0")}`}</td>
 <td className="px-4 py-3">{inferBillType(bill)}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(bill.amount)}</td>
 <td className="px-4 py-3">{bill.paymentMode || "Cash"}</td>
 <td className="px-4 py-3">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
 statusTone[bill.status || "Paid"] || statusTone.Paid
 }`}
 >
 {bill.status || "Paid"}
 </span>
 </td>
 <td className="px-4 py-3 text-slate-700">{formatDateTime(bill.billDate || bill.createdAt)}</td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
 No payment records found.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 )}

 {activeSection === "reports" && (
 <>
 <section className="rounded-b-[22px] border-x border-b border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Report range</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Switch between weekly, monthly and yearly views.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 {["weekly", "monthly", "yearly"].map((item) => (
 <button
 key={item}
 type="button"
 onClick={() => setRange(item)}
 className={`rounded-full border px-4 py-2 text-sm font-bold capitalize transition ${
 range === item
 ? "border-[#f28c18] bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#8a5200]"
 : "border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 {item}
 </button>
 ))}
 </div>
 </div>

 <div className="mt-5 grid gap-4 lg:grid-cols-4">
 <div className="rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-4">
 <p className="text-sm uppercase tracking-[0.24em] text-[#8a5200]">Revenue</p>
 <p className="mt-3 text-3xl font-extrabold text-slate-950">{formatCurrency(sumBy(rangeBills, (bill) => bill.amount))}</p>
 </div>
 <div className="rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-4">
 <p className="text-sm uppercase tracking-[0.24em] text-[#8a5200]">Bookings</p>
 <p className="mt-3 text-3xl font-extrabold text-slate-950">{bookingRevenue ? formatCurrency(bookingRevenue) : "Rs 0"}</p>
 </div>
 <div className="rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-4">
 <p className="text-sm uppercase tracking-[0.24em] text-[#8a5200]">Donations</p>
 <p className="mt-3 text-3xl font-extrabold text-slate-950">{donationRevenue ? formatCurrency(donationRevenue) : "Rs 0"}</p>
 </div>
 <div className="rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-4">
 <p className="text-sm uppercase tracking-[0.24em] text-[#8a5200]">Prasadam</p>
 <p className="mt-3 text-3xl font-extrabold text-slate-950">{prasadamRevenue ? formatCurrency(prasadamRevenue) : "Rs 0"}</p>
 </div>
 </div>
 </section>

 <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Seven day collection trend</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Total money collected each day from the cashier ledger.
 </p>
 </div>
 <FaChartPie className="text-[#f28c18]" />
 </div>

 <div className="mt-5 h-[290px]">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={dailySeries} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
 <defs>
 <linearGradient id="cashierReport" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#f28c18" stopOpacity={0.45} />
 <stop offset="95%" stopColor="#f28c18" stopOpacity={0.05} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f2e4cf" />
 <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
 <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
 <Tooltip
 contentStyle={{ background: "#0f172a", borderRadius: 12, border: "none", color: "#fff" }}
 labelStyle={{ color: "#cbd5e1" }}
 />
 <Area type="monotone" dataKey="amount" stroke="#f28c18" strokeWidth={3} fill="url(#cashierReport)" />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </section>

 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Payment methods</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Distribution by payment mode.
 </p>
 </div>
 <FaChartPie className="text-[#f28c18]" />
 </div>

 <div className="relative mt-4 h-[220px]">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie data={paymentSeries} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={2}>
 {paymentSeries.map((entry) => (
 <Cell key={entry.name} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip />
 </PieChart>
 </ResponsiveContainer>
 </div>

 <div className="grid gap-2 sm:grid-cols-2">
 {paymentSeries.length ? (
 paymentSeries.map((item) => (
 <div key={item.name} className="flex items-center justify-between rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
 <span className="font-semibold text-slate-800">{item.name}</span>
 <span className="font-bold text-slate-950">{formatCurrency(item.value)}</span>
 </div>
 ))
 ) : (
 <div className="rounded-2xl bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-6 text-center text-slate-500">No payment data yet.</div>
 )}
 </div>
 <p className="mt-4 text-sm text-slate-600">
 Total by method: {formatCurrency(paymentTotals)}
 </p>
 </section>
 </div>

 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Recent report rows</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Latest transactions from the selected range.
 </p>
 </div>
 <span className="rounded-full bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-bold text-[#8a5200]">
 {recentReportRows.length} rows
 </span>
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[900px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Type</th>
 <th className="px-4 py-3 font-bold">Service</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Date</th>
 <th className="px-4 py-3 font-bold">Status</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
 Loading reports...
 </td>
 </tr>
 ) : recentReportRows.length ? (
 recentReportRows.map((row) => (
 <tr key={`${row.id}-${row.date}`} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{row.id}</td>
 <td className="px-4 py-3">{row.type}</td>
 <td className="px-4 py-3">{row.service}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(row.amount)}</td>
 <td className="px-4 py-3">{row.paymentMode}</td>
 <td className="px-4 py-3 text-slate-700">{row.date}</td>
 <td className="px-4 py-3">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
 statusTone[row.status] || statusTone.Paid
 }`}
 >
 {row.status}
 </span>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
 No report rows available for this period.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 </>
 )}
 </CashierPageShell>
 );
};

export default ReceiptsPage;
