import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const paymentQueue = [
 { donor: "Kavitha Nair", amount: "₹4,200", method: "UPI", status: "Pending" },
 { donor: "Sanjay Varma", amount: "₹8,750", method: "Net Banking", status: "Review" },
 { donor: "Anjali Rao", amount: "₹2,400", method: "Credit Card", status: "Pending" },
];

const PaymentVerification = () => {
 return (
 <DonationPageShell
 title="Payment Verification"
 subtitle="Approve and review UPI transfers, screenshot evidence and pending donations."
 actions={
 <button className="rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 dark:text-slate-200 transition hover:bg-amber-300">
 Review Queue
 </button>
 }
 >
 <SectionCard title="Verification Queue" subtitle="Manual verification with fraud alerts and payment notes." className="overflow-hidden">
 <div className="space-y-4">
 {paymentQueue.map((item) => (
 <div key={item.donor} className="rounded-3xl border border-white/10 bg-slate-950/10 p-5 flex items-center justify-between gap-4">
 <div>
 <h3 className="text-lg font-semibold text-white">{item.donor}</h3>
 <p className="text-sm text-slate-400">{item.method} • {item.amount}</p>
 </div>
 <span className={`rounded-full px-3 py-1 text-sm font-semibold ${item.status === "Pending" ? "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700" : "bg-orange-200 text-orange-800"}`}>
 {item.status}
 </span>
 </div>
 ))}
 </div>
 </SectionCard>
 </DonationPageShell>
 );
};

export default PaymentVerification;
