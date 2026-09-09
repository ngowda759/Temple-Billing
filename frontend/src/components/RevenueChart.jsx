const monthlyRevenue = [
  { month: "Jan", value: 35 },
  { month: "Feb", value: 42 },
  { month: "Mar", value: 50 },
  { month: "Apr", value: 46 },
  { month: "May", value: 58 },
  { month: "Jun", value: 63 },
];

const RevenueChart = () => {
  const maxValue = Math.max(...monthlyRevenue.map((entry) => entry.value));

  return (
    <div className="h-[250px] flex items-end justify-between gap-3 pt-6">
      {monthlyRevenue.map((entry) => (
        <div key={entry.month} className="flex flex-col items-center flex-1 gap-2">
          <div className="h-40 w-full rounded-xl bg-orange-50 dark:bg-[#0f172a] flex items-end p-1.5">
            <div
              className="w-full rounded-lg bg-gradient-to-t from-orange-400 to-amber-300 transition-all duration-500"
              style={{ height: `${(entry.value / maxValue) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{entry.month}</span>
        </div>
      ))}
    </div>
  );
};

export default RevenueChart;
