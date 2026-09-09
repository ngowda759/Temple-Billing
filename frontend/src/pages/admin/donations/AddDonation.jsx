import { useEffect, useState } from "react";
import axios from "axios";
import SectionCard from "../../../components/admin/employee/SectionCard";
import DonationPageShell from "../../../components/admin/donations/DonationPageShell";
import { getDonationTypes } from "../../../services/donationTypeService";

const paymentMethods = ["Cash", "UPI", "Debit Card", "Credit Card", "Net Banking"];

const AddDonation = () => {
 const [donorName, setDonorName] = useState("");
 const [contactNumber, setContactNumber] = useState("");
 const [categories, setCategories] = useState(getDonationTypes());
 const [category, setCategory] = useState(categories[0] || "General");
 const [amount, setAmount] = useState("");
 const [method, setMethod] = useState(paymentMethods[1]);
 const [transactionId, setTransactionId] = useState("");
 const [notes, setNotes] = useState("");
 const [isSaving, setIsSaving] = useState(false);

 const isValidContactNumber = (value) => {
 if (!value) return true;
 return /^\+?[0-9\s-]{7,15}$/.test(value.trim());
 };

 const isValidAmount = (value) => {
 const parsed = Number(String(value).replace(/[^0-9.-]+/g, ""));
 return !Number.isNaN(parsed) && parsed > 0;
 };

 const loadDonationTypes = () => {
 const savedTypes = getDonationTypes();
 setCategories(savedTypes);
 setCategory((current) => (savedTypes.includes(current) ? current : savedTypes[0] || "General"));
 };

 useEffect(() => {
 loadDonationTypes();
 const handleStorage = (event) => {
 if (event.key === "donationTypes") {
 loadDonationTypes();
 }
 };

 window.addEventListener("storage", handleStorage);
 return () => window.removeEventListener("storage", handleStorage);
 }, []);

 const handleSubmit = async (event) => {
 event.preventDefault();

 if (!donorName.trim()) {
 alert("Please enter donor name.");
 return;
 }

 if (!amount.trim() || !isValidAmount(amount)) {
 alert("Please enter a valid donation amount.");
 return;
 }

 if (!isValidContactNumber(contactNumber)) {
 alert("Please provide a valid contact number.");
 return;
 }

 if (method !== "Cash" && !transactionId.trim()) {
 alert("Please enter a Transaction ID for online payments.");
 return;
 }

 try {
 setIsSaving(true);
 // Devotee side filters donations by donorEmail, so we must send it.
 // If you don't have a dedicated UI for selecting donor, use the logged-in user email (if available)
 // or leave blank (devotee won't see the donation).
 const donorEmail = (localStorage.getItem("user") && JSON.parse(localStorage.getItem("user") || "{}").email) ? JSON.parse(localStorage.getItem("user") || "{}").email : "";

 const res = await axios.post("http://localhost:5000/api/donations", {
 donorName: donorName.trim(),
 donorEmail: donorEmail ? String(donorEmail).toLowerCase().trim() : undefined,
 contactNumber: contactNumber.trim(),
 amount,
 category,
 paymentMethod: method,
 transactionId: transactionId.trim(),
 notes: notes.trim(),
 });

 if (res.data?.success) {
 alert("Donation saved successfully.");
 setDonorName("");
 setContactNumber("");
 setAmount("");
 setCategory(categories[0] || "General");
 setMethod(paymentMethods[1]);
 setTransactionId("");
 setNotes("");
 } else {
 alert(res.data?.message || "Unable to save donation.");
 }
 } catch (error) {
 console.error(error);
 alert(error.response?.data?.message || "Donation save failed.");
 } finally {
 setIsSaving(false);
 }
 };

 return (
 <DonationPageShell
 title="Add Donation"
 subtitle="Create a premium temple donation entry with receipt previews, validation and transaction capture."
 actions={
 <button className="rounded-2xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-3 font-semibold text-slate-950 dark:text-slate-200 transition hover:bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 Generate Receipt
 </button>
 }
 >
 <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
 <SectionCard title="Donation Entry Form" subtitle="Fill donor details, donation type and payment information." className="space-y-6">
 <div className="grid gap-4 md:grid-cols-2">
 <label className="block text-sm text-slate-700 dark:text-slate-200 ">
 Donor Name
 <input
 value={donorName}
 onChange={(e) => setDonorName(e.target.value)}
 className="mt-2 w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 placeholder="Enter donor name"
 />
 </label>
 <label className="block text-sm text-slate-700 dark:text-slate-200 ">
 Contact Number
 <input
 type="tel"
 value={contactNumber}
 onChange={(e) => setContactNumber(e.target.value)}
 className="mt-2 w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 placeholder="+91 98765 43210"
 />
 </label>
 <label className="block text-sm text-slate-700 dark:text-slate-200 ">
 Donation Type
 <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
 <select
 value={category}
 onChange={(e) => setCategory(e.target.value)}
 className="flex-1 rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 >
 {categories.map((option) => (
 <option key={option} value={option}>
 {option}
 </option>
 ))}
 </select>
 <button
 type="button"
 onClick={loadDonationTypes}
 className="rounded-3xl border border-amber-300 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-amber-900 font-bold transition hover:bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
 >
 Refresh Types
 </button>
 </div>
 </label>
 <label className="block text-sm text-slate-700 dark:text-slate-200 font-medium">
 Amount
 <input
 value={amount}
 onChange={(e) => setAmount(e.target.value)}
 className="mt-2 w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 placeholder="₹ 12,500"
 />
 </label>
 </div>

 <div className="grid gap-4 md:grid-cols-2">
 <label className="block text-sm text-slate-700 dark:text-slate-200 font-medium">
 Payment Method
 <select
 value={method}
 onChange={(e) => setMethod(e.target.value)}
 className="mt-2 w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 >
 {paymentMethods.map((option) => (
 <option key={option} value={option}>
 {option}
 </option>
 ))}
 </select>
 </label>
 <label className="block text-sm text-slate-700 dark:text-slate-200 font-medium">
 UPI Transaction ID
 <input
 value={transactionId}
 onChange={(e) => setTransactionId(e.target.value)}
 className="mt-2 w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 placeholder="UPI123456789"
 />
 </label>
 </div>

 <label className="block text-sm text-slate-700 dark:text-slate-200 font-medium">
 Notes
 <textarea
 value={notes}
 onChange={(e) => setNotes(e.target.value)}
 className="mt-2 w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none"
 rows="4"
 placeholder="Donation notes, sponsorship details or receipt remarks."
 />
 </label>

 <button
 onClick={handleSubmit}
 disabled={isSaving}
 className="rounded-3xl bg-amber-600 px-6 py-3 font-extrabold text-white transition hover:bg-amber-700 shadow-md disabled:cursor-not-allowed disabled:opacity-60"
 >
 {isSaving ? "Saving..." : "Save Donation"}
 </button>
 </SectionCard>

 <SectionCard title="Live Preview" subtitle="This donation entry will generate a receipt and verification flow." className="space-y-5">
 <div className="rounded-[28px] border border-amber-200/60 bg-amber-50/60 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 text-slate-800 dark:text-slate-200 shadow-xs">
 <div className="flex items-center justify-between">
 <span className="text-xs uppercase tracking-[0.3em] font-extrabold text-amber-800">Donation Receipt</span>
 <span className="rounded-full bg-amber-200 dark:bg-[#0f172a] px-3 py-1 text-xs font-black text-amber-950 border border-amber-300">Draft</span>
 </div>
 <div className="mt-5 space-y-2">
 <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 ">Donor: <span className="font-extrabold text-slate-900 dark:text-slate-200 ">{donorName || "Ramesh Kumar"}</span></p>
 <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 ">Amount: <span className="font-extrabold text-amber-700">{amount ? amount : "₹5,000"}</span></p>
 <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 ">Type: <span className="font-extrabold text-slate-900 dark:text-slate-200 ">{category}</span></p>
 <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 ">Payment: <span className="font-extrabold text-slate-900 dark:text-slate-200 ">{method}</span></p>
 </div>
 </div>

 <div className="rounded-[28px] border border-amber-200/60 bg-amber-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm font-bold text-slate-800 dark:text-slate-200 ">Support Material</p>
 <div className="mt-3 grid gap-3">
 <button className="rounded-2xl border border-amber-300 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-left text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">Upload QR image</button>
 <button className="rounded-2xl border border-amber-300 bg-white dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-left text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">Upload payment screenshot</button>
 </div>
 </div>
 </SectionCard>
 </div>
 </DonationPageShell>
 );
};

export default AddDonation;
