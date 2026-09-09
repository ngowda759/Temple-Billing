import React, { useState } from "react";

const AdminInventoryRequests = () => {
 const [activeTab, setActiveTab] = useState("Pending");

 const tabs = ["Pending","Approved","Rejected","Issued","Completed"];

 return (
 <div className="p-4 md:p-8 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] min-h-screen">
 <div className="mb-6">
 <h1 className="text-2xl font-bold text-[#1d1b19] dark:text-slate-200 ">Inventory Requests</h1>
 <p className="text-sm text-[#5c6675]">Manage and approve inventory requests.</p>
 <div className="mt-2 h-1 w-12 rounded-full bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " />
 </div>
 
 {/* Tabs */}
 <div className="flex space-x-1 border-b border-slate-200 dark:border-slate-700 mb-6 overflow-x-auto pb-1">
 {tabs.map((tab) => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${ activeTab === tab ? "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ff8b00] border-t border-l border-r border-slate-200 dark:border-slate-700 shadow-sm" : "text-slate-500 dark:text-slate-200 hover:text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " }`}
 >
 {tab}
 </button>
 ))}
 </div>

 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm flex items-center justify-center min-h-[400px] text-slate-500 dark:text-slate-200 ">
 {activeTab} UI goes here.
 </div>
 </div>
 );
};

export default AdminInventoryRequests;
