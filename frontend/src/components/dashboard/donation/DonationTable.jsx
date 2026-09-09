import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const statusStyles = {
  Collected: "bg-emerald-100 text-emerald-800 border-emerald-300",
  "Not Collected": "bg-amber-100 text-amber-800 border-amber-300",
  Completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Pending: "bg-amber-100 text-amber-800 border-amber-300",
  Failed: "bg-rose-100 text-rose-800 border-rose-300",
};

const formatCurrency = (value) => {
  if (value == null) return "₹0";
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
};

const DonationTable = ({ donations = [], onRefresh }) => {
  const navigate = useNavigate();

  const handleToggleStatus = async (donationId, currentStatus) => {
    const nextStatus = currentStatus === "Collected" ? "Not Collected" : "Collected";
    try {
      await axios.patch(`http://localhost:5000/api/donations/${donationId}/status`, { status: nextStatus });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.warn("Failed to toggle status in DonationTable", err);
    }
  };

  const rows = useMemo(
    () =>
      donations.slice(0, 8).map((donation) => ({
        raw: donation,
        id: donation._id ? `DN-${donation._id.slice(-6).toUpperCase()}` : donation.id ? `DN-${donation.id.slice(-6).toUpperCase()}` : "-",
        donor: donation.donorName || donation.donor || "Unknown",
        category: donation.category || "General",
        amount: formatCurrency(donation.amount),
        date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : donation.date || "-",
        status: donation.status || "Not Collected",
        verifiedBy: donation.verifiedBy || donation.verifiedBy || "Admin",
      })),
    [donations]
  );

  return (
    <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] p-6 shadow-md backdrop-blur-lg">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200">Donation Activity Log</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Live donation entries and verification status from the temple backend.</p>
        </div>
        <div className="flex gap-3">
          {donations.length > 8 && (
            <button
              onClick={() => navigate("/admin/donations/all")}
              className="inline-flex items-center justify-center rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 shadow-xs"
            >
              View All
            </button>
          )}
          <button
            onClick={() => navigate("/admin/donations/settings")}
            className="inline-flex items-center justify-center rounded-2xl bg-amber-600 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-amber-700 shadow-md"
          >
            Manage Donation Types
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a]">
        <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
          <thead className="bg-amber-50/70 dark:bg-[#0f172a] border-b border-amber-200/80 text-amber-950 font-black">
            <tr>
              <th className="py-3.5 px-4">Receipt ID</th>
              <th className="py-3.5 px-4">Donor</th>
              <th className="py-3.5 px-4">Category</th>
              <th className="py-3.5 px-4">Amount</th>
              <th className="py-3.5 px-4">Date</th>
              <th className="py-3.5 px-4">Verified By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-amber-50/40 transition">
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-slate-200">{row.id}</td>
                <td className="py-3.5 px-4 font-semibold">{row.donor}</td>
                <td className="py-3.5 px-4">{row.category}</td>
                <td className="py-3.5 px-4 text-amber-700 font-extrabold">{row.amount}</td>
                <td className="py-3.5 px-4 text-slate-500 font-medium">{row.date}</td>
                <td className="py-3.5 px-4 text-slate-600 font-medium">{row.verifiedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DonationTable;
