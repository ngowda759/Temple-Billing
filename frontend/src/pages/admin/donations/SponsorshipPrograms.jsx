import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const programs = [
 { title: "Annadanam Sponsor", value: "₹1,20,000", description: "Community meals and feeding programs." },
 { title: "Temple Construction", value: "₹95,000", description: "Major renovation and repairs." },
 { title: "Festival Sponsorship", value: "₹60,000", description: "Navaratri, Deepavali and Rathotsava." },
];

const SponsorshipPrograms = () => {
 return (
 <DonationPageShell
 title="Sponsorship Programs"
 subtitle="Organize premium sponsorship tiers and donor recognition for temple campaigns."
 >
 <div className="grid gap-6 lg:grid-cols-3">
 {programs.map((item) => (
 <div key={item.title} className="rounded-[32px] border border-white/10 bg-slate-950/10 p-6 shadow-2xl shadow-slate-900/10">
 <p className="text-sm uppercase tracking-[0.28em] text-amber-200/80">{item.title}</p>
 <p className="mt-4 text-3xl font-semibold text-white">{item.value}</p>
 <p className="mt-3 text-slate-300">{item.description}</p>
 <button className="mt-6 rounded-3xl bg-amber-400 px-5 py-3 text-slate-950 dark:text-slate-200 font-semibold transition hover:bg-amber-300">
 Manage Program
 </button>
 </div>
 ))}
 </div>
 </DonationPageShell>
 );
};

export default SponsorshipPrograms;
