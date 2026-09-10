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
 MdOutlineDelete,
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
  Completed: "bg-[#f3f4f6] dark:bg-slate-800 text-[#6b7280] dark:text-slate-400 border border-gray-200 dark:border-slate-700",
  Cancelled: "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50",
};

const formatEventDates = (startDate, endDate) => {
  if (!startDate) return "-";
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return "-";
  const startStr = start.toLocaleDateString();

  if (!endDate) return startStr;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) === start.toISOString().slice(0, 10)) {
    return startStr;
  }
  return `${startStr} - ${end.toLocaleDateString()}`;
};

const getResolvedStatus = (event) => {
  if (!event) return "Upcoming";
  if (event.status === "Cancelled") return "Cancelled";
  if (!event.date) return event.status || "Upcoming";

  const eventStartDate = new Date(event.date);
  if (Number.isNaN(eventStartDate.getTime())) return event.status || "Upcoming";
  eventStartDate.setHours(0, 0, 0, 0);

  const eventEndDate = event.endDate ? new Date(event.endDate) : new Date(event.date);
  if (!Number.isNaN(eventEndDate.getTime())) {
    eventEndDate.setHours(23, 59, 59, 999);
  } else {
    eventEndDate.setTime(eventStartDate.getTime());
    eventEndDate.setHours(23, 59, 59, 999);
  }

  const now = new Date();

  if (now > eventEndDate) {
    return "Completed";
  }
  if (now >= eventStartDate && now <= eventEndDate) {
    return "Active";
  }
  return event.status || "Upcoming";
};

const FestivalsEventsManagement = () => {

 const [festivalRows, setFestivalRows] = useState([]);
 const [showModal, setShowModal] = useState(false);
 const [isEditing, setIsEditing] = useState(false);
 const [editingId, setEditingId] = useState(null);
 const [viewEvent, setViewEvent] = useState(null);

 const [searchQuery, setSearchQuery] = useState("");
 const [statusFilter, setStatusFilter] = useState("All");
 const [showFilterPanel, setShowFilterPanel] = useState(false);

 const [overview, setOverview] = useState({ upcomingFestivals: 0, todaysEvents: 0, currentMonthFestivals: 0, monthlyRevenue: 0, festivalRevenue: 0 });

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
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

  const getTomorrowDateStr = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const day = String(tomorrow.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const minSelectableDate = getTomorrowDateStr();

  const handleDeleteEvent = async (eventToDelete) => {
    if (!eventToDelete) return;
    const eventId = eventToDelete._id || eventToDelete.id;
    if (!eventId) {
      alert("Error: Missing event ID.");
      return;
    }

    const confirmed = window.confirm(`Are you sure you want to delete the event "${eventToDelete.title}"? This cannot be undone.`);
    if (!confirmed) return;

    setIsLoading(true);
    try {
      await axios.delete(`http://localhost:5000/api/devotee/events/${eventId}`);
      alert(`Event "${eventToDelete.title}" deleted successfully.`);
      if (viewEvent && (viewEvent._id === eventId || viewEvent.id === eventId)) {
        setViewEvent(null);
      }
      await fetchEvents();
      await fetchOverview();
    } catch (error) {
      console.error("Failed to delete event:", error);
      alert("Error deleting event: " + (error.response?.data?.error || error.message));
    } finally {
      setIsLoading(false);
    }
  };

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
      alert("Please fill in all required fields (Event Name, From Date, and Location).");
      return;
    }

    const selectedFrom = new Date(date);
    if (Number.isNaN(selectedFrom.getTime())) {
      alert("Please enter a valid From Date.");
      return;
    }

    const tomorrowStart = new Date();
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    selectedFrom.setHours(0, 0, 0, 0);

    if (selectedFrom < tomorrowStart) {
      alert("Event date must be in the future (previous dates and today cannot be selected).");
      return;
    }

    const finalEndDate = endDate || date;
    const selectedTo = new Date(finalEndDate);
    if (Number.isNaN(selectedTo.getTime())) {
      alert("Please enter a valid To Date.");
      return;
    }
    selectedTo.setHours(0, 0, 0, 0);

    if (selectedTo < selectedFrom) {
      alert("To Date cannot be earlier than From Date.");
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        title: title.trim(),
        date,
        endDate: finalEndDate,
        location: location.trim(),
        description: description.trim(),
        imageUrl: imageUrl || undefined,
      };

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
      setEndDate("");
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
    if (action === "Add Event") {
      setIsEditing(false);
      setEditingId(null);
      setTitle("");
      setDate("");
      setEndDate("");
      setLocation("");
      setDescription("");
      setImagePreview(null);
      setImageUrl("");
      return setShowModal(true);
    }

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
      // Broadcast invitation to all registered devotees
      await axios.post("http://localhost:5000/api/devotee/notifications", {
        title: invitationTitle,
        message: invitationMessage,
        category: "event",
        audienceRole: "devotee",
        broadcast: true,
        attachment: invitationFile || undefined
      });

      // Also broadcast invitation to all employees
      await axios.post("http://localhost:5000/api/devotee/notifications", {
        title: invitationTitle,
        message: invitationMessage,
        category: "event",
        audienceRole: "staff",
        broadcast: true,
        attachment: invitationFile || undefined
      }).catch(err => console.warn("Employee invitation broadcast error:", err.message));

      alert("Invitation sent successfully to all registered devotees and employees!");
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
    return eventDate >= todayStart && getResolvedStatus(event) === "Upcoming";
  }).length;

  const eventsWithDate = (festivalRows || [])
    .filter((event) => event?.date)
    .map((event) => ({ ...event, parsedDate: new Date(event.date) }))
    .filter((event) => !Number.isNaN(event.parsedDate.getTime()))
    .sort((left, right) => left.parsedDate - right.parsedDate);
  const upcomingFestival =
    eventsWithDate.find(
      (event) =>
        event.parsedDate >= todayStart && getResolvedStatus(event) === "Upcoming"
    ) || null;

  const filteredEvents = (festivalRows || []).filter((event) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = (event.title || "").toLowerCase().includes(q);
      const matchLocation = (event.location || "").toLowerCase().includes(q);
      const matchDesc = (event.description || "").toLowerCase().includes(q);
      if (!matchTitle && !matchLocation && !matchDesc) return false;
    }

    const resolvedStatus = getResolvedStatus(event);

    if (statusFilter !== "All") {
      if (resolvedStatus.toLowerCase() !== statusFilter.toLowerCase()) return false;
    }

    return true;
  });

  const activeFiltersCount = (statusFilter !== "All" ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

  const handleClearFilters = () => {
    setSearchQuery("");
    setStatusFilter("All");
  };

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
 <div className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 px-4 text-[18px] font-medium text-[#7b4a1f] dark:text-amber-300">
 <MdCalendarMonth size={21} />
 {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", weekday: "long" })}
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
        <div className="flex items-center gap-3">
          <h2 className="text-[32px] sm:text-[40px] font-bold text-[#17151f] dark:text-slate-200">Event Schedule</h2>
          <span className="rounded-full bg-orange-100 dark:bg-orange-950/50 text-[#b45309] dark:text-orange-300 text-xs font-semibold px-2.5 py-1">
            {filteredEvents.length} {filteredEvents.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-[16px] font-medium transition-colors ${
              showFilterPanel || activeFiltersCount > 0
                ? "border-[#ff8b00] bg-[#fff5ea] dark:bg-orange-950/40 text-[#ff8b00]"
                : "border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-800 text-[#4f5866] dark:text-slate-200 hover:bg-[#f3efe8]"
            }`}
          >
            <MdOutlineFilterAlt size={18} />
            <span>Filter</span>
            {activeFiltersCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ff8b00] text-[11px] font-bold text-white">
                {activeFiltersCount}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setIsEditing(false);
              setEditingId(null);
              setTitle("");
              setDate("");
              setEndDate("");
              setLocation("");
              setDescription("");
              setImagePreview(null);
              setImageUrl("");
              setShowModal(true);
            }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#ff8b00] px-4 text-[16px] font-semibold text-white hover:bg-[#ec7f00] transition-colors"
          >
            + Add Event
          </button>
        </div>
      </div>

      {showFilterPanel && (
        <div className="mb-4 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-850 p-4 transition-all">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <span className="text-[15px] font-bold text-[#1f2530] dark:text-slate-200 flex items-center gap-1.5">
              <MdOutlineFilterAlt size={16} className="text-[#ff8b00]" /> Filter Events
            </span>
            {activeFiltersCount > 0 && (
              <button
                onClick={handleClearFilters}
                className="text-xs font-semibold text-[#ff8b00] hover:underline"
              >
                Reset All Filters
              </button>
            )}
          </div>
          <div className="max-w-xs">
            <label className="block text-xs font-semibold text-[#5c6675] dark:text-slate-300 mb-1">
              Event Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-10 rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-[#202632] dark:text-slate-200 outline-none focus:border-[#ff8b00]"
            >
              <option value="All">All Statuses</option>
              <option value="Upcoming">Upcoming</option>
              <option value="Active">Active / Ongoing</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      )}

      <div className="mb-4 flex h-11 items-center gap-2 rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-3 text-[#8b93a0]">
        <MdOutlineSearch size={20} />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-transparent text-[16px] text-[#202632] dark:text-slate-200 outline-none placeholder:text-gray-400"
          placeholder="Search event by name, venue, or description..."
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
            title="Clear search"
          >
            <MdClose size={18} />
          </button>
        )}
      </div>

      <div className="overflow-auto rounded-xl border border-[#f1ede6] dark:border-slate-700">
        <table className="w-full min-w-[980px] text-[17px]">
          <thead className="bg-[#f8f6f2] dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-[#2a3140] dark:text-slate-200">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">Event</th>
              <th className="px-3 py-3 text-left font-semibold">Date</th>
              <th className="px-3 py-3 text-left font-semibold">Venue</th>
              <th className="px-3 py-3 text-left font-semibold">Status</th>
              <th className="px-3 py-3 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-12 text-center text-[#5c6675] dark:text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <MdOutlineEvent size={38} className="text-gray-300 dark:text-slate-600" />
                    <p className="text-base font-semibold">No events found</p>
                    <p className="text-sm text-gray-400">
                      {activeFiltersCount > 0 ? "Try adjusting your search query or filter options." : "No events are available at this time."}
                    </p>
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="mt-2 text-sm font-semibold text-[#ff8b00] hover:underline"
                      >
                        Reset All Filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredEvents.map((row) => (
                <tr key={row._id || row.title} className="border-t border-[#f1ede6] dark:border-slate-700 text-[#2f3645] dark:text-slate-200 hover:bg-[#fbf9f5] dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      {row.image ? (
                        <img src={row.image} alt={row.title} className="h-9 w-9 rounded-full object-cover border border-[#ece8e1] dark:border-slate-700" />
                      ) : null}
                      <span className="font-medium">{row.title}</span>
                    </div>
                  </td>

                  <td className="px-3 py-3">{formatEventDates(row.date, row.endDate)}</td>

                  <td className="px-3 py-3">{row.location || "-"}</td>

                  <td className="px-3 py-3">
                    <span className={`rounded-xl px-3 py-1 text-[13px] font-semibold ${statusClass[getResolvedStatus(row)] || "bg-[#efefef] text-[#555]"}`}>
                      {getResolvedStatus(row)}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setViewEvent(row)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 text-[#7b5324] hover:bg-[#f0ebe3] transition-colors"
                        title="View Details"
                      >
                        <MdOutlineRemoveRedEye size={16} />
                      </button>

                      <button
                        onClick={() => {
                          setIsEditing(true);
                          setEditingId(row._id);
                          setTitle(row.title || "");
                          setDate(row.date ? new Date(row.date).toISOString().slice(0,10) : "");
                          setEndDate(row.endDate ? new Date(row.endDate).toISOString().slice(0,10) : (row.date ? new Date(row.date).toISOString().slice(0,10) : ""));
                          setLocation(row.location || "");
                          setDescription(row.description || "");
                          setImagePreview(row.image || null);
                          setImageUrl(row.image || "");
                          setShowModal(true);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] dark:text-slate-200 text-[#7b5324] hover:bg-[#f0ebe3] transition-colors"
                        title="Edit Event"
                      >
                        <MdOutlineEdit size={16} />
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
                        className="inline-flex h-8 px-2.5 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-[#0f172a] text-[#d97706] text-xs font-semibold hover:bg-orange-50 transition-colors"
                      >
                        Postpone
                      </button>

                      <button
                        onClick={() => handleDeleteEvent(row)}
                        title="Delete Event"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
                      >
                        <MdOutlineDelete size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
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
                <p className="flex items-center gap-2"><FaRegCalendarAlt className="text-[#8b5b2d]" /> Date : {formatEventDates(upcomingFestival.date, upcomingFestival.endDate)}</p>
                <p className="flex items-center gap-2"><MdLocationOn className="text-[#8b5b2d]" /> Venue : {upcomingFestival.location}</p>
                <p className="flex items-center gap-2"><MdAccessTime className="text-[#8b5b2d]" /> Time : {upcomingFestival.time || "TBD"}</p>
                <p className="flex items-center gap-2"><MdPeople className="text-[#8b5b2d]" /> Registrations : {upcomingFestival.registrations || 0}</p>
                <p className="flex items-center gap-2"><MdOutlineCurrencyRupee className="text-[#8b5b2d]" /> Collection : Rs {upcomingFestival.collection || 0}</p>
              </div>
              <button
                onClick={() => setViewEvent(upcomingFestival)}
                className="mt-3 h-11 w-full rounded-lg bg-[#ff8b00] text-[19px] font-semibold text-white hover:bg-[#ec7f00] transition-colors shadow-sm"
              >
                View Full Details
              </button>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[15px] font-semibold text-[#17151f] dark:text-slate-200 mb-1.5">
                  From Date *
                </label>
                <input
                  type="date"
                  value={date}
                  min={minSelectableDate}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    setDate(newDate);
                    if (!endDate || endDate < newDate) {
                      setEndDate(newDate);
                    }
                  }}
                  className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 px-3 py-2 text-[15px] text-[#202632] outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00]"
                />
              </div>

              <div>
                <label className="block text-[15px] font-semibold text-[#17151f] dark:text-slate-200 mb-1.5">
                  To Date *
                </label>
                <input
                  type="date"
                  value={endDate || date}
                  min={date || minSelectableDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-[#0f172a] dark:text-slate-200 px-3 py-2 text-[15px] text-[#202632] outline-none focus:border-[#ff8b00] focus:ring-1 focus:ring-[#ff8b00]"
                />
              </div>
            </div>
            <p className="text-xs text-[#8b5b2d] dark:text-amber-400 font-medium -mt-2">
              * Previous dates and today cannot be selected. Events must start from tomorrow onwards.
            </p>

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#ece8e1] dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[24px] font-bold text-[#17151f] dark:text-slate-200">{viewEvent.title}</h2>
            <span className={`rounded-xl px-2.5 py-0.5 text-[12px] font-semibold ${statusClass[getResolvedStatus(viewEvent)] || "bg-[#efefef] text-[#555]"}`}>
              {getResolvedStatus(viewEvent)}
            </span>
          </div>
          <button
            onClick={() => setViewEvent(null)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-slate-800 text-[#7b5324] dark:text-slate-200 hover:bg-[#f0ebe3] transition-colors"
            title="Close"
          >
            <MdClose size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {viewEvent.image && (
            <img src={viewEvent.image} alt={viewEvent.title} className="h-44 w-full rounded-xl object-cover border border-[#ece8e1] dark:border-slate-700" />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-800/60 p-3">
              <span className="text-xs font-semibold text-[#8b5b2d] dark:text-amber-400 block mb-0.5">Date</span>
              <p className="text-sm font-bold text-[#1f2530] dark:text-slate-200">
                {formatEventDates(viewEvent.date, viewEvent.endDate)}
              </p>
            </div>
            <div className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-800/60 p-3">
              <span className="text-xs font-semibold text-[#8b5b2d] dark:text-amber-400 block mb-0.5">Venue</span>
              <p className="text-sm font-bold text-[#1f2530] dark:text-slate-200 truncate">
                {viewEvent.location || "-"}
              </p>
            </div>
            <div className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-800/60 p-3">
              <span className="text-xs font-semibold text-[#8b5b2d] dark:text-amber-400 block mb-0.5">Time</span>
              <p className="text-sm font-bold text-[#1f2530] dark:text-slate-200">
                {viewEvent.time || "TBD"}
              </p>
            </div>
            <div className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-800/60 p-3">
              <span className="text-xs font-semibold text-[#8b5b2d] dark:text-amber-400 block mb-0.5">Collection</span>
              <p className="text-sm font-bold text-[#1f2530] dark:text-slate-200">
                Rs {Number(viewEvent.collection || 0).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf9f7] dark:bg-slate-800/60 p-3">
            <span className="text-xs font-semibold text-[#8b5b2d] dark:text-amber-400 block mb-1">Description</span>
            <p className="text-sm text-[#3f4757] dark:text-slate-300 whitespace-pre-line">
              {viewEvent.description || "No description provided for this event."}
            </p>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#f1ede6] dark:border-slate-700">
            <button
              onClick={() => handleDeleteEvent(viewEvent)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 transition-colors"
            >
              <MdOutlineDelete size={18} />
              Delete Event
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewEvent(null)}
                className="rounded-xl border border-[#ece8e1] dark:border-slate-700 bg-[#faf7f2] dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-[#4f5866] dark:text-slate-200 hover:bg-[#f0ebe3] transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const ev = viewEvent;
                  setViewEvent(null);
                  setIsEditing(true);
                  setEditingId(ev._id || ev.id);
                  setTitle(ev.title || "");
                  setDate(ev.date ? new Date(ev.date).toISOString().slice(0, 10) : "");
                  setEndDate(ev.endDate ? new Date(ev.endDate).toISOString().slice(0, 10) : (ev.date ? new Date(ev.date).toISOString().slice(0, 10) : ""));
                  setLocation(ev.location || "");
                  setDescription(ev.description || "");
                  setImagePreview(ev.image || null);
                  setImageUrl(ev.image || "");
                  setShowModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#ff8b00] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ec7f00] transition-colors"
              >
                <MdOutlineEdit size={16} />
                Edit Event
              </button>
            </div>
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
