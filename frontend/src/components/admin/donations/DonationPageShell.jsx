const DonationPageShell = ({ title, subtitle, actions, children }) => {
 return (
 <div className="space-y-6 mt-5">
 <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-r from-[#230e45] via-[#5c3191] to-[#c38d24] p-8 text-white shadow-2xl shadow-violet-900/25">
 <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.14),transparent_30%)]" />
 <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <div>
 <p className="text-sm uppercase tracking-[0.32em] text-amber-200/80">Donation Management</p>
 <h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1>
 <p className="mt-3 max-w-2xl text-slate-200/80">{subtitle}</p>
 </div>
 {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
 </div>
 </div>
 <div className="space-y-6">{children}</div>
 </div>
 );
};

export default DonationPageShell;
