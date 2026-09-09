import React from "react";
import { FaDonate, FaUsers } from "react-icons/fa";

const DonationStats = ({ stats = {} }) => {
  const displayStats = [
    {
      title: "Total Donations",
      value: stats.totalAmount != null ? `₹${Number(stats.totalAmount).toLocaleString("en-IN")}` : "₹0",
      icon: <FaDonate />,
      accent: "from-amber-500 to-orange-600",
    },
    {
      title: "Total Donors",
      value: stats.totalDonors ?? 0,
      icon: <FaUsers />,
      accent: "from-amber-600 to-yellow-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6">
      {displayStats.map((item, index) => (
        <div
          key={index}
          className="rounded-[32px] border border-amber-200/60 bg-temple-100 dark:bg-[#0f172a] p-6 shadow-md backdrop-blur-lg"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] font-extrabold text-amber-700">{item.title}</p>
              <h2 className="mt-2 text-3xl font-black text-slate-800 dark:text-slate-200">{item.value}</h2>
            </div>

            <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${item.accent} text-white flex items-center justify-center text-2xl shadow-md`}>
              {item.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DonationStats;
