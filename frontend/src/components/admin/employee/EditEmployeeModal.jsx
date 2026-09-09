import React, { useState, useEffect } from "react";
import axios from "axios";
import { FiX, FiSave } from "react-icons/fi";
import {
 employeeRoles,
 roleDepartmentMap,
 departmentDutyMap,
 dutyLocations,
 shiftOptions,
} from "../../../pages/admin/employee/employeeData";
import { updateEmployee } from "../../../services/employeeService";

const bankOptions = [
 "",
 "State Bank of India (SBI)",
 "HDFC Bank",
 "ICICI Bank",
 "Axis Bank",
 "Punjab National Bank (PNB)",
 "Canara Bank",
 "Bank of Baroda",
 "Union Bank of India",
 "Kotak Mahindra Bank",
 "IndusInd Bank",
 "Other",
];

const EditEmployeeModal = ({ employee, onClose, onSave }) => {
 const [form, setForm] = useState(null);
 const [isSaving, setIsSaving] = useState(false);
 const [error, setError] = useState("");
 const [poojas, setPoojas] = useState([]);

 useEffect(() => {
 const fetchPoojas = async () => {
 try {
 const token = localStorage.getItem("token") || "";
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
 if (employee) {
 setForm({
 name: employee.name || "",
 email: employee.email || "",
 phone: employee.phone || "",
 gender: employee.gender || "Male",
 dob: employee.dob ? employee.dob.split("T")[0] : "",
 bloodGroup: employee.bloodGroup || "",
 aadhaar: employee.aadhaar || "",
 emergencyContact: employee.emergencyContact || "",
 role: employee.role || "staff",
 department: employee.department || "",
 employmentType: employee.employmentType || "Full Time",
 status: employee.status || "Active",
 joiningDate: employee.joiningDate ? employee.joiningDate.split("T")[0] : "",
 salary: employee.salary || "",
 defaultShift: employee.defaultShift || employee.shift || "Morning",
 defaultDuty: employee.defaultDuty || "",
 dutyLocation: employee.dutyLocation || "",
 weeklyOff: employee.weeklyOff || "",
 bankName: employee.bankName || "",
 accountNumber: employee.accountNumber || "",
 eligiblePoojas: employee.eligiblePoojas || [],
 });
 }
 }, [employee]);

 const handleChange = (e) => {
 const { name, value } = e.target;
 setForm((prev) => {
 const updated = { ...prev, [name]: value };

 if (name === "role") {
 const departments = roleDepartmentMap[value.toLowerCase()] || [];
 updated.department = departments.length > 0 ? departments[0] : "";
 updated.defaultDuty = departmentDutyMap[updated.department]?.[0] || "";
 }
 if (name === "department") {
 updated.defaultDuty = departmentDutyMap[value]?.[0] || "";
 }

 return updated;
 });
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 setIsSaving(true);
 setError("");

 try {
 const payload = {
 name: form.name.trim(),
 email: form.email.trim(),
 phone: form.phone.trim(),
 gender: form.gender,
 dob: form.dob,
 bloodGroup: form.bloodGroup,
 aadhaar: form.aadhaar.trim(),
 emergencyContact: form.emergencyContact.trim(),
 role: form.role,
 department: form.department,
 employmentType: form.employmentType,
 status: form.status,
 joiningDate: form.joiningDate,
 salary: Number(form.salary),
 defaultShift: form.defaultShift,
 defaultDuty: form.defaultDuty,
 dutyLocation: form.dutyLocation,
 weeklyOff: form.weeklyOff,
 bankName: form.bankName,
 accountNumber: form.accountNumber,
 eligiblePoojas: form.eligiblePoojas,
 };

 await updateEmployee(employee._id, payload);
 onSave(); // Trigger parent refresh
 } catch (err) {
 setError(err.response?.data?.message || "Failed to update employee.");
 } finally {
 setIsSaving(false);
 }
 };

 if (!form) return null;

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
 <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-2xl">
 <div className="flex items-center justify-between border-b border-slate-100 p-6">
 <div>
 <h2 className="text-xl font-bold text-slate-900 dark:text-slate-200 ">Edit Employee</h2>
 <p className="text-sm text-slate-500">Update details for {employee.name}</p>
 </div>
 <button
 onClick={onClose}
 className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 hover:text-slate-600"
 >
 <FiX size={24} />
 </button>
 </div>

 <div className="flex-1 overflow-y-auto p-6">
 {error && (
 <div className="mb-6 rounded-xl bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm text-rose-600">
 {error}
 </div>
 )}

 <form id="editEmployeeForm" onSubmit={handleSubmit} className="space-y-8">
 {/* 1. Personal Details */}
 <section>
 <h3 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-200 ">Personal Details</h3>
 <div className="grid gap-4 md:grid-cols-2">
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Full Name</label>
 <input
 type="text"
 name="name"
 value={form.name}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 required
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Email Address</label>
 <input
 type="email"
 name="email"
 value={form.email}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 required
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Phone Number</label>
 <input
 type="text"
 name="phone"
 value={form.phone}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Emergency Contact</label>
 <input
 type="text"
 name="emergencyContact"
 value={form.emergencyContact}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Gender</label>
 <select
 name="gender"
 value={form.gender}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 <option value="Male">Male</option>
 <option value="Female">Female</option>
 <option value="Other">Other</option>
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Date of Birth</label>
 <input
 type="date"
 name="dob"
 value={form.dob}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Blood Group</label>
 <select
 name="bloodGroup"
 value={form.bloodGroup}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 <option value="">Select Blood Group</option>
 {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => (
 <option key={bg} value={bg}>{bg}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Aadhaar Number</label>
 <input
 type="text"
 name="aadhaar"
 value={form.aadhaar}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 </div>
 </section>

 {/* 2. Professional Details */}
 <section>
 <h3 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-200 ">Professional Details</h3>
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Status</label>
 <select
 name="status"
 value={form.status}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 font-semibold text-slate-800 dark:text-slate-200 "
 >
 <option value="Active">Active</option>
 <option value="Inactive">Inactive</option>
 <option value="On Leave">On Leave</option>
 <option value="Suspended">Suspended</option>
 <option value="Resigned">Resigned</option>
 <option value="Retired">Retired</option>
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Role</label>
 <select
 name="role"
 value={form.role}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 {employeeRoles.map((r) => (
 <option key={r.value} value={r.value}>{r.label}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Department</label>
 <select
 name="department"
 value={form.department}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 {(roleDepartmentMap[form.role.toLowerCase()] || []).map((dep) => (
 <option key={dep} value={dep}>{dep}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Joining Date</label>
 <input
 type="date"
 name="joiningDate"
 value={form.joiningDate}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Employment Type</label>
 <select
 name="employmentType"
 value={form.employmentType}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 <option value="Full Time">Full Time</option>
 <option value="Part Time">Part Time</option>
 <option value="Contract">Contract</option>
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Salary</label>
 <input
 type="number"
 name="salary"
 value={form.salary}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Default Shift</label>
 <select
 name="defaultShift"
 value={form.defaultShift}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 {shiftOptions.map((opt) => (
 <option key={opt.value} value={opt.value}>{opt.label}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Default Duty</label>
 <select
 name="defaultDuty"
 value={form.defaultDuty}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 <option value="">Select Duty</option>
 {(departmentDutyMap[form.department] || []).map((duty) => (
 <option key={duty} value={duty}>{duty}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Duty Location</label>
 <select
 name="dutyLocation"
 value={form.dutyLocation}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 <option value="">Select Location</option>
 {dutyLocations.map((loc) => (
 <option key={loc} value={loc}>{loc}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Weekly Off</label>
 <select
 name="weeklyOff"
 value={form.weeklyOff}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 <option value="">Select Day</option>
 {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => (
 <option key={day} value={day}>{day}</option>
 ))}
 </select>
 </div>
 {form.role === "priest" && (
 <div className="col-span-full">
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Eligible Poojas</label>
 <div className="grid grid-cols-2 gap-2 mt-2">
 {poojas.map(pooja => (
 <label key={pooja._id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
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
 className="accent-violet-600 w-4 h-4"
 />
 {pooja.name}
 </label>
 ))}
 </div>
 </div>
 )}
 </div>
 </section>

 {/* 3. Account Details */}
 <section>
 <h3 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-200 ">Bank Account Details</h3>
 <div className="grid gap-4 md:grid-cols-2">
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Bank Name</label>
 <select
 name="bankName"
 value={form.bankName}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 >
 {bankOptions.map((opt) => (
 <option key={opt} value={opt}>{opt || "Select Bank"}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200 ">Account Number</label>
 <input
 type="text"
 name="accountNumber"
 value={form.accountNumber}
 onChange={handleChange}
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
 />
 </div>
 </div>
 </section>
 </form>
 </div>

 <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-6 bg-slate-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] rounded-b-3xl">
 <button
 type="button"
 onClick={onClose}
 className="rounded-full px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
 >
 Cancel
 </button>
 <button
 type="submit"
 form="editEmployeeForm"
 disabled={isSaving}
 className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50"
 >
 {isSaving ? "Saving..." : "Save Changes"} <FiSave size={16} />
 </button>
 </div>
 </div>
 </div>
 );
};

export default EditEmployeeModal;
