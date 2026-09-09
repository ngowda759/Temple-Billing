import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./CashierDashboard.css";
import {
 AreaChart,
 Area,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
 PieChart,
 Pie,
 Cell,
} from "recharts";

import {
 FaChartBar,
 FaBell,
 FaChevronDown,
 FaSearch,
 FaQrcode,
 FaArrowUp,
 FaEye,
 FaCheck,
 FaClock,
 FaFileInvoice,
 FaHeart,
 FaPrint,
 FaDownload,
 FaCreditCard,
 FaCalendarAlt,
 FaBox,
 FaReceipt,
 FaHistory,
 FaHome,
 FaSignOutAlt,
} from "react-icons/fa";

import { cashierSidebarItems } from "../../data/cashierSidebarData";

// SVG Logos
const TempleLogo = () => (
 <svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M50 5L85 45H15L50 5Z" fill="url(#goldGrad)" />
 <path d="M50 20L75 50H25L50 20Z" fill="url(#goldGradLight)" />
 <rect x="25" y="50" width="50" height="40" rx="4" fill="url(#goldGrad)" />
 <rect x="42" y="65" width="16" height="25" rx="2" fill="#2E0209" />
 <circle cx="50" cy="72" r="2" fill="#D4AF37" />
 <path d="M50 0V5" stroke="#D4AF37" strokeWidth="3" />
 <circle cx="50" cy="-2" r="2" fill="#D4AF37" />
 <defs>
 <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0%" stopColor="#F59E0B" />
 <stop offset="100%" stopColor="#D97706" />
 </linearGradient>
 <linearGradient id="goldGradLight" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0%" stopColor="#FBBF24" />
 <stop offset="100%" stopColor="#F59E0B" />
 </linearGradient>
 </defs>
 </svg>
);

const TempleWatermark = () => (
 <svg width="100%" height="220" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.15 }}>
 <path d="M100 10L170 90H30L100 10Z" stroke="#F59E0B" strokeWidth="2" />
 <path d="M100 35L150 90H50L100 35Z" stroke="#F59E0B" strokeWidth="2" />
 <path d="M100 60L130 90H70L100 60Z" stroke="#F59E0B" strokeWidth="2" />
 <rect x="50" y="90" width="100" height="80" stroke="#F59E0B" strokeWidth="2" />
 <rect x="85" y="120" width="30" height="50" stroke="#F59E0B" strokeWidth="2" />
 <path d="M100 2V10" stroke="#F59E0B" strokeWidth="2" />
 <circle cx="100" cy="2" r="2" fill="#F59E0B" />
 </svg>
);

const CashierDashboard = () => {
 const [activeMenu, setActiveMenu] = useState("Dashboard");
 const navigate = useNavigate();
 // Chart data
 const revenueData = [
 { name: "14 May", amount: 18000 },
 { name: "15 May", amount: 28000 },
 { name: "16 May", amount: 48000 },
 { name: "17 May", amount: 32000 },
 { name: "18 May", amount: 52000 },
 { name: "19 May", amount: 42000 },
 { name: "20 May", amount: 68450 },
 ];

 const paymentData = [
 { name: "UPI", value: 45, color: "#7C3AED" },
 { name: "Cash", value: 30, color: "#10B981" },
 { name: "Card", value: 15, color: "#2563EB" },
 { name: "Net Banking", value: 10, color: "#F59E0B" },
 ];



 const statCards = [
 {
 title: "Today's Collection",
 value: "₹ 68,450",
 change: "18.6% from yesterday",
 trend: "up",
 color: "orange",
 icon: <div className="stat-icon-container orange-icon"><span className="coin-sack-icon">💰</span></div>
 },
 {
 title: "Total Transactions",
 value: "128",
 change: "12.4% from yesterday",
 trend: "up",
 color: "indigo",
 icon: <div className="stat-icon-container indigo-icon"><FaFileInvoice className="text-white text-lg" /></div>
 },
 
 
 {
 title: "Pooja Bookings",
 value: "42",
 change: "10.1%",
 trend: "up",
 color: "blue",
 icon: <div className="stat-icon-container blue-icon"><span className="pooja-icon">🛕</span></div>
 },
 {
 title: "Prasadam Sales",
 value: "₹ 12,780",
 change: "14.5%",
 trend: "up",
 color: "peach",
 icon: <div className="stat-icon-container peach-icon"><span className="prasadam-icon">🍊</span></div>
 }
 ];

 return (
 <div className="dashboard-container">
 {/* SIDEBAR */}
 <div className="sidebar">
 <div className="sidebar-brand">
 <div className="brand-logo-circle">
 <TempleLogo />
 </div>
 <div>
 <div className="brand-title">Sri Shanti Mahadev Mandir</div>
 <div className="brand-subtitle">Established 1982</div>
 </div>
 </div>

 <div className="sidebar-profile">
 <div className="profile-img-wrapper">
 <div className="grid h-full w-full place-items-center rounded-full bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 font-bold text-orange-600">
 C
 </div>
 <span className="online-indicator"></span>
 </div>
 <div className="profile-info">
 <h3>Cashier</h3>
 <p>Online</p>
 </div>
 </div>

 <ul className="sidebar-menu">
 {cashierSidebarItems.map((item) => {
 const Icon = item.icon;
 const isActive = activeMenu === item.title;
 return (
 <li
 key={item.title}
 className={`menu-item ${isActive ? "active" : ""}`}
 onClick={() => {
 setActiveMenu(item.title);
 navigate(item.path);
 }}
 >
 <span className="menu-icon">
 <Icon size={18} />
 </span>
 <span className="menu-text">{item.title}</span>
 </li>
 );
 })}
 </ul>

 <div className="sidebar-footer-drawing">
 <TempleWatermark />
 </div>
 </div>

 {/* MAIN CONTENT AREA */}
 <div className="main-viewport">
 {/* HEADER */}
 <header className="viewport-header">
 <div className="header-left">
 <div className="hamburger-menu">
 <span></span>
 <span></span>
 <span></span>
 </div>
 <div className="header-title-container">
 <span className="header-temple-icon">🛕</span>
 <h1 className="header-title">Temple Billing System</h1>
 <span className="cashier-badge">Cashier Dashboard</span>
 </div>
 </div>

 <div className="header-center">
 <div className="search-bar-wrapper">
 <FaSearch className="search-icon" />
 <input type="text" placeholder="Search anything..." />
 </div>
 </div>

 <div className="header-right">
 <div className="icon-badge-btn">
 <FaBell />
 <span className="notification-dot">5</span>
 </div>
 <div className="icon-btn">
 <FaQrcode />
 </div>
 <div className="divider"></div>
 <div className="user-dropdown-btn">
 <div className="grid user-avatar place-items-center rounded-full bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 font-bold text-orange-600">
 C
 </div>
 <div className="user-names">
 <span className="user-role">Cashier</span>
 <span className="user-welcome">Welcome!</span>
 </div>
 <FaChevronDown className="dropdown-arrow" />
 </div>
 </div>
 </header>

 {/* MAIN BODY SCROLL CONTAINER */}
 {/* MAIN BODY SCROLL CONTAINER */}
<div className="main-body-content">
 {/* STATS ROW */}
 <div className="stats-grid">
 {statCards.map((card, i) => (
 <div key={i} className={`stat-card card-style-${card.color}`}>
 <div className="stat-header">
 <span className="stat-title">{card.title}</span>
 {card.icon}
 </div>
 <div className="stat-value">{card.value}</div>
 <div className="stat-footer">
 {card.trend === "up" && (
 <span className="trend-arrow-up">
 <FaArrowUp />
 </span>
 )}
 <span className="stat-change">{card.change}</span>
 </div>
 </div>
 ))}
 </div>

 {/* MIDDLE CHARTS AND WIDGETS ROW */}
 <div className="charts-widgets-row">
 {/* LINE CHART */}
 <div className="chart-box daily-revenue-box">
 <div className="box-header">
 <h3>Daily Revenue Overview</h3>
 <div className="revenue-today-tag">
 Today: <span className="tag-bold">₹ 68,450</span>
 </div>
 </div>
 <div className="chart-wrapper">
 <ResponsiveContainer width="100%" height={260}>
 <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
 <defs>
 <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.4} />
 <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
 <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11 }} />
 <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11 }} />
 <Tooltip
 contentStyle={{ background: "#1E293B", borderRadius: "8px", border: "none", color: "#FFF" }}
 labelStyle={{ color: "#94A3B8" }}
 />
 <Area type="monotone" dataKey="amount" stroke="#F59E0B" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" dot={{ stroke: "#F59E0B", strokeWidth: 2, r: 4, fill: "#FFF" }} />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </div>

 {/* DONUT CHART */}
 <div className="chart-box payment-methods-box">
 <div className="box-header">
 <h3>Payment Methods</h3>
 </div>
 <div className="donut-chart-container">
 <div className="donut-wrapper">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={paymentData}
 cx="50%"
 cy="50%"
 innerRadius={60}
 outerRadius={80}
 paddingAngle={3}
 dataKey="value"
 >
 {paymentData.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={entry.color} />
 ))}
 </Pie>
 </PieChart>
 </ResponsiveContainer>
 <div className="donut-center-text">
 <span className="donut-total-val">₹ 68,450</span>
 <span className="donut-total-lbl">Total</span>
 </div>
 </div>
 <div className="donut-legend">
 {paymentData.map((item, index) => (
 <div key={index} className="legend-item">
 <div className="legend-marker-wrapper">
 <span className="legend-dot" style={{ backgroundColor: item.color }}></span>
 <span className="legend-name">{item.name}</span>
 </div>
 <span className="legend-percent">{item.value}%</span>
 </div>
 ))}
 </div>
 </div>
 </div>

 {/* SIDE COLUMN WIDGETS */}
 <div className="side-widgets-column">
 {/* Recent Donations */}
 <div className="widget-card">
 <div className="widget-header">
 <h4>Recent Donations</h4>
 <a href="#all-donations" className="view-all-link">View All</a>
 </div>
 <ul className="widget-list">
 <li className="list-item">
 <div className="item-meta">
 <span className="avatar-initial orange-bg">R</span>
 <div>
 <span className="item-title">Ramesh Kumar</span>
 <span className="item-subtitle text-upi">● UPI</span>
 </div>
 </div>
 <span className="item-value">₹ 2,000</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="avatar-initial green-bg">S</span>
 <div>
 <span className="item-title">Suresh Reddy</span>
 <span className="item-subtitle text-cash">● Cash</span>
 </div>
 </div>
 <span className="item-value">₹ 1,500</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="avatar-initial blue-bg">L</span>
 <div>
 <span className="item-title">Lakshmi Devi</span>
 <span className="item-subtitle text-card">● Card</span>
 </div>
 </div>
 <span className="item-value">₹ 1,000</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="avatar-initial orange-bg">A</span>
 <div>
 <span className="item-title">Anil Kumar</span>
 <span className="item-subtitle text-upi">● UPI</span>
 </div>
 </div>
 <span className="item-value">₹ 750</span>
 </li>
 </ul>
 </div>

 {/* Upcoming Pooja Payments */}
 <div className="widget-card">
 <div className="widget-header">
 <h4>Upcoming Pooja Payments</h4>
 </div>
 <ul className="widget-list">
 <li className="list-item">
 <div className="item-meta">
 <span className="widget-icon-pill green-light"><FaCalendarAlt /></span>
 <div>
 <span className="item-title">Archana Pooja</span>
 <span className="item-subtitle">10:30 AM</span>
 </div>
 </div>
 <span className="item-value green-val">₹ 500</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="widget-icon-pill blue-light"><FaCalendarAlt /></span>
 <div>
 <span className="item-title">Abhisheka</span>
 <span className="item-subtitle">11:00 AM</span>
 </div>
 </div>
 <span className="item-value blue-val">₹ 1,200</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="widget-icon-pill orange-light"><FaCalendarAlt /></span>
 <div>
 <span className="item-title">Homa</span>
 <span className="item-subtitle">01:00 PM</span>
 </div>
 </div>
 <span className="item-value orange-val">₹ 2,000</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="widget-icon-pill red-light"><FaCalendarAlt /></span>
 <div>
 <span className="item-title">Special Seva</span>
 <span className="item-subtitle">03:00 PM</span>
 </div>
 </div>
 <span className="item-value red-val">₹ 1,500</span>
 </li>
 </ul>
 </div>

 {/* Low Stock Alert */}
 <div className="widget-card stock-alert-card">
 <div className="widget-header red-header">
 <h4>⚠️ Low Stock Alert (Prasadam)</h4>
 </div>
 <ul className="widget-list">
 <li className="list-item">
 <div className="item-meta">
 <span className="stock-bullet">🟠</span>
 <div>
 <span className="item-title">Laddu</span>
 </div>
 </div>
 <span className="item-stock-tag warning-tag">Only 15 Left</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="stock-bullet">🔴</span>
 <div>
 <span className="item-title">Pulihora</span>
 </div>
 </div>
 <span className="item-stock-tag danger-tag">Only 8 Left</span>
 </li>
 <li className="list-item">
 <div className="item-meta">
 <span className="stock-bullet">🟠</span>
 <div>
 <span className="item-title">Panakam</span>
 </div>
 </div>
 <span className="item-stock-tag warning-tag">Only 12 Left</span>
 </li>
 </ul>
 </div>
 </div>
 </div>

 {/* QUICK ACTIONS ROW */}
 <div className="quick-actions-section">
 <h3 className="section-title">⚡ Quick Actions</h3>
 <div className="quick-actions-row">
 <button className="action-tile-btn text-blue-btn">
 <div className="action-tile-icon-wrapper bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FaFileInvoice />
 </div>
 <span>Generate Bill</span>
 </button>
 <button className="action-tile-btn text-green-btn">
 <div className="action-tile-icon-wrapper bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FaCreditCard />
 </div>
 <span>Accept Payment</span>
 </button>
 <button className="action-tile-btn text-purple-btn">
 <div className="action-tile-icon-wrapper bg-purple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FaPrint />
 </div>
 <span>Print Receipt</span>
 </button>
 <button className="action-tile-btn text-orange-btn">
 <div className="action-tile-icon-wrapper bg-orange-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FaDownload />
 </div>
 <span>Download PDF</span>
 </button>
 <button className="action-tile-btn text-pink-btn">
 <div className="action-tile-icon-wrapper bg-pink-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FaSearch />
 </div>
 <span>Search Receipt</span>
 </button>
 <button className="action-tile-btn text-teal-btn">
 <div className="action-tile-icon-wrapper bg-teal-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FaChartBar />
 </div>
 <span>Daily Report</span>
 </button>
 </div>
 </div>

 {/* BOTTOM TRANSACTIONS AND SUMMARY */}
 <div className="bottom-tables-row">
 {/* TRANSACTION TABLE */}
 <div className="transactions-table-box">
 <div className="box-header">
 <h3>Recent Transactions</h3>
 </div>
 <div className="table-responsive">
 <table className="custom-dashboard-table">
 <thead>
 <tr>
 <th>Receipt No</th>
 <th>Date & Time</th>
 <th>Devotee Name</th>
 <th>Service / Item</th>
 <th>Amount (₹)</th>
 <th>Payment Method</th>
 <th>Status</th>
 <th style={{ textAlign: "center" }}>Action</th>
 </tr>
 </thead>
 <tbody>
 <tr>
 <td className="bold-txt">REC00125</td>
 <td>20 May 2025, 10:15 AM</td>
 <td>Ramesh Kumar</td>
 <td>Archana Pooja</td>
 <td className="bold-txt">500</td>
 <td>
 <span className="payment-method-badge badge-upi">UPI</span>
 </td>
 <td>
 <span className="status-badge badge-paid"><FaCheck /> Paid</span>
 </td>
 <td style={{ textAlign: "center" }}>
 <button className="view-action-btn"><FaEye /></button>
 </td>
 </tr>
 <tr>
 <td className="bold-txt">REC00124</td>
 <td>20 May 2025, 09:45 AM</td>
 <td>Suresh Reddy</td>
 <td>Donation</td>
 <td className="bold-txt">1,000</td>
 <td>
 <span className="payment-method-badge badge-cash">Cash</span>
 </td>
 <td>
 <span className="status-badge badge-paid"><FaCheck /> Paid</span>
 </td>
 <td style={{ textAlign: "center" }}>
 <button className="view-action-btn"><FaEye /></button>
 </td>
 </tr>
 <tr>
 <td className="bold-txt">REC00123</td>
 <td>20 May 2025, 09:10 AM</td>
 <td>Mahesh Babu</td>
 <td>Prasadam</td>
 <td className="bold-txt">250</td>
 <td>
 <span className="payment-method-badge badge-card">Card</span>
 </td>
 <td>
 <span className="status-badge badge-paid"><FaCheck /> Paid</span>
 </td>
 <td style={{ textAlign: "center" }}>
 <button className="view-action-btn"><FaEye /></button>
 </td>
 </tr>
 <tr>
 <td className="bold-txt">REC00122</td>
 <td>20 May 2025, 08:40 AM</td>
 <td>Anil Kumar</td>
 <td>Abhisheka</td>
 <td className="bold-txt">1,200</td>
 <td>
 <span className="payment-method-badge badge-upi">UPI</span>
 </td>
 <td>
 <span className="status-badge badge-paid"><FaCheck /> Paid</span>
 </td>
 <td style={{ textAlign: "center" }}>
 <button className="view-action-btn"><FaEye /></button>
 </td>
 </tr>
 <tr>
 <td className="bold-txt">REC00121</td>
 <td>20 May 2025, 08:10 AM</td>
 <td>Lakshmi Devi</td>
 <td>Special Seva</td>
 <td className="bold-txt">1,500</td>
 <td>
 <span className="payment-method-badge badge-netbanking">Net Banking</span>
 </td>
 <td>
 <span className="status-badge badge-pending"><FaClock /> Pending</span>
 </td>
 <td style={{ textAlign: "center" }}>
 <button className="view-action-btn"><FaEye /></button>
 </td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 {/* TODAY'S SUMMARY */}
 <div className="summary-box">
 <div className="box-header">
 <h3>Today's Summary</h3>
 </div>
 <ul className="summary-list">
 <li>
 <span className="summary-lbl">Total Collection</span>
 <span className="summary-val bold-txt">₹ 68,450</span>
 </li>
 <li>
 <span className="summary-lbl">Total Transactions</span>
 <span className="summary-val">128</span>
 </li>
 <li>
 <span className="summary-lbl">Average Bill Value</span>
 <span className="summary-val">₹ 534</span>
 </li>
 <li>
 <span className="summary-lbl">Active Payments</span>
 <span className="summary-val">15</span>
 </li>
 </ul>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default CashierDashboard;
