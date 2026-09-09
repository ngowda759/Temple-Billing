import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";


import Sidebar from "../../components/common/Sidebar";
import Topbar from "../../components/common/Topbar";
import LogoutModal from "../../components/LogoutModal";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { cashierSidebarItems } from "../../data/cashierSidebarData";

const findActiveItem = (path) => {
 const matched = cashierSidebarItems.find(
 (item) => item.path === path || item.subItems?.some((sub) => sub.path === path)
 );
 return matched ? matched.title : "Dashboard";
};

const CashierShell = ({ children }) => {
 const location = useLocation();
 const navigate = useNavigate();
 const { logoutUser } = useAuth();

 const [activeItem, setActiveItem] = useState(findActiveItem(location.pathname));
 const [collapsed, setCollapsed] = useState(false);
 const [mobileOpen, setMobileOpen] = useState(false);
 const { darkMode, toggleDarkMode } = useTheme();
 const [showLogout, setShowLogout] = useState(false);

 const handleLogout = () => {
 logoutUser();
 setShowLogout(false);
 navigate("/login");
 };

 const handleSidebarLogoutClick = () => {
 setShowLogout(true);
 };

 const activeItemMemo = useMemo(() => {
 return findActiveItem(location.pathname);
 }, [location.pathname]);

 return (
 <div className="min-h-screen transition-colors duration-300">
 <Sidebar
 items={cashierSidebarItems}
 activeItem={activeItemMemo}
 activePath={location.pathname}
 onSelect={setActiveItem}
 onNavigate={(path) => navigate(path)}
 collapsed={collapsed}
 setCollapsed={setCollapsed}
 mobileOpen={mobileOpen}
 setMobileOpen={setMobileOpen}
 darkMode={darkMode}
 onLogoutClick={handleSidebarLogoutClick}
 />

 <div
 className={`transition-all duration-300 p-4 md:p-5 ${collapsed ? "lg:ml-[84px]" : "lg:ml-[254px]"}`}
 >
 <Topbar
 darkMode={darkMode}
 toggleDarkMode={toggleDarkMode}
 onOpenMobileSidebar={() => setMobileOpen(true)}
 />

 {children}
 </div>

 {showLogout && (
 <LogoutModal onClose={() => setShowLogout(false)} onLogout={handleLogout} />
 )}
 </div>
 );
};

export default CashierShell;

