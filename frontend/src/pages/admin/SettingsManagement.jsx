import { useState } from "react";
import {
 MdTempleBuddhist,
 MdPerson,
 MdNotificationsNone,
 MdOutlineVisibility,
 MdOutlineVisibilityOff,
 MdOutlineKeyboardArrowDown,
} from "react-icons/md";
import { useAuth } from "../../context/AuthContext";
import { changePassword } from "../../services/authService";

const fieldClass =
 "h-9 w-full rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 text-sm text-[#202632] outline-none transition focus:border-[#ff8b00]";

const sectionClass =
 "rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-[#fffdfb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-5 shadow-sm";

const sectionTitleClass =
 "text-[20px] font-bold text-[#17151f]";

const Toggle = ({ checked, onChange }) => (
 <label className="relative inline-flex h-6 w-11 cursor-pointer items-center">
 <input
 type="checkbox"
 checked={checked}
 onChange={onChange}
 className="peer sr-only"
 />
 <span className="h-6 w-11 rounded-full bg-[#d7dbe1] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition peer-checked:bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " />
 <span className="absolute left-0.5 h-5 w-5 rounded-full bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] transition peer-checked:translate-x-5" />
 </label>
);

const SettingsManagement = () => {
 const { user, token, updateUser } = useAuth();

 // Temple Info State
 const [templeName, setTempleName] = useState(() => localStorage.getItem("templeName") || "Sri Shanti Mahadev Mandir");
 const [templeAddress, setTempleAddress] = useState(() => localStorage.getItem("templeAddress") || "1-8-276/A, Kukatpally, Hyderabad, Telangana - 500072");
 const [templePhone, setTemplePhone] = useState(() => localStorage.getItem("templePhone") || "040-12345678");
 const [templeEmail, setTempleEmail] = useState(() => localStorage.getItem("templeEmail") || "info@ssmm.in");
 const [templeGst, setTempleGst] = useState(() => localStorage.getItem("templeGst") || "36AAATS1234A1Z5");
 const [templeLogo, setTempleLogo] = useState(() => localStorage.getItem("templeLogo") || null);

 // Admin Account Settings State
 const [fullName, setFullName] = useState(user?.name || "Admin");
 const [email, setEmail] = useState(user?.email || "admin@ssmm.in");
 const [username, setUsername] = useState(user?.username || "superadmin");

 // Password States
 const [currentPass, setCurrentPass] = useState("");
 const [newPass, setNewPass] = useState("");
 const [confirmPass, setConfirmPass] = useState("");

 // Visibility States
 const [showCurrentPass, setShowCurrentPass] = useState(false);
 const [showNewPass, setShowNewPass] = useState(false);
 const [showConfirmPass, setShowConfirmPass] = useState(false);

 // Notification States
 const [smsNotifications, setSmsNotifications] = useState(() => JSON.parse(localStorage.getItem("smsNotifications") ?? "true"));
 const [emailAlerts, setEmailAlerts] = useState(() => JSON.parse(localStorage.getItem("emailAlerts") ?? "true"));
 const [bookingReminders, setBookingReminders] = useState(() => JSON.parse(localStorage.getItem("bookingReminders") ?? "true"));
 const [festivalAnnouncements, setFestivalAnnouncements] = useState(() => JSON.parse(localStorage.getItem("festivalAnnouncements") ?? "true"));
 const [paymentReceipts, setPaymentReceipts] = useState(() => JSON.parse(localStorage.getItem("paymentReceipts") ?? "true"));
 const [systemUpdates, setSystemUpdates] = useState(() => JSON.parse(localStorage.getItem("systemUpdates") ?? "false"));
 const [marketingNotifications, setMarketingNotifications] = useState(() => JSON.parse(localStorage.getItem("marketingNotifications") ?? "false"));

 // Status Alerts
 const [templeMsg, setTempleMsg] = useState("");
 const [profileMsg, setProfileMsg] = useState("");
 const [passwordMsg, setPasswordMsg] = useState("");
 const [notificationMsg, setNotificationMsg] = useState("");

 const handleSaveTempleChanges = () => {
 localStorage.setItem("templeName", templeName);
 localStorage.setItem("templeAddress", templeAddress);
 localStorage.setItem("templePhone", templePhone);
 localStorage.setItem("templeEmail", templeEmail);
 localStorage.setItem("templeGst", templeGst);
 if (templeLogo) {
 localStorage.setItem("templeLogo", templeLogo);
 }
 
 window.dispatchEvent(new Event("templeDataUpdated"));
 
 setTempleMsg("Temple information saved successfully!");
 setTimeout(() => setTempleMsg(""), 3000);
 };

 const handleUpdateProfile = () => {
 const updatedUser = {
 ...user,
 name: fullName,
 email: email,
 username: username,
 };
 updateUser(updatedUser);
 setProfileMsg("Profile details updated successfully!");
 setTimeout(() => setProfileMsg(""), 3000);
 };

 const handleResetPassword = async () => {
 if (!currentPass || !newPass || !confirmPass) {
 setPasswordMsg("Please fill in all password fields.");
 setTimeout(() => setPasswordMsg(""), 3000);
 return;
 }
 if (newPass !== confirmPass) {
 setPasswordMsg("New password and confirm password do not match.");
 setTimeout(() => setPasswordMsg(""), 3000);
 return;
 }

 try {
 await changePassword({ token, currentPassword: currentPass, newPassword: newPass });
 setPasswordMsg("Password changed successfully!");
 setCurrentPass("");
 setNewPass("");
 setConfirmPass("");
 } catch (err) {
 console.error(err);
 setPasswordMsg(err.response?.data?.message || "Failed to reset password.");
 }
 setTimeout(() => setPasswordMsg(""), 3000);
 };

 const handleSavePreferences = () => {
 localStorage.setItem("smsNotifications", JSON.stringify(smsNotifications));
 localStorage.setItem("emailAlerts", JSON.stringify(emailAlerts));
 localStorage.setItem("bookingReminders", JSON.stringify(bookingReminders));
 localStorage.setItem("festivalAnnouncements", JSON.stringify(festivalAnnouncements));
 localStorage.setItem("paymentReceipts", JSON.stringify(paymentReceipts));
 localStorage.setItem("systemUpdates", JSON.stringify(systemUpdates));
 localStorage.setItem("marketingNotifications", JSON.stringify(marketingNotifications));

 setNotificationMsg("Notification preferences saved successfully!");
 setTimeout(() => setNotificationMsg(""), 3000);
 };

 const avatarSrc = user?.photo || "";
 const avatarInitial = (fullName || "Admin").charAt(0).toUpperCase();
 const displayRole = user?.role === "admin"
 ? "Super Admin"
 : user?.role
 ? `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`
 : "Super Admin";

 return (
 <div className="mt-5 space-y-4 pb-6">
 {/* HEADER */}
 <div>
 <h1 className={sectionTitleClass}>Settings</h1>
 <p className="text-[15px] text-[#5c6675]">
 Manage system preferences, temple details, accounts, notifications and security.
 </p>
 <div className="mt-2 h-1 w-12 rounded-full bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] " />
 </div>

 {/* TOP GRID */}
 <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
 {/* TEMPLE INFO */}
 <div className={`${sectionClass} xl:col-span-3`}>
 <div className="mb-4 flex items-center gap-2">
 <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ff8b00]">
 <MdTempleBuddhist size={20} />
 </span>
 <h3 className="text-[20px] font-bold text-[#1d1b19] dark:text-slate-200 ">
 Temple Information
 </h3>
 </div>

 <div className="space-y-2 text-sm">
 <p>Temple Name</p>
 <input
 value={templeName}
 onChange={(e) => setTempleName(e.target.value)}
 className={fieldClass}
 />

 <p>Address</p>
 <textarea
 value={templeAddress}
 onChange={(e) => setTempleAddress(e.target.value)}
 className="w-full rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-2 text-sm text-[#202632] dark:text-slate-200 outline-none transition focus:border-[#ff8b00]"
 rows={2}
 />

 <p>Phone</p>
 <input
 value={templePhone}
 onChange={(e) => setTemplePhone(e.target.value)}
 className={fieldClass}
 />

 <p>Email</p>
 <input
 value={templeEmail}
 onChange={(e) => setTempleEmail(e.target.value)}
 className={fieldClass}
 />

 <p>GST Number</p>
 <input
 value={templeGst}
 onChange={(e) => setTempleGst(e.target.value)}
 className={fieldClass}
 />

 <div className="pt-1">
 <p className="mb-2">Temple Logo</p>
 <div className="flex items-center gap-3">
 <div className="flex h-14 w-14 overflow-hidden items-center justify-center rounded-full border border-[#ece8e1] dark:border-slate-700 bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#ff8b00]">
 {templeLogo ? (
 <img src={templeLogo} alt="Temple Logo" className="h-full w-full object-cover" />
 ) : (
 <MdTempleBuddhist size={22} />
 )}
 </div>
 <label className="flex h-10 cursor-pointer items-center justify-center rounded-lg border border-[#f4caa8] dark:border-slate-700 px-3 text-sm font-semibold text-[#f07f00] hover:bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors">
 Change Logo
 <input 
 type="file" 
 className="hidden" 
 accept="image/*" 
 onChange={(e) => {
 const file = e.target.files[0];
 if (file) {
 const reader = new FileReader();
 reader.onloadend = () => setTempleLogo(reader.result);
 reader.readAsDataURL(file);
 }
 }} 
 />
 </label>
 </div>
 </div>

 {templeMsg && (
 <p className="mt-1 text-xs font-semibold text-green-600">{templeMsg}</p>
 )}

 <button
 onClick={handleSaveTempleChanges}
 className="mt-2 h-10 w-full rounded-lg bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-sm font-semibold text-white transition-all duration-300 hover:scale-[1.01] hover:bg-[#ef7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Save Changes
 </button>
 </div>
 </div>

 {/* ADMIN SETTINGS */}
 <div className={`${sectionClass} xl:col-span-3`}>
 <div className="mb-4 flex items-center gap-2">
 <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-violet-700">
 <MdPerson size={20} />
 </span>
 <h3 className="text-[20px] font-bold text-[#1d1b19] dark:text-slate-200 ">
 Admin Account Settings
 </h3>
 </div>

 <div className="space-y-2 text-sm">
 <p>Full Name</p>
 <input
 value={fullName}
 onChange={(e) => setFullName(e.target.value)}
 className={fieldClass}
 />

 <p>Email</p>
 <input
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 className={fieldClass}
 />

 <p>Username</p>
 <input
 value={username}
 onChange={(e) => setUsername(e.target.value)}
 className={fieldClass}
 />

 <p>Current Password</p>
 <div className="relative">
 <input
 type={showCurrentPass ? "text" : "password"}
 value={currentPass}
 onChange={(e) => setCurrentPass(e.target.value)}
 placeholder="••••••••"
 className={`${fieldClass} pr-9`}
 />
 <button
 type="button"
 onClick={() => setShowCurrentPass(!showCurrentPass)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b8492]"
 >
 {showCurrentPass ? <MdOutlineVisibilityOff size={18} /> : <MdOutlineVisibility size={18} />}
 </button>
 </div>

 <p>New Password</p>
 <div className="relative">
 <input
 type={showNewPass ? "text" : "password"}
 value={newPass}
 onChange={(e) => setNewPass(e.target.value)}
 placeholder="••••••••"
 className={`${fieldClass} pr-9`}
 />
 <button
 type="button"
 onClick={() => setShowNewPass(!showNewPass)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b8492]"
 >
 {showNewPass ? <MdOutlineVisibilityOff size={18} /> : <MdOutlineVisibility size={18} />}
 </button>
 </div>

 <p>Confirm Password</p>
 <div className="relative">
 <input
 type={showConfirmPass ? "text" : "password"}
 value={confirmPass}
 onChange={(e) => setConfirmPass(e.target.value)}
 placeholder="••••••••"
 className={`${fieldClass} pr-9`}
 />
 <button
 type="button"
 onClick={() => setShowConfirmPass(!showConfirmPass)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b8492]"
 >
 {showConfirmPass ? <MdOutlineVisibilityOff size={18} /> : <MdOutlineVisibility size={18} />}
 </button>
 </div>

 {profileMsg && (
 <p className="mt-1 text-xs font-semibold text-green-600">{profileMsg}</p>
 )}
 {passwordMsg && (
 <p className={`mt-1 text-xs font-semibold ${passwordMsg.includes("successfully") ? "text-green-600" : "text-red-600"}`}>
 {passwordMsg}
 </p>
 )}

 <div className="mt-2 flex gap-2">
 <button
 onClick={handleUpdateProfile}
 className="h-10 flex-1 rounded-lg bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-sm font-semibold text-white transition-all duration-300 hover:scale-[1.01] hover:bg-[#ef7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Update Profile
 </button>
 <button
 onClick={handleResetPassword}
 className="h-10 flex-1 rounded-lg border border-[#ece8e1] dark:border-slate-700 text-sm font-semibold text-[#4b5563] dark:text-slate-200 hover:bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 Reset Password
 </button>
 </div>
 </div>
 </div>

 {/* NOTIFICATIONS */}
 <div className={`${sectionClass} xl:col-span-3`}>
 <div className="mb-4 flex items-center gap-2">
 <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-green-700">
 <MdNotificationsNone size={20} />
 </span>
 <h3 className="text-[20px] font-bold text-[#1d1b19] dark:text-slate-200 ">
 Notification Settings
 </h3>
 </div>

 <div className="space-y-3 pt-2 text-sm text-[#252b37] dark:text-slate-200 ">
 <div className="flex items-center justify-between">
 <span>SMS Notifications</span>
 <Toggle checked={smsNotifications} onChange={(e) => setSmsNotifications(e.target.checked)} />
 </div>
 <div className="flex items-center justify-between">
 <span>Email Alerts</span>
 <Toggle checked={emailAlerts} onChange={(e) => setEmailAlerts(e.target.checked)} />
 </div>
 <div className="flex items-center justify-between">
 <span>Booking Reminders</span>
 <Toggle checked={bookingReminders} onChange={(e) => setBookingReminders(e.target.checked)} />
 </div>
 <div className="flex items-center justify-between">
 <span>Festival Announcements</span>
 <Toggle checked={festivalAnnouncements} onChange={(e) => setFestivalAnnouncements(e.target.checked)} />
 </div>
 <div className="flex items-center justify-between">
 <span>Payment Receipts</span>
 <Toggle checked={paymentReceipts} onChange={(e) => setPaymentReceipts(e.target.checked)} />
 </div>
 <div className="flex items-center justify-between">
 <span>System Updates</span>
 <Toggle checked={systemUpdates} onChange={(e) => setSystemUpdates(e.target.checked)} />
 </div>
 <div className="flex items-center justify-between">
 <span>Marketing Notifications</span>
 <Toggle checked={marketingNotifications} onChange={(e) => setMarketingNotifications(e.target.checked)} />
 </div>
 </div>

 {notificationMsg && (
 <p className="mt-3 text-xs font-semibold text-green-600">{notificationMsg}</p>
 )}

 <button
 onClick={handleSavePreferences}
 className="mt-5 h-10 w-full rounded-lg bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-sm font-semibold text-white transition-all duration-300 hover:scale-[1.01] hover:bg-[#ef7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Save Preferences
 </button>
 </div>

 {/* ADMIN PROFILE */}
 <div className={`${sectionClass} xl:col-span-3`}>
 <h3 className="text-[20px] font-bold text-[#1d1b19] dark:text-slate-200 ">
 Admin Profile
 </h3>

 <div className="mt-3 flex items-center gap-3">
 <div className="h-20 w-20 overflow-hidden rounded-full border border-[#ece8e1] dark:border-slate-700 bg-[#f8f5ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] ">
 {avatarSrc ? (
 <img
 src={avatarSrc}
 alt={fullName}
 className="h-full w-full object-cover"
 />
 ) : (
 <div className="grid h-full w-full place-items-center text-2xl font-bold text-[#ff8b00]">
 {avatarInitial}
 </div>
 )}
 </div>

 <div>
 <p className="text-[18px] font-bold text-[#17151f] dark:text-slate-200 ">
 {fullName}
 </p>
 <span className="mt-1 inline-block rounded-full bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 py-1 text-sm font-semibold text-[#b66000]">
 {displayRole}
 </span>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default SettingsManagement;
