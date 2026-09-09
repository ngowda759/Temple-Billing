import React, { useState, useEffect } from "react";
import { getProfitLoss, getTransactions } from "../../../services/accountService";
import { toast } from "react-toastify";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  FaArrowUp,
  FaArrowDown,
  FaWallet,
  FaDownload,
  FaSyncAlt,
  FaFilter,
  FaDonate,
  FaUtensils,
  FaBed,
  FaTools,
  FaBoxes,
  FaBuilding,
  FaMoneyBillWave,
  FaReceipt,
  FaPrescriptionBottle,
  FaExclamationCircle,
} from "react-icons/fa";
import { MdTempleBuddhist } from "react-icons/md";

const INCOME_COLORS = ["#10b981", "#06b6d4", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6"];
const EXPENSE_COLORS = ["#ef4444", "#f97316", "#a855f7", "#eab308", "#14b8a6", "#6366f1", "#84cc16"];

const getSourceIcon = (source) => {
  const s = source.toLowerCase();
  if (s.includes("donat")) return <FaDonate className="text-emerald-600 text-lg" />;
  if (s.includes("pooja") || s.includes("seva")) return <MdTempleBuddhist className="text-amber-600 text-xl" />;
  if (s.includes("prasad")) return <FaUtensils className="text-orange-600 text-lg" />;
  if (s.includes("room") || s.includes("stay")) return <FaBed className="text-blue-600 text-lg" />;
  return <FaMoneyBillWave className="text-teal-600 text-lg" />;
};

const getCategoryIcon = (category) => {
  const c = category.toLowerCase();
  if (c.includes("repair")) return <FaTools className="text-rose-600 text-lg" />;
  if (c.includes("purchase") || c.includes("inventory")) return <FaBoxes className="text-amber-600 text-lg" />;
  if (c.includes("maint") || c.includes("temple")) return <FaBuilding className="text-indigo-600 text-lg" />;
  if (c.includes("annadan") || c.includes("food")) return <FaUtensils className="text-orange-600 text-lg" />;
  if (c.includes("suppl")) return <FaPrescriptionBottle className="text-purple-600 text-lg" />;
  return <FaReceipt className="text-slate-600 dark:text-slate-400 text-lg" />;
};

const ProfitLossView = ({ hideHeader = false }) => {
  const [data, setData] = useState({
    totalIncome: 0,
    totalExpense: 0,
    netProfit: 0,
    incomeBySource: {},
    expenseByCategory: {},
  });
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("all");

  const [hoveredIncomeSource, setHoveredIncomeSource] = useState(null);
  const [hoveredExpenseCategory, setHoveredExpenseCategory] = useState(null);

  const formatDateStr = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const loadPL = async () => {
    setLoading(true);
    try {
      let params = {};
      if (fromDate) params.startDate = fromDate;
      if (toDate) params.endDate = toDate;

      let backendTransactions = [];
      try {
        const txs = await getTransactions(params);
        if (Array.isArray(txs)) backendTransactions = txs;
      } catch (err) {
        console.warn("Backend transactions endpoint idle", err);
      }

      const savedManual = localStorage.getItem("templeManualEntries_v1");
      const manualEntries = savedManual ? JSON.parse(savedManual) : [];

      const savedExpenses = localStorage.getItem("templeManualExpenses_v1");
      const manualExpenses = savedExpenses ? JSON.parse(savedExpenses) : [];

      const formattedManual = [
        ...manualEntries.map((m) => ({
          date: m.date ? new Date(m.date) : new Date(),
          type: m.entryType || "Debit",
          source: m.source || "Manual Entry",
          category: m.category || m.whereSpent || "Manual Expense",
          amount: Number(m.amount || 0),
        })),
        ...manualExpenses.map((e) => ({
          date: e.date ? new Date(e.date) : new Date(),
          type: "Debit",
          source: "Manual Expense Voucher",
          category: e.category || e.whereSpent || "Expense Voucher",
          amount: Number(e.amount || 0),
        })),
      ];

      const formattedBackend = backendTransactions.map((t) => ({
        date: new Date(t.date || Date.now()),
        type: t.transactionType || (t.type === "Debit" ? "Debit" : "Credit"),
        source: t.source || "General Ledger",
        category: t.category || t.source || "General",
        amount: Number(t.amount || 0),
      }));

      const allLiveTransactions = [...formattedBackend, ...formattedManual];

      let filtered = allLiveTransactions;
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter((t) => new Date(t.date) >= start);
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filtered = filtered.filter((t) => new Date(t.date) <= end);
      }

      let totalIncome = 0;
      let totalExpense = 0;
      const incomeBySource = {};
      const expenseByCategory = {};

      filtered.forEach((t) => {
        const amt = Number(t.amount) || 0;
        if (t.type === "Credit") {
          totalIncome += amt;
          const src = t.source || "Other Income";
          incomeBySource[src] = (incomeBySource[src] || 0) + amt;
        } else if (t.type === "Debit") {
          totalExpense += amt;
          const cat = t.category || t.source || "General Expense";
          expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
        }
      });

      if (!fromDate && !toDate && Object.keys(incomeBySource).length === 0 && Object.keys(expenseByCategory).length === 0) {
        try {
          const apiPL = await getProfitLoss();
          if (apiPL) {
            setData({
              totalIncome: apiPL.totalIncome || 0,
              totalExpense: apiPL.totalExpense || 0,
              netProfit: apiPL.netProfit || 0,
              incomeBySource: apiPL.incomeBySource || {},
              expenseByCategory: apiPL.expenseByCategory || {},
            });
            setLoading(false);
            return;
          }
        } catch (e) {
          // ignore fallback
        }
      }

      setData({
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
        incomeBySource,
        expenseByCategory,
      });
    } catch (error) {
      console.error("Error generating Profit & Loss data:", error);
      toast.error("Failed to calculate Profit & Loss metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPL();
  }, [fromDate, toDate]);

  const handlePresetChange = (preset) => {
    setSelectedPreset(preset);
    const now = new Date();

    if (preset === "today") {
      const todayStr = formatDateStr(now);
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === "thisMonth") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFromDate(formatDateStr(firstDay));
      setToDate(formatDateStr(lastDay));
    } else if (preset === "fy2526") {
      setFromDate("2025-04-01");
      setToDate("2026-03-31");
    } else if (preset === "fy2627") {
      setFromDate("2026-04-01");
      setToDate("2027-03-31");
    } else {
      setFromDate("");
      setToDate("");
    }
  };

  const handleFromDateChange = (val) => {
    setSelectedPreset("custom");
    if (toDate && val > toDate) {
      toast.warning("Adjusted To Date to match From Date");
      setToDate(val);
    }
    setFromDate(val);
  };

  const handleToDateChange = (val) => {
    setSelectedPreset("custom");
    if (fromDate && val < fromDate) {
      toast.warning("Adjusted From Date to match To Date");
      setFromDate(val);
    }
    setToDate(val);
  };

  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(188, 108, 16);
      doc.text("Sri Shanti Mahadev Mandir", 14, 15);

      doc.setFontSize(12);
      doc.setTextColor(50, 50, 50);
      doc.text("Profit & Loss Financial Statement", 14, 22);

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated on: ${new Date().toLocaleString("en-IN")}`, 14, 27);
      doc.text(`Period Filter: ${fromDate || "All Time"} to ${toDate || "Present"}`, 14, 32);

      doc.setFillColor(250, 247, 242);
      doc.roundedRect(14, 36, 182, 20, 3, 3, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(22, 101, 52);
      doc.text(`Total Income: Rs ${data.totalIncome?.toLocaleString("en-IN")}`, 20, 48);

      doc.setTextColor(153, 27, 27);
      doc.text(`Total Expenses: Rs ${data.totalExpense?.toLocaleString("en-IN")}`, 80, 48);

      doc.setTextColor(180, 83, 9);
      doc.text(`Net Profit: Rs ${data.netProfit?.toLocaleString("en-IN")}`, 140, 48);

      const incomeRows = Object.entries(data.incomeBySource || {}).map(([src, amt]) => [
        src,
        `Rs ${amt?.toLocaleString("en-IN")}`,
        `${data.totalIncome ? ((amt / data.totalIncome) * 100).toFixed(1) : 0}%`,
      ]);

      doc.autoTable({
        startY: 62,
        head: [["Income Source", "Amount", "Share (%)"]],
        body: incomeRows,
        theme: "striped",
        headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 9, cellPadding: 3 },
      });

      const expenseRows = Object.entries(data.expenseByCategory || {}).map(([cat, amt]) => [
        cat,
        `Rs ${amt?.toLocaleString("en-IN")}`,
        `${data.totalExpense ? ((amt / data.totalExpense) * 100).toFixed(1) : 0}%`,
      ]);

      const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 12 : 120;
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(50, 50, 50);
      doc.text("Expenses Breakdown by Category", 14, finalY);

      doc.autoTable({
        startY: finalY + 4,
        head: [["Expense Category", "Amount", "Share (%)"]],
        body: expenseRows,
        theme: "striped",
        headStyles: { fillColor: [153, 27, 27], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 9, cellPadding: 3 },
      });

      doc.save(`Temple_Profit_Loss_Statement_${new Date().toISOString().split("T")[0]}.pdf`);
      toast.success("P&L Financial Statement downloaded!");
    } catch (err) {
      console.error("PDF generation failed", err);
      toast.error("Failed to generate P&L PDF report");
    }
  };

  const incomePieData = Object.entries(data.incomeBySource || {})
    .filter(([_, amt]) => amt > 0)
    .map(([name, value]) => ({ name, value }));

  const expensePieData = Object.entries(data.expenseByCategory || {})
    .filter(([_, amt]) => amt > 0)
    .map(([name, value]) => ({ name, value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex items-center gap-3 text-amber-800 dark:text-amber-400 font-bold text-lg">
          <FaSyncAlt className="animate-spin text-amber-600" /> Calculating Period Metrics...
        </div>
      </div>
    );
  }

  return (
    <div className={hideHeader ? "" : "min-h-screen bg-[#faf7f2] dark:bg-slate-900/50 p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-200"}>
      {!hideHeader && (
        <div className="mb-6 rounded-3xl border border-amber-200 dark:border-amber-700/50/60 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 p-6 backdrop-blur-md shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-amber-100">
                Profit & Loss
              </h1>
              <p className="mt-1 text-base font-medium text-[#7a4918] dark:text-amber-200/80">
                Live financial overview of Income vs Expenses with date filtering and interactive analytics.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadPDF}
                className="flex items-center gap-2 rounded-2xl bg-amber-600 hover:bg-amber-700 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:scale-105"
              >
                <FaDownload /> Download Statement (PDF)
              </button>
              <button
                type="button"
                onClick={loadPL}
                className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-temple-100 dark:bg-slate-800 px-5 py-3 text-sm font-bold text-amber-900 dark:text-amber-300 shadow-sm hover:bg-amber-50 dark:bg-amber-900/40 dark:border-amber-800/50 transition"
              >
                <FaSyncAlt /> Refresh Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILTER TOOLBAR */}
      <div className="mb-6 rounded-3xl border border-white/80 bg-temple-100 dark:bg-slate-800 p-6 shadow-md backdrop-blur-lg">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            <FaFilter className="text-amber-600" /> Filter Financial Period
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All Time" },
              { id: "today", label: "Today" },
              { id: "thisMonth", label: "This Month" },
              { id: "fy2526", label: "FY 2025-26" },
              { id: "fy2627", label: "FY 2026-27" },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetChange(preset.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                  selectedPreset === preset.id
                    ? "bg-amber-600 text-white shadow-sm shadow-amber-600/30 scale-105"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => handleFromDateChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 px-3 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => handleToDateChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 px-3 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-white"
            />
          </div>
        </div>

        {(fromDate || toDate) && (
          <div className="mt-3 flex items-center justify-between text-xs font-semibold text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/40 dark:border-amber-800/50 rounded-xl px-3.5 py-2 border border-amber-200 dark:border-amber-700/50">
            <span>
              Showing metrics for period: <strong className="text-amber-950 dark:text-amber-300">{fromDate || "Start"}</strong> to <strong className="text-amber-950">{toDate || "Today"}</strong>
            </span>
            <button
              onClick={() => handlePresetChange("all")}
              className="text-amber-700 dark:text-amber-400 underline font-bold hover:text-amber-900 dark:text-amber-300"
            >
              Clear Filter
            </button>
          </div>
        )}
      </div>

      {/* SUMMARY CARDS */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-emerald-50/90 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-700/50/80 p-6 rounded-3xl shadow-sm flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-2.5 bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 rounded-xl text-lg">
                <FaArrowUp />
              </span>
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">Total Income</h4>
            </div>
            <p className="text-3xl font-black text-emerald-950 dark:text-emerald-300">Rs {data.totalIncome?.toLocaleString("en-IN")}</p>
          </div>
        </div>

        <div className="bg-red-50/90 dark:bg-red-900/40 border border-red-200 dark:border-red-700/50/80 p-6 rounded-3xl shadow-sm flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-2.5 bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded-xl text-lg">
                <FaArrowDown />
              </span>
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-red-800 dark:text-red-400">Total Expenses</h4>
            </div>
            <p className="text-3xl font-black text-red-950 dark:text-red-300">Rs {data.totalExpense?.toLocaleString("en-IN")}</p>
          </div>
        </div>

        <div className="bg-amber-50/90 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700/50/80 p-6 rounded-3xl shadow-sm flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-2.5 bg-amber-100 dark:bg-amber-900/40 dark:border-amber-800/50 text-amber-800 dark:text-amber-400 rounded-xl text-lg">
                <FaWallet />
              </span>
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-900 dark:text-amber-300">Net Profit / Loss</h4>
            </div>
            <p className={`text-3xl font-black ${data.netProfit >= 0 ? "text-emerald-900 dark:text-emerald-300" : "text-red-900 dark:text-red-300"}`}>
              Rs {data.netProfit?.toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </section>

      {/* ATTRACTIVE ANALYTICS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* INCOME BY SOURCE CARD GRID & DONUT CHART */}
        <section className="bg-temple-100 dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700/50/60 p-6 rounded-3xl shadow-md">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-700/80 mb-5">
            <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <FaMoneyBillWave className="text-emerald-600" /> Income by Source
            </h3>
            <span className="text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-400 px-3 py-1 rounded-full">
              {incomePieData.length} Sources
            </span>
          </div>

          {incomePieData.length > 0 ? (
            <div className="space-y-6">
              {/* Interactive Donut Chart */}
              <div className="relative h-56 w-full flex items-center justify-center bg-emerald-50/40 dark:bg-emerald-900/40 rounded-2xl p-2 border border-emerald-100">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={incomePieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      minAngle={8}
                      dataKey="value"
                      onMouseEnter={(_, idx) => setHoveredIncomeSource(incomePieData[idx])}
                      onMouseLeave={() => setHoveredIncomeSource(null)}
                    >
                      {incomePieData.map((entry, index) => (
                        <Cell
                          key={`income-cell-${index}`}
                          fill={INCOME_COLORS[index % INCOME_COLORS.length]}
                          stroke={hoveredIncomeSource?.name === entry.name ? "#047857" : "#ffffff"}
                          strokeWidth={hoveredIncomeSource?.name === entry.name ? 3 : 1}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val, name) => [`Rs ${Number(val).toLocaleString("en-IN")}`, name]}
                      contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Center Text Display */}
                <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none px-4">
                  {hoveredIncomeSource ? (
                    <>
                      <span className="text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-400 tracking-wider">
                        {hoveredIncomeSource.name}
                      </span>
                      <span className="text-sm font-black text-slate-900 dark:text-slate-100 mt-0.5">
                        Rs {hoveredIncomeSource.value?.toLocaleString("en-IN")}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600">
                        {data.totalIncome > 0 ? ((hoveredIncomeSource.value / data.totalIncome) * 100).toFixed(1) : 0}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Total Income</span>
                      <span className="text-sm font-black text-emerald-950 dark:text-emerald-300 mt-0.5">
                        Rs {data.totalIncome?.toLocaleString("en-IN")}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Color-Matched Income Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {Object.entries(data.incomeBySource || {})
                  .filter(([_, amt]) => amt > 0)
                  .map(([source, amt], idx) => {
                    const sharePct = data.totalIncome > 0 ? ((amt / data.totalIncome) * 100).toFixed(1) : 0;
                    const color = INCOME_COLORS[idx % INCOME_COLORS.length];
                    const isHovered = hoveredIncomeSource?.name === source;

                    return (
                      <div
                        key={source}
                        onMouseEnter={() => setHoveredIncomeSource({ name: source, value: amt })}
                        onMouseLeave={() => setHoveredIncomeSource(null)}
                        className={`flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-800 border cursor-pointer transition-all ${
                          isHovered
                            ? "border-emerald-500 shadow-md ring-2 ring-emerald-500/20 scale-[1.02]"
                            : "border-slate-200 dark:border-slate-700/70 shadow-sm hover:border-emerald-300"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: color }}
                          />
                          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                            {getSourceIcon(source)}
                          </div>
                          <div>
                            <p className="text-xs font-extrabold text-slate-800 dark:text-slate-200">{source}</p>
                            <p className="text-sm font-black text-slate-900 dark:text-slate-100 mt-0.5">Rs {amt?.toLocaleString("en-IN")}</p>
                          </div>
                        </div>
                        <span
                          className="text-xs font-black px-2.5 py-1 rounded-lg border shadow-xs"
                          style={{ backgroundColor: `${color}15`, color: color, borderColor: `${color}40` }}
                        >
                          {sharePct < 0.1 && amt > 0 ? "< 0.1%" : `${sharePct}%`}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-400">
              <FaExclamationCircle className="mx-auto text-3xl mb-2 text-slate-300" />
              <p className="text-sm font-semibold">No income recorded for this period.</p>
            </div>
          )}
        </section>

        {/* EXPENSES BY CATEGORY CARD GRID & DONUT CHART */}
        <section className="bg-temple-100 dark:bg-slate-800 border border-red-200 dark:border-red-700/50/60 p-6 rounded-3xl shadow-md">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-700/80 mb-5">
            <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <FaReceipt className="text-red-600" /> Expenses by Category
            </h3>
            <span className="text-xs font-bold bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-800 dark:text-red-400 px-3 py-1 rounded-full">
              {expensePieData.length} Categories
            </span>
          </div>

          {expensePieData.length > 0 ? (
            <div className="space-y-6">
              {/* Interactive Donut Chart */}
              <div className="relative h-56 w-full flex items-center justify-center bg-red-50/40 dark:bg-red-900/40 rounded-2xl p-2 border border-red-100">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={expensePieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      minAngle={8}
                      dataKey="value"
                      onMouseEnter={(_, idx) => setHoveredExpenseCategory(expensePieData[idx])}
                      onMouseLeave={() => setHoveredExpenseCategory(null)}
                    >
                      {expensePieData.map((entry, index) => (
                        <Cell
                          key={`expense-cell-${index}`}
                          fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]}
                          stroke={hoveredExpenseCategory?.name === entry.name ? "#b91c1c" : "#ffffff"}
                          strokeWidth={hoveredExpenseCategory?.name === entry.name ? 3 : 1}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val, name) => [`Rs ${Number(val).toLocaleString("en-IN")}`, name]}
                      contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Center Text Display */}
                <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none px-4">
                  {hoveredExpenseCategory ? (
                    <>
                      <span className="text-[10px] font-black uppercase text-red-700 dark:text-red-400 tracking-wider">
                        {hoveredExpenseCategory.name}
                      </span>
                      <span className="text-sm font-black text-slate-900 dark:text-slate-100 mt-0.5">
                        Rs {hoveredExpenseCategory.value?.toLocaleString("en-IN")}
                      </span>
                      <span className="text-[10px] font-bold text-red-600">
                        {data.totalExpense > 0 ? ((hoveredExpenseCategory.value / data.totalExpense) * 100).toFixed(1) : 0}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">Total Expenses</span>
                      <span className="text-sm font-black text-red-950 dark:text-red-300 mt-0.5">
                        Rs {data.totalExpense?.toLocaleString("en-IN")}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Color-Matched Expense Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {Object.entries(data.expenseByCategory || {})
                  .filter(([_, amt]) => amt > 0)
                  .map(([category, amt], idx) => {
                    const sharePct = data.totalExpense > 0 ? ((amt / data.totalExpense) * 100).toFixed(1) : 0;
                    const color = EXPENSE_COLORS[idx % EXPENSE_COLORS.length];
                    const isHovered = hoveredExpenseCategory?.name === category;

                    return (
                      <div
                        key={category}
                        onMouseEnter={() => setHoveredExpenseCategory({ name: category, value: amt })}
                        onMouseLeave={() => setHoveredExpenseCategory(null)}
                        className={`flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-800 border cursor-pointer transition-all ${
                          isHovered
                            ? "border-red-500 shadow-md ring-2 ring-red-500/20 scale-[1.02]"
                            : "border-slate-200 dark:border-slate-700/70 shadow-sm hover:border-red-300"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: color }}
                          />
                          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                            {getCategoryIcon(category)}
                          </div>
                          <div>
                            <p className="text-xs font-extrabold text-slate-800 dark:text-slate-200">{category}</p>
                            <p className="text-sm font-black text-slate-900 dark:text-slate-100 mt-0.5">Rs {amt?.toLocaleString("en-IN")}</p>
                          </div>
                        </div>
                        <span
                          className="text-xs font-black px-2.5 py-1 rounded-lg border shadow-xs"
                          style={{ backgroundColor: `${color}15`, color: color, borderColor: `${color}40` }}
                        >
                          {sharePct < 0.1 && amt > 0 ? "< 0.1%" : `${sharePct}%`}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-400">
              <FaExclamationCircle className="mx-auto text-3xl mb-2 text-slate-300" />
              <p className="text-sm font-semibold">No expenses recorded for this period.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ProfitLossView;
