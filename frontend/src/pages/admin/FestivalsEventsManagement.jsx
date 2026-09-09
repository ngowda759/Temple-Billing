import { useState, useEffect } from "react";
import axios from "axios";
import {
 MdCalendarMonth,
 MdOutlineFilterAlt,
 MdOutlineSearch,
 MdOutlineEvent,
 MdOutlineCurrencyRupee,
 MdOutlineRemoveRedEye,
 MdOutlineEdit,
 MdOutlineKeyboardArrowDown,
 MdLocationOn,
 MdAccessTime,
 MdPeople,
 MdCampaign,
 MdQrCode2,
 MdAssessment,
 MdGroups,
 MdClose,
} from "react-icons/md";
import { FaRegCalendarAlt } from "react-icons/fa";

// stats are fetched live from backend overview endpoint

// festivalRows will be loaded dynamically from backend

// recent registrations and monthly revenue charts removed per request

const quickActions = [
 { title: "Add Event", icon: MdCalendarMonth, tone: "bg-[#fff7ea] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#e58a0a]" },
 { title: "Send Notification", icon: MdCampaign, tone: "bg-[#f2f0ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#6f61d3]" },
 { title: "Send Invitation", icon: MdOutlineEvent, tone: "bg-[#e8f6e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#2e8e2e]" },
];

const statusClass = {
 Active: "bg-[#e8f6e8] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#2e8e2e]",
 Upcoming: "bg-[#e8f0ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#3573cb]",
 Completed: "bg-[#efefef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#555]",
};

const FestivalsEventsManagement = () => {

 const [festivalRows, setFestivalRows] = useState([]);
 const [showModal, setShowModal] = useState(false);
 const [isEditing, setIsEditing] = useState(false);
 const [editingId, setEditingId] = useState(null);
 const [viewEvent, setViewEvent] = useState(null);

 const [overview, setOverview] = useState({ upcomingFestivals: 0, todaysEvents: 0, currentMonthFestivals: 0, monthlyRevenue: 0, festivalRevenue: 0 });

 const [title, setTitle] = useState("");
 const [date, setDate] = useState("");
 const [location, setLocation] = useState("");
 const [description, setDescription] = useState("");
 const [imageUrl, setImageUrl] = useState("");
 const [imagePreview, setImagePreview] = useState(null);
 const [isLoading, setIsLoading] = useState(false);
 const [showInvitationModal, setShowInvitationModal] = useState(false);
 const [invitationTitle, setInvitationTitle] = useState("");
 const [invitationMessage, setInvitationMessage] = useState("");
 const [invitationFile, setInvitationFile] = useState("");
 const [invitationFileName, setInvitationFileName] = useState("");

 useEffect(() => {
 fetchEvents();
 fetchOverview();
 }, []);

 const fetchOverview = async () => {
 try {
 const res = await axios.get("http://localhost:5000/api/devotee/events/overview");
 setOverview(res.data || {});
 } catch (error) {
 console.error("Failed to fetch overview:", error);
 }
 };

 const fetchEvents = async () => {
 try {
 const res = await axios.get("http://localhost:5000/api/devotee/events");
 setFestivalRows(res.data.events || res.data || []);
 } catch (error) {
 console.log(error);
 }
 };

 const handleAddFestival = async () => {
 if (!title.trim() || !date || !location.trim()) {
 alert("Please fill in all required fields");
 return;
 }

 const selectedDate = new Date(date);
 if (Number.isNaN(selectedDate.getTime())) {
 alert("Please enter a valid event date.");
 return;
 }

 const todayStart = new Date();
 todayStart.setHours(0, 0, 0, 0);
 selectedDate.setHours(0, 0, 0, 0);

 if (selectedDate < todayStart) {
 alert("Event date must be today or a future date.");
 return;
 }

 setIsLoading(true);
 try {
 const payload = { title, date, location, description, imageUrl: imageUrl || undefined };
 if (isEditing && editingId) {
 await axios.patch(`http://localhost:5000/api/devotee/events/${editingId}`, payload);
 alert("Event updated successfully.");
 } else {
 await axios.post("http://localhost:5000/api/devotee/events", payload);
 alert("Event Added Successfully!");
 }

 await fetchEvents();
 await fetchOverview();

 setTitle("");
 setDate("");
 setLocation("");
 setDescription("");
 setImageUrl("");
 setImagePreview(null);
 setShowModal(false);
 setIsEditing(false);
 setEditingId(null);
 } catch (error) {
 console.log(error);
 alert("Error saving event: " + (error.response?.data?.error || error.message));
 } finally {
 setIsLoading(false);
 }
 };

  const handleImageChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1280;
        const maxHeight = 1280;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL("image/jpeg", 0.85);
        setImagePreview(compressed);
        setImageUrl(compressed);
      };
      img.onerror = () => {
        setImagePreview(reader.result);
        setImageUrl(reader.result);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

 const handleQuickAction = async (action) => {
 if (action === "Add Event") return setShowModal(true);

 if (action === "Send Invitation") {
 setShowInvitationModal(true);
 return;
 }

 if (action === "Send Notification") {
 const message = window.prompt("Enter notification message:");
 if (!message) return;
 try {
 await axios.post("http://localhost:5000/api/devotee/notifications", { title: "Festival Update", message, audienceRole: "devotee", broadcast: true });
 alert("Notification sent to all devotees.");
 } catch (err) {
 console.error(err);
 alert("Failed to send notification.");
 }
 return;
 }

 alert(`${action} - feature coming soon.`);
 };

 const handlePostponeEvent = async (id, newDate, newDay) => {
 try {
 setIsLoading(true);
 const eventToPostpone = festivalRows.find(r => r._id === id);
 const title = eventToPostpone ? eventToPostpone.title : "Event";
 
 // Update event date on backend
 await axios.patch(`http://localhost:5000/api/devotee/events/${id}`, {
 date: newDate,
 status: "Upcoming"
 });

 // Send broadcast notification to devotees
 await axios.post("http://localhost:5000/api/devotee/notifications", {
 title: `Event Postponed: ${title}`,
 message: `The event "${title}" has been postponed to ${new Date(newDate).toLocaleDateString()} (${newDay}).`,
 category: "event",
 audienceRole: "devotee",
 broadcast: true
 });

 alert("Event postponed successfully & devotees notified!");
 await fetchEvents();
 await fetchOverview();
 } catch (error) {
 console.error(error);
 alert("Error postponing event: " + (error.response?.data?.error || error.message));
 } finally {
 setIsLoading(false);
 }
 };

 const handleSendInvitation = async () => {
 if (!invitationTitle.trim() || !invitationMessage.trim()) {
 alert("Please fill in the title and message fields.");
 return;
 }
 setIsLoading(true);
 try {
 await axios.post("http://localhost:5000/api/devotee/notifications", {
 title: invitationTitle,
 message: invitationMessage,
 category: "event",
 audienceRole: "devotee",
 broadcast: true,
 attachment: invitationFile || undefined
 });
 alert("Invitation sent successfully to all registered devotees!");
 setInvitationTitle("");
 setInvitationMessage("");
 setInvitationFile("");
 setInvitationFileName("");
 setShowInvitationModal(false);
 } catch (error) {
 console.error(error);
 alert("Error sending invitation: " + (error.response?.data?.error || error.message));
 } finally {
 setIsLoading(false);
 }
 };

  const handleInvitationFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setInvitationFileName(file.name);

    if (file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = () => {
        setInvitationFile(reader.result);
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1280;
        const maxHeight = 1280;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL("image/jpeg", 0.85);
        setInvitationFile(compressed);
      };
      img.onerror = () => {
        setInvitationFile(reader.result);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

 const todayStart = new Date();
 todayStart.setHours(0, 0, 0, 0);
 const upcomingCount = (festivalRows || []).filter((event) => {
 if (!event?.date) return false;
 const eventDate = new Date(event.date);
 if (Number.isNaN(eventDate.getTime())) return false;
 eventDate.setHours(0, 0, 0, 0);
 return eventDate >= todayStart && !["Completed", "Cancelled"].includes(event.status);
 }).length;

 const eventsWithDate = (festivalRows || [])
 .filter((event) => event?.date)
 .map((event) => ({ ...event, date: new Date(event.date) }))
 .filter((event) => !Number.isNaN(event.date.getTime()))
 .sort((left, right) => left.date - right.date);
 const upcomingFestival =
 eventsWithDate.find(
 (event) =>
 event.date >= todayStart && !["Completed", "Cancelled"].includes(event.status)
 ) || null;

 const stats = [
 {
 title: "Upcoming Festivals",
 value: overview.upcomingFestivals ?? upcomingCount ?? 0,
 note: `${overview.upcomingFestivals ?? upcomingCount ?? 0} scheduled ahead`,
 icon: MdOutlineEvent,
 iconTone: "bg-[#fff3e6] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#ff8b00]",
 },
 {
 title: "Today's Events",
 value: overview.todaysEvents ?? 0,
 note: `${overview.todaysEvents ?? 0} active celebrations`,
 icon: MdCalendarMonth,
 iconTone: "bg-[#f0ebff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#7c6bdb]",
 },
 {
 title: "Festival Revenue",
 value: `Rs ${Number(overview.festivalRevenue || 0).toLocaleString()}`,
 note: `${overview.monthlyRevenue ? `Rs ${Number(overview.monthlyRevenue).toLocaleString()} this month` : "Up to date"}`,
 icon: MdOutlineCurrencyRupee,
 iconTone: "bg-[#eaf0ff] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#3a74cc]",
 },
 ];

 return (
 <div className="mt-5 space-y-4 pb-6">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h1 className="text-[46px] leading-tight font-bold text-[#17151f] dark:text-slate-200 ">Temple Events</h1>
 <p className="mt-1 text-[20px] text-[#5c6675]">Manage temple events, schedules, cultural programs, and celebrations.</p>
 </div>
 <div className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 text-[20px] text-[#7b4a1f]">
 <MdCalendarMonth size={21} />
 21 May 2026, Thursday
 </div>
 </div>

 <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
 {stats.map((card) => {
 const Icon = card.icon;
 return (
 <div key={card.title} className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <div className="flex items-center gap-4">
 <div className={`flex h-20 w-20 items-center justify-center rounded-full ${card.iconTone}`}>
 <Icon size={36} />
 </div>
 <div>
 <p className="text-[29px] font-semibold text-[#1f2530] dark:text-slate-200 ">{card.title.replace("Festivals", "Events")}</p>
 <p className="text-[54px] leading-none font-bold text-[#1c2230] dark:text-slate-200 ">{card.value}</p>
 <p className="mt-1 text-[25px] text-[#2f9f2f] dark:text-slate-200 ">Up {card.note}</p>
 </div>
 </div>
 </div>
 );
 })}
 </div>

 <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2.25fr_1.1fr]">
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <h2 className="text-[40px] font-bold text-[#17151f] dark:text-slate-200 ">Event Schedule</h2>
 <div className="flex items-center gap-2">
 <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 px-4 text-[18px] text-[#4f5866] dark:text-slate-200 ">
 <MdOutlineFilterAlt size={18} /> Filter
 </button>
 <button onClick={() => setShowModal(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 text-[18px] font-semibold text-white hover:bg-[#ec7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 " > + Add Event </button>
 </div>
 </div>

 <div className="mb-4 flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 text-[#8b93a0]">
 <MdOutlineSearch size={20} />
 <input className="w-full bg-transparent text-[17px] text-[#202632] dark:text-slate-200 outline-none" placeholder="Search event..." />
 </div>

 <div className="overflow-auto rounded-xl border border-[#f1ede6] dark:border-slate-700 ">
 <table className="w-full min-w-[980px] text-[17px]">
 <thead className="bg-[#f8f6f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#2a3140] dark:text-slate-200 ">
 <tr>
 <th className="px-3 py-3 text-left font-semibold">Event</th>
 <th className="px-3 py-3 text-left font-semibold">Date</th>
 <th className="px-3 py-3 text-left font-semibold">Venue</th>
 {/* Slots and Registrations columns removed per request */}
 <th className="px-3 py-3 text-left font-semibold">Status</th>
 <th className="px-3 py-3 text-left font-semibold">Actions</th>
 </tr>
 </thead>
 <tbody>
 {festivalRows.map((row) => (
 <tr key={row._id || row.title} className="border-t border-[#f1ede6] dark:border-slate-700 text-[#2f3645] dark:text-slate-200 ">
 <td className="px-3 py-3">
 <div className="flex items-center gap-2">
 {row.image ? (
 <img src={row.image} alt={row.title} className="h-8 w-8 rounded-full object-cover" />
 ) : null}
 <span>{row.title}</span>
 </div>
 </td>

 <td className="px-3 py-3">{row.date ? new Date(row.date).toLocaleDateString() : "-"}</td>

 <td className="px-3 py-3">{row.location || "-"}</td>

 <td className="px-3 py-3">
 <span className={`rounded-xl px-3 py-1 text-[14px] font-semibold ${statusClass[row.status || "Upcoming"] || "bg-[#efefef] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 text-[#555]"}`}>
 {row.status || "Upcoming"}
 </span>
 </td>

 <td className="px-3 py-3">
 <div className="flex items-center gap-2">
 <button onClick={() => setViewEvent(row)} className="inline-flex h-8 w-10 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#7b5324]" title="View Details">
 <MdOutlineRemoveRedEye />
 </button>

 <button onClick={() => {
 setIsEditing(true);
 setEditingId(row._id);
 setTitle(row.title || "");
 setDate(row.date ? new Date(row.date).toISOString().slice(0,10) : "");
 setLocation(row.location || "");
 setDescription(row.description || "");
 setImagePreview(row.image || null);
 setImageUrl(row.image || "");
 setShowModal(true);
 }} className="inline-flex h-8 w-10 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#7b5324]" title="Edit Event">
 <MdOutlineEdit />
 </button>

 <button
 onClick={() => {
 const newDateStr = window.prompt("Enter new Date to postpone the event (YYYY-MM-DD):", row.date ? new Date(row.date).toISOString().slice(0, 10) : "");
 if (newDateStr) {
 const parsedDate = new Date(newDateStr);
 if (!Number.isNaN(parsedDate.getTime())) {
 const autoDay = parsedDate.toLocaleDateString("en-US", { weekday: 'long' });
 const newDayStr = window.prompt("Confirm or enter the Day of the week:", autoDay);
 if (newDayStr) {
 handlePostponeEvent(row._id, newDateStr, newDayStr);
 }
 } else {
 alert("Invalid date format.");
 }
 }
 }}
 title="Postpone Event"
 className="inline-flex h-8 px-2 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#d97706] text-xs font-semibold hover:bg-orange-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Postpone
 </button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 <div className="space-y-4">
 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <h3 className="text-[40px] font-bold text-[#17151f] dark:text-slate-200 ">Upcoming Event</h3>
 {upcomingFestival ? (
 <>
 <img src={upcomingFestival.image || "https://images.unsplash.com/photo-1532664189809-02133fee698d?auto=format&fit=crop&w=1300&q=80"} alt={upcomingFestival.title} className="mt-3 h-[168px] w-full rounded-xl object-cover" />
 <div className="mt-3">
 <h4 className="text-[39px] font-bold text-[#1b2230] dark:text-slate-200 ">{upcomingFestival.title}</h4>
 <div className="mt-1 space-y-1 text-[24px] text-[#3f4757] dark:text-slate-200 ">
 <p className="flex items-center gap-2"><FaRegCalendarAlt className="text-[#8b5b2d]" /> Date : {new Date(upcomingFestival.date).toLocaleDateString()}</p>
 <p className="flex items-center gap-2"><MdLocationOn className="text-[#8b5b2d]" /> Venue : {upcomingFestival.location}</p>
 <p className="flex items-center gap-2"><MdAccessTime className="text-[#8b5b2d]" /> Time : {upcomingFestival.time || "TBD"}</p>
 <p className="flex items-center gap-2"><MdPeople className="text-[#8b5b2d]" /> Registrations : {upcomingFestival.registrations || 0}</p>
 <p className="flex items-center gap-2"><MdOutlineCurrencyRupee className="text-[#8b5b2d]" /> Collection : Rs {upcomingFestival.collection || 0}</p>
 </div>
 <button className="mt-3 h-11 w-full rounded-lg bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[19px] font-semibold text-white hover:bg-[#ec7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">View Full Details</button>
 </div>
 </>
 ) : (
 <div className="mt-3 text-[18px] text-[#5c6675]">No upcoming event scheduled.</div>
 )}
 </div>

 <div className="rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-4">
 <h3 className="text-[36px] font-bold text-[#17151f] dark:text-slate-200 ">Quick Actions</h3>
 <div className="mt-3 grid grid-cols-2 gap-2">
 {quickActions.map((action) => {
 const Icon = action.icon;
 return (
 <button key={action.title} onClick={() => handleQuickAction(action.title)} className={`h-[92px] rounded-xl text-[18px] font-medium ${action.tone}`}>
 <div className="flex h-full flex-col items-center justify-center gap-1">
 <Icon size={26} />
 <span>{action.title}</span>
 </div>
 </button>
 );
 })}
 </div>
 </div>
 </div>
 </div>

 {/* Recent registrations and revenue chart removed */}

 <div className="flex items-center justify-between text-[14px] text-[#5c6675]">
 <span>(C) 2026 Sri Shanti Mahadev Mandir. All rights reserved.</span>
 <span className="font-medium text-[#8b5b2d]">Sacred Event Management Portal</span>
 </div>

 {/* Add Event Modal */}
 {showModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
 <div className="w-full max-w-md rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl">
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-[28px] font-bold text-[#17151f] dark:text-slate-200 ">{isEditing ? "Edit Event" : "Add New Event"}</h2>
 <button
 onClick={() => setShowModal(false)}
 className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#7b5324] hover:bg-[#f0ebe3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <MdClose size={20} />
 </button>
 </div>

 <div className="space-y-4">
 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Event Name *</label>
 <input
 type="text"
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 placeholder="e.g., Maha Shivaratri"
 className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00]"
 />
 </div>

 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Date *</label>
 <input
 type="date"
 value={date}
 onChange={(e) => setDate(e.target.value)}
 className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00]"
 />
 </div>

 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Venue/Location *</label>
 <input
 type="text"
 value={location}
 onChange={(e) => setLocation(e.target.value)}
 placeholder="e.g., Main Temple Hall"
 className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00]"
 />
 </div>

 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Description</label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder="Enter festival details..."
 rows="3"
 className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00] resize-none"
 />
 </div>

 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Banner Image (optional)</label>
 <input type="file" accept="image/*" onChange={handleImageChange} className="w-full text-[15px] text-[#202632] dark:text-slate-200 " />
 {imagePreview && (
 <img src={imagePreview} alt="preview" className="mt-3 h-28 w-full rounded-md object-cover" />
 )}
 </div>

 <div className="flex gap-3 pt-4">
 <button
 onClick={() => setShowModal(false)}
 className="flex-1 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] font-semibold text-[#4f5866] dark:text-slate-200 hover:bg-[#f0ebe3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Cancel
 </button>
 <button
 onClick={handleAddFestival}
 disabled={isLoading}
 className="flex-1 rounded-xl bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] font-semibold text-white hover:bg-[#ec7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:opacity-60 disabled:cursor-not-allowed"
 >
 {isLoading ? "Saving..." : (isEditing ? "Save Changes" : "Add Event")}
 </button>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* View Event Modal */}
 {viewEvent && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
 <div className="w-full max-w-lg rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl">
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-[24px] font-bold text-[#17151f] dark:text-slate-200 ">{viewEvent.title}</h2>
 <button onClick={() => setViewEvent(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#7b5324] hover:bg-[#f0ebe3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">Close</button>
 </div>
 <div>
 {viewEvent.image && <img src={viewEvent.image} alt={viewEvent.title} className="h-44 w-full rounded-md object-cover" />}
 <div className="mt-3 space-y-2 text-[16px] text-[#3f4757] dark:text-slate-200 ">
 <p><strong>Date:</strong> {viewEvent.date ? new Date(viewEvent.date).toLocaleString() : "-"}</p>
 <p><strong>Venue:</strong> {viewEvent.location || "-"}</p>
 <p><strong>Description:</strong> {viewEvent.description || "-"}</p>
 <p><strong>Registrations:</strong> {viewEvent.registrations || 0}</p>
 <p><strong>Collection:</strong> Rs {viewEvent.collection || 0}</p>
 <p><strong>Status:</strong> {viewEvent.status || "Upcoming"}</p>
 </div>
 <div className="mt-4 text-right">
 <button onClick={() => {
 setViewEvent(null);
 // open edit modal
 setIsEditing(true);
 setEditingId(viewEvent._id);
 setTitle(viewEvent.title || "");
 setDate(viewEvent.date ? new Date(viewEvent.date).toISOString().slice(0,10) : "");
 setLocation(viewEvent.location || "");
 setDescription(viewEvent.description || "");
 setImagePreview(viewEvent.image || null);
 setImageUrl(viewEvent.image || "");
 setShowModal(true);
 }} className="rounded-xl bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2 text-white">Edit Event</button>
 </div>
 </div>
 </div>
 </div>
 )}
 {/* Send Invitation Modal */}
 {showInvitationModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
 <div className="w-full max-w-md rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-6 shadow-2xl">
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-[28px] font-bold text-[#17151f] dark:text-slate-200 ">Send Invitation</h2>
 <button
 onClick={() => setShowInvitationModal(false)}
 className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#7b5324] hover:bg-[#f0ebe3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 <MdClose size={20} />
 </button>
 </div>

 <div className="space-y-4">
 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Invitation Title *</label>
 <input
 type="text"
 value={invitationTitle}
 onChange={(e) => setInvitationTitle(e.target.value)}
 placeholder="e.g., Brahmotsavam Invitation Card"
 className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00]"
 />
 </div>

 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Invitation Message *</label>
 <textarea
 value={invitationMessage}
 onChange={(e) => setInvitationMessage(e.target.value)}
 placeholder="Enter details about the event, timings, etc."
 rows="3"
 className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00] resize-none"
 />
 </div>

 <div>
 <label className="block text-[16px] font-semibold text-[#17151f] dark:text-slate-200 mb-2">Upload Image or PDF Invitation *</label>
 <input type="file" accept="image/*,application/pdf" onChange={handleInvitationFileChange} className="w-full text-[15px] text-[#202632] dark:text-slate-200 " />
 {invitationFileName && (
 <p className="mt-2 text-sm text-[#2e8e2e] dark:text-slate-200 ">Selected: {invitationFileName}</p>
 )}
 {invitationFile && invitationFile.startsWith("data:image/") && (
 <img src={invitationFile} alt="invitation preview" className="mt-3 h-28 w-full rounded-md object-cover" />
 )}
 </div>

 <div className="flex gap-3 pt-4">
 <button
 onClick={() => setShowInvitationModal(false)}
 className="flex-1 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] font-semibold text-[#4f5866] dark:text-slate-200 hover:bg-[#f0ebe3] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 "
 >
 Cancel
 </button>
 <button
 onClick={handleSendInvitation}
 disabled={isLoading}
 className="flex-1 rounded-xl bg-[#ff8b00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-4 py-2.5 text-[16px] font-semibold text-white hover:bg-[#ec7f00] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:opacity-60 disabled:cursor-not-allowed"
 >
 {isLoading ? "Sending..." : "Send Invitation"}
 </button>
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default FestivalsEventsManagement;
