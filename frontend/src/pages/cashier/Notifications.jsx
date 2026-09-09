import { useState } from "react";
import { useNotifications } from "../../context/NotificationContext";
import EmailNotificationsView from "../../components/shared/EmailNotificationsView";

const Notifications = () => {
 const { notifications, loading, loadNotifications, markRead } = useNotifications();
 const [error, setError] = useState("");

 const handleMarkRead = async (notificationId) => {
 try {
 await markRead(notificationId);
 } catch (err) {
 setError("Unable to update notification status.");
 }
 };

 return (
 <div className="p-6">
 <EmailNotificationsView
 title="Cashier Notifications"
 subtitle="Counter notices, admin broadcasts and payment alerts."
 notifications={notifications}
 loading={loading}
 error={error}
 onMarkRead={handleMarkRead}
 onRefresh={loadNotifications}
 />
 </div>
 );
};

export default Notifications;
