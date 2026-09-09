import React from "react";

const formatAmount = (value) => {
  const amount = Number(value);
  if (Number.isNaN(amount)) return value || "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
};

const TopDonors = ({ donations = [] }) => {
  const totals = donations.reduce((acc, donation) => {
    const name = donation.donorName || donation.donor || "Unknown";
    const amount = Number(donation.amount) || 0;
    acc[name] = (acc[name] || 0) + amount;
    return acc;
  }, {});

  const topDonors = Object.entries(totals)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  return (
    <div className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] p-6 shadow-md backdrop-blur-lg">
      <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200">Top Donors</h2>
      <p className="mt-1 text-sm font-semibold text-slate-500">Highest total contributors to Sri Shanti Mahadev Mandir.</p>

      <div className="mt-5 space-y-3">
        {topDonors.length > 0 ? (
          topDonors.map((donor, index) => (
            <div key={donor.name} className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-white dark:bg-[#0f172a] p-4 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-[#0f172a] text-amber-900 font-extrabold text-sm border border-amber-300">
                  #{index + 1}
                </div>
                <div>
                  <p className="text-base font-extrabold text-slate-900 dark:text-slate-200">{donor.name}</p>
                  <p className="text-xs font-semibold text-amber-700">Top Supporter</p>
                </div>
              </div>
              <p className="text-base font-black text-amber-700">{formatAmount(donor.amount)}</p>
            </div>
          ))
        ) : (
          <p className="text-slate-400 font-semibold">No donation data available yet.</p>
        )}
      </div>
    </div>
  );
};

export default TopDonors;
