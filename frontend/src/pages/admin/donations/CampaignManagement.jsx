import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const campaigns = [
 { title: "Temple Renovation", target: "₹5,00,000", raised: "₹3,40,000" },
 { title: "Navaratri Drive", target: "₹2,20,000", raised: "₹1,85,000" },
 { title: "Daily Pooja Fund", target: "₹1,00,000", raised: "₹72,500" },
];

const CampaignManagement = () => {
 return (
 <DonationPageShell
 title="Campaign Management"
 subtitle="Track active campaigns, progress percentages and festival giving momentum."
 >
 <div className="grid gap-6">
 {campaigns.map((item) => (
 <SectionCard key={item.title} title={item.title} subtitle={`Raised ${item.raised} of ${item.target}`} className="overflow-hidden">
 <div className="h-4 overflow-hidden rounded-full bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-300" style={{ width: `${(parseInt(item.raised.replace(/[^0-9]/g, "")) / parseInt(item.target.replace(/[^0-9]/g, "")))*100}%` }} />
 </div>
 </SectionCard>
 ))}
 </div>
 </DonationPageShell>
 );
};

export default CampaignManagement;
