import React, { useState, useMemo } from "react";
import { FiBell, FiCheckCircle, FiCheck, FiFilter } from "react-icons/fi";

const EmailNotificationsView = ({
  title = "Notifications",
  subtitle = "Stay updated with announcements and alerts.",
  notifications = [],
  loading = false,
  error = "",
  onMarkRead,
  onMarkAllRead,
  onRefresh
}) => {
  const [filter, setFilter] = useState("all"); // "all" or "unread"
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Dynamically get available categories
  const categories = useMemo(() => {
    const cats = new Set();
    notifications.forEach((n) => {
      if (n.category) cats.add(n.category);
      else if (n.type) cats.add(n.type);
    });
    return ["all", ...Array.from(cats)].map(c => String(c).toLowerCase());
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    return notifications
      .filter((n) => {
        // Unread filter
        if (filter === "unread" && (n.read || n.isRead)) return false;
        
        // Category filter
        const nCat = String(n.category || n.type || "").toLowerCase();
        if (categoryFilter !== "all" && nCat !== categoryFilter) return false;
        
        return true;
      })
      .sort((a, b) => {
        const dateA = new Date(a.date || a.createdAt || Date.now()).getTime();
        const dateB = new Date(b.date || b.createdAt || Date.now()).getTime();
        return dateB - dateA; // newest first
      });
  }, [notifications, filter, categoryFilter]);

  const unreadCount = notifications.filter(n => !(n.read || n.isRead)).length;

  const handleRead = (id, e) => {
    e.stopPropagation();
    if (onMarkRead) onMarkRead(id);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FiBell className="text-amber-500" /> {title}
          </h1>
          <p className="text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--panel,#fff)] dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Refresh
            </button>
          )}
          {unreadCount > 0 && onMarkAllRead && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-[#0f172a] px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <FiCheckCircle /> Mark all as read
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-[#0f172a] p-4 text-sm font-medium text-rose-700">{error}</div>}

      <div className="rounded-[24px] border border-slate-200 dark:border-slate-700 bg-[var(--panel,#fff)] dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col">
        {/* Toolbar */}
        <div className="border-b border-slate-100 dark:border-slate-800 p-2 flex items-center gap-2 bg-slate-50/50 dark:bg-[#0f172a]/20">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${filter === "all" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:bg-slate-800"}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${filter === "unread" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:bg-slate-800"}`}
          >
            Unread
          </button>
          
          {categories.length > 2 && (
             <div className="ml-auto relative flex items-center gap-2">
               <FiFilter className="text-slate-400" />
               <select
                 value={categoryFilter}
                 onChange={(e) => setCategoryFilter(e.target.value)}
                 className="appearance-none bg-transparent outline-none text-sm font-semibold text-slate-700 dark:text-slate-300 pr-4 cursor-pointer"
               >
                 {categories.map(cat => (
                   <option key={cat} value={cat}>
                     {cat === "all" ? "All Categories" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                   </option>
                 ))}
               </select>
             </div>
          )}
        </div>

        {/* Notifications List */}
        {loading ? (
          <div className="p-10 text-center text-slate-500 dark:text-slate-400">Loading notifications...</div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-10 text-center text-slate-500 dark:text-slate-400">
            {filter === "unread" || categoryFilter !== "all" 
              ? "No notifications match the current filters." 
              : "You have no notifications."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {filteredNotifications.map((notification) => {
              const isRead = notification.read || notification.isRead;
              const id = notification._id || notification.id;
              const date = new Date(notification.date || notification.createdAt || Date.now());
              
              return (
                <div 
                  key={id}
                  onClick={(e) => !isRead && handleRead(id, e)} 
                  className={`relative flex items-start gap-4 p-5 transition-colors border-l-4 ${!isRead ? "cursor-pointer border-amber-500 bg-[var(--panel,#fff)] dark:bg-[#0f172a]/80 shadow-sm z-10" : "border-transparent bg-slate-50/30 dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                >
                  <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isRead ? 'bg-slate-100 dark:bg-[#0f172a] text-slate-400 dark:text-slate-500' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                    <FiBell />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <h4 className={`text-base ${isRead ? 'font-normal text-slate-600 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-slate-100'}`}>
                        {notification.displayTitle || notification.title}
                      </h4>
                      <span className={`shrink-0 text-xs ${isRead ? 'text-slate-400 dark:text-slate-500' : 'font-semibold text-amber-600 dark:text-amber-500'}`}>
                        {date.toLocaleString("en-IN", {
                          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
                        })}
                      </span>
                    </div>
                    <p className={`mt-1 text-sm ${isRead ? 'text-slate-500 dark:text-slate-400' : 'font-medium text-slate-800 dark:text-slate-200'}`}>
                      {notification.displayMessage || notification.message}
                    </p>
                    {notification.attachment && (
                      <div className="mt-3">
                        {(notification.attachment.startsWith("data:image/") || (!notification.attachment.startsWith("data:application/pdf") && !notification.attachment.toLowerCase().endsWith(".pdf"))) ? (
                          <img
                            src={notification.attachment}
                            alt="Event Banner"
                            className="max-h-56 w-auto rounded-xl object-contain border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xs"
                          />
                        ) : (
                          <a
                            href={notification.attachment}
                            download={`Attachment-${(notification.title || "Event").replace(/\s+/g, "_")}.pdf`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-3.5 py-1.5 text-xs font-bold text-white transition shadow-xs"
                          >
                            📄 Download Attached Document
                          </a>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex gap-2">
                        {(notification.category || notification.type) && (
                          <span className="inline-block rounded-full bg-slate-100 dark:bg-[#0f172a] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                            {notification.category || notification.type}
                          </span>
                        )}
                        {notification.audienceRole && (
                          <span className="inline-block rounded-full bg-slate-100 dark:bg-[#0f172a] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                            {notification.audienceRole}
                          </span>
                        )}
                      </div>
                      
                      {!isRead && onMarkRead && (
                        <button
                          onClick={(e) => handleRead(id, e)}
                          className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700"
                        >
                          <FiCheck /> Mark Read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailNotificationsView;
