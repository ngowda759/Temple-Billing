const buildGradientStops = (segments) => {
  const total = segments.reduce((sum, segment) => sum + Number(segment.value || 0), 0) || 1;
  let cursor = 0;

  return segments
    .map((segment) => {
      const degrees = (Number(segment.value || 0) / total) * 360;
      const start = cursor;
      const end = cursor + degrees;
      cursor = end;
      return `${segment.color} ${start}deg ${end}deg`;
    })
    .join(", ");
};

const AccountantDonutCard = ({
  title,
  subtitle,
  segments = [],
  centerValue,
  centerLabel,
}) => {
  const gradient = buildGradientStops(segments);
  const backgroundStyle = gradient
    ? `conic-gradient(${gradient})`
    : "linear-gradient(135deg, #d97706 0%, #ea580c 100%)";

  return (
    <section className="group relative overflow-hidden rounded-[28px] border border-amber-200 dark:border-amber-700/50/80 bg-gradient-to-br from-white/95 via-amber-50/40 to-white/90 p-7 backdrop-blur-2xl shadow-xl shadow-amber-950/5 transition-all duration-300 hover:-translate-y-1.5 hover:border-amber-400 hover:shadow-2xl hover:shadow-amber-500/20">
      {/* Decorative vibrant corner glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-amber-400/25 via-orange-400/15 to-transparent blur-3xl transition-opacity duration-500 group-hover:opacity-100 opacity-60" />

      <div className="flex items-center justify-between mb-6 border-b border-amber-100/80 pb-4">
        <div>
          <span className="inline-block rounded-full bg-amber-100/80 dark:bg-amber-900/40 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-700/50/50">
            {subtitle}
          </span>
          <h3 className="mt-2 text-2xl font-black font-serif tracking-tight text-slate-900 dark:text-slate-100">{title}</h3>
        </div>
        <div className="h-2.5 w-2.5 rounded-full bg-amber-50 dark:bg-amber-900/40 dark:border-amber-800/500 animate-pulse shadow-sm shadow-amber-500/50" />
      </div>

      <div className="flex flex-col md:flex-row items-center gap-7">
        {/* Donut graphic */}
        <div className="relative flex h-44 w-44 shrink-0 items-center justify-center rounded-full p-3.5 shadow-2xl shadow-amber-900/10 transition-transform duration-500 group-hover:scale-105" style={{ background: backgroundStyle }}>
          <div className="flex h-30 w-30 flex-col items-center justify-center rounded-full bg-white dark:bg-slate-800/95 backdrop-blur-md text-center shadow-lg border border-amber-100/60 p-2">
            <span className="text-2xl font-black text-slate-900 dark:text-slate-100 leading-none tracking-tight">{centerValue}</span>
            <span className="mt-1 text-[10px] font-bold text-amber-800 dark:text-amber-400/80 uppercase tracking-widest">{centerLabel}</span>
          </div>
        </div>

        {/* Legend list */}
        <div className="w-full space-y-2.5">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className="flex items-center justify-between rounded-2xl bg-white dark:bg-slate-800/90 p-3 shadow-xs border border-amber-100/80 transition-all duration-200 hover:bg-amber-50/60 dark:hover:bg-amber-900/40 dark:bg-amber-900/40 hover:border-amber-300 hover:translate-x-1"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-3.5 w-3.5 rounded-full shrink-0 shadow-sm ring-2 ring-white"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{segment.label}</span>
              </div>
              <span className="rounded-xl bg-amber-100/60 dark:bg-amber-900/40 px-2.5 py-1 text-xs font-extrabold text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50/50">
                {segment.valueText || `${segment.value}%`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AccountantDonutCard;
