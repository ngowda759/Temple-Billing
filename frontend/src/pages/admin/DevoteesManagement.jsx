import { useMemo, useState } from "react";
import { FaDonate, FaEye, FaFilter, FaUsers } from "react-icons/fa";
import { MdCalendarMonth, MdEventAvailable } from "react-icons/md";

const formatCurrency = (value) => `Rs ${Number(value || 0).toLocaleString()}`;

const DevoteesManagement = ({ darkMode, devotees = [], bookings = [], donations = [], onEditProfile }) => {
 const [query, setQuery] = useState("");
 const [filterType, setFilterType] = useState("All");
 const [showFilterMenu, setShowFilterMenu] = useState(false);

 const donationsByName = useMemo(() => {
 const map = new Map();
 donations.forEach((d) => {
 const nameKey = (d.donorName || "").toLowerCase();
 const emailKey = (d.donorEmail || "").toLowerCase();
 if (nameKey) map.set(nameKey, (map.get(nameKey) || 0) + Number(d.amount || 0));
 if (emailKey) map.set(emailKey, (map.get(emailKey) || 0) + Number(d.amount || 0));
 });
 return map;
 }, [donations]);

 const bookingsByName = useMemo(() => {
 const map = new Map();
 bookings.forEach((b) => {
 const nameKey = (b.devoteeName || b.customerName || "").toLowerCase();
 const emailKey = (b.devoteeEmail || b.email || "").toLowerCase();
 if (nameKey) map.set(nameKey, (map.get(nameKey) || 0) + 1);
 if (emailKey) map.set(emailKey, (map.get(emailKey) || 0) + 1);
 });
 return map;
 }, [bookings]);

 const filtered = useMemo(() => {
 const q = query.trim().toLowerCase();
 let result = devotees;
 if (q) {
 result = result.filter((d) => (d.name || "").toLowerCase().includes(q) || (d.email || "").toLowerCase().includes(q));
 }
 
 if (filterType === "Has Bookings") {
 result = result.filter(d => (bookingsByName.get((d.name || "").toLowerCase()) || 0) > 0 || (bookingsByName.get((d.email || "").toLowerCase()) || 0) > 0);
 } else if (filterType === "Has Donations") {
 result = result.filter(d => (donationsByName.get((d.name || "").toLowerCase()) || 0) > 0 || (donationsByName.get((d.email || "").toLowerCase()) || 0) > 0);
 }
 
 return result;
 }, [devotees, query, filterType, bookingsByName, donationsByName]);

 const totalDonation = donations.reduce((sum, d) => sum + Number(d.amount || 0), 0);

 const statCards = [
 { title: "Total Devotees", value: devotees.length, icon: FaUsers, iconWrap: "bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-orange-500" },
 { title: "Active Bookings", value: bookings.length, icon: MdEventAvailable, iconWrap: "bg-violet-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-violet-600" },
 { title: "Total Donations", value: formatCurrency(totalDonation), icon: FaDonate, iconWrap: "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-500" },
 ];

 return (
 <div className="mt-5 space-y-5">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h1 className={`text-[30px] md:text-[38px] font-bold leading-tight ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>Devotees Management</h1>
 <p className={`${darkMode ? "text-slate-300" : "text-gray-600 dark:text-slate-200 "}`}>Live backend data for devotees, bookings and donations.</p>
 </div>

 <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${darkMode ? "border-[#334155] bg-[#1f2937] text-slate-200" : "border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#6b4c2e]"}`}>
 <MdCalendarMonth className="text-[18px]" />
 {new Date().toLocaleString()}
 </div>
 </div>

 <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
 {statCards.map((card) => {
 const Icon = card.icon;
 return (
 <div key={card.title} className={`rounded-2xl border p-4 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <div className="flex items-center gap-3">
 <div className={`h-12 w-12 rounded-full flex items-center justify-center ${card.iconWrap}`}>
 <Icon className="text-[20px]" />
 </div>
 <div>
 <p className={`${darkMode ? "text-slate-300" : "text-gray-500 dark:text-slate-200 "}`}>{card.title}</p>
 <h3 className={`text-[28px] leading-tight font-bold ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>{card.value}</h3>
 </div>
 </div>
 </div>
 );
 })}
 </div>

 <div className={`rounded-2xl border p-4 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
 <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
 <h2 className={`text-[24px] font-bold ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>Devotee List</h2>
 <input
 type="text"
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search devotee by name or email..."
 className={`h-10 rounded-xl border px-3 text-sm outline-none sm:w-[320px] ${darkMode ? "border-[#334155] bg-[#111827] text-slate-200 placeholder:text-slate-500 dark:text-slate-200 " : "border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-gray-700 dark:text-slate-200 placeholder:text-gray-400"}`}
 />
 </div>

 <div className="relative">
 <button 
 onClick={() => setShowFilterMenu(!showFilterMenu)}
 className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm ${darkMode ? "border-[#334155] bg-[#111827] text-slate-200" : "border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-gray-700 dark:text-slate-200 "}`}
 >
 <FaFilter className="text-[12px]" /> {filterType}
 </button>
 {showFilterMenu && (
 <div className={`absolute right-0 top-12 z-10 w-48 rounded-xl border p-2 shadow-lg ${darkMode ? "border-[#334155] bg-[#1f2937]" : "border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "}`}>
 {["All", "Has Bookings", "Has Donations"].map((type) => (
 <button
 key={type}
 onClick={() => {
 setFilterType(type);
 setShowFilterMenu(false);
 }}
 className={`block w-full rounded-lg px-4 py-2 text-left text-sm ${filterType === type ? (darkMode ? "bg-[#374151] text-amber-400" : "bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-600") : (darkMode ? "text-slate-300 hover:bg-[#374151]" : "text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ")}`}
 >
 {type}
 </button>
 ))}
 </div>
 )}
 </div>
 </div>

 <div className="overflow-x-auto rounded-xl border border-[#ece8e1] dark:border-slate-700 ">
 <table className="w-full min-w-[860px] text-sm">
 <thead className={`${darkMode ? "bg-[#111827] text-slate-300" : "bg-[#f8f6f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-gray-600 dark:text-slate-200 "}`}>
 <tr>
 <th className="px-3 py-3 text-left">Devotee</th>
 <th className="px-3 py-3 text-left">Email</th>
 <th className="px-3 py-3 text-left">Bookings</th>
 <th className="px-3 py-3 text-left">Donations</th>
 <th className="px-3 py-3 text-left">Status</th>
 <th className="px-3 py-3 text-left">Actions</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((devotee, idx) => {
 const bookingCount = (bookingsByName.get((devotee.name || "").toLowerCase()) || 0) || (bookingsByName.get((devotee.email || "").toLowerCase()) || 0);
 const donationSum = (donationsByName.get((devotee.name || "").toLowerCase()) || 0) || (donationsByName.get((devotee.email || "").toLowerCase()) || 0);
 return (
 <tr key={devotee._id || devotee.email} className={`border-t ${darkMode ? "border-[#334155]" : "border-[#f1ede6]"} ${idx % 2 === 0 ? (darkMode ? "bg-[#1f2937]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ") : (darkMode ? "bg-[#111827]" : "bg-[#fdfcfa] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ")}`}>
 <td className="px-3 py-3 font-semibold">{devotee.name}</td>
 <td className="px-3 py-3">{devotee.email}</td>
 <td className="px-3 py-3">{bookingCount}</td>
 <td className="px-3 py-3">{formatCurrency(donationSum)}</td>
 <td className="px-3 py-3">
 <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-green-700">Active</span>
 </td>
 <td className="px-3 py-3">
 <button type="button" onClick={() => onEditProfile?.(devotee)} className="inline-flex items-center gap-2 text-amber-600 font-semibold">
 <FaEye /> View
 </button>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
};

export default DevoteesManagement;
