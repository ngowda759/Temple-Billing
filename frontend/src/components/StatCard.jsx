const colorClasses = {
	green: "border-emerald-200 bg-emerald-50 text-emerald-700",
	red: "border-rose-200 bg-rose-50 text-rose-700",
	orange: "border-amber-200 bg-amber-50 text-amber-700",
	blue: "border-sky-200 bg-sky-50 text-sky-700",
	slate: "border-slate-200 bg-slate-50 text-slate-700",
};

export default function StatCard({ title, value, color = "slate" }) {
	return (
		<article className={`rounded-3xl border p-5 shadow-sm ${colorClasses[color] || colorClasses.slate}`}>
			<p className="text-sm font-medium opacity-80">{title}</p>
			<p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-200">{value}</p>
		</article>
	);
}
