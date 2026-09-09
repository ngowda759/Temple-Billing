import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";

const QRUPIDonations = () => {
 return (
 <DonationPageShell
 title="QR & UPI Donations"
 subtitle="Temple UPI QR management with payment tracking and scan-ready receipts."
 >
 <div className="grid gap-6 lg:grid-cols-2">
 <SectionCard title="Temple QR Code" subtitle="Share the temple UPI QR code with devotees and sponsors." className="flex items-center justify-center py-10">
 <div className="rounded-3xl bg-slate-950/10 p-8 text-center">
 <div className="h-64 w-64 rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " />
 <p className="mt-4 text-slate-300">QR code placeholder</p>
 </div>
 </SectionCard>

 <SectionCard title="Payment Options" subtitle="Accept donations through multiple UPI and bank channels.">
 <ul className="space-y-3 text-slate-200">
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">Google Pay</li>
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">PhonePe</li>
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">Paytm</li>
 <li className="rounded-3xl border border-white/10 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">BHIM UPI</li>
 </ul>
 </SectionCard>
 </div>
 </DonationPageShell>
 );
};

export default QRUPIDonations;
