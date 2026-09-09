import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const donors = [
 { name: "Ramesh Kumar", amount: "₹50,000", tier: "Gold Sponsor", contributions: "12 donations" },
 { name: "Priya Shetty", amount: "₹35,000", tier: "Silver Sponsor", contributions: "8 donations" },
 { name: "Suresh Rao", amount: "₹28,000", tier: "Festival Patron", contributions: "6 donations" },
];

const DonorManagement = () => {
 return (
 <DonationPageShell
 title="Donor Management"
 subtitle="Track donor profiles, lifetime giving, and communication history for high-value supporters."
 >
 <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
 <SectionCard title="Top Donor Profiles" subtitle="Profiles with total amount, engagement and recognition tags.">
 <div className="space-y-4">
 {donors.map((donor) => (
 <div key={donor.name} className="rounded-[28px] border border-white/10 bg-slate-950/10 p-5">
 <div className="flex items-start justify-between gap-4">
 <div>
 <h3 className="text-xl font-semibold text-white">{donor.name}</h3>
 <p className="text-sm text-slate-400">{donor.contributions}</p>
 </div>
 <span className="rounded-full bg-amber-400 px-3 py-1 text-sm font-semibold text-slate-950 dark:text-slate-200 ">{donor.tier}</span>
 </div>
 <p className="mt-4 text-3xl font-semibold text-amber-200">{donor.amount}</p>
 </div>
 ))}
 </div>
 </SectionCard>

 <SectionCard title="Contact Insights" subtitle="Store donor contact details and festival participation history.">
 <div className="rounded-[28px] border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 text-slate-200">
 <p className="text-sm text-amber-200">Donor profiles contain address, phone, email and receipt history.</p>
 <ul className="mt-4 space-y-3 text-slate-300">
 <li>Top donor badges for festival sponsors.</li>
 <li>Lifetime donation totals and recurring gifts.</li>
 <li>Communication log with email and SMS history.</li>
 </ul>
 </div>
 </SectionCard>
 </div>
 </DonationPageShell>
 );
};

export default DonorManagement;
