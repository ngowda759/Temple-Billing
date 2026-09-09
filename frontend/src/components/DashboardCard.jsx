const DashboardCard = ({
  title,
  amount,
  icon,
  trend,
  trendUp = true,
  trendLabel = "from yesterday",
  accent = "bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25",
  hideTrend = false,
}) => {
  const trendTextColor = trendUp ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50" : "text-rose-700 bg-rose-50 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50";
  const trendPrefix = trendUp ? "↑" : "↓";

  return (
    <div className="group relative overflow-hidden rounded-[24px] border border-amber-200/60 dark:border-slate-700 bg-white/80 dark:bg-slate-800/95 p-6 backdrop-blur-xl shadow-lg shadow-amber-950/5 dark:shadow-slate-950/40 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-amber-600/15 hover:border-amber-400/80">
      {/* Decorative ambient corner glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-amber-400/15 to-orange-500/0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-50" />
      
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className={`flex h-13 w-13 items-center justify-center rounded-2xl text-2xl transition-transform duration-300 group-hover:scale-110 ${accent}`}>
            {icon}
          </div>
          {!hideTrend && trend != null && trend !== "" && (
            <div className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold shadow-xs ${trendTextColor}`}>
              <span>{trendPrefix}</span>
              <span>{trend}</span>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900/60 dark:text-slate-300 mb-1">{title}</h3>
          <h1 className="text-[28px] md:text-[34px] font-black leading-tight text-slate-900 dark:text-slate-100 tracking-tight">{amount}</h1>
        </div>
      </div>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
};

export default DashboardCard;

