const defaultDonationSources = [
  { label: "Online", count: 45, color: "bg-emerald-500" },
  { label: "Cash", count: 30, color: "bg-orange-400" },
  { label: "Cheque", count: 15, color: "bg-sky-500" },
  { label: "UPI", count: 10, color: "bg-violet-500" },
];

const DonationChart = ({ sources = [], showCounts = false }) => {
  const donationSources = sources.length ? sources : defaultDonationSources;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-6">
      {donationSources.map((source) => (
        <div key={source.label} className="flex flex-col p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-[#0f172a] hover:bg-gray-100 dark:hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-4 h-4 rounded-full ${source.color}`} />
            <span className="text-base font-medium text-gray-700 dark:text-slate-300">{source.label}</span>
          </div>
          <div className="flex items-end justify-between">
             <div className="flex flex-col">
               <span className="text-3xl font-bold text-gray-900 dark:text-slate-100">{Number(source.count || 0)}</span>
               <span className="text-xs text-gray-500 dark:text-slate-400 font-semibold uppercase tracking-wider mt-1.5">Transactions</span>
             </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DonationChart;
