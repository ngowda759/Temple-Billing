const StatCard = ({ title, value, note, tone = "orange" }) => {
 const toneStyles = {
 orange: {
 bg: "bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-white/90 border-amber-300/80 text-amber-950",
 glow: "from-amber-400/25 to-orange-500/0",
 pill: "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30",
 valueColor: "text-amber-950 dark:text-amber-100",
 line: "bg-gradient-to-r from-amber-500 to-orange-500",
 },
 gold: {
 bg: "bg-gradient-to-br from-amber-400/10 via-yellow-500/5 to-white/90 border-yellow-300/80 text-yellow-950",
 glow: "from-yellow-400/25 to-amber-500/0",
 pill: "bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-md shadow-amber-600/30",
 valueColor: "text-amber-950 dark:text-yellow-100",
 line: "bg-gradient-to-r from-amber-500 to-yellow-500",
 },
 green: {
 bg: "bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-white/90 border-emerald-300/80 text-emerald-950",
 glow: "from-emerald-400/25 to-teal-500/0",
 pill: "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30",
 valueColor: "text-emerald-950 dark:text-emerald-100",
 line: "bg-gradient-to-r from-emerald-500 to-teal-500",
 },
 blue: {
 bg: "bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-white/90 border-blue-300/80 text-blue-950",
 glow: "from-blue-400/25 to-indigo-500/0",
 pill: "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30",
 valueColor: "text-blue-950 dark:text-blue-100",
 line: "bg-gradient-to-r from-blue-500 to-indigo-500",
 },
 purple: {
 bg: "bg-gradient-to-br from-purple-500/10 via-violet-500/5 to-white/90 border-purple-300/80 text-purple-950",
 glow: "from-purple-400/25 to-violet-500/0",
 pill: "bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-md shadow-purple-500/30",
 valueColor: "text-purple-950 dark:text-purple-100",
 line: "bg-gradient-to-r from-purple-500 to-violet-500",
 },
 };

 const style = toneStyles[tone] || toneStyles.orange;

 return (
 <div className={`group relative overflow-hidden rounded-[24px] border p-6 backdrop-blur-2xl shadow-xl shadow-amber-950/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-amber-500/15 ${style.bg}`}>
 {/* Decorative bright ambient flare */}
 <div className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${style.glow} blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-70`} />
 
 <div className="relative flex flex-col justify-between h-full space-y-3">
 <div className="flex items-center justify-between">
 <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700/80 dark:text-slate-300">{title}</p>
 <div className={`h-2.5 w-2.5 rounded-full shadow-xs ${style.line}`} />
 </div>

 <div>
 <p className={`text-[2rem] md:text-[2.25rem] lg:text-[2.4rem] font-black leading-none tracking-tight break-all ${style.valueColor}`}>
 {value}
 </p>
 </div>

 {note ? (
 <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between">
 <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{note}</p>
 </div>
 ) : null}
 </div>

 {/* Interactive bottom bar */}
 <div className={`absolute bottom-0 left-0 right-0 h-1 ${style.line} opacity-80 group-hover:opacity-100 transition-opacity`} />
 </div>
 );
};

const CashierPageShell = ({
 title,
 eyebrow = "Cashier",
 description,
 image,
 imageAlt = "",
 actions,
 stats = [],
 children,
 accent = "orange",
}) => {
 return (
 <div className="space-y-6 text-slate-950 dark:text-slate-200 ">
 <section className="relative overflow-hidden rounded-[28px] border border-amber-200/80 bg-white/80 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] backdrop-blur-2xl p-6 md:p-8 lg:p-10 shadow-2xl shadow-amber-950/10 transition-all">
 {/* Ambient background glow */}
 <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-amber-400/20 via-orange-400/10 to-transparent blur-3xl" />

 <div className="relative z-10">
 <div className="inline-flex items-center rounded-full border border-amber-300/60 bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-white shadow-md shadow-amber-500/25">
 {eyebrow}
 </div>
 
 {title ? (
 <h1 className="mt-4 text-[2.35rem] md:text-[3rem] lg:text-[3.6rem] font-black font-serif leading-tight text-slate-900 dark:text-slate-200 tracking-tight">
 {title}
 </h1>
 ) : null}
 
 {description ? (
 <p className="mt-3 max-w-3xl text-[1.02rem] md:text-[1.1rem] font-semibold leading-relaxed text-slate-700 dark:text-slate-200 ">
 {description}
 </p>
 ) : null}

 {actions ? (
 <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-amber-100/80 pt-6">
 {actions}
 </div>
 ) : null}

 {stats.length ? (
 <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
 {stats.map((stat) => (
 <StatCard key={stat.title} {...stat} />
 ))}
 </div>
 ) : null}
 </div>
 </section>

 {children}
 </div>
 );
};

export default CashierPageShell;
