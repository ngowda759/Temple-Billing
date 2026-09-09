import { FaBell } from "react-icons/fa";
import { FiSearch } from "react-icons/fi";
import { MdKeyboardArrowDown, MdLightMode, MdDarkMode, MdMenu } from "react-icons/md";

const Topbar = ({ darkMode, toggleDarkMode, onOpenMobileSidebar }) => {
  return (
    <div className={`h-[80px] rounded-2xl flex items-center justify-between px-5 md:px-7 sticky top-4 z-20 backdrop-blur-xl border transition-all duration-300 ${darkMode ? "bg-[#0f172a]/70 border-white/10 shadow-lg shadow-black/20" : "bg-temple-100/70 border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"}`}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          className={`lg:hidden h-11 w-11 rounded-xl flex items-center justify-center transition-colors ${darkMode ? "bg-temple-100/5 text-slate-100 hover:bg-temple-100/10" dark:hover:bg-slate-800 : "bg-temple-100 text-slate-600 hover:bg-slate-50 shadow-sm border border-slate-100"}`}
        >
          <MdMenu size={22} />
        </button>

        <div className={`hidden md:flex w-[380px] h-11 rounded-xl border flex items-center gap-3 px-4 transition-colors ${darkMode ? "border-white/10 text-slate-300 bg-[#1e293b]/50 focus-within:border-temple-500/50" : "border-slate-200 text-slate-500 bg-temple-100/50 dark:bg-[#0f172a] focus-within:bg-temple-100 focus-within:border-temple-400"}`}>
          <FiSearch className={darkMode ? "text-slate-400" : "text-slate-400"} size={18} />
          <input type="text" placeholder="Search here..." className="w-full bg-transparent outline-none text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500" />
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        <button type="button" onClick={toggleDarkMode} className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-300 hover:scale-105 ${darkMode ? "bg-temple-100/5 text-temple-400 hover:bg-temple-100/10" dark:hover:bg-slate-800 : "bg-temple-100 text-temple-600 shadow-sm border border-slate-100 hover:bg-slate-50"}`}>
          {darkMode ? <MdLightMode size={22} /> : <MdDarkMode size={22} />}
        </button>

        <div className={`relative flex h-11 w-11 items-center justify-center rounded-xl cursor-pointer transition-colors ${darkMode ? "bg-temple-100/5 text-slate-300 hover:bg-temple-100/10" dark:hover:bg-slate-800 : "bg-temple-100 text-slate-600 shadow-sm border border-slate-100 hover:bg-slate-50"}`}>
          <FaBell size={18} />
          <span className="absolute 2 top-2.5 right-2.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-[#0f172a]" />
        </div>

        <div className={`hidden sm:flex items-center gap-3 pl-4 border-l ${darkMode ? "border-white/10" : "border-slate-200"}`}>
          <div className={`grid h-11 w-11 place-items-center rounded-xl font-bold text-lg ${darkMode ? "bg-gradient-to-br from-temple-500 to-temple-600 text-white" : "bg-gradient-to-br from-temple-100 to-temple-200 text-temple-700"}`}>
            A
          </div>
          <div>
            <h3 className={`font-semibold text-sm leading-tight ${darkMode ? "text-slate-100" : "text-slate-800"}`}>Admin User</h3>
            <p className={`text-[12px] font-medium ${darkMode ? "text-temple-400" : "text-temple-600"}`}>Super Admin</p>
          </div>
          <MdKeyboardArrowDown className={`ml-1 ${darkMode ? "text-slate-400" : "text-slate-400"}`} size={20} />
        </div>
      </div>
    </div>
  );
};

export default Topbar;
