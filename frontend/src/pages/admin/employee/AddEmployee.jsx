import { useEffect, useMemo, useState } from "react";
import { FiUpload, FiChevronRight, FiSave, FiUser, FiBriefcase, FiLock, FiCopy } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import SectionCard from "../../../components/admin/employee/SectionCard";
import {
 employeeRoles,
 roleDepartmentMap,
 departmentDutyMap,
 departmentLocationMap,
 dutyLocations,
 shiftOptions,
} from "./employeeData";
import { createEmployee } from "../../../services/employeeService";
import FaceRegistration from "../../../components/admin/employee/FaceRegistration";

const initialForm = {
 // Step 1 – Personal Details
 name: "",
 email: "",
 phone: "",
 address: "",
 photo: null,
 bloodGroup: "",
 gender: "Male",
 dob: "",
 employeeType: "Full Time",
 salary: "",
 joiningDate: "",
 emergencyContact: "",
 aadhar: "",
 // Step 2 – Professional Details
 role: "priest",
 department: "Priest Services",
 defaultShift: "Morning",
 defaultDuty: "",
 dutyLocation: "Main Temple Hall",
 attendanceLocation: "",
 faceRegistered: false,
 faceDescriptor: [],
 facePhotos: [],
 
 // Step 3 – Account Details
 bankName: "",
 accountNumber: "",
 weeklyOff: "",
 
 eligiblePoojas: [],
};

import axios from "axios";
import { getStoredToken } from "../../../services/authService";

const draftKey = "adminEmployeeDraft";

const isValidEmail = (v) => /^\S+@\S+\.\S+$/.test(String(v || "").trim());
const isValidPhone = (v) => /^\+?[0-9]{10,15}$/.test(String(v || "").replace(/[\s-]/g, ""));
const isValidDate = (v) => {
 if (!v) return false;
 return !Number.isNaN(new Date(v).getTime());
};
const isPastOrToday = (v) => {
 if (!isValidDate(v)) return false;
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 return new Date(v) <= today;
};

const isAdult = (dob) => {
 if (!dob) return false;

 const birthDate = new Date(dob);
 const today = new Date();

 let age = today.getFullYear() - birthDate.getFullYear();

 const monthDiff = today.getMonth() - birthDate.getMonth();

 if (
 monthDiff < 0 ||
 (monthDiff === 0 && today.getDate() < birthDate.getDate())
 ) {
 age--;
 }

 return age >= 18;
};

const readFileAsDataUrl = (file) =>
 new Promise((resolve, reject) => {
 if (!file) {
 resolve("");
 return;
 }
 const reader = new FileReader();
 reader.onload = () => resolve(String(reader.result || ""));
 reader.onerror = reject;
 reader.readAsDataURL(file);
 });

const bankOptions = [
 "",
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

const steps = [
 { label: "Personal Details", icon: <FiUser /> },
 { label: "Professional Details", icon: <FiBriefcase /> },
 { label: "Account Details", icon: <FiLock /> },
];

const AddEmployee = () => {
 const navigate = useNavigate();
 const [step, setStep] = useState(0);
 const [form, setForm] = useState(initialForm);
 const [message, setMessage] = useState(null);
 const [errors, setErrors] = useState({});
 const [isSaving, setIsSaving] = useState(false);
 const [credentials, setCredentials] = useState(null);
 const [createdEmployee, setCreatedEmployee] = useState(null);
 const [locations, setLocations] = useState([]);
 const [poojas, setPoojas] = useState([]);

 useEffect(() => {
 const fetchPoojas = async () => {
 try {
 const token = getStoredToken();
 const res = await axios.get("http://localhost:5000/api/admin/poojas", {
 headers: { Authorization: `Bearer ${token}` }
 });
 if (res.data.success) setPoojas(res.data.poojas);
 } catch (err) {
 console.error("Failed to fetch poojas", err);
 }
 };
 fetchPoojas();
 }, []);

 useEffect(() => {
 const fetchLocations = async () => {
 try {
 const token = getStoredToken();
 const res = await axios.get("http://localhost:5000/api/attendance-locations", {
 headers: { Authorization: `Bearer ${token}` }
 });
 if (res.data.success) {
 setLocations(res.data.locations);
 if (res.data.locations.length > 0 && !form.attendanceLocation) {
 setForm(prev => ({ ...prev, attendanceLocation: res.data.locations[0]._id }));
 }
 }
 } catch (err) {
 console.error("Failed to fetch attendance locations", err);
 }
 };
 fetchLocations();
 }, []);

 // Departments list derived from selected role
 const departmentList = useMemo(() => roleDepartmentMap[form.role] || [], [form.role]);

 // Duty options derived from selected department
 const dutyList = useMemo(() => departmentDutyMap[form.department] || [], [form.department]);

 // When role changes → reset department to first available
 useEffect(() => {
 const depts = roleDepartmentMap[form.role] || [];
 const firstDept = depts[0] || "";
 const duties = departmentDutyMap[firstDept] || [];
 setForm((prev) => ({
 ...prev,
 department: firstDept,
 defaultDuty: duties[0] || "",
 }));
 }, [form.role]);

 // When department changes → reset duty and location to first available
 useEffect(() => {
 const duties = departmentDutyMap[form.department] || [];
 const locs = departmentLocationMap[form.department] || dutyLocations;
 setForm((prev) => ({ 
 ...prev, 
 defaultDuty: duties[0] || "",
 dutyLocation: locs[0] || "",
 }));
 }, [form.department]);

 // Dynamic location list based on department
 const locationList = useMemo(() => departmentLocationMap[form.department] || dutyLocations, [form.department]);

 // Load draft on mount
 useEffect(() => {
 try {
 const draft = localStorage.getItem(draftKey);
 if (draft) setForm(JSON.parse(draft));
 } catch (_) {}
 }, []);

 const handleSaveDraft = () => {
 try {
 localStorage.setItem(draftKey, JSON.stringify(form));
 setMessage({ type: "success", text: "Draft saved locally." });
 } catch (_) {
 setMessage({ type: "error", text: "Unable to save draft." });
 }
 };

 const handleChange = (field) => (event) => {
 const value = field === "photo" ? event.target.files[0] : event.target.value;
 setForm((prev) => ({ ...prev, [field]: value }));
 setErrors((prev) => ({ ...prev, [field]: null }));
 };

 const handleNext = () => {
 // Validate current step before advancing
 const newErrors = {};
 if (step === 0) {
 if (!form.name.trim()) newErrors.name = "Employee name is required.";
 if (!form.email.trim() || !isValidEmail(form.email))
 newErrors.email = "Please enter a valid email address.";
 if (!form.phone.trim() || !isValidPhone(form.phone))
 newErrors.phone = "Please enter a valid phone number (10 digits).";
 if (!form.emergencyContact || !isValidPhone(form.emergencyContact))
 newErrors.emergencyContact = "Enter valid emergency contact number.";
 if (!/^[0-9]{12}$/.test(form.aadhar))
 newErrors.aadhar = "Aadhaar number must be 12 digits.";
 if (!form.dob || !isValidDate(form.dob) || !isPastOrToday(form.dob)) {
 newErrors.dob = "Please enter a valid date of birth.";
 } else if (!isAdult(form.dob)) {
 newErrors.dob = "Employees must be at least 18 years old.";
 }
 if (!form.bloodGroup || form.bloodGroup.trim() === "") {
 newErrors.bloodGroup = "Please select a Blood Group.";
 }
 if (form.address && /^\d+$/.test(form.address.trim())) {
 newErrors.address = "Address cannot consist of only numbers.";
 }
 if (form.photo) {
 if (form.photo.size > 5 * 1024 * 1024) {
 newErrors.photo = "Profile photo must be 5 MB or smaller.";
 } else if (!form.photo.type.startsWith('image/')) {
 newErrors.photo = "Please upload a valid image file.";
 }
 }
 }
 if (step === 1) {
 if (!form.salary || Number(form.salary) <= 0) {
 newErrors.salary = "Salary must be greater than 0.";
 }
 if (!form.joiningDate) {
 newErrors.joiningDate = "Joining Date is required, Please put the joining date.";
 } else {
 const dobDate = new Date(form.dob);
 const joiningDate = new Date(form.joiningDate);
 const eighteenthBirthday = new Date(dobDate);
 eighteenthBirthday.setFullYear(eighteenthBirthday.getFullYear() + 18);
 
 if (joiningDate < eighteenthBirthday) {
 newErrors.joiningDate = "Joining Date must be after employee turns 18 years old.";
 } else if (joiningDate > new Date()) {
 newErrors.joiningDate = "Joining Date cannot be a future date.";
 }
 }
 
 if (!form.department) {
 newErrors.department = "Please select a department.";
 }
 if (!form.defaultDuty) {
 newErrors.defaultDuty = "Please select a default duty.";
 }
 }
 
 if (Object.keys(newErrors).length > 0) {
 setErrors(newErrors);
 return;
 }
 
 setErrors({});
 setMessage(null);
 setStep((prev) => prev + 1);
 };

 const handlePrev = () => {
 setMessage(null);
 setStep((prev) => prev - 1);
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 setMessage(null);

 const newErrors = {};
 if (!form.bankName || form.bankName.trim() === "") {
 newErrors.bankName = "Please select a Bank Name.";
 }
 const acc = form.accountNumber ? form.accountNumber.trim() : "";
 if (!acc || !/^[0-9]{9,18}$/.test(acc)) {
 newErrors.accountNumber = "Valid Account Number (9-18 digits) is required.";
 }
 if (Object.keys(newErrors).length > 0) {
 setErrors(newErrors);
 setIsSaving(false);
 return;
 }

 setIsSaving(true);
 try {
 const photoDataUrl = await readFileAsDataUrl(form.photo);
 const payload = {
 name: form.name.trim(),
 email: form.email.trim(),
 phone: form.phone.trim(),
 address: form.address.trim(),

 gender: form.gender,
 bloodGroup: form.bloodGroup,
 dob: form.dob,

 employeeType: form.employeeType,
 salary: Number(form.salary),
 joiningDate: form.joiningDate,
 emergencyContact: form.emergencyContact,
 aadhaar: form.aadhar,

 role: form.role,
 department: form.department,
 defaultShift: form.defaultShift,
 defaultDuty: form.defaultDuty,
 dutyLocation: form.dutyLocation,
 attendanceLocation: form.attendanceLocation,
 faceRegistered: form.faceRegistered,
 faceDescriptor: form.faceDescriptor,
 profilePhoto: form.profilePhoto || photoDataUrl,
 facePhotos: form.facePhotos || [],
 weeklyOff: form.weeklyOff,
 eligiblePoojas: form.eligiblePoojas,
 currentDuty: {
 dutyName: form.defaultDuty,
 shift: form.defaultShift,
 dutyLocation: form.dutyLocation,
 reportingTime: "",
 workingHours: "",
 supervisor: "Admin",
 priority: "Medium",
 },

 photo: photoDataUrl,
 bankName: form.bankName.trim(),
 accountNumber: form.accountNumber.trim(),
};
 const response = await createEmployee(payload);
 setCredentials(response.credentials);
 setCreatedEmployee(response.employee);
 setMessage({ type: "success", text: "Employee created successfully. Login credentials are ready." });
 setForm(initialForm);
 localStorage.removeItem(draftKey);
 } catch (error) {
 setMessage({ type: "error", text: error.response?.data?.message || "Unable to save employee." });
 } finally {
 setIsSaving(false);
 }
 };

 const copyCredentials = async () => {
 if (!credentials) return;
 await navigator.clipboard.writeText(
 [
 `Employee ID: ${credentials.employeeId}`,
 `Username: ${credentials.username}`,
 `Temporary Password: ${credentials.temporaryPassword}`,
 ].join("\n")
 );
 setMessage({ type: "success", text: "Credentials copied to clipboard." });
 };

 const photoPreview = form.photo ? URL.createObjectURL(form.photo) : null;

 return (
 <div className="space-y-8">
 {/* Header */}
 <div className="rounded-[32px] border border-amber-200/60 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-600/15 p-7 text-[#4a2b0f] dark:text-slate-200 shadow-md backdrop-blur-md">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <div>
 <p className="text-xs uppercase tracking-[0.28em] font-extrabold text-[#7a4918]">Employee Management</p>
 <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-[#4a2b0f] dark:text-slate-200 ">Add Employee</h1>
 <p className="max-w-2xl text-[#7a4918] font-medium text-base mt-2">
 Onboard a new temple employee with complete personal, job, and payment details for Sri Shanti Mahadev Mandir.
 </p>
 </div>
 <button
 type="button"
 onClick={handleSaveDraft}
 className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-6 py-3 font-extrabold text-white shadow-md transition hover:bg-amber-700 hover:scale-105"
 >
 <FiSave /> Save Draft
 </button>
 </div>
 </div>

 <div className="grid gap-8 xl:grid-cols-[1.3fr_0.9fr]">
 {/* Form Card */}
 <SectionCard title="New Employee Registration" subtitle="Complete the onboarding steps below." className="overflow-hidden">
 {/* Step Indicator */}
 <div className="mb-8 grid gap-4 sm:grid-cols-3">
 {steps.map(({ label, icon }, index) => (
 <div
 key={label}
 className={`rounded-3xl border p-4 text-center transition ${ index === step ? "border-amber-400 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-lg" : index < step ? "border-emerald-300 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " : "border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " }`}
 >
 <div
 className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold ${ index === step ? "bg-amber-400 text-white" : index < step ? "bg-emerald-400 text-white" : "bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 " }`}
 >
 {index < step ? "✓" : index + 1}
 </div>
 <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 ">{label}</p>
 </div>
 ))}
 </div>

 <form onSubmit={handleSubmit} className="space-y-6">
 {/* ── Step 1: Personal Details ── */}
 {step === 0 && (
 <div className="grid gap-5 md:grid-cols-2">
 {/* Employee Name */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Employee Name <span className="text-rose-500">*</span>
 <input
 value={form.name}
 onChange={handleChange("name")}
 placeholder="e.g., Ramesh Kumar"
 className={`w-full rounded-3xl border ${errors.name ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 required
 />
 {errors.name && <p className="text-rose-500 text-xs mt-1">{errors.name}</p>}
 </label>

 {/* Email */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Email <span className="text-rose-500">*</span>
 <input
 type="email"
 value={form.email}
 onChange={handleChange("email")}
 placeholder="employee@temple.org"
 className={`w-full rounded-3xl border ${errors.email ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 required
 />
 {errors.email && <p className="text-rose-500 text-xs mt-1">{errors.email}</p>}
 </label>

 {/* Phone Number */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Phone Number <span className="text-rose-500">*</span>
 <input
 type="tel"
 value={form.phone}
 onChange={handleChange("phone")}
 placeholder="+91 90000 00000"
 className={`w-full rounded-3xl border ${errors.phone ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 required
 />
 {errors.phone && <p className="text-rose-500 text-xs mt-1">{errors.phone}</p>}
 </label>

 {/* Gender */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Gender
 <select
 value={form.gender}
 onChange={handleChange("gender")}
 className={`w-full rounded-3xl border ${errors.gender ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 <option>Male</option>
 <option>Female</option>
 <option>Other</option>
 </select>
 {errors.gender && <p className="text-rose-500 text-xs mt-1">{errors.gender}</p>}
 </label>

 {/* Date of Birth */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Date of Birth <span className="text-rose-500">*</span>
 <input
 type="date"
 value={form.dob}
 onChange={handleChange("dob")}
 max={
 new Date(
 new Date().setFullYear(
 new Date().getFullYear() - 18
 )
 )
 .toISOString()
 .split("T")[0]
 }
 className={`w-full rounded-3xl border ${errors.dob ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 />
 {errors.dob && <p className="text-rose-500 text-xs mt-1">{errors.dob}</p>}
 </label>

 {/* Blood Group */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Blood Group <span className="text-rose-500">*</span>
 <select
 value={form.bloodGroup}
 onChange={handleChange("bloodGroup")}
 className={`w-full rounded-3xl border ${errors.bloodGroup ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 <option value="">Select Blood Group</option>
 <option value="A+">A+</option>
 <option value="A-">A-</option>
 <option value="B+">B+</option>
 <option value="B-">B-</option>
 <option value="AB+">AB+</option>
 <option value="AB-">AB-</option>
 <option value="O+">O+</option>
 <option value="O-">O-</option>
 </select>
 {errors.bloodGroup && <p className="text-rose-500 text-xs mt-1">{errors.bloodGroup}</p>}
 </label>

 {/*Emergency Contact*/}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Emergency Contact *
 <input
 type="tel"
 value={form.emergencyContact}
 onChange={handleChange("emergencyContact")}
 placeholder="Emergency Contact Number"
 className={`w-full rounded-3xl border ${errors.emergencyContact ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3`}
 />
 {errors.emergencyContact && <p className="text-rose-500 text-xs mt-1">{errors.emergencyContact}</p>}
 </label>

 {/* Aadhar Number */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Aadhaar Number *
 <input
 type="text"
 maxLength={12}
 value={form.aadhar}
 onChange={handleChange("aadhar")}
 placeholder="123456789012"
 className={`w-full rounded-3xl border ${errors.aadhar ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3`}
 />
 {errors.aadhar && <p className="text-rose-500 text-xs mt-1">{errors.aadhar}</p>}
 </label>

 {/* Address */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 md:col-span-2">
 Address
 <textarea
 value={form.address}
 onChange={handleChange("address")}
 rows={3}
 placeholder="Full residential address"
 className={`w-full rounded-3xl border ${errors.address ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 />
 {errors.address && <p className="text-rose-500 text-xs mt-1">{errors.address}</p>}
 </label>

 {/* Photo Upload */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 md:col-span-2">
 Profile Photo
 <div className={`flex items-center gap-4 rounded-3xl border ${errors.photo ? "border-rose-500 bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " : "border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "} p-4`}>
 {photoPreview && (
 <img
 src={photoPreview}
 alt="Preview"
 className="h-14 w-14 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 "
 />
 )}
 <input
 type="file"
 accept="image/*"
 onChange={handleChange("photo")}
 className="hidden"
 id="photo-upload"
 />
 <label
 htmlFor="photo-upload"
 className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-slate-900 dark:text-slate-200 shadow-sm hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition"
 >
 <FiUpload /> {form.photo ? "Change Photo" : "Choose Photo"}
 </label>
 <span className="text-sm text-slate-500 dark:text-slate-200 ">PNG, JPG up to 5 MB</span>
 </div>
 {errors.photo && <p className="text-rose-500 text-xs mt-1">{errors.photo}</p>}
 </label>
 </div>
 )}

 {/* ── Step 2: Professional Details ── */}
 {step === 1 && (
 <div className="grid gap-5 md:grid-cols-2">
 {/* Role */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Role <span className="text-rose-500">*</span>
 <select
 value={form.role}
 onChange={handleChange("role")}
 className={`w-full rounded-3xl border ${errors.role ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 {employeeRoles.map((r) => (
 <option key={r.value} value={r.value}>
 {r.label}
 </option>
 ))}
 </select>
 {errors.role && <p className="text-rose-500 text-xs mt-1">{errors.role}</p>}
 </label>

 {/* Department — auto-updates when role changes */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Department <span className="text-rose-500">*</span>
 <select
 value={form.department}
 onChange={handleChange("department")}
 className={`w-full rounded-3xl border ${errors.department ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 {departmentList.map((dept) => (
 <option key={dept} value={dept}>
 {dept}
 </option>
 ))}
 </select>
 {errors.department ? (
 <p className="text-rose-500 text-xs mt-1">{errors.department}</p>
 ) : (
 <p className="text-xs text-slate-400 mt-1">Auto-loaded based on selected role</p>
 )}
 </label>

 {/* Employee Type */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Employee Type *
 <select
 value={form.employeeType}
 onChange={handleChange("employeeType")}
 className={`w-full rounded-3xl border ${errors.employeeType ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3`}
 >
 <option value="Full Time">Full Time</option>
 <option value="Part Time">Part Time</option>
 <option value="Contract">Contract</option>
 </select>
 {errors.employeeType && <p className="text-rose-500 text-xs mt-1">{errors.employeeType}</p>}
 </label>

 {/* Salary */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Monthly Salary *
 <input
 type="number"
 min="1"
 value={form.salary}
 onChange={handleChange("salary")}
 placeholder="25000"
 className={`w-full rounded-3xl border ${errors.salary ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3`}
 />
 {errors.salary && <p className="text-rose-500 text-xs mt-1">{errors.salary}</p>}
 </label>

 {/* Joining Date */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Joining Date *
 <input
 type="date"
 value={form.joiningDate}
 onChange={handleChange("joiningDate")}
 min={
 form.dob
 ? new Date(
 new Date(form.dob).setFullYear(
 new Date(form.dob).getFullYear() + 18
 )
 )
 .toISOString()
 .split("T")[0]
 : ""
 }
 max={new Date().toISOString().split("T")[0]}
 className={`w-full rounded-3xl border ${errors.joiningDate ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3`}
/>
 {errors.joiningDate && <p className="text-rose-500 text-xs mt-1">{errors.joiningDate}</p>}
 </label>

 {/* Default Shift */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Default Shift <span className="text-rose-500">*</span>
 <select
 value={form.defaultShift}
 onChange={handleChange("defaultShift")}
 className={`w-full rounded-3xl border ${errors.defaultShift ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 {shiftOptions.map((s) => (
 <option key={s} value={s}>
 {s}
 </option>
 ))}
 </select>
 {errors.defaultShift && <p className="text-rose-500 text-xs mt-1">{errors.defaultShift}</p>}
 </label>

 {/* Default Duty — auto-updates when department changes */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Default Duty <span className="text-rose-500">*</span>
 <select
 value={form.defaultDuty}
 onChange={handleChange("defaultDuty")}
 className={`w-full rounded-3xl border ${errors.defaultDuty ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 {dutyList.map((duty) => (
 <option key={duty} value={duty}>
 {duty}
 </option>
 ))}
 {dutyList.length === 0 && <option value="">No duties configured</option>}
 </select>
 {errors.defaultDuty ? (
 <p className="text-rose-500 text-xs mt-1">{errors.defaultDuty}</p>
 ) : (
 <p className="text-xs text-slate-400 mt-1">Auto-loaded based on selected department</p>
 )}
 </label>

 {/* Duty Location */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Duty Location <span className="text-rose-500">*</span>
 <select
 value={form.dutyLocation}
 onChange={handleChange("dutyLocation")}
 className={`w-full rounded-3xl border ${errors.dutyLocation ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 {locationList.map((loc) => (
 <option key={loc} value={loc}>
 {loc}
 </option>
 ))}
 </select>
 {errors.dutyLocation && <p className="text-rose-500 text-xs mt-1">{errors.dutyLocation}</p>}
 </label>

 {/* Weekly Off */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Weekly Off
 <select
 value={form.weeklyOff}
 onChange={handleChange("weeklyOff")}
 className={`w-full rounded-3xl border ${errors.weeklyOff ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 <option value="">No Weekly Off</option>
 <option value="Sunday">Sunday</option>
 <option value="Monday">Monday</option>
 <option value="Tuesday">Tuesday</option>
 <option value="Wednesday">Wednesday</option>
 <option value="Thursday">Thursday</option>
 <option value="Friday">Friday</option>
 <option value="Saturday">Saturday</option>
 </select>
 </label>

 {/* Attendance Location */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Attendance Location
 <select
 value={form.attendanceLocation}
 onChange={handleChange("attendanceLocation")}
 className={`w-full rounded-3xl border ${errors.attendanceLocation ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 <option value="">Select Location</option>
 {locations.map(loc => (
 <option key={loc._id} value={loc._id}>{loc.locationName}</option>
 ))}
 </select>
 </label>
 
 {form.role === "priest" && (
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 md:col-span-2">
 Eligible Poojas
 <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2 border rounded-3xl border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 {poojas.map(pooja => (
 <label key={pooja._id} className="flex items-center gap-2 cursor-pointer text-sm">
 <input 
 type="checkbox" 
 checked={form.eligiblePoojas.includes(pooja._id)}
 onChange={(e) => {
 if (e.target.checked) {
 setForm(prev => ({ ...prev, eligiblePoojas: [...prev.eligiblePoojas, pooja._id] }));
 } else {
 setForm(prev => ({ ...prev, eligiblePoojas: prev.eligiblePoojas.filter(id => id !== pooja._id) }));
 }
 }}
 className="accent-amber-500 w-4 h-4"
 />
 {pooja.name}
 </label>
 ))}
 </div>
 </label>
 )}

 {/* Face Registration */}
 <div className="md:col-span-2 space-y-2">
 <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">Face Registration</span>
 {form.faceRegistered ? (
 <div className="rounded-3xl border border-emerald-200 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-4 text-emerald-800 flex justify-between items-center">
 <div>
 <p className="font-bold">Face Registered</p>
 <p className="text-xs">Face data has been captured successfully.</p>
 </div>
 <button type="button" onClick={() => setForm(prev => ({ ...prev, faceRegistered: false, faceDescriptor: [], profilePhoto: null, facePhotos: [] }))} className="text-sm font-semibold underline">Retake</button>
 </div>
 ) : (
 <FaceRegistration onRegistrationComplete={(data) => {
 setForm(prev => ({
 ...prev,
 faceRegistered: data.faceRegistered,
 faceDescriptor: data.faceDescriptor,
 profilePhoto: data.profilePhoto,
 facePhotos: data.facePhotos
 }));
 }} />
 )}
 </div>

 {/* Auto-assignment info banner */}
 <div className="md:col-span-2 rounded-3xl border border-amber-200 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-4">
 <p className="text-sm font-semibold text-amber-800 mb-2">✦ What happens after save?</p>
 <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
 <li>Employee Profile is created automatically</li>
 <li>Default Shift, Duty &amp; Location are assigned</li>
 <li>Login account and role dashboard are activated</li>
 <li>Temporary password is generated automatically</li>
 </ul>
 </div>
 </div>
 )}

 {/* ── Step 3: Account Details ── */}
 {step === 2 && (
 <div className="grid gap-5 md:grid-cols-2">
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 md:col-span-2">
 <span className="font-medium">Login Email</span>
 <div className="w-full rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 text-slate-600 dark:text-slate-200 text-sm">
 {form.email || "—"}
 </div>
 <p className="text-xs text-slate-400">Email entered in Step 1 will be used as login</p>
 </label>
 <div className="rounded-3xl border border-emerald-200 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-4 text-sm text-emerald-800 md:col-span-2">
 Employee ID, username, and temporary password will be generated and sent to the employee's email automatically after Save Employee.
 </div>

 {/* Bank Name */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Bank Name <span className="text-rose-500">*</span>
 <select
 value={form.bankName}
 onChange={handleChange("bankName")}
 className={`w-full rounded-3xl border ${errors.bankName ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 >
 {bankOptions.map((bank) => (
 <option key={bank} value={bank} disabled={bank === ""}>
 {bank === "" ? "Select Bank" : bank}
 </option>
 ))}
 </select>
 {errors.bankName && <p className="text-rose-500 text-xs mt-1">{errors.bankName}</p>}
 </label>

 {/* Account Number */}
 <label className="block space-y-2 text-sm text-slate-700 dark:text-slate-200 ">
 Account Number <span className="text-rose-500">*</span>
 <input
 type="text"
 value={form.accountNumber}
 onChange={handleChange("accountNumber")}
 placeholder="e.g. 123456789012"
 className={`w-full rounded-3xl border ${errors.accountNumber ? "border-rose-500" : "border-slate-200 dark:border-slate-700 "} bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-3 outline-none focus:border-amber-400 transition`}
 />
 {errors.accountNumber && <p className="text-rose-500 text-xs mt-1">{errors.accountNumber}</p>}
 </label>

 {/* Summary Review */}
 <div className="md:col-span-2 rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 space-y-3">
 <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Review Before Saving</p>
 <div className="grid grid-cols-2 gap-3 text-sm">
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Name</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.name || "—"}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Gender</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.gender}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Role</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 capitalize">{form.role}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Blood Group</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.bloodGroup || "—"}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Department</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.department}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Employee Type</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.employeeType}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Salary</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">₹{form.salary}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Joining Date</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.joiningDate}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Emergency Contact</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.emergencyContact}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Aadhaar</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.aadhar}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Default Shift</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.defaultShift}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Default Duty</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.defaultDuty || "—"}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Duty Location</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.dutyLocation}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Face Registered</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.faceRegistered ? "Yes" : "No"}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Bank Name</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.bankName || "—"}</p>
 </div>
 <div>
 <p className="text-slate-500 dark:text-slate-200 text-xs">Account Number</p>
 <p className="font-semibold text-slate-800 dark:text-slate-200 ">{form.accountNumber || "—"}</p>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* Message */}
 {message && (
 <div
 className={`rounded-3xl p-4 text-sm ${ message.type === "success" ? "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700" : "bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-700" }`}
 >
 {message.text}
 </div>
 )}

 {/* Navigation Buttons */}
 <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
 <button
 type="button"
 onClick={handlePrev}
 disabled={step === 0}
 className="rounded-full border border-slate-300 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
 >
 Back
 </button>
 <div className="flex items-center gap-3">
 {step < steps.length - 1 ? (
 <button
 type="button"
 onClick={handleNext}
 className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-5 py-3 text-sm font-extrabold text-white shadow-md transition hover:bg-amber-700"
 >
 Continue <FiChevronRight />
 </button>
 ) : (
 <button
 type="submit"
 disabled={isSaving}
 className="rounded-2xl bg-amber-600 px-6 py-3 text-sm font-extrabold text-white shadow-md hover:bg-amber-700 transition disabled:opacity-60"
 >
 {isSaving ? "Saving…" : "Save Employee"}
 </button>
 )}
 </div>
 </div>
 </form>
 </SectionCard>

 {/* Live Preview Card */}
 <SectionCard title="Live Preview" subtitle="Profile preview updates as you type." className="h-full">
 <div className="space-y-5 rounded-[28px] border border-amber-200/60 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-inner">
 {/* Avatar */}
 <div className="flex items-center gap-4">
 {photoPreview ? (
 <img src={photoPreview} alt="Preview" className="h-20 w-20 rounded-3xl object-cover border border-slate-200 dark:border-slate-700 " />
 ) : (
 <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-3xl font-bold shadow-md">
 {form.name ? form.name[0].toUpperCase() : "?"}
 </div>
 )}
 <div>
 <p className="text-xs uppercase tracking-widest text-slate-400">Employee</p>
 <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-200 ">{form.name || "New Employee"}</h3>
 <p className="text-sm text-slate-500 dark:text-slate-200 capitalize">{form.role}</p>
 </div>
 </div>

 <div className="space-y-3">
 <InfoRow label="Email" value={form.email || "—"} />
 <InfoRow label="Phone" value={form.phone || "—"} />
 <InfoRow label="Gender" value={form.gender} />
 <InfoRow label="Date of Birth" value={form.dob || "—"} />
 <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
 <InfoRow label="Employee ID" value="Auto-generated" highlight />
 <InfoRow label="Username" value="Auto-generated" highlight />
 <InfoRow label="Temporary Password" value="Auto-generated & Emailed" highlight />
 <InfoRow label="Department" value={form.department || "—"} highlight />
 <InfoRow label="Default Shift" value={form.defaultShift} highlight />
 <InfoRow label="Default Duty" value={form.defaultDuty || "—"} highlight />
 <InfoRow label="Duty Location" value={form.dutyLocation || "—"} highlight />
 <InfoRow label="Attendance Location" value={locations.find(l => l._id === form.attendanceLocation)?.locationName || "Global"} highlight />
 <InfoRow label="Face Registered" value={form.faceRegistered ? "Yes" : "No"} highlight />
 </div>
 </div>

 {/* Status Badge */}
 <div className="rounded-2xl bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] border border-emerald-200 px-4 py-3 flex items-center gap-3">
 <span className="h-2.5 w-2.5 rounded-full bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 animate-pulse"></span>
 <div>
 <p className="text-xs text-emerald-700 font-semibold">Status: Assigned</p>
 <p className="text-xs text-emerald-600 mt-0.5">Attendance check-in will be enabled after save</p>
 </div>
 </div>
 </div>
 </SectionCard>
 </div>
 {credentials && (
 <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4">
 <div className="w-full max-w-md rounded-[28px] border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl">
 <p className="text-sm uppercase tracking-[0.2em] text-emerald-600">Success</p>
 <h3 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-200 ">Employee Created</h3>
 <div className="mt-5 space-y-3 rounded-3xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm text-slate-700 dark:text-slate-200 ">
 <p>The employee profile for <strong>{createdEmployee?.name || form.name}</strong> has been created successfully.</p>
 <p>The login credentials (including their temporary password) have been sent to <strong>{createdEmployee?.email || form.email}</strong>.</p>
 </div>
 <div className="mt-5 flex flex-wrap justify-end gap-3">
 <button
 type="button"
 onClick={copyCredentials}
 className="rounded-full bg-slate-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow hover:bg-slate-300 transition"
 >
 Copy Credentials
 </button>
 <button
 type="button"
 onClick={() => navigate("/admin/employees")}
 className="rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-slate-950 dark:text-slate-200 shadow hover:bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition"
 >
 Finish
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

// Small helper component for preview rows
const InfoRow = ({ label, value, highlight }) => (
 <div className={`rounded-2xl px-4 py-3 ${highlight ? "bg-violet-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " : "bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "} shadow-sm`}>
 <p className="text-xs text-slate-400">{label}</p>
 <p className={`mt-0.5 text-sm font-semibold ${highlight ? "text-violet-800" : "text-slate-800 dark:text-slate-200 "}`}>{value}</p>
 </div>
);

export default AddEmployee;
