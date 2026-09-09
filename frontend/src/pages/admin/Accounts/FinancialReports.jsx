import React, { useState, useEffect } from "react";
import { getMonthlyReport, getAnnualReport } from "../../../services/accountService";
import { useAuth } from "../../../context/AuthContext";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FiDownload } from "react-icons/fi";
import { toast } from "react-toastify";
import { 
 BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
 PieChart, Pie, Cell
} from "recharts";

const COLORS = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const FinancialReports = () => {
 const { user } = useAuth();
 const role = user?.role;
 const [isExporting, setIsExporting] = useState(false);
 const [monthlyData, setMonthlyData] = useState([]);
 const [annualData, setAnnualData] = useState(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchData = async () => {
 try {
 setLoading(true);
 const [monthlyRes, annualRes] = await Promise.all([
 getMonthlyReport(),
 getAnnualReport()
 ]);
 setMonthlyData(monthlyRes);
 setAnnualData(annualRes);
 } catch (error) {
 toast.error("Failed to load report data");
 } finally {
 setLoading(false);
 }
 };
 fetchData();
 }, []);

 const handleExportPDF = async () => {
 setIsExporting(true);
 try {
 const doc = new jsPDF();
 
 doc.setFontSize(22);
 doc.setTextColor(40, 40, 40);
 doc.text("Temple Billing - Audit Report", 14, 20);
 
 doc.setFontSize(12);
 doc.setTextColor(100, 100, 100);
 doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 30);
 
 if (annualData) {
 doc.setFontSize(14);
 doc.setTextColor(20, 20, 20);
 doc.text("Annual Summary Highlights", 14, 45);
 
 doc.setFontSize(12);
 doc.setTextColor(0, 128, 0); 
 doc.text(`Total Income: Rs ${(annualData.totalIncome || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 14, 55);
 
 doc.setTextColor(200, 0, 0); 
 doc.text(`Total Expense: Rs ${(annualData.totalExpense || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 14, 63);
 
 doc.setTextColor(0, 0, 200); 
 doc.text(`Net Profit: Rs ${(annualData.netProfit || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 14, 71);
 }

 const tableColumn = ["Month", "Income (Rs)", "Expense (Rs)", "Net Balance (Rs)"];
 const tableRows = (monthlyData || []).map(row => [
 row.month,
 (row.income || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
 (row.expense || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
 (row.netBalance || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })
 ]);

 autoTable(doc, {
 startY: 85,
 head: [tableColumn],
 body: tableRows,
 theme: 'striped',
 headStyles: { fillColor: [41, 128, 185], textColor: 255 },
 styles: { fontSize: 10, cellPadding: 5 },
 });

 let finalY = doc.lastAutoTable.finalY;

 if (annualData) {
 doc.setFontSize(14);
 doc.setTextColor(20, 20, 20);
 doc.text("Income Sources Breakdown", 14, finalY + 15);

 const incomeColumns = ["Income Source", "Amount (Rs)"];
 const incomeRows = Object.entries(annualData.incomeBySource || {}).map(([key, val]) => [
 key,
 (val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })
 ]);

 autoTable(doc, {
 startY: finalY + 20,
 head: [incomeColumns],
 body: incomeRows,
 theme: 'grid',
 headStyles: { fillColor: [39, 174, 96], textColor: 255 },
 styles: { fontSize: 10, cellPadding: 4 },
 });

 let finalY2 = doc.lastAutoTable.finalY;

 doc.setFontSize(14);
 doc.setTextColor(20, 20, 20);
 doc.text("Expense Categories Breakdown", 14, finalY2 + 15);

 const expenseColumns = ["Expense Category", "Amount (Rs)"];
 const expenseRows = Object.entries(annualData.expenseByCategory || {}).map(([key, val]) => [
 key,
 (val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })
 ]);

 autoTable(doc, {
 startY: finalY2 + 20,
 head: [expenseColumns],
 body: expenseRows,
 theme: 'grid',
 headStyles: { fillColor: [192, 57, 43], textColor: 255 },
 styles: { fontSize: 10, cellPadding: 4 },
 });
 }

 doc.save("Audit_Report_Temple_Billing.pdf");
 toast.success("Audit Report Downloaded Successfully");
 } catch (error) {
 console.error(error);
 toast.error("Failed to generate PDF");
 } finally {
 setIsExporting(false);
 }
 };

 const CustomTooltip = ({ active, payload, label }) => {
 if (active && payload && payload.length) {
 return (
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3 rounded-lg shadow-lg border border-slate-100">
 <p className="font-bold text-slate-800 dark:text-slate-200 mb-2">{label}</p>
 {payload.map((entry, index) => (
 <p key={index} className="text-sm" style={{ color: entry.color }}>
 {entry.name}: ₹{entry.value.toLocaleString("en-IN")}
 </p>
 ))}
 </div>
 );
 }
 return null;
 };

 const PieTooltip = ({ active, payload }) => {
 if (active && payload && payload.length) {
 return (
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-3 rounded-lg shadow-lg border border-slate-100">
 <p className="font-bold text-slate-800 dark:text-slate-200 ">{payload[0].name}</p>
 <p className="text-sm text-slate-600 dark:text-slate-200 mt-1">₹{payload[0].value.toLocaleString("en-IN")}</p>
 </div>
 );
 }
 return null;
 };

 if (loading) {
 return <div className="p-8 text-center text-slate-600 dark:text-slate-200 ">Loading charts and data...</div>;
 }

 // Format data for Pie Charts
 const incomePieData = annualData ? Object.entries(annualData.incomeBySource || {}).map(([key, val]) => ({ name: key, value: val })).filter(item => item.value > 0) : [];
 const expensePieData = annualData ? Object.entries(annualData.expenseByCategory || {}).map(([key, val]) => ({ name: key, value: val })).filter(item => item.value > 0) : [];

 return (
 <div className="p-4 md:p-8 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] min-h-screen font-sans">
 <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
 <div>
 <h1 className="text-2xl font-bold text-[#1d1b19] dark:text-slate-200 ">Financial Reports & Analytics</h1>
 <p className="text-sm text-[#5c6675]">Accounts & Finance &gt; Reports</p>
 </div>

 <button 
 onClick={handleExportPDF}
 disabled={isExporting || role !== "admin"}
 className="flex items-center gap-2 bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] hover:bg-[#e67a00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
 >
 <FiDownload /> {isExporting ? "Exporting..." : "Export Audit PDF"}
 </button>
 </div>

 {/* Row 1: Monthly Bar Chart */}
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-6">Monthly Income vs Expense</h3>
 <div className="h-[400px] w-full">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart
 data={monthlyData}
 margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
 >
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
 <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
 <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} tickFormatter={(value) => `₹${value >= 1000 ? (value/1000).toFixed(0) + 'k' : value}`} />
 <RechartsTooltip content={<CustomTooltip />} />
 <Legend wrapperStyle={{ paddingTop: '20px' }} />
 <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50} />
 <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={50} />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </div>

 {/* Row 2: Breakdown Pie Charts */}
 {annualData && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-6">Income Sources Distribution</h3>
 <div className="h-[300px] w-full flex items-center justify-center">
 {incomePieData.length > 0 ? (
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={incomePieData}
 cx="50%"
 cy="50%"
 innerRadius={70}
 outerRadius={100}
 paddingAngle={2}
 dataKey="value"
 nameKey="name"
 >
 {incomePieData.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <RechartsTooltip content={<PieTooltip />} />
 <Legend layout="vertical" verticalAlign="middle" align="right" />
 </PieChart>
 </ResponsiveContainer>
 ) : (
 <p className="text-slate-500 dark:text-slate-200 italic">No income data available.</p>
 )}
 </div>
 </div>

 <div className="bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 rounded-2xl shadow-sm border border-slate-100">
 <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-6">Expense Categories Distribution</h3>
 <div className="h-[300px] w-full flex items-center justify-center">
 {expensePieData.length > 0 ? (
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={expensePieData}
 cx="50%"
 cy="50%"
 innerRadius={70}
 outerRadius={100}
 paddingAngle={2}
 dataKey="value"
 nameKey="name"
 >
 {expensePieData.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <RechartsTooltip content={<PieTooltip />} />
 <Legend layout="vertical" verticalAlign="middle" align="right" />
 </PieChart>
 </ResponsiveContainer>
 ) : (
 <p className="text-slate-500 dark:text-slate-200 italic">No expense data available.</p>
 )}
 </div>
 </div>
 </div>
 )}

 </div>
 );
};

export default FinancialReports;
