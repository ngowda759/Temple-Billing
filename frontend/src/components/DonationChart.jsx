const donationSources = [
  { label: "Online", value: 45, color: "bg-emerald-500" },
  { label: "Cash", value: 30, color: "bg-orange-400" },
  { label: "Cheque", value: 15, color: "bg-sky-500" },
  { label: "UPI", value: 10, color: "bg-violet-500" },
];

const DonationChart = () => {
  return (
    <div className="space-y-4 mt-6">
      {donationSources.map((source) => (
        <div key={source.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">{source.label}</span>
            <span className="font-semibold text-gray-700 dark:text-slate-200">{source.value}%</span>
          </div>
          <div className="h-3 bg-gray-100 dark:bg-[#0f172a] rounded-full overflow-hidden">
            <div className={`h-3 rounded-full ${source.color}`} style={{ width: `${source.value}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default DonationChart;
