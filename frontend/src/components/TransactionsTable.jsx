const sampleTransactions = [
	{ receipt: "RCPT-24018", devotee: "Ananya Sharma", amount: "₹2,500", status: "Paid" },
	{ receipt: "RCPT-24019", devotee: "Ravi Patel", amount: "₹1,100", status: "Pending" },
	{ receipt: "RCPT-24020", devotee: "Meera Iyer", amount: "₹350", status: "Paid" },
];

export default function TransactionsTable() {
	return (
		<section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] p-5 shadow-sm">
			<div className="mb-4 flex items-center justify-between gap-3">
				<div>
					<h2 className="text-xl font-semibold text-slate-900 dark:text-slate-200">Recent transactions</h2>
					<p className="text-sm text-slate-500">Latest cashier entries and payment status.</p>
				</div>
			</div>
			<div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
				<table className="min-w-full divide-y divide-slate-200 text-left text-sm">
					<thead className="bg-slate-50 dark:bg-[#0f172a] text-slate-500">
						<tr>
							<th className="px-4 py-3 font-medium">Receipt</th>
							<th className="px-4 py-3 font-medium">Devotee</th>
							<th className="px-4 py-3 font-medium">Amount</th>
							<th className="px-4 py-3 font-medium">Status</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100 bg-temple-100 dark:bg-[#0f172a]">
						{sampleTransactions.map((transaction) => (
							<tr key={transaction.receipt}>
								<td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-200">{transaction.receipt}</td>
								<td className="px-4 py-3 text-slate-700 dark:text-slate-200">{transaction.devotee}</td>
								<td className="px-4 py-3 text-slate-700 dark:text-slate-200">{transaction.amount}</td>
								<td className="px-4 py-3 text-slate-700 dark:text-slate-200">{transaction.status}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
