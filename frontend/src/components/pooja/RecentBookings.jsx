const RecentBookings = ({ bookings = [] }) => {
  const displayedBookings = bookings.slice(0, 5);

  const getStatusClass = (status) => {
    if (status === "Confirmed") return "text-green-600";
    if (status === "Pending") return "text-yellow-600";
    if (status === "Cancelled" || status === "Rejected") return "text-rose-600";
    return "text-slate-600";
  };

  if (!displayedBookings.length) {
    return <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">No recent bookings available.</p>;
  }

  return (
    <div className="mt-6 space-y-4">
      {displayedBookings.map((booking) => (
        <div key={booking._id || booking.id || `${booking.service}-${booking.datetime}`} className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 p-4 bg-slate-50 dark:bg-[#0f172a]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{booking.service}</p>
              <p className="text-base text-slate-600 dark:text-slate-300 mt-0.5">{booking.devoteeName}</p>
            </div>
            <div className={`text-lg font-bold ${getStatusClass(booking.status)}`}>{booking.status}</div>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-base text-slate-500 dark:text-slate-400 font-medium">
            <span>{booking.datetime ? new Date(booking.datetime).toLocaleDateString() : "No date"}</span>
            <span>{booking.amount ? `₹${booking.amount}` : "₹0"}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RecentBookings;
