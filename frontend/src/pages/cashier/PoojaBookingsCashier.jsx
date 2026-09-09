import { useEffect, useMemo, useState } from "react";
import { FaCalendarAlt, FaHeart, FaInfoCircle, FaRegClock } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import { getPoojaTypes } from "../../services/poojaTypeService";
import { createDevoteeBooking, getDevoteeBookings, markNotificationAsRead } from "../../services/devoteeService";
import { getDevoteeNotifications } from "../../services/devoteeService";

// Service layer abstraction (UI will stay unchanged when backend pooja catalog is added)
async function getPoojaServices() {
 const res = await getPoojaTypes();
 return res.poojas || res || [];
}

const formatDateTimeLocalValue = (d) => {
 // yyyy-MM-dd
 const pad = (n) => String(n).padStart(2, "0");
 const yyyy = d.getFullYear();
 const mm = pad(d.getMonth() + 1);
 const dd = pad(d.getDate());
 return `${yyyy}-${mm}-${dd}`;
};

const parseDateTimeLocalToISO = (value) => {
 // value: yyyy-MM-ddTHH:mm
 const d = new Date(value);
 if (Number.isNaN(d.getTime())) return null;
 return d.toISOString();
};

const formatDisplayDateTime = (isoOrDate) => {
 try {
 const d = new Date(isoOrDate);
 if (Number.isNaN(d.getTime())) return isoOrDate ? String(isoOrDate) : "--";
 return d.toLocaleString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 });
 } catch {
 return "--";
 }
};

const getMobileValidity = (value) => {
 // very light validation: 10 digits (Indian)
 const digits = String(value || "").replace(/\D/g, "");
 if (!digits) return true; // optional
 return digits.length >= 10 && digits.length <= 15;
};

// NOTE: This page must NOT use CashierShell, because CashierDashboard owns the sidebar
// and we want the sidebar background to remain identical when switching menu items.

const CashierPoojaBookings = () => {

 const navigate = useNavigate();

 const user = useMemo(() => {
 try {
 return JSON.parse(localStorage.getItem("user"));
 } catch {
 return null;
 }
 }, []);

 const email = user?.email ? String(user.email).toLowerCase() : "";

 const [poojaServices, setPoojaServices] = useState([]);
 const [selectedPoojaName, setSelectedPoojaName] = useState("");
 const [priests, setPriests] = useState([]);
 const [assignedPriest, setAssignedPriest] = useState("");

 const [dateTime, setDateTime] = useState(() => {
 const d = new Date();
 d.setMinutes(d.getMinutes() + 30);
 return formatDateTimeLocalValue(d);
 });
 const [paymentMethod, setPaymentMethod] = useState("UPI");
 const [contactNumber, setContactNumber] = useState("");
 const [notes, setNotes] = useState("");
 const [selectedTempleMaterials, setSelectedTempleMaterials] = useState([]);
 const [prepAcknowledged, setPrepAcknowledged] = useState(false);

 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");

 const [bookings, setBookings] = useState([]);
 const [loadingBookings, setLoadingBookings] = useState(false);

 const [notifications, setNotifications] = useState([]);
 const [loadingNotifications, setLoadingNotifications] = useState(false);
 const unreadCount = useMemo(() => notifications.filter((n) => n && n.read === false).length, [notifications]);

 const selectedPooja = useMemo(() => {
 return poojaServices.find((p) => p.name === selectedPoojaName) || null;
 }, [poojaServices, selectedPoojaName]);

 const minDateTime = useMemo(() => {
 const d = new Date();
 // disable past: round up to next 5 minutes
 d.setSeconds(0, 0);
 d.setMinutes(d.getMinutes() + 5);
 return formatDateTimeLocalValue(d);
 }, []);

 const loadPoojas = async () => {
 const list = await getPoojaServices();
 const active = Array.isArray(list)
 ? list
 : [];

 // normalize to required fields
 const normalized = active
 .map((p) => ({
 _id: p?._id || p?.id || p?.name,
 name: p?.name,
 price: Number(p?.price) || 0,
 description: p?.description || "",
 status: p?.status || "active",
 requiredMaterials: p?.requiredMaterials || [],
 availableDays: p?.availableDays || [],
 availableDates: p?.availableDates || [],
 }))
 .filter((p) => p.name && p.price > 0);

 setPoojaServices(normalized);

 if (!selectedPoojaName && normalized.length) {
 setSelectedPoojaName(normalized[0].name);
 setSelectedTempleMaterials([]);
 setPrepAcknowledged(false);
 }
 };

 const loadBookings = async () => {
 setLoadingBookings(true);
 try {
 const data = await getDevoteeBookings(email);
 const list = data?.bookings || data || [];
 setBookings(Array.isArray(list) ? list : []);
 } catch {
 setBookings([]);
 } finally {
 setLoadingBookings(false);
 }
 };

 const loadNotifications = async () => {
 setLoadingNotifications(true);
 try {
 const data = await getDevoteeNotifications(email);
 const list = data?.notifications || data?.notifications || data || [];
 setNotifications(Array.isArray(list) ? list : []);
 } catch {
 setNotifications([]);
 } finally {
 setLoadingNotifications(false);
 }
 };

 const loadPriests = async () => {
 try {
 const API_BASE = "http://localhost:5000/api";
 const res = await axios.get(`${API_BASE}/priest/priests-list`);
 setPriests(res.data || []);
 } catch (e) {
 console.error("Failed to load priests", e);
 }
 };

 useEffect(() => {
 // fetch services + my bookings + notifications + priests
 loadPoojas();
 loadBookings();
 loadNotifications();
 loadPriests();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 const bookingSummary = useMemo(() => {
 const iso = parseDateTimeLocalToISO(dateTime);
 let amount = selectedPooja ? Number(selectedPooja.price) : 0;
 if (selectedPooja && selectedPooja.requiredMaterials) {
 selectedPooja.requiredMaterials.forEach(rm => {
 const itemId = typeof rm.item === 'object' ? rm.item?._id : rm.item;
 if (selectedTempleMaterials.includes(itemId)) {
 amount += (Number(rm.templeCharge) || 0);
 }
 });
 }
 return {
 service: selectedPooja?.name || "--",
 date: iso ? formatDisplayDateTime(iso) : "--",
 amount: selectedPooja ? `₹ ${amount}` : "--",
 payment: paymentMethod || "--",
 totalAmount: amount,
 };
 }, [selectedPooja, dateTime, paymentMethod, selectedTempleMaterials]);

 const handleSubmit = async (e) => {
 e.preventDefault();
 setError("");

 if (!selectedPooja) {
 setError("Please select a pooja service.");
 return;
 }

 const iso = parseDateTimeLocalToISO(dateTime);
 if (!iso) {
 setError("Please choose a valid date & time.");
 return;
 }

 // Advance Preparation Validation
 const prepRequired = (selectedPooja?.requiredMaterials || []).filter(m => m.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED");
 if (prepRequired.length > 0 && !prepAcknowledged) {
 setError("Please acknowledge the preparation instructions.");
 return;
 }

 const minAdvanceDays = selectedPooja?.minimumAdvanceBookingDays || 0;
 const maxPrepDays = prepRequired.reduce((max, rm) => Math.max(max, rm.preparationDaysBeforePooja || 0), 0);
 const effectiveMinDays = Math.max(minAdvanceDays, maxPrepDays);

 if (effectiveMinDays > 0) {
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 const selectedDate = new Date(iso);
 selectedDate.setHours(0, 0, 0, 0);
 
 const diffTime = Math.abs(selectedDate - today);
 const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
 
 if (diffDays < effectiveMinDays) {
 if (selectedPooja?.strictAdvancePreparation) {
 setError(`This Pooja requires at least ${effectiveMinDays} days of advance notice/preparation. Please select an eligible later date.`);
 return;
 } else {
 // It will just be marked for temple approval on the backend
 }
 }
 }

 // Validate available days and dates
 const d = new Date(iso);
 const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
 const dateString = iso.split("T")[0];
 const isDayAllowed = selectedPooja.availableDays?.includes("Everyday") || selectedPooja.availableDays?.includes(dayName);
 const isDateAllowed = selectedPooja.availableDates?.includes(dateString);

 if (!isDayAllowed && !isDateAllowed) {
 setError(`The selected Pooja is not available on this date. Available Days: ${selectedPooja.availableDays?.join(', ')}`);
 return;
 }

 const mobileOk = getMobileValidity(contactNumber);
 if (!mobileOk) {
 setError("Please enter a valid contact number.");
 return;
 }

 setLoading(true);
 try {
 const payload = {
 devoteeName: user?.name || "Cashier",
 devoteeEmail: email,
 devoteePhone: contactNumber || undefined,
 service: selectedPooja.name,
 datetime: iso,
 amount: bookingSummary.totalAmount,
 paymentMethod,
 contactNumber: contactNumber || undefined,
 notes: notes || undefined,
 assignedPriest: assignedPriest || undefined,
 selectedTempleMaterials,
 };

 await createDevoteeBooking(payload);

 // Refresh bookings + notifications (real-time-ish)
 await loadBookings();
 await loadNotifications();

 // Keep form selection, but reset notes
 setNotes("");
 setSelectedTempleMaterials([]);
 setPrepAcknowledged(false);
 } catch (err) {
 setError(err?.response?.data?.error || err?.message || "Failed to create booking.");
 } finally {
 setLoading(false);
 }
 };

 const handleMarkAllRead = async () => {
 // best-effort: mark first batch as read
 const unread = notifications.filter((n) => n && n.read === false);
 if (!unread.length) return;

 try {
 await Promise.all(
 unread.slice(0, 20).map((n) => markNotificationAsRead(n._id || n.id))
 );
 } catch {
 // ignore
 }
 await loadNotifications();
 };

 return (
 <div style={{ padding: 0 }}>
 <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
 {/* Left: Booking form 70% */}
 <div style={{ flex: 7, minWidth: 0 }}>
 <div className="cashier-booking-page">
 <div className="bbm-hero-card">
 <div>
 <h2 className="bbm-hero-title">🛕 Pooja Bookings</h2>
 <p className="bbm-hero-sub">Book services for devotees with a temple-first experience.</p>
 </div>
 </div>

 <form className="bbm-grid" onSubmit={handleSubmit}>
 <div className="bbm-form-card">
 <div className="bbm-card-header">
 <h3>Booking Form</h3>
 <span className="bbm-badge">Light Orange Temple Theme</span>
 </div>

 {error ? (
 <div className="bbm-error">
 <FaInfoCircle />
 <span>{error}</span>
 </div>
 ) : null}

 <div className="bbm-field">
 <label>Service</label>
 <select
 value={selectedPoojaName}
 onChange={(e) => {
 setSelectedPoojaName(e.target.value);
 setSelectedTempleMaterials([]);
 setPrepAcknowledged(false);
 }}
 disabled={!poojaServices.length || loading}
 >
 {poojaServices.length ? (
 poojaServices.map((p) => (
 <option key={p._id || p.name} value={p.name}>
 {p.name} ₹ {p.price}	
 </option>
 ))
 ) : (
 <option value="">No active poojas</option>
 )}
 </select>
 </div>

 {(() => {
 if (!selectedPooja || !selectedPooja.requiredMaterials || selectedPooja.requiredMaterials.length === 0) return null;
 
 const reqMats = Array.isArray(selectedPooja.requiredMaterials) ? selectedPooja.requiredMaterials : [];
 
 const templeProvides = reqMats.filter(m => m.responsibilityType === "TEMPLE_PROVIDES");
 const devoteeMustBring = reqMats.filter(m => m.responsibilityType === "DEVOTEE_MUST_BRING");
 const prepRequired = reqMats.filter(m => m.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED");
 const orTemple = reqMats.filter(m => m.responsibilityType === "DEVOTEE_OR_TEMPLE");
 
 return (
 <div className="bbm-field">
 <label>Pooja Materials Requirement</label>
 <div className="mt-1 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-xl border border-amber-200 p-3 space-y-3">
 {templeProvides.length > 0 && (
 <div>
 <div className="text-teal-800 text-xs font-bold mb-1 border-b border-teal-200 pb-1">Temple Will Provide</div>
 {templeProvides.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="flex justify-between py-1 text-xs text-amber-900">
 <span>{rm.qty} {rm.unit} {item.name}</span>
 </div>
 );
 })}
 </div>
 )}

 {devoteeMustBring.length > 0 && (
 <div>
 <div className="text-blue-800 text-xs font-bold mb-1 border-b border-blue-200 pb-1">Devotee Must Bring</div>
 {devoteeMustBring.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="flex justify-between py-1 text-xs text-amber-900">
 <span>{rm.qty} {rm.unit} {item.name} {rm.mandatory && <span className="text-red-500">*</span>}</span>
 </div>
 );
 })}
 </div>
 )}

 {orTemple.length > 0 && (
 <div>
 <div className="text-green-800 text-xs font-bold mb-1 border-b border-green-200 pb-1">Temple Can Arrange (Optional)</div>
 {orTemple.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="flex items-center justify-between py-1.5 text-xs text-amber-900">
 <span>{rm.qty} {rm.unit} {item.name} {rm.mandatory && <span className="text-red-500">*</span>}</span>
 <label className="flex items-center gap-2 cursor-pointer bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-green-200 hover:bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg transition-colors">
 <input 
 type="checkbox"
 checked={selectedTempleMaterials.includes(item._id)}
 onChange={(e) => {
 if (e.target.checked) {
 setSelectedTempleMaterials(prev => [...prev, item._id]);
 } else {
 setSelectedTempleMaterials(prev => prev.filter(id => id !== item._id));
 }
 }}
 className="accent-green-600 w-3.5 h-3.5 cursor-pointer"
 />
 <span className="font-bold">Arrange (+₹{rm.templeCharge})</span>
 </label>
 </div>
 );
 })}
 </div>
 )}

 {prepRequired.length > 0 && (
 <div>
 <div className="text-orange-800 text-xs font-bold mb-1 border-b border-orange-200 pb-1">Advance Preparation Required</div>
 {prepRequired.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="py-2 text-xs bg-orange-100/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-lg p-2 mb-2 text-amber-900">
 <div className="flex justify-between font-bold mb-1">
 <span>{rm.qty} {rm.unit} {item.name} {rm.mandatory && <span className="text-red-500">*</span>}</span>
 <span className="text-orange-700">{rm.preparationDaysBeforePooja} Days</span>
 </div>
 <div className="mb-1"><span className="font-semibold text-orange-800">Instructions:</span> {rm.preparationInstructions}</div>
 </div>
 );
 })}
 <label className="flex items-center gap-2 mt-2 cursor-pointer bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-orange-300 p-2 rounded text-xs font-bold text-orange-900">
 <input type="checkbox" checked={prepAcknowledged} onChange={(e) => setPrepAcknowledged(e.target.checked)} className="accent-orange-600 w-4 h-4" />
 Advise devotee about prep instructions
 </label>
 </div>
 )}
 </div>
 </div>
 );
 })()}

 <div className="bbm-field">
 <label>Date</label>
 <input
 type="date"
 value={dateTime}
 min={minDateTime}
 onChange={(e) => {
 const val = e.target.value;
 if (!val) {
 setDateTime("");
 return;
 }
 
 const selectedType = poojaTypes.find((t) => t.name === service);
 if (selectedType && selectedType.availableDays && selectedType.availableDays.length > 0) {
 const isEveryday = selectedType.availableDays.some(d => d.toLowerCase() === "everyday");
 if (!isEveryday) {
 const dateObj = new Date(val);
 const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
 const dayName = daysOfWeek[dateObj.getDay()];
 
 if (!selectedType.availableDays.includes(dayName)) {
 toast.error(`${selectedType.name} is only available on: ${selectedType.availableDays.join(", ")}`);
 setDateTime("");
 return;
 }
 }
 }
 setDateTime(val);
 }}
 />
 </div>

 <div className="bbm-field">
 <label>Amount</label>
 <input type="text" value={bookingSummary.amount} readOnly />
 </div>

 <div className="bbm-field">
 <label>Payment Method</label>
 <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
 <option value="UPI">UPI</option>
 <option value="Cash">Cash</option>
 <option value="Card">Card</option>
 <option value="Net Banking">Net Banking</option>
 </select>
 </div>

 <div className="bbm-field">
 <label>Contact Number (Optional)</label>
 <input
 type="tel"
 value={contactNumber}
 onChange={(e) => setContactNumber(e.target.value)}
 placeholder="Enter mobile number"
 />
 </div>

 <div className="bbm-field">
 <label>Notes (Optional)</label>
 <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
 </div>

 <div className="bbm-field">
 <label>Assign Priest (Optional)</label>
 <select
 value={assignedPriest}
 onChange={(e) => setAssignedPriest(e.target.value)}
 >
 <option value="">-- No Priest Assigned --</option>
 {priests.map((p) => (
 <option key={p._id} value={p._id}>
 {p.name}
 </option>
 ))}
 </select>
 </div>

 <button className="bbm-submit" type="submit" disabled={loading || !poojaServices.length}>
 {loading ? "Booking..." : "Book Pooja"}
 </button>

 <div className="bbm-hint">
 <FaRegClock /> Future dates only. Past dates are disabled.
 </div>
 </div>

 {/* Right inside form card area (30%) */}
 <div className="bbm-sidebar-card">
 <div className="bbm-sidebar-section">
 <div className="bbm-sidebar-title">
 <FaHeart /> Popular Pooja Services
 </div>

 {poojaServices.length ? (
 <div className="bbm-pooja-list">
 {poojaServices.map((p) => {
 const active = p.name === selectedPoojaName;
 return (
 <button
 key={p._id || p.name}
 type="button"
 className={`bbm-pooja-item ${active ? "is-selected" : ""}`}
 onClick={() => setSelectedPoojaName(p.name)}
 >
 <div className="bbm-pooja-name">{p.name}</div>
 <div className="bbm-pooja-price">₹ {p.price}</div>
 </button>
 );
 })}
 </div>
 ) : (
 <div className="bbm-empty">No poojas available.</div>
 )}
 </div>

 <div className="bbm-sidebar-section">
 <div className="bbm-sidebar-title">Booking Summary</div>
 <div className="bbm-summary">
 <div className="bbm-summary-row">
 <span className="k">Service</span>
 <span className="v">{bookingSummary.service}</span>
 </div>
 <div className="bbm-summary-row">
 <span className="k">Date</span>
 <span className="v">{bookingSummary.date}</span>
 </div>
 <div className="bbm-summary-row">
 <span className="k">Amount</span>
 <span className="v">{bookingSummary.amount}</span>
 </div>
 <div className="bbm-summary-row">
 <span className="k">Payment</span>
 <span className="v">{bookingSummary.payment}</span>
 </div>
 </div>
 </div>

 <div className="bbm-sidebar-section">
 <div className="bbm-sidebar-title">Notifications</div>
 <div className="bbm-notif-top">
 <span className="bbm-notif-badge">Unread: {unreadCount}</span>
 <button type="button" className="bbm-mark-btn" onClick={handleMarkAllRead}>
 Mark all read
 </button>
 </div>
 </div>
 </div>
 </form>

 <div className="bbm-history-card">
 <div className="bbm-card-header">
 <h3>My Booking History</h3>
 <span className="bbm-badge">{loadingBookings ? "Loading..." : `${bookings.length} bookings`}</span>
 </div>

 {bookings.length ? (
 <div className="bbm-history-table">
 <table>
 <thead>
 <tr>
 <th>Booking ID</th>
 <th>Pooja Name</th>
 <th>Date & Time</th>
 <th>Amount</th>
 <th>Payment</th>
 <th>Status</th>
 <th>Created</th>
 </tr>
 </thead>
 <tbody>
 {bookings.map((b) => (
 <tr key={b._id || b.id}>
 <td>{b._id || b.id || "--"}</td>
 <td>{b.service || "--"}</td>
 <td>{formatDisplayDateTime(b.datetime)}</td>
 <td>₹ {b.amount ?? "--"}</td>
 <td>{b.paymentMethod || "--"}</td>
 <td>
 <span className={`bbm-status ${String(b.status || "Pending").toLowerCase()}`}>{b.status || "Pending"}</span>
 </td>
 <td>{formatDisplayDateTime(b.createdAt || b.created)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 ) : (
 <div className="bbm-empty">No bookings found.</div>
 )}
 </div>
 </div>
 </div>
 </div>

 {/* Inline styles for this page to keep theme consistent without touching global dashboard CSS heavily */}
 <style>{`
 .cashier-booking-page{ background:transparent; }
 .bbm-hero-card{
 background:#FFFFFF;
 border-radius:24px;
 box-shadow: 0 2px 10px rgba(0,0,0,0.05);
 padding:22px 24px;
 margin-bottom:16px;
 border:1px solid rgba(255,140,0,0.15);
 }
 .bbm-hero-title{ color:#3D2B1F; font-family: 'Cinzel', serif; font-size:28px; font-weight:800; }
 .bbm-hero-sub{ color:#6B5B4D; margin-top:6px; font-size:14px; }

 .bbm-grid{ display:grid; grid-template-columns: 70% 30%; gap:16px; }
 @media(max-width: 1100px){ .bbm-grid{ grid-template-columns:1fr; } }

 .bbm-form-card{
 background:#FFFFFF;
 border-radius:22px;
 box-shadow: 0 2px 10px rgba(0,0,0,0.05);
 border:1px solid rgba(255,140,0,0.15);
 padding:18px;
 }

 .bbm-sidebar-card{
 background:transparent;
 display:flex;
 flex-direction:column;
 gap:16px;
 }

 .bbm-sidebar-section{
 background:#FFFFFF;
 border-radius:22px;
 box-shadow: 0 2px 10px rgba(0,0,0,0.05);
 border:1px solid rgba(255,140,0,0.15);
 padding:16px;
 }

 .bbm-card-header{ display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
 .bbm-card-header h3{ font-size:16px; font-weight:800; color:#3D2B1F; }
 .bbm-badge{ background:#FFF7ED; border:1px solid #FFEDD5; color:#EA580C; font-weight:800; font-size:11px; padding:4px 10px; border-radius:999px; }

 .bbm-field{ margin-bottom:12px; }
 .bbm-field label{ display:block; font-size:12px; font-weight:800; color:#6B5B4D; margin-bottom:6px; }
 .bbm-field input, .bbm-field select, .bbm-field textarea{
 width:100%;
 border:1px solid #F1E2C7;
 background:#FFF;
 border-radius:14px;
 padding:10px 12px;
 outline:none;
 font-size:13px;
 color:#3D2B1F;
 }

 .bbm-submit{
 width:100%;
 border:none;
 background:#0F766E;
 color:#FFF;
 font-weight:900;
 padding:12px 14px;
 border-radius:16px;
 cursor:pointer;
 box-shadow: 0 8px 20px rgba(15,118,110,0.18);
 margin-top:8px;
 }
 .bbm-submit:disabled{ opacity:0.6; cursor:not-allowed; }

 .bbm-hint{ margin-top:10px; font-size:12px; color:#6B5B4D; display:flex; gap:8px; align-items:center; }

 .bbm-pooja-list{ display:flex; flex-direction:column; gap:10px; }
 .bbm-pooja-item{
 width:100%;
 text-align:left;
 border:1px solid rgba(255,140,0,0.18);
 background:#FFFDF8;
 border-radius:16px;
 padding:12px;
 cursor:pointer;
 transition: all .2s ease;
 display:flex;
 justify-content:space-between;
 align-items:center;
 }
 .bbm-pooja-item:hover{ transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }
 .bbm-pooja-item.is-selected{
 border-color:#FF8A00;
 background:#FFF3E0;
 box-shadow: 0 10px 25px rgba(255,138,0,0.18);
 }
 .bbm-pooja-name{ font-weight:900; color:#3D2B1F; }
 .bbm-pooja-price{ color:#EA580C; font-weight:900; }

 .bbm-summary{ display:flex; flex-direction:column; gap:10px; margin-top:6px; }
 .bbm-summary-row{ display:flex; justify-content:space-between; gap:12px; }
 .bbm-summary-row .k{ font-size:12px; color:#6B5B4D; font-weight:700; }
 .bbm-summary-row .v{ font-size:12px; color:#3D2B1F; font-weight:900; text-align:right; }

 .bbm-notif-top{ display:flex; justify-content:space-between; align-items:center; gap:10px; }
 .bbm-notif-badge{ background:#FFF7ED; border:1px solid #FFEDD5; color:#EA580C; border-radius:999px; padding:6px 10px; font-weight:900; font-size:12px; }
 .bbm-mark-btn{ border:none; background:rgba(15,118,110,0.1); color:#0F766E; font-weight:900; padding:8px 10px; border-radius:14px; cursor:pointer; }

 .bbm-history-card{
 margin-top:16px;
 background:#FFFFFF;
 border-radius:22px;
 box-shadow: 0 2px 10px rgba(0,0,0,0.05);
 border:1px solid rgba(255,140,0,0.15);
 padding:18px;
 }

 .bbm-history-table{ overflow-x:auto; }
 .bbm-history-table table{ width:100%; border-collapse:collapse; min-width:780px; }
 .bbm-history-table th{ text-align:left; font-size:12px; color:#6B5B4D; padding:10px 10px; border-bottom:1px solid #F1E2C7; }
 .bbm-history-table td{ font-size:12px; color:#3D2B1F; padding:12px 10px; border-bottom:1px solid #F8EEE0; }

 .bbm-status{ font-weight:900; font-size:11px; padding:6px 10px; border-radius:999px; display:inline-block; }
 .bbm-status.pending{ background:#FEF3C7; color:#D97706; }
 .bbm-status.approved{ background:#DCFCE7; color:#15803D; }
 .bbm-status.rejected{ background:#FEF2F2; color:#991B1B; }
 .bbm-status.completed{ background:#EFF6FF; color:#2563EB; }

 .bbm-empty{ color:#6B5B4D; font-weight:800; padding:18px 8px; }
 .bbm-error{ display:flex; gap:10px; align-items:center; background:#FEF2F2; border:1px solid #FCA5A5; color:#991B1B; padding:10px 12px; border-radius:16px; margin-bottom:12px; font-weight:900; font-size:13px; }
 `}</style>
 </div>
 );
};

export default CashierPoojaBookings;



