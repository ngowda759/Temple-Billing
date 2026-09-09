import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { createUserByAdmin, getAdminUsers } from "../../services/authService";

const roles = ["admin", "accountant", "cashier", "priest", "staff"];

const MemberManagement = () => {
 const navigate = useNavigate();
 const { token } = useAuth();
 const [formData, setFormData] = useState({
 name: "",
 email: "",
 password: "",
 role: "staff",
 });
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [message, setMessage] = useState(null);
 const [users, setUsers] = useState([]);
 const [loadingUsers, setLoadingUsers] = useState(false);
 const [usersError, setUsersError] = useState(null);

 const handleChange = (e) => {
 setFormData((prev) => ({
 ...prev,
 [e.target.name]: e.target.value,
 }));
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 setMessage(null);

 if (!formData.name || !formData.email || !formData.password || !formData.role) {
 setMessage({ type: "error", text: "Please fill all fields." });
 return;
 }

 const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
 if (!emailRegex.test(formData.email.trim())) {
 setMessage({ type: "error", text: "Please enter a valid email address." });
 return;
 }

 try {
 setIsSubmitting(true);
 await createUserByAdmin(formData, token);
 setMessage({ type: "success", text: `${formData.role} created successfully.` });
 setFormData({ name: "", email: "", password: "", role: "staff" });
 fetchUsers();
 } catch (error) {
 setMessage({ type: "error", text: error.response?.data?.message || "Could not create member." });
 } finally {
 setIsSubmitting(false);
 }
 };

 const fetchUsers = async () => {
 setUsersError(null);
 setLoadingUsers(true);
 try {
 const data = await getAdminUsers(token);
 setUsers(data);
 } catch (error) {
 setUsersError(error.response?.data?.message || "Unable to load existing members.");
 } finally {
 setLoadingUsers(false);
 }
 };

 useEffect(() => {
 if (token) {
 fetchUsers();
 }
 }, [token]);

 return (
 <div className="space-y-6 mt-5">
 <div className="rounded-3xl bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400 p-8 shadow-xl text-white">
 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
 <div>
 <h1 className="text-4xl font-bold">Member Management</h1>
 <p className="mt-3 max-w-2xl text-orange-100">Create new staff accounts for priest, cashier, accountant, and staff roles with secure email/password login.</p>
 </div>
 <button
 type="button"
 onClick={() => navigate("/admin")}
 className="rounded-2xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-6 py-3 font-semibold text-orange-700 shadow-lg"
 >
 Back to Dashboard
 </button>
 </div>
 </div>

 <div className="rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-xl p-8 border border-[#ece8e1] dark:border-slate-700 ">
 <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-200 mb-4">Add New Member</h2>

 {message && (
 <div className={`rounded-2xl p-4 mb-6 ${message.type === "success" ? "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-800" : "bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-rose-800"}`}>
 {message.text}
 </div>
 )}

 <form onSubmit={handleSubmit} className="grid gap-5 md:grid-cols-2">
 <div className="space-y-3">
 <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 ">Full Name</label>
 <input
 name="name"
 value={formData.name}
 onChange={handleChange}
 placeholder="Enter full name"
 className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 outline-none focus:border-orange-400"
 required
 />
 </div>

 <div className="space-y-3">
 <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 ">Email Address</label>
 <input
 type="email"
 name="email"
 value={formData.email}
 onChange={handleChange}
 placeholder="user@example.com"
 className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 outline-none focus:border-orange-400"
 required
 />
 </div>

 <div className="space-y-3 md:col-span-2">
 <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 ">Password</label>
 <input
 type="password"
 name="password"
 value={formData.password}
 onChange={handleChange}
 placeholder="Choose a secure password"
 className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 outline-none focus:border-orange-400"
 minLength={6}
 required
 />
 </div>

 <div className="space-y-3">
 <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 ">Role</label>
 <select
 name="role"
 value={formData.role}
 onChange={handleChange}
 className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 outline-none focus:border-orange-400"
 required
 >
 {roles.map((role) => (
 <option key={role} value={role}>{role}</option>
 ))}
 </select>
 </div>

 <div className="md:col-span-2">
 <button
 type="submit"
 disabled={isSubmitting}
 className="w-full rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-4 text-lg font-semibold text-white shadow-xl transition hover:from-orange-600 hover:to-amber-600"
 >
 {isSubmitting ? "Creating member..." : "Create Member"}
 </button>
 </div>
 </form>
 </div>

 <div className="rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow-xl p-8 border border-[#ece8e1] dark:border-slate-700 ">
 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
 <div>
 <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-200 ">Existing Members</h2>
 <p className="text-sm text-slate-500 dark:text-slate-200 ">View all assigned roles and staff accounts created by admin.</p>
 </div>
 <button
 type="button"
 onClick={fetchUsers}
 className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
 >
 Refresh list
 </button>
 </div>

 {loadingUsers ? (
 <div className="text-slate-600 dark:text-slate-200 ">Loading members...</div>
 ) : usersError ? (
 <div className="rounded-2xl bg-rose-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-rose-700">{usersError}</div>
 ) : (
 <div className="overflow-x-auto">
 <table className="min-w-full divide-y divide-slate-200 text-sm">
 <thead className="bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-700 dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3 text-left font-semibold">Name</th>
 <th className="px-4 py-3 text-left font-semibold">Email</th>
 <th className="px-4 py-3 text-left font-semibold">Role</th>
 <th className="px-4 py-3 text-left font-semibold">Created</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 {users.length > 0 ? (
 users.map((user) => (
 <tr key={user.id}>
 <td className="px-4 py-3 text-slate-900 dark:text-slate-200 ">{user.name}</td>
 <td className="px-4 py-3 text-slate-600 dark:text-slate-200 ">{user.email}</td>
 <td className="px-4 py-3 text-slate-700 dark:text-slate-200 capitalize">{user.role}</td>
 <td className="px-4 py-3 text-slate-500 dark:text-slate-200 ">{new Date(user.createdAt || user.updatedAt || Date.now()).toLocaleDateString()}</td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan={4} className="px-4 py-6 text-center text-slate-500 dark:text-slate-200 ">
 No members found yet.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 );
};

export default MemberManagement;
