import { useEffect, useMemo, useState } from "react";
import { FaClock, FaReceipt } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import { fetchBills, formatCurrency, formatDateTime, inferBillType, isToday, sumBy } from "../../services/cashierService";

const TodayTransactions = () => {
 const [bills, setBills] = useState([]);
 const [loading, setLoading] = useState(true);

 const loadBills = async () => {
 setLoading(true);
 try {
 const rows = await fetchBills();
 setBills(rows);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadBills();
 }, []);

 const todayBills = useMemo(
 () =>
 [...bills]
 .filter((bill) => isToday(bill.billDate || bill.createdAt))
 .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0)),
 [bills]
 );

 const stats = [
 {
 title: "Today Count",
 value: todayBills.length,
 note: "Bills generated today",
 tone: "orange",
 },
 {
 title: "Today Amount",
 value: formatCurrency(sumBy(todayBills, (bill) => bill.amount)),
 note: "Daily counter total",
 tone: "gold",
 },
 {
 title: "Paid",
 value: todayBills.filter((bill) => (bill.status || "Paid") === "Paid").length,
 note: "Completed receipts",
 tone: "green",
 },
 {
 title: "Pending",
 value: todayBills.filter((bill) => (bill.status || "Paid") === "Pending").length,
 note: "Waiting payment",
 tone: "blue",
 },
 ];

 return (
 <CashierPageShell
 eyebrow="Today Transactions"
 title="All transactions recorded today"
 description="Use this page when you only need the current day’s cashier ledger, without the rest of the monthly report."
 image={templeBg}
 imageAlt="Temple today transactions"
 stats={stats}
 actions={
 <button
 type="button"
 onClick={loadBills}
 className="inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaReceipt /> Refresh Today
 </button>
 }
 >
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Today’s transactions</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Bills created on the current date are listed here.
 </p>
 </div>
 <FaClock className="text-[#f28c18]" />
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[820px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Type</th>
 <th className="px-4 py-3 font-bold">Service</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Date</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
 Loading today’s transactions...
 </td>
 </tr>
 ) : todayBills.length ? (
 todayBills.map((bill, index) => (
 <tr key={bill._id || bill.referenceNo || index} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{bill.referenceNo || `RC-${String(index + 1).padStart(4, "0")}`}</td>
 <td className="px-4 py-3">{inferBillType(bill)}</td>
 <td className="px-4 py-3">{bill.sevaType}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(bill.amount)}</td>
 <td className="px-4 py-3">{bill.paymentMode || "Cash"}</td>
 <td className="px-4 py-3 text-slate-700">{formatDateTime(bill.billDate || bill.createdAt)}</td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
 No transactions were recorded today.
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

export default TodayTransactions;
