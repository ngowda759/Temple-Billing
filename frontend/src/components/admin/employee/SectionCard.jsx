const SectionCard = ({ title, subtitle, children, topRight, className = "" }) => {
 return (
 <div className={`rounded-[32px] border border-white/20 bg-temple-100/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] backdrop-blur-xl shadow-2xl shadow-slate-900/5 p-6 ${className}`}>
 {(title || subtitle || topRight) && (
 <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 {title && <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-200 ">{title}</h2>}
 {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
 </div>
 {topRight && <div>{topRight}</div>}
 </div>
 )}
 {children}
 </div>
 );
};

export default SectionCard;
