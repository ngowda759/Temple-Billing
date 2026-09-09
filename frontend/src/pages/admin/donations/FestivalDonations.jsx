import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const festivals = [
 { name: "Navaratri", amount: "₹1,12,000" },
 { name: "Ganesh Chaturthi", amount: "₹83,500" },
 { name: "Deepavali", amount: "₹1,45,000" },
];

const FestivalDonations = () => {
 return (
 <DonationPageShell
 title="Festival Donations"
 subtitle="Special dashboards for festival giving, campaign health and donor applause."
 >
 <div className="grid gap-6 lg:grid-cols-3">
 {festivals.map((festival) => (
 <div key={festival.name} className="rounded-[32px] border border-white/10 bg-slate-950/10 p-6 shadow-2xl shadow-slate-900/10">
 <p className="text-sm uppercase tracking-[0.3em] text-amber-200/80">{festival.name}</p>
 <p className="mt-4 text-4xl font-semibold text-white">{festival.amount}</p>
 <p className="mt-3 text-slate-300">Festival donation collection this season.</p>
 </div>
 ))}
 </div>
 </DonationPageShell>
 );
};

export default FestivalDonations;
