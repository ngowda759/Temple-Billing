export default function Header({ title = "Accountant Dashboard", subtitle = "Financial overview" }) {
	return (
		<header className="mb-6 rounded-3xl bg-slate-900 px-6 py-5 text-white shadow-lg">
			<p className="text-xs uppercase tracking-[0.28em] text-slate-300">Temple Billing System</p>
			<div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="text-3xl font-semibold">{title}</h1>
					<p className="mt-1 text-sm text-slate-300">{subtitle}</p>
				</div>
				<div className="rounded-full bg-temple-100/10 dark:bg-[#0f172a] px-4 py-2 text-sm text-slate-100">Live revenue, receipts, and transactions</div>
			</div>
		</header>
	);
}
