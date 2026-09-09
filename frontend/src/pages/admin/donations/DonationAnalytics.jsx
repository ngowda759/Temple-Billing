import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const analytics = [
 { title: "Revenue Growth", value: "18.3%", color: "from-slate-800 to-violet-700" },
 { title: "Source Mix", value: "65% UPI", color: "from-amber-500 to-orange-400" },
 { title: "Category Share", value: "42% Festival", color: "from-cyan-500 to-sky-400" },
 { title: "Donor Retention", value: "79%", color: "from-emerald-500 to-teal-400" },
];

const DonationAnalytics = () => {
 return (
 <DonationPageShell
 title="Donation Analytics"
 subtitle="Advanced charts and KPI cards for the temple donation finance team."
 >
 <div className="grid gap-6 lg:grid-cols-2">
 {analytics.map((item) => (
 <div key={item.title} className={`rounded-[32px] border border-white/10 bg-gradient-to-r ${item.color} p-6 text-white shadow-2xl shadow-slate-900/20`}>
 <p className="text-sm uppercase tracking-[0.3em] text-amber-100/90">{item.title}</p>
 <p className="mt-4 text-4xl font-semibold">{item.value}</p>
 </div>
 ))}
 </div>
 <SectionCard title="Seasonal Trends" subtitle="Donation performance by month, festival and campaign cycles." className="overflow-hidden">
 <div className="h-72 flex items-center justify-center text-slate-400">Charts coming soon</div>
 </SectionCard>
 </DonationPageShell>
 );
};

export default DonationAnalytics;
