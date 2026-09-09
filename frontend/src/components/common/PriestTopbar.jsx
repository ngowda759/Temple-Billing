import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaBell } from "react-icons/fa";
import { FiSearch } from "react-icons/fi";
import { MdKeyboardArrowDown, MdLightMode, MdDarkMode, MdMenu } from "react-icons/md";
import { FaSignOutAlt } from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import priestAvatar from "../../assets/logo.png";

const PriestTopbar = ({ darkMode, toggleDarkMode, onOpenMobileSidebar, onLogoutClick }) => {
 const navigate = useNavigate();
 const { user } = useAuth();
 const [notificationCount, setNotificationCount] = useState(3); // Mock 3 notifications as seen in design
 const avatarSrc = user?.photo || priestAvatar;

 useEffect(() => {
 const loadNotifications = async () => {
 const storedUser = JSON.parse(localStorage.getItem("user") || "null");
 const priestId = user?._id || user?.id || storedUser?._id || storedUser?.id;
 if (!priestId) return;

 try {
 // Fetch notifications for priest if API is configured, otherwise fallback to mock count
 const response = await axios.get(`http://localhost:5000/api/notifications/priest/${priestId}`).catch(() => null);
 if (response && response.data) {
 const notifications = Array.isArray(response.data) ? response.data : [];
 setNotificationCount(notifications.filter((item) => !item.read && !item.viewed).length);
 }
 } catch (error) {
 // Fail silently and keep mock count
 }
 };

 loadNotifications();
 }, [user]);

 return (
 <div
 className={`h-[78px] rounded-2xl flex items-center justify-between px-4 md:px-6 sticky top-4 z-20 backdrop-blur-md border transition-all duration-300 ${ darkMode ? "bg-[#1f2937]/75 border-slate-700 shadow-lg" : "bg-temple-100/70 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.06)]" }`}
 >
 {/* Left side: Hamburger (mobile) and Search */}
 <div className="flex items-center gap-3">
 <button
 type="button"
 onClick={onOpenMobileSidebar}
 className={`lg:hidden h-10 w-10 rounded-xl border flex items-center justify-center transition-colors ${ darkMode ? "border-slate-700 text-slate-100 bg-slate-800/50" : "border-[#ece8e1] text-[#6b4c2e] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 <MdMenu size={20} />
 </button>

 <div
 className={`w-[220px] md:w-[340px] px-4 py-2.5 rounded-xl border flex items-center gap-3 transition-colors ${ darkMode ? "border-slate-700 text-slate-300 bg-slate-800/40" : "border-[#ece8e1] text-gray-500 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 <FiSearch className="text-orange-500 font-bold shrink-0" />
 <input
 type="text"
 placeholder="Search pooja, devotee, booking ID..."
 className={`w-full bg-transparent outline-none text-sm ${ darkMode ? "placeholder-slate-400 text-slate-100" : "placeholder-slate-500 text-[#1d1b19]" }`}
 />
 </div>
 </div>

 {/* Right side: Action items and profile card */}
 <div className="flex items-center gap-3 md:gap-5">
 {/* Dark Mode toggle */}
 <button
 type="button"
 onClick={toggleDarkMode}
 className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-colors ${ darkMode ? "border-slate-700 bg-slate-800/50 text-amber-300 hover:bg-slate-800" : "border-[#ece8e1] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#e07a22] hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 aria-label="Toggle theme"
 >
 {darkMode ? <MdLightMode size={19} /> : <MdDarkMode size={19} />}
 </button>

 {/* Notifications Bell */}
 <button
 type="button"
 onClick={() => navigate("/priest/notifications")}
 className={`relative rounded-xl p-2.5 border transition-colors ${ darkMode ? "border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800" : "border-[#ece8e1] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#5c544d] hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 aria-label="Open notifications"
 >
 <FaBell size={16} className="text-orange-500" />
 {notificationCount > 0 && (
 <span className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold leading-none text-white border-2 border-white">
 {notificationCount}
 </span>
 )}
 </button>

 {/* Profile Avatar Block */}
 <div
 onClick={() => navigate("/priest/profile")}
 className={`flex items-center gap-3 cursor-pointer p-1.5 pr-3 rounded-xl border transition-colors ${ darkMode ? "border-slate-700 hover:bg-slate-800 text-slate-100" : "border-[#ece8e1] hover:bg-orange-50/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#1d1b19]" }`}
 >
 <img
 src={avatarSrc}
 alt="Priest profile"
 className="w-9 h-9 rounded-xl object-cover border-2 border-orange-500/60"
 onError={(e) => {
 e.currentTarget.src = priestAvatar;
 }}
 />
 <div className="hidden sm:block text-left">
 <h3 className="font-bold text-[13px] leading-tight">
 {user?.name || "Priest"}
 </h3>
 <p className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"} mt-0.5`}>
 Priest
 </p>
 </div>
 <MdKeyboardArrowDown size={16} className={`${darkMode ? "text-slate-400" : "text-slate-500"}`} />
 </div>
 
 {/* Logout Button */}
 <button
 type="button"
 onClick={onLogoutClick}
 className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-colors ${ darkMode ? "border-slate-700 bg-slate-800/50 text-rose-400 hover:bg-slate-800" : "border-[#ece8e1] bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-rose-500 hover:bg-rose-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 aria-label="Logout"
 >
 <FaSignOutAlt size={16} />
 </button>
 </div>
 </div>
 );
};

export default PriestTopbar;
