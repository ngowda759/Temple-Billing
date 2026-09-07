import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/common/Sidebar";
import Topbar from "../components/common/Topbar";
import LogoutModal from "../components/LogoutModal";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { sidebarItems } from "../data/sidebarData";

const findActiveItem = (path) => {
  let matched = sidebarItems.find((item) => item.path === path || item.subItems?.some((sub) => sub.path === path));
  if (matched) return matched.title;

  const sortedItems = [...sidebarItems].sort((a, b) => b.path.length - a.path.length);
  matched = sortedItems.find((item) => path.startsWith(item.path) && item.path !== "/admin");
  return matched ? matched.title : "Dashboard";
};

const AdminLayout = ({ children, onLogoutClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logoutUser } = useAuth();
  const [activeItem, setActiveItem] = useState(findActiveItem(location.pathname));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { darkMode, toggleDarkMode } = useTheme();
  const [showLogout, setShowLogout] = useState(false);

  useEffect(() => {
    setActiveItem(findActiveItem(location.pathname));
  }, [location.pathname]);

  const handleLogout = () => {
    logoutUser();
    setShowLogout(false);
    navigate("/login");
  };

  const handleSidebarLogoutClick = () => {
    if (onLogoutClick) {
      onLogoutClick();
      return;
    }
    setShowLogout(true);
  };

  return (
    <div
      className={`${
        darkMode
          ? "dark bg-[#0b1120] text-slate-100"
          : "bg-[#f5f3ef]"
      } min-h-screen transition-colors duration-300`}
    >
      <Sidebar
        activeItem={activeItem}
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
        className={`transition-all duration-300 p-4 md:p-5 ${
          collapsed
            ? "lg:ml-[84px]"
            : "lg:ml-[320px]"
        }`}
      >
        <Topbar
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
          onOpenMobileSidebar={() => setMobileOpen(true)}
          onLogoutClick={handleSidebarLogoutClick}
        />

        {typeof children === "function" ? children({ activeItem, darkMode }) : children}
      </div>

      {showLogout && (
        <LogoutModal
          onClose={() => setShowLogout(false)}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
};

export default AdminLayout;
