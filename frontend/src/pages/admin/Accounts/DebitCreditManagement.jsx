import React, { useState, useEffect } from "react";
import { getTransactions, approveExpense } from "../../../services/accountService";
import { FiCheck, FiX, FiFilter } from "react-icons/fi";

const DebitCreditManagement = () => {
 const [transactions, setTransactions] = useState([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 fetchTransactions();
 }, []);

 const fetchTransactions = async () => {
 try {
 const data = await getTransactions();
 setTransactions(data);
 } catch (error) {
 console.error("Failed to fetch transactions", error);
 } finally {
 setLoading(false);
 }
 };

 const handleApprove = async (id, status) => {
 try {
 await approveExpense(id, status);
 fetchTransactions();
 } catch (error) {
 console.error("Failed to approve expense", error);
 }
 };

 const formatCurrency = (amount) => {
 return new Intl.NumberFormat("en-IN", {
 style: "currency",
 currency: "INR",
 }).format(amount);
 };

 return (
 <div className="p-6 space-y-6">
 <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-6">Debit & Credit Management</h2>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xl">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm text-slate-800 dark:text-slate-200 ">
 <thead className="bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-600 dark:text-slate-200 ">
 <tr>
 <th className="px-6 py-4 font-semibold">Date</th>
 <th className="px-6 py-4 font-semibold">Type</th>
 <th className="px-6 py-4 font-semibold">Category</th>
 <th className="px-6 py-4 font-semibold">Source</th>
 <th className="px-6 py-4 font-semibold">Amount</th>
 <th className="px-6 py-4 font-semibold">Status</th>
 <th className="px-6 py-4 font-semibold text-right">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-200 dark:divide-white/10">
 {loading ? (
 <tr>
 <td colSpan="7" className="px-6 py-8 text-center text-slate-500 dark:text-slate-200 ">Loading...</td>
 </tr>
 ) : transactions.length === 0 ? (
 <tr>
 <td colSpan="7" className="px-6 py-8 text-center text-slate-500 dark:text-slate-200 ">No transactions found</td>
 </tr>
 ) : (
 transactions.map((t) => (
 <tr key={t._id} className="hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:hover:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition-colors">
 <td className="px-6 py-4">{new Date(t.date).toLocaleDateString()}</td>
 <td className="px-6 py-4">
 <span className={`px-2 py-1 rounded-full text-xs font-medium ${t.transactionType === "Credit" ? "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-400" : "bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-400"}`}>
 {t.transactionType}
 </span>
 </td>
 <td className="px-6 py-4">{t.category}</td>
 <td className="px-6 py-4">{t.source}</td>
 <td className="px-6 py-4 font-medium">{formatCurrency(t.amount)}</td>
 <td className="px-6 py-4">
 <span className={`px-2 py-1 rounded-full text-xs font-medium ${ t.status === "Completed" ? "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-400" : t.status === "Pending Approval" ? "bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-orange-400" : "bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-400" }`}>
 {t.status}
 </span>
 </td>
 <td className="px-6 py-4 text-right">
 {t.status === "Pending Approval" && (
 <div className="flex justify-end gap-2">
 <button onClick={() => handleApprove(t._id, "Approved")} className="p-2 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-400 hover:bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-lg transition-colors" title="Approve">
 <FiCheck />
 </button>
 <button onClick={() => handleApprove(t._id, "Rejected")} className="p-2 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-400 hover:bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-lg transition-colors" title="Reject">
 <FiX />
 </button>
 </div>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
};

export default DebitCreditManagement;
