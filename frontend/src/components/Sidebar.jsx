import { sidebarItems } from "../data/sidebarData";
import { MdMenu, MdTempleBuddhist } from "react-icons/md";

const Sidebar = ({ activeItem, onSelect, collapsed, setCollapsed, mobileOpen, setMobileOpen, darkMode }) => {
  const baseItem = "relative w-full flex items-center gap-3 rounded-xl transition-all duration-300 text-left overflow-hidden group";

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 z-40 border-r transition-all duration-300 shadow-2xl lg:shadow-none ${collapsed ? "w-[88px]" : "w-[280px]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 ${darkMode ? "bg-[#0f172a]/90 backdrop-blur-xl border-white/5" : "bg-temple-100/80 backdrop-blur-xl border-slate-200"}`}
      >
        <div className={`px-4 ${collapsed ? "pt-5 pb-4" : "pt-6 pb-5"} border-b ${darkMode ? "border-white/5" : "border-slate-100"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${darkMode ? "bg-temple-500/20 text-temple-400" : "bg-gradient-to-br from-temple-50 to-temple-100 text-temple-600"}`}>
                <MdTempleBuddhist size={24} />
              </div>
              {!collapsed && (
                <h1 className={`font-serif text-[16px] leading-tight font-bold tracking-wide ${darkMode ? "text-slate-100" : "text-slate-800"}`}>
                  Sri Shanti
                  <br />
                  <span className="text-temple-500 font-sans text-[13px] font-semibold uppercase tracking-wider">Mandir</span>
                </h1>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className={`hidden lg:flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${darkMode ? "text-slate-400 hover:bg-temple-100/10 dark:hover:bg-slate-800 hover:text-slate-200" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"}`}
              aria-label="Toggle sidebar"
            >
              <MdMenu size={20} />
            </button>
          </div>
        </div>

        <div className="px-3 py-4 space-y-1.5 overflow-y-auto h-[calc(100vh-90px)] custom-scrollbar">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.title;

            return (
              <button
                key={item.title}
                type="button"
                onClick={() => {
                  onSelect(item.title);
                  setMobileOpen(false);
                }}
                className={`${baseItem} ${collapsed ? "px-3 py-3 justify-center" : "px-4 py-3"} ${isActive ? "bg-gradient-to-r from-temple-500 to-temple-600 text-white shadow-md shadow-temple-500/20" : darkMode ? "text-slate-400 hover:bg-temple-100/5 dark:hover:bg-slate-800 hover:text-slate-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900" }`}
                title={collapsed ? item.title : undefined}
              >
                {/* Active Indicator Line */}
                {isActive && (
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-temple-100/30 dark:bg-[#0f172a] rounded-r-full" />
                )}

                {/* Hover Background Effect */}
                {!isActive && (
                  <span className="absolute inset-0 bg-current opacity-0 group-hover:opacity-[0.03] transition-opacity duration-300" />
                )}

                <Icon size={20} className={`shrink-0 transition-transform duration-300 ${isActive ? "scale-110" : "group-hover:scale-110"}`} />

                {!collapsed && (
                  <span className="font-medium text-[14px]">{item.title}</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
