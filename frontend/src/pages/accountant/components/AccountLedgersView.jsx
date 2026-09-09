import React, { useState, useEffect } from "react";
import { getTransactions } from "../../../services/accountService";
import { toast } from "react-toastify";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import {
  FaSearch,
  FaFilter,
  FaArrowDown,
  FaArrowUp,
  FaFileInvoiceDollar,
  FaWallet,
  FaReceipt,
  FaCheckCircle,
  FaDownload,
  FaListOl,
  FaEye,
} from "react-icons/fa";

const SAMPLE_SYSTEM_TRANSACTIONS = [
  {
    _id: "SYS-TX-101",
    date: new Date().toISOString(),
    referenceId: "DNT-2026-881",
    description: "General Temple Donation by Devotee Ramesh Kumar",
    source: "Donation",
    category: "General Fund",
    paymentMethod: "UPI",
    transactionType: "Credit",
    amount: 5000,
    status: "Completed",
  },
  {
    _id: "SYS-TX-102",
    date: new Date(Date.now() - 86400000).toISOString(),
    referenceId: "PJB-2026-402",
    description: "Maha Abhisheka Seva Booking",
    source: "Pooja Booking",
    category: "Pooja Seva",
    paymentMethod: "Card",
    transactionType: "Credit",
    amount: 1500,
    status: "Completed",
  },
  {
    _id: "SYS-TX-103",
    date: new Date(Date.now() - 172800000).toISOString(),
    referenceId: "PRS-2026-119",
    description: "Laddu & Pulihora Prasadam Counter Sales",
    source: "Prasadam",
    category: "Prasadam Sales",
    paymentMethod: "Cash",
    transactionType: "Credit",
    amount: 3200,
    status: "Completed",
  },
  {
    _id: "SYS-TX-104",
    date: new Date(Date.now() - 259200000).toISOString(),
    referenceId: "DNT-2026-879",
    description: "Annadanam Fund Contribution",
    source: "Donation",
    category: "Annadanam Fund",
    paymentMethod: "UPI",
    transactionType: "Credit",
    amount: 2500,
    status: "Completed",
  },
  {
    _id: "SYS-TX-105",
    date: new Date(Date.now() - 345600000).toISOString(),
    referenceId: "PJB-2026-398",
    description: "Satyanarayan Pooja Booking",
    source: "Pooja Booking",
    category: "Pooja Seva",
    paymentMethod: "Bank Transfer",
    transactionType: "Credit",
    amount: 1201,
    status: "Completed",
  },
];

const AccountLedgersView = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("All"); // "All", "Debit", "Credit"
  const [showAllRows, setShowAllRows] = useState(false); // Default: show recent 5

  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    transactionType: "",
    source: "",
  });

  const loadLedgers = async () => {
    setLoading(true);
    let backendData = [];
    try {
      const data = await getTransactions(filters);
      if (Array.isArray(data) && data.length > 0) {
        backendData = data;
      }
    } catch (error) {
      // Graceful fallback if backend is idle
    }

    // Retrieve manual entries from localStorage
    const savedManual = localStorage.getItem("templeManualEntries_v1");
    let manualEntries = savedManual ? JSON.parse(savedManual) : [];

    // Map manual entries to standard ledger transaction schema
    const formattedManualTransactions = manualEntries.map((m) => {
      const parseableDate = m.date ? new Date(m.date).toISOString() : new Date().toISOString();
      return {
        _id: m.id,
        date: parseableDate,
        displayDate: m.date || new Date().toLocaleDateString(),
        referenceId: m.id,
        description: `[${m.whereSpent}] ${m.description || ""}`,
        source: "Manual Entry",
        category: m.category || m.whereSpent || "Manual Debit",
        paymentMethod: m.paymentMethod || "Cash",
        transactionType: m.entryType || "Debit",
        amount: Number(m.amount || 0),
        status: "Completed",
        isManual: true,
        receiptName: m.receiptName,
      };
    });

    const baseList = backendData.length > 0 ? backendData : SAMPLE_SYSTEM_TRANSACTIONS;
    const combined = [...formattedManualTransactions, ...baseList];

    // Sort by date descending
    combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setTransactions(combined);
    setLoading(false);
  };

  useEffect(() => {
    loadLedgers();
  }, [filters]);

  const handleFilterChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  // Filter transactions based on UI controls, Active Tab, and search query
  const filteredTransactions = transactions.filter((t) => {
    // Separate Tab Views: All, Debit, Credit
    if (activeTab === "Debit" && t.transactionType !== "Debit") return false;
    if (activeTab === "Credit" && t.transactionType !== "Credit") return false;

    // Dropdown Type Filter
    if (filters.transactionType && t.transactionType !== filters.transactionType) {
      return false;
    }
    // Source / Module Filter
    if (filters.source && t.source !== filters.source) {
      return false;
    }
    // Start Date Filter
    if (filters.startDate) {
      const txDate = new Date(t.date).setHours(0, 0, 0, 0);
      const filterStart = new Date(filters.startDate).setHours(0, 0, 0, 0);
      if (txDate < filterStart) return false;
    }
    // End Date Filter
    if (filters.endDate) {
      const txDate = new Date(t.date).setHours(23, 59, 59, 999);
      const filterEnd = new Date(filters.endDate).setHours(23, 59, 59, 999);
      if (txDate > filterEnd) return false;
    }
    // Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchRef = t.referenceId?.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      const matchSource = t.source?.toLowerCase().includes(q);
      const matchCategory = t.category?.toLowerCase().includes(q);
      if (!matchRef && !matchDesc && !matchSource && !matchCategory) return false;
    }
    return true;
  });

  // Display subset based on showAllRows: 5 rows or All
  const displayedTransactions = showAllRows ? filteredTransactions : filteredTransactions.slice(0, 5);

  const isToday = (dateInput) => {
    if (!dateInput) return false;
    const d = new Date(dateInput);
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  };

  // Metrics
  const todayCredits = transactions
    .filter((t) => t.transactionType === "Credit" && isToday(t.date))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const todayDebits = transactions
    .filter((t) => t.transactionType === "Debit" && isToday(t.date))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const totalCredits = filteredTransactions
    .filter((t) => t.transactionType === "Credit")
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const totalDebits = filteredTransactions
    .filter((t) => t.transactionType === "Debit")
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const netBalance = totalCredits - totalDebits;

  // PDF DOWNLOAD REPORT HANDLER
  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // Header Banner
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(188, 108, 16);
      doc.text("Sri Shanti Mahadev Mandir", 14, 15);

      doc.setFontSize(12);
      doc.setTextColor(50, 50, 50);
      doc.text("General Ledger & Debits Statement", 14, 22);

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated on: ${new Date().toLocaleString("en-IN")}`, 14, 27);
      doc.text(`Active View: ${activeTab === "All" ? "All Entries" : activeTab + "s Only"} | Records: ${filteredTransactions.length}`, 14, 32);

      // Summary Box
      doc.setFillColor(250, 247, 242);
      doc.roundedRect(14, 36, 182, 18, 3, 3, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(22, 101, 52);
      doc.text(`Total Credits: Rs ${totalCredits.toLocaleString()}`, 20, 47);

      doc.setTextColor(153, 27, 27);
      doc.text(`Total Debits: Rs ${totalDebits.toLocaleString()}`, 80, 47);

      doc.setTextColor(180, 83, 9);
      doc.text(`Net Balance: Rs ${netBalance.toLocaleString()}`, 140, 47);

      // Table Data
      const tableRows = filteredTransactions.map((t) => [
        t.displayDate || new Date(t.date).toLocaleDateString(),
        t.referenceId || "N/A",
        t.description || "",
        t.category || t.source || "",
        t.paymentMethod || "Cash",
        t.transactionType || "Debit",
        `Rs ${Number(t.amount || 0).toLocaleString()}`,
      ]);

      doc.autoTable({
        startY: 58,
        head: [["Date", "Ref ID", "Description / Purpose", "Category", "Mode", "Type", "Amount"]],
        body: tableRows,
        theme: "striped",
        headStyles: { fillColor: [188, 108, 16], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 2.5 },
        columnStyles: {
          0: { cellWidth: 24 },
          1: { cellWidth: 28 },
          2: { cellWidth: 50 },
          3: { cellWidth: 26 },
          4: { cellWidth: 18 },
          5: { cellWidth: 16 },
          6: { cellWidth: 20, fontStyle: "bold" },
        },
      });

      doc.save(`Temple_Ledger_Report_${new Date().toISOString().split("T")[0]}.pdf`);
      toast.success("Ledger statement PDF downloaded successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate PDF statement");
    }
  };

  return (
    <div className="min-h-screen bg-[#faf7f2] dark:bg-slate-900/50 p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-200">
      {/* HERO BANNER */}
      <div className="mb-6 rounded-3xl border border-amber-200 dark:border-amber-700/50/60 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 p-6 backdrop-blur-md shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-amber-100">
              Account Ledgers & Expenses
            </h1>
            <p className="mt-1 text-base font-medium text-[#7a4918] dark:text-amber-200/80">
              Separate views for Credits and Debits, recent 5 vs full view controls, and complete PDF download reports.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 rounded-2xl bg-amber-600 hover:bg-amber-700 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:scale-105"
            >
              <FaDownload /> Download PDF Statement
            </button>
            <button
              type="button"
              onClick={loadLedgers}
              className="rounded-2xl border border-amber-300 bg-temple-100 dark:bg-slate-800 px-5 py-3 text-sm font-bold text-amber-900 dark:text-amber-300 shadow-sm hover:bg-amber-50 dark:bg-amber-900/40 dark:border-amber-800/50 transition"
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* METRICS CARDS */}
      {activeTab === "Credit" && (
        <div className="grid gap-5 md:grid-cols-2 mb-6">
          <div className="rounded-3xl border border-emerald-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Today's Credits (Income)</p>
              <p className="mt-2 text-3xl font-black text-emerald-950 dark:text-emerald-300">Rs {todayCredits.toLocaleString()}</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 text-xl">
              <FaArrowUp />
            </span>
          </div>

          <div className="rounded-3xl border border-emerald-200 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-800/50 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">Total Credits (Income)</p>
              <p className="mt-2 text-3xl font-black text-emerald-950 dark:text-emerald-300">Rs {totalCredits.toLocaleString()}</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-200 text-emerald-800 dark:text-emerald-400 text-xl">
              <FaWallet />
            </span>
          </div>
        </div>
      )}

      {activeTab === "Debit" && (
        <div className="grid gap-5 md:grid-cols-2 mb-6">
          <div className="rounded-3xl border border-red-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-red-700 dark:text-red-400">Today's Debits (Expenses)</p>
              <p className="mt-2 text-3xl font-black text-red-950 dark:text-red-300">Rs {todayDebits.toLocaleString()}</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-700 dark:text-red-400 text-xl">
              <FaArrowDown />
            </span>
          </div>

          <div className="rounded-3xl border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-900/40 dark:border-red-800/50 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-red-800 dark:text-red-400">Total Debits (Expenses)</p>
              <p className="mt-2 text-3xl font-black text-red-950 dark:text-red-300">Rs {totalDebits.toLocaleString()}</p>
              <p className="mt-1 text-xs font-bold text-red-600">Reflects all manual expense vouchers</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-200 text-red-800 dark:text-red-400 text-xl">
              <FaWallet />
            </span>
          </div>
        </div>
      )}

      {activeTab === "All" && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          <div className="rounded-3xl border border-emerald-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Today's Credits</p>
              <p className="mt-2 text-2xl font-black text-emerald-950 dark:text-emerald-300">Rs {todayCredits.toLocaleString()}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 text-lg">
              <FaArrowUp />
            </span>
          </div>

          <div className="rounded-3xl border border-red-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-red-700 dark:text-red-400">Today's Debits</p>
              <p className="mt-2 text-2xl font-black text-red-950 dark:text-red-300">Rs {todayDebits.toLocaleString()}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-700 dark:text-red-400 text-lg">
              <FaArrowDown />
            </span>
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Total Credits (Income)</p>
              <p className="mt-2 text-2xl font-black text-emerald-950 dark:text-emerald-300">Rs {totalCredits.toLocaleString()}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 text-lg">
              <FaArrowUp />
            </span>
          </div>

          <div className="rounded-3xl border border-red-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-red-700 dark:text-red-400">Total Debits (Expenses)</p>
              <p className="mt-2 text-2xl font-black text-red-950 dark:text-red-300">Rs {totalDebits.toLocaleString()}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-700 dark:text-red-400 text-lg">
              <FaArrowDown />
            </span>
          </div>

          <div className="rounded-3xl border border-amber-100 bg-temple-100 dark:bg-slate-800 p-6 shadow-sm flex items-center justify-between sm:col-span-2 lg:col-span-1">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">Net Ledger Balance</p>
              <p className={`mt-2 text-2xl font-black ${netBalance >= 0 ? "text-emerald-800 dark:text-emerald-400" : "text-red-800 dark:text-red-400"}`}>
                Rs {netBalance.toLocaleString()}
              </p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 text-lg">
              <FaWallet />
            </span>
          </div>
        </div>
      )}

      {/* SEPARATE TABS VIEW FOR CREDITS AND DEBITS */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-temple-100 dark:bg-slate-800 p-3 shadow-md border border-slate-200 dark:border-slate-700">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("All");
              setFilters((prev) => ({ ...prev, transactionType: "" }));
            }}
            className={`px-5 py-3 rounded-2xl text-sm font-extrabold transition-all ${activeTab === "All"
              ? "bg-amber-600 text-white shadow-md shadow-amber-600/30 scale-[1.02]"
              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              }`}
          >
            All Ledger Entries ({transactions.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("Debit");
              setFilters((prev) => ({ ...prev, transactionType: "Debit" }));
            }}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-extrabold transition-all ${activeTab === "Debit"
              ? "bg-red-600 text-white shadow-md shadow-red-600/30 scale-[1.02]"
              : "bg-red-50 dark:bg-red-900/40 dark:border-red-800/50 text-red-700 dark:text-red-400 hover:bg-red-100"
              }`}
          >
            <FaArrowDown /> Debits Only (Expenses)
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("Credit");
              setFilters((prev) => ({ ...prev, transactionType: "Credit" }));
            }}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-extrabold transition-all ${activeTab === "Credit"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30 scale-[1.02]"
              : "bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100"
              }`}
          >
            <FaArrowUp /> Credits Only (Income)
          </button>
        </div>

        {/* 5 VIEWS vs VIEW ALL TOGGLE BUTTON */}
        <button
          type="button"
          onClick={() => setShowAllRows(!showAllRows)}
          className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-900/40 dark:border-amber-800/50 px-5 py-3 text-sm font-extrabold text-amber-900 dark:text-amber-300 shadow-sm hover:bg-amber-100 transition"
        >
          <FaListOl /> {showAllRows ? "Showing All Records (Click for Recent 5)" : `Show Recent 5 (View All ${filteredTransactions.length})`}
        </button>
      </div>

      {/* FILTER TOOLBAR */}
      <div className="mb-6 rounded-3xl border border-white/80 bg-temple-100 dark:bg-slate-800 p-6 shadow-md backdrop-blur-lg">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            <FaFilter className="text-amber-600" /> Advanced Filter Options
          </div>
          <button
            type="button"
            onClick={() => {
              setFilters({ startDate: "", endDate: "", transactionType: "", source: "" });
              setSearchQuery("");
              setActiveTab("All");
            }}
            className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* SEARCH BAR */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Search Purpose / ID</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search purpose, ref..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 pl-9 pr-3 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-temple-100"
              />
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* FROM DATE */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">From Date</label>
            <input
              type="date"
              name="startDate"
              value={filters.startDate}
              onChange={handleFilterChange}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-temple-100"
            />
          </div>

          {/* TO DATE */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">To Date</label>
            <input
              type="date"
              name="endDate"
              value={filters.endDate}
              onChange={handleFilterChange}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-temple-100"
            />
          </div>

          {/* MODULE SOURCE */}
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Module Source</label>
            <select
              name="source"
              value={filters.source}
              onChange={handleFilterChange}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-temple-100"
            >
              <option value="">All Sources</option>
              <option value="Manual Entry">Manual Entry (Debits)</option>
              <option value="Donation">Donations</option>
              <option value="Pooja Booking">Pooja Bookings</option>
              <option value="Prasadam">Prasadam Sales</option>
              <option value="Room Booking">Room Booking</option>
            </select>
          </div>
        </div>
      </div>

      {/* GENERAL LEDGER TABLE SECTION */}
      <section className="rounded-3xl border border-white/80 bg-temple-100 dark:bg-slate-800 p-6 sm:p-8 shadow-xl backdrop-blur-xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 font-bold">
              <FaFileInvoiceDollar />
            </span>
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">
                {activeTab === "Debit" ? "Debits & Expense Ledger" : activeTab === "Credit" ? "Credits & Income Ledger" : "General Ledger"}
              </h2>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {!showAllRows ? `Showing recent 5 entries (Out of ${filteredTransactions.length} total)` : `Showing all ${filteredTransactions.length} entries`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAllRows(!showAllRows)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition"
            >
              {showAllRows ? "Show Recent 5 Only" : `View All ${filteredTransactions.length}`}
            </button>
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition"
            >
              <FaDownload /> Download Statement (PDF)
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-base font-bold text-slate-500 dark:text-slate-400">
            Loading ledger entries...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-4 px-4">Date</th>
                  <th className="py-4 px-4">Reference / ID</th>
                  <th className="py-4 px-4">Description / Purpose</th>
                  <th className="py-4 px-4">Source / Category</th>
                  <th className="py-4 px-4">Payment Method</th>
                  <th className="py-4 px-4">Type</th>
                  <th className="py-4 px-4">Amount</th>
                  <th className="py-4 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="py-10 text-center text-slate-500 dark:text-slate-400 font-semibold">
                      No ledger transactions found for current tab/filters.
                    </td>
                  </tr>
                ) : (
                  displayedTransactions.map((t) => (
                    <tr
                      key={t._id || t.referenceId}
                      className={`transition-colors ${t.isManual ? "bg-amber-50/30 dark:bg-amber-900/40 hover:bg-amber-50/60 dark:hover:bg-amber-900/40" : "hover:bg-slate-50 dark:bg-slate-800"
                        }`}
                    >
                      <td className="py-4 px-4 text-xs font-semibold text-slate-600 dark:text-slate-400">
                        {t.displayDate || new Date(t.date).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-4 font-mono text-xs font-bold text-amber-800 dark:text-amber-400">
                        {t.referenceId || "N/A"}
                        {t.isManual && (
                          <span className="block text-[10px] font-extrabold text-amber-600 uppercase">Manual Voucher</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.description}</p>
                        {t.receiptName && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-xs text-amber-700 dark:text-amber-400 font-semibold">
                            <FaReceipt /> Receipt Attached ({t.receiptName})
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{t.source}</p>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t.category}</p>
                      </td>
                      <td className="py-4 px-4 text-sm font-bold text-slate-700 dark:text-slate-300">{t.paymentMethod}</td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-extrabold border ${t.transactionType === "Credit"
                            ? "bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/50"
                            : "bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-800 dark:text-red-400 border-red-200 dark:border-red-700/50"
                            }`}
                        >
                          {t.transactionType === "Credit" ? <FaArrowUp /> : <FaArrowDown />} {t.transactionType}
                        </span>
                      </td>
                      <td className={`py-4 px-4 text-base font-black ${t.transactionType === "Credit" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                        Rs {Number(t.amount || 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-800/50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50">
                          <FaCheckCircle className="text-emerald-500" /> {t.status || "Completed"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* BOTTOM PAGINATION/TOGGLE BANNER */}
        {!showAllRows && filteredTransactions.length > 5 && (
          <div className="mt-6 flex flex-wrap items-center justify-between rounded-2xl bg-amber-50 dark:bg-amber-900/40 dark:border-amber-800/50 p-4 border border-amber-200 dark:border-amber-700/50">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
              Currently showing 5 recent entries out of {filteredTransactions.length} total records.
            </p>
            <button
              type="button"
              onClick={() => setShowAllRows(true)}
              className="rounded-xl bg-amber-600 hover:bg-amber-700 px-5 py-2.5 text-xs font-extrabold text-white transition shadow-sm"
            >
              View All {filteredTransactions.length} Entries &rarr;
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default AccountLedgersView;
