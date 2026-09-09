import { useState, useMemo, useEffect } from "react";
import axios from "axios";
import {
 MdMeetingRoom,
 MdCheckCircle,
 MdCancel,
 MdSearch,
 MdAdd,
 MdList,
 MdHistory,
 MdBed,
 MdLocalParking,
 MdLocalActivity,
 MdPrint,
} from "react-icons/md";

const formatCurrency = (val) => `₹ ${Number(val || 0).toLocaleString("en-IN")}`;


const AMENITY_LIST = [
 "Attached Bathroom",
 "AC",
 "TV",
 "WiFi",
 "Geyser",
 "Balcony",
 "Refrigerator",
 "Fan",
 "Hot Water",
 "Telephone",
 "CCTV",
 "Wardrobe",
 "Sofa",
 "Room Service",
];

const RoomAllotment = () => {
 const [activeTab, setActiveTab] = useState("grid"); // grid | add-room | history

 const [rooms, setRooms] = useState([]);

 const [history, setHistory] = useState([]);

 // Filter States
 const [search, setSearch] = useState("");
 const [typeFilter, setTypeFilter] = useState("");
 const [statusFilter, setStatusFilter] = useState("");

 // Assign Room Modal State
 const [showCheckinModal, setShowCheckinModal] = useState(false);
 const [selectedRoom, setSelectedRoom] = useState(null);

 // Devotee Assign Form State
 const [devoteeName, setDevoteeName] = useState("");
 const [phone, setPhone] = useState("");
 const [days, setDays] = useState(1);
 const [payMode, setPayMode] = useState("UPI");

 // Add Room Form State
 const [newRoomNumber, setNewRoomNumber] = useState("");
 const [newRoomType, setNewRoomType] = useState("Standard");
 const [newBlock, setNewBlock] = useState("Block A");
 const [newFloor, setNewFloor] = useState("Ground Floor");
 const [newCapacity, setNewCapacity] = useState(2);
 const [newPrice, setNewPrice] = useState("");
 const [newExtraCharge, setNewExtraCharge] = useState("");
 const [newSecurityDeposit, setNewSecurityDeposit] = useState("");
 const [newRoomSize, setNewRoomSize] = useState("");
 const [newBedType, setNewBedType] = useState("Double");
 const [newTotalBeds, setNewTotalBeds] = useState(1);
 const [newTotalExtraBeds, setNewTotalExtraBeds] = useState(0);
 const [newDescription, setNewDescription] = useState("");
 const [newAmenities, setNewAmenities] = useState([]);
 const [newCheckinTime, setNewCheckinTime] = useState("12:00 PM");
 const [newCheckoutTime, setNewCheckoutTime] = useState("11:00 AM");
 const [newMealsIncluded, setNewMealsIncluded] = useState("No Meals");
 const [newCancellationPolicy, setNewCancellationPolicy] = useState("");
 const [newIsActive, setNewIsActive] = useState(true);

 // Feedback Notifications
 const [successMsg, setSuccessMsg] = useState("");
 const [errorMsg, setErrorMsg] = useState("");

 const fetchRooms = async () => {
 try {
 const response = await axios.get("/api/rooms");
 setRooms(response.data);
 localStorage.setItem("templeRooms_v2", JSON.stringify(response.data));
 } catch (err) {
 console.error("Failed to fetch rooms:", err);
 }
 };

 const fetchHistory = async () => {
 try {
 const response = await axios.get("/api/bookings/all?limit=1000");
 const dbBookings = response.data.bookings || [];
 const roomBookings = dbBookings
 .filter((b) => b.service && b.service.startsWith("Room Allotment:"))
 .map((b) => {
 let roomNum = "";
 let roomType = "";
 const match = b.service.match(/Room Allotment:\s*Room\s*(\S+)\s*\(([^)]+)\)/i);
 if (match) {
 roomNum = match[1];
 roomType = match[2];
 }

 // Use stored date fields if available, otherwise fall back to datetime/notes
 const checkin = b.checkinDate
 ? new Date(b.checkinDate).toISOString().split("T")[0]
 : b.datetime
 ? b.datetime.split("T")[0]
 : "";
 const checkout = b.checkoutDate
 ? new Date(b.checkoutDate).toISOString().split("T")[0]
 : new Date(new Date(checkin).getTime() + (b.days || 1) * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

 // Auto-determine status: if checkout is in the past → Completed, else Active
 const now = new Date();
 const isCheckedOut = b.status === "Completed" || new Date(b.checkoutDate || checkout) <= now;

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
 status: isCheckedOut ? "Completed" : "Active",
 };
 });

 setHistory(roomBookings);
 } catch (err) {
 console.error("Failed to fetch room booking history:", err);
 }
 };

 useEffect(() => {
 fetchRooms();
 fetchHistory();
 const interval = setInterval(() => {
 fetchRooms();
 fetchHistory();
 }, 5000);
 return () => clearInterval(interval);
 }, []);

 const saveRooms = (updatedRooms) => {
 setRooms(updatedRooms);
 localStorage.setItem("templeRooms_v2", JSON.stringify(updatedRooms));
 };

 const saveHistory = (updatedHistory) => {
 setHistory(updatedHistory);
 localStorage.setItem("templeRoomHistory", JSON.stringify(updatedHistory));
 };

 // Add New Room Handler
 const handleAddRoomSubmit = async (e) => {
 e.preventDefault();
 if (!newRoomNumber.trim() || !newPrice) {
 setErrorMsg("Please fill in Room Number and Price.");
 return;
 }

 if (rooms.some((r) => r.number === newRoomNumber.trim())) {
 setErrorMsg("Room Number already exists.");
 return;
 }

 const newRoom = {
 number: newRoomNumber.trim(),
 type: newRoomType,
 block: newBlock,
 floor: newFloor,
 capacity: Number(newCapacity),
 price: Number(newPrice),
 extraCharge: Number(newExtraCharge || 0),
 securityDeposit: Number(newSecurityDeposit || 0),
 roomSize: Number(newRoomSize || 0),
 bedType: newBedType,
 totalBeds: Number(newTotalBeds),
 totalExtraBeds: Number(newTotalExtraBeds),
 description: newDescription,
 amenities: newAmenities,
 checkinTime: newCheckinTime,
 checkoutTime: newCheckoutTime,
 mealsIncluded: newMealsIncluded,
 cancellationPolicy: newCancellationPolicy,
 status: "Available",
 isActive: newIsActive,
 };

 try {
 const response = await axios.post("/api/rooms", newRoom);
 setRooms([...rooms, response.data]);
 setSuccessMsg(`Room ${newRoom.number} added successfully!`);
 setActiveTab("grid");

 // Reset Form Fields
 setNewRoomNumber("");
 setNewPrice("");
 setNewExtraCharge("");
 setNewSecurityDeposit("");
 setNewRoomSize("");
 setNewDescription("");
 setNewAmenities([]);
 setErrorMsg("");
 setTimeout(() => setSuccessMsg(""), 4000);
 } catch (err) {
 setErrorMsg(err.response?.data?.error || "Failed to add room.");
 }
 };

 // Allot Room Handler
 const handleCheckinSubmit = async (e) => {
 e.preventDefault();
 if (!devoteeName.trim() || !phone.trim() || days <= 0) {
 setErrorMsg("Please complete devotee details.");
 return;
 }

 const checkinDateVal = new Date().toISOString();
 const checkoutDateVal = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();

 try {
 const allotPayload = {
 roomNumber: selectedRoom.number,
 devoteeName: devoteeName.trim(),
 phone: phone.trim(),
 days: Number(days),
 payMode,
 checkinDate: checkinDateVal,
 checkoutDate: checkoutDateVal
 };

 await axios.post("/api/rooms/allot", allotPayload);
 await fetchRooms();
 await fetchHistory();

 setSuccessMsg(`Room ${selectedRoom.number} successfully allotted to ${devoteeName.trim()}!`);
 setShowCheckinModal(false);
 setErrorMsg("");
 setTimeout(() => setSuccessMsg(""), 4000);
 } catch (err) {
 setErrorMsg(err.response?.data?.error || "Failed to allot room.");
 }
 };

 // Checkout Handler
 const handleCheckout = async (roomNumber) => {
 const room = rooms.find((r) => r.number === roomNumber);
 if (!room) return;

 const confirmed = window.confirm(`Check out guest ${room.devotee} from Room ${roomNumber}?`);
 if (!confirmed) return;

 try {
 await axios.post(`/api/rooms/checkout/${roomNumber}`);
 await fetchRooms();
 await fetchHistory();

 setSuccessMsg(`Room ${roomNumber} checked out and marked Available.`);
 setTimeout(() => setSuccessMsg(""), 4000);
 } catch (err) {
 console.error("Failed to checkout room:", err);
 }
 };

 const toggleAmenity = (amenity) => {
 if (newAmenities.includes(amenity)) {
 setNewAmenities(newAmenities.filter((a) => a !== amenity));
 } else {
 setNewAmenities([...newAmenities, amenity]);
 }
 };

 // Toggle Maintenance Status
 const toggleMaintenance = async (roomNumber, currentStatus) => {
 try {
 await axios.patch(`/api/rooms/maintenance/${roomNumber}`);
 await fetchRooms();
 } catch (err) {
 console.error("Failed to toggle maintenance status:", err);
 }
 };

 // Delete Room
 const handleDeleteRoom = async (roomNumber) => {
 const confirmed = window.confirm(`Are you sure you want to delete Room ${roomNumber}?`);
 if (!confirmed) return;

 try {
 await axios.delete(`/api/rooms/${roomNumber}`);
 await fetchRooms();
 setSuccessMsg(`Room ${roomNumber} deleted successfully.`);
 setTimeout(() => setSuccessMsg(""), 4000);
 } catch (err) {
 console.error("Failed to delete room:", err);
 }
 };

 // Metrics Calculations
 const metrics = useMemo(() => {
 const total = rooms.length;
 const occupied = rooms.filter((r) => r.status === "Occupied").length;
 const available = rooms.filter((r) => r.status === "Available").length;
 const maint = rooms.filter((r) => r.status === "Maintenance").length;
 // Total income is active rent plus history total rent
 const activeRent = rooms
 .filter((r) => r.status === "Occupied")
 .reduce((sum, r) => sum + Number(r.price || 0) * Number(r.days || 1), 0);
 const historyRent = history.reduce((sum, h) => sum + Number(h.amount || 0), 0);
 const totalRent = activeRent + historyRent;

 return { total, occupied, available, maint, totalRent };
 }, [rooms, history]);

 // Filters logic
 const filteredRooms = useMemo(() => {
 const q = search.trim().toLowerCase();
 return rooms.filter((r) => {
 const matchesSearch =
 !q ||
 r.number.includes(q) ||
 r.type.toLowerCase().includes(q) ||
 (r.devotee && r.devotee.toLowerCase().includes(q));
 const matchesType = !typeFilter || r.type === typeFilter;
 const matchesStatus = !statusFilter || r.status === statusFilter;
 return matchesSearch && matchesType && matchesStatus;
 });
 }, [rooms, search, typeFilter, statusFilter]);

 return (
 <div className="mt-5 space-y-6">
 {/* HEADER & METRICS */}
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-8 shadow-sm">
 <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
 <div>
 <h1 className="text-[42px] font-bold text-[#111827] dark:text-slate-200 ">Dharamshala Room Allotment</h1>
 <p className="mt-2 text-[#525252]">Allot guest rooms, manage tariffs, and track booking histories.</p>
 </div>
 {/* TABS */}
 <div className="flex gap-2">
 <button
 onClick={() => setActiveTab("grid")}
 className={`rounded-3xl px-5 py-3 text-sm font-semibold transition ${ activeTab === "grid" ? "bg-[#0f766e] text-white" : "bg-[#f1f5f9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#475569] dark:text-slate-200 hover:bg-[#e2e8f0] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 <span className="flex items-center gap-1.5"><MdMeetingRoom size={18} /> Room Grid</span>
 </button>
 <button
 onClick={() => setActiveTab("add-room")}
 className={`rounded-3xl px-5 py-3 text-sm font-semibold transition ${ activeTab === "add-room" ? "bg-[#0f766e] text-white" : "bg-[#f1f5f9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#475569] dark:text-slate-200 hover:bg-[#e2e8f0] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 <span className="flex items-center gap-1.5"><MdAdd size={18} /> Add New Room</span>
 </button>
 <button
 onClick={() => setActiveTab("history")}
 className={`rounded-3xl px-5 py-3 text-sm font-semibold transition ${ activeTab === "history" ? "bg-[#0f766e] text-white" : "bg-[#f1f5f9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#475569] dark:text-slate-200 hover:bg-[#e2e8f0] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 >
 <span className="flex items-center gap-1.5"><MdHistory size={18} /> Allotment History</span>
 </button>
 </div>
 </div>

 {/* METRICS ROW */}
 <div className="mt-6 grid gap-4 sm:grid-cols-5">
 <div className="rounded-3xl border border-[#e5e7eb] dark:border-slate-700 bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm uppercase tracking-[0.24em] text-[#475569] dark:text-slate-200 ">Total Rooms</p>
 <p className="mt-4 text-[2rem] font-bold text-[#0f172a] dark:text-slate-200 ">{metrics.total}</p>
 </div>
 <div className="rounded-3xl border border-[#fecaca] dark:border-slate-700 bg-[#fef2f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm uppercase tracking-[0.24em] text-[#b91c1c] dark:text-slate-200 ">Occupied</p>
 <p className="mt-4 text-[2rem] font-bold text-[#b91c1c] dark:text-slate-200 ">{metrics.occupied}</p>
 </div>
 <div className="rounded-3xl border border-[#d1fae5] dark:border-slate-700 bg-[#ecfdf5] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm uppercase tracking-[0.24em] text-[#166534] dark:text-slate-200 ">Available</p>
 <p className="mt-4 text-[2rem] font-bold text-[#166534] dark:text-slate-200 ">{metrics.available}</p>
 </div>
 <div className="rounded-3xl border border-[#fef3c7] dark:border-slate-700 bg-[#fffbeb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm uppercase tracking-[0.24em] text-[#92400e]">Maintenance</p>
 <p className="mt-4 text-[2rem] font-bold text-[#92400e]">{metrics.maint}</p>
 </div>
 <div className="rounded-3xl border border-[#e0e7ff] dark:border-slate-700 bg-[#eef2ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <p className="text-sm uppercase tracking-[0.24em] text-[#3730a3] dark:text-slate-200 ">Total Room Rent</p>
 <p className="mt-4 text-[2rem] font-bold text-[#3730a3] dark:text-slate-200 ">{formatCurrency(metrics.totalRent)}</p>
 </div>
 </div>
 </div>

 {successMsg && (
 <div className="rounded-2xl border border-green-200 bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm font-semibold text-green-700">
 {successMsg}
 </div>
 )}

 {errorMsg && (
 <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 text-sm font-semibold text-red-700">
 {errorMsg}
 </div>
 )}

 {/* TAB 1: ROOM GRID */}
 {activeTab === "grid" && (
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
 <h2 className="text-2xl font-bold text-[#111827] dark:text-slate-200 ">Active Room Grid Map</h2>
 <div className="flex flex-wrap gap-3">
 <div className="relative">
 <input
 type="text"
 placeholder="Search Room or Guest..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="rounded-full border border-[#cbd5e1] pl-9 pr-4 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
 </div>
 <select
 value={typeFilter}
 onChange={(e) => setTypeFilter(e.target.value)}
 className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm outline-none focus:border-[#2563eb]"
 >
 <option value="">All Room Types</option>
 <option value="Standard">Standard</option>
 <option value="Deluxe">Deluxe</option>
 <option value="VIP Suite">VIP Suite</option>
 </select>
 <select
 value={statusFilter}
 onChange={(e) => setStatusFilter(e.target.value)}
 className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm outline-none focus:border-[#2563eb]"
 >
 <option value="">All Statuses</option>
 <option value="Available">Available</option>
 <option value="Occupied">Occupied</option>
 <option value="Maintenance">Maintenance</option>
 </select>
 </div>
 </div>

 <div className="mt-8 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
 {filteredRooms.map((room) => {
 const borderTheme =
 room.status === "Occupied"
 ? "border-red-200 bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-red-950"
 : room.status === "Maintenance"
 ? "border-amber-200 bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-amber-950"
 : "border-green-200 bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-950";

 return (
 <div
 key={room.number}
 className={`relative rounded-2xl border p-5 shadow-sm transition duration-300 ${borderTheme}`}
 >
 <div className="flex items-center justify-between">
 <span className="text-xs uppercase tracking-wider font-semibold opacity-70">
 {room.type} ({room.block})
 </span>
 <span
 className={`h-2.5 w-2.5 rounded-full ${ room.status === "Occupied" ? "bg-red-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " : room.status === "Maintenance" ? "bg-amber-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " : "bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " }`}
 />
 </div>
 <p className="mt-3 text-3xl font-extrabold">{room.number}</p>
 <p className="mt-1 text-sm font-semibold opacity-80">{formatCurrency(room.price)} / day</p>
 <p className="text-xs opacity-75 mt-0.5">{room.floor}</p>

 <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
 {room.status === "Occupied" && (
 <div className="space-y-1">
 <p className="text-sm font-bold truncate">{room.devotee}</p>
 <p className="text-xs opacity-75">{room.phone}</p>
 <p className="text-xs font-semibold opacity-85">Check-in: {room.checkinDate}</p>
 <div className="flex gap-2 mt-3">
 <button
 onClick={() => handleCheckout(room.number)}
 className="w-full rounded-lg bg-red-600 py-1.5 text-xs font-bold text-white transition hover:bg-red-700"
 >
 Check Out
 </button>
 </div>
 </div>
 )}

 {room.status === "Available" && (
 <div className="flex flex-col gap-2">
 <button
 onClick={() => handleOpenCheckin(room)}
 className="w-full rounded-lg bg-green-700 py-1.5 text-xs font-bold text-white transition hover:bg-green-800"
 >
 Allot Room
 </button>
 <div className="flex gap-1">
 <button
 onClick={() => toggleMaintenance(room.number, room.status)}
 className="w-1/2 rounded-lg border border-amber-300 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
 >
 Maint.
 </button>
 <button
 onClick={() => handleDeleteRoom(room.number)}
 className="w-1/2 rounded-lg border border-red-300 py-1 text-[11px] font-semibold text-red-800 transition hover:bg-red-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
 >
 Delete
 </button>
 </div>
 </div>
 )}

 {room.status === "Maintenance" && (
 <div className="space-y-2">
 <p className="text-xs opacity-75">Out of Order / Cleaning</p>
 <button
 onClick={() => toggleMaintenance(room.number, room.status)}
 className="w-full rounded-lg bg-amber-600 py-1.5 text-xs font-bold text-white transition hover:bg-amber-700"
 >
 Mark Available
 </button>
 </div>
 )}
 </div>
 </div>
 );
 })}
 </div>
 </div>
 )}

 {/* TAB 2: ADD NEW ROOM (Matches user screenshot) */}
 {activeTab === "add-room" && (
 <form onSubmit={handleAddRoomSubmit} className="space-y-6">
 <div className="grid gap-6 lg:grid-cols-3">
 {/* LEFT COLUMN: ROOM DETAILS */}
 <div className="lg:col-span-2 space-y-6">
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-8 shadow-sm">
 <h3 className="text-lg font-bold text-[#111827] dark:text-slate-200 flex items-center gap-2 mb-6">
 <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#f1f5f9] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#475569] dark:text-slate-200 "><MdMeetingRoom /></span>
 Room Details
 </h3>

 <div className="grid gap-4 sm:grid-cols-2">
 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-sm">Room Number *</span>
 <input
 type="text"
 required
 value={newRoomNumber}
 onChange={(e) => setNewRoomNumber(e.target.value)}
 placeholder="Enter Room Number (e.g. 101)"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-sm">Room Type *</span>
 <select
 value={newRoomType}
 onChange={(e) => setNewRoomType(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] outline-none focus:border-[#2563eb]"
 >
 <option value="Standard">Standard</option>
 <option value="Deluxe">Deluxe</option>
 <option value="VIP Suite">VIP Suite</option>
 <option value="Executive">Executive</option>
 </select>
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-sm">Block / Building *</span>
 <select
 value={newBlock}
 onChange={(e) => setNewBlock(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] outline-none focus:border-[#2563eb]"
 >
 <option value="Block A">Block A</option>
 <option value="Block B">Block B</option>
 <option value="Main Block">Main Block</option>
 <option value="Dharamshala Wing">Dharamshala Wing</option>
 </select>
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-sm">Floor *</span>
 <select
 value={newFloor}
 onChange={(e) => setNewFloor(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] outline-none focus:border-[#2563eb]"
 >
 <option value="Ground Floor">Ground Floor</option>
 <option value="First Floor">First Floor</option>
 <option value="Second Floor">Second Floor</option>
 <option value="Third Floor">Third Floor</option>
 </select>
 </label>

 <div className="grid gap-2 grid-cols-3 sm:col-span-2">
 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Capacity (Persons) *</span>
 <input
 type="number"
 min="1"
 required
 value={newCapacity}
 onChange={(e) => setNewCapacity(e.target.value)}
 placeholder="Enter Capacity"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Price (₹) *</span>
 <input
 type="number"
 required
 value={newPrice}
 onChange={(e) => setNewPrice(e.target.value)}
 placeholder="Enter Price"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Extra Person Charge (₹)</span>
 <input
 type="number"
 value={newExtraCharge}
 onChange={(e) => setNewExtraCharge(e.target.value)}
 placeholder="Extra charge"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>
 </div>

 <div className="grid gap-2 grid-cols-3 sm:col-span-2">
 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Security Deposit (₹)</span>
 <input
 type="number"
 value={newSecurityDeposit}
 onChange={(e) => setNewSecurityDeposit(e.target.value)}
 placeholder="Security Deposit"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Room Size (Sq.ft)</span>
 <input
 type="number"
 value={newRoomSize}
 onChange={(e) => setNewRoomSize(e.target.value)}
 placeholder="e.g. 240"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Bed Type</span>
 <select
 value={newBedType}
 onChange={(e) => setNewBedType(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] outline-none focus:border-[#2563eb]"
 >
 <option value="Single">Single</option>
 <option value="Double">Double</option>
 <option value="Queen">Queen</option>
 <option value="King">King</option>
 </select>
 </label>
 </div>

 <div className="grid gap-2 grid-cols-3 sm:col-span-2">
 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Total Beds</span>
 <input
 type="number"
 min="1"
 value={newTotalBeds}
 onChange={(e) => setNewTotalBeds(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Total Extra Beds</span>
 <input
 type="number"
 min="0"
 value={newTotalExtraBeds}
 onChange={(e) => setNewTotalExtraBeds(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>

 <div>
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Room Status *</span>
 <div className="rounded-lg bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-green-700 px-3 py-2 text-sm font-semibold border border-green-200 text-center">
 Available
 </div>
 </div>
 </div>

 <label className="block sm:col-span-2">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-sm">Description</span>
 <textarea
 value={newDescription}
 onChange={(e) => setNewDescription(e.target.value)}
 placeholder="Enter Room Description..."
 rows="3"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
 />
 </label>
 </div>
 </div>

 {/* ADDITIONAL INFORMATION */}
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-8 shadow-sm">
 <h3 className="text-lg font-bold text-[#111827] dark:text-slate-200 flex items-center gap-2 mb-6">
 Additional Information
 </h3>

 <div className="grid gap-4 sm:grid-cols-3">
 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Check-in Time</span>
 <input
 type="text"
 value={newCheckinTime}
 onChange={(e) => setNewCheckinTime(e.target.value)}
 placeholder="12:00 PM"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Check-out Time</span>
 <input
 type="text"
 value={newCheckoutTime}
 onChange={(e) => setNewCheckoutTime(e.target.value)}
 placeholder="11:00 AM"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Meals Included</span>
 <select
 value={newMealsIncluded}
 onChange={(e) => setNewMealsIncluded(e.target.value)}
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] outline-none"
 >
 <option>No Meals</option>
 <option>Breakfast Included</option>
 <option>Lunch & Dinner</option>
 <option>All Meals Included</option>
 </select>
 </label>

 <label className="block sm:col-span-2">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Cancellation Policy</span>
 <textarea
 value={newCancellationPolicy}
 onChange={(e) => setNewCancellationPolicy(e.target.value)}
 placeholder="Enter cancellation policy..."
 rows="2"
 className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm outline-none"
 />
 </label>

 <div>
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 text-xs">Is Active</span>
 <button
 type="button"
 onClick={() => setNewIsActive(!newIsActive)}
 className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${ newIsActive ? "bg-green-600" : "bg-slate-300" }`}
 >
 <span
 className={`pointer-events-none inline-block h-5 h-5 w-5 transform rounded-full bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] shadow ring-0 transition duration-200 ease-in-out ${ newIsActive ? "translate-x-5" : "translate-x-0" }`}
 />
 </button>
 </div>
 </div>
 </div>

 {/* ACTION BUTTONS */}
 <div className="flex gap-3">
 <button
 type="submit"
 className="rounded-lg bg-green-700 px-6 py-3 font-semibold text-white transition hover:bg-green-800"
 >
 Save Room
 </button>
 <button
 type="button"
 onClick={() => setActiveTab("grid")}
 className="rounded-lg border border-slate-300 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-6 py-3 font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 Cancel
 </button>
 </div>
 </div>

 {/* RIGHT COLUMN: AMENITIES & SUMMARY */}
 <div className="space-y-6">
 {/* ROOM AMENITIES */}
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h3 className="text-lg font-bold text-[#111827] dark:text-slate-200 mb-4">Room Amenities</h3>
 <div className="grid grid-cols-2 gap-3">
 {AMENITY_LIST.map((amenity) => (
 <label key={amenity} className="flex items-center gap-2 text-sm cursor-pointer select-none">
 <input
 type="checkbox"
 checked={newAmenities.includes(amenity)}
 onChange={() => toggleAmenity(amenity)}
 className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4"
 />
 <span>{amenity}</span>
 </label>
 ))}
 </div>
 </div>

 {/* ROOM SUMMARY CARD */}
 <div className="rounded-2xl border border-[#fef3c7] dark:border-slate-700 bg-[#fffbeb] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <h3 className="text-lg font-bold text-[#92400e] mb-4">Room Summary</h3>
 <div className="space-y-3 text-sm text-[#78350f]">
 <div className="flex justify-between">
 <span>Room Number:</span>
 <span className="font-bold">{newRoomNumber || "-"}</span>
 </div>
 <div className="flex justify-between">
 <span>Room Type:</span>
 <span className="font-bold">{newRoomType}</span>
 </div>
 <div className="flex justify-between">
 <span>Capacity:</span>
 <span className="font-bold">{newCapacity} Persons</span>
 </div>
 <div className="flex justify-between">
 <span>Price:</span>
 <span className="font-bold">{formatCurrency(newPrice)}</span>
 </div>
 <div className="flex justify-between">
 <span>Status:</span>
 <span className="font-bold text-green-700">Available</span>
 </div>
 </div>
 </div>
 </div>
 </div>
 </form>
 )}

 {/* TAB 3: ALLOTMENT HISTORY & BILLS */}
 {activeTab === "history" && (
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-sm">
 <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
 <div>
 <h2 className="text-2xl font-bold text-[#111827] dark:text-slate-200 ">Room Booking & Tariff History</h2>
 <p className="mt-1 text-sm text-slate-500 dark:text-slate-200 ">Historical records of guest allotments, bills, and payments.</p>
 </div>
 <div className="rounded-full bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 ">
 Total Booking Collections: {formatCurrency(history.reduce((sum, h) => sum + h.amount, 0))}
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-left text-sm text-[#334155] dark:text-slate-200 ">
 <thead className="border-b border-[#e2e8f0] dark:border-slate-700 text-[#475569] dark:text-slate-200 ">
 <tr>
 <th className="px-4 py-3">Booking ID</th>
 <th className="px-4 py-3">Devotee Name</th>
 <th className="px-4 py-3">Contact</th>
 <th className="px-4 py-3">Room No</th>
 <th className="px-4 py-3">Type</th>
 <th className="px-4 py-3">Stay Details</th>
 <th className="px-4 py-3">Total Amount</th>
 <th className="px-4 py-3">Status</th>
 <th className="px-4 py-3">Actions</th>
 </tr>
 </thead>
 <tbody>
 {history.length === 0 ? (
 <tr>
 <td colSpan="9" className="px-4 py-8 text-center text-slate-400">
 No room allotment records found.
 </td>
 </tr>
 ) : (
 history.map((record) => (
 <tr key={record.id} className="border-b border-[#f1f5f9] dark:border-slate-700 hover:bg-[#f8fafc] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <td className="px-4 py-4 font-mono font-bold text-blue-600">{record.id}</td>
 <td className="px-4 py-4 font-semibold text-slate-800 dark:text-slate-200 ">{record.devoteeName}</td>
 <td className="px-4 py-4 text-xs">
 <div>{record.phone}</div>
 <div className="text-slate-400">Mode: {record.payMode}</div>
 </td>
 <td className="px-4 py-4 font-bold text-slate-900 dark:text-slate-200 ">{record.roomNumber}</td>
 <td className="px-4 py-4">{record.roomType}</td>
 <td className="px-4 py-4 text-xs">
 <div>Checkin: {record.checkinDate}</div>
 <div>Checkout: {record.checkoutDate}</div>
 <div className="font-semibold text-slate-500 dark:text-slate-200 ">{record.days} day(s)</div>
 </td>
 <td className="px-4 py-4 font-bold text-slate-950 dark:text-slate-200 ">{formatCurrency(record.amount)}</td>
 <td className="px-4 py-4">
 <span
 className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${ record.status === "Active" ? "bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-blue-800" : "bg-green-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-green-800" }`}
 >
 {record.status}
 </span>
 </td>
 <td className="px-4 py-4">
 <button
 onClick={() => {
 window.alert(`Downloading Receipt ${record.id}...\nDevotee: ${record.devoteeName}\nTotal amount: ${formatCurrency(record.amount)}`);
 }}
 className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2.5 py-1 transition hover:bg-blue-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <MdPrint size={14} /> Receipt
 </button>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {/* CHECK-IN ALLOTMENT DIALOG */}
 {showCheckinModal && selectedRoom && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
 <div className="w-full max-w-md rounded-2xl bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl">
 <div className="flex items-center justify-between border-b pb-3">
 <h3 className="text-xl font-bold text-slate-950 dark:text-slate-200 ">Room Check-In Allotment</h3>
 <button onClick={() => setShowCheckinModal(false)} className="text-slate-400 hover:text-slate-600 dark:text-slate-200 ">
 <MdCancel size={24} />
 </button>
 </div>

 <form onSubmit={handleCheckinSubmit} className="mt-4 space-y-4 text-sm">
 <div className="rounded-xl bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 border border-slate-200 dark:border-slate-700 ">
 <div className="flex justify-between font-bold text-slate-900 dark:text-slate-200 mb-1">
 <span>Room {selectedRoom.number}</span>
 <span>{selectedRoom.type}</span>
 </div>
 <div className="text-xs text-slate-500 dark:text-slate-200 flex justify-between">
 <span>Block: {selectedRoom.block}</span>
 <span>{formatCurrency(selectedRoom.price)} / day</span>
 </div>
 </div>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 ">Devotee Name *</span>
 <input
 type="text"
 required
 value={devoteeName}
 onChange={(e) => setDevoteeName(e.target.value)}
 placeholder="Enter Devotee Name"
 className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 outline-none focus:border-blue-600"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 ">Phone Number *</span>
 <input
 type="text"
 required
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 placeholder="e.g. 98765 43210"
 className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 outline-none focus:border-blue-600"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 ">Number of Days *</span>
 <input
 type="number"
 min="1"
 required
 value={days}
 onChange={(e) => setDays(e.target.value)}
 className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 outline-none focus:border-blue-600"
 />
 </label>

 <label className="block">
 <span className="mb-1 block font-semibold text-slate-700 dark:text-slate-200 ">Payment Method</span>
 <select
 value={payMode}
 onChange={(e) => setPayMode(e.target.value)}
 className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 outline-none focus:border-blue-600 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] "
 >
 <option>UPI</option>
 <option>Cash</option>
 <option>Card</option>
 <option>Net Banking</option>
 </select>
 </label>

 <div className="rounded-lg bg-emerald-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4 border border-emerald-200 text-emerald-950 font-bold flex justify-between">
 <span>Total Charge:</span>
 <span>{formatCurrency(selectedRoom.price * days)}</span>
 </div>

 <button
 type="submit"
 className="w-full rounded-lg bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800"
 >
 Confirm Room Allotment
 </button>
 </form>
 </div>
 </div>
 )}
 </div>
 );
};

export default RoomAllotment;
