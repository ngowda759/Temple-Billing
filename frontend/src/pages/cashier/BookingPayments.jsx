import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt, FaCheckCircle, FaClock, FaSearch } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import {
 createBooking,
 verifyBookingPayment,
 fetchBills,
 fetchBookings,
 formatCurrency,
 formatDateTime,
 isToday,
 sumBy,
} from "../../services/cashierService";
import { getPoojaTypes } from "../../services/poojaTypeService";
import { getPrasadamTypes } from "../../services/prasadamTypeService";
import { useNotifications } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";
import { downloadReceiptPDF } from "../../utils/receiptGenerator";

const emptyForm = {
 devoteeName: "",
 devoteeEmail: "",
 devoteePhone: "",
 cartItems: [],
 datetime: "",
 paymentMethod: "Cash",
 notes: "",
};

const statusStyles = {
 Pending: "bg-[#fff1d7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#9a5a00]",
 Confirmed: "bg-[#def7e3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]",
 Rejected: "bg-[#fee2e2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#b91c1c]",
 Cancelled: "bg-[#fee2e2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#b91c1c]",
};

const buildMinDateTime = () => {
 const now = new Date();
 const year = now.getFullYear();
 const month = String(now.getMonth() + 1).padStart(2, "0");
 const day = String(now.getDate()).padStart(2, "0");
 const hours = String(now.getHours()).padStart(2, "0");
 const minutes = String(now.getMinutes()).padStart(2, "0");
 return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const BookingPayments = () => {
 const navigate = useNavigate();
 const { loadNotifications } = useNotifications();
 const { user } = useAuth();
 const [poojaTypes, setPoojaTypes] = useState([]);
 const [bookings, setBookings] = useState([]);
 const [bills, setBills] = useState([]);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [message, setMessage] = useState("");
 const [query, setQuery] = useState("");
 const [serviceSearch, setServiceSearch] = useState("");
 const [statusFilter, setStatusFilter] = useState("All");
 const [showHistory, setShowHistory] = useState(false);
 const [activeCategory, setActiveCategory] = useState("pooja");
 const [expandedSections, setExpandedSections] = useState({ pooja: false, prasadam: false, room: false });
 const [form, setForm] = useState({
 ...emptyForm,
 datetime: buildMinDateTime(),
 });

 const loadData = async () => {
 setLoading(true);
 try {
 const [bookingRows, billRows, poojaRes] = await Promise.allSettled([fetchBookings(), fetchBills(), getPoojaTypes()]);
 setBookings(bookingRows.status === "fulfilled" ? bookingRows.value : []);
 setBills(billRows.status === "fulfilled" ? billRows.value : []);

 const loadedPoojas = poojaRes.status === "fulfilled" ? (poojaRes.value.poojas || poojaRes.value || []) : [];
 const loadedPrasadams = getPrasadamTypes();
 
 const combinedCatalog = [
 ...loadedPoojas.map(p => ({ ...p, catalogType: "pooja" })),
 ...loadedPrasadams.map(p => ({ ...p, catalogType: "prasadam" })),
 { name: "Standard Room - AC", price: 1500, catalogType: "room" },
 { name: "Standard Room - Non AC", price: 800, catalogType: "room" },
 { name: "Family Suite - AC", price: 2500, catalogType: "room" },
 { name: "Premium Suite - AC", price: 4000, catalogType: "room" },
 { name: "Dormitory Bed", price: 200, catalogType: "room" },
 { name: "Cottage - AC", price: 3000, catalogType: "room" },
 ];
 
 setPoojaTypes(combinedCatalog);

 if (loadedPoojas.length > 0) {
 setForm((prev) => {
 if (prev.service) return prev;
 return {
 ...prev,
 service: loadedPoojas[0].name,
 amount: loadedPoojas[0].price,
 };
 });
 }
 } catch (error) {
 setBookings([]);
 setBills([]);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();

 const syncPoojaTypes = async () => {
 const res = await getPoojaTypes();
 setPoojaTypes(res.poojas || res || []);
 };

 const onStorage = (event) => {
 if (event.key === "poojaTypes") {
 syncPoojaTypes();
 }
 };

 window.addEventListener("storage", onStorage);
 return () => window.removeEventListener("storage", onStorage);
 }, []);

 useEffect(() => {
 if (!poojaTypes.length) return;
 // Removed old auto-select logic to prevent adding a random pooja to the cart automatically
 }, [poojaTypes]);

 const billMap = useMemo(() => {
 const map = new Map();
 bills.forEach((bill) => {
 if (bill?.sourceId) {
 map.set(String(bill.sourceId), bill);
 }
 });
 return map;
 }, [bills]);

 const filteredBookings = useMemo(() => {
 const q = query.trim().toLowerCase();
 return [...bookings]
 .filter((booking) => {
 const matchesStatus = statusFilter === "All" || (booking.status || "Pending") === statusFilter;
 const matchesQuery =
 !q ||
 [booking.devoteeName, booking.devoteeEmail, booking.devoteePhone, booking.service, booking.paymentMethod]
 .filter(Boolean)
 .some((value) => String(value).toLowerCase().includes(q));
 return matchesStatus && matchesQuery;
 })
 .sort((a, b) => new Date(b.createdAt || b.datetime || 0) - new Date(a.createdAt || a.datetime || 0));
 }, [bookings, query, statusFilter]);

 const stats = useMemo(
 () => [
 {
 title: "Today Bookings",
 value: bookings.filter((booking) => isToday(booking.createdAt)).length,
 note: `${bookings.filter((booking) => isToday(booking.createdAt) && (booking.status || "Pending") === "Pending").length} pending`,
 tone: "orange",
 },
 {
 title: "Total Value",
 value: formatCurrency(sumBy(bookings, (booking) => booking.amount)),
 note: `${bookings.length} bookings stored`,
 tone: "gold",
 },
 {
 title: "Confirmed",
 value: bookings.filter((booking) => (booking.status || "Pending") === "Confirmed").length,
 note: "Approved by counter",
 tone: "green",
 },
 {
 title: "Pending",
 value: bookings.filter((booking) => (booking.status || "Pending") === "Pending").length,
 note: "Awaiting approval",
 tone: "blue",
 },
 ],
 [bookings]
 );

 const handleServiceSelect = (service) => {
 setForm((prev) => ({
 ...prev,
 cartItems: [
 ...prev.cartItems,
 {
 type: service.catalogType || "pooja",
 name: service.name,
 date: prev.datetime,
 qty: 1,
 amount: service.price || 0,
 },
 ],
 }));
 };

 const handleRemoveItem = (index) => {
 setForm((prev) => {
 const newItems = [...prev.cartItems];
 newItems.splice(index, 1);
 return { ...prev, cartItems: newItems };
 });
 };

 const totalAmount = useMemo(() => {
 return form.cartItems.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
 }, [form.cartItems]);

 const handleSubmit = async (event) => {
 event.preventDefault();
 setMessage("");

 if (!form.devoteeName.trim() || form.cartItems.length === 0 || totalAmount <= 0) {
 setMessage("Please fill devotee name and add at least one item to the cart.");
 return;
 }

 setSaving(true);
 try {
 const bookingRes = await createBooking({
 devoteeName: form.devoteeName.trim(),
 devoteeEmail: form.devoteeEmail.trim() || undefined,
 devoteePhone: form.devoteePhone.trim() || undefined,
 service: "Multiple Items", // Fallback for schema
 datetime: form.datetime || buildMinDateTime(),
 amount: totalAmount,
 paymentMethod: form.paymentMethod,
 notes: form.notes.trim(),
 status: "Pending",
 isCombined: true,
 items: form.cartItems,
 });

 const { booking: createdBooking, order, key, simulated } = bookingRes;

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
 name: "Temple Pooja Booking",
 description: "Multiple Items Cart",
 order_id: order.id,
 prefill: {
 name: form.devoteeName.trim(),
 email: form.devoteeEmail.trim(),
 contact: form.devoteePhone.trim(),
 },
 handler: async function (resp) {
 try {
 setSaving(true);
 await verifyBookingPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 bookingId: createdBooking._id,
 });

 setForm({
 ...emptyForm,
 datetime: buildMinDateTime(),
 });
 setMessage("Pooja booking saved successfully and paid.");
 await loadData();
 loadNotifications().catch(() => { });

 // Generate Receipt
 const receiptData = {
 isOnline: false,
 receiptNo: createdBooking.bookingNumber || createdBooking.referenceNo || `BK-${Date.now().toString().slice(-6)}`,
 bookingDate: formatDateTime(createdBooking.createdAt || new Date()),
 paymentMode: createdBooking.paymentMethod || form.paymentMethod,
 transactionId: resp.razorpay_payment_id || "-",
 cashierName: user?.name || "Cashier",
 devoteeName: createdBooking.devoteeName || form.devoteeName,
 mobile: createdBooking.devoteePhone || createdBooking.contactNumber || form.devoteePhone || "-",
 email: createdBooking.devoteeEmail || form.devoteeEmail || "-",
 address: createdBooking.address || "-",
 poojaBookings: (createdBooking.items || form.cartItems).map((i, idx) => ({ slNo: idx + 1, name: i.name, date: formatDateTime(i.date || form.datetime), qty: i.qty || 1, amount: i.amount })),
 prasadamOrders: [],
 subTotal: createdBooking.amount || totalAmount,
 templeCharges: 0,
 grandTotal: createdBooking.amount || totalAmount,
 amountInWords: `Rs. ${createdBooking.amount || totalAmount}`,
 devoteeMaterials: [],
 templeMaterials: [],
 notes: [createdBooking.notes || form.notes].filter(Boolean),
 };
 downloadReceiptPDF(receiptData, `receipt-${receiptData.receiptNo}.pdf`).catch(err => console.error("Receipt generation failed", err));

 } catch (err) {
 setMessage("Payment verification failed.");
 console.warn("verify booking payment handler error", err);
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
 datetime: buildMinDateTime(),
 });
 setMessage("Pooja booking saved successfully. The history and bill ledger were updated.");
 await loadData();
 loadNotifications().catch(() => { });

 // Generate Receipt
 const receiptData = {
 isOnline: false,
 receiptNo: createdBooking.bookingNumber || createdBooking.referenceNo || `BK-${Date.now().toString().slice(-6)}`,
 bookingDate: formatDateTime(createdBooking.createdAt || new Date()),
 paymentMode: createdBooking.paymentMethod || form.paymentMethod,
 transactionId: "-",
 cashierName: user?.name || "Cashier",
 devoteeName: createdBooking.devoteeName || form.devoteeName,
 mobile: createdBooking.devoteePhone || createdBooking.contactNumber || form.devoteePhone || "-",
 email: createdBooking.devoteeEmail || form.devoteeEmail || "-",
 address: createdBooking.address || "-",
 poojaBookings: (createdBooking.items || form.cartItems).map((i, idx) => ({ slNo: idx + 1, name: i.name, date: formatDateTime(i.date || form.datetime), qty: i.qty || 1, amount: i.amount })),
 prasadamOrders: [],
 subTotal: createdBooking.amount || totalAmount,
 templeCharges: 0,
 grandTotal: createdBooking.amount || totalAmount,
 amountInWords: `Rs. ${createdBooking.amount || totalAmount}`,
 devoteeMaterials: [],
 templeMaterials: [],
 notes: [createdBooking.notes || form.notes].filter(Boolean),
 };
 downloadReceiptPDF(receiptData, `receipt-${receiptData.receiptNo}.pdf`).catch(err => console.error("Receipt generation failed", err));

 } catch (error) {
 setMessage(error.response?.data?.error || error.response?.data?.message || "Failed to save booking.");
 } finally {
 setSaving(false);
 }
 };

 return (
 <CashierPageShell
 eyebrow="Pooja Bookings"
 image={templeBg}
 imageAlt="Temple pooja booking counter"
 stats={stats}
 actions={
 <>
 <button
 type="button"
 onClick={loadData}
 className="rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Refresh History
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
 onClick={() => navigate("/cashier/billing")}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-95"
 >
 Open Billing
 </button>
 </>
 }
 >
 <div className="w-full">
 {!showHistory ? (
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Admin added services</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Tap a service below to auto-fill the booking form and amount.
 </p>
 </div>
 <FaCalendarAlt className="text-[#f28c18]" size={22} />
 </div>

 <div className="mt-5">
 <label className="block mb-4">
 <span className="mb-2 block text-sm font-bold text-slate-800">Search & Add Services to Cart</span>
 <div className="relative">
 <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-[#f28c18]" />
 <input
 type="text"
 value={serviceSearch}
 onChange={(e) => setServiceSearch(e.target.value)}
 placeholder="Search for pooja, homa, or prasadam..."
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-12 pr-4 text-base outline-none transition focus:border-[#f28c18] focus:ring-2 focus:ring-[#f28c18]/20"
 />
 </div>
 </label>

 <div className="mb-4 flex space-x-2 border-b border-[#f2e7d7] pb-2">
 {["pooja", "prasadam", "room"].map((cat) => (
 <button
 key={cat}
 type="button"
 onClick={() => setActiveCategory(cat)}
 className={`rounded-full px-4 py-2 text-sm font-bold capitalize transition ${
 activeCategory === cat
 ? "bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white shadow-sm"
 : "bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600 hover:bg-[#fff4e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:text-slate-800"
 }`}
 >
 {cat} Booking
 </button>
 ))}
 </div>

 <div className="space-y-5">
 {[activeCategory].map((cat) => {
 const filtered = poojaTypes
 .filter((p) => p.catalogType === cat)
 .filter((p) => p.name.toLowerCase().includes(serviceSearch.toLowerCase()));

 if (filtered.length === 0) {
 return (
 <div key={cat} className="rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-8 text-center text-slate-500">
 No {cat}s found matching "{serviceSearch}"
 </div>
 );
 }

 const isExpanded = expandedSections[cat];
 const displayed = isExpanded ? filtered : filtered.slice(0, 5);

 return (
 <div key={cat} className="rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
 <div className="bg-[#fff4e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between border-b border-[#f2e7d7]">
 <h3 className="font-bold text-slate-800 capitalize">{cat} Booking ({filtered.length})</h3>
 {filtered.length > 5 && (
 <button
 type="button"
 onClick={() => setExpandedSections(prev => ({ ...prev, [cat]: !prev[cat] }))}
 className="text-sm font-bold text-[#f28c18] hover:underline"
 >
 {isExpanded ? "Show Less" : "View All"}
 </button>
 )}
 </div>
 <table className="w-full text-left text-sm">
 <tbody className="divide-y divide-[#f2e7d7]">
 {displayed.map((type) => (
 <tr key={type.name} className="transition hover:bg-[#fff7ec] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <td className="px-4 py-3 font-extrabold text-slate-900 w-1/2">{type.name}</td>
 <td className="px-4 py-3 font-bold text-[#8a5200]">{formatCurrency(type.price)}</td>
 <td className="px-4 py-3 text-right">
 <button
 type="button"
 onClick={() => handleServiceSelect(type)}
 className="rounded-full bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:opacity-90"
 >
 + Add
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 );
 })}
 </div>
 </div>

 <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
 <div className="grid gap-4 md:grid-cols-2">
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Devotee name</span>
 <input
 value={form.devoteeName}
 onChange={(e) => setForm((prev) => ({ ...prev, devoteeName: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Enter devotee name"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Phone number</span>
 <input
 value={form.devoteePhone}
 onChange={(e) => setForm((prev) => ({ ...prev, devoteePhone: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="+91 98765 43210"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Email</span>
 <input
 type="email"
 value={form.devoteeEmail}
 onChange={(e) => setForm((prev) => ({ ...prev, devoteeEmail: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="devotee@email.com"
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Date</span>
 <input
 type="datetime-local"
 min={buildMinDateTime()}
 value={form.datetime}
 onChange={(e) => setForm((prev) => ({ ...prev, datetime: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 />
 <span className="mt-1 block text-xs text-slate-500">Set this date before adding a service above.</span>
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Payment mode</span>
 <select
 value={form.paymentMethod}
 onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 >
 <option>Cash</option>
 <option>UPI</option>
 <option>Card</option>
 <option>Bank Transfer</option>
 <option>Net Banking</option>
 </select>
 </label>
 </div>

 {form.cartItems.length > 0 && (
 <div className="mt-6 overflow-hidden rounded-2xl border border-[#f0c58f] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-sm">
 <div className="border-b border-[#f0c58f] bg-[#fff4e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-bold text-slate-800">
 Cart Items ({form.cartItems.length})
 </div>
 <ul className="divide-y divide-[#f2e7d7]">
 {form.cartItems.map((item, index) => (
 <li key={index} className="flex items-center justify-between px-4 py-3">
 <div>
 <p className="font-bold text-slate-900">{item.name}</p>
 <p className="text-xs font-semibold text-slate-500">
 {item.type.toUpperCase()} • {formatDateTime(item.date)}
 </p>
 </div>
 <div className="flex items-center gap-4">
 <p className="font-bold text-[#8a5200]">{formatCurrency(item.amount)}</p>
 <button
 type="button"
 onClick={() => handleRemoveItem(index)}
 className="text-red-500 hover:text-red-700"
 >
 Remove
 </button>
 </div>
 </li>
 ))}
 </ul>
 <div className="bg-[#fff4e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-right">
 <p className="text-sm font-bold text-slate-600">
 Total Amount: <span className="text-lg text-slate-950">{formatCurrency(totalAmount)}</span>
 </p>
 </div>
 </div>
 )}

 <label className="block">
 <span className="mb-2 block text-sm font-bold text-slate-800">Notes</span>
 <textarea
 rows="4"
 value={form.notes}
 onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18]"
 placeholder="Optional notes for the counter or priest"
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
 {saving ? "Saving..." : "Save Pooja Booking"}
 </button>
 </form>
 </section>
 ) : (
 <div>
 <button
 onClick={() => setShowHistory(false)}
 className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 ← Back to Booking Form
 </button>
 <section className="rounded-[22px] border border-[#f0d3a2] bg-temple-100/95 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm">
 <div className="flex items-center justify-between gap-3">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-950">Booking history</h2>
 <p className="mt-1 text-sm font-medium text-slate-700">
 Saved bookings and matching bill receipts appear here.
 </p>
 </div>
 <div className="flex items-center gap-2 text-sm text-slate-700">
 <FaSearch />
 <input
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search devotee"
 className="w-[170px] rounded-full border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-2 outline-none focus:border-[#f28c18]"
 />
 </div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 {["All", "Pending", "Confirmed", "Rejected", "Cancelled"].map((status) => (
 <button
 key={status}
 type="button"
 onClick={() => setStatusFilter(status)}
 className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${statusFilter === status
 ? "border-[#f28c18] bg-[#fff1df] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#8a5200]"
 : "border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-700 hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 {status}
 </button>
 ))}
 </div>

 <div className="mt-5 overflow-x-auto">
 <table className="w-full min-w-[860px] text-left text-sm">
 <thead className="bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-600">
 <tr>
 <th className="px-4 py-3 font-bold">Receipt</th>
 <th className="px-4 py-3 font-bold">Devotee</th>
 <th className="px-4 py-3 font-bold">Service</th>
 <th className="px-4 py-3 font-bold">Date</th>
 <th className="px-4 py-3 font-bold">Amount</th>
 <th className="px-4 py-3 font-bold">Payment</th>
 <th className="px-4 py-3 font-bold">Status</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
 Loading bookings...
 </td>
 </tr>
 ) : filteredBookings.length ? (
 filteredBookings.map((booking) => {
 const bill = billMap.get(String(booking._id));
 return (
 <tr key={booking._id} className="border-b border-[#f2e7d7]">
 <td className="px-4 py-3 font-bold text-slate-950">{bill?.referenceNo || `BK-${String(booking._id).slice(-6).toUpperCase()}`}</td>
 <td className="px-4 py-3 font-semibold text-slate-800">{booking.devoteeName}</td>
 <td className="px-4 py-3">{booking.service}</td>
 <td className="px-4 py-3 text-slate-700">{formatDateTime(booking.datetime || booking.createdAt)}</td>
 <td className="px-4 py-3 font-bold text-slate-950">{formatCurrency(booking.amount)}</td>
 <td className="px-4 py-3">{booking.paymentMethod || "Cash"}</td>
 <td className="px-4 py-3">
 <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${statusStyles[booking.status || "Pending"] || statusStyles.Pending}`}>
 {(booking.status || "Pending") === "Confirmed" ? <FaCheckCircle /> : <FaClock />}
 {booking.status || "Pending"}
 </span>
 </td>
 </tr>
 );
 })
 ) : (
 <tr>
 <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
 No bookings found. Add a pooja booking from the form on the left.
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
};

export default BookingPayments;
