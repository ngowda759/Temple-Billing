import React, { useState, useEffect } from "react";
import { FaBoxes, FaExclamationTriangle, FaFileInvoice, FaWrench, FaTrash, FaCheckCircle, FaMoneyBillWave } from "react-icons/fa";
import { FiAlertCircle } from "react-icons/fi";
import { Link } from "react-router-dom";
// Note: You would normally fetch these from an API
const DUMMY_DATA = {
 totalInventoryValue: 1250000,
 totalItems: 450,
 lowStockItems: 12,
 expiringSoon: 5,
 pendingPOs: 3,
 pendingRequests: 8,
 pendingRepairs: 2,
 pendingDamages: 1
};

const AdminInventoryDashboard = () => {
 const [metrics, setMetrics] = useState(DUMMY_DATA);
 const [loading, setLoading] = useState(false);

 return (
 <div className="p-4 md:p-8 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] min-h-screen">
 <div className="mb-6">
 <h1 className="text-2xl font-bold text-[#1d1b19] dark:text-slate-200 ">Inventory Dashboard</h1>
 <p className="text-sm text-[#5c6675]">Overview of Temple Store Management</p>
 <div className="mt-2 h-1 w-12 rounded-full bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " />
 </div>

 {/* SUMMARY CARDS */}
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-sm">
 <div className="flex items-center gap-3">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ff8b00]">
 <FaMoneyBillWave size={24} />
 </div>
 <div>
 <p className="text-sm font-medium text-slate-500 dark:text-slate-200 ">Total Inventory Value</p>
 <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">Rs {metrics.totalInventoryValue.toLocaleString("en-IN")}</h3>
 </div>
 </div>
 </div>
 
 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-sm">
 <div className="flex items-center gap-3">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-blue-600">
 <FaBoxes size={24} />
 </div>
 <div>
 <p className="text-sm font-medium text-slate-500 dark:text-slate-200 ">Total Items</p>
 <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{metrics.totalItems}</h3>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-sm">
 <div className="flex items-center gap-3">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-red-600">
 <FaExclamationTriangle size={24} />
 </div>
 <div>
 <p className="text-sm font-medium text-red-600">Low Stock Items</p>
 <h3 className="text-2xl font-bold text-red-700">{metrics.lowStockItems}</h3>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 shadow-sm">
 <div className="flex items-center gap-3">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-amber-600">
 <FiAlertCircle size={24} />
 </div>
 <div>
 <p className="text-sm font-medium text-amber-600">Expiring Soon</p>
 <h3 className="text-2xl font-bold text-amber-700">{metrics.expiringSoon}</h3>
 </div>
 </div>
 </div>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 {/* PENDING APPROVALS */}
 <div className="lg:col-span-2 space-y-6">
 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">Pending Approvals & Workflows</h3>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-100 flex flex-col items-center justify-center text-center">
 <FaFileInvoice className="text-blue-500 mb-2" size={24} />
 <span className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{metrics.pendingPOs}</span>
 <span className="text-xs text-slate-500 dark:text-slate-200 ">Purchase Orders</span>
 </div>
 <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-100 flex flex-col items-center justify-center text-center">
 <FaBoxes className="text-indigo-500 mb-2" size={24} />
 <span className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{metrics.pendingRequests}</span>
 <span className="text-xs text-slate-500 dark:text-slate-200 ">Staff Requests</span>
 </div>
 <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-100 flex flex-col items-center justify-center text-center">
 <FaWrench className="text-orange-500 mb-2" size={24} />
 <span className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{metrics.pendingRepairs}</span>
 <span className="text-xs text-slate-500 dark:text-slate-200 ">Repair Tickets</span>
 </div>
 <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-slate-100 flex flex-col items-center justify-center text-center">
 <FaTrash className="text-red-500 mb-2" size={24} />
 <span className="text-2xl font-bold text-slate-800 dark:text-slate-200 ">{metrics.pendingDamages}</span>
 <span className="text-xs text-slate-500 dark:text-slate-200 ">Damage Notes</span>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">Inventory Analytics (Coming Soon)</h3>
 <div className="h-48 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-xl border border-slate-100 flex items-center justify-center text-slate-400">
 [ Chart: Monthly Purchase vs Consumption ]
 </div>
 </div>
 </div>

 {/* NOTIFICATIONS & ACTIVITY */}
 <div className="space-y-6">
 <div className="rounded-2xl border border-red-100 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
 <FaExclamationTriangle className="text-red-500" /> Action Required
 </h3>
 <ul className="space-y-3">
 <li className="flex gap-2 text-sm text-slate-600 dark:text-slate-200 ">
 <span className="text-red-500 mt-0.5">⚠️</span> 
 <span><strong>Camphor</strong> is below minimum stock level.</span>
 </li>
 <li className="flex gap-2 text-sm text-slate-600 dark:text-slate-200 ">
 <span className="text-amber-500 mt-0.5">⚠️</span> 
 <span><strong>Cow Ghee (Batch G-102)</strong> expires tomorrow.</span>
 </li>
 <li className="flex gap-2 text-sm text-slate-600 dark:text-slate-200 ">
 <span className="text-blue-500 mt-0.5">ℹ️</span> 
 <span><strong>2 Repair Tickets</strong> are awaiting your approval.</span>
 </li>
 </ul>
 </div>

 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">Recent Activity</h3>
 <ul className="space-y-4">
 <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-200 border-b border-slate-50 pb-3">
 <FaCheckCircle className="text-green-500 mt-0.5" />
 <div>
 <p className="font-medium text-slate-800 dark:text-slate-200 ">Rice Received</p>
 <p className="text-xs">GRN-00142 approved. +500 Kg</p>
 </div>
 </li>
 <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-200 border-b border-slate-50 pb-3">
 <FaBoxes className="text-indigo-500 mt-0.5" />
 <div>
 <p className="font-medium text-slate-800 dark:text-slate-200 ">Kitchen Production</p>
 <p className="text-xs">Prepared 800 Laddus. Stock deducted.</p>
 </div>
 </li>
 <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-200 ">
 <FaCheckCircle className="text-green-500 mt-0.5" />
 <div>
 <p className="font-medium text-slate-800 dark:text-slate-200 ">Damage Note Approved</p>
 <p className="text-xs">2 units of broken bells written off.</p>
 </div>
 </li>
 </ul>
 </div>
 </div>
 </div>
 </div>
 );
};

export default AdminInventoryDashboard;
