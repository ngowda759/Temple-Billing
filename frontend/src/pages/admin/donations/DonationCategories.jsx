import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const categories = [
 { title: "Temple Fund", amount: "₹1,82,000" },
 { title: "Annadanam", amount: "₹1,25,000" },
 { title: "Festival Donations", amount: "₹95,000" },
 { title: "Sponsorships", amount: "₹65,000" },
];

const DonationCategories = () => {
 return (
 <DonationPageShell
 title="Donation Categories"
 subtitle="Manage categories, budgets and collection analytics for every temple donation type."
 >
 <div className="grid gap-6 xl:grid-cols-2">
 <SectionCard title="Category Performance" subtitle="A high-level view of active donation categories." className="grid gap-4 lg:grid-cols-2">
 {categories.map((cat) => (
 <div key={cat.title} className="rounded-[28px] border border-white/10 bg-slate-950/10 p-5">
 <p className="text-sm text-slate-300">{cat.title}</p>
 <p className="mt-3 text-3xl font-semibold text-white">{cat.amount}</p>
 </div>
 ))}
 </SectionCard>

 <SectionCard title="Category Insights" subtitle="Use these categories to build reports and targeted campaigns.">
 <ul className="space-y-3 text-slate-200">
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">Annadanam donations drive evening temple queues and community meals.</li>
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">Festival donations peak during Rathotsava and Deepavali cycles.</li>
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">Temple Fund contributions keep daily maintenance and renovation stable.</li>
 </ul>
 </SectionCard>
 </div>
 </DonationPageShell>
 );
};

export default DonationCategories;
