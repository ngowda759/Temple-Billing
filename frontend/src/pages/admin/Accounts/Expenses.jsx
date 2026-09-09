import React, { useState, useEffect } from "react";
import { FiSearch, FiFilter, FiDownload, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { BiTrendingDown, BiMoney, BiLibrary, BiTimeFive, BiCheckCircle } from "react-icons/bi";
import { toast } from "react-toastify";
import { getTransactions } from "../../../services/accountService";

const Expenses = () => {
 const [transactions, setTransactions] = useState([]);
 const [loading, setLoading] = useState(true);
 const [filterCategory, setFilterCategory] = useState("All Expenses");
 const [searchTerm, setSearchTerm] = useState("");
 const [paymentMethod, setPaymentMethod] = useState("All Payment Methods");
 
 // Pagination
 const [currentPage, setCurrentPage] = useState(1);
 const itemsPerPage = 7;

 useEffect(() => {
 fetchExpenses();
 }, []);

 const fetchExpenses = async () => {
 try {
 setLoading(true);
 const data = await getTransactions({ transactionType: "Debit" });
 setTransactions(data);
 } catch (error) {
 toast.error("Failed to load expense transactions");
 } finally {
 setLoading(false);
 }
 };

 // Metrics Calculation
 const totalExpenses = transactions.reduce((acc, curr) => acc + curr.amount, 0);
 const cashExpenses = transactions.filter(t => t.paymentMethod === "Cash").reduce((acc, curr) => acc + curr.amount, 0);
 const bankExpenses = transactions.filter(t => t.paymentMethod === "Bank Transfer" || t.paymentMethod === "System").reduce((acc, curr) => acc + curr.amount, 0);
 const pendingBills = transactions.filter(t => t.status === "Pending Approval").length;
 const paidBills = transactions.filter(t => t.status === "Completed" || t.status === "Approved").length;

 // Filtered Transactions
 const filteredData = transactions.filter(t => {
 // Some categories might not exactly match the pill, so we use a loose includes or match logic
 const matchCategory = filterCategory === "All Expenses" || t.category?.toLowerCase().includes(filterCategory.toLowerCase());
 const matchPayment = paymentMethod === "All Payment Methods" || t.paymentMethod === paymentMethod;
 const matchSearch = t.description?.toLowerCase().includes(searchTerm.toLowerCase()) || 
 t.category?.toLowerCase().includes(searchTerm.toLowerCase());
 return matchCategory && matchPayment && matchSearch;
 });

 const totalPages = Math.ceil(filteredData.length / itemsPerPage);
 const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

 const getPageNumbers = () => {
 const pages = [];
 if (totalPages <= 7) {
 for (let i = 1; i <= totalPages; i++) {
 pages.push(i);
 }
 } else {
 if (currentPage <= 4) {
 pages.push(1, 2, 3, 4, 5, '...', totalPages);
 } else if (currentPage >= totalPages - 3) {
 pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
 } else {
 pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
 }
 }
 return pages;
 };

 const categories = ["All Expenses", "Inventory Purchase", "Salary", "Repairs", "Maintenance", "Electricity", "Water", "Cleaning", "Office", "Miscellaneous"];

 return (
 <div className="p-4 md:p-8 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] min-h-screen font-sans">
 <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <h1 className="text-2xl font-bold text-[#1d1b19] dark:text-slate-200 ">Expenses</h1>
 <p className="text-sm text-[#5c6675]">Accounts & Finance &gt; Expenses</p>
 </div>
 </div>

 {/* Filter Pills */}
 <div className="flex flex-wrap gap-2 mb-6">
 {categories.map(cat => (
 <button
 key={cat}
 onClick={() => { setFilterCategory(cat); setCurrentPage(1); }}
 className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${ filterCategory === cat ? "bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white border-[#ff8b00]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " }`}
 >
 {cat}
 </button>
 ))}
 </div>

 {/* Controls */}
 <div className="flex flex-wrap items-center gap-4 mb-6">
 <div className="flex items-center gap-2 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 ">
 <span className="text-slate-400">01/07/2026 - 27/07/2026</span>
 </div>
 <select 
 className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-200 outline-none"
 value={paymentMethod}
 onChange={(e) => { setPaymentMethod(e.target.value); setCurrentPage(1); }}
 >
 <option>All Payment Methods</option>
 <option>Cash</option>
 <option>UPI</option>
 <option>Card</option>
 <option>Bank Transfer</option>
 <option>System</option>
 </select>
 <div className="flex items-center bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 flex-grow max-w-md">
 <FiSearch className="text-slate-400 mr-2" />
 <input
 type="text"
 placeholder="Search expenses..."
 className="bg-transparent border-none outline-none text-sm w-full"
 value={searchTerm}
 onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
 />
 </div>
 <button className="flex items-center gap-2 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ml-auto">
 <FiFilter /> Filter
 </button>
 <button className="flex items-center gap-2 bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-[#e67a00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
 <FiDownload /> Export
 </button>
 </div>

 {/* Metrics Cards */}
 <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
 <div>
 <p className="text-xs text-slate-500 dark:text-slate-200 font-medium mb-1">Total Expenses</p>
 <p className="text-xl font-bold text-slate-800 dark:text-slate-200 ">₹{totalExpenses.toLocaleString("en-IN")}</p>
 </div>
 <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-red-500">
 <BiTrendingDown size={20} />
 </div>
 </div>
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
 <div>
 <p className="text-xs text-slate-500 dark:text-slate-200 font-medium mb-1">Cash Expenses</p>
 <p className="text-xl font-bold text-slate-800 dark:text-slate-200 ">₹{cashExpenses.toLocaleString("en-IN")}</p>
 </div>
 <div className="w-10 h-10 rounded-full bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-green-500">
 <BiMoney size={20} />
 </div>
 </div>
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
 <div>
 <p className="text-xs text-slate-500 dark:text-slate-200 font-medium mb-1">Bank Expenses</p>
 <p className="text-xl font-bold text-slate-800 dark:text-slate-200 ">₹{bankExpenses.toLocaleString("en-IN")}</p>
 </div>
 <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-blue-500">
 <BiLibrary size={20} />
 </div>
 </div>
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
 <div>
 <p className="text-xs text-slate-500 dark:text-slate-200 font-medium mb-1">Pending Bills</p>
 <p className="text-xl font-bold text-slate-800 dark:text-slate-200 ">{pendingBills}</p>
 </div>
 <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-amber-500">
 <BiTimeFive size={20} />
 </div>
 </div>
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
 <div>
 <p className="text-xs text-slate-500 dark:text-slate-200 font-medium mb-1">Paid Bills</p>
 <p className="text-xl font-bold text-slate-800 dark:text-slate-200 ">{paidBills}</p>
 </div>
 <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] flex items-center justify-center text-emerald-500">
 <BiCheckCircle size={20} />
 </div>
 </div>
 </div>

 {/* Table */}
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
 <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 ">
 <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 ">Expense Transactions</h2>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm text-slate-600 dark:text-slate-200 ">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-xs uppercase font-medium text-slate-500 dark:text-slate-200 ">
 <tr>
 <th className="px-6 py-3">Date</th>
 <th className="px-6 py-3">Description</th>
 <th className="px-6 py-3">Category</th>
 <th className="px-6 py-3">Payment Method</th>
 <th className="px-6 py-3">Bill No.</th>
 <th className="px-6 py-3 text-right">Amount (₹)</th>
 <th className="px-6 py-3 text-center">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100">
 {loading ? (
 <tr>
 <td colSpan="7" className="px-6 py-8 text-center text-slate-400">Loading expenses...</td>
 </tr>
 ) : paginatedData.length === 0 ? (
 <tr>
 <td colSpan="7" className="px-6 py-8 text-center text-slate-400">No expense transactions found</td>
 </tr>
 ) : (
 paginatedData.map((t) => (
 <tr key={t._id} className="hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <td className="px-6 py-3 whitespace-nowrap">{new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
 <td className="px-6 py-3">{t.description || t.source || "-"}</td>
 <td className="px-6 py-3">{t.category}</td>
 <td className="px-6 py-3">{t.paymentMethod || "System"}</td>
 <td className="px-6 py-3">{`${t.category?.substring(0, 3).toUpperCase()}/2026/${t._id.substring(t._id.length - 3)}`}</td>
 <td className="px-6 py-3 text-right font-medium text-slate-700 dark:text-slate-200 ">{t.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
 <td className="px-6 py-3 text-center">
 <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ t.status === "Completed" || t.status === "Approved" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800" : t.status === "Pending Approval" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-800" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 " }`}>
 {t.status === "Completed" ? "Paid" : t.status === "Pending Approval" ? "Pending" : t.status}
 </span>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 
 {/* Pagination */}
 <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
 <p className="text-sm text-slate-500 dark:text-slate-200 ">
 Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredData.length)} to {Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} entries
 </p>
 <div className="flex gap-1">
 <button 
 disabled={currentPage === 1}
 onClick={() => setCurrentPage(p => p - 1)}
 className="p-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] disabled:opacity-50"
 >
 <FiChevronLeft size={18} />
 </button>
 {getPageNumbers().map((page, index) => (
 <button
 key={index}
 onClick={() => typeof page === 'number' && setCurrentPage(page)}
 disabled={page === '...'}
 className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${ currentPage === page ? "bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white border border-[#ff8b00]" : page === '...' ? "text-slate-400 cursor-default" : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " }`}
 >
 {page}
 </button>
 ))}
 <button 
 disabled={currentPage === totalPages || totalPages === 0}
 onClick={() => setCurrentPage(p => p + 1)}
 className="p-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] disabled:opacity-50"
 >
 <FiChevronRight size={18} />
 </button>
 </div>
 </div>
 </div>
 </div>
 );
};

export default Expenses;
