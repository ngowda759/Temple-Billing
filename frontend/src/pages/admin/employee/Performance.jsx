import React, { useCallback, useEffect, useMemo, useState } from "react";
import SectionCard from "../../../components/admin/employee/SectionCard";
import { getPerformanceDashboard } from "../../../services/payrollService";

const formatMonthKey = (date) => {
 const year = date.getFullYear();
 const month = String(date.getMonth() + 1).padStart(2, "0");
 return `${year}-${month}`;
};

const Performance = () => {
 const [monthKey, setMonthKey] = useState(formatMonthKey(new Date()));
 const [dashboard, setDashboard] = useState(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");

 const loadDashboard = useCallback(async () => {
 setLoading(true);
 setError("");
 try {
 const response = await getPerformanceDashboard(monthKey);
 setDashboard(response);
 } catch (loadError) {
 setError(loadError.response?.data?.message || "Failed to load performance data.");
 setDashboard(null);
 } finally {
 setLoading(false);
 }
 }, [monthKey]);

 useEffect(() => {
 loadDashboard();
 }, [loadDashboard]);

 const performanceTiles = useMemo(() => {
 const summary = dashboard?.summary || {};
 const leaderboard = dashboard?.leaderboard || [];
 const totalPresent = leaderboard.reduce((sum, item) => sum + Number(item.presentDays || 0), 0);
 const totalExtraDuty = leaderboard.reduce((sum, item) => sum + Number(item.extraDutyDays || 0), 0);

 return [
 { title: "Top Performers", value: summary.topPerformers || 0, accent: "bg-[#fffbeb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-amber-300 text-amber-900" },
 { title: "Total Present Days", value: totalPresent, accent: "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-emerald-300 text-emerald-900" },
 { title: "Extra Duty Days", value: totalExtraDuty, accent: "bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-sky-300 text-sky-900" },
 { title: "Attendance Score", value: `${summary.attendanceScore || 0}%`, accent: "bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-orange-300 text-orange-900" },
 ];
 }, [dashboard]);

 return (
 <div className="space-y-8 text-slate-800 dark:text-slate-200 ">
 <SectionCard
 title="Performance Analytics"
 subtitle="Leaderboard based on present days and extra duty completed this month for Sri Shanti Mahadev Mandir."
 className="bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 text-[#4a2b0f] dark:text-slate-200 border border-amber-200/60 shadow-md backdrop-blur-md"
 >
 <div className="mb-5 flex flex-wrap items-center gap-3">
 <label className="text-sm font-extrabold text-[#7a4918]">
 Review Month
 <input
 type="month"
 value={monthKey}
 onChange={(event) => setMonthKey(event.target.value)}
 className="ml-3 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-slate-800 dark:text-slate-200 font-semibold shadow-xs outline-none focus:border-amber-500"
 />
 </label>
 </div>
 <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
 {performanceTiles.map((tile) => (
 <div key={tile.title} className={`rounded-[28px] border p-5 ${tile.accent} bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-xs`}>
 <p className="text-xs font-black uppercase tracking-wider">{tile.title}</p>
 <p className="mt-3 text-3xl font-black">{tile.value}</p>
 </div>
 ))}
 </div>
 </SectionCard>

 {error ? (
 <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>
 ) : null}

 <SectionCard title="Performance Leaderboard" subtitle="Ranked by present days and extra duty for this month." className="overflow-hidden bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-amber-200/60">
 <div className="space-y-3">
 {loading ? (
 <p className="text-sm font-semibold text-slate-500 dark:text-slate-200 ">Loading leaderboard…</p>
 ) : (dashboard?.leaderboard || []).length === 0 ? (
 <p className="text-sm font-semibold text-slate-500 dark:text-slate-200 ">No attendance or extra duty records for this month yet.</p>
 ) : (
 dashboard.leaderboard.map((person) => (
 <div key={`${person.rank}-${person.name}`} className="rounded-[22px] border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-xs">
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-4">
 <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-300 text-sm font-black text-amber-900">
 #{person.rank}
 </span>
 <div>
 <p className="font-extrabold text-slate-900 dark:text-slate-200 ">{person.name}</p>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 ">{person.department}</p>
 <p className="mt-1 text-xs font-semibold text-amber-800">{person.metric}</p>
 </div>
 </div>
 <span className="rounded-lg bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-300 px-3 py-1 text-xs font-black text-amber-900">
 Score {person.score}
 </span>
 </div>
 </div>
 ))
 )}
 </div>
 </SectionCard>
 </div>
 );
};

export default Performance;
