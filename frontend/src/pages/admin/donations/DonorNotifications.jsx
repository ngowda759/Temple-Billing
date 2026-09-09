import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const notifications = [
 { subject: "Thank you message", time: "2m ago" },
 { subject: "Festival reminder", time: "1h ago" },
 { subject: "Receipt delivered", time: "4h ago" },
];

const DonorNotifications = () => {
 return (
 <DonationPageShell
 title="Donor Notifications"
 subtitle="Send donation confirmations, festival alerts and follow-up messages to temple donors."
 actions={
 <button className="rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 dark:text-slate-200 transition hover:bg-amber-300">
 New Notification
 </button>
 }
 >
 <SectionCard title="Recent Notifications" subtitle="Message history and acknowledgement tracking." className="space-y-4">
 {notifications.map((item) => (
 <div key={item.subject} className="rounded-3xl border border-white/10 bg-slate-950/10 p-5 flex items-center justify-between">
 <div>
 <h3 className="font-semibold text-white">{item.subject}</h3>
 <p className="text-sm text-slate-400">{item.time}</p>
 </div>
 <button className="rounded-full bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm text-white">View</button>
 </div>
 ))}
 </SectionCard>
 </DonationPageShell>
 );
};

export default DonorNotifications;
