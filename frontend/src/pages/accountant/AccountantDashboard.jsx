import { useNavigate } from "react-router-dom";
import { FaBell, FaCalendarAlt, FaChevronDown, FaSignOutAlt } from "react-icons/fa";
import { MdLightMode, MdDarkMode } from "react-icons/md";
import { useState } from "react";
import AccountantSidebar from "./components/AccountantSidebar";
import AccountantPageContent from "./components/AccountantPageContent";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import "./AccountantDashboard.css";

const formatCurrentDate = () =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());

const formatWeekday = () =>
  new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
  }).format(new Date());

const AccountantDashboard = () => {
  const navigate = useNavigate();
  const { user, logoutUser } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const [activeItem, setActiveItem] = useState("Dashboard");

  const displayName = user?.name || "Accountant";
  const initials = displayName.charAt(0).toUpperCase();
  const avatarSrc = user?.photo || "";
  const currentDate = formatCurrentDate();
  const currentWeekday = formatWeekday();

  const handleLogout = () => {
    logoutUser();
    alert("Logout Successful");
    navigate("/auth-login");
  };

  return (
    <div className={`accountant-shell ${darkMode ? "dark" : ""}`}>
      <AccountantSidebar
        activeItem={activeItem}
        onSelectItem={setActiveItem}
        onLogout={handleLogout}
      />

      <main className="accountant-main">
        <header 
          className={`h-[78px] rounded-2xl flex items-center justify-between px-4 md:px-6 sticky top-4 z-20 backdrop-blur-md border transition-all duration-300
          ${
            darkMode
              ? "bg-[#1f2937]/75 border-slate-700 shadow-lg"
              : "bg-temple-100/70 dark:bg-slate-800 border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
          }`}
        >
          <div className="flex items-center gap-2 text-xl font-bold">
            <span className="text-[#b67a4a] text-2xl leading-none" aria-hidden="true">&bull;</span>
            <span className={darkMode ? "text-slate-200" : "text-[#5d3725]"}>Welcome,</span>
            <strong className="text-orange-500">{displayName}</strong>
          </div>

          <div className="flex items-center gap-3 md:gap-5">
            <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-semibold transition-colors ${
              darkMode ? "border-slate-700 bg-slate-800/50 text-slate-200" : "border-[#ece8e1] bg-[#fffaf4] text-[#6b452f]"
            }`}>
              <FaCalendarAlt className="text-orange-500" />
              <span>{currentDate}</span>
              <span className="opacity-70 font-medium">| {currentWeekday}</span>
            </div>

            <button
              type="button"
              onClick={toggleDarkMode}
              className={`h-10 w-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
                darkMode
                  ? "border-slate-700 bg-slate-800/50 text-amber-300 hover:bg-slate-800"
                  : "border-[#ece8e1] bg-temple-100 text-[#e07a22] hover:bg-slate-50"
              }`}
              aria-label="Toggle theme"
            >
              {darkMode ? <MdLightMode size={19} /> : <MdDarkMode size={19} />}
            </button>

            <button
              type="button"
              onClick={() => setActiveItem("Notifications")}
              className={`relative shrink-0 rounded-xl p-2.5 border transition-colors ${
                darkMode
                  ? "border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800"
                  : "border-[#ece8e1] bg-temple-100 text-[#5c544d] hover:bg-slate-50"
              }`}
              aria-label="Open notifications"
            >
              <FaBell size={16} className="text-orange-500" />
              <span className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-[10px] font-bold leading-none text-white border-2 border-white dark:border-slate-800">
                5
              </span>
            </button>

            <div
              onClick={() => setActiveItem("Profile")}
              className={`flex items-center shrink-0 gap-3 cursor-pointer p-1.5 pr-3 rounded-xl border transition-colors ${
                darkMode
                  ? "border-slate-700 hover:bg-slate-800 text-slate-100"
                  : "border-[#ece8e1] hover:bg-orange-50/40 text-[#1d1b19]"
              }`}
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt={displayName} className="w-9 h-9 rounded-xl object-cover border-2 border-orange-500/60" />
              ) : (
                <div className="w-9 h-9 rounded-xl border-2 border-orange-500/60 flex items-center justify-center bg-gradient-to-br from-[#7c4a2e] to-[#bf845b] text-white font-bold text-sm">
                  {initials}
                </div>
              )}
              <div className="hidden xl:block text-left">
                <h3 className="font-bold text-[13px] leading-tight">
                  {displayName}
                </h3>
                <p className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"} mt-0.5`}>
                  Accountant
                </p>
              </div>
              <FaChevronDown size={14} className={`hidden sm:block ${darkMode ? "text-slate-400" : "text-slate-500"}`} />
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className={`h-10 w-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
                darkMode
                  ? "border-slate-700 bg-slate-800/50 text-rose-400 hover:bg-slate-800"
                  : "border-[#ece8e1] bg-temple-100 text-rose-500 hover:bg-rose-50"
              }`}
              aria-label="Logout"
            >
              <FaSignOutAlt size={16} />
            </button>
          </div>
        </header>

        <div className="accountant-content">
          <AccountantPageContent
            activeItem={activeItem}
            setActiveItem={setActiveItem}
            user={user}
            currentDate={currentDate}
            currentWeekday={currentWeekday}
            darkMode={darkMode}
          />
        </div>
      </main>
    </div>
  );
};

export default AccountantDashboard;
