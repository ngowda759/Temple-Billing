export default function DonationForm() {
	return (
		<form className="space-y-4 rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] p-5 shadow-sm">
			<div>
				<label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Donor name</label>
				<input className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 px-4 py-3 outline-none focus:border-orange-400" type="text" />
			</div>
			<div>
				<label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Amount</label>
				<input className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 px-4 py-3 outline-none focus:border-orange-400" type="text" />
			</div>
			<button type="button" className="rounded-2xl bg-orange-500 px-4 py-3 font-semibold text-white">
				Save donation
			</button>
		</form>
	);
}
