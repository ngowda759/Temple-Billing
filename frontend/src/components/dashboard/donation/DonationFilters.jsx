import React, { useMemo, useState } from "react";

const DonationFilters = ({ categories, onApplyFilters }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Donation Types");
  const [selectedStatus, setSelectedStatus] = useState("All Statuses");

  const categoryOptions = useMemo(
    () => ["All Donation Types", ...(categories || [])],
    [categories]
  );

  const handleApply = () => {
    onApplyFilters({
      searchTerm,
      category: selectedCategory,
      status: selectedStatus,
    });
  };

  return (
    <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] p-6 shadow-md backdrop-blur-lg">
      <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200">Donation Filters</h2>
      <p className="mt-1 text-sm font-semibold text-slate-500">Filter live donation data by donor, type and status.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          type="text"
          placeholder="Search donor / receipt / category..."
          className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a] px-4 py-3 text-slate-800 dark:text-slate-200 font-semibold placeholder:text-slate-400 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 shadow-xs"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a] px-4 py-3 text-slate-800 dark:text-slate-200 font-semibold outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 shadow-xs"
        >
          {categoryOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <button
          onClick={handleApply}
          className="rounded-2xl bg-amber-600 px-5 py-3 font-extrabold text-white shadow-md transition hover:bg-amber-700 hover:scale-105"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};

export default DonationFilters;
