import React, { useState, useEffect } from "react";
import { getExpenseCategories, createManualExpense } from "../../../services/accountService";
import { toast } from "react-toastify";
import {
  FaReceipt,
  FaFilePdf,
  FaFileImage,
  FaPlus,
  FaSearch,
  FaCloudUploadAlt,
  FaTimes,
  FaEye,
  FaArrowDown,
  FaArrowUp,
  FaCheckCircle,
  FaWallet,
} from "react-icons/fa";

const INITIAL_HISTORY = [
  {
    id: "DEBIT-2026-001",
    whereSpent: "Temple Maintenance & Electrical Repairs",
    category: "Maintenance",
    entryType: "Debit",
    amount: 5400,
    paymentMethod: "UPI",
    description: "Paid for main sanctum lighting replacement and wiring repair.",
    date: "26 Jul 2026, 10:30 AM",
    receiptName: "electrical_repair_invoice.pdf",
    receiptType: "application/pdf",
    receiptPreview: null,
    status: "Reflected on Debits",
  },
  {
    id: "DEBIT-2026-002",
    whereSpent: "Daily Annadanam Groceries",
    category: "Annadanam",
    entryType: "Debit",
    amount: 12500,
    paymentMethod: "Bank Transfer",
    description: "Purchase of rice, lentils, and cooking oil for free meal distribution.",
    date: "25 Jul 2026, 09:15 AM",
    receiptName: "groceries_bill.jpg",
    receiptType: "image/jpeg",
    receiptPreview: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400&auto=format&fit=crop&q=60",
    status: "Reflected on Debits",
  },
  {
    id: "DEBIT-2026-003",
    whereSpent: "Fresh Flower Supplies for Morning Pooja",
    category: "Pooja Supplies",
    entryType: "Debit",
    amount: 2100,
    paymentMethod: "Cash",
    description: "Jasmine, Marigold, and Lotus flowers purchased from local vendor.",
    date: "24 Jul 2026, 06:45 AM",
    receiptName: null,
    receiptType: null,
    receiptPreview: null,
    status: "Reflected on Debits",
  },
];

const DEFAULT_CATEGORIES = [
  "Temple Maintenance & Repairs",
  "Priest Salary & Honorarium",
  "Daily Annadanam Groceries",
  "Pooja Materials & Flowers",
  "Electricity & Utility Bills",
  "Sanitation & Cleaning",
  "Security & Event Management",
  "Sound, Tent & Decoration",
  "Bank Charges / Fees",
  "Other Miscellaneous Expenses",
];

const ManualEntriesView = () => {
  const [categories, setCategories] = useState([]);
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem("templeManualEntries_v1");
    return saved ? JSON.parse(saved) : INITIAL_HISTORY;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [previewReceipt, setPreviewReceipt] = useState(null);

  const [form, setForm] = useState({
    whereSpent: "",
    category: DEFAULT_CATEGORIES[0],
    entryType: "Debit",
    amount: "",
    paymentMethod: "Cash",
    description: "",
    receiptFile: null,
    receiptName: null,
    receiptType: null,
    receiptPreview: null,
  });

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const cats = await getExpenseCategories();
        if (Array.isArray(cats) && cats.length > 0) {
          setCategories(cats.map((c) => c.name));
        } else {
          setCategories(DEFAULT_CATEGORIES);
        }
      } catch (err) {
        setCategories(DEFAULT_CATEGORIES);
      }
    };
    loadCategories();
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size should be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setForm((prev) => ({
        ...prev,
        receiptFile: file,
        receiptName: file.name,
        receiptType: file.type,
        receiptPreview: reader.result,
      }));
      toast.info(`Attached: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = () => {
    setForm((prev) => ({
      ...prev,
      receiptFile: null,
      receiptName: null,
      receiptType: null,
      receiptPreview: null,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const purpose = form.whereSpent.trim() || form.category;
    if (!purpose || !form.amount) {
      toast.error("Please fill in where money was spent and the amount");
      return;
    }

    const newEntry = {
      id: `DEBIT-${new Date().getFullYear()}-${String(history.length + 1).padStart(3, "0")}`,
      whereSpent: purpose,
      category: form.category || purpose,
      entryType: form.entryType,
      amount: Number(form.amount),
      paymentMethod: form.paymentMethod,
      description: form.description || "Manual debit voucher",
      date: new Date().toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      receiptName: form.receiptName || null,
      receiptType: form.receiptType || null,
      receiptPreview: form.receiptPreview || null,
      status: "Reflected on Debits",
    };

    try {
      await createManualExpense({
        category: form.category || purpose,
        amount: Number(form.amount),
        description: `[${form.entryType}] ${purpose} - ${form.description}`,
        paymentMethod: form.paymentMethod,
      }).catch(() => {});

      const updatedHistory = [newEntry, ...history];
      setHistory(updatedHistory);
      localStorage.setItem("templeManualEntries_v1", JSON.stringify(updatedHistory));

      toast.success(`Entry created! Amount Rs ${Number(form.amount).toLocaleString()} reflected on ${form.entryType}s.`);
      setForm({
        whereSpent: "",
        category: categories[0] || DEFAULT_CATEGORIES[0],
        entryType: "Debit",
        amount: "",
        paymentMethod: "Cash",
        description: "",
        receiptFile: null,
        receiptName: null,
        receiptType: null,
        receiptPreview: null,
      });
    } catch (error) {
      toast.error("Failed to submit entry");
    }
  };

  const filteredHistory = history.filter((item) => {
    const q = searchQuery.toLowerCase();
    return (
      item.whereSpent.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.paymentMethod.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  });

  const totalDebits = history
    .filter((h) => h.entryType === "Debit")
    .reduce((sum, h) => sum + Number(h.amount || 0), 0);

  return (
    <div className="min-h-screen bg-[#faf7f2] dark:bg-slate-900/50 p-4 sm:p-6 lg:p-8 text-slate-800 dark:text-slate-200">
      {/* HEADER SECTION */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-amber-200 dark:border-amber-700/50/60 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 p-6 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-amber-100">Manual Entries & Expense Vouchers</h1>
          <p className="mt-1.5 text-base sm:text-lg font-medium text-[#7a4918] dark:text-amber-200/80">
            Record manual debit vouchers, specify where money is spent, attach receipts (PDF/Image), and reflect on debits.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-temple-100 dark:bg-slate-800/80 border border-amber-200 dark:border-amber-700/50 px-5 py-3 shadow-sm">
          <FaWallet className="h-6 w-6 text-amber-600" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Recorded Debits</p>
            <p className="text-xl font-black text-amber-800 dark:text-amber-400">Rs {totalDebits.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* FIRST CARD: NEW MANUAL ENTRY (SPACIOUS & EXPANDED) */}
      <section className="mx-auto max-w-5xl rounded-3xl border border-white/80 bg-temple-100 dark:bg-slate-800 p-6 sm:p-10 shadow-xl backdrop-blur-xl mb-10 transition-all hover:shadow-2xl">
        <div className="mb-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 text-xl font-bold shadow-xs">
              <FaReceipt />
            </span>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100">New Manual Entry</h2>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Reflects directly on debit ledger & financial records</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 px-4 py-1.5 text-xs font-extrabold text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700/50 shadow-xs">
            <FaArrowDown /> Debit Voucher
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* WHERE MONEY SPENT / PURPOSE */}
            <div className="md:col-span-2">
              <label className="block text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                Where Money is Spent / Purpose <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.whereSpent}
                onChange={(e) => setForm({ ...form, whereSpent: e.target.value })}
                placeholder="e.g. Sanctum Electrical Lighting Repairs, Annadanam Rice Purchase, Priest Honorarium"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 px-5 py-4 text-base font-bold text-slate-900 dark:text-slate-100 outline-none transition focus:border-amber-500 focus:bg-temple-100 focus:ring-4 focus:ring-amber-500/15 shadow-inner"
              />
            </div>

            {/* ACCOUNT HEAD / CATEGORY */}
            <div>
              <label className="block text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                Account Head / Expense Category
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 px-5 py-4 text-base font-bold text-slate-900 dark:text-slate-100 outline-none transition focus:border-amber-500 focus:bg-temple-100 focus:ring-4 focus:ring-amber-500/15 shadow-inner"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* ENTRY TYPE */}
            <div>
              <label className="block text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                Entry Type (Reflects on Ledger)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, entryType: "Debit" })}
                  className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 px-4 text-base font-extrabold transition-all border ${
                    form.entryType === "Debit"
                      ? "bg-red-600 text-white border-red-700 shadow-md shadow-red-600/20 scale-[1.02]"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <FaArrowDown /> Debit (Expense)
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, entryType: "Credit" })}
                  className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 px-4 text-base font-extrabold transition-all border ${
                    form.entryType === "Credit"
                      ? "bg-emerald-600 text-white border-emerald-700 shadow-md shadow-emerald-600/20 scale-[1.02]"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <FaArrowUp /> Credit (Income)
                </button>
              </div>
            </div>

            {/* AMOUNT (RS) */}
            <div>
              <label className="block text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                Amount (Rs) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl text-amber-700 dark:text-amber-400">₹</span>
                <input
                  type="number"
                  required
                  min="1"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 pl-11 pr-5 py-4 text-xl font-black text-slate-900 dark:text-slate-100 outline-none transition focus:border-amber-500 focus:bg-temple-100 focus:ring-4 focus:ring-amber-500/15 shadow-inner"
                />
              </div>
            </div>

            {/* PAYMENT METHOD */}
            <div>
              <label className="block text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                Payment Method
              </label>
              <select
                required
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 px-5 py-4 text-base font-bold text-slate-900 dark:text-slate-100 outline-none transition focus:border-amber-500 focus:bg-temple-100 focus:ring-4 focus:ring-amber-500/15 shadow-inner"
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI / QR</option>
                <option value="Bank Transfer">Bank Transfer (NEFT/RTGS)</option>
                <option value="Cheque">Cheque</option>
                <option value="Card">Credit / Debit Card</option>
              </select>
            </div>
          </div>

          {/* ATTACH RECEIPT (PDF OR IMAGE) */}
          <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 dark:bg-amber-900/40 p-5 sm:p-6 text-center">
            <label className="block text-sm font-extrabold uppercase tracking-wider text-amber-900 dark:text-amber-300 mb-2">
              Attach Receipt (PDF or Image)
            </label>
            {!form.receiptName ? (
              <div className="relative inline-block cursor-pointer">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center gap-2 rounded-xl bg-temple-100 dark:bg-slate-800 border border-amber-200 dark:border-amber-700/50 px-6 py-4 shadow-sm hover:bg-amber-100/50 dark:hover:bg-amber-900/40 dark:bg-amber-900/40 transition">
                  <FaCloudUploadAlt className="h-8 w-8 text-amber-600" />
                  <span className="text-sm font-bold text-amber-900 dark:text-amber-300">Click to upload Receipt (PDF, PNG, JPG)</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Max file size: 5MB</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl bg-temple-100 dark:bg-slate-800 p-4 border border-amber-200 dark:border-amber-700/50 shadow-sm max-w-xl mx-auto">
                <div className="flex items-center gap-3">
                  {form.receiptType?.includes("pdf") ? (
                    <FaFilePdf className="h-8 w-8 text-red-500" />
                  ) : (
                    <FaFileImage className="h-8 w-8 text-blue-500" />
                  )}
                  <div className="text-left">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate max-w-xs">{form.receiptName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Receipt Attached</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 dark:bg-red-900/40 dark:border-red-800/50 hover:text-red-600 transition"
                >
                  <FaTimes />
                </button>
              </div>
            )}
          </div>

          {/* DESCRIPTION / NOTES */}
          <div>
            <label className="block text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Description / Notes (Reflects on Debit Voucher)
            </label>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Provide invoice details, vendor name, or voucher notes..."
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 px-5 py-4 text-base font-semibold text-slate-900 dark:text-slate-100 outline-none transition focus:border-amber-500 focus:bg-temple-100 focus:ring-4 focus:ring-amber-500/15 shadow-inner"
            />
          </div>

          {/* SUBMIT BUTTON */}
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 px-8 py-5 text-lg font-black text-white shadow-xl shadow-amber-600/30 transition-all hover:scale-[1.01] hover:shadow-amber-600/40"
          >
            <FaPlus /> Submit Entry & Reflect on Debits
          </button>
        </form>
      </section>

      {/* SECOND SECTION: HISTORY ("then the history should come") */}
      <section className="mx-auto max-w-6xl rounded-3xl border border-white/80 bg-temple-100 dark:bg-slate-800 p-6 sm:p-10 shadow-xl backdrop-blur-xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-5">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100">Manual Entries & Debits History</h2>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Chronological history of recorded manual vouchers and expense debits</p>
          </div>

          {/* SEARCH BAR */}
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search by purpose or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-3 pl-10 pr-4 text-sm font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-amber-500 focus:bg-temple-100"
            />
            <FaSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <th className="py-4 px-4">Entry ID & Date</th>
                <th className="py-4 px-4">Where Money Spent / Purpose</th>
                <th className="py-4 px-4">Type</th>
                <th className="py-4 px-4">Amount</th>
                <th className="py-4 px-4">Payment Method</th>
                <th className="py-4 px-4">Receipt</th>
                <th className="py-4 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHistory.length > 0 ? (
                filteredHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-amber-50/40 dark:hover:bg-amber-900/40 dark:bg-amber-900/40 transition-colors">
                    <td className="py-4 px-4">
                      <p className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">{item.id}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.date}</p>
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-base font-bold text-slate-900 dark:text-slate-100">{item.whereSpent}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{item.description}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-extrabold ${
                          item.entryType === "Debit"
                            ? "bg-red-100 dark:bg-red-900/40 dark:border-red-800/50 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-700/50"
                            : "bg-emerald-100 dark:bg-emerald-900/40 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50"
                        }`}
                      >
                        {item.entryType === "Debit" ? <FaArrowDown /> : <FaArrowUp />} {item.entryType}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-black text-lg text-slate-900 dark:text-slate-100">
                      Rs {Number(item.amount).toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-sm font-bold text-slate-700 dark:text-slate-300">{item.paymentMethod}</td>
                    <td className="py-4 px-4">
                      {item.receiptName || item.receiptPreview ? (
                        <button
                          type="button"
                          onClick={() => setPreviewReceipt(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100/70 dark:bg-amber-900/40 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-400 hover:bg-amber-200 transition"
                        >
                          <FaEye /> View Receipt
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No receipt</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-800/50 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50">
                        <FaCheckCircle className="text-emerald-500" /> {item.status || "Reflected"}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-slate-500 dark:text-slate-400 font-semibold">
                    No manual debit entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* RECEIPT PREVIEW MODAL */}
      {previewReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-temple-100 dark:bg-slate-800 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">Receipt Attachment</h3>
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">{previewReceipt.id} - {previewReceipt.whereSpent}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewReceipt(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:bg-slate-800 hover:text-slate-600 dark:text-slate-400"
              >
                <FaTimes />
              </button>
            </div>

            <div className="my-4 flex flex-col items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 p-6 border border-slate-200 dark:border-slate-700">
              {previewReceipt.receiptPreview ? (
                previewReceipt.receiptType?.includes("pdf") ? (
                  <div className="text-center">
                    <FaFilePdf className="h-16 w-16 text-red-500 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{previewReceipt.receiptName}</p>
                  </div>
                ) : (
                  <img
                    src={previewReceipt.receiptPreview}
                    alt="Receipt Preview"
                    className="max-h-80 w-auto rounded-xl object-contain shadow-md"
                  />
                )
              ) : (
                <div className="text-center py-6">
                  <FaReceipt className="h-12 w-12 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{previewReceipt.receiptName || "Receipt Attached"}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewReceipt(null)}
                className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManualEntriesView;
