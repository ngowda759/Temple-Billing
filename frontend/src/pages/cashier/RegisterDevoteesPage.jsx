import { useEffect, useState, useMemo } from "react";
import { FaCheckCircle, FaUserPlus, FaSearch, FaUsers, FaEye, FaTimes } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import { registerDevotee, fetchDevotees, fetchBookings, fetchDonations } from "../../services/cashierService";
import { useNotifications } from "../../context/NotificationContext";

const emptyForm = {
 name: "",
 email: "",
 phone: "",
 address: "",
 place: "",
 password: "",
 confirmPassword: "",
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase().replace(/@temple\.local$/, "@gmail.com");

const RegisterDevoteesPage = () => {
 const { loadNotifications } = useNotifications();
 const [form, setForm] = useState(emptyForm);
 const [saving, setSaving] = useState(false);
 const [message, setMessage] = useState("");
 const [devotees, setDevotees] = useState([]);
 const [devoteesLoading, setDevoteesLoading] = useState(false);
 const [searchQuery, setSearchQuery] = useState("");

 const [showAll, setShowAll] = useState(false);
 const [selectedDevotee, setSelectedDevotee] = useState(null);
 const [selectedDevoteeBookings, setSelectedDevoteeBookings] = useState([]);
 const [selectedDevoteeDonations, setSelectedDevoteeDonations] = useState([]);
 const [detailsLoading, setDetailsLoading] = useState(false);

 const loadDevotees = async () => {
 setDevoteesLoading(true);
 try {
 const data = await fetchDevotees();
 setDevotees(data);
 } catch (err) {
 console.error("Failed to load devotees list", err);
 } finally {
 setDevoteesLoading(false);
 }
 };

 useEffect(() => {
 loadDevotees();
 }, []);

 const filteredDevotees = useMemo(() => {
 const q = searchQuery.trim().toLowerCase();
 if (!q) return devotees;
 return devotees.filter((d) =>
 [d.name, d.email, d.phone, d.place].filter(Boolean).some((field) =>
 field.toLowerCase().includes(q)
 )
 );
 }, [devotees, searchQuery]);

 const displayedDevotees = useMemo(() => {
 return showAll ? filteredDevotees : filteredDevotees.slice(0, 5);
 }, [filteredDevotees, showAll]);

 const handleViewDetails = async (devotee) => {
 setSelectedDevotee(devotee);
 setDetailsLoading(true);
 try {
 const [allBookings, allDonations] = await Promise.all([
 fetchBookings(),
 fetchDonations(),
 ]);
 const devoteeName = devotee.name || "";
 const devoteeEmail = devotee.email || "";

 const filteredBookings = allBookings.filter(b => 
 (b.devoteeName && b.devoteeName.toLowerCase() === devoteeName.toLowerCase()) || 
 (b.devoteeEmail && b.devoteeEmail.toLowerCase() === devoteeEmail.toLowerCase())
 );
 const filteredDonations = allDonations.filter(d => 
 (d.donorName && d.donorName.toLowerCase() === devoteeName.toLowerCase()) ||
 (d.devoteeEmail && d.devoteeEmail.toLowerCase() === devoteeEmail.toLowerCase()) ||
 (d.email && d.email.toLowerCase() === devoteeEmail.toLowerCase())
 );
 setSelectedDevoteeBookings(filteredBookings);
 setSelectedDevoteeDonations(filteredDonations);
 } catch (err) {
 console.error("Error fetching devotee history:", err);
 } finally {
 setDetailsLoading(false);
 }
 };

 const handleSubmit = async (event) => {
 event.preventDefault();
 setMessage("");

 if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.place.trim() || !form.address.trim() || !form.password || !form.confirmPassword) {
 setMessage("Please fill all required fields (Name, Email, Phone, Place/City, Address, Password).");
 return;
 }

 const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
 if (!emailRegex.test(form.email.trim())) {
 setMessage("Please enter a valid email address.");
 return;
 }

 if (!/^[0-9]{10}$/.test(form.phone.trim())) {
 setMessage("Phone number must be exactly 10 digits (numbers only).");
 return;
 }

 if (!/^[a-zA-Z\s]+$/.test(form.place.trim())) {
 setMessage("Place/City must contain characters/letters and spaces only.");
 return;
 }

 if (form.password !== form.confirmPassword) {
 setMessage("Passwords do not match.");
 return;
 }

 setSaving(true);
 try {
 await registerDevotee({
 name: form.name.trim(),
 email: normalizeEmail(form.email),
 phone: form.phone.trim(),
 address: form.address.trim(),
 place: form.place.trim(),
 password: form.password,
 confirmPassword: form.confirmPassword,
 role: "devotee",
 });

 setForm(emptyForm);
 setMessage("Devotee registered successfully. They can now log in with the new account.");
 loadNotifications().catch(() => {});
 loadDevotees().catch(() => {});
 } catch (error) {
 setMessage(error.response?.data?.message || "Failed to register devotee.");
 } finally {
 setSaving(false);
 }
 };

 return (
 <CashierPageShell
 eyebrow="Register Devotees"
 image={templeBg}
 imageAlt="Temple devotee registration"
 actions={
 <div className="inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-bold text-slate-900">
 <FaUserPlus className="text-[#f28c18]" />
 Full devotee directory
 </div>
 }
 >
 <div className="max-w-4xl mx-auto">
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <h2 className="text-2xl font-extrabold text-slate-950">New devotee registration</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Fill every required field so the devotee account is ready for bookings and donations.
 </p>

 <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
 <div className="grid gap-4 md:grid-cols-2">
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Full name</span>
 <input
 value={form.name}
 onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Enter full name"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Email address</span>
 <input
 type="email"
 value={form.email}
 onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="devotee@email.com"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Phone number</span>
 <input
 value={form.phone}
 onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="+91 98765 43210"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Place / city</span>
 <input
 value={form.place}
 onChange={(e) => setForm((prev) => ({ ...prev, place: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Enter place or city"
 />
 </label>
 <label className="block md:col-span-2">
 <span className="mb-2 block text-sm font-bold text-slate-800">Address</span>
 <textarea
 rows="4"
 value={form.address}
 onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Enter complete postal address"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Password</span>
 <input
 type="password"
 value={form.password}
 onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Create password"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Confirm password</span>
 <input
 type="password"
 value={form.confirmPassword}
 onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Repeat password"
 />
 </label>
 </div>

 {message ? (
 <div className="rounded-2xl border border-[#f4d0a3] bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-[#8a5200]">
 {message}
 </div>
 ) : null}

 <button
 type="submit"
 disabled={saving}
 className="rounded-2xl bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-base font-extrabold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
 >
 {saving ? "Registering..." : "Register Devotee"}
 </button>
 </form>
 </section>
 </div>

 <section className="mt-8 rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-6 shadow-sm">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Registered Devotees</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Complete directory of all devotee accounts registered in the system. Showing up to 5 by default.
 </p>
 </div>
 <div className="flex items-center gap-2 rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-700">
 <FaSearch />
 <input
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Search by name, email, phone..."
 className="w-[220px] bg-transparent outline-none"
 />
 </div>
 </div>

 <div className="mt-6 overflow-x-auto">
 <table className="w-full min-w-[950px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Name</th>
 <th className="px-4 py-3 font-bold">Email</th>
 <th className="px-4 py-3 font-bold">Phone</th>
 <th className="px-4 py-3 font-bold">Place / City</th>
 <th className="px-4 py-3 font-bold">Address</th>
 <th className="px-4 py-3 font-bold">Registered Date</th>
 <th className="px-4 py-3 font-bold">Actions</th>
 </tr>
 </thead>
 <tbody>
 {devoteesLoading ? (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
 Loading devotees directory...
 </td>
 </tr>
 ) : displayedDevotees.length ? (
 displayedDevotees.map((devotee) => (
 <tr key={devotee._id || devotee.email} className="border-b border-[#f2e7d7] last:border-b-0">
 <td className="px-4 py-3 font-bold text-slate-950">{devotee.name}</td>
 <td className="px-4 py-3 font-semibold text-slate-700">{devotee.email}</td>
 <td className="px-4 py-3 text-slate-800">{devotee.phone || "-"}</td>
 <td className="px-4 py-3 text-slate-800">{devotee.place || "-"}</td>
 <td className="px-4 py-3 text-slate-600 max-w-[280px] truncate" title={devotee.address}>{devotee.address || "-"}</td>
 <td className="px-4 py-3 text-slate-600">
 {devotee.createdAt ? new Date(devotee.createdAt).toLocaleDateString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 }) : "-"}
 </td>
 <td className="px-4 py-3">
 <button
 type="button"
 onClick={() => handleViewDetails(devotee)}
 className="inline-flex items-center gap-1.5 rounded-full bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-[#f0c58f] px-3 py-1.5 text-xs font-bold text-[#8a5200] transition hover:bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:text-white"
 >
 <FaEye /> View
 </button>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
 No devotees found matching the search criteria.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>

 {filteredDevotees.length > 5 && (
 <div className="mt-4 flex justify-center">
 <button
 type="button"
 onClick={() => setShowAll(!showAll)}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 {showAll ? "Show Less" : "View All Devotees"}
 </button>
 </div>
 )}
 </section>

 {/* Devotee Details Modal */}
 {selectedDevotee && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
 <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[28px] border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
 {/* Modal Header */}
 <div className="flex items-center justify-between border-b border-[#f2e7d7] pb-4">
 <div>
 <h3 className="text-2xl font-extrabold text-slate-950">Devotee Details</h3>
 <p className="text-sm font-medium text-slate-600">Complete booking and donation history for this devotee.</p>
 </div>
 <button
 type="button"
 onClick={() => setSelectedDevotee(null)}
 className="rounded-full p-2 text-slate-400 hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:text-[#f28c18] transition"
 >
 <FaTimes size={20} />
 </button>
 </div>

 {/* Modal Body */}
 <div className="mt-6 space-y-6">
 {/* Profile Card */}
 <div className="grid gap-4 rounded-2xl border border-[#f0c58f] bg-[#fffbf5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 md:grid-cols-2 lg:grid-cols-3">
 <div>
 <span className="text-xs font-bold text-[#8a5200] uppercase tracking-wider">Full Name</span>
 <p className="text-base font-extrabold text-slate-950 mt-0.5">{selectedDevotee.name}</p>
 </div>
 <div>
 <span className="text-xs font-bold text-[#8a5200] uppercase tracking-wider">Email Address</span>
 <p className="text-base font-semibold text-slate-800 mt-0.5">{selectedDevotee.email}</p>
 </div>
 <div>
 <span className="text-xs font-bold text-[#8a5200] uppercase tracking-wider">Phone Number</span>
 <p className="text-base text-slate-800 mt-0.5">{selectedDevotee.phone || "-"}</p>
 </div>
 <div>
 <span className="text-xs font-bold text-[#8a5200] uppercase tracking-wider">Place / City</span>
 <p className="text-base text-slate-800 mt-0.5">{selectedDevotee.place || "-"}</p>
 </div>
 <div className="md:col-span-2 lg:col-span-2">
 <span className="text-xs font-bold text-[#8a5200] uppercase tracking-wider">Address</span>
 <p className="text-base text-slate-700 mt-0.5">{selectedDevotee.address || "-"}</p>
 </div>
 </div>

 {/* Lists Section */}
 <div className="grid gap-6 md:grid-cols-2">
 {/* Bookings */}
 <div className="rounded-2xl border border-[#f2e7d7] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4">
 <h4 className="text-lg font-bold text-slate-950 border-b border-[#f2e7d7] pb-2 flex items-center justify-between">
 <span>Bookings</span>
 <span className="rounded-full bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2 py-0.5 text-xs font-bold text-[#8a5200]">
 {detailsLoading ? "..." : selectedDevoteeBookings.length}
 </span>
 </h4>
 <div className="mt-3 max-h-[250px] overflow-y-auto space-y-2">
 {detailsLoading ? (
 <p className="text-sm text-slate-500 py-4 text-center">Loading history...</p>
 ) : selectedDevoteeBookings.length ? (
 selectedDevoteeBookings.map((b) => (
 <div key={b._id} className="rounded-xl border border-[#f2e7d7] p-3 text-xs bg-[#fffaf5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <div className="flex justify-between font-bold text-slate-900">
 <span>{b.service}</span>
 <span className="text-[#8a5200]">Rs {b.amount || b.price}</span>
 </div>
 <div className="flex justify-between mt-1 text-slate-600 font-medium">
 <span>{new Date(b.datetime || b.bookingDate).toLocaleDateString("en-IN")}</span>
 <span className={`px-2 py-0.5 rounded-full text-[10px] ${
 String(b.status).toLowerCase() === "confirmed" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800" : "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-800"
 }`}>{b.status || "Pending"}</span>
 </div>
 </div>
 ))
 ) : (
 <p className="text-sm text-slate-500 py-4 text-center">No bookings found.</p>
 )}
 </div>
 </div>

 {/* Donations */}
 <div className="rounded-2xl border border-[#f2e7d7] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4">
 <h4 className="text-lg font-bold text-slate-950 border-b border-[#f2e7d7] pb-2 flex items-center justify-between">
 <span>Donations & Receipts</span>
 <span className="rounded-full bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2 py-0.5 text-xs font-bold text-[#8a5200]">
 {detailsLoading ? "..." : selectedDevoteeDonations.length}
 </span>
 </h4>
 <div className="mt-3 max-h-[250px] overflow-y-auto space-y-2">
 {detailsLoading ? (
 <p className="text-sm text-slate-500 py-4 text-center">Loading history...</p>
 ) : selectedDevoteeDonations.length ? (
 selectedDevoteeDonations.map((d) => (
 <div key={d._id} className="rounded-xl border border-[#f2e7d7] p-3 text-xs bg-[#fffaf5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <div className="flex justify-between font-bold text-slate-900">
 <span>{d.donationType || d.category || "General Donation"}</span>
 <span className="text-[#8a5200]">Rs {d.amount}</span>
 </div>
 <div className="flex justify-between mt-1 text-slate-600 font-medium">
 <span>{new Date(d.createdAt || d.donationDate).toLocaleDateString("en-IN")}</span>
 <span>{d.paymentMethod || "UPI"}</span>
 </div>
 </div>
 ))
 ) : (
 <p className="text-sm text-slate-500 py-4 text-center">No donations found.</p>
 )}
 </div>
 </div>
 </div>
 </div>

 {/* Modal Footer */}
 <div className="mt-6 border-t border-[#f2e7d7] pt-4 flex justify-end">
 <button
 type="button"
 onClick={() => setSelectedDevotee(null)}
 className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
 >
 Close Details
 </button>
 </div>
 </div>
 </div>
 )}
 </CashierPageShell>
 );
};

export default RegisterDevoteesPage;
