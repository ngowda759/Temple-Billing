import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const AllDonations = () => {
 const navigate = useNavigate();
 const [donations, setDonations] = useState([]);
 const [loading, setLoading] = useState(false);
 const [filterType, setFilterType] = useState("all");
 const [startDate, setStartDate] = useState("");
 const [endDate, setEndDate] = useState("");

 const fetchDonations = async () => {
 setLoading(true);
 try {
 const res = await axios.get("http://localhost:5000/api/donations");
 let fetchedDonations = Array.isArray(res.data?.donations) ? res.data.donations : [];
 
 // Exclude non-donation categories
 fetchedDonations = fetchedDonations.filter((donation) => {
 const cat = donation.category?.toLowerCase() || "";
 if (cat.includes("pooja") || cat.includes("prasada") || cat.includes("room") || cat.includes("abhishekam")) {
 return false;
 }
 return true;
 });

 setDonations(fetchedDonations);
 } catch (error) {
 console.error("Unable to fetch donations:", error);
 } finally {
 setLoading(false);
 }
 };

 const filteredDonations = useMemo(() => {
 return donations.filter((donation) => {
 if (!donation.createdAt) return true;
 const d = new Date(donation.createdAt);
 const now = new Date();

 if (filterType === "weekly") {
 const weekAgo = new Date();
 weekAgo.setDate(now.getDate() - 7);
 return d >= weekAgo;
 }
 if (filterType === "monthwise") {
 return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
 }
 if (filterType === "yearly") {
 return d.getFullYear() === now.getFullYear();
 }
 if (filterType === "datewise") {
 let match = true;
 if (startDate) {
 const start = new Date(startDate);
 start.setHours(0, 0, 0, 0);
 match = match && d >= start;
 }
 if (endDate) {
 const end = new Date(endDate);
 end.setHours(23, 59, 59, 999);
 match = match && d <= end;
 }
 return match;
 }
 return true; // "all"
 });
 }, [donations, filterType, startDate, endDate]);

 const handleExport = () => {
 const headers = [
 "Receipt ID",
 "Donor",
 "Donation Type",
 "Amount",
 "Payment Method",
 "Transaction ID",
 "Date",
 "Status",
 ];

 const rows = filteredDonations.map((item) => [
 item._id ? `DN-${item._id.slice(-6).toUpperCase()}` : "",
 item.donorName || "",
 item.category || "",
 item.amount != null ? item.amount.toString() : "",
 item.paymentMethod || "",
 item.paymentMethod === "Cash" ? "Offline Payment" : (item.transactionId || ""),
 new Date(item.createdAt || Date.now()).toLocaleDateString(),
 item.status || "",
 ]);

 const csvContent = [headers, ...rows]
 .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
 .join("\n");

 const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.setAttribute("download", "donations-report.csv");
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 URL.revokeObjectURL(url);
 };

 useEffect(() => {
 fetchDonations();
 }, []);

 return (
 <DonationPageShell
 title="All Donations"
 subtitle="A comprehensive donation registry with search, status, verification and export workflows."
 actions={
 <div className="flex gap-3">
 <button
 onClick={() => navigate("/admin/donations")}
 className="rounded-2xl border border-slate-700 bg-slate-800 px-5 py-3 font-semibold text-white transition hover:bg-slate-700"
 >
 Back to Donations
 </button>
 <button
 onClick={handleExport}
 className="rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 dark:text-slate-200 transition hover:bg-amber-300"
 >
 Export Report
 </button>
 </div>
 }
 >
 <SectionCard title="Filters" subtitle="Filter donations based on time period." className="relative z-50">
 <div className="grid gap-6 md:grid-cols-4 items-end">
 <div className="flex flex-col gap-2">
 <label className="text-sm font-semibold text-slate-300">Time Period</label>
 <select
 value={filterType}
 onChange={(e) => setFilterType(e.target.value)}
 className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
 >
 <option value="all">All Time</option>
 <option value="weekly">This Week</option>
 <option value="monthwise">This Month</option>
 <option value="yearly">This Year</option>
 <option value="datewise">Custom Date</option>
 </select>
 </div>
 {filterType === "datewise" && (
 <>
 <div className="flex flex-col gap-2">
 <label className="text-sm font-semibold text-slate-300">From Date</label>
 <input
 type="date"
 value={startDate}
 onChange={(e) => setStartDate(e.target.value)}
 className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-500"
 />
 </div>
 <div className="flex flex-col gap-2">
 <label className="text-sm font-semibold text-slate-300">To Date</label>
 <input
 type="date"
 value={endDate}
 onChange={(e) => setEndDate(e.target.value)}
 className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-500"
 />
 </div>
 </>
 )}
 </div>
 </SectionCard>

 <SectionCard title="Donation Records" subtitle="Receipt ID, donor, payment method and verification status.">
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200 ">
 <thead>
 <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 ">
 <th className="py-4 px-3">Receipt ID</th>
 <th className="py-4 px-3">Donor</th>
 <th className="py-4 px-3">Donation Type</th>
 <th className="py-4 px-3">Amount</th>
 <th className="py-4 px-3">Payment Method</th>
 <th className="py-4 px-3">Transaction ID</th>
 <th className="py-4 px-3">Date</th>
 <th className="py-4 px-3">Status</th>
 <th className="py-4 px-3">Verified By</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="9" className="py-8 px-3 text-center text-slate-500 dark:text-slate-200 ">
 Loading donations...
 </td>
 </tr>
 ) : filteredDonations.length === 0 ? (
 <tr>
 <td colSpan="9" className="py-8 px-3 text-center text-slate-500 dark:text-slate-200 ">
 No donations found.
 </td>
 </tr>
 ) : (
 filteredDonations.map((item) => (
 <tr key={item._id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition">
 <td className="py-4 px-3 font-medium text-slate-900 dark:text-slate-200 ">DN-{item._id?.slice(-6).toUpperCase()}</td>
 <td className="py-4 px-3">{item.donorName}</td>
 <td className="py-4 px-3">{item.category}</td>
 <td className="py-4 px-3 text-amber-600 font-semibold">₹{item.amount?.toLocaleString()}</td>
 <td className="py-4 px-3">{item.paymentMethod}</td>
 <td className="py-4 px-3">{item.paymentMethod === "Cash" ? "Offline Payment" : (item.transactionId || "—")}</td>
 <td className="py-4 px-3">{new Date(item.createdAt).toLocaleDateString()}</td>
 <td className="py-4 px-3">
 <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${item.status === "Completed" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700" : item.status === "Pending" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700" : "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700"}`}>
 {item.status}
 </span>
 </td>
 <td className="py-4 px-3">{item.verifiedBy || "N/A"}</td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>

 </DonationPageShell>
 );
};

export default AllDonations;
