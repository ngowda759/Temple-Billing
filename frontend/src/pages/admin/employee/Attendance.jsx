import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid } from "recharts";
import SectionCard from "../../../components/admin/employee/SectionCard";
import { attendanceTrend, employees, attendanceHeatmap } from "./employeeData";

const attendanceTiles = [
 { title: "Present Today", value: 42, accent: "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-emerald-300 text-emerald-900", badge: "bg-emerald-200 text-emerald-950" },
 { title: "Absent", value: 4, accent: "bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-rose-300 text-rose-900", badge: "bg-rose-200 text-rose-950" },
 { title: "Late Entries", value: 7, accent: "bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-amber-300 text-amber-900", badge: "bg-amber-200 text-amber-950" },
 { title: "Half Day", value: 3, accent: "bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-sky-300 text-sky-900", badge: "bg-sky-200 text-sky-950" },
 { title: "Overtime Staff", value: 5, accent: "bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-purple-300 text-purple-900", badge: "bg-purple-200 text-purple-950" },
];

const Attendance = () => {
 return (
 <div className="space-y-8 text-slate-800 dark:text-slate-200 ">
 <SectionCard title="Attendance Dashboard" subtitle="Monitor daily attendance and punctuality for Sri Shanti Mahadev Mandir staff." className="bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 text-[#4a2b0f] dark:text-slate-200 border border-amber-200/60 shadow-md backdrop-blur-md">
 <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
 {attendanceTiles.map((tile) => (
 <div key={tile.title} className={`rounded-[28px] border p-5 ${tile.accent} shadow-sm backdrop-blur-md`}>
 <p className="text-xs font-black uppercase tracking-wider">{tile.title}</p>
 <p className="mt-3 text-3xl font-black">{tile.value}</p>
 </div>
 ))}
 </div>
 </SectionCard>

 <div className="grid gap-5 xl:grid-cols-[1.7fr_0.9fr]">
 <div className="space-y-5">
 <SectionCard title="Monthly Attendance Trend" subtitle="Attendance heatmap for the week." className="overflow-hidden bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-amber-200/60">
 <div className="h-[320px]">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={attendanceTrend} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
 <defs>
 <linearGradient id="attendanceColor" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#d97706" stopOpacity={0.8} />
 <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" opacity={0.6} />
 <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontWeight: 600 }} />
 <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontWeight: 600 }} />
 <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderRadius: "14px", border: "1px solid #fcd34d", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", color: "#1e293b", fontWeight: "700" }} />
 <Line type="monotone" dataKey="value" stroke="#d97706" strokeWidth={3} dot={{ r: 5, fill: "#d97706" }} />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </SectionCard>

 <SectionCard title="Daily Attendance Table" subtitle="Quick status for today's roster." className="overflow-hidden bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-amber-200/60">
 <div className="overflow-x-auto rounded-[24px] border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-xs">
 <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200 ">
 <thead className="bg-amber-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-b border-amber-200/80 text-amber-950 font-black">
 <tr>
 <th className="px-5 py-4">Employee</th>
 <th className="px-5 py-4">Department</th>
 <th className="px-5 py-4">Shift</th>
 <th className="px-5 py-4">Status</th>
 <th className="px-5 py-4">Check-in</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-amber-100">
 {employees.slice(0, 6).map((emp) => (
 <tr key={emp.id} className="hover:bg-amber-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition">
 <td className="px-5 py-4 font-bold text-slate-900 dark:text-slate-200 ">{emp.name}</td>
 <td className="px-5 py-4 font-medium">{emp.department}</td>
 <td className="px-5 py-4 font-medium">{emp.shift}</td>
 <td className="px-5 py-4">
 <span className={`inline-flex rounded-lg px-3 py-1 text-xs font-black border ${emp.status === "Active" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800 border-emerald-300" : emp.status === "On Leave" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-800 border-amber-300" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 "}`}>
 {emp.status}
 </span>
 </td>
 <td className="px-5 py-4 text-slate-700 dark:text-slate-200 font-semibold">{emp.status === "Active" ? "09:12 AM" : "—"}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </SectionCard>
 </div>

 <div className="space-y-5">
 <SectionCard title="Attendance Trends" subtitle="Compare performance by day." className="overflow-hidden bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-amber-200/60">
 <ResponsiveContainer width="100%" height={260}>
 <BarChart data={attendanceHeatmap} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" opacity={0.6} />
 <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontWeight: 600 }} />
 <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontWeight: 600 }} />
 <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderRadius: "14px", border: "1px solid #fcd34d", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", color: "#1e293b", fontWeight: "700" }} />
 <Bar dataKey="value" fill="#d97706" radius={[12, 12, 0, 0]} />
 </BarChart>
 </ResponsiveContainer>
 </SectionCard>

 <SectionCard title="Weekly Punctuality" subtitle="Top punctual employees and score." className="overflow-hidden bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-amber-200/60">
 <div className="space-y-4">
 <div className="rounded-[24px] bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-amber-200/60 p-5 shadow-xs">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-200 ">Punctuality Score</p>
 <h3 className="mt-1 text-3xl font-black text-amber-700">94.7%</h3>
 </div>
 <span className="rounded-lg bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-emerald-300 px-3 py-1 text-xs font-black text-emerald-800">Stable</span>
 </div>
 </div>
 <div className="space-y-3">
 {employees.slice(0, 4).map((emp) => (
 <div key={emp.id} className="flex items-center justify-between rounded-[20px] border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 shadow-xs">
 <div>
 <p className="font-extrabold text-slate-900 dark:text-slate-200 ">{emp.name}</p>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 ">{emp.role}</p>
 </div>
 <div className="text-right">
 <p className="font-black text-amber-700">98%</p>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-200 ">On time</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 </SectionCard>

 <SectionCard title="Attendance Calendar" subtitle="Mark shifts and attendance events." className="overflow-hidden bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-amber-200/60">
 <div className="grid gap-3 rounded-[24px] border border-amber-200/60 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 text-sm text-slate-700 dark:text-slate-200 ">
 {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
 <div key={day} className="flex items-center justify-between rounded-xl bg-amber-50/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 border border-amber-200/60">
 <span className="font-extrabold text-amber-950">{day}</span>
 <span className="rounded-lg bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-emerald-300 px-3 py-0.5 text-xs font-black text-emerald-800">21/22</span>
 </div>
 ))}
 </div>
 </SectionCard>
 </div>
 </div>
 </div>
 );
};

export default Attendance;
