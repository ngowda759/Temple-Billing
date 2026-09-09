import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCreditCard, FaMoneyBillWave, FaReceipt, FaSyncAlt } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import {
 fetchBills,
 formatCurrency,
 formatDateTime,
 inferBillType,
 isToday,
 sumBy,
} from "../../services/cashierService";

const PaymentProcessing = () => {
 const navigate = useNavigate();
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

 const recentBills = useMemo(
 () =>
 [...bills]
 .sort((a, b) => new Date(b.billDate || b.createdAt || 0) - new Date(a.billDate || a.createdAt || 0))
 .slice(0, 12),
 [bills]
 );

 const pendingCount = useMemo(
 () => bills.filter((bill) => (bill.status || "Paid") === "Pending").length,
 [bills]
 );

 const stats = [
 {
 title: "Today Amount",
 value: formatCurrency(sumBy(bills.filter((bill) => isToday(bill.billDate || bill.createdAt)), (bill) => bill.amount)),
 note: "Live counter total",
 tone: "orange",
 },
 {
 title: "Bill Count",
 value: bills.length,
 note: "All payment records",
 tone: "gold",
 },
 {
 title: "Paid",
 value: bills.filter((bill) => (bill.status || "Paid") === "Paid").length,
 note: "Settled successfully",
 tone: "green",
 },
 {
 title: "Pending",
 value: pendingCount,
 note: "Needs settlement",
 tone: "blue",
 },
 ];

 return (
 <CashierPageShell
 eyebrow="Payments"
 image={templeBg}
 imageAlt="Temple payment counter"
 stats={stats}
 actions={
 <>
 <button
 type="button"
 onClick={loadBills}
 className="inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <FaSyncAlt /> Refresh
 </button>
 <button
 type="button"
 onClick={() => navigate("/cashier/billing")}
 className="inline-flex items-center gap-2 rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 <FaReceipt /> Open Billing
 </button>
 </>
 }
 >
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
 ) : recentBills.length ? (
 recentBills.map((bill, index) => (
 <tr key={bill._id || bill.referenceNo || index} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{bill.referenceNo || `RC-${String(index + 1).padStart(4, "0")}`}</td>
 <td className="px-4 py-3">{inferBillType(bill)}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(bill.amount)}</td>
 <td className="px-4 py-3">{bill.paymentMode || "Cash"}</td>
 <td className="px-4 py-3">
 <span className="inline-flex rounded-full bg-[#def7e3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-bold text-[#166534]">
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
 </CashierPageShell>
 );
};

export default PaymentProcessing;
