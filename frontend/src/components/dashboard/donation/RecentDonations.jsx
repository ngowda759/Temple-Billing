import React from "react";

const RecentDonations = ({ donations = [] }) => {
  const recent = [...donations]
    .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime())
    .slice(0, 4);

  return (
    <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] p-6 shadow-md backdrop-blur-lg">
      <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200">Recent Donation Activity</h2>
      <p className="mt-1 text-sm font-semibold text-slate-500">Live donation inflows from the temple backend ledger.</p>

      <div className="mt-5 space-y-3">
        {recent.map((donation, index) => (
          <div key={`${donation._id || donation.id}-${index}`} className="rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-base font-extrabold text-slate-900 dark:text-slate-200">{donation.donorName || donation.donor || "Devotee Donor"}</p>
              <span className="text-base font-black text-amber-700">{donation.amount ? `₹${Number(donation.amount).toLocaleString("en-IN")}` : "₹0"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs font-semibold text-slate-500">
              <span className="rounded-md bg-amber-50 dark:bg-[#0f172a] px-2 py-0.5 text-amber-800 border border-amber-200">{donation.category || "General"}</span>
              <span>{new Date(donation.createdAt || donation.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        ))}
        {recent.length === 0 && <p className="text-slate-400 font-semibold">No recent donations recorded yet.</p>}
      </div>
    </div>
  );
};

export default RecentDonations;
