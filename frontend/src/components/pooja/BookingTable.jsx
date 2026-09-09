const BookingTable = ({ rows = [] }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-[#f8f6f2] dark:bg-[#0f172a] text-left text-gray-600">
          <tr>
            <th className="px-4 py-3">Pooja</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.name}-${row.date}`} className="border-t">
              <td className="px-4 py-3 font-semibold">{row.name}</td>
              <td className="px-4 py-3">{row.date}</td>
              <td className="px-4 py-3">{row.amount}</td>
              <td className="px-4 py-3">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default BookingTable;
