import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
 AreaChart,
 Area,
 CartesianGrid,
 Cell,
 Pie,
 PieChart,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from "recharts";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import { getDevoteesForCashier } from "../../services/authService";
import {
 fetchBookings,
 fetchRoomBookings,
 fetchDonations,
 fetchInventoryItems,
 fetchPrasadamOrders,
 fetchBills,
 formatCurrency,
 formatDate,
 formatDateTime,
 isToday,
 sumBy,
 toDateKey,
} from "../../services/cashierService";

const paymentPalette = {
 Cash: "#16a34a",
 UPI: "#7c3aed",
 Card: "#2563eb",
 "Bank Transfer": "#f59e0b",
 "Net Banking": "#f97316",
}; const buildDaysRange = (startStr, endStr) => {
 const rows = [];
 const start = new Date(startStr);
 const end = new Date(endStr);
 if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

 // Cap at 31 days to avoid chart overflow
 let diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
 let currentStart = new Date(start);
 if (diffDays > 31) {
 currentStart.setDate(end.getDate() - 31);
 }

 for (let d = new Date(currentStart); d <= end; d.setDate(d.getDate() + 1)) {
 rows.push({
 key: toDateKey(d),
 label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
 });
 }
 return rows;
};

const CashierDashboardPage = () => {
 const navigate = useNavigate();
 const [loading, setLoading] = useState(true);
 const [bookings, setBookings] = useState([]);
 const [roomBookings, setRoomBookings] = useState([]);
 const [donations, setDonations] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [bills, setBills] = useState([]);
 const [inventoryItems, setInventoryItems] = useState([]);
 const [devotees, setDevotees] = useState([]);

 const [fromDate, setFromDate] = useState(() => {
 const d = new Date();
 d.setDate(d.getDate() - 7); // Default to last 7 days
 return toDateKey(d);
 });
 const [toDate, setToDate] = useState(() => toDateKey(new Date()));
 const [dateError, setDateError] = useState("");

 const handleFromDateChange = (val) => {
 setDateError("");
 const today = toDateKey(new Date());
 if (val > today) {
 setDateError("From date cannot be in the future!");
 setFromDate(today);
 return;
 }
 setFromDate(val);
 };

 const handleToDateChange = (val) => {
 setDateError("");
 const today = toDateKey(new Date());
 if (val > today) {
 setDateError("To date cannot be in the future!");
 setToDate(today);
 return;
 }
 setToDate(val);
 };

 useEffect(() => {
 let mounted = true;
 (async () => {
 setLoading(true);
 try {
 const [bookingRows, roomBookingRows, donationRows, prasadamRows, billRows, inventoryRows, devoteeRows] = await Promise.allSettled([
 fetchBookings(),
 fetchRoomBookings(),
 fetchDonations(),
 fetchPrasadamOrders(),
 fetchBills(),
 fetchInventoryItems(),
 getDevoteesForCashier(),
 ]);

 if (!mounted) return;

 setBookings(bookingRows.status === "fulfilled" ? bookingRows.value : []);
 setRoomBookings(roomBookingRows.status === "fulfilled" ? roomBookingRows.value : []);
 setDonations(donationRows.status === "fulfilled" ? donationRows.value : []);
 setPrasadamOrders(prasadamRows.status === "fulfilled" ? prasadamRows.value : []);
 setBills(billRows.status === "fulfilled" ? billRows.value : []);
 setInventoryItems(inventoryRows.status === "fulfilled" ? inventoryRows.value : []);
 setDevotees(devoteeRows.status === "fulfilled" ? devoteeRows.value : []);
 } finally {
 if (mounted) setLoading(false);
 }
 })();

 return () => {
 mounted = false;
 };
 }, []);

 const rangeBills = useMemo(() => {
 return bills.filter((b) => {
 const dk = toDateKey(b.billDate || b.createdAt);
 return (!fromDate || dk >= fromDate) && (!toDate || dk <= toDate);
 });
 }, [bills, fromDate, toDate]);

 const rangeBookings = useMemo(() => {
 return bookings.filter((b) => {
 if (String(b.service || "").toLowerCase().includes("room allotment")) return false;
 const dk = toDateKey(b.bookingDate || b.createdAt);
 return (!fromDate || dk >= fromDate) && (!toDate || dk <= toDate);
 });
 }, [bookings, fromDate, toDate]);

 const rangeDonations = useMemo(() => {
 return donations.filter((d) => {
 const dk = toDateKey(d.donationDate || d.createdAt);
 return (!fromDate || dk >= fromDate) && (!toDate || dk <= toDate);
 });
 }, [donations, fromDate, toDate]);

 const rangePrasadamOrders = useMemo(() => {
 return prasadamOrders.filter((o) => {
 const dk = toDateKey(o.orderDate || o.createdAt);
 return (!fromDate || dk >= fromDate) && (!toDate || dk <= toDate);
 });
 }, [prasadamOrders, fromDate, toDate]);

 const dailySeries = useMemo(() => {
 const days = buildDaysRange(fromDate, toDate);
 return days.map((day) => ({
 day: day.label,
 amount: sumBy(bills.filter((bill) => toDateKey(bill.billDate || bill.createdAt) === day.key), (bill) => bill.amount),
 }));
 }, [bills, fromDate, toDate]);

 const paymentSeries = useMemo(() => {
 const totals = rangeBills.reduce((acc, bill) => {
 const key = bill.paymentMode || "Cash";
 acc[key] = (acc[key] || 0) + Number(bill.amount || 0);
 return acc;
 }, {});

 return Object.entries(totals).map(([name, value]) => ({
 name,
 value,
 color: paymentPalette[name] || "#f59e0b",
 }));
 }, [rangeBills]);

 const pendingBookings = useMemo(() => bookings.filter((booking) => String(booking.status || "Pending") === "Pending"), [bookings]);
 const lowStockItems = useMemo(() => inventoryItems.filter((item) => Number(item.currentStock) < Number(item.minimumStock)), [inventoryItems]);

 const recentActivity = useMemo(
 () =>
 [...rangeBills]
 .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0))
 .slice(0, 8)
 .map((bill, index) => ({
 id: bill.referenceNo || `RC-${String(index + 1).padStart(4, "0")}`,
 name: bill.devoteeName,
 type: bill.billType || "Other",
 service: bill.sevaType,
 amount: bill.amount,
 paymentMode: bill.paymentMode || "Cash",
 status: bill.status || "Paid",
 date: formatDateTime(bill.billDate || bill.createdAt),
 })),
 [rangeBills]
 );
 const downloadRangeReport = () => {
 const totalAmount = sumBy(rangeBills, (b) => b.amount);
 const totalPooja = sumBy(rangeBookings, (b) => b.amount || b.price || 0);
 const totalDonations = sumBy(rangeDonations, (d) => d.amount || 0);
 const totalPrasadam = sumBy(rangePrasadamOrders, (o) => o.amount || o.totalPrice || 0);

 const paymentBreakdown = {
 "Cash": 0,
 "UPI": 0,
 "Card": 0,
 "Bank Transfer": 0
 };
 rangeBills.forEach((b) => {
 const mode = b.paymentMode || "Cash";
 const matchedKey = Object.keys(paymentBreakdown).find(k => k.toLowerCase() === mode.toLowerCase()) || "Cash";
 paymentBreakdown[matchedKey] += Number(b.amount || 0);
 });

 const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

 // Header
 doc.setFont("helvetica", "bold");
 doc.setFontSize(22);
 doc.setTextColor(242, 140, 24); // Temple Orange
 doc.text("SRI SHANTI MAHADEV MANDIR", 40, 55);

 doc.setFontSize(14);
 doc.setTextColor(51, 65, 85);
 doc.text("Cashier Date Range Report", 40, 78);

 doc.setFont("helvetica", "normal");
 doc.setFontSize(10);
 doc.text(`Range: ${formatDate(fromDate)} to ${formatDate(toDate)}`, 40, 98);
 doc.text(`Generated at: ${new Date().toLocaleString("en-IN")}`, 40, 112);

 // Divider
 doc.setDrawColor(242, 140, 24);
 doc.setLineWidth(1.5);
 doc.line(40, 122, 550, 122);

 // Summary Section
 doc.setFont("helvetica", "bold");
 doc.setFontSize(14);
 doc.text("Financial Summary", 40, 145);

 doc.setFont("helvetica", "normal");
 doc.setFontSize(11);
 doc.text(`Total Collections: Rs ${totalAmount.toLocaleString("en-IN")}`, 40, 165);
 doc.text(`- Pooja Bookings Value: Rs ${totalPooja.toLocaleString("en-IN")}`, 60, 180);
 doc.text(`- Donations Value: Rs ${totalDonations.toLocaleString("en-IN")}`, 60, 195);
 doc.text(`- Prasadam Sales Value: Rs ${totalPrasadam.toLocaleString("en-IN")}`, 60, 210);

 let yPos = 230;
 doc.text("Collections by Payment Mode:", 40, yPos);
 yPos += 15;
 doc.text(`- Total Cash Payments: Rs ${paymentBreakdown["Cash"].toLocaleString("en-IN")}`, 60, yPos);
 yPos += 15;
 doc.text(`- Total UPI Payments: Rs ${paymentBreakdown["UPI"].toLocaleString("en-IN")}`, 60, yPos);
 yPos += 15;
 doc.text(`- Total Card Payments: Rs ${paymentBreakdown["Card"].toLocaleString("en-IN")}`, 60, yPos);
 yPos += 15;
 doc.text(`- Total Bank Transfer Payments: Rs ${paymentBreakdown["Bank Transfer"].toLocaleString("en-IN")}`, 60, yPos);

 yPos += 25;

 // 2. Devotees Table
 const rangeDevotees = devotees.filter((dev) => {
 const dk = toDateKey(dev.createdAt);
 return (!fromDate || dk >= fromDate) && (!toDate || dk <= toDate);
 });
 if (rangeDevotees.length > 0) {
 if (yPos > 720) { doc.addPage(); yPos = 40; }
 doc.setFont("helvetica", "bold");
 doc.setFontSize(13);
 doc.text("Registered Devotees in Range", 40, yPos);
 yPos += 10;

 const devoteesData = rangeDevotees.map((d) => [
 d.name || "-",
 d.email || "-",
 d.phone || "-",
 d.address || "-"
 ]);

 autoTable(doc, {
 startY: yPos,
 head: [["Name", "Email", "Phone", "Address"]],
 body: devoteesData,
 theme: "striped",
 headStyles: { fillColor: [242, 140, 24] },
 styles: { fontSize: 9 }
 });
 yPos = doc.lastAutoTable.finalY + 25;
 }

 // 3. Prasadam Orders Table
 if (rangePrasadamOrders.length > 0) {
 if (yPos > 720) { doc.addPage(); yPos = 40; }
 doc.setFont("helvetica", "bold");
 doc.setFontSize(13);
 doc.text("Prasadam Orders in Range", 40, yPos);
 yPos += 10;

 const ordersData = rangePrasadamOrders.map((o) => [
 o.devoteeName || "Walk-in",
 o.itemName || "-",
 o.quantity || "1",
 `Rs ${(o.amount || o.totalPrice || 0).toLocaleString("en-IN")}`,
 o.paymentMethod || "Cash",
 o.status || "Completed"
 ]);

 autoTable(doc, {
 startY: yPos,
 head: [["Devotee Name", "Item", "Qty", "Total Price", "Payment Mode", "Status"]],
 body: ordersData,
 theme: "striped",
 headStyles: { fillColor: [242, 140, 24] },
 styles: { fontSize: 9 }
 });
 yPos = doc.lastAutoTable.finalY + 25;
 }

 // 4. Donations Table
 if (rangeDonations.length > 0) {
 if (yPos > 720) { doc.addPage(); yPos = 40; }
 doc.setFont("helvetica", "bold");
 doc.setFontSize(13);
 doc.text("Donations in Range", 40, yPos);
 yPos += 10;

 const donationsData = rangeDonations.map((d) => [
 d.devoteeName || d.donorName || "Anonymous",
 d.donationType || "-",
 d.festivalEvent || "General",
 `Rs ${Number(d.amount || 0).toLocaleString("en-IN")}`,
 d.paymentMethod || "Cash"
 ]);

 autoTable(doc, {
 startY: yPos,
 head: [["Donor Name", "Donation Type", "Event", "Amount", "Payment Mode"]],
 body: donationsData,
 theme: "striped",
 headStyles: { fillColor: [16, 163, 74] },
 styles: { fontSize: 9 }
 });
 yPos = doc.lastAutoTable.finalY + 25;
 }

 // 5. Pooja Bookings Table
 if (rangeBookings.length > 0) {
 if (yPos > 720) { doc.addPage(); yPos = 40; }
 doc.setFont("helvetica", "bold");
 doc.setFontSize(13);
 doc.text("Pooja Bookings in Range", 40, yPos);
 yPos += 10;

 const bookingsData = rangeBookings.map((b) => [
 b.devoteeName || "Devotee",
 b.service || b.sevaType || b.poojaName || "-",
 new Date(b.datetime || b.bookingDate).toLocaleDateString("en-IN"),
 `Rs ${Number(b.amount || b.price || 0).toLocaleString("en-IN")}`,
 b.status || "Confirmed"
 ]);

 autoTable(doc, {
 startY: yPos,
 head: [["Devotee Name", "Pooja/Seva", "Booking Date", "Amount", "Status"]],
 body: bookingsData,
 theme: "striped",
 headStyles: { fillColor: [37, 99, 235] },
 styles: { fontSize: 9 }
 });
 yPos = doc.lastAutoTable.finalY + 25;
 }

 // 6. Transaction History Table
 if (rangeBills.length > 0) {
 if (yPos > 720) { doc.addPage(); yPos = 40; }
 doc.setFont("helvetica", "bold");
 doc.setFontSize(13);
 doc.text("Transaction History in Range", 40, yPos);
 yPos += 10;

 const transactionsData = rangeBills.map((b, index) => [
 b.referenceNo || `RC-${String(index + 1).padStart(4, "0")}`,
 b.devoteeName || "-",
 b.billType || "Other",
 b.sevaType || "-",
 `Rs ${Number(b.amount || 0).toLocaleString("en-IN")}`,
 b.paymentMode || "Cash",
 new Date(b.billDate || b.createdAt).toLocaleDateString("en-IN")
 ]);

 autoTable(doc, {
 startY: yPos,
 head: [["Receipt No", "Devotee Name", "Type", "Service", "Amount", "Mode", "Date"]],
 body: transactionsData,
 theme: "striped",
 headStyles: { fillColor: [51, 65, 85] },
 styles: { fontSize: 8.5 }
 });
 }

 doc.save(`Report_${fromDate}_to_${toDate}.pdf`);
 };

 const stats = [
 {
 title: "Total Revenues",
 value: formatCurrency(sumBy(bills, (bill) => bill.amount)),
 note: `All lifetime collections`,
 tone: "orange",
 },
 {
 title: "Pooja Revenue",
 value: formatCurrency(sumBy(bookings.filter(b => !String(b.service || "").toLowerCase().includes("room allotment")), (b) => b.amount || b.price || 0)),
 note: `${bookings.filter(b => !String(b.service || "").toLowerCase().includes("room allotment")).length} bookings total`,
 tone: "gold",
 },
 {
 title: "Total Donations",
 value: formatCurrency(sumBy(donations, (donation) => donation.amount)),
 note: `${donations.length} records total`,
 tone: "green",
 },
 {
 title: "Prasadam Sales",
 value: formatCurrency(sumBy(prasadamOrders, (order) => order.amount || order.totalPrice)),
 note: `${prasadamOrders.length} orders total`,
 tone: "blue",
 },
 {
 title: "Room Booked Revenue",
 value: formatCurrency(sumBy(
 roomBookings.filter(rb => ["paid", "completed", "active"].includes(String(rb.status || "").toLowerCase())),
 (rb) => rb.amount || 0
 )),
 note: `${roomBookings.filter(rb => ["paid", "completed", "active"].includes(String(rb.status || "").toLowerCase())).length} paid room booking${roomBookings.filter(rb => ["paid", "completed", "active"].includes(String(rb.status || "").toLowerCase())).length !== 1 ? "s" : ""}`,
 tone: "purple",
 },
 ];

 return (
 <CashierPageShell
 eyebrow="Temple Cashier Dashboard"
 title=""
 description=""
 image={templeBg}
 imageAlt="Temple dashboard background"
 stats={stats}
 actions={
 <>
 <div className="flex flex-col gap-1 mr-2">
 <div className="flex flex-wrap items-center gap-2">
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] font-extrabold text-[#8a5200] uppercase tracking-wider">From:</span>
 <input
 type="date"
 value={fromDate}
 max={toDateKey(new Date())}
 onChange={(e) => handleFromDateChange(e.target.value)}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#f28c18]"
 />
 </div>
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] font-extrabold text-[#8a5200] uppercase tracking-wider">To:</span>
 <input
 type="date"
 value={toDate}
 max={toDateKey(new Date())}
 onChange={(e) => handleToDateChange(e.target.value)}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#f28c18]"
 />
 </div>
 </div>
 {dateError && (
 <span className="text-[10px] font-bold text-red-600 animate-pulse mt-0.5 ml-1">
 ⚠️ {dateError}
 </span>
 )}
 </div>
 <button
 type="button"
 onClick={downloadRangeReport}
 className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
 >
 Download Range Report
 </button>
 <button
 type="button"
 onClick={() => navigate("/cashier/billing")}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 Open Billing
 </button>
 <button
 type="button"
 onClick={() => navigate("/cashier/pooja-bookings")}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Pooja Bookings
 </button>
 <button
 type="button"
 onClick={() => navigate("/cashier/donations")}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Donations
 </button>
 <button
 type="button"
 onClick={() => navigate("/cashier/receipts")}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Receipts
 </button>
 </>
 }
 >
 <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
 <section className="group relative overflow-hidden rounded-[28px] border border-amber-200/80 bg-white/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-2xl p-6 shadow-xl shadow-amber-950/5 transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/10">
 <div className="flex items-center justify-between gap-3 mb-4">
 <div>
 <h2 className="text-xl font-black font-serif text-slate-900">Seven day collection trend</h2>
 <p className="mt-1 text-xs font-semibold text-slate-500">Bills recorded across pooja, donation and prasadam counters.</p>
 </div>
 <span className="rounded-full border border-amber-300/60 bg-amber-100/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-extrabold uppercase tracking-widest text-amber-900 shadow-xs">
 Live ledger
 </span>
 </div>
 <div className="mt-5 h-[280px]">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={dailySeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
 <defs>
 <linearGradient id="cashierLine" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#d97706" stopOpacity={0.45} />
 <stop offset="95%" stopColor="#ea580c" stopOpacity={0.02} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#fde68a" opacity={0.5} />
 <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#475569", fontSize: 11, fontWeight: 700 }} />
 <YAxis tickLine={false} axisLine={false} tick={{ fill: "#475569", fontSize: 11, fontWeight: 700 }} />
 <Tooltip
 contentStyle={{ background: "#0f172a", borderRadius: 16, border: "1px solid rgba(245, 158, 11, 0.3)", color: "#fff", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}
 labelStyle={{ color: "#fde68a", fontWeight: "bold" }}
 />
 <Area type="monotone" dataKey="amount" stroke="#d97706" strokeWidth={3.5} fill="url(#cashierLine)" />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </section>

 <section className="group relative overflow-hidden rounded-[28px] border border-amber-200/80 bg-white/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-2xl p-6 shadow-xl shadow-amber-950/5 transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/10">
 <div className="flex items-center justify-between gap-3 mb-4">
 <div>
 <h2 className="text-xl font-black font-serif text-slate-900">Payment methods</h2>
 <p className="mt-1 text-xs font-semibold text-slate-500">Where today's collections are coming from.</p>
 </div>
 </div>
 <div className="relative mt-2 h-[220px]">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie data={paymentSeries} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={3}>
 {paymentSeries.map((entry) => (
 <Cell key={entry.name} fill={entry.color} stroke="#fff" strokeWidth={2} />
 ))}
 </Pie>
 <Tooltip />
 </PieChart>
 </ResponsiveContainer>
 </div>
 <div className="grid gap-2 sm:grid-cols-2 mt-3">
 {paymentSeries.map((item) => (
 <div key={item.name} className="flex items-center justify-between rounded-2xl border border-amber-100/80 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs transition-all hover:bg-amber-100/60 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <span className="font-bold text-slate-800 flex items-center gap-2">
 <span className="h-2.5 w-2.5 rounded-full shadow-xs" style={{ backgroundColor: item.color }} />
 {item.name}
 </span>
 <span className="font-black text-slate-900">{formatCurrency(item.value)}</span>
 </div>
 ))}
 </div>
 </section>
 </div>

 <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
 <section className="group relative overflow-hidden rounded-[28px] border border-amber-200/80 bg-white/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-2xl p-6 shadow-xl shadow-amber-950/5">
 <div className="flex items-center justify-between gap-3 mb-4">
 <div>
 <h2 className="text-xl font-black font-serif text-slate-900">Recent cashier activity</h2>
 <p className="mt-1 text-xs font-semibold text-slate-500">Latest bill records written by the counter.</p>
 </div>
 <span className="rounded-full bg-amber-100/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-amber-200/60 px-3 py-1 text-xs font-bold text-amber-900">
 {loading ? "Loading..." : `${recentActivity.length} shown`}
 </span>
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[860px] text-left text-sm">
 <thead className="bg-amber-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider text-slate-600">
 <tr>
 <th className="px-4 py-3.5">Receipt</th>
 <th className="px-4 py-3.5">Devotee</th>
 <th className="px-4 py-3.5">Type</th>
 <th className="px-4 py-3.5">Service</th>
 <th className="px-4 py-3.5">Amount</th>
 <th className="px-4 py-3.5">Method</th>
 <th className="px-4 py-3.5">Date</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-amber-100/60">
 {recentActivity.map((row) => (
 <tr key={row.id} className="transition-colors hover:bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <td className="px-4 py-3.5 font-bold text-slate-900">{row.id}</td>
 <td className="px-4 py-3.5 font-semibold text-slate-800">{row.name}</td>
 <td className="px-4 py-3.5 text-slate-700">{row.type}</td>
 <td className="px-4 py-3.5 text-slate-700">{row.service}</td>
 <td className="px-4 py-3.5 font-black text-amber-900">{formatCurrency(row.amount)}</td>
 <td className="px-4 py-3.5 font-medium text-slate-800">{row.paymentMode}</td>
 <td className="px-4 py-3.5 text-xs text-slate-500">{row.date}</td>
 </tr>
 ))}
 {!recentActivity.length ? (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500 font-medium">
 No bill records found yet.
 </td>
 </tr>
 ) : null}
 </tbody>
 </table>
 </div>
 </section>

 <aside className="space-y-6">
 <section className="group relative overflow-hidden rounded-[28px] border border-amber-200/80 bg-white/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-2xl p-6 shadow-xl shadow-amber-950/5">
 <h2 className="text-xl font-black font-serif text-slate-900 mb-4">Quick actions</h2>
 <div className="grid grid-cols-2 gap-3">
 {[
 { label: "Billing", path: "/cashier/billing" },
 { label: "Pooja", path: "/cashier/pooja-bookings" },
 { label: "Donations", path: "/cashier/donations" },
 { label: "Prasadam", path: "/cashier/prasadam-sales" },
 { label: "Receipts", path: "/cashier/receipts" },
 { label: "Reports", path: "/cashier/reports" },
 ].map((item) => (
 <button
 key={item.label}
 type="button"
 onClick={() => navigate(item.path)}
 className="rounded-2xl border border-amber-200/70 bg-amber-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-3.5 text-xs font-bold text-slate-900 transition-all duration-200 hover:bg-gradient-to-r hover:from-amber-500 hover:to-orange-600 hover:text-white hover:shadow-lg hover:shadow-amber-500/25 hover:-translate-y-0.5"
 >
 {item.label}
 </button>
 ))}
 </div>
 </section>
 </aside>
 </div>
 </CashierPageShell>
 );
};

export default CashierDashboardPage;
