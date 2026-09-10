import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaDonate, FaRupeeSign, FaUsers, FaBoxes, FaBed } from "react-icons/fa";
import { MdTempleBuddhist, MdOutlinePayments } from "react-icons/md";
import AdminLayout from "../../layouts/AdminLayout";
import DashboardCards from "../../components/dashboard/DashboardCards";
import DonationChart from "../../components/dashboard/DonationChart";
import RecentBookings from "../../components/pooja/RecentBookings";
import LowStock from "../../components/inventory/LowStock";
import LogoutModal from "../../components/LogoutModal";
import { useAuth } from "../../context/AuthContext";
import DevoteesManagement from "./DevoteesManagement";
import DevoteeDetails from "./DevoteeDetails";
import NotificationsCenter from "./NotificationsCenter";
import { getAdminUsers } from "../../services/authService";
import {
 getAdminBookings,
 getAdminDonations,
 getAdminPrasadamOrders,
 getAdminRooms,
 getAdminAllBookings,
} from "../../services/adminService";
import axios from "axios";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase().replace(/@temple\.local$/, "@gmail.com");

const normalizeAmount = (value) => {
 if (value == null) return 0;
 const numeric = Number(String(value).replace(/[^0-9.-]+/g, ""));
 return Number.isNaN(numeric) ? 0 : numeric;
};

const formatRs = (value) => `Rs ${Number(value || 0).toLocaleString("en-IN")}`;

const getItemDate = (item) => {
 const date = new Date(item.createdAt || item.datetime || item.date);
 return Number.isNaN(date.getTime()) ? null : date;
};

const isSameDay = (left, right) =>
 left.getFullYear() === right.getFullYear() &&
 left.getMonth() === right.getMonth() &&
 left.getDate() === right.getDate();

const cardIcons = {
  revenue: { icon: <FaRupeeSign />, accent: "bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 border border-orange-200/50 dark:border-orange-800/50" },
  daily: { icon: <FaDonate />, accent: "bg-green-100 dark:bg-emerald-950/60 text-green-600 dark:text-emerald-400 border border-green-200/50 dark:border-emerald-800/50" },
  pooja: { icon: <MdTempleBuddhist />, accent: "bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 border border-violet-200/50 dark:border-violet-800/50" },
  donation: { icon: <FaDonate />, accent: "bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/50" },
  prasadam: { icon: <FaBoxes />, accent: "bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/50" },
  room: { icon: <FaBed />, accent: "bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/50" },
  pending: { icon: <MdOutlinePayments />, accent: "bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200/50 dark:border-rose-800/50" },
  devotees: { icon: <FaUsers />, accent: "bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/50" },
};

const PlaceholderView = ({ title, darkMode }) => (
  <div className={`mt-5 rounded-2xl border p-8 ${darkMode ? "bg-slate-800 border-slate-700" : "bg-temple-100 border-[#ece8e1]"}`}>
    <h2 className={`text-3xl font-bold ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>{title}</h2>
    <p className={`mt-2 ${darkMode ? "text-slate-300" : "text-gray-600"}`}>Module layout is ready. Connect forms, APIs, and database operations next.</p>
  </div>
);

const AdminDashboard = () => {
 const [showLogout, setShowLogout] = useState(false);
 const [selectedDevotee, setSelectedDevotee] = useState(null);
 const [users, setUsers] = useState([]);
 const [bookings, setBookings] = useState([]);
 const [donations, setDonations] = useState([]);
 const [inventoryItems, setInventoryItems] = useState([]);
 const [inventoryRequests, setInventoryRequests] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [rooms, setRooms] = useState([]);
 const [allBookings, setAllBookings] = useState([]);
 const navigate = useNavigate();
 const { logoutUser, token } = useAuth();

 useEffect(() => {
 const load = async () => {
 try {
 const [usersRes, bookingsRes, donationsRes, inventoryRes, prasadamRes, roomsRes, allBookingsRes, requestsRes] = await Promise.all([
 getAdminUsers(token),
 getAdminBookings(),
 getAdminDonations(),
 axios.get("http://localhost:5000/api/admin/inventory-items", { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { items: [] } })),
 getAdminPrasadamOrders(),
 getAdminRooms().catch(() => []),
 getAdminAllBookings().catch(() => ({ bookings: [] })),
 axios.get("http://localhost:5000/api/staff/inventory-requests", { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] })),
 ]);
    setUsers(Array.isArray(usersRes) ? usersRes : (usersRes?.users || []));
    setBookings(bookingsRes.bookings || []);
    setDonations(donationsRes.donations || []);
    setInventoryItems(inventoryRes.data?.items || []);
    setInventoryRequests(Array.isArray(requestsRes.data) ? requestsRes.data : (requestsRes.data?.requests || []));
    setPrasadamOrders(prasadamRes.orders || []);
    setRooms(Array.isArray(roomsRes) ? roomsRes : []);
    setAllBookings(allBookingsRes.bookings || []);
 } catch (error) {
 console.warn("Unable to load admin data . please try again", error);
 }
 };
 if (token) load();
 }, [token]);

  const devoteeUsers = useMemo(() => {
    const list = Array.isArray(users) ? users : (users?.users || []);
    const fromUsers = list.filter((u) => (u.role || "").toLowerCase() === "devotee");

    const map = new Map();
    const registeredNames = new Set();

    fromUsers.forEach((u) => {
      const email = normalizeEmail(u.email);
      if (email) {
        map.set(email, {
          ...u,
          name: u.name || "Devotee",
          email,
          phone: u.phone || "",
          address: u.address || "",
          place: u.place || "",
          role: "devotee",
          _id: u._id || u.id,
        });
      }
      if (u.name) {
        registeredNames.add(String(u.name).trim().toLowerCase());
      }
    });

    // Only include guests who made bookings/donations using their actual email, never fabricate fake emails!
    bookings.forEach((b) => {
      const email = normalizeEmail(b.devoteeEmail || b.email);
      const name = String(b.devoteeName || "").trim();
      if (email && !map.has(email) && (!name || !registeredNames.has(name.toLowerCase()))) {
        map.set(email, {
          name: name || "Guest Devotee",
          email,
          phone: b.devoteePhone || b.contactNumber || "",
          role: "devotee",
          _id: b._id || `booking-${email}`,
          isGuest: true,
        });
      }
    });

    donations.forEach((d) => {
      const email = normalizeEmail(d.donorEmail || d.email);
      const name = String(d.donorName || "").trim();
      if (email && !map.has(email) && (!name || !registeredNames.has(name.toLowerCase()))) {
        map.set(email, {
          name: name || "Guest Donor",
          email,
          phone: d.donorPhone || "",
          role: "devotee",
          _id: d._id || `donation-${email}`,
          isGuest: true,
        });
      }
    });

    return Array.from(map.values());
  }, [users, bookings, donations]);

 const handleLogout = () => {
 logoutUser();
 setShowLogout(false);
 navigate("/login");
 };

 const handleEditDevotee = (devotee) => {
 setSelectedDevotee(devotee);
 };

 const handleBackToDevotees = () => {
 setSelectedDevotee(null);
 };

 const dynamicStatCards = useMemo(() => {
 const poojaBookings = bookings.filter(b => !(b.service && b.service.startsWith("Room Allotment")));
 const bookingRevenue = poojaBookings.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
 const donationRevenue = donations.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
 const prasadamRevenue = prasadamOrders.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
 
 const activeRoomRevenue = 0; // Active rooms are already recorded in allBookings
 const historyRoomRevenue = allBookings
 .filter((b) => b.service && b.service.startsWith("Room Allotment:"))
 .reduce((sum, h) => sum + normalizeAmount(h.amount), 0);
 const roomRevenue = historyRoomRevenue;

 const totalRevenue = bookingRevenue + donationRevenue + prasadamRevenue + roomRevenue;

 const today = new Date();

 const sumForDay = (day) => {
 const matchDay = (item) => {
 const date = getItemDate(item);
 return date && isSameDay(date, day);
 };

 const todayRoomBookings = allBookings
 .filter((b) => b.service && b.service.startsWith("Room Allotment:"))
 .filter(matchDay)
 .reduce((sum, h) => sum + normalizeAmount(h.amount), 0);

 return (
 poojaBookings.filter(matchDay).reduce((sum, item) => sum + normalizeAmount(item.amount), 0) +
 donations.filter(matchDay).reduce((sum, item) => sum + normalizeAmount(item.amount), 0) +
 prasadamOrders.filter(matchDay).reduce((sum, item) => sum + normalizeAmount(item.amount), 0) +
 todayRoomBookings
 );
 };

 const todayCollections = sumForDay(today);

 const pendingPayments =
 bookings
 .filter((item) => item.status === "Pending" || item.paymentStatus === "Pending")
 .reduce((sum, item) => sum + normalizeAmount(item.amount), 0) +
 donations
 .filter((item) => String(item.status || "").toLowerCase() === "pending")
 .reduce((sum, item) => sum + normalizeAmount(item.amount), 0);

 return [
 {
 title: "Total Revenues",
 amount: formatRs(totalRevenue),
 hideTrend: true,
 ...cardIcons.revenue,
 },
 {
 title: "Daily Collections",
 amount: formatRs(todayCollections),
 hideTrend: true,
 ...cardIcons.daily,
 },
 {
 title: "Pooja Revenue",
 amount: formatRs(bookingRevenue),
 hideTrend: true,
 ...cardIcons.pooja,
 },
 {
 title: "Room Booked Revenue",
 amount: formatRs(roomRevenue),
 hideTrend: true,
 ...cardIcons.room,
 },
 {
 title: "Total Donations",
 amount: formatRs(donationRevenue),
 hideTrend: true,
 ...cardIcons.donation,
 },
 {
 title: "Prasadam Sales",
 amount: formatRs(prasadamRevenue),
 hideTrend: true,
 ...cardIcons.prasadam,
 },

 {
 title: "Total Devotees",
 amount: String(devoteeUsers.length),
 hideTrend: true,
 ...cardIcons.devotees,
 },
 ];
 }, [bookings, donations, prasadamOrders, devoteeUsers]);

 const donationSources = useMemo(() => {
 if (!donations.length) return [];
 const methodTotals = {};
 const methodCounts = {};

 donations.forEach((donation) => {
 const method = donation.paymentMethod || "Other";
 methodTotals[method] = (methodTotals[method] || 0) + normalizeAmount(donation.amount);
 methodCounts[method] = (methodCounts[method] || 0) + 1;
 });

 const colors = {
 UPI: "bg-violet-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ",
 Cash: "bg-orange-400",
 Online: "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ",
 Card: "bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ",
 "Bank Transfer": "bg-indigo-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ",
 "Net Banking": "bg-teal-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ",
 Cheque: "bg-sky-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ",
 Other: "bg-gray-400",
 };

 return Object.entries(methodTotals)
 .map(([label, amount]) => ({
 label,
 amount,
 count: methodCounts[label] || 0,
 value: 0,
 color: colors[label] || "bg-gray-400",
 }))
 .sort((left, right) => right.count - left.count || right.amount - left.amount);
 }, [donations]);

 const recentBookings = useMemo(
 () =>
 [...bookings]
 .filter((b) => !(b.service && b.service.startsWith("Room Allotment")))
 .sort((left, right) => {
 const leftDate = getItemDate(left)?.getTime() || 0;
 const rightDate = getItemDate(right)?.getTime() || 0;
 return rightDate - leftDate;
 }),
 [bookings]
 );

 return (
 <>
 <AdminLayout onLogoutClick={() => setShowLogout(true)}>
 {({ activeItem, darkMode }) => {
 if (activeItem === "Dashboard") {
 return (
 <>
 <div className="mt-5">
 <h1 className={`text-[36px] md:text-[44px] font-bold leading-tight ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>Welcome back, Admin</h1>
 <p className={`text-lg mt-1 ${darkMode ? "text-slate-300" : "text-gray-600 dark:text-slate-200 "}`}>Manage collections, bookings and operations from one dashboard.</p>
 </div>

 <DashboardCards cards={dynamicStatCards} />

 <div className="mt-4">
 <div className={`rounded-2xl border p-5 ${darkMode ? "bg-slate-800 border-slate-700" : "bg-temple-100 border-[#ece8e1]"}`}>
 <h3 className={`text-2xl font-bold ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>Donation Sources</h3>
 {donationSources.length ? (
 <DonationChart sources={donationSources} showCounts />
 ) : (
 <p className="mt-6 text-sm text-gray-500 dark:text-slate-300">No donation records yet.</p>
 )}
 </div>
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
 <div className={`rounded-2xl border p-6 ${darkMode ? "bg-slate-800 border-slate-700" : "bg-temple-100 border-[#ece8e1]"}`}>
 <h3 className={`text-3xl font-bold mb-4 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>Recent Bookings</h3>
 <RecentBookings bookings={recentBookings} />
 </div>
 <div className={`rounded-2xl border p-6 ${darkMode ? "bg-slate-800 border-slate-700" : "bg-temple-100 border-[#ece8e1]"}`}>
 <h3 className={`text-3xl font-bold mb-4 ${darkMode ? "text-slate-100" : "text-[#1d1b19]"}`}>Low Stock Alerts & Store Requests</h3>
 <LowStock
 items={inventoryItems.map(i => ({ name: i.name, stock: i.currentStock, currentStock: i.currentStock, minimumStock: i.minimumStock, status: i.currentStock <= i.minimumStock ? "Low" : "OK" }))}
 requests={inventoryRequests}
 />
 </div>
 </div>
 </>
 );
 }

 if (activeItem === "Devotees Management") {
 if (selectedDevotee) {
 return (
 <DevoteeDetails
 darkMode={darkMode}
 devotee={selectedDevotee}
 onBack={handleBackToDevotees}
 bookings={bookings}
 donations={donations}
 />
 );
 }

 return (
 <DevoteesManagement
 darkMode={darkMode}
 onEditProfile={handleEditDevotee}
 devotees={devoteeUsers}
 bookings={bookings}
 donations={donations}
 />
 );
 }

 if (activeItem === "Notifications") {
 return <NotificationsCenter darkMode={darkMode} />;
 }

 return <PlaceholderView title={activeItem} darkMode={darkMode} />;
 }}
 </AdminLayout>

 {showLogout && <LogoutModal onClose={() => setShowLogout(false)} onLogout={handleLogout} />}
 </>
 );
};

export default AdminDashboard;
