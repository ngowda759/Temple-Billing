import { useState, useEffect } from "react";
import { getCompletedServicesFilter } from "../../services/priestService";
import { FiSearch, FiCalendar, FiClock, FiCheckCircle } from "react-icons/fi";

const CompletedServices = () => {
 const [services, setServices] = useState([]);
 const [stats, setStats] = useState({});
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 
 const [search, setSearch] = useState("");
 const [filter, setFilter] = useState("today"); // today, week, month, custom
 const [startDate, setStartDate] = useState("");
 const [endDate, setEndDate] = useState("");

 const loadData = async () => {
 try {
 setLoading(true);
 setError("");
 const params = { filter, search };
 if (filter === "custom") {
 params.startDate = startDate;
 params.endDate = endDate;
 }
 const data = await getCompletedServicesFilter(params);
 setServices(data.services || []);
 setStats(data.stats || {});
 } catch (err) {
 setError(err.response?.data?.message || "Failed to load completed services");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [filter, startDate, endDate]);

 const handleSearch = (e) => {
 e.preventDefault();
 loadData();
 };

 return (
 <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <div>
 <h1 className="text-2xl font-bold text-slate-900">Completed Services</h1>
 <p className="text-slate-500">View poojas and services you have completed.</p>
 </div>
 </div>

 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <p className="text-sm font-medium text-slate-500">Completed Today</p>
 <p className="mt-2 text-3xl font-bold text-slate-900">{stats.completedToday || 0}</p>
 </div>
 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <p className="text-sm font-medium text-slate-500">This Week</p>
 <p className="mt-2 text-3xl font-bold text-slate-900">{stats.completedThisWeek || 0}</p>
 </div>
 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <p className="text-sm font-medium text-slate-500">This Month</p>
 <p className="mt-2 text-3xl font-bold text-slate-900">{stats.completedThisMonth || 0}</p>
 </div>
 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <p className="text-sm font-medium text-slate-500">Avg Completion Time</p>
 <p className="mt-2 text-3xl font-bold text-slate-900">{stats.avgDuration || "N/A"}</p>
 </div>
 </div>

 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <form onSubmit={handleSearch} className="flex flex-col gap-4 md:flex-row md:items-end">
 <div className="flex-1">
 <label className="mb-1 block text-sm font-medium text-slate-700">Search</label>
 <div className="relative">
 <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
 <input
 type="text"
 placeholder="Booking ID, Devotee, Pooja Name..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
 />
 </div>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700">Date Range</label>
 <select
 value={filter}
 onChange={(e) => setFilter(e.target.value)}
 className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
 >
 <option value="today">Today</option>
 <option value="week">This Week</option>
 <option value="month">This Month</option>
 <option value="custom">Custom Date Range</option>
 </select>
 </div>
 {filter === "custom" && (
 <>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700">Start Date</label>
 <input
 type="date"
 value={startDate}
 onChange={(e) => setStartDate(e.target.value)}
 className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none"
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700">End Date</label>
 <input
 type="date"
 value={endDate}
 onChange={(e) => setEndDate(e.target.value)}
 className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none"
 />
 </div>
 </>
 )}
 <button type="submit" className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
 Search
 </button>
 </form>
 </div>

 <div className="rounded-[24px] border border-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
 {error && <div className="p-4 text-sm text-red-600 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-b border-red-100">{error}</div>}
 
 {loading ? (
 <div className="p-10 text-center text-slate-500">Loading services...</div>
 ) : services.length === 0 ? (
 <div className="p-10 text-center text-slate-500">No completed services found for this period.</div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-left text-sm text-slate-600">
 <thead className="border-b border-slate-200 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-500">
 <tr>
 <th className="px-6 py-4 font-medium">Booking ID</th>
 <th className="px-6 py-4 font-medium">Pooja Details</th>
 <th className="px-6 py-4 font-medium">Devotee</th>
 <th className="px-6 py-4 font-medium">Timing</th>
 <th className="px-6 py-4 font-medium">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100">
 {services.map((service) => (
 <tr key={service.bookingId} className="transition-colors hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <td className="px-6 py-4">
 <span className="font-mono text-xs font-medium text-slate-500">#{service.bookingId.slice(-6).toUpperCase()}</span>
 </td>
 <td className="px-6 py-4">
 <p className="font-semibold text-slate-900">{service.poojaName}</p>
 <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><FiCalendar /> {service.date}</p>
 </td>
 <td className="px-6 py-4">
 <p className="font-medium text-slate-900">{service.devoteeName}</p>
 <p className="text-xs text-slate-500">{service.devoteeMobile}</p>
 </td>
 <td className="px-6 py-4">
 <p className="text-xs flex items-center gap-1"><span className="font-medium text-slate-700">Start:</span> {service.startedAt}</p>
 <p className="text-xs flex items-center gap-1 mt-1"><span className="font-medium text-slate-700">End:</span> {service.completedAt}</p>
 <p className="text-xs flex items-center gap-1 mt-1 text-amber-600 font-medium"><FiClock /> {service.duration}</p>
 </td>
 <td className="px-6 py-4">
 <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
 <FiCheckCircle /> {service.status}
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 );
};

export default CompletedServices;
