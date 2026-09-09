import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDonationTypes } from "../../../services/donationTypeService";

const DonationReports = () => {
 const [donations, setDonations] = useState([]);
 const [loading, setLoading] = useState(false);
 const [searchTerm, setSearchTerm] = useState("");
 
 // Date range state
 const [startDate, setStartDate] = useState(() => {
 const d = new Date();
 d.setDate(d.getDate() - 30);
 const year = d.getFullYear();
 const month = String(d.getMonth() + 1).padStart(2, "0");
 const day = String(d.getDate()).padStart(2, "0");
 return `${year}-${month}-${day}`;
 });

 const [endDate, setEndDate] = useState(() => {
 const d = new Date();
 const year = d.getFullYear();
 const month = String(d.getMonth() + 1).padStart(2, "0");
 const day = String(d.getDate()).padStart(2, "0");
 return `${year}-${month}-${day}`;
 });

 const fetchDonations = async () => {
 setLoading(true);
 try {
 const res = await axios.get("http://localhost:5000/api/donations");
 setDonations(Array.isArray(res.data?.donations) ? res.data.donations : []);
 } catch (error) {
 console.error("Unable to load donation reports:", error);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchDonations();
 }, []);

 // Filter donations based on dates and search term
 const filteredDonations = useMemo(() => {
 return donations.filter((donation) => {
 // Date filtering
 const createdDate = donation.createdAt ? new Date(donation.createdAt) : null;
 if (createdDate) {
 createdDate.setHours(0, 0, 0, 0);
 
 if (startDate) {
 const start = new Date(startDate);
 start.setHours(0, 0, 0, 0);
 if (createdDate < start) return false;
 }
 
 if (endDate) {
 const end = new Date(endDate);
 end.setHours(23, 59, 59, 999);
 if (createdDate > end) return false;
 }
 }

 // Search filtering
 if (searchTerm.trim() !== "") {
 const query = searchTerm.toLowerCase();
 const matchesName = donation.donorName?.toLowerCase().includes(query);
 const matchesCategory = donation.category?.toLowerCase().includes(query);
 const matchesTxId = donation.transactionId?.toLowerCase().includes(query);
 const matchesId = donation._id?.toLowerCase().includes(query);
 if (!matchesName && !matchesCategory && !matchesTxId && !matchesId) return false;
 }

 // Exclude non-donation categories
 const validTypes = getDonationTypes().map(t => t.toLowerCase());
 const cat = donation.category?.toLowerCase() || "";
 if (cat.includes("pooja") || cat.includes("prasada") || cat.includes("room") || cat.includes("abhishekam")) {
 return false;
 }

 return true;
 });
 }, [donations, startDate, endDate, searchTerm]);

 // Calculate total amount for filtered donations
 const totalFilteredAmount = useMemo(() => {
 return filteredDonations.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
 }, [filteredDonations]);

 const buildReportHtml = () => {
 const rows = filteredDonations
 .map(
 (donation) => `
 <tr>
 <td style="padding:10px;border:1px solid #d1d5db">DN-${donation._id?.slice(-6).toUpperCase() || "—"}</td>
 <td style="padding:10px;border:1px solid #d1d5db">${donation.donorName || "—"}</td>
 <td style="padding:10px;border:1px solid #d1d5db">${donation.category || "—"}</td>
 <td style="padding:10px;border:1px solid #d1d5db">₹${donation.amount?.toLocaleString() || "0"}</td>
 <td style="padding:10px;border:1px solid #d1d5db">${donation.paymentMethod || "—"}</td>
 <td style="padding:10px;border:1px solid #d1d5db">${donation.paymentMethod === "Cash" ? "Offline Payment" : donation.transactionId || "—"}</td>
 <td style="padding:10px;border:1px solid #d1d5db">${new Date(donation.createdAt || Date.now()).toLocaleDateString()}</td>
 <td style="padding:10px;border:1px solid #d1d5db">${donation.status || "—"}</td>
 </tr>`
 )
 .join("");

 const dateRangeStr = (startDate || endDate) 
 ? `from ${startDate || "inception"} to ${endDate || "today"}`
 : "all time";

 return `
 <html>
 <head>
 <title>Donation Report</title>
 <style>
 body { font-family: Arial, sans-serif; color: #0f172a; padding: 24px; }
 h1 { font-size: 28px; margin-bottom: 8px; }
 p { color: #475569; margin-bottom: 24px; }
 table { border-collapse: collapse; width: 100%; margin-top: 16px; }
 th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
 th { background: #f8fafc; }
 .summary-box { margin-bottom: 20px; padding: 15px; background: #f1f5f9; border-radius: 8px; font-weight: bold; }
 </style>
 </head>
 <body>
 <h1>Donation Report</h1>
 <p>Generated on ${new Date().toLocaleString()} — Date Range: ${dateRangeStr}</p>
 <div class="summary-box">
 Total Records: ${filteredDonations.length} &nbsp;&nbsp;|&nbsp;&nbsp; Total Amount Collected: ₹${totalFilteredAmount.toLocaleString("en-IN")}
 </div>
 <table>
 <thead>
 <tr>
 <th>Receipt ID</th>
 <th>Donor</th>
 <th>Type</th>
 <th>Amount</th>
 <th>Method</th>
 <th>Transaction ID</th>
 <th>Date</th>
 <th>Status</th>
 </tr>
 </thead>
 <tbody>
 ${rows}
 </tbody>
 </table>
 <p style="margin-top:24px; color:#64748b">Use your browser print dialog to save this report as PDF.</p>
 </body>
 </html>`;
 };

 const handleViewReport = () => {
 const reportWindow = window.open("", "DonationReport");
 if (!reportWindow) return;
 reportWindow.document.write(buildReportHtml());
 reportWindow.document.close();
 };

 const handleExportPdf = () => {
 const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
 const pageWidth = doc.internal.pageSize.getWidth();
 const generatedLabel = new Date().toLocaleString("en-IN");
 
 // Banner header
 doc.setFillColor(47, 15, 79);
 doc.rect(0, 0, pageWidth, 92, "F");
 
 doc.setTextColor(255, 255, 255);
 doc.setFontSize(18);
 doc.text("Sri Shanti Mahadev Mandir", 40, 38);
 doc.setFontSize(13);
 doc.text("Donation Finance Report", 40, 58);
 doc.setFontSize(9);
 doc.text(`Generated: ${generatedLabel}`, 40, 76);
 
 const rangeText = `Date Filter: ${startDate || "Inception"} to ${endDate || "Present"}`;
 doc.text(rangeText, pageWidth - 240, 76);

 // Summary block
 doc.setTextColor(30, 41, 59);
 doc.setFontSize(11);
 doc.text("Report Summary", 40, 120);
 
 autoTable(doc, {
 startY: 130,
 margin: { left: 40, right: 40 },
 head: [["Total Records", "Total Amount"]],
 body: [[filteredDonations.length, `INR ${totalFilteredAmount.toLocaleString("en-IN")}`]],
 theme: "grid",
 styles: { fontSize: 10, cellPadding: 8, halign: "center" },
 headStyles: { fillColor: [199, 137, 24], textColor: [255, 255, 255] },
 });

 // Main records table
 const tableBody = filteredDonations.map((donation) => [
 `DN-${donation._id?.slice(-6).toUpperCase() || "—"}`,
 donation.donorName || "—",
 donation.category || "—",
 `₹${donation.amount?.toLocaleString("en-IN") || "0"}`,
 donation.paymentMethod || "—",
 donation.paymentMethod === "Cash" ? "Offline Payment" : (donation.transactionId || "—"),
 donation.createdAt ? new Date(donation.createdAt).toLocaleDateString("en-IN") : "—",
 donation.status || "—"
 ]);

 autoTable(doc, {
 startY: doc.lastAutoTable.finalY + 25,
 margin: { left: 40, right: 40 },
 head: [["Receipt ID", "Donor Name", "Type", "Amount", "Method", "Txn ID", "Date", "Status"]],
 body: tableBody,
 theme: "striped",
 styles: { fontSize: 8, cellPadding: 6 },
 headStyles: { fillColor: [94, 45, 151], textColor: [255, 255, 255] },
 });

 doc.save(`Donation_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
 };

 return (
 <DonationPageShell
 title="Donation Reports"
 subtitle="Filter, review, and export PDF reports for temple finance and donors."
 actions={
 <div className="flex flex-col gap-3 sm:flex-row">
 <button onClick={() => window.location.href = '/admin/donations'} className="rounded-2xl border border-slate-700 bg-slate-800 px-5 py-3 font-semibold text-white transition hover:bg-slate-700">
 Back to Donations
 </button>
 <button onClick={handleViewReport} className="rounded-2xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-3 font-semibold text-slate-950 dark:text-slate-200 transition hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 View Live Print Preview
 </button>
 <button onClick={handleExportPdf} className="rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 dark:text-slate-200 transition hover:bg-amber-300">
 Download PDF Report
 </button>
 </div>
 }
 >
 {/* Date Filters Form Card */}
 <SectionCard title="Filter Report Records" subtitle="Set dates and keywords to narrow down the report dataset." className="relative z-50">
 <div className="grid gap-6 md:grid-cols-3">
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
 <div className="flex flex-col gap-2">
 <label className="text-sm font-semibold text-slate-300">Search Keywords</label>
 <input
 type="text"
 placeholder="Search donor, category..."
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
 />
 </div>
 </div>

 <div className="mt-6 grid gap-4 lg:grid-cols-2">
 <div className="rounded-3xl border border-white/10 bg-slate-950/10 p-5">
 <p className="text-sm text-slate-400">Filtered Records Count</p>
 <p className="mt-3 text-3xl font-semibold text-white">{filteredDonations.length}</p>
 </div>
 <div className="rounded-3xl border border-white/10 bg-slate-950/10 p-5">
 <p className="text-sm text-slate-400">Total Filtered Amount</p>
 <p className="mt-3 text-3xl font-semibold text-amber-400">₹{totalFilteredAmount.toLocaleString("en-IN")}</p>
 </div>
 </div>
 </SectionCard>

 {/* Live Table Preview */}
 <SectionCard title="Filtered Donation Activity Log" subtitle="Live view of records matching active filters.">
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200 ">
 <thead>
 <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 ">
 <th className="py-4 px-3">Receipt ID</th>
 <th className="py-4 px-3">Donor</th>
 <th className="py-4 px-3">Category</th>
 <th className="py-4 px-3">Amount</th>
 <th className="py-4 px-3">Method</th>
 <th className="py-4 px-3">Transaction ID</th>
 <th className="py-4 px-3">Date</th>
 <th className="py-4 px-3">Status</th>
 </tr>
 </thead>
 <tbody>
 {filteredDonations.length > 0 ? (
 filteredDonations.map((donation) => (
 <tr key={donation._id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition">
 <td className="py-4 px-3 font-medium text-slate-900 dark:text-slate-200 ">DN-{donation._id?.slice(-6).toUpperCase()}</td>
 <td className="py-4 px-3">{donation.donorName}</td>
 <td className="py-4 px-3">{donation.category}</td>
 <td className="py-4 px-3 text-amber-600 font-semibold">₹{donation.amount?.toLocaleString("en-IN")}</td>
 <td className="py-4 px-3">{donation.paymentMethod}</td>
 <td className="py-4 px-3">{donation.paymentMethod === "Cash" ? "Offline Payment" : (donation.transactionId || "—")}</td>
 <td className="py-4 px-3">{donation.createdAt ? new Date(donation.createdAt).toLocaleDateString("en-IN") : "—"}</td>
 <td className="py-4 px-3">
 <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${ donation.status === "Completed" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700" : donation.status === "Pending" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700" : "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700" }`}>
 {donation.status}
 </span>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-200 ">
 No donation records match the selected date range or search keyword.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </SectionCard>
 </DonationPageShell>
 );
};

export default DonationReports;
