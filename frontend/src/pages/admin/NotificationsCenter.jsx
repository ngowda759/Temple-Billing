import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { getSupportRequests } from "../../services/devoteeService";
import EmailNotificationsView from "../../components/shared/EmailNotificationsView";

const API_BASE = "http://localhost:5000/api";

const NotificationsCenter = ({ darkMode }) => {
 const { user } = useAuth();
 const [notifications, setNotifications] = useState([]);
 const [supportRequests, setSupportRequests] = useState([]);
 const [loading, setLoading] = useState(true);

 const load = useCallback(async () => {
 try {
 setLoading(true);
 const adminId = user?._id || user?.id || JSON.parse(localStorage.getItem("user") || "null")?._id;
 if (!adminId) return;
 const [nRes, sRes] = await Promise.all([
 axios.get(`${API_BASE}/notifications/admin/${adminId}`),
 getSupportRequests(),
 ]);
 setNotifications(Array.isArray(nRes.data) ? nRes.data : []);
 setSupportRequests(sRes.requests || []);
 } catch (error) {
 console.warn("Unable to load notifications center", error);
 } finally {
 setLoading(false);
 }
 }, [user]);

 useEffect(() => {
 load();
 }, [load]);

 const normalizedNotifications = useMemo(() => {
 const combined = [
 ...supportRequests.map(req => ({
 ...req,
 category: "Support Requests",
 displayTitle: req.subject,
 displayMessage: `${req.name} (${req.email}): ${req.message}`,
 dateObj: new Date(req.createdAt || Date.now()),
 isRead: req.read,
 })),
 ...notifications.map(notif => ({
 ...notif,
 category: "Admin Alerts",
 displayTitle: notif.title,
 displayMessage: notif.message,
 dateObj: new Date(notif.date || notif.createdAt || Date.now()),
 isRead: notif.read || notif.viewed,
 }))
 ];

 // the EmailNotificationsView will sort them internally, but we can pre-sort
 return combined.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
 }, [notifications, supportRequests]);

 const handleMarkAsRead = async (id) => {
 const item = normalizedNotifications.find(n => (n._id || n.id) === id);
 if (!item || item.isRead) return;

 try {
 if (item.category === "Support Requests") {
 await axios.patch(`${API_BASE}/devotees/support/${id}/read`);
 setSupportRequests(prev => prev.map(req => req._id === id ? { ...req, read: true } : req));
 } else {
 await axios.put(`${API_BASE}/notifications/read/${id}`);
 setNotifications(prev => prev.map(notif => notif._id === id ? { ...notif, read: true, viewed: true } : notif));
 }
 window.dispatchEvent(new Event("notificationsUpdated"));
 } catch (error) {
 console.warn("Failed to mark as read", error);
 }
 };

 return (
 <div className={`mt-5 w-full ${darkMode ? "dark" : ""}`}>
 <EmailNotificationsView
 title="Admin Notifications"
 subtitle="Monitor devotee support requests and system alerts."
 notifications={normalizedNotifications}
 loading={loading}
 onMarkRead={handleMarkAsRead}
 onRefresh={load}
 />
 </div>
 );
};

export default NotificationsCenter;
