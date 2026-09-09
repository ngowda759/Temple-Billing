export default function Navbar({ children }) {
	return (
		<nav className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] px-4 py-3 shadow-sm">
			<div>
				<p className="text-sm font-semibold text-slate-900 dark:text-slate-200">Temple Billing System</p>
				<p className="text-xs text-slate-500">Navigation</p>
			</div>
			<div className="flex items-center gap-3">{children}</div>
		</nav>
	);
}
