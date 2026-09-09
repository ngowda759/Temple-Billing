import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaHeart, FaSearch } from "react-icons/fa";
import axios from "axios";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import {
 createDonation,
 verifyDonationPayment,
 fetchBills,
 fetchDonations,
 fetchEvents,
 formatCurrency,
 formatDateTime,
 isToday,
 sumBy,
} from "../../services/cashierService";
import { getDonationTypes } from "../../services/donationTypeService";
import { useNotifications } from "../../context/NotificationContext";

const emptyForm = {
 donorName: "",
 donorEmail: "",
 contactNumber: "",
 amount: "",
 paymentMethod: "UPI",
 category: "",
 donationMode: "Normal",
 eventId: "",
 notes: "",
};

const statusStyles = {
 Collected: "bg-[#def7e3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]",
 "Not Collected": "bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9a5a00]",
 Completed: "bg-[#def7e3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]",
 Pending: "bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9a5a00]",
 Failed: "bg-[#fee2e2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#b91c1c]",
};

export default function DonationsPage() {
 const navigate = useNavigate();
 const { loadNotifications } = useNotifications();
 const [donationTypes, setDonationTypes] = useState(getDonationTypes());
 const [events, setEvents] = useState([]);
 const [donations, setDonations] = useState([]);
 const [bills, setBills] = useState([]);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [message, setMessage] = useState("");
 const [query, setQuery] = useState("");
 const [modeFilter, setModeFilter] = useState("All");
 const [showHistory, setShowHistory] = useState(false);
 const [form, setForm] = useState(() => ({
 ...emptyForm,
 category: getDonationTypes()[0] || "General",
 }));

 const loadData = async () => {
 setLoading(true);
 try {
 const [donationRows, billRows, eventRows] = await Promise.allSettled([
 fetchDonations(),
 fetchBills(),
 fetchEvents(),
 ]);

 setDonations(donationRows.status === "fulfilled" ? donationRows.value : []);
 setBills(billRows.status === "fulfilled" ? billRows.value : []);
 setEvents(eventRows.status === "fulfilled" ? eventRows.value : []);
 } finally {
 setLoading(false);
 }
 };

 const handleToggleStatus = async (donation) => {
 const nextStatus = donation.status === "Collected" ? "Not Collected" : "Collected";
 try {
 await axios.patch(`http://localhost:5000/api/donations/${donation._id}/status`, { status: nextStatus });
 await loadData();
 } catch (err) {
 console.warn("Failed to update donation status", err);
 }
 };

 useEffect(() => {
 loadData();

 const onStorage = (event) => {
 if (event.key === "donationTypes") {
 setDonationTypes(getDonationTypes());
 }
 };

 window.addEventListener("storage", onStorage);
 return () => window.removeEventListener("storage", onStorage);
 }, []);

 useEffect(() => {
 if (!donationTypes.length) return;
 setForm((prev) => ({
 ...prev,
 category: donationTypes.includes(prev.category) ? prev.category : donationTypes[0],
 }));
 }, [donationTypes]);

 const billMap = useMemo(() => {
 const map = new Map();
 bills.forEach((bill) => {
 if (bill?.sourceId) map.set(String(bill.sourceId), bill);
 });
 return map;
 }, [bills]);

 const festivalCount = useMemo(() => donations.filter((donation) => donation.eventId).length, [donations]);
 const normalCount = useMemo(() => donations.filter((donation) => !donation.eventId).length, [donations]);

 const selectedFestival = useMemo(
 () => events.find((event) => String(event._id) === String(form.eventId)) || null,
 [events, form.eventId]
 );

 const filteredDonations = useMemo(() => {
 const q = query.trim().toLowerCase();
 return [...donations]
 .filter((donation) => {
 const donationMode = donation.eventId ? "Festival" : "Normal";
 const matchesMode = modeFilter === "All" || donationMode === modeFilter;
 const matchesQuery =
 !q ||
 [donation.donorName, donation.donorEmail, donation.contactNumber, donation.category, donation.paymentMethod]
 .filter(Boolean)
 .some((value) => String(value).toLowerCase().includes(q));
 return matchesMode && matchesQuery;
 })
 .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
 }, [donations, query, modeFilter]);

 const stats = useMemo(
 () => [
 {
 title: "Today Donations",
 value: donations.filter((donation) => isToday(donation.createdAt)).length,
 note: `${donations.filter((donation) => isToday(donation.createdAt)).length} records today`,
 tone: "orange",
 },
 {
 title: "Total Amount",
 value: formatCurrency(sumBy(donations, (donation) => donation.amount)),
 note: `${donations.length} donations stored`,
 tone: "gold",
 },
 {
 title: "Festival Donations",
 value: festivalCount,
 note: "Linked with festival events",
 tone: "green",
 },
 {
 title: "Normal Donations",
 value: normalCount,
 note: "Regular counter donations",
 tone: "blue",
 },
 ],
 [donations, festivalCount, normalCount]
 );

 const handleSubmit = async (event) => {
 event.preventDefault();
 setMessage("");

 if (!form.donorName.trim() || Number(form.amount) <= 0) {
 setMessage("Please enter devotee name and a valid donation amount.");
 return;
 }

 if (form.donationMode === "Festival" && !selectedFestival) {
 setMessage("Please choose a festival event for a festival donation.");
 return;
 }

 const category = form.donationMode === "Festival" && selectedFestival ? selectedFestival.title : form.category;
 const notes = [
 form.donationMode === "Festival" ? `Festival donation for ${selectedFestival?.title || "festival"}` : "Normal donation",
 form.category ? `Base type: ${form.category}` : "",
 form.notes.trim(),
 ]
 .filter(Boolean)
 .join(" | ");

 setSaving(true);
 try {
 const donationRes = await createDonation({
 donorName: form.donorName.trim(),
 donorEmail: form.donorEmail.trim() || undefined,
 contactNumber: form.contactNumber.trim() || undefined,
 amount: Number(form.amount),
 category,
 paymentMethod: form.paymentMethod,
 eventId: form.donationMode === "Festival" ? selectedFestival?._id : undefined,
 notes,
 });

 const { donation, order, key, simulated } = donationRes;

 if (!simulated && order) {
 const loadRazorpayScript = () =>
 new Promise((resolve) => {
 if (window.Razorpay) return resolve(true);
 const script = document.createElement("script");
 script.src = "https://checkout.razorpay.com/v1/checkout.js";
 script.onload = () => resolve(true);
 script.onerror = () => resolve(false);
 document.body.appendChild(script);
 });

 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setMessage("Unable to load payment gateway. Try again later.");
 setSaving(false);
 return;
 }

 const options = {
 key: key || "",
 amount: order.amount,
 currency: order.currency,
 name: "Temple Donation",
 description: donation.category,
 order_id: order.id,
 prefill: {
 name: form.donorName.trim(),
 email: form.donorEmail.trim(),
 contact: form.contactNumber.trim(),
 },
 handler: async function (resp) {
 try {
 setSaving(true);
 await verifyDonationPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 donationId: donation._id,
 });

 setForm({
 ...emptyForm,
 category: donationTypes[0] || "General",
 });
 setMessage("Donation saved successfully and paid.");
 await loadData();
 loadNotifications().catch(() => {});
 } catch (err) {
 setMessage("Payment verification failed.");
 console.warn("verify donation payment handler error", err);
 } finally {
 setSaving(false);
 }
 },
 modal: {
 ondismiss: function () {
 setSaving(false);
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 return;
 }

 setForm({
 ...emptyForm,
 category: donationTypes[0] || "General",
 });
 setMessage("Donation saved successfully. The bill ledger and admin reports were updated.");
 await loadData();
 loadNotifications().catch(() => {});
 } catch (error) {
 setMessage(error.response?.data?.error || error.response?.data?.message || "Failed to save donation.");
 } finally {
 setSaving(false);
 }
 };

 return (
 <CashierPageShell
 eyebrow="Donations"
 image={templeBg}
 imageAlt="Temple donation counter"
 stats={stats}
 actions={
 <>
 <button
 type="button"
 onClick={loadData}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Refresh Donations
 </button>
 <button
 type="button"
 onClick={() => setShowHistory((prev) => !prev)}
 className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
 >
 {showHistory ? "Hide History" : "View History"}
 </button>
 <button
 type="button"
 onClick={() => navigate("/cashier/receipts")}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 View Receipts
 </button>
 </>
 }
 >
 <div className="w-full">
 {!showHistory ? (
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Donation entry form</h2>
 </div>
 <FaHeart className="text-[#f28c18]" size={22} />
 </div>

 <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
 <div className="grid gap-4 md:grid-cols-2">
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Devotee name</span>
 <input
 value={form.donorName}
 onChange={(e) => setForm((prev) => ({ ...prev, donorName: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Enter devotee name"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Email</span>
 <input
 type="email"
 value={form.donorEmail}
 onChange={(e) => setForm((prev) => ({ ...prev, donorEmail: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="donor@email.com"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Contact number</span>
 <input
 value={form.contactNumber}
 onChange={(e) => setForm((prev) => ({ ...prev, contactNumber: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="+91 98765 43210"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Donation mode</span>
 <select
 value={form.donationMode}
 onChange={(e) =>
 setForm((prev) => ({
 ...prev,
 donationMode: e.target.value,
 eventId: e.target.value === "Festival" ? prev.eventId : "",
 }))
 }
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 >
 <option value="Normal">Normal</option>
 <option value="Festival">Festival</option>
 </select>
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Donation type</span>
 <select
 value={form.category}
 onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 >
 {donationTypes.map((type) => (
 <option key={type} value={type}>
 {type}
 </option>
 ))}
 </select>
 </label>
 {form.donationMode === "Festival" ? (
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Festival event</span>
 <select
 value={form.eventId}
 onChange={(e) => setForm((prev) => ({ ...prev, eventId: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 >
 <option value="">Select festival event</option>
 {events.map((event) => (
 <option key={event._id} value={event._id}>
 {event.title}
 </option>
 ))}
 </select>
 </label>
 ) : (
 <div className="rounded-2xl border border-[#f1dfc0] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3">
 <p className="text-sm font-bold text-slate-800">Festival link</p>
 <p className="mt-2 text-sm text-slate-600">Use the festival mode toggle if this donation should be linked to an event.</p>
 </div>
 )}
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Amount</span>
 <input
 type="number"
 min="1"
 value={form.amount}
 onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="0"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Payment method</span>
 <select
 value={form.paymentMethod}
 onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 >
 <option>UPI</option>
 <option>Cash</option>
 <option>Card</option>
 <option>Bank Transfer</option>
 <option>Net Banking</option>
 </select>
 </label>
 </div>

 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Notes</span>
 <textarea
 rows="4"
 value={form.notes}
 onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Optional notes for the cashier or donation team"
 />
 </label>

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
 {saving ? "Saving..." : "Save Donation"}
 </button>
 </form>
 </section>
 ) : (
 <div>
 <button
 onClick={() => setShowHistory(false)}
 className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 ← Back to Donation Form
 </button>
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Donation history</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Saved donations and matching bill receipts appear here.
 </p>
 </div>
 <div className="flex items-center gap-2 text-sm text-slate-700">
 <FaSearch />
 <input
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search donor"
 className="w-[170px] rounded-full border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-2 outline-none focus:border-[#f28c18]"
 />
 </div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 {["All", "Normal", "Festival"].map((mode) => (
 <button
 key={mode}
 type="button"
 onClick={() => setModeFilter(mode)}
 className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
 modeFilter === mode
 ? "border-[#f28c18] bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#8a5200]"
 : "border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 {mode}
 </button>
 ))}
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[920px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Donor</th>
 <th className="px-4 py-3 font-bold">Type</th>
 <th className="px-4 py-3 font-bold">Festival</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Date</th>
 <th className="px-4 py-3 font-bold">Status</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="8" className="px-4 py-8 text-center text-slate-500">
 Loading donations...
 </td>
 </tr>
 ) : filteredDonations.length ? (
 filteredDonations.map((donation) => {
 const bill = billMap.get(String(donation._id));
 const festival = donation.eventId ? events.find((event) => String(event._id) === String(donation.eventId)) : null;
 const donationMode = donation.eventId ? "Festival" : "Normal";
 return (
 <tr key={donation._id} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{bill?.referenceNo || `DN-${String(donation._id).slice(-6).toUpperCase()}`}</td>
 <td className="px-4 py-3 font-semibold text-slate-800">{donation.donorName}</td>
 <td className="px-4 py-3">{donation.category}</td>
 <td className="px-4 py-3 text-slate-700">{festival?.title || "Normal"}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(donation.amount)}</td>
 <td className="px-4 py-3">{donation.paymentMethod || "UPI"}</td>
 <td className="px-4 py-3 text-slate-700">{formatDateTime(donation.createdAt)}</td>
 <td className="px-4 py-3">
 <button
 onClick={() => handleToggleStatus(donation)}
 className={`inline-flex rounded-full px-3 py-1 text-xs font-bold transition hover:scale-105 ${statusStyles[donation.status || "Not Collected"] || statusStyles["Not Collected"]}`}
 title="Click to toggle status"
 >
 {donation.status || "Not Collected"}
 </button>
 <p className="mt-1 text-[11px] text-slate-500">{donationMode}</p>
 </td>
 </tr>
 );
 })
 ) : (
 <tr>
 <td colSpan="8" className="px-4 py-8 text-center text-slate-500">
 No donations found. Add a donation from the form on the left.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 )}
 </div>
 </CashierPageShell>
 );
}

