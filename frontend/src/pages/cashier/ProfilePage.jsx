import { useEffect, useState } from "react";
import { FaLock, FaSave, FaUserCircle, FaEnvelope, FaPhone, FaMapMarkerAlt, FaTint, FaCalendarAlt, FaShieldAlt } from "react-icons/fa";
import templeBg from "../../assets/temple-bg.jpg";
import CashierPageShell from "../../components/cashier/CashierPageShell";
import { useAuth } from "../../context/AuthContext";
import {
 changeCashierPassword,
 loadCashierProfile,
 saveCashierProfile,
} from "../../services/cashierService";

const emptyProfile = {
 name: "",
 email: "",
 phone: "",
 address: "",
 bloodGroup: "",
 dob: "",
 emergencyContact: "",
 photo: "",
 bankName: "",
 accountNumber: "",
};

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const bankOptions = [
 "State Bank of India (SBI)",
 "HDFC Bank",
 "ICICI Bank",
 "Axis Bank",
 "Punjab National Bank (PNB)",
 "Bank of Baroda",
 "Canara Bank",
 "Union Bank of India",
 "Kotak Mahindra Bank",
 "IndusInd Bank",
 "Other",
];

const ProfilePage = () => {
 const { user, updateUser } = useAuth();
 const [profile, setProfile] = useState(null);
 const [profileForm, setProfileForm] = useState(emptyProfile);
 const [passwordForm, setPasswordForm] = useState({
 currentPassword: "",
 newPassword: "",
 confirmPassword: "",
 });
 const [loading, setLoading] = useState(true);
 const [savingProfile, setSavingProfile] = useState(false);
 const [savingPassword, setSavingPassword] = useState(false);
 const [message, setMessage] = useState("");
 const [messageType, setMessageType] = useState("info"); // "info" | "success" | "error"
 const [errors, setErrors] = useState({});

 const userId = user?.id || user?._id || "";

 const loadProfile = async () => {
 setLoading(true);
 try {
 const response = await loadCashierProfile(userId);
 const loadedProfile = response?.profile || response?.data?.profile || null;
 const authUser = response?.authUser || response?.data?.authUser || {};
 const nextProfile = loadedProfile || {};

 setProfile(nextProfile);
 setProfileForm({
 name: nextProfile.name || authUser.name || user?.name || "",
 email: nextProfile.email || authUser.email || user?.email || "",
 phone: nextProfile.phone || "",
 address: nextProfile.address || "",
 bloodGroup: nextProfile.bloodGroup || "",
 dob: nextProfile.dob || "",
 emergencyContact: nextProfile.emergencyContact || "",
 photo: nextProfile.photo || "",
 bankName: nextProfile.bankName || "",
 accountNumber: nextProfile.accountNumber || "",
 });
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 if (!userId) {
 setLoading(false);
 return;
 }
 loadProfile();
 }, [userId]);

 const validateField = (field, value) => {
 let error = "";
 if (field === "name") {
 const trimmed = value.trim();
 if (!trimmed) {
 error = "Name is required.";
 } else {
 const nameRegex = /^[a-zA-Z\s.-]+$/;
 if (!nameRegex.test(trimmed)) {
 error = "Name can only contain letters, spaces, dots, and hyphens.";
 }
 }
 } else if (field === "email") {
 const trimmed = value.trim();
 if (!trimmed) {
 error = "Email is required.";
 } else {
 const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 if (!emailRegex.test(trimmed)) {
 error = "Please enter a valid email address.";
 }
 }
 } else if (field === "phone") {
 const trimmed = value.trim();
 if (trimmed) {
 const phoneRegex = /^\d{10}$/;
 if (!phoneRegex.test(trimmed)) {
 error = "Phone number must be exactly 10 digits.";
 }
 }
 } else if (field === "emergencyContact") {
 const trimmed = value.trim();
 if (trimmed) {
 const phoneRegex = /^\d{10}$/;
 if (!phoneRegex.test(trimmed)) {
 error = "Emergency contact must be exactly 10 digits.";
 }
 }
 } else if (field === "dob") {
 if (value) {
 const dobDate = new Date(value);
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 if (dobDate >= today) {
 error = "Date of birth must be a past date.";
 }
 }
 } else if (field === "bloodGroup") {
 if (value && !BLOOD_GROUPS.includes(value)) {
 error = "Please select a valid blood group.";
 }
 } else if (field === "bankName") {
 if (!value || value.trim() === "") {
 error = "Bank Name is required.";
 }
 } else if (field === "accountNumber") {
 const trimmed = value.trim();
 if (!trimmed || !/^[0-9]{9,18}$/.test(trimmed)) {
 error = "Valid Account Number (9-18 digits) is required.";
 }
 }
 return error;
 };

 const handleFieldChange = (field, value) => {
 setProfileForm((prev) => ({ ...prev, [field]: value }));
 const error = validateField(field, value);
 setErrors((prev) => ({ ...prev, [field]: error }));
 };

 const handleSaveProfile = async (event) => {
 event.preventDefault();
 setMessage("");
 setMessageType("info");

 // Run validation on all fields
 const newErrors = {};
 Object.keys(profileForm).forEach((key) => {
 const err = validateField(key, profileForm[key]);
 if (err) {
 newErrors[key] = err;
 }
 });

 if (Object.keys(newErrors).length > 0) {
 setErrors(newErrors);
 setMessage("Please correct the errors in the profile form.");
 setMessageType("error");
 return;
 }

 setSavingProfile(true);
 try {
 await saveCashierProfile(userId, {
 name: profileForm.name.trim(),
 email: profileForm.email.trim(),
 phone: profileForm.phone.trim(),
 address: profileForm.address.trim(),
 bloodGroup: profileForm.bloodGroup.trim(),
 dob: profileForm.dob || undefined,
 emergencyContact: profileForm.emergencyContact.trim(),
 photo: profileForm.photo.trim(),
 bankName: profileForm.bankName.trim(),
 accountNumber: profileForm.accountNumber.trim(),
 });
 setMessage("Profile updated successfully.");
 setMessageType("success");
 updateUser({
 ...user,
 name: profileForm.name.trim(),
 email: profileForm.email.trim(),
 photo: profileForm.photo.trim(),
 });
 await loadProfile();
 } catch (error) {
 setMessage(error.response?.data?.message || "Unable to update profile.");
 setMessageType("error");
 } finally {
 setSavingProfile(false);
 }
 };

 const handleChangePassword = async (event) => {
 event.preventDefault();
 setMessage("");
 setMessageType("info");

 if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
 setMessage("Please complete all password fields.");
 setMessageType("error");
 return;
 }

 if (passwordForm.newPassword !== passwordForm.confirmPassword) {
 setMessage("New passwords do not match.");
 setMessageType("error");
 return;
 }

 if (passwordForm.newPassword.length < 6) {
 setMessage("Password must be at least 6 characters long.");
 setMessageType("error");
 return;
 }

 setSavingPassword(true);
 try {
 await changeCashierPassword(userId, {
 currentPassword: passwordForm.currentPassword,
 newPassword: passwordForm.newPassword,
 });
 setMessage("Password changed successfully.");
 setMessageType("success");
 setPasswordForm({
 currentPassword: "",
 newPassword: "",
 confirmPassword: "",
 });
 } catch (error) {
 setMessage(error.response?.data?.message || "Unable to change password.");
 setMessageType("error");
 } finally {
 setSavingPassword(false);
 }
 };

 if (loading && !profile) {
 return (
 <CashierPageShell eyebrow="Profile">
 <div className="flex min-h-[400px] items-center justify-center">
 <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#f28c18] border-t-transparent"></div>
 </div>
 </CashierPageShell>
 );
 }

 return (
 <CashierPageShell eyebrow="Profile">
 {message ? (
 <div
 className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm transition-all duration-300 ${
 messageType === "success"
 ? "border-emerald-200 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800"
 : messageType === "error"
 ? "border-rose-200 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-800"
 : "border-[#f4d0a3] bg-[#fff7eb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#8a5200]"
 }`}
 >
 {message}
 </div>
 ) : null}

 <div className="grid gap-8 lg:grid-cols-3">
 {/* EDIT PROFILE FORM */}
 <div className="lg:col-span-2 space-y-6">
 <section className="rounded-3xl border border-[#f0d3a2] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-6 shadow-sm transition hover:shadow-md">
 <div className="flex items-center justify-between border-b border-[#f9ebdf] pb-4">
 <div>
 <h2 className="text-2xl font-extrabold text-slate-900">Edit Profile</h2>
 <p className="mt-1 text-sm font-medium text-slate-500">
 Update your personal details below. All fields sync with your official employee record.
 </p>
 </div>
 <div className="rounded-full bg-[#fff6e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2.5 text-[#f28c18]">
 <FaSave className="text-xl" />
 </div>
 </div>

 <form className="mt-6 space-y-5" onSubmit={handleSaveProfile}>
 <div className="grid gap-5 md:grid-cols-2">
 {/* Name */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Full Name</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
 <FaUserCircle />
 </span>
 <input
 value={profileForm.name}
 onChange={(e) => handleFieldChange("name", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.name ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
 placeholder="Enter name"
 />
 </div>
 {errors.name && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.name}</p>}
 </div>

 {/* Email */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Email Address</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
 <FaEnvelope />
 </span>
 <input
 type="email"
 value={profileForm.email}
 onChange={(e) => handleFieldChange("email", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.email ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
 placeholder="cashier@temple.com"
 />
 </div>
 {errors.email && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.email}</p>}
 </div>

 {/* Phone */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Phone Number</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
 <FaPhone />
 </span>
 <input
 value={profileForm.phone}
 onChange={(e) => handleFieldChange("phone", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.phone ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
 placeholder="10-digit number"
 />
 </div>
 {errors.phone && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.phone}</p>}
 </div>

 {/* Emergency Contact */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Emergency Contact</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
 <FaPhone />
 </span>
 <input
 value={profileForm.emergencyContact}
 onChange={(e) => handleFieldChange("emergencyContact", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.emergencyContact ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
 placeholder="Emergency 10-digit number"
 />
 </div>
 {errors.emergencyContact && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.emergencyContact}</p>}
 </div>

 {/* Blood Group Dropdown */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Blood Group</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[#f28c18]">
 <FaTint />
 </span>
 <select
 value={profileForm.bloodGroup}
 onChange={(e) => handleFieldChange("bloodGroup", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.bloodGroup ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition appearance-none cursor-pointer`}
 >
 <option value="">Select Blood Group</option>
 {BLOOD_GROUPS.map((group) => (
 <option key={group} value={group}>
 {group}
 </option>
 ))}
 </select>
 <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
 ▼
 </span>
 </div>
 {errors.bloodGroup && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.bloodGroup}</p>}
 </div>

 {/* Date of Birth */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Date of Birth</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
 <FaCalendarAlt />
 </span>
 <input
 type="date"
 value={profileForm.dob}
 onChange={(e) => handleFieldChange("dob", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.dob ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
 />
 </div>
 {errors.dob && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.dob}</p>}
 </div>

 {/* Bank Name Dropdown */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Bank Name</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[#f28c18]">
 <FaSave />
 </span>
 <select
 value={profileForm.bankName}
 onChange={(e) => handleFieldChange("bankName", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.bankName ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition appearance-none cursor-pointer`}
 >
 <option value="">Select Bank</option>
 {bankOptions.map((bank) => (
 <option key={bank} value={bank}>
 {bank}
 </option>
 ))}
 </select>
 <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
 ▼
 </span>
 </div>
 {errors.bankName && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.bankName}</p>}
 </div>

 {/* Account Number */}
 <div className="block">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Account Number</label>
 <div className="relative">
 <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
 <FaSave />
 </span>
 <input
 value={profileForm.accountNumber}
 onChange={(e) => handleFieldChange("accountNumber", e.target.value)}
 className={`w-full rounded-2xl border ${
 errors.accountNumber ? "border-rose-400 focus:border-rose-500" : "border-[#ead7bb]"
 } bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition`}
 placeholder="Account Number"
 />
 </div>
 {errors.accountNumber && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.accountNumber}</p>}
 </div>

 {/* Address */}
 <div className="block md:col-span-2">
 <label className="mb-1.5 block text-sm font-bold text-slate-800">Current Address</label>
 <div className="relative">
 <span className="absolute left-4 top-3.5 text-slate-400">
 <FaMapMarkerAlt />
 </span>
 <textarea
 rows="3"
 value={profileForm.address}
 onChange={(e) => handleFieldChange("address", e.target.value)}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3 pl-10 pr-4 text-base outline-none focus:border-[#f28c18] transition"
 placeholder="Enter full address"
 />
 </div>
 </div>

 {/* Profile Photo Uploader */}
 <div className="block md:col-span-2">
 <label className="mb-2 block text-sm font-bold text-slate-800">Profile Photo</label>
 <div className="flex flex-col sm:flex-row items-center gap-4 rounded-3xl border border-dashed border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4">
 {profileForm.photo ? (
 <div className="relative">
 <img
 src={profileForm.photo}
 alt="Profile Preview"
 className="h-20 w-20 rounded-2xl object-cover border border-[#ead7bb] shadow-sm"
 />
 <button
 type="button"
 onClick={() => handleFieldChange("photo", "")}
 className="absolute -top-2 -right-2 rounded-full bg-rose-500 p-1 text-white shadow-sm hover:bg-rose-600 transition"
 title="Remove photo"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 </div>
 ) : (
 <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#ead7bb] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-400">
 <FaUserCircle className="text-4xl text-[#f28c18]/70" />
 </div>
 )}
 <div className="flex flex-col gap-1.5 items-center sm:items-start w-full sm:w-auto">
 <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <svg className="w-4 h-4 text-[#f28c18]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
 </svg>
 {profileForm.photo ? "Change Photo" : "Upload Photo"}
 <input
 type="file"
 accept="image/*"
 className="hidden"
 onChange={async (e) => {
 const file = e.target.files?.[0];
 if (file) {
 if (!file.type.startsWith("image/")) {
 setErrors((prev) => ({ ...prev, photo: "Only image files (JPG, PNG, WebP) are allowed." }));
 setMessage("Only image files (JPG, PNG, WebP) are allowed.");
 setMessageType("error");
 return;
 }
 // Clear previous photo error if valid image is uploaded
 setErrors((prev) => ({ ...prev, photo: "" }));
 if (file.size > 5 * 1024 * 1024) {
 setErrors((prev) => ({ ...prev, photo: "Profile photo must be 5 MB or smaller." }));
 setMessage("Profile photo must be 5 MB or smaller.");
 setMessageType("error");
 return;
 }
 try {
 const reader = new FileReader();
 reader.onload = () => {
 handleFieldChange("photo", String(reader.result || ""));
 };
 reader.readAsDataURL(file);
 } catch (err) {
 setMessage("Failed to read image file.");
 setMessageType("error");
 }
 }
 }}
 />
 </label>
 <span className="text-xs text-slate-500">JPG, PNG or WebP. Max 5MB.</span>
 {errors.photo && <p className="text-rose-500 text-xs mt-1 font-semibold pl-1">{errors.photo}</p>}
 </div>
 </div>
 </div>
 </div>

 <div className="flex justify-end pt-3">
 <button
 type="submit"
 disabled={savingProfile || loading}
 className="rounded-2xl bg-[#f28c18] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-6 py-3.5 text-base font-extrabold text-white transition hover:bg-[#da7b10] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:cursor-not-allowed disabled:opacity-70 flex items-center gap-2"
 >
 <FaSave />
 {savingProfile ? "Saving Profile..." : "Save Profile Details"}
 </button>
 </div>
 </form>
 </section>
 </div>

 {/* PROFILE SNAPSHOT & SECURITY */}
 <div className="space-y-6">
 {/* SNAPSHOT CARD */}
 <div className="rounded-3xl border border-[#f0d3a2] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-6 shadow-sm transition hover:shadow-md">
 <h2 className="text-xl font-extrabold text-slate-900 border-b border-[#f9ebdf] pb-3">Profile Snapshot</h2>
 <div className="mt-4 rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4 flex flex-col items-center text-center">
 {profileForm.photo ? (
 <img
 src={profileForm.photo}
 alt="Profile"
 className="h-24 w-24 rounded-full object-cover border-4 border-white shadow-md mb-3"
 />
 ) : (
 <FaUserCircle className="text-7xl text-[#f28c18] mb-3" />
 )}
 <h3 className="text-lg font-extrabold text-slate-900">{profileForm.name || user?.name || "Cashier"}</h3>
 <span className="mt-1 px-3 py-1 rounded-full bg-[#ffe8ca] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-xs font-extrabold text-[#9c5a00] uppercase tracking-wider">
 {profile?.role || user?.role || "Cashier"}
 </span>

 <div className="w-full mt-4 space-y-2.5 text-left text-sm border-t border-[#f3dfc6] pt-4">
 <div className="flex justify-between">
 <span className="text-slate-500 font-medium">Email:</span>
 <span className="text-slate-800 font-semibold truncate max-w-[180px]" title={profileForm.email}>{profileForm.email || "-"}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500 font-medium">Phone:</span>
 <span className="text-slate-800 font-semibold">{profileForm.phone || "-"}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500 font-medium">Blood Group:</span>
 <span className="text-rose-600 font-extrabold">{profileForm.bloodGroup || "Not set"}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500 font-medium">Member Since:</span>
 <span className="text-slate-800 font-semibold">{profile?.memberSince || new Date().getFullYear()}</span>
 </div>
 </div>
 </div>
 </div>

 {/* PASSWORD SECURITY CARD */}
 <div className="rounded-3xl border border-[#f0d3a2] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-6 shadow-sm transition hover:shadow-md">
 <div className="flex items-center justify-between border-b border-[#f9ebdf] pb-3">
 <h2 className="text-xl font-extrabold text-slate-900">Security</h2>
 <div className="rounded-full bg-[#fff6e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2 text-[#f28c18]">
 <FaLock className="text-lg" />
 </div>
 </div>

 <form className="mt-4 space-y-4" onSubmit={handleChangePassword}>
 <div className="block">
 <label className="mb-1 block text-sm font-bold text-slate-800">Current Password</label>
 <input
 type="password"
 value={passwordForm.currentPassword}
 onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18] transition"
 placeholder="Current password"
 />
 </div>

 <div className="block">
 <label className="mb-1 block text-sm font-bold text-slate-800">New Password</label>
 <input
 type="password"
 value={passwordForm.newPassword}
 onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18] transition"
 placeholder="At least 6 characters"
 />
 </div>

 <div className="block">
 <label className="mb-1 block text-sm font-bold text-slate-800">Confirm New Password</label>
 <input
 type="password"
 value={passwordForm.confirmPassword}
 onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
 className="w-full rounded-2xl border border-[#ead7bb] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-base outline-none focus:border-[#f28c18] transition"
 placeholder="Confirm new password"
 />
 </div>

 <button
 type="submit"
 disabled={savingPassword || loading}
 className="w-full rounded-2xl border border-[#f0c58f] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 py-3.5 text-base font-extrabold text-slate-900 transition hover:bg-[#fff8ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm"
 >
 <FaShieldAlt className="text-[#f28c18]" />
 {savingPassword ? "Updating..." : "Update Security Password"}
 </button>
 </form>
 </div>
 </div>
 </div>
 </CashierPageShell>
 );
};

export default ProfilePage;
