import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import templeImage from "../../assets/temple.jpg.png";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import LogoutModal from "../../components/LogoutModal";
import BookingReceipt from "../../components/common/BookingReceipt";
import { getDonationTypes } from "../../services/donationTypeService";
import { getPoojaTypes } from "../../services/poojaTypeService";
import { FaBell, FaSignOutAlt } from "react-icons/fa";
import { MdLightMode, MdDarkMode, MdMenu, MdKeyboardArrowDown } from "react-icons/md";
import {
 getDevoteeBookings,
 getDevoteeDonations,
 getDevoteeNotifications,
 getDevoteeProfile,
 updateDevoteeProfile,
 getDevoteeEvents,
 createDevoteeDonation,
 createDevoteeBooking,
 createRazorpayOrder,
 verifyRazorpayPayment,
 verifyBookingPayment,
 verifyPrasadamPayment,
 submitDevoteeSupport,
 getSupportRequests,
 getPrasadamOrders,
 createPrasadamOrder,
 cancelPrasadamOrder,
 markNotificationAsRead,
} from "../../services/devoteeService";

const DEFAULT_POOJA_TYPES = [
 { name: "Abhisheka", price: 501, requiredMaterials: "Milk, Curd, Honey, Ghee, Sugar, Flowers, Fruits" },
 { name: "Archana", price: 101, requiredMaterials: "Flowers, Coconut, Betel Leaves, Fruits" },
 { name: "Sahasranama Archana", price: 251, requiredMaterials: "Flowers, Garland, Coconut, Fruits" },
 { name: "Ganapathi Homa", price: 1001, requiredMaterials: "Coconuts, Modak, Ghee, Havan Samagri, Flowers" },
 { name: "Navagraha Shanti Homa", price: 1501, requiredMaterials: "Nine Grains, Ghee, Nine Color Clothes, Flowers" },
 { name: "Satyanarayan Pooja", price: 1201, requiredMaterials: "Wheat Flour, Rava, Sugar, Milk, Fruits, Tulsi" },
 { name: "Maha Mrityunjaya Homa", price: 2101, requiredMaterials: "Ghee, Bilva Leaves, Milk, Honey, Havan Samagri" },
 { name: "Kalyanotsavam", price: 2501, requiredMaterials: "Vastram, Mangalsutra, Turmeric, Kumkum, Flowers, Fruits" },
 { name: "Vehicle Pooja", price: 201, requiredMaterials: "Lemon, Coconut, Flowers, Camphor" },
];

const INITIAL_ROOMS = [
 {
 number: "101",
 type: "Standard",
 status: "Available",
 price: 1200,
 block: "Block A",
 floor: "First Floor",
 capacity: 2,
 bedType: "Double",
 amenities: ["Attached Bathroom", "Fan", "WiFi"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 },
 {
 number: "102",
 type: "Standard",
 status: "Available",
 price: 1200,
 block: "Block A",
 floor: "First Floor",
 capacity: 2,
 bedType: "Double",
 amenities: ["Attached Bathroom", "Fan", "WiFi"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 },
 {
 number: "103",
 type: "Standard",
 status: "Occupied",
 price: 1200,
 block: "Block A",
 floor: "First Floor",
 capacity: 2,
 bedType: "Double",
 amenities: ["Attached Bathroom", "Fan", "WiFi"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 devotee: "Venkatesh Kumar",
 phone: "9876543210",
 days: 2,
 payMode: "UPI",
 checkinDate: "2026-07-07",
 },
 {
 number: "201",
 type: "Deluxe",
 status: "Available",
 price: 2000,
 block: "Block B",
 floor: "Second Floor",
 capacity: 3,
 bedType: "King",
 amenities: ["Attached Bathroom", "AC", "TV", "WiFi", "Geyser"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 },
 {
 number: "202",
 type: "Deluxe",
 status: "Occupied",
 price: 2000,
 block: "Block B",
 floor: "Second Floor",
 capacity: 3,
 bedType: "King",
 amenities: ["Attached Bathroom", "AC", "TV", "WiFi", "Geyser"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 devotee: "Meera Iyer",
 phone: "8765432109",
 days: 3,
 payMode: "Cash",
 checkinDate: "2026-07-06",
 },
 {
 number: "301",
 type: "VIP Suite",
 status: "Occupied",
 price: 4500,
 block: "Main Block",
 floor: "Third Floor",
 capacity: 4,
 bedType: "King",
 amenities: ["Attached Bathroom", "AC", "TV", "WiFi", "Geyser", "Refrigerator", "Sofa", "Room Service"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 devotee: "Ramesh Sharma",
 phone: "7654321098",
 days: 1,
 payMode: "Card",
 checkinDate: "2026-07-08",
 },
 {
 number: "302",
 type: "VIP Suite",
 status: "Available",
 price: 4500,
 block: "Main Block",
 floor: "Third Floor",
 capacity: 4,
 bedType: "King",
 amenities: ["Attached Bathroom", "AC", "TV", "WiFi", "Geyser", "Refrigerator", "Sofa", "Room Service"],
 checkinTime: "12:00 PM",
 checkoutTime: "11:00 AM",
 },
];


const menuItems = [
 { label: "Dashboard", icon: "home" },
 { label: "Booking", icon: "book" },
 { label: "My Bookings", icon: "calendar" },
 { label: "Donations", icon: "heart" },
 { label: "Receipts", icon: "receipt" },
 { label: "Festival Events", icon: "temple" },
 { label: "Notifications", icon: "bell" },
 { label: "Profile", icon: "user" },
 { label: "Support", icon: "gear" },
];

const formatCurrency = (value) => {
 const amount = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
 return `Rs ${Number.isNaN(amount) ? 0 : amount.toLocaleString("en-IN")}`;
};

const formatDateDisplay = (value) => {
 if (!value) return "-";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return String(value);
 return date.toLocaleDateString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 });
};

const formatDateTimeDisplay = (value) => {
 if (!value) return "-";
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return String(value);
 return date.toLocaleString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 });
};

const buildReceiptId = (prefix, item = {}) => {
 const source = item.bookingNumber || item.transactionId || item._id || item.id || Date.now();
 return `${prefix}-${String(source).slice(-8).toUpperCase()}`;
};

// Helper function to check if a booking is upcoming (datetime in future)
const isUpcomingBooking = (booking) => {
 if (!booking.datetime) return false;
 const bookingTime = new Date(booking.datetime).getTime();
 const now = new Date().getTime();
 return bookingTime > now;
};

// Helper function to count unread notifications
const countUnreadNotifications = (notifications = []) => {
 return notifications.filter((n) => !n.read).length;
};

const normalizePrasadamStatus = (status) => {
 switch (status) {
 case "Placed":
 return "Pending";
 case "Preparing":
 return "Processing";
 case "Ready":
 return "Ready for Pickup";
 case "Delivered":
 return "Completed";
 default:
 return status || "Pending";
 }
};

const getPrasadamStatusTone = (status) => {
 const normalized = normalizePrasadamStatus(status);
 if (normalized === "Cancelled") return "bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#a12525]";
 if (normalized === "Rejected") return "bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#a12525]";
 if (normalized === "Pending") return "bg-[#faefcf] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#ce7a0f]";
 if (normalized === "Approved") return "bg-[#e6f0ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#3058d6]";
 if (normalized === "Processing") return "bg-[#eef4ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#234ea5]";
 if (normalized === "Ready for Pickup") return "bg-[#edf7ee] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#16853f]";
 if (normalized === "Completed") return "bg-[#edf7ee] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#16853f]";
 return "bg-[#edf7ee] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#16853f]";
};

const canCancelPrasadamOrder = (status) => {
 return false;
};

const glassCard =
 "rounded-[28px] border border-amber-200/50 bg-white/75 dark:bg-slate-900/90 dark:border-slate-800 dark:text-slate-100 p-6 sm:p-8 shadow-[0_15px_35px_rgba(184,94,0,0.06)] dark:shadow-none backdrop-blur-xl hover:shadow-[0_20px_40px_rgba(184,94,0,0.12)] transition-all duration-300";
const glassSection =
 "rounded-[28px] border border-amber-100/60 bg-white/65 dark:bg-slate-900/80 dark:border-slate-800 dark:text-slate-100 p-6 sm:p-8 shadow-[0_12px_30px_rgba(184,94,0,0.04)] dark:shadow-none backdrop-blur-xl";
const glassInput =
 "w-full rounded-[18px] border border-amber-200/70 bg-white/80 dark:bg-slate-800/90 dark:border-slate-700 text-[#1f1914] dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-5 py-3.5 text-base font-semibold outline-none shadow-sm backdrop-blur-md focus:border-[#d97706] dark:focus:border-amber-500 focus:ring-4 focus:ring-[#d97706]/15 dark:focus:ring-amber-500/20 transition-all";
const glassButton =
 "rounded-[24px] bg-gradient-to-r from-[#b46a13] via-[#f29f41] to-[#ffbc6e] px-7 py-4 text-base font-bold text-white shadow-[0_16px_35px_rgba(184,122,57,0.25)] transition hover:scale-[1.02] hover:shadow-[0_20px_42px_rgba(184,122,57,0.3)]";
const glassButtonSoft =
 "rounded-[24px] border border-white/60 bg-temple-100/65 dark:bg-slate-800 dark:border-slate-700 text-[#7f470a] dark:text-amber-300 px-7 py-4 text-base font-bold shadow-md transition hover:bg-temple-100/85 dark:hover:bg-slate-700 hover:scale-[1.02]";
const glassItem =
 "rounded-[26px] border border-white/60 bg-temple-100/70 dark:bg-slate-800/75 dark:border-slate-700 dark:text-slate-200 p-5 text-base shadow-sm backdrop-blur-md hover:shadow-md transition-shadow";

const AppIcon = ({ name, className = "h-5 w-5" }) => {
 const base = "fill-none stroke-current stroke-2";
 if (name === "home") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M3 10.5L12 3l9 7.5"></path>
 <path d="M5.5 9.5V21h13V9.5"></path>
 </svg>
 );
 }
 if (name === "book") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <rect x="4" y="4" width="16" height="16" rx="2"></rect>
 <path d="M8 4v16M11 8h5M11 12h5"></path>
 </svg>
 );
 }
 if (name === "calendar") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <rect x="3.5" y="5" width="17" height="15.5" rx="2"></rect>
 <path d="M7 3v4M17 3v4M3.5 9h17M8.5 13h3v3h-3z"></path>
 </svg>
 );
 }
 if (name === "heart") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M12 20s-6.5-4.2-8.5-8.2a5 5 0 0 1 8.1-5.6l.4.4.4-.4a5 5 0 0 1 8.1 5.6C18.5 15.8 12 20 12 20z"></path>
 </svg>
 );
 }
 if (name === "bag") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2"></path>
 </svg>
 );
 }
 if (name === "wallet") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v14H5.5A2.5 2.5 0 0 1 3 16.5v-9z"></path>
 <path d="M19 9h2v6h-2M15.5 12h1"></path>
 </svg>
 );
 }
 if (name === "receipt") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M6 3h12v18l-2.2-1.4L13.6 21l-2.2-1.4L9.2 21 7 19.6 4.8 21V3z"></path>
 <path d="M9 8h6M9 12h6"></path>
 </svg>
 );
 }
 if (name === "temple") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M3 20h18M5 20v-6h14v6M7 14V9l5-4 5 4v5"></path>
 </svg>
 );
 }
 if (name === "bell") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <path d="M15 18h5l-1.3-1.3a1 1 0 0 1-.3-.7V11a6.4 6.4 0 1 0-12.8 0v5a1 1 0 0 1-.3.7L4 18h5"></path>
 <path d="M10 18a2 2 0 1 0 4 0"></path>
 </svg>
 );
 }
 if (name === "user") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <circle cx="12" cy="8" r="3.5"></circle>
 <path d="M5.5 20a6.5 6.5 0 0 1 13 0"></path>
 </svg>
 );
 }
 if (name === "gear") {
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <circle cx="12" cy="12" r="3.2"></circle>
 <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"></path>
 </svg>
 );
 }
 return (
 <svg viewBox="0 0 24 24" className={`${className} ${base}`}>
 <rect x="4" y="4" width="16" height="16" rx="2"></rect>
 </svg>
 );
};

const IconCircle = ({ className, icon }) => (
 <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${className}`}>
 <AppIcon name={icon} className="h-7 w-7" />
 </div>
);

const SidebarItem = ({ label, icon, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left text-[17px] font-bold transition-all duration-300 ${
      active
        ? "bg-gradient-to-r from-[#ff8c00] to-[#ff5500] text-white shadow-[0_8px_24px_rgba(255,106,0,0.42)] scale-[1.02]"
        : "text-[#2c1d12] dark:text-slate-200 border border-white/60 dark:border-slate-700/60 bg-white/45 dark:bg-slate-900/45 backdrop-blur-md hover:bg-white/70 dark:hover:bg-slate-800/70 hover:shadow-sm"
    }`}
  >
    <AppIcon name={icon} className={`h-[21px] w-[21px] transition-transform duration-200 group-hover:scale-110 ${active ? "text-white" : "text-[#2c1d12] dark:text-slate-200"}`} />
    <span className="text-[17px] leading-tight font-bold">{label}</span>
  </button>
);

const loadRazorpayScript = () =>
 new Promise((resolve) => {
 if (window.Razorpay) return resolve(true);
 const script = document.createElement("script");
 script.src = "https://checkout.razorpay.com/v1/checkout.js";
 script.onload = () => resolve(true);
 script.onerror = () => resolve(false);
 document.body.appendChild(script);
 });

const DevoteeDashboard = () => {
 const navigate = useNavigate();
 const { user, logoutUser, updateUser } = useAuth();
 const { darkMode, toggleDarkMode } = useTheme();
 const [showLogout, setShowLogout] = useState(false);
 const [mobileOpen, setMobileOpen] = useState(false);
 const [activePage, setActivePage] = useState("Dashboard");
 const [bookingsData, setBookingsData] = useState([]);
 const [donationsData, setDonationsData] = useState([]);
 const [notificationsData, setNotificationsData] = useState([]);
 const [notificationTab, setNotificationTab] = useState("all");
 const [notificationCategory, setNotificationCategory] = useState("all");
 const [notificationSearch, setNotificationSearch] = useState("");
 const [selectedNotificationDetail, setSelectedNotificationDetail] = useState(null);
 const [eventsData, setEventsData] = useState([]);
 const [prasadamOrders, setPrasadamOrders] = useState([]);
 const [viewingReceiptData, setViewingReceiptData] = useState(null);
 const [selectedEventId, setSelectedEventId] = useState(null);

 const [availableRooms, setAvailableRooms] = useState(() => {
 const saved = localStorage.getItem("templeRooms_v2");
 return saved ? JSON.parse(saved) : INITIAL_ROOMS;
 });
 const [roomHistory, setRoomHistory] = useState([]);
 const [showAllRooms, setShowAllRooms] = useState(false);

 const mergedRoomHistory = useMemo(() => {
 const dbRoomBookings = bookingsData
 .filter((b) => b.service && b.service.startsWith("Room Allotment:"))
 .map((b) => {
 let roomNum = "";
 let roomType = "";
 const match = b.service.match(/Room Allotment:\s*Room\s*(\S+)\s*\(([^)]+)\)/i);
 if (match) {
 roomNum = match[1];
 roomType = match[2];
 }

 // Prefer stored date fields over parsing notes
 const checkin = b.checkinDate
 ? new Date(b.checkinDate).toISOString().split("T")[0]
 : b.datetime
 ? b.datetime.split("T")[0]
 : "";
 const checkout = b.checkoutDate
 ? new Date(b.checkoutDate).toISOString().split("T")[0]
 : new Date(new Date(checkin).getTime() + (b.days || 1) * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

 // Auto status: if checkout date passed or status is Completed → Completed
 const now = new Date();
 const isCompleted = b.status === "Completed" || new Date(b.checkoutDate || checkout) <= now;

 return {
 id: b.bookingNumber || `B-${String(b._id).slice(-4).toUpperCase()}`,
 devoteeName: b.devoteeName,
 phone: b.devoteePhone || b.contactNumber || "",
 roomNumber: roomNum,
 roomType: roomType,
 amount: b.amount,
 days: b.days || 1,
 checkinDate: checkin,
 checkoutDate: checkout,
 payMode: b.paymentMethod || "UPI",
 status: isCompleted ? "Completed" : "Active",
 };
 });

 return dbRoomBookings;
 }, [bookingsData]);

 const roomTypesList = useMemo(() => {
 const list = {};
 availableRooms.forEach((r) => {
 if (!list[r.type]) {
 list[r.type] = {
 type: r.type,
 price: r.price,
 amenities: r.amenities || [],
 block: r.block || "Block A",
 floor: r.floor || "Ground Floor",
 capacity: r.capacity || 2,
 };
 }
 });
 const result = Object.values(list);
 return result.length > 0 ? result : [
 { type: "Standard", price: 1200, amenities: ["Attached Bathroom", "Fan", "WiFi"] },
 { type: "Deluxe", price: 2000, amenities: ["Attached Bathroom", "AC", "TV", "WiFi", "Geyser"] },
 { type: "VIP Suite", price: 4500, amenities: ["Attached Bathroom", "AC", "TV", "WiFi", "Geyser", "Refrigerator", "Sofa", "Room Service"] }
 ];
 }, [availableRooms]);

 const [cartItems, setCartItems] = useState([]);
 const [cartPaymentMethod, setCartPaymentMethod] = useState("UPI");
 const [profileData, setProfileData] = useState({
 name: user?.name || "Devotee User",
 email: user?.email || "devotee@example.com",
 role: "devotee",
 memberSince: "2025",
 });
 const [supportSubject, setSupportSubject] = useState("");
 const [supportMessage, setSupportMessage] = useState("");
 const [poojaTypes, setPoojaTypes] = useState(DEFAULT_POOJA_TYPES);
 const [bookingService, setBookingService] = useState("Abhisheka");
 const [bookingDatetime, setBookingDatetime] = useState("");
 const [bookingAmount, setBookingAmount] = useState(501);
 const [bookingContact, setBookingContact] = useState("");
 const [bookingNotes, setBookingNotes] = useState("");
 const [bookingLoading, setBookingLoading] = useState(false);
 const [bookingError, setBookingError] = useState("");
 const [bookingSuccess, setBookingSuccess] = useState("");
 const [bookingPaymentMethod, setBookingPaymentMethod] = useState("UPI");
 const [showAllReceipts, setShowAllReceipts] = useState(false);
 const [showAllBookings, setShowAllBookings] = useState(false);
 const [showAllDonations, setShowAllDonations] = useState(false);
 const [viewingReceipt, setViewingReceipt] = useState(null);
 const [bookingTab, setBookingTab] = useState("Pooja");

 const [selectedRoomNumber, setSelectedRoomNumber] = useState(() => {
 const saved = localStorage.getItem("templeRooms_v2");
 const parsed = saved ? JSON.parse(saved) : INITIAL_ROOMS;
 const firstAvail = parsed.find(r => r.status === "Available") || parsed[0];
 return firstAvail ? firstAvail.number : "";
 });
 const [roomType, setRoomType] = useState(() => {
 const saved = localStorage.getItem("templeRooms_v2");
 const parsed = saved ? JSON.parse(saved) : INITIAL_ROOMS;
 const firstAvail = parsed.find(r => r.status === "Available") || parsed[0];
 return firstAvail ? firstAvail.type : "Standard";
 });
 const [roomCheckIn, setRoomCheckIn] = useState("");
 const [roomCheckOut, setRoomCheckOut] = useState("");
 const [roomAmount, setRoomAmount] = useState(() => {
 const saved = localStorage.getItem("templeRooms_v2");
 const parsed = saved ? JSON.parse(saved) : INITIAL_ROOMS;
 const firstAvail = parsed.find(r => r.status === "Available") || parsed[0];
 return firstAvail ? firstAvail.price : 1200;
 });
 const [roomPaymentMethod, setRoomPaymentMethod] = useState("UPI");
 const [roomLoading, setRoomLoading] = useState(false);
 const [roomSuccess, setRoomSuccess] = useState("");
 const [roomError, setRoomError] = useState("");
 const [donationCategories, setDonationCategories] = useState(getDonationTypes());
 const [donationCategory, setDonationCategory] = useState(getDonationTypes()[0] || "General");
 const [supportRequests, setSupportRequests] = useState([]);
 const [donationAmount, setDonationAmount] = useState(501);
 const [donationMethod, setDonationMethod] = useState("UPI");
 const [donationContact, setDonationContact] = useState("");
 const [donationNotes, setDonationNotes] = useState("");
 const [donationLoading, setDonationLoading] = useState(false);
 const [donationError, setDonationError] = useState("");
 const [donationSuccess, setDonationSuccess] = useState("");
 const [donationView, setDonationView] = useState("All");
 const [profileEditMode, setProfileEditMode] = useState(false);
 const [profileForm, setProfileForm] = useState({ name: "", email: "", phone: "", address: "", place: "" });
 const [profileMessage, setProfileMessage] = useState("");
 const [profileError, setProfileError] = useState("");
 const [prasadamForm, setPrasadamForm] = useState({
 itemName: "Laddu Prasadam",
 quantity: 1,
 paymentMethod: "UPI",
 });
 const [prasadamMessage, setPrasadamMessage] = useState("");
 const [supportStatus, setSupportStatus] = useState("");
 const [currentDateTime, setCurrentDateTime] = useState(new Date());
 const prasadamMenu = useMemo(
 () => ({
 "Laddu Prasadam": 151,
 "Panchamrit Prasadam": 101,
 "Pulihora Prasadam": 121,
 "Sweet Pongal Prasadam": 131,
 "Curd Rice Prasadam": 111,
 }),
 []
 );

 const paymentMethods = ["UPI", "Card", "Bank Transfer", "Net Banking"];

 const minBookingDatetime = useMemo(() => {
 const d = new Date(currentDateTime || new Date());
 const pad = (n) => String(n).padStart(2, "0");
 const yyyy = d.getFullYear();
 const mm = pad(d.getMonth() + 1);
 const dd = pad(d.getDate());
 return `${yyyy}-${mm}-${dd}`;
 }, [currentDateTime]);

 const devoteeName = useMemo(() => profileData.name || user?.name || "Devotee User", [profileData.name, user?.name]);

 const [selectedTempleMaterials, setSelectedTempleMaterials] = useState([]);
 const [prepAcknowledged, setPrepAcknowledged] = useState(false);

 const addToCart = (item) => {
 setCartItems((prev) => {
 const existingIdx = prev.findIndex((i) => i.id === item.id);
 if (existingIdx > -1) {
 const updated = [...prev];
 updated[existingIdx].quantity += item.quantity || 1;
 return updated;
 }
 return [...prev, { ...item, quantity: item.quantity || 1 }];
 });
 };

 const updateCartQuantity = (id, delta) => {
 setCartItems((prev) =>
 prev
 .map((item) => {
 if (item.id === id) {
 const newQty = item.quantity + delta;
 return newQty > 0 ? { ...item, quantity: newQty } : null;
 }
 return item;
 })
 .filter(Boolean)
 );
 };

 const removeFromCart = (id) => {
 setCartItems((prev) => prev.filter((item) => item.id !== id));
 };

 const cartTotal = useMemo(() => {
 return cartItems.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);
 }, [cartItems]);

 const handleCombinedCheckout = async () => {
 if (cartItems.length === 0) {
 alert("Your cart is empty. Please select Poojas or Prasadam items.");
 return;
 }

 const isConfirmed = window.confirm(
 `Total amount is ${formatCurrency(cartTotal)}. Once paid, it cannot be returned (non-refundable). Connect to Razorpay payment?`
 );
 if (!isConfirmed) return;

 const summaryTitle = cartItems.map((i) => `${i.name} (x${i.quantity})`).join(", ");

 try {
 const payload = {
 devoteeName: profileData.name || user?.name || "Devotee",
 devoteeEmail: profileData.email || user?.email || "",
 devoteePhone: profileData.phone || undefined,
 service: `Combined Order: ${summaryTitle}`,
 datetime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour in future to pass validation
 amount: cartTotal,
 paymentMethod: cartPaymentMethod || "UPI",
 notes: `Items: ${cartItems.map((i) => `${i.name} (x${i.quantity})`).join(", ")}`,
 isCombined: true,
 items: cartItems.map((i) => ({
 name: i.name,
 description: `${i.type === "pooja" ? "Pooja Seva" : "Prasadam Order"}: ${i.name}`,
 quantity: i.quantity,
 price: i.price,
 amount: i.price * i.quantity,
 type: i.type,
 date: i.date || new Date().toLocaleDateString(),
 selectedTempleMaterials: i.selectedTempleMaterials || [],
 })),
 };

 const bookingRes = await createDevoteeBooking(payload);
 const { booking: createdBooking, order, key, simulated } = bookingRes;

 if (!simulated && order) {
 const loaded = await loadRazorpayScript();
 if (!loaded) {
 alert("Unable to load payment gateway. Try again later.");
 return;
 }

 const options = {
 key: key || "",
 amount: order.amount,
 currency: order.currency,
 name: "Sri Shanti Mahadev Mandir",
 description: `Combined Bill for ${cartItems.length} sacred service(s)`,
 order_id: order.id,
 prefill: {
 name: profileData.name || "Devotee",
 email: profileData.email || "devotee@example.com",
 contact: profileData.phone || "",
 },
 theme: { color: "#d97706" },
 handler: async function (resp) {
 try {
 await verifyBookingPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 bookingId: createdBooking._id,
 });

 // Refresh data
 try {
 const [bookingsRes, notificationsRes] = await Promise.all([
 getDevoteeBookings(profileData.email || user?.email || ""),
 getDevoteeNotifications(profileData.email || user?.email || ""),
 ]);
 setBookingsData(bookingsRes.bookings || []);
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));
 } catch (refreshError) {
 console.warn("Unable to refresh bookings after create", refreshError);
 }

 // Download Receipt
 handleReceiptDownload(createdBooking, "combined");
 setCartItems([]);
 alert(`Combined Bill Paid & Generated Successfully! Receipt downloaded. Please bring the receipt at the time of visiting the temple to perform the pooja.`);
 setActivePage("My Bookings");
 } catch (err) {
 alert(err?.response?.data?.error || "Payment verification failed.");
 console.warn("verify combined booking handler error", err);
 }
 },
 modal: {
 ondismiss: function () {
 alert("Razorpay checkout was closed without completing payment.");
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 } else {
 // Simulated or Cash checkout
 handleReceiptDownload(createdBooking, "combined");
 setCartItems([]);
 alert(`Combined Bill Generated Successfully! Receipt downloaded. Please bring the receipt at the time of visiting the temple to perform the pooja.`);
 setActivePage("My Bookings");
 }
 } catch (error) {
 console.error("Combined checkout error:", error);
 alert(error?.response?.data?.error || "An error occurred while saving the booking. Please try again or contact support.");
 }
 };

 const upcomingBookings = useMemo(() => bookingsData.filter(isUpcomingBooking), [bookingsData]);

 const unreadNotificationsCount = useMemo(() => countUnreadNotifications(notificationsData), [notificationsData]);

 const formatNotifications = (notifications = []) =>
 (notifications || []).map((notification) => ({
 ...notification,
 date: notification.date
 ? new Date(notification.date).toLocaleDateString()
 : notification.createdAt
 ? new Date(notification.createdAt).toLocaleDateString()
 : "",
 message: notification.message || notification.title || "",
 }));

 const totalDonations = useMemo(
 () => donationsData.reduce((sum, donation) => sum + (typeof donation.amount === "number" ? donation.amount : Number(donation.amount) || 0), 0),
 [donationsData]
 );

 const prasadamOrdersCount = useMemo(() => prasadamOrders.length, [prasadamOrders]);

 const stats = useMemo(
 () => [
 {
 title: "Upcoming Bookings",
 value: `${upcomingBookings.length}`,
 action: "View Details",
 tone: "bg-purple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-purple-600 group-hover:scale-110 transition-transform duration-300",
 cardStyle: "border-purple-100 dark:border-purple-900/40 bg-gradient-to-b from-purple-50/50 via-white to-white dark:from-purple-950/30 dark:via-slate-900 dark:to-slate-900 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-lg hover:shadow-purple-500/10",
 valueColor: "text-purple-950 dark:text-purple-100",
 badgeBg: "bg-purple-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-purple-700 border-purple-200/50",
 icon: "calendar",
 },
 {
 title: "Pooja Booked",
 value: `${bookingsData.length}`,
 action: "View Bookings",
 tone: "bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-600 group-hover:scale-110 transition-transform duration-300",
 cardStyle: "border-blue-100 dark:border-blue-900/40 bg-gradient-to-b from-blue-50/50 via-white to-white dark:from-blue-950/30 dark:via-slate-900 dark:to-slate-900 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg hover:shadow-blue-500/10",
 valueColor: "text-blue-950 dark:text-blue-100",
 badgeBg: "bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-700 border-blue-200/50",
 icon: "calendar",
 },
 {
 title: "Total Donations",
 value: formatCurrency(totalDonations),
 action: "View History",
 tone: "bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-600 group-hover:scale-110 transition-transform duration-300",
 cardStyle: "border-emerald-100 dark:border-emerald-900/40 bg-gradient-to-b from-emerald-50/50 via-white to-white dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-lg hover:shadow-emerald-500/10",
 valueColor: "text-emerald-950 dark:text-emerald-100",
 badgeBg: "bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-emerald-700 border-emerald-200/50",
 icon: "heart",
 },
 {
 title: "Prasadam Orders",
 value: `${prasadamOrdersCount}`,
 action: "View Orders",
 tone: "bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-600 group-hover:scale-110 transition-transform duration-300",
 cardStyle: "border-amber-100 dark:border-amber-900/40 bg-gradient-to-b from-amber-50/50 via-white to-white dark:from-amber-950/30 dark:via-slate-900 dark:to-slate-900 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-lg hover:shadow-amber-500/10",
 valueColor: "text-amber-950 dark:text-amber-100",
 badgeBg: "bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-700 border-amber-200/50",
 icon: "bag",
 },
 ],
 [upcomingBookings.length, bookingsData.length, totalDonations, prasadamOrdersCount]
 );

 const upcomingFestival = useMemo(() => {
 if (!eventsData || eventsData.length === 0) {
 return {
 title: "Ganesh Chaturthi 2026",
 dateDisplay: "07 September 2026",
 };
 }

 const now = Date.now();
 // Filter events in the future
 const futureEvents = eventsData
 .filter((e) => e.date && new Date(e.date).getTime() >= now)
 .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

 if (futureEvents.length > 0) {
 const nextEv = futureEvents[0];
 return {
 title: nextEv.title || nextEv.name,
 dateDisplay: nextEv.formattedDate || new Date(nextEv.date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }),
 };
 }

 // Fallback to the latest event
 const sorted = [...eventsData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
 const latestEv = sorted[0];
 return {
 title: latestEv.title || latestEv.name,
 dateDisplay: latestEv.formattedDate || new Date(latestEv.date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }),
 };
 }, [eventsData]);

 const displayCategories = useMemo(() => {
 if (selectedEventId) {
 const selectedEvent = eventsData.find((e) => e._id === selectedEventId);
 if (selectedEvent && selectedEvent.title) {
 return [selectedEvent.title];
 }
 }
 return donationCategories;
 }, [selectedEventId, eventsData, donationCategories]);

 useEffect(() => {
 if (selectedEventId) {
 const selectedEvent = eventsData.find((e) => e._id === selectedEventId);
 if (selectedEvent && selectedEvent.title) {
 setDonationCategory(selectedEvent.title);
 }
 } else {
 setDonationCategory(donationCategories[0] || "General");
 }
 }, [selectedEventId, eventsData, donationCategories]);

 useEffect(() => {
 const handleStorageChange = (e) => {
 if (e.key === "templeRooms_v2") {
 setAvailableRooms(e.newValue ? JSON.parse(e.newValue) : []);
 }
 if (e.key === "templeRoomHistory") {
 setRoomHistory(e.newValue ? JSON.parse(e.newValue) : []);
 }
 };
 window.addEventListener("storage", handleStorageChange);
 return () => window.removeEventListener("storage", handleStorageChange);
 }, []);

 useEffect(() => {
 // Clear stale localStorage room data from old hardcoded records
 localStorage.removeItem("templeRoomHistory");

 const loadDevoteeData = async () => {
 try {
 const [bookingsRes, donationsRes, notificationsRes, profileRes, eventsRes, prasadamRes] = await Promise.all([
 getDevoteeBookings(user?.email),
 getDevoteeDonations(user?.email),
 getDevoteeNotifications(user?.email),
 getDevoteeProfile(user?.email),
 getDevoteeEvents(),
 getPrasadamOrders(user?.email),
 ]);

 setBookingsData(bookingsRes.bookings || []);
 setDonationsData(
 (donationsRes.donations || []).map((donation) => {
 const eventMatch = (eventsRes.events || []).find((ev) => ev._id === donation.eventId || ev._id === String(donation.eventId));
 return {
 ...donation,
 eventTitle: eventMatch ? eventMatch.title : undefined,
 type: donation.category || donation.type || "Donation",
 date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString() : donation.date || "",
 amount: donation.amount,
 };
 })
 );
 setNotificationsData(
 (notificationsRes.notifications || []).map((notification) => ({
 ...notification,
 date: notification.date
 ? new Date(notification.date).toLocaleDateString()
 : notification.createdAt
 ? new Date(notification.createdAt).toLocaleDateString()
 : "",
 message: notification.message || notification.title || "",
 }))
 );
 setProfileData(profileRes.profile || profileData);
 setProfileForm({
 name: profileRes?.profile?.name || user?.name || "",
 email: profileRes?.profile?.email || user?.email || "",
 phone: profileRes?.profile?.phone || "",
 address: profileRes?.profile?.address || "",
 place: profileRes?.profile?.place || "",
 });
 
 const poojaTypesDataRes = await getPoojaTypes();
 const fetchedPoojaTypes = poojaTypesDataRes?.poojas || poojaTypesDataRes || [];
 const poojaTypesData = Array.isArray(fetchedPoojaTypes) && fetchedPoojaTypes.length > 0 ? fetchedPoojaTypes : DEFAULT_POOJA_TYPES;
 setPoojaTypes(poojaTypesData);
 
 setBookingService((prevService) => {
 const match = poojaTypesData.find((type) => type.name === prevService);
 if (match) {
 setBookingAmount(match.price || 501);
 return prevService;
 }
 setBookingAmount(poojaTypesData[0]?.price || 501);
 return poojaTypesData[0]?.name || "Abhisheka";
 });
 
 // Use functional state update to ensure it gets the newly selected bookingService
 setBookingAmount((prevAmount) => {
 // This will be slightly off since bookingService might just have changed, 
 // but we fix it in the next useEffect that listens to bookingService changes anyway
 return prevAmount;
 });
 setDonationCategories(getDonationTypes());
 setDonationCategory((prevCategory) => {
 const types = getDonationTypes();
 return types.includes(prevCategory) ? prevCategory : types[0] || "General";
 });
 setSupportRequests((await getSupportRequests(user?.email)).requests || []);
 setEventsData(
 (eventsRes.events || []).map((event) => ({
 ...event,
 formattedDate: event.date ? new Date(event.date).toLocaleDateString() : event.date || "",
 }))
 );
 setPrasadamOrders(prasadamRes.orders || []);

 try {
 const roomsRes = await axios.get("/api/rooms");
 setAvailableRooms(roomsRes.data);
 localStorage.setItem("templeRooms_v2", JSON.stringify(roomsRes.data));
 } catch (err) {
 console.warn("Unable to load rooms from backend", err);
 const roomsSaved = localStorage.getItem("templeRooms_v2");
 if (roomsSaved) {
 setAvailableRooms(JSON.parse(roomsSaved));
 }
 }
 const historySaved = localStorage.getItem("templeRoomHistory");
 if (historySaved) {
 setRoomHistory(JSON.parse(historySaved));
 }
 } catch (error) {
 console.warn("Unable to load devotee data", error);
 }
 };

 loadDevoteeData();
 }, []);

 useEffect(() => {
 const selected = poojaTypes.find((type) => type.name === bookingService);
 if (selected) {
 let basePrice = selected.price || 0;
 let templeCharge = 0;
 if (Array.isArray(selected.requiredMaterials)) {
 selected.requiredMaterials.forEach(rm => {
 const itemId = typeof rm.item === 'object' ? rm.item?._id : rm.item;
 if (selectedTempleMaterials.includes(itemId)) {
 templeCharge += (Number(rm.templeCharge) || 0);
 }
 });
 }
 setBookingAmount(basePrice + templeCharge);
 }
 }, [bookingService, poojaTypes, selectedTempleMaterials]);

 useEffect(() => {
 const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);
 return () => clearInterval(timer);
 }, []);

 useEffect(() => {
 const fetchLiveRooms = async () => {
 try {
 const roomsRes = await axios.get("/api/rooms");
 setAvailableRooms(roomsRes.data);
 } catch (err) {
 console.warn("Failed to fetch live rooms:", err);
 }
 };
 const interval = setInterval(fetchLiveRooms, 5000);
 return () => clearInterval(interval);
 }, []);

 const handleLogout = () => {
 logoutUser();
 setShowLogout(false);
 navigate("/login");
 };

 const quickDonate = async (eventItem) => {
 const loadRazorpayScript = () =>
 new Promise((resolve) => {
 if (window.Razorpay) return resolve(true);
 const script = document.createElement("script");
 script.src = "https://checkout.razorpay.com/v1/checkout.js";
 script.onload = () => resolve(true);
 script.onerror = () => resolve(false);
 document.body.appendChild(script);
 });

 try {
 const amountStr = window.prompt(`Enter donation amount for ${eventItem.title}`, String(donationAmount || 501));
 if (!amountStr) return;
 const amt = Number(amountStr);
 if (Number.isNaN(amt) || amt <= 0) {
 window.alert("Please enter a valid positive amount.");
 return;
 }

 setDonationError("");
 // switch to donations page and preselect event
 setSelectedEventId(eventItem._id);
 setDonationView("Festival");
 setActivePage("Donations");
 // Create Razorpay order on backend and a pending donation record
 const { order, donation, key, simulated } = await createRazorpayOrder({
 amount: amt,
 donorName: profileData.name,
 donorEmail: profileData.email,
 donorPhone: profileData.phone,
 category: donationCategory,
 paymentMethod: donationMethod,
 notes: donationNotes,
 eventId: eventItem._id,
 });

 // If server returned a simulated donation (no Razorpay keys), treat as completed and refresh UI
 if (simulated || (donation && donation.status === "Completed")) {
 const [updatedDonations, eventsRes, notificationsRes] = await Promise.all([
 getDevoteeDonations(user?.email),
 getDevoteeEvents(),
 getDevoteeNotifications(user?.email),
 ]);

 setDonationsData(
 (updatedDonations.donations || []).map((donation) => {
 const eventMatch = (eventsRes.events || []).find((ev) => ev._id === donation.eventId || ev._id === String(donation.eventId));
 return {
 ...donation,
 eventTitle: eventMatch ? eventMatch.title : undefined,
 date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString() : donation.date || "",
 amount: donation.amount,
 };
 })
 );

 setEventsData((eventsRes.events || []).map((event) => ({ ...event, formattedDate: event.date ? new Date(event.date).toLocaleDateString() : event.date || "" })));
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));

 setDonationSuccess("Donation recorded successfully! Thank you. Please note: This payment is final and non-refundable. Your receipt is available in Receipts.");
 setDonationCategory("General");
 setDonationAmount(501);
 setDonationMethod("UPI");
 setDonationContact("");
 setDonationNotes("");
 setSelectedEventId(null);
 setActivePage("Receipts");
 return;
 }

 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setDonationError("Unable to load payment gateway. Try again later.");
 return;
 }

 const options = {
 key: key || process.env.REACT_APP_RAZORPAY_KEY_ID || "",
 amount: order.amount,
 currency: order.currency,
 name: "Temple Donations",
 description: eventItem.title || "Donation",
 order_id: order.id,
 prefill: {
 name: profileData.name,
 email: profileData.email,
 contact: profileData.phone,
 },
 handler: async function (resp) {
 try {
 setDonationLoading(true);
 await verifyRazorpayPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 donationId: donation._id,
 });

 const [updatedDonations, eventsRes, notificationsRes] = await Promise.all([
 getDevoteeDonations(user?.email),
 getDevoteeEvents(),
 getDevoteeNotifications(user?.email),
 ]);

 setDonationsData(
 (updatedDonations.donations || []).map((donation) => {
 const eventMatch = (eventsRes.events || []).find((ev) => ev._id === donation.eventId || ev._id === String(donation.eventId));
 return {
 ...donation,
 eventTitle: eventMatch ? eventMatch.title : undefined,
 date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString() : donation.date || "",
 amount: donation.amount,
 };
 })
 );

 setEventsData((eventsRes.events || []).map((event) => ({ ...event, formattedDate: event.date ? new Date(event.date).toLocaleDateString() : event.date || "" })));
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));

 setDonationSuccess("Donation recorded successfully! Thank you. Please note: This payment is final and non-refundable. Your receipt is available in Receipts.");
 setDonationCategory("General");
 setDonationAmount(501);
 setDonationMethod("UPI");
 setDonationContact("");
 setDonationNotes("");
 setSelectedEventId(null);
 setActivePage("Receipts");
 } catch (err) {
 setDonationError(err?.response?.data?.error || "Payment verification failed.");
 console.warn("verify handler error", err);
 } finally {
 setDonationLoading(false);
 }
 },
 modal: {
 ondismiss: function () {
 // user closed checkout
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 } catch (error) {
 setDonationError(error?.response?.data?.error || "Unable to process donation.");
 console.warn("quickDonate error", error);
 } finally {
 setDonationLoading(false);
 }
 };

 const handleBookingSubmit = async () => {
 setBookingError("");
 setBookingSuccess("");

 if (!bookingService || !bookingDatetime || !bookingAmount) {
 setBookingError("Please select a pooja, date and amount before booking.");
 return;
 }

 // Validate selected datetime is in the future
 const selected = new Date(bookingDatetime);
 if (Number.isNaN(selected.getTime()) || selected.getTime() <= Date.now()) {
 window.alert("Please select a future date and time for the booking.");
 return;
 }

 // Validate available days and dates
 const selectedType = poojaTypes.find((type) => type.name === bookingService);
 if (selectedType) {
 const dayName = selected.toLocaleDateString("en-US", { weekday: "long" });
 const dateString = selected.toISOString().split("T")[0];
 const isDayAllowed = selectedType.availableDays?.includes("Everyday") || selectedType.availableDays?.includes(dayName);
 const isDateAllowed = selectedType.availableDates?.includes(dateString);

 if (!isDayAllowed && !isDateAllowed) {
 window.alert(`The selected Pooja is not available on ${bookingDatetime}. Please check available days.`);
 return;
 }
 }

 if (!bookingPaymentMethod) {
 setBookingError("Please select a payment method for the booking.");
 return;
 }

 const activeEmail = String(profileData.email || user?.email || "").trim().toLowerCase();
 const activeName = String(profileData.name || user?.name || "").trim();
 const activePhone = String(profileData.phone || bookingContact || "").trim();

 if (!activeName || !activeEmail) {
 setBookingError("Please complete your profile name and email before booking a pooja.");
 return;
 }

 // loadRazorpayScript is defined at file level

 const isConfirmed = window.confirm("Once paid, there is no return of money (non-refundable). Do you want to confirm booking?");
 if (!isConfirmed) return;

 setBookingLoading(true);
 try {
 const payload = {
 devoteeName: activeName,
 devoteeEmail: activeEmail,
 devoteePhone: activePhone || undefined,
 service: bookingService,
 datetime: bookingDatetime,
 amount: bookingAmount,
 paymentMethod: bookingPaymentMethod,
 contactNumber: bookingContact || activePhone || undefined,
 notes: bookingNotes || undefined,
 };

 const bookingRes = await createDevoteeBooking(payload);
 const { booking: createdBooking, order, key, simulated } = bookingRes;

 if (!simulated && order) {
 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setBookingError("Unable to load payment gateway. Try again later.");
 return;
 }

 const options = {
 key: key || "",
 amount: order.amount,
 currency: order.currency,
 name: "Temple Pooja Booking",
 description: bookingService,
 order_id: order.id,
 prefill: {
 name: activeName,
 email: activeEmail,
 contact: activePhone,
 },
 handler: async function (resp) {
 try {
 setBookingLoading(true);
 await verifyBookingPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 bookingId: createdBooking._id,
 });

 const [bookingsRes, notificationsRes] = await Promise.all([
 getDevoteeBookings(activeEmail),
 getDevoteeNotifications(activeEmail),
 ]);
 setBookingsData(bookingsRes.bookings || []);
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));

 setBookingSuccess("Booking successful! Your order has been placed and payment is confirmed. Please note: This payment is final and non-refundable. Please bring the receipt at the time of visiting the temple to perform the pooja.");
 const firstPooja = poojaTypes[0];
 setBookingService(firstPooja?.name || "");
 setBookingDatetime("");
 setBookingAmount(firstPooja?.price || 0);
 setBookingContact("");
 setBookingNotes("");
 setBookingPaymentMethod("UPI");
 setActivePage("My Bookings");
 } catch (err) {
 setBookingError(err?.response?.data?.error || "Payment verification failed.");
 console.warn("verify booking handler error", err);
 } finally {
 setBookingLoading(false);
 }
 },
 modal: {
 ondismiss: function () {
 // user closed checkout
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 return;
 }

 if (createdBooking?._id) {
 setBookingsData((prev) => [createdBooking, ...prev.filter((booking) => booking._id !== createdBooking._id)]);
 }

 try {
 const [bookingsRes, notificationsRes] = await Promise.all([
 getDevoteeBookings(activeEmail),
 getDevoteeNotifications(activeEmail),
 ]);
 setBookingsData(bookingsRes.bookings || (createdBooking ? [createdBooking] : []));
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));
 } catch (refreshError) {
 console.warn("Unable to refresh bookings after create", refreshError);
 }

 const firstPooja = poojaTypes[0];
 setBookingService(firstPooja?.name || "");
 setBookingDatetime("");
 setBookingAmount(firstPooja?.price || 0);
 setBookingContact("");
 setBookingNotes("");
 setBookingPaymentMethod("UPI");
 setSelectedTempleMaterials([]);
 setBookingSuccess("Booking successful! Your order has been placed and payment is confirmed. Please note: This payment is final and non-refundable. Please bring the receipt at the time of visiting the temple to perform the pooja.");
 setActivePage("My Bookings");
 } catch (error) {
 console.warn("Unable to create booking", error);
 setBookingError(error?.response?.data?.error || "Unable to create booking. Please try again.");
 } finally {
 setBookingLoading(false);
 }
 };

 const handleRoomSubmit = async () => {
 setRoomError("");
 setRoomSuccess("");

 if (!roomCheckIn || !roomCheckOut) {
 setRoomError("Please select check-in and check-out dates.");
 return;
 }

 const checkInDate = new Date(roomCheckIn);
 const checkOutDate = new Date(roomCheckOut);

 if (Number.isNaN(checkInDate.getTime()) || checkInDate.getTime() <= Date.now()) {
 setRoomError("Check-in date/time must be in the future.");
 return;
 }

 if (Number.isNaN(checkOutDate.getTime()) || checkOutDate.getTime() <= checkInDate.getTime()) {
 setRoomError("Check-out date/time must be after check-in date/time.");
 return;
 }

 // Calculate number of days
 const diffMs = checkOutDate.getTime() - checkInDate.getTime();
 const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) || 1;
 const finalAmount = roomAmount * diffDays;

 const isConfirmed = window.confirm(`Room Booking Total: ${formatCurrency(finalAmount)} for ${diffDays} day(s). Once paid, it is non-refundable. Do you want to proceed?`);
 if (!isConfirmed) return;

 setRoomLoading(true);
 try {
 const activeEmail = String(profileData.email || user?.email || "").trim().toLowerCase();
 const activeName = String(profileData.name || user?.name || "").trim();
 const activePhone = String(profileData.phone || "").trim();

 // Find the specific selected room
 const targetRoom = availableRooms.find((r) => r.number === selectedRoomNumber);
 if (!targetRoom || targetRoom.status !== "Available") {
 setRoomError(`Room "${selectedRoomNumber}" is not available. Please choose another room.`);
 setRoomLoading(false);
 return;
 }

 // Mark the room as occupied in availableRooms
 const updatedRooms = availableRooms.map((r) => {
 if (r.number === targetRoom.number) {
 return {
 ...r,
 status: "Occupied",
 devotee: activeName,
 phone: activePhone,
 days: diffDays,
 payMode: roomPaymentMethod,
 checkinDate: roomCheckIn.split("T")[0],
 };
 }
 return r;
 });

 // Append new booking to room history
 const newBooking = {
 id: `B-${Math.floor(1000 + Math.random() * 9000)}`,
 devoteeName: activeName,
 phone: activePhone,
 roomNumber: targetRoom.number,
 roomType: targetRoom.type,
 amount: finalAmount,
 days: diffDays,
 checkinDate: roomCheckIn.split("T")[0],
 checkoutDate: roomCheckOut.split("T")[0],
 payMode: roomPaymentMethod,
 status: "Active",
 };

 const updatedHistory = [newBooking, ...roomHistory];

 // Create a devotee booking ledger record in backend
 const payload = {
 devoteeName: activeName,
 devoteeEmail: activeEmail,
 devoteePhone: activePhone || undefined,
 service: `Room Allotment: Room ${targetRoom.number} (${roomType})`,
 datetime: roomCheckIn,
 amount: finalAmount,
 paymentMethod: roomPaymentMethod,
 notes: `Check-in: ${formatDateTimeDisplay(roomCheckIn)} | Check-out: ${formatDateTimeDisplay(roomCheckOut)}`,
 };

 const bookingRes = await createDevoteeBooking(payload);
 const { booking: createdBooking, order, key, simulated } = bookingRes;

 const completeBookingLocally = async () => {
 try {
 await axios.post("/api/rooms/book", {
 roomNumber: targetRoom.number,
 devoteeName: activeName,
 phone: activePhone,
 days: diffDays,
 payMode: roomPaymentMethod,
 checkinDate: roomCheckIn,
 checkoutDate: roomCheckOut
 });
 } catch (err) {
 console.warn("Failed to book room on backend database:", err);
 }

 setRoomSuccess(`Room ${targetRoom.number} booking successful! Duration: ${diffDays} day(s). Amount paid: ${formatCurrency(finalAmount)}.`);
 setRoomCheckIn("");
 setRoomCheckOut("");
 try {
 const [bookingsRes, roomsRes] = await Promise.all([
 getDevoteeBookings(activeEmail),
 axios.get("/api/rooms"),
 ]);
 setBookingsData(bookingsRes.bookings || []);
 setAvailableRooms(roomsRes.data);
 } catch (e) {}
 };

 if (!simulated && order) {
 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setRoomError("Unable to load payment gateway. Try again later.");
 setRoomLoading(false);
 return;
 }

 const options = {
 key: key || "",
 amount: order.amount,
 currency: order.currency,
 name: "Temple Room Booking",
 description: `Room ${targetRoom.number} (${roomType})`,
 order_id: order.id,
 prefill: {
 name: activeName,
 email: activeEmail,
 contact: activePhone,
 },
 handler: async function (resp) {
 try {
 setRoomLoading(true);
 await verifyBookingPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 bookingId: createdBooking._id,
 });

 await completeBookingLocally();
 } catch (err) {
 console.warn("verifyBookingPayment failed for room", err);
 setRoomError(err?.response?.data?.error || "Payment verification failed. Please contact support.");
 } finally {
 setRoomLoading(false);
 }
 },
 modal: {
 ondismiss: function () {
 setRoomLoading(false);
 },
 },
 theme: {
 color: "#d97706",
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 } else {
 await completeBookingLocally();
 }

 } catch (error) {
 console.warn("Unable to create room booking", error);
 setRoomError(error?.response?.data?.error || "Unable to create room booking. Please try again.");
 } finally {
 setRoomLoading(false);
 }
 };

 const handleDonationSubmit = async () => {
 setDonationError("");
 setDonationSuccess("");

 if (!donationCategory.trim() || donationAmount <= 0) {
 setDonationError("Please choose a donation category and enter a valid amount.");
 return;
 }

 if (donationContact && !/^\+?[0-9\s-]{7,15}$/.test(donationContact.trim())) {
 setDonationError("Please enter a valid contact number for the donation.");
 return;
 }

 const isConfirmed = window.confirm("Once paid, there is no return of money (non-refundable). Do you want to confirm donation?");
 if (!isConfirmed) return;

 setDonationLoading(true);

 try {
 // If user chooses Cash, record donation immediately as completed
 if (!donationMethod || donationMethod === "Cash") {
 await createDevoteeDonation({
 donorName: profileData.name,
 donorEmail: profileData.email,
 donorPhone: profileData.phone,
 amount: donationAmount,
 category: donationCategory,
 paymentMethod: donationMethod || "Cash",
 contactNumber: donationContact,
 notes: donationNotes,
 eventId: selectedEventId || undefined,
 });

 const [updatedDonations, eventsRes, notificationsRes] = await Promise.all([
 getDevoteeDonations(user?.email),
 getDevoteeEvents(),
 getDevoteeNotifications(user?.email),
 ]);

 setDonationsData(
 (updatedDonations.donations || []).map((donation) => {
 const eventMatch = (eventsRes.events || []).find((ev) => ev._id === donation.eventId || ev._id === String(donation.eventId));
 return {
 ...donation,
 eventTitle: eventMatch ? eventMatch.title : undefined,
 date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString() : donation.date || "",
 amount: donation.amount,
 };
 })
 );
 setEventsData((eventsRes.events || []).map((event) => ({ ...event, formattedDate: event.date ? new Date(event.date).toLocaleDateString() : event.date || "" })));
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));
 setDonationSuccess("Donation recorded successfully! Thank you. Please note: This payment is final and non-refundable. Your receipt is available in Receipts.");
 setDonationCategory("General");
 setDonationAmount(501);
 setDonationMethod("UPI");
 setDonationContact("");
 setDonationNotes("");
 setSelectedEventId(null);
 setActivePage("Receipts");
 return;
 }

 // Otherwise, treat as online payment and create a Razorpay order
 const loadRazorpayScript = () =>
 new Promise((resolve) => {
 if (window.Razorpay) return resolve(true);
 const script = document.createElement("script");
 script.src = "https://checkout.razorpay.com/v1/checkout.js";
 script.onload = () => resolve(true);
 script.onerror = () => resolve(false);
 document.body.appendChild(script);
 });

 const { order, donation, key, simulated } = await createRazorpayOrder({
 amount: donationAmount,
 donorName: profileData.name,
 donorEmail: profileData.email,
 donorPhone: profileData.phone,
 category: donationCategory,
 paymentMethod: donationMethod,
 notes: donationNotes,
 eventId: selectedEventId || undefined,
 });

 // If server returned a simulated donation (no Razorpay keys), treat as completed and refresh UI
 if (simulated || (donation && donation.status === "Completed")) {
 const [updatedDonations, eventsRes, notificationsRes] = await Promise.all([
 getDevoteeDonations(user?.email),
 getDevoteeEvents(),
 getDevoteeNotifications(user?.email),
 ]);

 setDonationsData(
 (updatedDonations.donations || []).map((donation) => {
 const eventMatch = (eventsRes.events || []).find((ev) => ev._id === donation.eventId || ev._id === String(donation.eventId));
 return {
 ...donation,
 eventTitle: eventMatch ? eventMatch.title : undefined,
 date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString() : donation.date || "",
 amount: donation.amount,
 };
 })
 );

 setEventsData((eventsRes.events || []).map((event) => ({ ...event, formattedDate: event.date ? new Date(event.date).toLocaleDateString() : event.date || "" })));
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));

 setDonationSuccess("Donation recorded successfully! Thank you. Please note: This payment is final and non-refundable. Your receipt is available in Receipts.");
 setDonationCategory("General");
 setDonationAmount(501);
 setDonationMethod("UPI");
 setDonationContact("");
 setDonationNotes("");
 setSelectedEventId(null);
 setActivePage("Receipts");
 return;
 }

 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setDonationError("Unable to load payment gateway. Try again later.");
 return;
 }

 const options = {
 key: key || process.env.REACT_APP_RAZORPAY_KEY_ID || "",
 amount: order.amount,
 currency: order.currency,
 name: "Temple Donations",
 description: (eventsData.find((e) => e._id === selectedEventId) || {}).title || donationCategory,
 order_id: order.id,
 prefill: {
 name: profileData.name,
 email: profileData.email,
 contact: profileData.phone,
 },
 handler: async function (resp) {
 try {
 setDonationLoading(true);
 await verifyRazorpayPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 donationId: donation._id,
 });

 const [updatedDonations, eventsRes, notificationsRes] = await Promise.all([
 getDevoteeDonations(user?.email),
 getDevoteeEvents(),
 getDevoteeNotifications(user?.email),
 ]);

 setDonationsData(
 (updatedDonations.donations || []).map((donation) => {
 const eventMatch = (eventsRes.events || []).find((ev) => ev._id === donation.eventId || ev._id === String(donation.eventId));
 return {
 ...donation,
 eventTitle: eventMatch ? eventMatch.title : undefined,
 date: donation.createdAt ? new Date(donation.createdAt).toLocaleDateString() : donation.date || "",
 amount: donation.amount,
 };
 })
 );

 setEventsData((eventsRes.events || []).map((event) => ({ ...event, formattedDate: event.date ? new Date(event.date).toLocaleDateString() : event.date || "" })));
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));

 setDonationSuccess("Donation recorded successfully! Thank you. Please note: This payment is final and non-refundable. Your receipt is available in Receipts.");
 setDonationCategory("General");
 setDonationAmount(501);
 setDonationMethod("UPI");
 setDonationContact("");
 setDonationNotes("");
 setSelectedEventId(null);
 setActivePage("Receipts");
 } catch (err) {
 setDonationError(err?.response?.data?.error || "Payment verification failed.");
 console.warn("verify handler error", err);
 } finally {
 setDonationLoading(false);
 }
 },
 modal: {
 ondismiss: function () {
 // user closed checkout
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 } catch (error) {
 setDonationError(error?.response?.data?.error || "Unable to process donation.");
 console.warn("Unable to submit donation", error);
 } finally {
 setDonationLoading(false);
 }
 };

 const handleSupportSubmit = async () => {
 if (!supportSubject.trim() || !supportMessage.trim()) return;

 try {
 await submitDevoteeSupport({
 name: profileData.name,
 email: profileData.email,
 subject: supportSubject,
 message: supportMessage,
 });
 setSupportSubject("");
 setSupportMessage("");
 setSupportStatus("Support request sent to admin successfully.");
 const [notificationsRes, supportRes] = await Promise.all([
 getDevoteeNotifications(user?.email),
 getSupportRequests(user?.email),
 ]);
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));
 setSupportRequests(supportRes.requests || []);
 } catch (error) {
 setSupportStatus("Unable to send support request.");
 console.warn("Unable to send support request", error);
 }
 };

 const addPdfFooter = (doc, margin, pageWidth, pageHeight) => {
 doc.setDrawColor(229, 217, 197);
 doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18);
 doc.setFont("helvetica", "normal");
 doc.setFontSize(8);
 doc.setTextColor(112, 103, 94);
 doc.text("Generated by Temple Billing System", margin, pageHeight - 10);
 doc.text("Thank you for your devotion and support.", pageWidth - margin, pageHeight - 10, { align: "right" });
 };

 const downloadPdfFile = (filename, lines) => {
 const doc = new jsPDF({ unit: "mm", format: "a4" });
 const pageWidth = doc.internal.pageSize.getWidth();
 const pageHeight = doc.internal.pageSize.getHeight();
 const margin = 16;
 let y = 42;

 doc.setFillColor(180, 106, 19);
 doc.rect(0, 0, pageWidth, 28, "F");
 doc.setTextColor(255, 255, 255);
 doc.setFont("helvetica", "bold");
 doc.setFontSize(16);
 doc.text("Sri Shanti Mahadev Mandir", margin, 12);
 doc.setFont("helvetica", "normal");
 doc.setFontSize(10);
 doc.text("Temple Billing System Report", margin, 20);

 doc.setTextColor(31, 29, 25);
 doc.setFontSize(10);
 lines.forEach((line) => {
 const splitLines = doc.splitTextToSize(String(line), pageWidth - margin * 2);
 splitLines.forEach((text) => {
 if (y > pageHeight - 26) {
 addPdfFooter(doc, margin, pageWidth, pageHeight);
 doc.addPage();
 y = 24;
 }
 doc.text(text, margin, y);
 y += 7;
 });
 });

 addPdfFooter(doc, margin, pageWidth, pageHeight);
 doc.save(filename);
 };

 const downloadReceiptPdf = ({ filename, title, receiptId, receiptDate, status, devotee, details, items, totalAmount, notes }) => {
 const doc = new jsPDF({ unit: "mm", format: "a4" });
 const pageWidth = doc.internal.pageSize.getWidth();
 const pageHeight = doc.internal.pageSize.getHeight();
 const margin = 16;
 let y = 18;

 doc.setFillColor(180, 106, 19);
 doc.rect(0, 0, pageWidth, 34, "F");
 doc.setTextColor(255, 255, 255);
 doc.setFont("helvetica", "bold");
 doc.setFontSize(17);
 doc.text("Sri Shanti Mahadev Mandir", margin, y);
 doc.setFont("helvetica", "normal");
 doc.setFontSize(10);
 doc.text("Official Temple Receipt", margin, y + 8);
 doc.text(`Receipt No: ${receiptId}`, pageWidth - margin, y, { align: "right" });
 doc.text(`Date: ${receiptDate}`, pageWidth - margin, y + 8, { align: "right" });

 y = 48;
 doc.setTextColor(31, 29, 25);
 doc.setFont("helvetica", "bold");
 doc.setFontSize(15);
 doc.text(title, margin, y);

 doc.setFontSize(9);
 doc.setFillColor(250, 247, 241);
 doc.setDrawColor(229, 217, 197);
 doc.roundedRect(pageWidth - margin - 40, y - 7, 40, 10, 2, 2, "FD");
 doc.setTextColor(116, 81, 25);
 doc.text(String(status || "Completed"), pageWidth - margin - 20, y - 1, { align: "center" });

 y += 12;
 doc.setFillColor(255, 252, 246);
 doc.setDrawColor(235, 226, 213);
 doc.roundedRect(margin, y, pageWidth - margin * 2, 34, 2, 2, "FD");
 doc.setTextColor(31, 29, 25);
 doc.setFont("helvetica", "bold");
 doc.setFontSize(10);
 doc.text("Devotee Details", margin + 4, y + 7);
 doc.setFont("helvetica", "normal");
 doc.setFontSize(9);
 doc.text(`Name: ${devotee.name || "-"}`, margin + 4, y + 15);
 doc.text(`Email: ${devotee.email || "-"}`, margin + 4, y + 22);
 doc.text(`Phone: ${devotee.phone || "-"}`, margin + 4, y + 29);

 y += 44;
 doc.setFont("helvetica", "bold");
 doc.setFontSize(10);
 doc.text("Receipt Details", margin, y);
 y += 6;
 doc.setFont("helvetica", "normal");
 doc.setFontSize(9);
 details.filter(Boolean).forEach(([label, value]) => {
 doc.setTextColor(112, 92, 62);
 doc.text(`${label}:`, margin, y);
 doc.setTextColor(31, 29, 25);
 doc.text(String(value || "-"), margin + 42, y);
 y += 7;
 });

 y += 4;
 const tableX = margin;
 const tableWidth = pageWidth - margin * 2;
 const colWidths = [tableWidth - 62, 24, 38];
 const headerHeight = 10;
 doc.setFillColor(255, 240, 223);
 doc.setDrawColor(241, 206, 156);
 doc.rect(tableX, y, tableWidth, headerHeight, "FD");
 doc.setFont("helvetica", "bold");
 doc.setFontSize(9);
 doc.setTextColor(110, 69, 7);
 doc.text("Description", tableX + 3, y + 6.5);
 doc.text("Qty", tableX + colWidths[0] + 3, y + 6.5);
 doc.text("Amount", tableX + colWidths[0] + colWidths[1] + colWidths[2] - 3, y + 6.5, { align: "right" });
 y += headerHeight;

 doc.setFont("helvetica", "normal");
 doc.setTextColor(31, 29, 25);
 items.forEach((row) => {
 const descriptionLines = doc.splitTextToSize(String(row.description || "-"), colWidths[0] - 6);
 const rowHeight = Math.max(12, descriptionLines.length * 5 + 4);
 doc.setDrawColor(232, 225, 214);
 doc.rect(tableX, y, tableWidth, rowHeight, "S");
 doc.text(descriptionLines, tableX + 3, y + 6);
 doc.text(String(row.quantity || "1"), tableX + colWidths[0] + 3, y + 6);
 doc.text(String(row.amount || "-"), tableX + tableWidth - 3, y + 6, { align: "right" });
 y += rowHeight;
 });

 y += 6;
 doc.setFillColor(250, 247, 241);
 doc.roundedRect(pageWidth - margin - 72, y, 72, 18, 2, 2, "F");
 doc.setFont("helvetica", "bold");
 doc.setFontSize(9);
 doc.setTextColor(112, 92, 62);
 doc.text("Total Amount", pageWidth - margin - 68, y + 7);
 doc.setTextColor(31, 29, 25);
 doc.setFontSize(12);
 doc.text(String(totalAmount || "Rs 0"), pageWidth - margin - 4, y + 13, { align: "right" });

 if (notes) {
 y += 28;
 doc.setFont("helvetica", "bold");
 doc.setFontSize(10);
 doc.text("Notes", margin, y);
 doc.setFont("helvetica", "normal");
 doc.setFontSize(9);
 doc.text(doc.splitTextToSize(String(notes), pageWidth - margin * 2), margin, y + 7);
 }

 addPdfFooter(doc, margin, pageWidth, pageHeight);
 doc.save(filename);
 };

 const getReceiptDevotee = (item = {}) => ({
 name: item.devoteeName || item.donorName || profileData.name || "-",
 email: item.devoteeEmail || item.donorEmail || item.email || profileData.email || "-",
 phone: item.devoteePhone || item.donorPhone || item.phone || item.contactNumber || profileData.phone || "-",
 address: item.address || item.devoteeAddress || profileData.address || "-",
 });

 const handleReceiptDownload = (item, type = "donation") => {
 let receiptNo = "";
 let title = "";
 let poojaBookings = [];
 let prasadamOrders = [];
 let notesArr = [];
 let transactionId = item.transactionId || "-";
 let isOnline = true;
 let paymentMode = item.paymentMethod || "UPI";
 let amount = parseFloat(item.amount) || 0;
 
 if (type === "combined" || item.isCombined || (item.items && item.items.length > 0)) {
 receiptNo = item.bookingNumber || buildReceiptId("CB", item);
 title = "Combined Sacred Booking & Prasadam Bill";
 poojaBookings = (item.items || []).filter(i => i.type !== "prasadam").map((i, idx) => ({
 slNo: idx + 1,
 name: i.description || i.name,
 date: i.date ? formatDateDisplay(i.date) : "-",
 qty: i.quantity || 1,
 amount: (i.price || 0) * (i.quantity || 1)
 }));
 prasadamOrders = (item.items || []).filter(i => i.type === "prasadam").map((i, idx) => ({
 slNo: idx + 1,
 name: i.description || i.name,
 date: "-",
 qty: i.quantity || 1,
 amount: (i.price || 0) * (i.quantity || 1)
 }));
 notesArr = ["Non-refundable sacred offering. All selected poojas & prasadam items combined into 1 single receipt."];
 } else if (type === "booking") {
 receiptNo = item.bookingNumber || buildReceiptId("PB", item);
 title = "Pooja Booking Receipt";
 poojaBookings = [{
 slNo: 1,
 name: item.service || "Pooja Booking",
 date: item.datetime ? formatDateTimeDisplay(item.datetime) : "-",
 qty: 1,
 amount: amount
 }];
 if (item.notes) notesArr.push(item.notes);
 } else if (type === "prasadam") {
 receiptNo = buildReceiptId("PR", item);
 title = "Prasadam Receipt";
 prasadamOrders = [{
 slNo: 1,
 name: item.itemName || "Prasadam",
 date: "-",
 qty: item.quantity || 1,
 amount: amount
 }];
 } else {
 receiptNo = buildReceiptId("DN", item);
 title = item.eventTitle ? `Donation: ${item.eventTitle}` : "Donation Receipt";
 poojaBookings = [{
 slNo: 1,
 name: item.category || item.type || "Donation",
 date: item.date || item.createdAt ? formatDateDisplay(item.date || item.createdAt) : "-",
 qty: 1,
 amount: amount
 }];
 if (item.notes) notesArr.push(item.notes);
 }

 const devotee = getReceiptDevotee(item);

 let devoteeMaterialsArr = [];
 let templeMaterialsArr = [];
 if (item.snapshotMaterials && Array.isArray(item.snapshotMaterials)) {
 const templeReqs = (item.templeMaterialRequests || []).map(r => r.itemName);
 item.snapshotMaterials.forEach(m => {
 const matString = `${m.itemName} (${m.qty} ${m.unit})`;
 if (templeReqs.includes(m.itemName) || m.responsibilityType === 'TEMPLE_PROVIDES') {
 if (!templeMaterialsArr.includes(matString)) templeMaterialsArr.push(matString);
 } else {
 if (!devoteeMaterialsArr.includes(matString)) devoteeMaterialsArr.push(matString);
 }
 });
 }

 if (item.poojaRules && Array.isArray(item.poojaRules)) {
 item.poojaRules.forEach(rule => {
 if (!notesArr.includes(rule)) notesArr.push(rule);
 });
 }

 setViewingReceiptData({
 isOnline,
 receiptNo,
 bookingDate: formatDateDisplay(item.createdAt || new Date()),
 paymentMode,
 transactionId,
 cashierName: "Online Portal",
 devoteeName: devotee.name,
 mobile: devotee.phone,
 email: devotee.email,
 address: devotee.address,
 poojaBookings,
 prasadamOrders,
 subTotal: amount,
 templeCharges: 0,
 grandTotal: amount,
 amountInWords: `Rs. ${amount}`,
 devoteeMaterials: devoteeMaterialsArr,
 templeMaterials: templeMaterialsArr,
 notes: notesArr
 });
 };

 const handleDownloadReceiptView = async () => {
 const receiptElement = document.getElementById("receipt-preview-content");
 if (!receiptElement) return;

 try {
 const canvas = await html2canvas(receiptElement, {
 scale: 2,
 useCORS: true,
 logging: false,
 backgroundColor: "#ffffff"
 });
 const imgData = canvas.toDataURL("image/jpeg", 1.0);
 
 const pdf = new jsPDF("p", "mm", "a4");
 const pdfWidth = pdf.internal.pageSize.getWidth();
 const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
 
 pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
 pdf.save(`receipt-${viewingReceiptData?.receiptNo || 'download'}.pdf`);
 } catch (err) {
 console.error("Failed to generate PDF", err);
 alert("Failed to download receipt.");
 }
 };

 const handlePaymentHistoryDownload = () => {
 if (historyTab === "Prasadam") {
 const lines = ["Temple Billing System - Prasadam Orders History", "--------------------------------------------"];
 prasadamOrders.forEach((item) => {
 lines.push(
 `${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : item.date || ""} | ${item.itemName}${item.quantity ? ` x${item.quantity}` : ""} | ${formatCurrency(item.amount)} | ${item.status || "Placed"}`
 );
 });
 downloadPdfFile("prasadam-history.pdf", lines);
 return;
 }

 const lines = ["Temple Billing System - Donation History", "-------------------------------------"];
 donationsData.forEach((item) => {
 lines.push(
 `${item.date || (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "")} | ${item.category || item.type || "Donation"} | ${formatCurrency(item.amount)} | ${item.status || "Completed"}`
 );
 });
 downloadPdfFile("donation-history.pdf", lines);
 };

 const handlePrasadamSubmit = async () => {
 setPrasadamMessage("");
 const isConfirmed = window.confirm("Once paid, there is no return of money (non-refundable). Do you want to confirm order?");
 if (!isConfirmed) return;

 try {
 const orderRes = await createPrasadamOrder({
 devoteeName: profileData.name,
 email: profileData.email,
 phone: profileData.phone,
 ...prasadamForm,
 });

 const { order, rzpOrder, key, simulated } = orderRes;

 if (!simulated && rzpOrder) {
 const loadRazorpayScript = () =>
 new Promise((resolve) => {
 if (window.Razorpay) return resolve(true);
 const script = document.createElement("script");
 script.src = "https://checkout.razorpay.com/v1/checkout.js";
 script.onload = () => resolve(true);
 script.onerror = () => resolve(false);
 document.body.appendChild(script);
 });

 const loaded = await loadRazorpayScript();
 if (!loaded) {
 setPrasadamMessage("Unable to load payment gateway. Try again later.");
 return;
 }

 const options = {
 key: key || "",
 amount: rzpOrder.amount,
 currency: rzpOrder.currency,
 name: "Temple Prasadam Order",
 description: order.itemName,
 order_id: rzpOrder.id,
 prefill: {
 name: profileData.name,
 email: profileData.email,
 contact: profileData.phone,
 },
 handler: async function (resp) {
 try {
 await verifyPrasadamPayment({
 razorpay_order_id: resp.razorpay_order_id,
 razorpay_payment_id: resp.razorpay_payment_id,
 razorpay_signature: resp.razorpay_signature,
 orderId: order._id,
 });

 const ordersRes = await getPrasadamOrders(user?.email);
 setPrasadamOrders(ordersRes.orders || []);
 const notificationsRes = await getDevoteeNotifications(user?.email);
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));
 setPrasadamForm({
 itemName: "Laddu Prasadam",
 quantity: 1,
 paymentMethod: "UPI",
 });
 setPrasadamMessage("Prasadam order placed successfully! Payment is confirmed. Please note: This payment is final and non-refundable.");
 } catch (err) {
 setPrasadamMessage(err?.response?.data?.error || "Payment verification failed.");
 console.warn("verify prasadam order handler error", err);
 }
 },
 modal: {
 ondismiss: function () {
 // user closed checkout
 },
 },
 };

 const rzp = new window.Razorpay(options);
 rzp.open();
 return;
 }

 const ordersRes = await getPrasadamOrders(user?.email);
 setPrasadamOrders(ordersRes.orders || []);
 const notificationsRes = await getDevoteeNotifications(user?.email);
 setNotificationsData(formatNotifications(notificationsRes.notifications || []));
 setPrasadamForm({
 itemName: "Laddu Prasadam",
 quantity: 1,
 paymentMethod: "UPI",
 });
 setPrasadamMessage("Prasadam order placed successfully! Payment is confirmed. Please note: This payment is final and non-refundable.");
 } catch (error) {
 setPrasadamMessage(error?.response?.data?.error || "Unable to place prasadam order.");
 }
 };

 const handleCancelPrasadam = async (id) => {
 try {
 await cancelPrasadamOrder(id);
 const ordersRes = await getPrasadamOrders(user?.email);
 setPrasadamOrders(ordersRes.orders || []);
 setPrasadamMessage("Order cancelled successfully.");
 } catch (error) {
 setPrasadamMessage(error?.response?.data?.error || "Unable to cancel order.");
 }
 };

 const handleProfileSave = async () => {
 setProfileError("");
 setProfileMessage("");
 try {
 const res = await updateDevoteeProfile({
 currentEmail: profileData.email,
 name: profileForm.name,
 email: profileForm.email,
 phone: profileForm.phone,
 address: profileForm.address,
 place: profileForm.place,
 });
 setProfileData(res.profile);
 if (updateUser) {
 updateUser({ name: res.profile.name, email: res.profile.email, role: res.profile.role });
 }
 setProfileEditMode(false);
 setProfileMessage("✅ Profile updated successfully!");
 setTimeout(() => setProfileMessage(""), 3000);
 } catch (error) {
 setProfileError(error?.response?.data?.error || "Unable to update profile.");
 }
 };

 const renderDashboard = () => (
 <>
 <section className="mb-6 mt-4">
 <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-slate-100 sm:text-5xl">Welcome back, {devoteeName}!</h1>
 <p className="mt-1.5 text-lg font-medium text-amber-800/80 dark:text-amber-300/80">May your visit be blessed with joy and peace.</p>
 </section>

 <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
 {stats.map((item) => (
 <article
 key={item.title}
 className={`group relative overflow-hidden rounded-3xl border p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1.5 shadow-sm hover:shadow-xl ${item.cardStyle}`}
 >
 <div className="flex items-start justify-between">
 <div>
 <p className="text-sm font-extrabold tracking-wider text-gray-500 dark:text-slate-400 uppercase">{item.title}</p>
 <p className={`mt-3 text-4xl sm:text-5xl font-black tracking-tight ${item.valueColor || "text-gray-900"}`}>{item.value}</p>
 </div>
 <IconCircle className={`${item.tone} h-16 w-16 shadow-sm`} icon={item.icon} />
 </div>

 <div className="mt-6 flex items-center justify-between border-t border-gray-100/80 pt-4">
 <button
 type="button"
 onClick={() => {
 if (item.action === "View Details") setActivePage("My Bookings");
 if (item.action === "View Bookings") setActivePage("My Bookings");
 if (item.action === "View History") setActivePage("Receipts");
 if (item.action === "View Orders") {
 setActivePage("Booking");
 setBookingTab("Prasadam");
 }
 }}
 className="group/btn inline-flex items-center gap-2 text-sm sm:text-base font-bold text-[#bc630f] hover:text-[#8e4909] transition-colors"
 >
 <span>{item.action}</span>
 <svg
 viewBox="0 0 24 24"
 className="h-5 w-5 fill-none stroke-current stroke-2 transition-transform duration-200 group-hover/btn:translate-x-1"
 >
 <path d="M5 12h14M12 5l7 7-7 7" />
 </svg>
 </button>
 </div>
 </article>
 ))}
 </section>

 <section className="mt-6 grid gap-6 xl:grid-cols-3">
 {/* Upcoming Bookings Card */}
 <article className="flex flex-col justify-between rounded-3xl border border-gray-100 dark:border-slate-800 bg-white/75 dark:bg-slate-900/90 dark:text-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
 <div>
 <div className="mb-5 flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
 <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2"><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M7 3v4M17 3v4M3.5 9h17M8.5 13h3v3h-3z" /></svg>
 </span>
 <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Upcoming Bookings</h2>
 </div>
 <button type="button" onClick={() => setActivePage("My Bookings")} className="text-xs font-bold text-amber-700 hover:text-amber-900">
 View All
 </button>
 </div>

 <div className="space-y-3">
 {upcomingBookings.length > 0 ? (
 upcomingBookings.slice(0, 3).map((item) => (
 <div key={`${item.service}-${item.datetime}-${item._id || Math.random()}`} className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-purple-50/30 dark:bg-purple-950/20 p-4 transition-colors hover:bg-purple-50/60 dark:hover:bg-purple-950/30">
 <div className="flex items-center justify-between gap-3">
 <p className="text-base font-bold text-gray-900 dark:text-slate-100">{item.service}</p>
 <span className="rounded-full bg-emerald-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2.5 py-0.5 text-xs font-bold text-emerald-800">Confirmed</span>
 </div>
 <p className="mt-1.5 text-xs font-medium text-gray-600 dark:text-slate-400">{formatDateTimeDisplay(item.datetime)}</p>
 </div>
 ))
 ) : (
 <div className="rounded-2xl border border-dashed border-gray-200 dark:border-slate-800 p-6 text-center text-sm font-medium text-gray-500 dark:text-slate-400">
 No upcoming bookings found yet.
 </div>
 )}
 </div>
 </div>

 <div className="mt-5 border-t border-gray-100 pt-3 text-right">
 <button type="button" onClick={() => setActivePage("My Bookings")} className="text-xs font-bold text-purple-700 hover:text-purple-900 transition-colors">
 View All Bookings &rarr;
 </button>
 </div>
 </article>

 {/* Recent Donations Card */}
 <article className="flex flex-col justify-between rounded-3xl border border-gray-100 dark:border-slate-800 bg-white/75 dark:bg-slate-900/90 dark:text-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
 <div>
 <div className="mb-5 flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
 <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M12 20s-6.5-4.2-8.5-8.2a5 5 0 0 1 8.1-5.6l.4.4.4-.4a5 5 0 0 1 8.1 5.6C18.5 15.8 12 20 12 20z" /></svg>
 </span>
 <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Recent Donations</h2>
 </div>
 <button type="button" onClick={() => setActivePage("Receipts")} className="text-xs font-bold text-amber-700 hover:text-amber-900">
 View All
 </button>
 </div>

 <div className="space-y-3">
 {donationsData.length > 0 ? (
 donationsData.slice(0, 3).map((item) => (
 <div key={`${item.type}-${item.date}-${item._id || Math.random()}`} className="flex items-center justify-between rounded-2xl border border-gray-100 dark:border-slate-800 bg-emerald-50/30 dark:bg-emerald-950/20 p-4 transition-colors hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30">
 <div>
 <p className="text-base font-bold text-gray-900 dark:text-slate-100">{item.type}</p>
 <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{item.date}</p>
 </div>
 <p className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">{formatCurrency(item.amount)}</p>
 </div>
 ))
 ) : (
 <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm font-medium text-gray-500">
 No donations recorded yet.
 </div>
 )}
 </div>
 </div>

 <div className="mt-5 border-t border-gray-100 pt-3 text-right">
 <button type="button" onClick={() => setActivePage("Receipts")} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 transition-colors">
 View All Donations &rarr;
 </button>
 </div>
 </article>

 {/* Notifications Card */}
 <article className="flex flex-col justify-between rounded-3xl border border-gray-100 dark:border-slate-800 bg-white/75 dark:bg-slate-900/90 dark:text-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
 <div>
 <div className="mb-5 flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
 <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M15 18h5l-1.3-1.3a1 1 0 0 1-.3-.7V11a6.4 6.4 0 1 0-12.8 0v5a1 1 0 0 1-.3.7L4 18h5" /><path d="M10 18a2 2 0 1 0 4 0" /></svg>
 </span>
 <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Notifications</h2>
 </div>
 <button type="button" onClick={() => setActivePage("Notifications")} className="text-xs font-bold text-amber-700 hover:text-amber-900">
 View All
 </button>
 </div>

 <div className="space-y-3">
 {notificationsData.length > 0 ? (
 notificationsData.slice(0, 3).map((item) => (
 <div key={`${item.title}-${item.date}-${item._id || Math.random()}`} className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-amber-50/30 dark:bg-amber-950/20 p-4 transition-colors hover:bg-amber-50/60 dark:hover:bg-amber-950/30">
 <p className="text-sm font-bold text-gray-900 dark:text-slate-100">{item.title}</p>
 <p className="mt-0.5 text-xs text-gray-500">{item.date}</p>
 {item.message && <p className="mt-1.5 text-xs text-gray-600 dark:text-slate-300 line-clamp-2">{item.message}</p>}
 </div>
 ))
 ) : (
 <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm font-medium text-gray-500">
 No notifications yet.
 </div>
 )}
 </div>
 </div>

 <div className="mt-5 border-t border-gray-100 pt-3 text-right">
 <button type="button" onClick={() => setActivePage("Notifications")} className="text-xs font-bold text-amber-700 hover:text-amber-900 transition-colors">
 View All Notifications &rarr;
 </button>
 </div>
 </article>
 </section>

 {/* Festival Banner */}
 <section className="relative mt-6 overflow-hidden rounded-3xl shadow-md transition-all hover:shadow-lg">
 <img src={templeImage} alt="Festival banner" className="h-44 w-full object-cover sm:h-48" />
 <div className="absolute inset-0 bg-gradient-to-r from-amber-950/90 via-amber-900/60 to-transparent"></div>
 <div className="absolute inset-0 flex items-center justify-between px-8 text-white">
 <div>
 <span className="inline-block rounded-full bg-amber-400/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300 backdrop-blur-md">
 Upcoming Festival
 </span>
 <h3 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{upcomingFestival.title}</h3>
 <p className="mt-1 text-sm font-medium text-amber-100/90">{upcomingFestival.dateDisplay}</p>
 </div>
 <button
 type="button"
 onClick={() => setActivePage("Festival Events")}
 className="rounded-2xl border border-white/40 bg-temple-100/20 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-2.5 text-sm font-bold text-white backdrop-blur-md hover:bg-temple-100/30 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors shadow-sm"
 >
 View Details
 </button>
 </div>
 </section>
 </>
 );

 const renderBookPooja = () => {
 const selectedUnitPrice = prasadamMenu[prasadamForm.itemName] || 0;
 const totalPrasadamPrice = selectedUnitPrice * (Number(prasadamForm.quantity) || 1);

 return (
 <div className="space-y-6">
 {/* Four Glassy Tabs at the Top */}
 <div className="flex gap-2 sm:gap-4 rounded-[24px] bg-temple-100/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-white/60 p-2 backdrop-blur-xl shadow-sm max-w-3xl mx-auto">
 <button
 type="button"
 onClick={() => setBookingTab("Pooja")}
 className={`flex-1 py-3 px-3 text-[14px] font-extrabold rounded-[20px] transition-all duration-300 ${
 bookingTab === "Pooja" || bookingTab === "MultiCart"
 ? "bg-gradient-to-r from-[#d97706] to-[#f59e0b] text-white shadow-lg shadow-amber-600/30 scale-[1.02]"
 : "bg-transparent text-[#78350f] dark:text-amber-200 hover:bg-temple-100/50 dark:hover:bg-slate-800 hover:shadow-sm"
 }`}
 >
 🌸 Book Pooja
 </button>
 <button
 type="button"
 onClick={() => setBookingTab("Prasadam")}
 className={`flex-1 py-3 px-3 text-[14px] font-extrabold rounded-[20px] transition-all duration-300 ${
 bookingTab === "Prasadam"
 ? "bg-gradient-to-r from-[#d97706] to-[#f59e0b] text-white shadow-lg shadow-amber-600/30 scale-[1.02]"
 : "bg-transparent text-[#78350f] dark:text-amber-200 hover:bg-temple-100/50 dark:hover:bg-slate-800 hover:shadow-sm"
 }`}
 >
 📦 Order Prasada
 </button>
 <button
 type="button"
 onClick={() => setBookingTab("Room")}
 className={`flex-1 py-3 px-3 text-[14px] font-extrabold rounded-[20px] transition-all duration-300 ${
 bookingTab === "Room"
 ? "bg-gradient-to-r from-[#d97706] to-[#f59e0b] text-white shadow-lg shadow-amber-600/30 scale-[1.02]"
 : "bg-transparent text-[#78350f] dark:text-amber-200 hover:bg-temple-100/50 dark:hover:bg-slate-800 hover:shadow-sm"
 }`}
 >
 🏨 Book Room
 </button>
 </div>

 {bookingTab !== "Room" && (
 <>
 {/* Top Header */}
 <div className="rounded-3xl border border-amber-200/60 dark:border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 dark:from-amber-950/40 dark:via-slate-900 dark:to-amber-950/30 p-6 sm:p-8 backdrop-blur-md shadow-sm text-center">
 <h2 className="text-3xl sm:text-4xl font-black text-[#4a2b0f] dark:text-amber-100">
 Book Sacred Services & Order Prasadam
 </h2>
 <p className="mt-2 text-base font-semibold text-[#7a4918] dark:text-amber-200/80">
 Select your Poojas or Prasadam items on the left side. As soon as you select, they immediately appear on the right side. Confirm all selections and pay in 1 single combined bill!
 </p>
 </div>

 {/* SPLIT LAYOUT CONTAINER */}
 <div className="grid gap-8 lg:grid-cols-12">
 {/* LEFT SIDE: ITEM SELECTOR FORM */}
 <div className="lg:col-span-6 space-y-6">
 <div className="rounded-3xl border border-amber-200/80 dark:border-slate-800 bg-temple-100/90 dark:bg-slate-900/90 p-6 sm:p-8 shadow-xl backdrop-blur-xl">
 {/* TOGGLE SELECTOR: POOJA vs PRASADAM */}
 <div className="flex gap-2 rounded-2xl bg-amber-100/60 dark:bg-slate-800/80 p-1.5 border border-amber-200 dark:border-slate-700 mb-6">
 <button
 type="button"
 onClick={() => setBookingTab("Pooja")}
 className={`flex-1 py-3 px-4 text-sm font-extrabold rounded-xl transition ${
 bookingTab !== "Prasadam"
 ? "bg-amber-600 text-white shadow-md"
 : "bg-transparent text-amber-900 dark:text-amber-200 hover:bg-amber-200/50 dark:hover:bg-slate-700"
 }`}
 >
 🌸 Select Pooja
 </button>
 <button
 type="button"
 onClick={() => setBookingTab("Prasadam")}
 className={`flex-1 py-3 px-4 text-sm font-extrabold rounded-xl transition ${
 bookingTab === "Prasadam"
 ? "bg-amber-600 text-white shadow-md"
 : "bg-transparent text-amber-900 dark:text-amber-200 hover:bg-amber-200/50 dark:hover:bg-slate-700"
 }`}
 >
 📦 Select Prasadam
 </button>
 </div>

 {bookingTab !== "Prasadam" ? (
 /* POOJA SELECTION FORM */
 <div className="space-y-5">
 <h3 className="text-xl font-black text-amber-950 dark:text-amber-100 flex items-center gap-2">
 🌸 Add Sacred Pooja
 </h3>

 <div>
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 dark:text-amber-200 mb-1">
 Choose Service
 </label>
 <select
 value={bookingService}
 onChange={(e) => {
 const selectedService = e.target.value;
 const selectedType = poojaTypes.find((type) => type.name === selectedService);
 setBookingService(selectedService);
 setBookingAmount(selectedType?.price || 0);
 setSelectedTempleMaterials([]);
 setPrepAcknowledged(false);
 }}
 className="w-full rounded-2xl border border-amber-200 dark:border-slate-700 bg-amber-50/50 dark:bg-slate-800 px-4 py-3.5 text-base font-bold text-slate-900 dark:text-slate-100 outline-none focus:border-amber-500 focus:bg-temple-100 dark:focus:bg-slate-800"
 >
 {poojaTypes.map((service) => (
 <option key={service.name} value={service.name}>
 {service.name} — {formatCurrency(service.price)}
 </option>
 ))}
 </select>

 {(() => {
 const selectedType = poojaTypes.find((type) => type.name === bookingService);
 if (!selectedType || !selectedType.requiredMaterials || selectedType.requiredMaterials.length === 0) return null;
 
 const reqMats = Array.isArray(selectedType.requiredMaterials) ? selectedType.requiredMaterials : [];
 
 const templeProvides = reqMats.filter(m => m.responsibilityType === "TEMPLE_PROVIDES");
 const devoteeMustBring = reqMats.filter(m => m.responsibilityType === "DEVOTEE_MUST_BRING");
 const prepRequired = reqMats.filter(m => m.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED");
 const orTemple = reqMats.filter(m => m.responsibilityType === "DEVOTEE_OR_TEMPLE");
 
 return (
 <div className="mt-3 rounded-2xl bg-amber-50 dark:bg-slate-800/90 p-4 border border-amber-200 dark:border-slate-700 text-sm font-semibold text-amber-900 dark:text-amber-200">
 <div className="mb-3 text-amber-950 dark:text-amber-100 font-black">🌸 Pooja Materials Requirement</div>
 
 {templeProvides.length > 0 && (
 <div className="mb-4">
 <div className="text-teal-800 dark:text-teal-300 font-bold mb-1 border-b border-teal-200 dark:border-teal-800/60 pb-1">Temple Will Provide</div>
 {templeProvides.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="flex justify-between py-1 text-xs">
 <span>{rm.qty} {rm.unit} {item.name}</span>
 <span className="text-teal-600">No action required</span>
 </div>
 );
 })}
 </div>
 )}

 {devoteeMustBring.length > 0 && (
 <div className="mb-4">
 <div className="text-blue-800 dark:text-blue-300 font-bold mb-1 border-b border-blue-200 dark:border-blue-800/60 pb-1">You Must Bring on Pooja Day</div>
 {devoteeMustBring.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="flex justify-between py-1 text-xs">
 <span>{rm.qty} {rm.unit} {item.name} {rm.mandatory && <span className="text-red-500">*</span>}</span>
 </div>
 );
 })}
 </div>
 )}

 {orTemple.length > 0 && (
 <div className="mb-4">
 <div className="text-green-800 font-bold mb-1 border-b border-green-200 pb-1">You Can Bring OR Temple Can Arrange</div>
 {orTemple.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 return (
 <div key={idx} className="flex items-center justify-between py-1.5 text-xs">
 <span>{rm.qty} {rm.unit} {item.name} {rm.mandatory && <span className="text-red-500">*</span>}</span>
 <label className="flex items-center gap-2 cursor-pointer bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-green-200 hover:bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg transition-colors">
 <input 
 type="checkbox"
 checked={selectedTempleMaterials.includes(item._id)}
 onChange={(e) => {
 if (e.target.checked) {
 setSelectedTempleMaterials(prev => [...prev, item._id]);
 setBookingAmount(prev => prev + Number(rm.templeCharge));
 } else {
 setSelectedTempleMaterials(prev => prev.filter(id => id !== item._id));
 setBookingAmount(prev => prev - Number(rm.templeCharge));
 }
 }}
 className="accent-green-600 w-3.5 h-3.5 cursor-pointer"
 />
 <span className="font-bold">Temple Arrange (+₹{rm.templeCharge})</span>
 </label>
 </div>
 );
 })}
 </div>
 )}

 {prepRequired.length > 0 && (
 <div className="mb-4">
 <div className="text-orange-800 font-bold mb-1 border-b border-orange-200 pb-1">Advance Preparation Required</div>
 {prepRequired.map((rm, idx) => {
 const item = typeof rm.item === 'object' ? rm.item : { _id: rm.item, name: rm.itemName || "Item" };
 
 let startDateStr = "Select a date";
 if (bookingDatetime) {
 const d = new Date(bookingDatetime);
 d.setDate(d.getDate() - (rm.preparationDaysBeforePooja || 0));
 startDateStr = d.toLocaleDateString("en-IN", { day: 'numeric', month: 'short' });
 }

 return (
 <div key={idx} className="py-2 text-xs bg-orange-100/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-lg p-2 mb-2">
 <div className="flex justify-between font-bold text-orange-950 mb-1">
 <span>{rm.qty} {rm.unit} {item.name} {rm.mandatory && <span className="text-red-500">*</span>}</span>
 <span className="text-orange-700">{rm.preparationDaysBeforePooja} Days Prep</span>
 </div>
 <div className="mb-1"><span className="font-semibold text-orange-800">Start Date:</span> {startDateStr}</div>
 <div className="mb-1"><span className="font-semibold text-orange-800">Instructions:</span> {rm.preparationInstructions}</div>
 {rm.requiresAdvanceCollection && (
 <div className="text-red-700 font-semibold bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-1 rounded mt-1">
 🚨 Needs Advance Collection: {rm.collectionInstructions}
 </div>
 )}
 </div>
 );
 })}
 <label className="flex items-center gap-2 mt-2 cursor-pointer bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 border border-orange-300 p-2 rounded text-xs font-bold text-orange-900">
 <input type="checkbox" checked={prepAcknowledged} onChange={(e) => setPrepAcknowledged(e.target.checked)} className="accent-orange-600 w-4 h-4" />
 I have read and understood the preparation instructions
 </label>
 </div>
 )}
 
 {/* Show Pooja Schedule Constraints */}
 <div className="mt-4 pt-3 border-t border-amber-200/50 text-xs">
 <span className="font-bold text-amber-950">Available Days: </span>
 <span>{selectedType.availableDays?.join(", ") || "Everyday"}</span>
 {selectedType.availableStartTime && (
 <span className="ml-3"><span className="font-bold text-amber-950">Time: </span>{selectedType.availableStartTime} - {selectedType.availableEndTime}</span>
 )}
 </div>
 </div>
 );
 })()}
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1">
 Booking Date
 </label>
 <input
 type="date"
 value={bookingDatetime}
 onChange={(e) => {
 const val = e.target.value;
 if (!val) {
 setBookingDatetime("");
 return;
 }
 
 const selectedType = poojaTypes.find((t) => t.name === bookingService);
 if (selectedType && selectedType.availableDays && selectedType.availableDays.length > 0) {
 // Check if "Everyday" is in the array, if so, allow it
 const isEveryday = selectedType.availableDays.some(d => d.toLowerCase() === "everyday");
 if (!isEveryday) {
 const dateObj = new Date(val);
 const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
 const dayName = daysOfWeek[dateObj.getDay()];
 
 if (!selectedType.availableDays.includes(dayName)) {
 toast.error(`${selectedType.name} is only available on: ${selectedType.availableDays.join(", ")}`);
 setBookingDatetime("");
 return;
 }
 }
 }
 setBookingDatetime(val);
 }}
 min={minBookingDatetime}
 className="w-full rounded-2xl border border-amber-200 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 />
 </div>

 <div>
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1">
 Unit Amount
 </label>
 <div className="rounded-2xl border border-amber-200 bg-amber-100/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3.5 text-base font-extrabold text-amber-950">
 {formatCurrency(bookingAmount)}
 </div>
 </div>
 </div>

 <button
 type="button"
 onClick={() => {
 const selectedType = poojaTypes.find((t) => t.name === bookingService);
 
 // Check for preparation materials acknowledgement
 const prepRequired = (selectedType?.requiredMaterials || []).filter(m => m.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED");
 if (prepRequired.length > 0 && !prepAcknowledged) {
 toast.error("Please acknowledge that you have read the preparation instructions.");
 return;
 }

 // Check effective minimum advance days
 const minAdvanceDays = selectedType?.minimumAdvanceBookingDays || 0;
 const maxPrepDays = prepRequired.reduce((max, rm) => Math.max(max, rm.preparationDaysBeforePooja || 0), 0);
 const effectiveMinDays = Math.max(minAdvanceDays, maxPrepDays);

 if (effectiveMinDays > 0) {
 const today = new Date(currentDateTime || new Date());
 today.setHours(0, 0, 0, 0);
 const selectedDate = new Date(bookingDatetime);
 selectedDate.setHours(0, 0, 0, 0);
 
 const diffTime = Math.abs(selectedDate - today);
 const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
 
 if (diffDays < effectiveMinDays) {
 if (selectedType?.strictAdvancePreparation) {
 toast.error(`This Pooja requires at least ${effectiveMinDays} days of advance notice/preparation. Please select an eligible later date.`);
 return;
 } else {
 toast.warning(`Note: Booking within ${effectiveMinDays} days requires special Temple Approval.`);
 }
 }
 }

 const price = bookingAmount || selectedType?.price || 501;
 addToCart({
 id: `pooja-${bookingService}-${Date.now()}`,
 type: "pooja",
 name: bookingService,
 price: Number(price),
 quantity: 1,
 date: bookingDatetime || new Date().toLocaleDateString(),
 selectedTempleMaterials: [...selectedTempleMaterials],
 });
 setSelectedTempleMaterials([]);
 setPrepAcknowledged(false);
 toast.success(`Added ${bookingService} to your bill!`);
 }}
 disabled={!bookingDatetime}
 className={`w-full rounded-2xl py-4 text-base font-extrabold text-white shadow-md transition ${!bookingDatetime ? "bg-amber-400 opacity-70 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-700 hover:scale-[1.02]"}`}
 >
 + Add Pooja to Bill (Reflects Right ➔)
 </button>
 </div>
 ) : (
 /* PRASADAM SELECTION FORM */
 <div className="space-y-5">
 <h3 className="text-xl font-black text-amber-950 flex items-center gap-2">
 📦 Add Prasadam Offering
 </h3>

 <div>
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1">
 Choose Prasadam Item
 </label>
 <select
 value={prasadamForm.itemName}
 onChange={(e) => setPrasadamForm((prev) => ({ ...prev, itemName: e.target.value }))}
 className="w-full rounded-2xl border border-amber-200 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3.5 text-base font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 {Object.keys(prasadamMenu).map((item) => (
 <option key={item} value={item}>
 {item} — {formatCurrency(prasadamMenu[item])} each
 </option>
 ))}
 </select>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1">
 Quantity
 </label>
 <input
 type="number"
 min="1"
 value={prasadamForm.quantity}
 onChange={(e) => setPrasadamForm((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value)) }))}
 className="w-full rounded-2xl border border-amber-200 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3.5 text-base font-bold text-slate-900 outline-none focus:border-amber-500 focus:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 />
 </div>

 <div>
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1">
 Subtotal Amount
 </label>
 <div className="rounded-2xl border border-amber-200 bg-amber-100/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3.5 text-base font-extrabold text-amber-950">
 {formatCurrency(selectedUnitPrice * (Number(prasadamForm.quantity) || 1))}
 </div>
 </div>
 </div>

 <button
 type="button"
 onClick={() => {
 addToCart({
 id: `prasadam-${prasadamForm.itemName}-${Date.now()}`,
 type: "prasadam",
 name: prasadamForm.itemName,
 price: selectedUnitPrice,
 quantity: Number(prasadamForm.quantity) || 1,
 });
 toast.success(`Added ${prasadamForm.quantity} x ${prasadamForm.itemName} to your bill!`);
 }}
 className="w-full rounded-2xl bg-amber-600 hover:bg-amber-700 py-4 text-base font-extrabold text-white shadow-md transition hover:scale-[1.02]"
 >
 + Add Prasada to Bill (Reflects Right ➔)
 </button>
 </div>
 )}
 </div>
 </div>

 {/* RIGHT SIDE: LIVE SELECTED ITEMS SUMMARY & BILLING PANEL */}
 <div className="lg:col-span-6">
 <div className="sticky top-6 rounded-3xl border border-amber-300 dark:border-amber-500/30 bg-gradient-to-b from-white via-amber-50/40 to-amber-100/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-6 sm:p-8 shadow-xl backdrop-blur-xl">
 <div className="mb-5 flex items-center justify-between border-b border-amber-200/80 dark:border-slate-700 pb-4">
 <div>
 <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
 🛒 You Have Selected These:
 </h3>
 <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
 Live reflection of all your chosen Poojas & Prasadam items
 </p>
 </div>
 <span className="rounded-full bg-amber-200 dark:bg-amber-950 dark:border dark:border-amber-800 px-3.5 py-1 text-xs font-extrabold text-amber-950 dark:text-amber-200">
 {cartItems.length} Item(s)
 </span>
 </div>

 {cartItems.length === 0 ? (
 <div className="py-14 text-center border-2 border-dashed border-amber-200 dark:border-slate-700 rounded-3xl bg-temple-100/60 dark:bg-slate-800/60 p-6">
 <span className="text-4xl">🙏</span>
 <p className="mt-3 text-base font-bold text-slate-800 dark:text-slate-200">No items selected yet.</p>
 <p className="mt-1 text-xs font-semibold text-slate-500">
 Select a Pooja or Prasadam on the left side and click "+ Add to Bill". It will immediately appear right here!
 </p>
 </div>
 ) : (
 <div className="space-y-5">
 {/* SELECTED ITEMS LIST */}
 <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
 {cartItems.map((item) => (
 <div
 key={item.id}
 className="flex items-center justify-between rounded-2xl bg-white/70 dark:bg-slate-800/90 dark:text-slate-200 p-4 border border-amber-200/80 dark:border-slate-700 shadow-xs transition hover:border-amber-400"
 >
 <div className="flex-1 pr-2">
 <div className="flex items-center gap-2">
 <span className="text-sm font-extrabold">
 {item.type === "pooja" ? "🌸" : "📦"}
 </span>
 <p className="text-base font-bold text-slate-900 dark:text-slate-100">{item.name}</p>
 </div>
 <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
 Qty: {item.quantity} | {formatCurrency(item.price)} each
 {item.date && ` | Date: ${item.date}`}
 </p>
 </div>

 {/* QUANTITY CONTROLS */}
 <div className="flex items-center gap-1.5 mr-3">
 <button
 type="button"
 onClick={() => updateCartQuantity(item.id, -1)}
 className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-900 font-extrabold hover:bg-amber-200"
 >
 -
 </button>
 <span className="w-5 text-center font-black text-sm text-slate-900">{item.quantity}</span>
 <button
 type="button"
 onClick={() => updateCartQuantity(item.id, 1)}
 className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-900 font-extrabold hover:bg-amber-200"
 >
 +
 </button>
 </div>

 <div className="text-right">
 <p className="font-black text-base text-amber-900">
 {formatCurrency(item.price * item.quantity)}
 </p>
 <button
 type="button"
 onClick={() => removeFromCart(item.id)}
 className="text-xs font-bold text-red-500 hover:text-red-700"
 >
 Remove ✕
 </button>
 </div>
 </div>
 ))}
 </div>

 {/* PAYMENT METHOD */}
 <div className="pt-2">
 <label className="block text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1">
 Select Payment Method (Razorpay Gateway)
 </label>
 <select
 value={cartPaymentMethod}
 onChange={(e) => setCartPaymentMethod(e.target.value)}
 className="w-full rounded-2xl border border-amber-200 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3.5 text-sm font-bold text-slate-900 outline-none focus:border-amber-500"
 >
 <option value="UPI">
 💳 Razorpay Gateway (UPI, GPay, PhonePe, Cards, Net Banking)
 </option>
 <option value="UPI">📱 Razorpay UPI / QR Code</option>
 <option value="Card">💳 Razorpay Cards (Visa / Mastercard)</option>
 <option value="Net Banking">🏦 Razorpay Net Banking</option>
 </select>
 </div>

 {/* GRAND TOTAL */}
 <div className="flex items-center justify-between rounded-2xl bg-amber-200/80 dark:bg-amber-950/60 p-4 border border-amber-300 dark:border-amber-800">
 <span className="text-base font-extrabold text-amber-950 dark:text-amber-200">
 Grand Total Amount (1 Bill):
 </span>
 <span className="text-2xl font-black text-amber-950 dark:text-amber-100">{formatCurrency(cartTotal)}</span>
 </div>

 {/* CHECKOUT BUTTON */}
 <button
 type="button"
 onClick={handleCombinedCheckout}
 className="w-full rounded-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 py-4 text-lg font-black text-white shadow-xl shadow-amber-600/30 transition hover:scale-[1.02]"
 >
 💳 Pay via Razorpay & Generate 1 Combined Bill
 </button>
 </div>
 )}
 </div>
 </div>
 </div>
 </>
 )}

 {bookingTab === "Room" && (
 <div className="space-y-8">
 <div className={`${glassCard}`}>
 <h2 className="text-[2rem] font-bold">Book Guest Room</h2>
 <p className="mt-2 text-[#4f4f4f] dark:text-slate-300">Rent a comfortable guest room at the temple premises for your visit.</p>

 <div className="mt-8 grid gap-8 lg:grid-cols-3">
 {/* LEFT: ROOM CARD LISTING */}
 <div className="lg:col-span-2 space-y-4">
 <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">Available Rooms</h3>
 <div className="grid gap-4 sm:grid-cols-2">
 {availableRooms
 .filter((room) => room.status === "Available")
 .slice(0, showAllRooms ? undefined : 4)
 .map((room) => {
 const isSelected = selectedRoomNumber === room.number;
 return (
 <div
 key={room.number}
 onClick={() => {
 setSelectedRoomNumber(room.number);
 setRoomType(room.type);
 setRoomAmount(room.price);
 }}
 className={`rounded-2xl border p-5 transition duration-300 backdrop-blur-md ${
 isSelected
 ? "cursor-pointer border-[#ff9f2f] bg-temple-100/60 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-md ring-2 ring-[#ff9f2f]"
 : "cursor-pointer border-white/40 bg-temple-100/20 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:bg-temple-100/40 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 <div className="flex items-center justify-between">
 <span className="text-xs uppercase tracking-wider font-semibold text-[#8b5a0a]">
 {room.block} - {room.floor}
 </span>
 <span className="rounded px-2 py-0.5 text-xs font-bold bg-[#0f766e]/10 text-[#0f766e]">
 {formatCurrency(room.price)} / day
 </span>
 </div>
 <p className="mt-3 text-xl font-extrabold text-slate-900 dark:text-slate-100">Room {room.number} ({room.type})</p>
 <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Bed Type: {room.bedType || "Double"} | Capacity: {room.capacity || 2} Persons</p>

 <div className="mt-4 border-t border-slate-200/50 pt-3">
 <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Amenities Included:</p>
 <div className="mt-1 flex flex-wrap gap-1">
 {(room.amenities || []).slice(0, 4).map((amenity) => (
 <span
 key={amenity}
 className="rounded-full bg-slate-100 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 text-[10px] text-slate-600 font-medium"
 >
 {amenity}
 </span>
 ))}
 </div>
 </div>
 </div>
 );
 })}
 </div>
 {availableRooms.filter((room) => room.status === "Available").length > 4 && (
 <div className="mt-4 text-center">
 <button
 type="button"
 onClick={() => setShowAllRooms(!showAllRooms)}
 className="inline-flex items-center justify-center px-6 py-2.5 rounded-full border-2 border-[#ff9f2f] bg-transparent text-[#ff9f2f] hover:bg-[#ff9f2f] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:text-white font-bold text-sm transition-all duration-300 shadow-md"
 >
 {showAllRooms ? "Show Less" : "Show All Rooms"}
 </button>
 </div>
 )}
 </div>

 {/* RIGHT: ROOM BOOKING FORM */}
 <div className={glassSection}>
 <h3 className="text-xl font-semibold">Room Booking Form</h3>
 <div className="mt-4 grid gap-4">
 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] mb-1">Selected Room</label>
 <select
 value={selectedRoomNumber}
 onChange={(e) => {
 const num = e.target.value;
 setSelectedRoomNumber(num);
 const matchingRoom = availableRooms.find((r) => r.number === num);
 if (matchingRoom) {
 setRoomType(matchingRoom.type);
 setRoomAmount(matchingRoom.price);
 }
 }}
 className={glassInput}
 >
 <option value="">-- Select Room --</option>
 {availableRooms.filter((r) => r.status === "Available").map((r) => (
 <option key={r.number} value={r.number}>
 Room {r.number} ({r.type} - {formatCurrency(r.price)} / day)
 </option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] mb-1">Check-in Date & Time</label>
 <input
 type="datetime-local"
 value={roomCheckIn}
 onChange={(e) => setRoomCheckIn(e.target.value)}
 className={glassInput}
 />
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] mb-1">Check-out Date & Time</label>
 <input
 type="datetime-local"
 value={roomCheckOut}
 onChange={(e) => setRoomCheckOut(e.target.value)}
 className={glassInput}
 />
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] mb-1">Payment Method</label>
 <select
 value={roomPaymentMethod}
 onChange={(e) => setRoomPaymentMethod(e.target.value)}
 className={glassInput}
 >
 <option value="UPI">UPI</option>
 <option value="Card">Card</option>
 <option value="Net Banking">Net Banking</option>
 </select>
 </div>

 {roomCheckIn && roomCheckOut && (() => {
 const days = Math.ceil((new Date(roomCheckOut) - new Date(roomCheckIn)) / (1000 * 60 * 60 * 24)) || 1;
 if (days > 0) {
 return (
 <div className="rounded-2xl bg-[#fff7e7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-[#8b5a0a] border border-amber-200/50">
 Total Duration: {days} Day(s) | Total Price: {formatCurrency(roomAmount * days)}
 </div>
 );
 }
 return null;
 })()}

 <button
 type="button"
 onClick={handleRoomSubmit}
 disabled={roomLoading}
 className={glassButton}
 >
 {roomLoading ? "Processing room booking..." : "Confirm & Book Room"}
 </button>

 {roomError && (
 <p className="rounded-2xl border border-red-100 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-red-700 mt-2">{roomError}</p>
 )}
 {roomSuccess && (
 <p className="rounded-2xl border border-emerald-100 bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-emerald-700 mt-2">{roomSuccess}</p>
 )}
 </div>
 </div>
 </div>
 </div>

 {/* MY ROOM BOOKING HISTORY */}
 <div className={`${glassCard}`}>
 <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">My Room Booking History</h3>
 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm text-[#4f3f26] dark:text-slate-200">
 <thead>
 <tr className="border-b border-white/20 dark:border-slate-800 text-slate-600 dark:text-slate-400">
 <th className="py-3 px-3">Booking ID</th>
 <th className="py-3 px-3">Room No</th>
 <th className="py-3 px-3">Room Type</th>
 <th className="py-3 px-3">Stay Details</th>
 <th className="py-3 px-3">Days</th>
 <th className="py-3 px-3">Amount Paid</th>
 <th className="py-3 px-3">Status</th>
 <th className="py-3 px-3">Action</th>
 </tr>
 </thead>
 <tbody>
 {mergedRoomHistory.filter(h => 
 h.devoteeName?.toLowerCase() === String(profileData.name || user?.name || "").trim().toLowerCase() ||
 (profileData.phone && h.phone === profileData.phone) ||
 (profileData.email && h.email === profileData.email)
 ).length === 0 ? (
 <tr>
 <td colSpan="8" className="py-6 text-center text-slate-500 font-semibold">
 No room booking records found.
 </td>
 </tr>
 ) : (
 mergedRoomHistory
 .filter(h => 
 h.devoteeName?.toLowerCase() === String(profileData.name || user?.name || "").trim().toLowerCase() ||
 (profileData.phone && h.phone === profileData.phone) ||
 (profileData.email && h.email === profileData.email)
 )
 .map((record) => (
 <tr key={record.id} className="border-b border-white/10 hover:bg-temple-100/10 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition">
 <td className="py-3 px-3 font-mono font-bold text-indigo-700">{record.id}</td>
 <td className="py-3 px-3 font-bold">{record.roomNumber}</td>
 <td className="py-3 px-3">{record.roomType}</td>
 <td className="py-3 px-3 text-xs">
 <div>Checkin: {record.checkinDate}</div>
 <div>Checkout: {record.checkoutDate}</div>
 </td>
 <td className="py-3 px-3 font-semibold">{record.days} day(s)</td>
 <td className="py-3 px-3 font-bold">{formatCurrency(record.amount)}</td>
 <td className="py-3 px-3">
 <span
 className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
 record.status === "Active"
 ? "bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-800"
 : "bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-800"
 }`}
 >
 {record.status}
 </span>
 </td>
 <td className="py-3 px-3">
 <button
 onClick={() => {
 window.alert(`Downloading Receipt ${record.id}...\nDevotee: ${record.devoteeName}\nTotal amount: ${formatCurrency(record.amount)}`);
 }}
 className="inline-flex items-center gap-1 rounded bg-[#fff3d8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2 py-1 text-xs font-semibold text-[#7f4b11] transition hover:bg-[#ffe4b4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Download Receipt
 </button>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 )}
 </div>
 );
 };

 const renderMyBookings = () => {
 // Combine bookingsData (poojas & rooms) and prasadamOrders
 const poojaAndRoomBookings = bookingsData.map(b => ({
 ...b,
 isPrasadam: false,
 isRoom: b.service && b.service.toLowerCase().includes("room"),
 datetimeForSort: b.createdAt ? new Date(b.createdAt).getTime() : (b.datetime ? new Date(b.datetime).getTime() : 0),
 }));

 const prasadamList = (prasadamOrders || []).map(o => ({
 ...o,
 bookingNumber: o.orderNumber || buildReceiptId("PO", o),
 service: `Prasada Order: ${o.itemName} (x${o.quantity || 1})`,
 datetime: o.createdAt || o.date,
 datetimeForSort: o.createdAt ? new Date(o.createdAt).getTime() : (o.date ? new Date(o.date).getTime() : 0),
 amount: o.amount,
 status: o.status || "Placed",
 isPrasadam: true,
 isRoom: false,
 }));

 const combinedList = [...poojaAndRoomBookings, ...prasadamList].sort((a, b) => b.datetimeForSort - a.datetimeForSort);
 const displayedBookings = showAllBookings ? combinedList : combinedList.slice(0, 5);

 return (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <div className="flex items-center justify-between">
 <h2 className="text-[2rem] font-bold">My Bookings</h2>
 <div className="flex items-center gap-3">
 {combinedList.length > 0 && (
 <button
 type="button"
 onClick={() => setShowAllBookings(!showAllBookings)}
 className="rounded-xl bg-[#1b7f77]/10 hover:bg-[#1b7f77]/20 text-[#1b7f77] px-4 py-2 text-sm font-semibold transition"
 >
 {showAllBookings ? "Show Recent 5" : "View All"}
 </button>
 )}
 <button type="button" onClick={() => { setActivePage("Booking"); setBookingTab("Pooja"); }} className="rounded-2xl bg-[#1b7f77] px-4 py-2 text-sm font-semibold text-white">New Booking</button>
 </div>
 </div>
 <div className="mt-6 overflow-x-auto">
 <table className="w-full min-w-[700px] text-left text-sm text-[#3f3f3f] dark:text-slate-200 border-collapse">
 <thead className="bg-[#fafafa] dark:bg-slate-800 text-[#575757] dark:text-slate-300">
 <tr className="border-b border-[#ececec] dark:border-slate-700">
 <th className="px-4 py-3">Booking/Order No</th>
 <th className="px-4 py-3">Item/Service</th>
 <th className="px-4 py-3">Date & Time</th>
 <th className="px-4 py-3">Amount</th>
 <th className="px-4 py-3 text-center">Actions</th>
 </tr>
 </thead>
 <tbody>
 {displayedBookings.length > 0 ? (
 displayedBookings.map((row) => {
 const itemNo = row.bookingNumber || buildReceiptId(row.isPrasadam ? "PO" : "PB", row);
 
 return (
 <tr key={row._id || `${row.service}-${row.datetime}`} className="border-t border-[#f0f0f0] dark:border-slate-800 hover:bg-black/5 dark:hover:bg-slate-800/50 transition-colors">
 <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#6b6b6b] dark:text-slate-400">{itemNo}</td>
 <td className="px-4 py-2.5 font-semibold text-[#1a1a1a] dark:text-slate-100">
 {row.isRoom ? (
 <span className="flex items-center gap-1.5">
 <span>🏨</span> {row.service}
 </span>
 ) : row.isPrasadam ? (
 <span className="flex items-center gap-1.5">
 <span>📦</span> {row.service}
 </span>
 ) : (
 <span className="flex items-center gap-1.5">
 <span>🌸</span> {row.service}
 </span>
 )}
 </td>
 <td className="px-4 py-2.5 text-[#4f4f4f] dark:text-slate-300">{formatDateTimeDisplay(row.datetime)}</td>
 <td className="px-4 py-2.5 font-bold text-[#1b7f77]">{formatCurrency(row.amount)}</td>
 <td className="px-4 py-2.5">
 <div className="flex justify-center">
 <button
 type="button"
 onClick={() => handleReceiptDownload(row, row.isPrasadam ? "prasadam" : "booking")}
 className="rounded-lg bg-[#1b7f77] hover:bg-[#1b7f77]/90 px-3 py-1.5 text-xs font-bold text-white transition shadow-sm"
 >
 Download
 </button>
 </div>
 </td>
 </tr>
 );
 })
 ) : (
 <tr>
 <td colSpan="5" className="px-4 py-5 text-center text-[#5d5d5d]">
 No bookings or orders available.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
 };

 const renderDonations = () => (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <h2 className="text-[2rem] font-bold">Donate</h2>
 <p className="mt-2 text-[#4f4f4f] dark:text-slate-300">Give any amount and see your donation reflected in history, payment records, and receipts.</p>
 </div>
 <div className="flex items-center gap-3">
 <div className="rounded-2xl bg-[#f4f7f3] dark:bg-teal-950/40 dark:border dark:border-teal-800/50 px-4 py-3 text-sm font-semibold text-[#1b7f77] dark:text-teal-300">
 Total Donations: {formatCurrency(totalDonations)}
 </div>
 <div className="rounded-xl border border-[#ececec] dark:border-slate-700 bg-temple-100 dark:bg-slate-800 px-3 py-1 text-sm">
 <button
 type="button"
 onClick={() => setDonationView("All")}
 className={`px-3 py-1 text-sm font-semibold ${donationView === "All" ? "bg-[#1b7f77] text-white rounded-lg" : "text-[#4f5866] rounded"}`}
 >
 All
 </button>
 <button
 type="button"
 onClick={() => setDonationView("Festival")}
 className={`ml-2 px-3 py-1 text-sm font-semibold ${donationView === "Festival" ? "bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-white rounded-lg" : "text-[#4f5866] rounded"}`}
 >
 Festival
 </button>
 </div>
 </div>
 </div>

 <div id="donation-form" className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
 <div className={glassSection}>
 {selectedEventId && (
 <div className="mb-4 rounded-xl border border-[#efe7de] bg-[#fffaf4] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-[#6b6b6b]">Selected Festival</p>
 <p className="text-lg font-semibold">{(eventsData.find(e => e._id === selectedEventId) || {}).title || "Selected Event"}</p>
 <p className="text-sm text-[#6b6b6b]">{(eventsData.find(e => e._id === selectedEventId) || {}).formattedDate || ""}</p>
 </div>
 <div>
 <button type="button" onClick={() => { setSelectedEventId(null); }} className="rounded-lg border px-3 py-1 text-sm">Change</button>
 </div>
 </div>
 </div>
 )}
 <div className="grid gap-4">
 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] dark:text-slate-300">Donation Category</label>
 <select
 value={donationCategory}
 onChange={(e) => setDonationCategory(e.target.value)}
 className={glassInput}
 >
 {displayCategories.map((category) => (
 <option key={category} value={category}>
 {category}
 </option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] dark:text-slate-300">Amount</label>
 <input
 type="number"
 min="1"
 id="donation-amount-input"
 value={donationAmount}
 onChange={(e) => setDonationAmount(Number(e.target.value))}
 className={glassInput}
 />
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] dark:text-slate-300">Payment Method</label>
 <select
 value={donationMethod}
 onChange={(e) => setDonationMethod(e.target.value)}
 className={glassInput}
 >
 {paymentMethods.map((method) => (
 <option key={method} value={method}>
 {method}
 </option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] dark:text-slate-300">Contact Number</label>
 <input
 type="tel"
 value={donationContact}
 placeholder="Optional contact"
 onChange={(e) => setDonationContact(e.target.value)}
 className={glassInput}
 />
 </div>

 <div>
 <label className="block text-sm font-semibold text-[#5d5d5d] dark:text-slate-300">Notes</label>
 <textarea
 rows={4}
 value={donationNotes}
 onChange={(e) => setDonationNotes(e.target.value)}
 placeholder="Any message for the temple"
 className={glassInput}
 />
 </div>

 {donationError && <div className="rounded-3xl bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4 text-sm text-[#a12525]">{donationError}</div>}
 {donationSuccess && <div className="rounded-3xl bg-[#e8f7ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-4 text-sm text-[#1c6f3d]">{donationSuccess}</div>}

 <button
 type="button"
 onClick={handleDonationSubmit}
 disabled={donationLoading}
 className={glassButton}
 >
 {donationLoading ? "Processing donation..." : "Donate Now"}
 </button>
 <button
 type="button"
 onClick={() => {
 setActivePage("Receipts");
 setHistoryTab("Donations");
 }}
 className="mt-2 w-full text-center text-sm font-semibold text-[#b46a13] dark:text-amber-400 hover:underline bg-transparent border-0"
 >
 View Donation History
 </button>
 </div>
 </div>

 <div className={glassSection}>
 <div className="flex items-center justify-between">
 <h3 className="text-xl font-semibold dark:text-slate-100">Donation History</h3>
 {donationsData.length > 5 && (
 <button
 type="button"
 onClick={() => setShowAllDonations(!showAllDonations)}
 className="rounded-xl bg-[#1b7f77]/10 hover:bg-[#1b7f77]/20 dark:bg-teal-900/30 dark:hover:bg-teal-900/50 text-[#1b7f77] dark:text-teal-400 px-3 py-1.5 text-xs font-semibold transition"
 >
 {showAllDonations ? "Show Recent 5" : "View All"}
 </button>
 )}
 </div>
 <p className="mt-2 text-sm text-[#5d5d5d] dark:text-slate-400">Your latest donations are stored here and used in payment history and receipts.</p>
 <div className="mt-6 space-y-3">
 {(() => {
 const filtered = donationView === "Festival"
 ? (selectedEventId ? donationsData.filter((d) => String(d.eventId) === String(selectedEventId)) : donationsData.filter((d) => d.eventId))
 : donationsData;

 if (!filtered || filtered.length === 0) return <div className={glassItem}>No donations have been recorded yet.</div>;

 const displayed = showAllDonations ? filtered : filtered.slice(0, 5);

 return displayed.map((item) => (
 <div key={`${item._id || Math.random()}`} className="rounded-[26px] border border-white/40 dark:border-slate-800 bg-temple-100/55 dark:bg-slate-900/90 dark:text-slate-200 p-4 shadow-sm backdrop-blur-sm transition-colors">
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div>
 <p className="font-semibold text-[#1f1f1f] dark:text-slate-100">{item.category || item.type || (item.eventTitle ? `Donation - ${item.eventTitle}` : "Donation")}</p>
 <p className="text-sm text-[#5d5d5d] dark:text-slate-400">{item.eventTitle ? `${item.eventTitle} • ${item.date || new Date(item.createdAt).toLocaleDateString()}` : item.date || new Date(item.createdAt).toLocaleDateString()}</p>
 </div>
 <p className="text-lg font-bold text-[#1b7f77] dark:text-teal-400">{formatCurrency(item.amount)}</p>
 </div>
 <p className="mt-2 text-sm text-[#6b6b6b] dark:text-slate-400">{item.paymentMethod || "UPI"} • {item.status || "Completed"}</p>
 </div>
 ));
 })()}
 </div>
 </div>
 </div>
 </div>
 </div>
 );
 const renderPrasadam = () => {
 const selectedUnitPrice = prasadamMenu[prasadamForm.itemName] || 0;
 const totalPrice = selectedUnitPrice * (Number(prasadamForm.quantity) || 1);

 return (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <h2 className="text-[2rem] font-bold">Prasadam Orders</h2>
 <div className="mt-6 max-w-2xl mx-auto">
 <div className={glassSection}>
 <h3 className="text-xl font-semibold">Order Prasadam</h3>
 <div className="mt-4 grid gap-3">
 <select className={glassInput} value={prasadamForm.itemName} onChange={(e) => setPrasadamForm((prev) => ({ ...prev, itemName: e.target.value }))}>
 {Object.keys(prasadamMenu).map((item) => (
 <option key={item} value={item}>{item}</option>
 ))}
 </select>
 <div className="rounded-[24px] bg-[#fff8ec] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm">Price: {formatCurrency(selectedUnitPrice)} each</div>
 <input type="number" min="1" className={glassInput} value={prasadamForm.quantity} onChange={(e) => setPrasadamForm((prev) => ({ ...prev, quantity: Number(e.target.value) }))} placeholder="Quantity" />
 <select className={glassInput} value={prasadamForm.paymentMethod} onChange={(e) => setPrasadamForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}>
 <option value="UPI">UPI</option>
 <option value="Card">Card</option>
 <option value="Net Banking">Net Banking</option>
 </select>
 <div className="rounded-[24px] bg-[#fff7e7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-[#8b5a0a]">Total: {formatCurrency(totalPrice)}</div>
 <button type="button" onClick={handlePrasadamSubmit} className={glassButton}>Pay & Place Order</button>
 <button
 type="button"
 onClick={() => {
 setActivePage("Receipts");
 setHistoryTab("Prasadam");
 }}
 className="mt-2 w-full text-center text-sm font-semibold text-[#b46a13] hover:underline bg-transparent border-0"
 >
 View Prasadam Orders History
 </button>
 {prasadamMessage && <p className="text-sm text-[#1b7f77] mt-2">{prasadamMessage}</p>}
 </div>
 </div>
 </div>
 </div>
 </div>
 );
 };

 const [historyTab, setHistoryTab] = useState("Donations");

 const renderDonationHistoryForTab = () => {
 const donationRows = (donationsData || []).map((d) => ({
 _id: d._id,
 transaction: d.eventTitle ? `${d.eventTitle} (Donation)` : d.category || d.type || "Donation",
 date: d.date || (d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ""),
 amount: d.amount,
 status: d.status || "Completed",
 }));

 return (
 <div className="mt-6 overflow-x-auto">
 <table className="w-full min-w-[650px] text-left text-sm text-[#3f3f3f] dark:text-slate-200">
 <thead className="bg-[#fafafa] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#575757]">
 <tr>
 <th className="px-5 py-3">Type</th>
 <th className="px-5 py-3">Date</th>
 <th className="px-5 py-3">Amount</th>
 <th className="px-5 py-3">Receipt</th>
 </tr>
 </thead>
 <tbody>
 {donationRows.length > 0 ? (
 donationRows.map((row) => (
 <tr key={`Donation-${row._id || Math.random()}`} className="border-t border-[#f0f0f0] dark:border-slate-800">
 <td className="px-5 py-3 font-semibold dark:text-slate-100">{row.transaction}</td>
 <td className="px-5 py-3 text-sm text-[#3f3f3f] dark:text-slate-300">{row.date}</td>
 <td className="px-5 py-3 font-semibold dark:text-teal-400">{formatCurrency(row.amount)}</td>
 <td className="px-5 py-3 text-[1.15rem] text-[#af6317] dark:text-amber-400">
 <button type="button" onClick={() => handleReceiptDownload(donationsData.find((x) => x._id === row._id) || row)} className="font-semibold hover:underline">
 Download
 </button>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="4" className="px-5 py-6 text-center text-[#5d5d5d] dark:text-slate-400">
 No donations available.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 );
 };

 const renderPrasadamHistoryForTab = () => {
 const prasadamRows = (prasadamOrders || []).map((o) => ({
 _id: o._id,
 transaction: `${o.itemName}${o.quantity ? ` x${o.quantity}` : ""}`,
 date: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "",
 amount: o.amount,
 status: normalizePrasadamStatus(o.status),
 }));

 return (
 <div className="mt-6 overflow-x-auto">
 <table className="w-full min-w-[650px] text-left text-sm text-[#3f3f3f] dark:text-slate-200">
 <thead className="bg-[#fafafa] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#575757]">
 <tr>
 <th className="px-5 py-3">Item</th>
 <th className="px-5 py-3">Date</th>
 <th className="px-5 py-3">Amount</th>
 <th className="px-5 py-3">Status</th>
 <th className="px-5 py-3">Action</th>
 </tr>
 </thead>
 <tbody>
 {prasadamRows.length > 0 ? (
 prasadamRows.map((row) => (
 <tr key={`Prasadam-${row._id || Math.random()}`} className="border-t border-[#f0f0f0]">
 <td className="px-5 py-3 font-semibold">{row.transaction}</td>
 <td className="px-5 py-3 text-sm text-[#3f3f3f]">{row.date}</td>
 <td className="px-5 py-3 font-semibold">{formatCurrency(row.amount)}</td>
 <td className="px-5 py-3">
 <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${getPrasadamStatusTone(row.status)}`}>{row.status}</span>
 </td>
 <td className="px-5 py-3">
 {canCancelPrasadamOrder(row.status) ? (
 <button
 type="button"
 onClick={() => handleCancelPrasadam(row._id)}
 className="rounded-lg bg-[#f26037] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-semibold text-white"
 >
 Cancel
 </button>
 ) : (
 <span className="text-xs font-semibold text-[#a12525]">{row.status}</span>
 )}
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan="5" className="px-5 py-6 text-center text-[#5d5d5d]">
 No prasadam orders available.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 );
 };

 const renderPaymentHistory = () => (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <h2 className="text-[2rem] font-bold">Payment History</h2>

 <div className="flex items-center gap-2 rounded-2xl bg-[#f7f7f7] dark:bg-slate-800 dark:border-slate-700 p-2">
 <button
 type="button"
 onClick={() => setHistoryTab("Donations")}
 className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
 historyTab === "Donations" ? "bg-[#1b7f77] text-white" : "bg-transparent text-[#3058d6] hover:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 Donations
 </button>
 <button
 type="button"
 onClick={() => setHistoryTab("Prasadam")}
 className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
 historyTab === "Prasadam" ? "bg-[#1b7f77] text-white" : "bg-transparent text-[#3058d6] hover:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 }`}
 >
 Prasadam Orders
 </button>
 </div>

 <button
 type="button"
 onClick={historyTab === "Donations" ? handlePaymentHistoryDownload : handlePaymentHistoryDownload}
 className="rounded-2xl bg-[#1b7f77] px-4 py-2 text-sm font-semibold text-white"
 >
 Download
 </button>
 </div>

 {historyTab === "Donations" ? renderDonationHistoryForTab() : renderPrasadamHistoryForTab()}
 </div>
 </div>
 );
 const renderReceipts = () => {
 const bookingItems = bookingsData.map(b => ({
 ...b,
 type: "Pooja Booking",
 dateKey: b.createdAt || b.datetime,
 dateDisplay: formatDateDisplay(b.datetime || b.createdAt),
 oneLineSummary: `Pooja Booking: ${b.service || "Booking"}`,
 receiptId: buildReceiptId("PB", b),
 downloadType: "booking",
 amount: b.amount,
 }));
 
 const donationItems = donationsData.map(d => ({
 ...d,
 type: "Donation",
 dateKey: d.createdAt || d.date,
 dateDisplay: formatDateDisplay(d.date || d.createdAt),
 oneLineSummary: `Donation: ${d.category || d.type || "General"}`,
 receiptId: buildReceiptId("DN", d),
 downloadType: "donation",
 amount: d.amount,
 }));
 
 const prasadamItems = prasadamOrders.map(p => ({
 ...p,
 type: "Prasadam Order",
 dateKey: p.createdAt || p.date,
 dateDisplay: formatDateDisplay(p.createdAt || p.date),
 oneLineSummary: `Prasadam: ${p.itemName} (Qty: ${p.quantity || 1})`,
 receiptId: p.orderNumber || buildReceiptId("PR", p),
 downloadType: "prasadam",
 amount: p.amount,
 }));
 
 const allReceipts = [...bookingItems, ...donationItems, ...prasadamItems].sort((a, b) => {
 const timeB = b.dateKey ? new Date(b.dateKey).getTime() : 0;
 const timeA = a.dateKey ? new Date(a.dateKey).getTime() : 0;
 return timeB - timeA;
 });

 const displayedReceipts = showAllReceipts ? allReceipts : allReceipts.slice(0, 5);

 return (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <div className="flex items-center justify-between">
 <h2 className="text-[2rem] font-bold">Receipts</h2>
 {allReceipts.length > 5 && (
 <button
 type="button"
 onClick={() => setShowAllReceipts(!showAllReceipts)}
 className="rounded-xl bg-[#1b7f77]/10 hover:bg-[#1b7f77]/20 text-[#1b7f77] px-4 py-2 text-sm font-semibold transition"
 >
 {showAllReceipts ? "Show Recent 5" : "View All"}
 </button>
 )}
 </div>
 
 <div className="mt-6 space-y-3">
 {displayedReceipts.length > 0 ? (
 displayedReceipts.map((item, idx) => (
 <div key={item._id || idx} className={`${glassItem} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
 <div className="flex-1 min-w-0">
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
 <span className="text-base font-semibold text-amber-950 dark:text-amber-200 truncate">{item.oneLineSummary}</span>
 <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-100/50 dark:bg-amber-950/60 dark:border dark:border-amber-800/50 px-2 py-0.5 rounded-md font-medium">
 {item.dateDisplay}
 </span>
 </div>
 <p className="mt-1 text-xs text-[#6b6b6b] dark:text-slate-400">Receipt ID: {item.receiptId}</p>
 </div>
 <div className="flex items-center justify-between sm:justify-end gap-4">
 <span className="text-lg font-bold text-[#1b7f77]">{formatCurrency(item.amount)}</span>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setViewingReceipt(item)}
 className="rounded-xl bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition shadow-sm"
 >
 View
 </button>
 <button
 type="button"
 onClick={() => handleReceiptDownload(item, item.downloadType)}
 className="rounded-xl bg-[#1b7f77] hover:bg-[#1b7f77]/90 px-3 py-1.5 text-xs font-semibold text-white transition shadow-sm"
 >
 Download PDF
 </button>
 </div>
 </div>
 </div>
 ))
 ) : (
 <div className={`${glassItem} text-[#5d5d5d] p-6 text-center`}>No receipts available.</div>
 )}
 </div>
 </div>

 {/* Modal/Popup for Details */}
 {viewingReceipt && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
 <div className="w-full max-w-lg bg-[#fffdfa] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 rounded-3xl border border-amber-200/50 shadow-2xl p-6 md:p-8 relative max-h-[90vh] overflow-y-auto">
 <div className="flex justify-between items-start mb-6">
 <div>
 <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-full">
 {viewingReceipt.type}
 </span>
 <h3 className="text-2xl font-bold mt-2 text-amber-950">Receipt Details</h3>
 </div>
 <button
 type="button"
 onClick={() => setViewingReceipt(null)}
 className="text-amber-900 hover:text-amber-700 font-bold text-xl p-1"
 >
 ✕
 </button>
 </div>

 <div className="space-y-4 border-t border-b border-amber-100 py-6 my-4">
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Receipt ID</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.receiptId}</span>
 </div>
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Date</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.dateDisplay}</span>
 </div>
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Service / Category</span>
 <span className="font-semibold text-amber-950">
 {viewingReceipt.service || viewingReceipt.category || viewingReceipt.itemName || "N/A"}
 </span>
 </div>

 {viewingReceipt.type === "Pooja Booking" && (
 <>
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Booking Status</span>
 <span className="font-semibold text-[#1b7f77]">{viewingReceipt.status || "Confirmed"}</span>
 </div>
 {viewingReceipt.contactNumber && (
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Contact Number</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.contactNumber}</span>
 </div>
 )}
 </>
 )}

 {viewingReceipt.type === "Donation" && (
 <>
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Transaction ID</span>
 <span className="font-semibold text-amber-950 truncate max-w-[200px]" title={viewingReceipt.transactionId}>
 {viewingReceipt.transactionId || "N/A"}
 </span>
 </div>
 {viewingReceipt.donorName && (
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Donor Name</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.donorName}</span>
 </div>
 )}
 </>
 )}

 {viewingReceipt.type === "Prasadam Order" && (
 <>
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Quantity</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.quantity || 1}</span>
 </div>
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Order Status</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.status || "Placed"}</span>
 </div>
 </>
 )}

 {viewingReceipt.paymentMethod && (
 <div className="flex justify-between text-sm">
 <span className="text-amber-800/80 font-medium">Payment Method</span>
 <span className="font-semibold text-amber-950">{viewingReceipt.paymentMethod}</span>
 </div>
 )}

 {viewingReceipt.notes && (
 <div className="pt-2 border-t border-amber-50">
 <span className="text-xs text-amber-800/60 font-medium block mb-1">Notes</span>
 <p className="text-xs text-amber-900 bg-amber-50/50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-2.5 rounded-lg border border-amber-100/50 leading-relaxed">
 {viewingReceipt.notes}
 </p>
 </div>
 )}

 <div className="flex justify-between items-center pt-4 border-t border-amber-100">
 <span className="text-base font-bold text-amber-950">Total Amount</span>
 <span className="text-2xl font-extrabold text-[#1b7f77]">{formatCurrency(viewingReceipt.amount)}</span>
 </div>
 </div>

 <div className="flex gap-3 mt-6">
 <button
 type="button"
 onClick={() => handleReceiptDownload(viewingReceipt, viewingReceipt.downloadType)}
 className="flex-1 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-md transition-all text-sm"
 >
 Download Receipt PDF
 </button>
 <button
 type="button"
 onClick={() => setViewingReceipt(null)}
 className="flex-1 bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 hover:bg-amber-200 text-amber-900 font-bold py-3.5 px-4 rounded-xl transition-all text-sm"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
 };

 const renderFestivalEvents = () => {
 const getMyDonationTotalForEvent = (eventId) => {
 if (!eventId) return 0;
 return (donationsData || [])
 .filter((d) => d && d.eventId != null && String(d.eventId) === String(eventId))
 .reduce((sum, d) => sum + (typeof d.amount === "number" ? d.amount : Number(d.amount) || 0), 0);
 };

 return (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <h2 className="text-[2rem] font-bold">Festival Events</h2>
 <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
 {eventsData.length > 0 ? (
 eventsData.map((item) => {
 const isSelected = selectedEventId === item._id;
 const myTotal = getMyDonationTotalForEvent(item._id);
 return (
 <div
 key={`${item.title}-${item.formattedDate || item._id}`}
 onClick={() => setSelectedEventId(item._id)}
 className={`${glassItem} p-4 cursor-pointer ${isSelected ? "ring-2 ring-offset-2 ring-[#ff8b00]" : ""}`}
 >
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1">
 <p className="text-lg font-semibold text-[#17151f] dark:text-slate-100">{item.title}</p>
 <p className="mt-2 flex items-center gap-2 text-sm text-[#5d5d5d] dark:text-slate-400">
 <span className="text-base">📅</span>
 {item.formattedDate || item.date}
 </p>
 {item.location && (
 <p className="mt-1 flex items-center gap-2 text-sm text-[#5d5d5d] dark:text-slate-400">
 <span className="text-base">📍</span>
 {item.location}
 </p>
 )}
 {item.description && (
 <p className="mt-2 text-xs text-[#6b6b6b]">{item.description.substring(0, 60)}...</p>
 )}
 </div>
 <div className="ml-4 flex flex-col items-end gap-2">
 <div className="text-sm text-[#6b6b6b]">{item.registrations || 0} regs</div>
 <div className="text-lg font-bold text-[#1b7f77]">{formatCurrency(myTotal || 0)}</div>
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 // switch to donations page and preselect this event
 setSelectedEventId(item._id);
 setActivePage("Donations");
 // after navigation/render, scroll to form and focus amount
 setTimeout(() => {
 const form = document.getElementById("donation-form");
 if (form) {
 form.scrollIntoView({ behavior: "smooth" });
 const amt = document.getElementById("donation-amount-input");
 if (amt) amt.focus();
 }
 }, 250);
 }}
 className="mt-2 rounded-xl bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-3 py-1 text-sm font-semibold text-white"
 >
 Donate
 </button>
 </div>
 </div>
 </div>
 );
 })
 ) : (
 <div className={`${glassItem} col-span-full text-center text-[#5d5d5d] py-8`}>
 <p className="text-lg">No festival events available.</p>
 <p className="mt-1 text-sm">Check back later for upcoming festivals!</p>
 </div>
 )}
 </div>
 </div>
 </div>
 );
 };

 const handleMarkAllRead = async () => {
 const unread = notificationsData.filter((n) => !n.read && n._id);
 if (unread.length === 0) return;
try {
 await Promise.all(unread.map((n) => markNotificationAsRead(n._id)));
 setNotificationsData((prev) =>
 prev.map((n) => ({ ...n, read: true, readAt: new Date() }))
 );
 } catch (err) {
 console.error("Failed to mark all notifications as read:", err);
 }
 };

 const renderNotifications = () => {
 const unread = notificationsData.filter((n) => !n.read);
 const userEmail = user?.email || profileData?.email || "devotee";

 const getNotificationCategory = (title, category) => {
 if (category) return String(category).toLowerCase();
 const t = String(title || "").toLowerCase();
 if (t.includes("booking") || t.includes("pooja")) return "bookings";
 if (t.includes("donation") || t.includes("received") || t.includes("payment")) return "donations";
 if (t.includes("event") || t.includes("festival") || t.includes("utsav")) return "events";
 if (t.includes("feedback") || t.includes("reply") || t.includes("support")) return "support";
 return "announcements";
 };

 const getNotificationStyle = (title, category) => {
 const cat = getNotificationCategory(title, category);
 if (cat === "bookings") {
 return {
 icon: "calendar",
 badge: "Booking",
 color: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50",
 badgeColor: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
 };
 }
 if (cat === "donations") {
 return {
 icon: "heart",
 badge: "Donation",
 color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50",
 badgeColor: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
 };
 }
 if (cat === "events") {
 return {
 icon: "temple",
 badge: "Festival / Event",
 color: "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800/50",
 badgeColor: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
 };
 }
 if (cat === "support") {
 return {
 icon: "gear",
 badge: "Support",
 color: "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50",
 badgeColor: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
 };
 }
 return {
 icon: "bell",
 badge: "Notice",
 color: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
 badgeColor: "bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200",
 };
 };

 const filteredList = notificationsData
 .filter((item) => {
 if (notificationTab === "unread" && item.read) return false;
 if (notificationCategory !== "all") {
 const cat = getNotificationCategory(item.title, item.category);
 if (cat !== notificationCategory) return false;
 }
 if (notificationSearch.trim()) {
 const q = notificationSearch.toLowerCase();
 const matchTitle = (item.title || "").toLowerCase().includes(q);
 const matchMessage = (item.message || "").toLowerCase().includes(q);
 if (!matchTitle && !matchMessage) return false;
 }
 return true;
 })
 .sort((a, b) => {
 const dateA = new Date(a.date || a.createdAt || 0).getTime();
 const dateB = new Date(b.date || b.createdAt || 0).getTime();
 return dateB - dateA;
 });

 const handleItemClick = (item) => {
 setSelectedNotificationDetail(item);
 if (!item.read && item._id) {
 markNotificationAsRead(item._id)
 .then(() => {
 setNotificationsData((prev) =>
 prev.map((n) => (n._id === item._id ? { ...n, read: true, readAt: new Date() } : n))
 );
 })
 .catch((err) => console.error("Failed to mark notification as read:", err));
 }
 };

 return (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 {/* Header Banner */}
 <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700 pb-5">
 <div>
 <div className="flex items-center gap-3">
 <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md">
 <FaBell className="text-xl" />
 </div>
 <div>
 <h2 className="text-[2.2rem] font-bold text-slate-900 dark:text-slate-100 leading-tight">
 Notifications & Email Inbox
 </h2>
 <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
 All notifications are also automatically dispatched to <strong>{userEmail}</strong>
 </p>
 </div>
 </div>
 </div>
 {unread.length > 0 && (
 <button
 type="button"
 onClick={handleMarkAllRead}
 className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-2 text-sm font-bold text-amber-800 dark:text-amber-300 transition hover:bg-amber-100 dark:hover:bg-amber-900/50 shadow-xs"
 >
 ✓ Mark all as read ({unread.length})
 </button>
 )}
 </div>

 {/* Inbox Controls & Filters */}
 <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
 {/* View Tabs */}
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={() => setNotificationTab("all")}
 className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
 notificationTab === "all"
 ? "bg-amber-600 text-white shadow-md"
 : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
 }`}
 >
 All Messages ({notificationsData.length})
 </button>
 <button
 type="button"
 onClick={() => setNotificationTab("unread")}
 className={`relative rounded-xl px-4 py-2 text-sm font-bold transition ${
 notificationTab === "unread"
 ? "bg-amber-600 text-white shadow-md"
 : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
 }`}
 >
 Unread
 {unread.length > 0 && (
 <span className="ml-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white">
 {unread.length}
 </span>
 )}
 </button>
 </div>

 {/* Search Input */}
 <div className="flex items-center gap-3">
 <div className="relative w-full sm:w-64">
 <input
 type="text"
 value={notificationSearch}
 onChange={(e) => setNotificationSearch(e.target.value)}
 placeholder="Search notifications..."
 className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
 />
 {notificationSearch && (
 <button
 onClick={() => setNotificationSearch("")}
 className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
 >
 ✕
 </button>
 )}
 </div>
 </div>
 </div>

 {/* Category Pills */}
 <div className="mt-3 flex flex-wrap gap-2">
 {[
 { id: "all", label: "All Categories" },
 { id: "bookings", label: "Bookings" },
 { id: "donations", label: "Donations" },
 { id: "events", label: "Festivals & Events" },
 { id: "support", label: "Support & Queries" },
 ].map((cat) => (
 <button
 key={cat.id}
 onClick={() => setNotificationCategory(cat.id)}
 className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
 notificationCategory === cat.id
 ? "bg-slate-800 dark:bg-slate-700 text-white shadow-xs"
 : "bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
 }`}
 >
 {cat.label}
 </button>
 ))}
 </div>

 {/* Notification Items List */}
 <div className="mt-6 space-y-3">
 {filteredList.length > 0 ? (
 filteredList.map((item) => {
 const style = getNotificationStyle(item.title, item.category);
 return (
 <div
 key={`${item.title}-${item.date}-${item._id || Math.random()}`}
 onClick={() => handleItemClick(item)}
 className={`group relative flex items-start gap-4 rounded-2xl border p-5 transition-all duration-300 cursor-pointer ${
 !item.read
 ? "border-amber-400/80 dark:border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 shadow-md ring-1 ring-amber-400/20"
 : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800"
 }`}
 >
 <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl shadow-xs ${style.color}`}>
 <AppIcon name={style.icon} className="h-5 w-5" />
 </div>

 <div className="flex-1 min-w-0">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2 flex-wrap">
 <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${style.badgeColor}`}>
 {style.badge}
 </span>
 <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
 ✉️ Sent to Email
 </span>
 </div>
 <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
 {item.date || "Recent"}
 </span>
 </div>

 <h3 className={`mt-1.5 text-base font-bold transition group-hover:text-amber-600 dark:group-hover:text-amber-400 ${
 !item.read ? "text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-200"
 }`}>
 {item.title}
 </h3>

 {item.message && (
 <p className={`mt-1.5 text-sm leading-relaxed line-clamp-2 ${
 !item.read ? "text-slate-700 dark:text-slate-300" : "text-slate-600 dark:text-slate-400"
 }`}>
 {item.message}
 </p>
 )}

 {item.attachment && (
 <div className="mt-3">
 {item.attachment.startsWith("data:image/") ? (
 <img
 src={item.attachment}
 alt="Invitation"
 className="max-h-48 rounded-xl object-contain border border-slate-200 dark:border-slate-700"
 />
 ) : (
 <a
 href={item.attachment}
 download={`Invitation-${item.title.replace(/\s+/g, "_")}.pdf`}
 onClick={(e) => e.stopPropagation()}
 className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-1.5 text-xs font-bold text-white transition shadow-xs"
 >
 📄 Download PDF Invitation
 </a>
 )}
 </div>
 )}
 </div>

 {!item.read && (
 <span className="flex-shrink-0 h-3 w-3 rounded-full bg-amber-500 ring-4 ring-amber-500/25 animate-pulse" title="Unread" />
 )}
 </div>
 );
 })
 ) : (
 <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
 <div className="rounded-2xl bg-amber-100 dark:bg-slate-800 p-4 text-amber-600 dark:text-amber-400 mb-3 shadow-xs">
 <AppIcon name="bell" className="h-8 w-8" />
 </div>
 <p className="text-base font-bold text-slate-800 dark:text-slate-200">No notifications found</p>
 <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
 {notificationTab === "unread"
 ? "You have read all notifications."
 : "No notification matches the selected filters."}
 </p>
 </div>
 )}
 </div>
 </div>

 {/* EMAIL PREVIEW MODAL */}
 {selectedNotificationDetail && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
 <div className="w-full max-w-xl rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-2xl space-y-4">
 <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
 <div className="flex items-center gap-2">
 <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
 ✉️
 </div>
 <div>
 <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
 Email Notification
 </h3>
 <p className="text-xs text-slate-500 dark:text-slate-400">
 Dispatched from Sri Shanti Mahadev Mandir
 </p>
 </div>
 </div>
 <button
 onClick={() => setSelectedNotificationDetail(null)}
 className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600"
 >
 ✕
 </button>
 </div>

 {/* Email Envelope Header */}
 <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs space-y-1.5 font-medium">
 <div className="flex gap-2">
 <span className="text-slate-400 w-16">From:</span>
 <span className="text-slate-800 dark:text-slate-200 font-bold">
 Sri Shanti Mahadev Mandir &lt;ganga.mca2002@gmail.com&gt;
 </span>
 </div>
 <div className="flex gap-2">
 <span className="text-slate-400 w-16">To:</span>
 <span className="text-slate-800 dark:text-slate-200 font-semibold">
 {userEmail}
 </span>
 </div>
 <div className="flex gap-2">
 <span className="text-slate-400 w-16">Date:</span>
 <span className="text-slate-800 dark:text-slate-200">
 {selectedNotificationDetail.date || "Just now"}
 </span>
 </div>
 <div className="flex gap-2">
 <span className="text-slate-400 w-16">Subject:</span>
 <span className="text-amber-700 dark:text-amber-400 font-bold text-sm">
 {selectedNotificationDetail.title}
 </span>
 </div>
 </div>

 {/* Email Body */}
 <div className="rounded-2xl border border-amber-200/60 dark:border-slate-700 bg-amber-50/20 dark:bg-slate-900/40 p-5">
 <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-2">
 {selectedNotificationDetail.title}
 </h4>
 <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
 {selectedNotificationDetail.message}
 </p>

 {selectedNotificationDetail.attachment && (
 <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
 {selectedNotificationDetail.attachment.startsWith("data:image/") ? (
 <img
 src={selectedNotificationDetail.attachment}
 alt="Attachment"
 className="max-h-56 rounded-xl object-contain border"
 />
 ) : (
 <a
 href={selectedNotificationDetail.attachment}
 download="Attachment.pdf"
 className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-teal-700"
 >
 📄 Download Attached Document
 </a>
 )}
 </div>
 )}
 </div>

 <div className="flex justify-end pt-2">
 <button
 onClick={() => setSelectedNotificationDetail(null)}
 className="rounded-xl bg-slate-900 dark:bg-slate-100 px-5 py-2 text-sm font-bold text-white dark:text-slate-900 hover:opacity-90 transition"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
 };

 const renderProfile = () => {
 const displayValue = (v) => {
 const s = v == null ? "" : String(v).trim();
 return s ? s : "-";
 };

 return (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div>
 <h2 className="text-[2rem] font-bold">Profile</h2>
 <p className="mt-2 text-[#5d5d5d] dark:text-slate-300">Manage your devotee profile and contact information.</p>
 </div>
 <button
 type="button"
 onClick={() => setProfileEditMode((prev) => !prev)}
 className="rounded-2xl bg-[#bc630f] px-4 py-2 text-sm font-semibold text-white"
 >
 {profileEditMode ? "Cancel" : "Edit Profile"}
 </button>
 </div>
 {profileMessage && <div className="mt-4 rounded-xl bg-[#e8f7ef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-3 text-sm text-[#1c6f3d]">{profileMessage}</div>}
 {profileError && <div className="mt-4 rounded-xl bg-[#fde8e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 p-3 text-sm text-[#a12525]">{profileError}</div>}
 {profileEditMode && (
 <div className="mt-4 grid gap-3 rounded-2xl border border-[#f0f0f0] dark:border-slate-700 bg-[#fbfaf8] dark:bg-slate-800/80 p-4">
 <div>
 <label className="block text-sm font-medium text-[#5d5d5d] dark:text-slate-300 mb-2">Full Name *</label>
 <input className={glassInput} value={profileForm.name} onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Enter full name" />
 </div>
 <div>
 <label className="block text-sm font-medium text-[#5d5d5d] dark:text-slate-300 mb-2">Email Address *</label>
 <input className={glassInput} value={profileForm.email} onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Enter email" />
 </div>
 <div>
 <label className="block text-sm font-medium text-[#5d5d5d] dark:text-slate-300 mb-2">Phone Number *</label>
 <input className={glassInput} value={profileForm.phone} onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="Enter 10-digit phone number" />
 </div>
 <div>
 <label className="block text-sm font-medium text-[#5d5d5d] dark:text-slate-300 mb-2">Place/City *</label>
 <input className={glassInput} value={profileForm.place} onChange={(e) => setProfileForm((prev) => ({ ...prev, place: e.target.value }))} placeholder="Enter place or city" />
 </div>
 <div>
 <label className="block text-sm font-medium text-[#5d5d5d] dark:text-slate-300 mb-2">Address *</label>
 <textarea rows="3" className={glassInput} value={profileForm.address} onChange={(e) => setProfileForm((prev) => ({ ...prev, address: e.target.value }))} placeholder="Enter complete address" />
 </div>
 <button type="button" onClick={handleProfileSave} className={`${glassButton} col-span-full mt-4`}>💾 Save Changes</button>
 </div>
 )}
 <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
 <div className={glassItem}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Full Name</p>
 <p className="mt-2 text-lg font-semibold text-[#1f1f1f] dark:text-slate-100">{profileData.name || devoteeName}</p>
 </div>
 <div className={glassItem}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Email Address</p>
 <p className="mt-2 text-lg font-semibold text-[#1f1f1f] dark:text-slate-100">{profileData.email}</p>
 </div>
 <div className={glassItem}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Phone Number</p>
 <p className="mt-2 text-lg font-semibold text-[#1f1f1f] dark:text-slate-100">{displayValue(profileData.phone)}</p>
 </div>
 <div className={glassItem}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Place/City</p>
 <p className="mt-2 text-lg font-semibold text-[#1f1f1f] dark:text-slate-100">{displayValue(profileData.place)}</p>
 </div>
 <div className={`${glassItem} sm:col-span-2 lg:col-span-1`}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Role</p>
 <p className="mt-2 text-lg font-semibold text-[#1f1f1f] dark:text-slate-100">{profileData.role || "devotee"}</p>
 </div>
 <div className={glassItem}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Member Since</p>
 <p className="mt-2 text-lg font-semibold text-[#1f1f1f] dark:text-slate-100">{profileData.memberSince || "2026"}</p>
 </div>
 <div className={`${glassItem} lg:col-span-2`}>
 <p className="text-sm text-[#7a6f5d] dark:text-slate-400">Address</p>
 <p className="mt-2 text-sm text-[#1f1f1f] dark:text-slate-100 leading-relaxed">{displayValue(profileData.address)}</p>
 </div>
 </div>
 </div>
 </div>
 );
 };

 const renderSupport = () => (
 <div className="space-y-6">
 <div className={`${glassCard}`}>
 <h2 className="text-[2rem] font-bold">Support</h2>
 <p className="mt-2 text-[#5d5d5d] dark:text-slate-300">Raise an issue or get help with your bookings and donations.</p>
 <div className="mt-6 grid gap-4 md:grid-cols-2">
 <label className="block space-y-2 text-sm text-[#5d5d5d] dark:text-slate-300">
 Subject
 <input
 type="text"
 value={supportSubject}
 onChange={(e) => setSupportSubject(e.target.value)}
 placeholder="Enter subject"
 className={glassInput}
 />
 </label>
 <label className="block space-y-2 text-sm text-[#5d5d5d] dark:text-slate-300 md:col-span-2">
 Message
 <textarea
 rows={5}
 value={supportMessage}
 onChange={(e) => setSupportMessage(e.target.value)}
 placeholder="Describe your issue"
 className={glassInput}
 />
 </label>
 </div>
 <button
 type="button"
 onClick={handleSupportSubmit}
 className={`${glassButton} mt-5`}
 >
 Send Request
 </button>
 {supportStatus && <p className="mt-3 text-sm font-semibold text-[#1b7f77]">{supportStatus}</p>}
 </div>

 <div className={glassSection}>
 <h3 className="text-xl font-bold">Your Feedback & Replies</h3>
 <div className="mt-4 space-y-4">
 {supportRequests.length > 0 ? (
 supportRequests.map((request) => (
 <div key={request._id} className={glassItem}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <p className="font-semibold">{request.subject}</p>
 <p className="text-sm text-[#6b7280] dark:text-slate-400">{new Date(request.createdAt).toLocaleString()}</p>
 </div>
 <span className={`rounded-full px-3 py-1 text-sm font-semibold ${request.status === "Closed" ? "bg-[#def5e5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#166534]" : "bg-[#fef3c7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#92400e]"}`}>{request.status || "Open"}</span>
 </div>
 <p className="mt-3 text-sm text-[#374151] dark:text-slate-200">{request.message}</p>
 {request.reply && (
 <div className="mt-4 rounded-[26px] border border-white/35 dark:border-slate-700 bg-temple-100/70 dark:bg-slate-800/80 p-3 text-sm text-[#1f2937] dark:text-slate-200 shadow-sm backdrop-blur-sm">
 <p className="font-semibold">Admin Reply</p>
 <p className="mt-2">{request.reply}</p>
 </div>
 )}
 </div>
 ))
 ) : (
 <p className="text-sm text-[#5d5d5d] dark:text-slate-400">You have not submitted any feedback yet.</p>
 )}
 </div>
 </div>
 </div>
 );

 const renderContent = () => {
 switch (activePage) {
 case "Booking":
 return renderBookPooja();
 case "My Bookings":
 return renderMyBookings();
 case "Donations":
 return renderDonations();
 case "Prasadam Orders":
 return renderPrasadam();
 case "Payment History":
 return renderPaymentHistory();
 case "Receipts":
 return renderReceipts();
 case "Festival Events":
 return renderFestivalEvents();
 case "Notifications":
 return renderNotifications();
 case "Profile":
 return renderProfile();
 case "Support":
 return renderSupport();
 default:
 return renderDashboard();
 }
 };

 return (
 <div className={`min-h-screen w-full transition-colors duration-300 ${
 darkMode 
 ? "dark bg-[#0f172a] text-slate-100" 
 : "bg-gradient-to-br from-[#fff7ed] via-[#fff1d4] to-[#ffe2aa] text-[#2c1d12]"
 }`}>
 {/* Mobile Sidebar Drawer */}
 {mobileOpen && (
 <div className="fixed inset-0 z-50 flex lg:hidden">
 <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
 <aside className={`relative z-10 w-[290px] h-full overflow-hidden shadow-2xl flex flex-col justify-between border-r ${
        darkMode ? "bg-[#0b1120] border-slate-800 text-slate-100" : "border-amber-200/60 text-[#2c1d12]"
      }`}>
        {/* Background image for mobile drawer */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={templeImage}
            alt="Temple background"
            className={`h-full w-full object-cover object-[50%_center] transition-opacity duration-300 ${
              darkMode ? "opacity-25" : "opacity-100"
            }`}
          />
          <div className={`absolute inset-0 transition-colors duration-300 ${darkMode ? "bg-[#0b1120]/80" : "bg-[#fff0dc]/15"}`} />
          <div className={`absolute inset-0 bg-gradient-to-b transition-colors duration-300 ${
            darkMode 
              ? "from-[#0b1120]/85 via-[#0b1120]/70 to-[#0f172a]/90" 
              : "from-[#fff4df]/60 via-[#ffdcb1]/15 to-[#ff9f44]/20"
          }`} />
        </div>

        <div className="relative z-10 flex flex-col h-full justify-between p-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between pb-4 pt-1 border-b border-amber-200/40 dark:border-slate-800">
              <div>
                <p className="text-2xl font-black text-[#bc6c10] dark:text-amber-400">Sri Shanti</p>
                <p className="text-xl font-black text-[#2c1d12] dark:text-slate-100">Mahadev Mandir</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl p-2 text-slate-500 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-slate-800 text-lg font-bold"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {menuItems.map((item) => (
                <SidebarItem
                  key={item.label}
                  label={item.label}
                  icon={item.icon}
                  active={activePage === item.label}
                  onClick={() => {
                    setActivePage(item.label);
                    setMobileOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="pt-3 border-t border-amber-200/40 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                setShowLogout(true);
              }}
              className="group flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left text-[17px] font-bold transition-all duration-300 text-[#2c1d12] dark:text-slate-200 border border-white/60 dark:border-slate-700/60 bg-white/45 dark:bg-slate-900/45 backdrop-blur-md hover:bg-white/70 dark:hover:bg-slate-800/70 hover:shadow-sm"
            >
              <FaSignOutAlt className="h-[20px] w-[20px] text-[#2c1d12] dark:text-slate-200 group-hover:scale-110 transition-transform duration-200" />
              <span className="text-[17px] leading-tight font-bold">Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  )}

  <div className="flex w-full min-h-screen">
    {/* Desktop Sidebar */}
    <aside className={`sticky top-0 h-screen w-[320px] shrink-0 overflow-hidden border-r backdrop-blur-md hidden lg:flex flex-col z-30 transition-colors duration-300 ${
      darkMode 
        ? "bg-[#0b1120] border-slate-800/80 shadow-[0_0_42px_rgba(0,0,0,0.5)]" 
        : "border-amber-200/50 shadow-[0_0_42px_rgba(153,90,31,0.18)]"
    }`}>
      {/* Static pinned background image - strictly fixed dimensions so it never zooms or shifts */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={templeImage}
          alt="Temple background"
          className={`h-full w-full object-cover object-[50%_center] transition-opacity duration-300 ${
            darkMode ? "opacity-25" : "opacity-100"
          }`}
        />
        <div className={`absolute inset-0 transition-colors duration-300 ${
          darkMode ? "bg-[#0b1120]/80" : "bg-[#fff0dc]/10"
        }`} />
        <div className={`absolute inset-0 bg-gradient-to-b transition-colors duration-300 ${
          darkMode 
            ? "from-[#0b1120]/85 via-[#0b1120]/65 to-[#0f172a]/90" 
            : "from-[#fff4df]/35 via-transparent to-[#ff9f44]/15"
        }`} />
      </div>

      {/* Interactive content above background */}
      <div className="relative z-10 flex flex-col h-full overflow-y-auto custom-scrollbar p-5">
        {/* Header */}
        <div className="pb-5 pt-3 select-none">
          <p className="text-[2.35rem] font-black leading-[1.05] text-[#bc6c10] dark:text-amber-400 drop-shadow-xs">
            Sri Shanti
          </p>
          <p className={`text-[1.95rem] font-black leading-[1.05] transition-colors duration-300 ${
            darkMode ? "text-slate-100" : "text-[#2c1d12]"
          }`}>
            Mahadev Mandir
          </p>
        </div>

        {/* Menu Items */}
        <div className="space-y-2 flex-1">
          {menuItems.map((item) => (
            <SidebarItem
              key={item.label}
              label={item.label}
              icon={item.icon}
              active={activePage === item.label}
              onClick={() => setActivePage(item.label)}
            />
          ))}
        </div>

        {/* Logout Button */}
        <div className="pt-3 mt-2">
          <button
            type="button"
            onClick={() => setShowLogout(true)}
            className="group flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left text-[17px] font-bold transition-all duration-300 text-[#2c1d12] dark:text-slate-200 border border-white/60 dark:border-slate-700/60 bg-white/45 dark:bg-slate-900/45 backdrop-blur-md hover:bg-white/70 dark:hover:bg-slate-800/70 hover:shadow-sm"
          >
            <FaSignOutAlt className="h-[20px] w-[20px] text-[#2c1d12] dark:text-slate-200 group-hover:scale-110 transition-transform duration-200" />
            <span className="text-[17px] leading-tight font-bold">Logout</span>
          </button>
        </div>
      </div>
    </aside>

 <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-10 min-w-0">
 {/* Top Navigation Header */}
 <header className={`rounded-2xl border px-5 py-4 transition-all duration-300 backdrop-blur-xl sticky top-4 z-20 shadow-md ${
 darkMode 
 ? "bg-slate-900/85 border-slate-800/90 text-slate-100 shadow-black/20" 
 : "bg-temple-100/70 border-white/60 text-[#2c1d12] shadow-[0_10px_30px_rgba(80,40,10,0.06)]"
 }`}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 {/* Left side: Mobile Menu Hamburger & Search */}
 <div className="flex flex-1 min-w-[240px] max-w-[500px] items-center gap-3">
 <button
 type="button"
 onClick={() => setMobileOpen(true)}
 className={`lg:hidden h-10 w-10 rounded-xl border flex items-center justify-center transition-colors ${
 darkMode 
 ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700" 
 : "border-amber-200 bg-temple-100 text-[#8d551f] hover:bg-amber-100"
 }`}
 aria-label="Open navigation menu"
 >
 <MdMenu size={22} />
 </button>

 <div className={`relative flex-1 flex items-center rounded-xl border transition-colors ${
 darkMode 
 ? "border-slate-700/80 bg-slate-800/80 text-slate-100 focus-within:border-amber-500/60" 
 : "border-[#e8d8c2] bg-temple-100/90 text-[#3d3d3d] focus-within:border-amber-400"
 }`}>
 <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-current opacity-60 stroke-2">
 <circle cx="11" cy="11" r="7"></circle>
 <path d="m20 20-3.5-3.5"></path>
 </svg>
 <input
 type="text"
 placeholder="Search sacred services, poojas, bookings..."
 className="w-full bg-transparent py-2.5 pl-10 pr-3 text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
 />
 </div>
 </div>

 {/* Right side: DateTime, Theme Toggle, Notifications, Profile, Logout */}
 <div className="flex items-center gap-2.5 sm:gap-3.5">
 {/* Date / Time */}
 <div className={`hidden xl:flex items-center rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
 darkMode 
 ? "border-slate-700 bg-slate-800/80 text-amber-300" 
 : "border-[#ead6c0] bg-temple-100/80 text-[#7e4310]"
 }`}>
 {currentDateTime.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} {currentDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
 </div>

 {/* Dark / Light Mode Switcher */}
 <button
 type="button"
 onClick={toggleDarkMode}
 className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-all duration-300 hover:scale-105 ${
 darkMode 
 ? "border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700 hover:text-amber-200" 
 : "border-amber-200/80 bg-temple-100 text-amber-600 hover:bg-white shadow-xs"
 }`}
 aria-label="Toggle dark / light mode"
 title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
 >
 {darkMode ? <MdLightMode size={20} /> : <MdDarkMode size={20} />}
 </button>

 {/* Notifications Bell */}
 <button
 type="button"
 onClick={() => setActivePage("Notifications")}
 className={`relative h-10 w-10 rounded-xl border flex items-center justify-center transition-all duration-300 hover:scale-105 ${
 darkMode 
 ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" 
 : "border-amber-200/80 bg-temple-100 text-[#633a11] hover:bg-white shadow-xs"
 }`}
 aria-label="Open notifications"
 title="Notifications"
 >
 <FaBell size={17} />
 {unreadNotificationsCount > 0 && (
 <span className="absolute -right-1.5 -top-1.5 flex min-w-[19px] h-[19px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white border-2 border-white dark:border-slate-900 shadow-sm animate-pulse">
 {unreadNotificationsCount > 9 ? "9+" : unreadNotificationsCount}
 </span>
 )}
 </button>

 {/* Direct to Profile Card */}
 <div
 onClick={() => setActivePage("Profile")}
 className={`flex items-center gap-2.5 p-1.5 pr-3 rounded-xl border cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
 activePage === "Profile"
 ? darkMode
 ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
 : "border-amber-400 bg-amber-100 text-[#422006]"
 : darkMode
 ? "border-slate-700 bg-slate-800/80 text-slate-100 hover:bg-slate-700 hover:border-slate-600"
 : "border-amber-200/80 bg-temple-100/90 text-[#2c1d12] hover:bg-white shadow-xs"
 }`}
 title="Go to Profile"
 >
 <div className={`flex h-8 w-8 items-center justify-center rounded-lg font-black text-xs shadow-xs ${
 darkMode 
 ? "bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950" 
 : "bg-gradient-to-br from-[#ff9f2f] to-[#ff6a00] text-white"
 }`}>
 {devoteeName
 .split(" ")
 .slice(0, 2)
 .map((part) => part.charAt(0))
 .join("")
 .toUpperCase()}
 </div>
 <div className="hidden sm:block text-left leading-none">
 <p className="text-xs font-bold truncate max-w-[110px]">{devoteeName}</p>
 <p className={`text-[10px] font-semibold mt-0.5 ${darkMode ? "text-amber-400" : "text-amber-700"}`}>Devotee</p>
 </div>
 <MdKeyboardArrowDown size={17} className={`opacity-60 ${darkMode ? "text-slate-300" : "text-[#2c1d12]"}`} />
 </div>

 {/* Logout Option Button */}
 <button
 type="button"
 onClick={() => setShowLogout(true)}
 className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-all duration-300 hover:scale-105 ${
 darkMode 
 ? "border-slate-700 bg-slate-800 text-rose-400 hover:bg-rose-950/50 hover:border-rose-800" 
 : "border-amber-200/80 bg-temple-100 text-rose-500 hover:bg-rose-50 hover:border-rose-200 shadow-xs"
 }`}
 aria-label="Logout"
 title="Logout"
 >
 <FaSignOutAlt size={17} />
 </button>
 </div>
 </div>
 </header>
 
 <div className="mt-6 rounded-3xl border border-white/70 bg-temple-100/40 dark:bg-slate-900/60 dark:border-slate-800/80 p-5 shadow-[0_14px_40px_rgba(80,40,10,0.05)] dark:shadow-none backdrop-blur-lg sm:p-7 lg:p-9">
 {renderContent()}
 </div>
 </main>
 </div>

 
 {/* Receipt Preview Modal */}
 {viewingReceiptData && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-sm print:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 print:p-0 print:block">
 <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 shadow-2xl print:max-w-full print:max-h-full print:shadow-none print:overflow-visible scrollbar-hide">
 
 {/* Modal Actions - Hidden when printing */}
 <div className="sticky top-0 z-10 flex justify-between items-center bg-temple-100/90 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 backdrop-blur-md px-6 py-4 border-b print:hidden">
 <h3 className="text-lg font-bold text-gray-900">Receipt Preview</h3>
 <div className="flex items-center gap-3">
 <button
 onClick={handleDownloadReceiptView}
 className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700 transition-colors shadow-sm"
 >
 <svg className="inline w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
 Download PDF
 </button>
 <button
 onClick={() => window.print()}
 className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-700 transition-colors shadow-sm"
 >
 <svg className="inline w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
 Print
 </button>
 <button
 onClick={() => setViewingReceiptData(null)}
 className="rounded-xl bg-gray-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-200 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 transition-colors"
 >
 Close
 </button>
 </div>
 </div>

 {/* Receipt Component */}
 <div id="receipt-preview-content" className="p-4 sm:p-8 bg-gray-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 flex justify-center print:bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 print:p-0">
 <BookingReceipt {...viewingReceiptData} />
 </div>
 
 </div>
 </div>
 )}

 {/* Logout Confirmation Modal */}
 {showLogout && (
 <LogoutModal
 onClose={() => setShowLogout(false)}
 onLogout={handleLogout}
 />
 )}
 </div>
 );
};

export default DevoteeDashboard;
