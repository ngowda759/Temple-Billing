import { useState, useEffect } from "react";
import { FaSignOutAlt } from "react-icons/fa";
import { MdTempleBuddhist } from "react-icons/md";
import templeBg from "../../../assets/temple-bg.jpg";
import { accountantSidebarPrimary, accountantSidebarUtility } from "../accountantDashboardData";

const AccountantSidebar = ({ activeItem = "Dashboard", onSelectItem = () => {}, onLogout = () => {} }) => {
  const [templeLogo, setTempleLogo] = useState(() => localStorage.getItem("templeLogo"));
  const [templeName, setTempleName] = useState(() => localStorage.getItem("templeName") || "Temple Billing System");

  useEffect(() => {
    const handleUpdate = () => {
      setTempleLogo(localStorage.getItem("templeLogo"));
      setTempleName(localStorage.getItem("templeName") || "Temple Billing System");
    };
    window.addEventListener("templeDataUpdated", handleUpdate);
    return () => window.removeEventListener("templeDataUpdated", handleUpdate);
  }, []);
  return (
    <aside className="accountant-sidebar" style={{ backgroundImage: `url(${templeBg})` }}>
      <div className="accountant-sidebar__scrim">
        <div className="accountant-brand">
          <div className="accountant-brand__mark flex items-center justify-center overflow-hidden" aria-hidden="true">
            {templeLogo ? <img src={templeLogo} alt="Logo" className="w-full h-full object-cover" /> : <MdTempleBuddhist />}
          </div>
          <div className="accountant-brand__text">
            <strong>{templeName}</strong>
            <span>Accountant Panel</span>
          </div>
        </div>

        <nav className="accountant-sidebar__nav" aria-label="Accountant navigation">
          <div className="accountant-sidebar__group">
            {accountantSidebarPrimary.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem === item.label;

              return (
                <button
                  key={item.label}
                  type="button"
                  className={`accountant-sidebar__item ${isActive ? "is-active" : ""}`}
                  onClick={() => onSelectItem(item.label)}
                >
                  <span className="accountant-sidebar__icon">
                    <Icon />
                  </span>
                  <span className="accountant-sidebar__label">{item.label}</span>
                </button>
              );
            })}
          </div>



          <div className="accountant-sidebar__group">
            {accountantSidebarUtility.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem === item.label;

              return (
                <button
                  key={item.label}
                  type="button"
                  className={`accountant-sidebar__item ${isActive ? "is-active" : ""}`}
                  onClick={() => onSelectItem(item.label)}
                >
                  <span className="accountant-sidebar__icon">
                    <Icon />
                  </span>
                  <span className="accountant-sidebar__label">{item.label}</span>
                </button>
              );
            })}
          </div>

          <button type="button" className="accountant-sidebar__logout" onClick={onLogout}>
            <span className="accountant-sidebar__icon">
              <FaSignOutAlt />
            </span>
            <span className="accountant-sidebar__label">Logout</span>
          </button>
        </nav>

        <p className="accountant-sidebar__footer">
          (c) 2026 Sri Shanti Mahadev Mandir
          <br />
          All rights reserved.
        </p>
      </div>
    </aside>
  );
};

export default AccountantSidebar;
