import { useEffect, useMemo, useState } from "react";
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
import { FaDownload, FaChartPie, FaSyncAlt } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import {
 fetchBookings,
 fetchBills,
 fetchDonations,
 fetchPrasadamOrders,
 formatCurrency,
 formatDateTime,
 inferBillType,
 isToday,
 sumBy,
 toDateKey,
} from "../../services/cashierService";

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

const ReportsPage = () => {
 const [loading, setLoading] = useState(true);
 const [bookings, setBookings] = useState([]);
 const [donations, setDonations] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [bills, setBills] = useState([]);
 const [range, setRange] = useState("monthly");

 const loadData = async () => {
 setLoading(true);
 try {
 const [bookingRows, donationRows, orderRows, billRows] = await Promise.allSettled([
 fetchBookings(),
 fetchDonations(),
 fetchPrasadamOrders(),
 fetchBills(),
 ]);

 setBookings(bookingRows.status === "fulfilled" ? bookingRows.value : []);
 setDonations(donationRows.status === "fulfilled" ? donationRows.value : []);
 setPrasadamOrders(orderRows.status === "fulfilled" ? orderRows.value : []);
 setBills(billRows.status === "fulfilled" ? billRows.value : []);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 }, []);

 const rangeStart = useMemo(() => {
 const now = new Date();
 if (range === "weekly") return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
 if (range === "yearly") return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
 return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
 }, [range]);

 const filteredBills = useMemo(
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
 amount: sumBy(filteredBills.filter((bill) => toDateKey(bill.billDate || bill.createdAt) === day.key), (bill) => bill.amount),
 }));
 }, [filteredBills]);

 const paymentSeries = useMemo(() => {
 const totals = filteredBills.reduce((acc, bill) => {
 const mode = bill.paymentMode || "Cash";
 acc[mode] = (acc[mode] || 0) + Number(bill.amount || 0);
 return acc;
 }, {});

 return Object.entries(totals).map(([name, value]) => ({
 name,
 value,
 color: paymentColors[name] || "#f59e0b",
 }));
 }, [filteredBills]);

 const recentRows = useMemo(
 () =>
 [...filteredBills]
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
 [filteredBills]
 );

 const stats = [
 {
 title: "Report Total",
 value: formatCurrency(sumBy(filteredBills, (bill) => bill.amount)),
 note: `For ${range} range`,
 tone: "orange",
 },
 {
 title: "Bookings",
 value: rangeBookings.length,
 note: `${rangeBookings.filter((booking) => isToday(booking.createdAt)).length} today`,
 tone: "gold",
 },
 {
 title: "Donations",
 value: rangeDonations.length,
 note: "Donation ledger entries",
 tone: "green",
 },
 {
 title: "Prasadam Orders",
 value: rangePrasadamOrders.length,
 note: "Sales records",
 tone: "blue",
 },
 ];

 const paymentTotals = paymentSeries.reduce((total, item) => total + item.value, 0);
 const bookingRevenue = useMemo(() => sumBy(filteredBills.filter((bill) => inferBillType(bill) === "Pooja Booking"), (bill) => bill.amount), [filteredBills]);
 const donationRevenue = useMemo(() => sumBy(filteredBills.filter((bill) => inferBillType(bill) === "Donation"), (bill) => bill.amount), [filteredBills]);
 const prasadamRevenue = useMemo(() => sumBy(filteredBills.filter((bill) => inferBillType(bill) === "Prasadam Sale"), (bill) => bill.amount), [filteredBills]);

 const handleDownloadCsv = () => {
 const rows = [
 ["Receipt", "Type", "Service", "Amount", "Payment", "Status", "Date"],
 ...recentRows.map((row) => [row.id, row.type, row.service, row.amount, row.paymentMode, row.status, row.date]),
 ];

 const csv = rows
 .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
 .join("\r\n");
 const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.download = `cashier-report-${range}.csv`;
 link.click();
 URL.revokeObjectURL(url);
 };

 return (
 <CashierPageShell
 eyebrow="Reports"
 title="Cashier reports for bookings, donations and prasadam sales"
 description="Use the date range controls, review the charts and export the ledger whenever you need a cashier summary."
 image={templeBg}
 imageAlt="Temple cashier reports"
 stats={stats}
 actions={
 <>
 <button
 type="button"
 onClick={loadData}
 className="inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaSyncAlt /> Refresh
 </button>
 <button
 type="button"
 onClick={handleDownloadCsv}
 className="inline-flex items-center gap-2 rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 <FaDownload /> Export CSV
 </button>
 </>
 }
 >
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
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
 <p className="mt-3 text-3xl font-extrabold text-slate-950">{formatCurrency(sumBy(filteredBills, (bill) => bill.amount))}</p>
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
 {recentRows.length} rows
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
 ) : recentRows.length ? (
 recentRows.map((row) => (
 <tr key={`${row.id}-${row.date}`} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{row.id}</td>
 <td className="px-4 py-3">{row.type}</td>
 <td className="px-4 py-3">{row.service}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(row.amount)}</td>
 <td className="px-4 py-3">{row.paymentMode}</td>
 <td className="px-4 py-3 text-slate-700">{row.date}</td>
 <td className="px-4 py-3">
 <span className="inline-flex rounded-full bg-[#def7e3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-bold text-[#166534]">
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
 </CashierPageShell>
 );
};

export default ReportsPage;
