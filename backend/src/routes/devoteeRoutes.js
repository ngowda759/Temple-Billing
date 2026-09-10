const express = require("express");
const {
  getBookings,
  createBooking,
  getDonations,
  createDonation,
  getNotifications,
  getProfile,
  getEvents,
  createEvent,
  getFestivalOverview,
  updateEventStatus,
  updateEvent,
  deleteEvent,
  submitSupportRequest,
  updateProfile,
  getSupportRequests,
  replySupportRequest,
  createNotification,
  createRazorpayOrder,
  verifyRazorpayPayment,
  verifyBookingPayment,
  verifyPrasadamPayment,
  handleRazorpayWebhook,
  getPrasadamOrders,
  createPrasadamOrder,
  cancelPrasadamOrder,
  updateBookingStatus,
  markNotificationAsRead,
  markSupportRequestAsRead,
  sendNotificationEmail,
} = require("../controllers/devoteeController");

const router = express.Router();

router.get("/bookings", getBookings);
router.post("/bookings", createBooking);
router.post("/bookings/verify", verifyBookingPayment);
router.patch("/bookings/:id/status", updateBookingStatus);
router.get("/donations", getDonations);
router.post("/donations", createDonation);
router.get("/notifications", getNotifications);
router.post("/notifications/:id/send-email", sendNotificationEmail);
router.patch("/notifications/:id/read", markNotificationAsRead);
router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.get("/events", getEvents);
router.post("/events", createEvent);
router.get("/events/overview", getFestivalOverview);
router.patch("/events/:id/status", updateEventStatus);
router.patch("/events/:id", updateEvent);
router.delete("/events/:id", deleteEvent);
// Razorpay endpoints for order creation, verification and webhook
router.post("/razorpay/order", createRazorpayOrder);
router.post("/razorpay/verify", verifyRazorpayPayment);
router.post("/prasadam-orders/verify", verifyPrasadamPayment);
router.post("/razorpay/webhook", express.raw({ type: "application/json" }), handleRazorpayWebhook);
router.post("/support", submitSupportRequest);
router.get("/support", getSupportRequests);
router.patch("/support/:id", replySupportRequest);
router.patch("/support/:id/read", markSupportRequestAsRead);
router.post("/notifications", createNotification);
router.get("/prasadam-orders", getPrasadamOrders);
router.post("/prasadam-orders", createPrasadamOrder);
router.patch("/prasadam-orders/:id/cancel", cancelPrasadamOrder);

module.exports = router;
