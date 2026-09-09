import { MdArrowBack } from "react-icons/md";

const formatCurrency = (value) => `Rs ${Number(value || 0).toLocaleString()}`;

const DevoteeDetails = ({ darkMode, devotee, bookings = [], donations = [], onBack }) => {
 const devoteeName = devotee?.name || "Unknown Devotee";
 const devoteeEmail = devotee?.email || "-";

 const devoteeBookings = bookings.filter((b) => (b.devoteeName || "").toLowerCase() === devoteeName.toLowerCase());
 const devoteeDonations = donations.filter((d) => (d.donorName || "").toLowerCase() === devoteeName.toLowerCase());
 const totalDonation = devoteeDonations.reduce((sum, d) => sum + Number(d.amount || 0), 0);

 return (
 <div className="mt-5 space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700">
 <MdArrowBack size={18} /> Back to Devotee List
 </button>
 </div>

 <div>
 <h1 className={`text-[36px] font-bold ${darkMode ? "text-slate-100" : "text-[#17151f]"}`}>Devotee Details</h1>
 <p className={`${darkMode ? "text-slate-300" : "text-[#5c6675]"} text-[17px]`}>Live data from backend</p>
 </div>

 <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
 <div className={`rounded-2xl border p-4 xl:col-span-2 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <h2 className={`text-[28px] font-bold ${darkMode ? "text-slate-100" : "text-[#17151f]"}`}>{devoteeName}</h2>
 <p className={`${darkMode ? "text-slate-300" : "text-gray-700 dark:text-slate-200 "}`}>{devoteeEmail}</p>
 <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600 dark:text-slate-200 "}`}>Role: {devotee?.role || "devotee"}</p>
 </div>

 <div className={`rounded-2xl border p-4 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <p className={`${darkMode ? "text-slate-300" : "text-gray-500 dark:text-slate-200 "} text-sm`}>Total Bookings</p>
 <p className={`text-[36px] font-bold ${darkMode ? "text-slate-100" : "text-[#17151f]"}`}>{devoteeBookings.length}</p>
 </div>

 <div className={`rounded-2xl border p-4 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <p className={`${darkMode ? "text-slate-300" : "text-gray-500 dark:text-slate-200 "} text-sm`}>Total Donations</p>
 <p className={`text-[30px] font-bold ${darkMode ? "text-slate-100" : "text-[#17151f]"}`}>{formatCurrency(totalDonation)}</p>
 </div>
 </div>

 <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
 <div className={`rounded-2xl border p-4 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <h3 className={`text-[22px] font-bold mb-3 ${darkMode ? "text-slate-100" : "text-[#17151f]"}`}>Bookings</h3>
 <div className="overflow-auto">
 <table className="w-full min-w-[520px] text-sm">
 <thead className={`${darkMode ? "text-slate-300" : "text-gray-600 dark:text-slate-200 "}`}>
 <tr>
 <th className="py-2 text-left">Service</th>
 <th className="py-2 text-left">Date/Time</th>
 <th className="py-2 text-left">Amount</th>
 <th className="py-2 text-left">Status</th>
 </tr>
 </thead>
 <tbody>
 {devoteeBookings.map((row) => (
 <tr key={row._id} className={`border-t ${darkMode ? "border-[#334155] text-slate-300" : "border-[#f1ede6] text-gray-700 dark:text-slate-200 "}`}>
 <td className="py-2">{row.service}</td>
 <td className="py-2">{row.datetime}</td>
 <td className="py-2">{formatCurrency(row.amount)}</td>
 <td className="py-2">{row.status || "Pending"}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 <div className={`rounded-2xl border p-4 ${darkMode ? "bg-[#1f2937] border-[#334155]" : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border-[#ece8e1] dark:border-slate-700 "}`}>
 <h3 className={`text-[22px] font-bold mb-3 ${darkMode ? "text-slate-100" : "text-[#17151f]"}`}>Donations / Receipts</h3>
 <div className="overflow-auto">
 <table className="w-full min-w-[520px] text-sm">
 <thead className={`${darkMode ? "text-slate-300" : "text-gray-600 dark:text-slate-200 "}`}>
 <tr>
 <th className="py-2 text-left">Type</th>
 <th className="py-2 text-left">Date</th>
 <th className="py-2 text-left">Amount</th>
 <th className="py-2 text-left">Receipt</th>
 </tr>
 </thead>
 <tbody>
 {devoteeDonations.map((row) => (
 <tr key={row._id} className={`border-t ${darkMode ? "border-[#334155] text-slate-300" : "border-[#f1ede6] text-gray-700 dark:text-slate-200 "}`}>
 <td className="py-2">{row.category || "Donation"}</td>
 <td className="py-2">{new Date(row.createdAt).toLocaleDateString()}</td>
 <td className="py-2">{formatCurrency(row.amount)}</td>
 <td className="py-2">{row._id?.slice(-8)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 </div>
 );
};

export default DevoteeDetails;
