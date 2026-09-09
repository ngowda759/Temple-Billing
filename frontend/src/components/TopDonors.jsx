const donors = [
  { name: "Ramesh Patel", amount: "₹ 21,000" },
  { name: "Sita Devi", amount: "₹ 15,500" },
  { name: "Arjun Kumar", amount: "₹ 12,000" },
  { name: "Meena Rao", amount: "₹ 9,800" },
];

const TopDonors = () => {
  return (
    <div className="mt-5 space-y-3">
      {donors.map((donor) => (
        <div key={donor.name} className="flex items-center justify-between rounded-xl bg-amber-50 dark:bg-[#0f172a] px-4 py-3">
          <span className="font-medium text-gray-700 dark:text-slate-200">{donor.name}</span>
          <span className="font-bold text-amber-700">{donor.amount}</span>
        </div>
      ))}
    </div>
  );
};

export default TopDonors;
