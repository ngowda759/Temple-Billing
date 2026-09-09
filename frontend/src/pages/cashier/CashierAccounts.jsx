import React, { useState, useEffect } from "react";
import { FaRupeeSign } from "react-icons/fa";
import { FiList, FiClock, FiCheckSquare } from "react-icons/fi";
import { getDashboardMetrics, submitCashClosing, getTransactions } from "../../services/accountService";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const CashierAccounts = () => {
 const [activeTab, setActiveTab] = useState("daily-cash-book");

 // States
 const [metrics, setMetrics] = useState(null);
 const [transactions, setTransactions] = useState([]);
 const [pendingPayments, setPendingPayments] = useState([]);

 // Form state
 const [closingForm, setClosingForm] = useState({
 openingCash: "",
 cashCollected: "",
 cashDeposited: "",
 closingCash: "",
 notes: ""
 });
 const [loading, setLoading] = useState(true);

 const loadData = async () => {
 setLoading(true);
 try {
 const metricsRes = await getDashboardMetrics();
 setMetrics(metricsRes);
 } catch (error) {
 console.error("Error loading metrics:", error);
 toast.error("Failed to load collection metrics");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 }, []);

 const handleClosingSubmit = async (e) => {
 e.preventDefault();
 try {
 await submitCashClosing(closingForm);
 toast.success("Cash closing submitted successfully");
 setClosingForm({
 openingCash: "",
 cashCollected: "",
 cashDeposited: "",
 closingCash: "",
 notes: ""
 });
 } catch (error) {
 toast.error(error.response?.data?.message || "Failed to submit cash closing");
 }
 };

 const renderTransactionsTable = (data) => (
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm text-slate-800">
 <thead className="bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-6 py-4 font-semibold">Date</th>
 <th className="px-6 py-4 font-semibold">Type</th>
 <th className="px-6 py-4 font-semibold">Source / Category</th>
 <th className="px-6 py-4 font-semibold">Amount</th>
 <th className="px-6 py-4 font-semibold">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-200">
 {data.length === 0 ? (
 <tr>
 <td colSpan="5" className="px-6 py-8 text-center text-slate-500">No transactions found</td>
 </tr>
 ) : (
 data.map((t) => (
 <tr key={t._id} className="hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <td className="px-6 py-4">{new Date(t.date).toLocaleDateString()}</td>
 <td className="px-6 py-4">
 <span className={`px-2 py-1 text-xs font-semibold rounded-full ${t.transactionType === "Credit" ? "bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-700" : "bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-700"}`}>
 {t.transactionType}
 </span>
 </td>
 <td className="px-6 py-4">
 <p className="font-medium">{t.source}</p>
 <p className="text-xs text-slate-500">{t.category}</p>
 </td>
 <td className="px-6 py-4 font-bold">₹{t.amount?.toFixed(2)}</td>
 <td className="px-6 py-4">
 <span className={`px-2 py-1 text-xs font-semibold rounded-full ${t.status === "Completed" ? "bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-700" :
 t.status === "Pending Approval" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700" :
 "bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-700"
 }`}>
 {t.status}
 </span>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 );

 return (
 <div className="p-6 space-y-6">
 <ToastContainer position="top-right" />
 <h2 className="text-2xl font-bold text-slate-800 mb-6">Cashier Accounts</h2>

 <div className="flex gap-4 mb-6 border-b border-slate-200 pb-4 overflow-x-auto whitespace-nowrap">
 <button
 onClick={() => setActiveTab("daily-cash-book")}
 className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === "daily-cash-book" ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
 }`}
 >
 Daily Collection Summary
 </button>
 <button
 onClick={() => setActiveTab("cash-closing")}
 className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === "cash-closing" ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
 }`}
 >
 Shift Closing
 </button>
 </div>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-md border border-slate-200 p-6 rounded-2xl shadow-xl min-h-[400px]">
 {loading ? (
 <div className="flex justify-center items-center h-40">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
 </div>
 ) : (
 <>
 {activeTab === "daily-cash-book" && (
 <div className="space-y-6">
 <h3 className="text-xl font-bold text-slate-800">Today's Summary</h3>
 {metrics && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div className="bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-green-200 p-6 rounded-2xl">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-3 bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-600 rounded-lg">
 <FaRupeeSign className="w-5 h-5" />
 </div>
 <h4 className="text-slate-600 font-medium">Total System Collection</h4>
 </div>
 <p className="text-3xl font-bold text-slate-800">₹{metrics.todayIncome?.toFixed(2) || '0.00'}</p>
 </div>
 </div>
 )}
 </div>
 )}

 {activeTab === "cash-closing" && (
 <div className="max-w-2xl mx-auto space-y-6">
 <div>
 <h3 className="text-xl font-bold text-slate-800 mb-2">Daily Cash Closing</h3>
 <p className="text-slate-600 text-sm">Submit the final cash counts for the day to be verified by an Accountant.</p>
 </div>

 <form onSubmit={handleClosingSubmit} className="space-y-4">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">Opening Cash (₹)</label>
 <input
 type="number"
 required
 min="0"
 step="1"
 value={closingForm.openingCash}
 onChange={(e) => setClosingForm({ ...closingForm, openingCash: e.target.value })}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-200 rounded-lg px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
 placeholder="0.00"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">Cash Collected (₹)</label>
 <input
 type="number"
 required
 min="0"
 step="1"
 value={closingForm.cashCollected}
 onChange={(e) => setClosingForm({ ...closingForm, cashCollected: e.target.value })}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-200 rounded-lg px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
 placeholder="0.00"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">Cash Deposited in Bank (₹)</label>
 <input
 type="number"
 required
 min="0"
 step="1"
 value={closingForm.cashDeposited}
 onChange={(e) => setClosingForm({ ...closingForm, cashDeposited: e.target.value })}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-200 rounded-lg px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
 placeholder="0.00"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">Actual Closing Cash (₹)</label>
 <input
 type="number"
 required
 min="0"
 step="1"
 value={closingForm.closingCash}
 onChange={(e) => setClosingForm({ ...closingForm, closingCash: e.target.value })}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-200 rounded-lg px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
 placeholder="0.00"
 />
 </div>
 </div>

 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">Notes / Discrepancy Reasons</label>
 <textarea
 rows="3"
 value={closingForm.notes}
 onChange={(e) => setClosingForm({ ...closingForm, notes: e.target.value })}
 className="w-full bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-slate-200 rounded-lg px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
 placeholder="Add any notes here..."
 />
 </div>

 <button
 type="submit"
 className="w-full bg-amber-500 hover:bg-amber-600 text-white font-medium py-2 rounded-lg transition-colors"
 >
 Submit Cash Closing
 </button>
 </form>
 </div>
 )}


 </>
 )}
 </div>
 </div>
 );
};

export default CashierAccounts;
