import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const refunds = [
 { donor: "Suresh Rao", request: "Festival Package", amount: "₹2,500", status: "Pending" },
 { donor: "Radha Menon", request: "Temple Booking", amount: "₹1,200", status: "Approved" },
 { donor: "Akash Patel", request: "Donation Reversal", amount: "₹3,500", status: "Review" },
];

const RefundRequests = () => {
 return (
 <DonationPageShell
 title="Refund Requests"
 subtitle="Handle donation reversal workflows with notes, approvals and audit tracking."
 actions={
 <button className="rounded-2xl bg-slate-900/90 px-5 py-3 font-semibold text-white transition hover:bg-slate-800">
 Review Requests
 </button>
 }
 >
 <SectionCard title="Pending Refunds" subtitle="Review and approve refund requests from donors." className="overflow-hidden">
 <div className="space-y-4">
 {refunds.map((item) => (
 <div key={item.donor} className="rounded-3xl border border-white/10 bg-slate-950/10 p-5 flex items-center justify-between gap-4">
 <div>
 <p className="text-sm text-slate-400">{item.request}</p>
 <h3 className="text-lg font-semibold text-white">{item.donor}</h3>
 </div>
 <div className="text-right">
 <p className="text-amber-300 font-semibold">{item.amount}</p>
 <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${item.status === "Approved" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700" : item.status === "Pending" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700" : "bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-orange-700"}`}>
 {item.status}
 </span>
 </div>
 </div>
 ))}
 </div>
 </SectionCard>
 </DonationPageShell>
 );
};

export default RefundRequests;
