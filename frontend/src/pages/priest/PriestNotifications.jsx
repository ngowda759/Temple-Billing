import { useState, useEffect } from "react";
import { getNotifications, readNotification, readAllNotifications } from "../../services/priestService";
import EmailNotificationsView from "../../components/shared/EmailNotificationsView";

const PriestNotifications = () => {
 const [notifications, setNotifications] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");

 const loadNotifications = async () => {
 try {
 setLoading(true);
 setError("");
 const data = await getNotifications();
 setNotifications(data || []);
 } catch (err) {
 setError(err.response?.data?.message || "Failed to load notifications");
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadNotifications();
 }, []);

 const handleRead = async (id) => {
 try {
 await readNotification(id);
 setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
 } catch (err) {
 alert("Failed to mark as read");
 }
 };

 const handleReadAll = async () => {
 try {
 await readAllNotifications();
 setNotifications(notifications.map(n => ({ ...n, read: true })));
 } catch (err) {
 alert("Failed to mark all as read");
 }
 };

 return (
 <EmailNotificationsView
 title="Notifications"
 subtitle="Stay updated with temple announcements and duty changes."
 notifications={notifications}
 loading={loading}
 error={error}
 onMarkRead={handleRead}
 onMarkAllRead={handleReadAll}
 onRefresh={loadNotifications}
 />
 );
};

export default PriestNotifications;
