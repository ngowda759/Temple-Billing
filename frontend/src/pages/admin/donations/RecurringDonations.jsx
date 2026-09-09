import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const recurringPlans = [
 { donor: "Anita Desai", amount: "₹2,000", schedule: "Monthly", next: "01 Jun 2026" },
 { donor: "Ravi Chandran", amount: "₹1,500", schedule: "Quarterly", next: "15 Jul 2026" },
 { donor: "Meera Iyer", amount: "₹3,000", schedule: "Monthly", next: "12 Jun 2026" },
];

const RecurringDonations = () => {
 return (
 <DonationPageShell
 title="Recurring Donations"
 subtitle="Monitor subscription-style giving and schedule reminders for recurring donors."
 >
 <SectionCard title="Active Recurring Plans" subtitle="Subscription analytics for temple donors." className="overflow-hidden">
 <div className="space-y-4">
 {recurringPlans.map((plan) => (
 <div key={plan.donor} className="rounded-3xl border border-white/10 bg-slate-950/10 p-5">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h3 className="text-lg font-semibold text-white">{plan.donor}</h3>
 <p className="text-slate-400">{plan.schedule} · Next payment {plan.next}</p>
 </div>
 <p className="text-amber-300 font-semibold">{plan.amount}</p>
 </div>
 </div>
 ))}
 </div>
 </SectionCard>
 </DonationPageShell>
 );
};

export default RecurringDonations;
