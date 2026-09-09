import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const receipts = [
 { id: "R-4391", donor: "Ramesh Kumar", amount: "₹5,000", date: "20 May 2026" },
 { id: "R-4407", donor: "Priya Shetty", amount: "₹10,000", date: "19 May 2026" },
 { id: "R-4423", donor: "Suresh Rao", amount: "₹2,500", date: "18 May 2026" },
];

const DonationReceipts = () => {
 return (
 <DonationPageShell
 title="Donation Receipts"
 subtitle="Generate, print and manage temple donation receipts with QR-ready formats."
 >
 <SectionCard title="Recent Receipts" subtitle="Quick access to PDF downloads and email-ready receipts.">
 <div className="space-y-4">
 {receipts.map((receipt) => (
 <div key={receipt.id} className="rounded-3xl border border-white/10 bg-slate-950/10 p-5 flex items-center justify-between gap-4">
 <div>
 <p className="text-sm text-slate-400">{receipt.id}</p>
 <h3 className="text-lg font-semibold text-white">{receipt.donor}</h3>
 </div>
 <div className="text-right">
 <p className="text-amber-300 font-semibold">{receipt.amount}</p>
 <p className="text-sm text-slate-400">{receipt.date}</p>
 </div>
 </div>
 ))}
 </div>
 </SectionCard>
 </DonationPageShell>
 );
};

export default DonationReceipts;
