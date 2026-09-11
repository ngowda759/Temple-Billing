const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const donationRoutes = require("./routes/donationRoutes");
const devoteeRoutes = require("./routes/devoteeRoutes");
const staffRoutes = require("./routes/staffRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const shiftRoutes = require("./routes/shiftRoutes");
const adminInventoryRoutes = require("./routes/adminInventoryRoutes");
const adminPrasadamOrdersRoutes = require("./routes/adminPrasadamOrdersRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const billRoutes = require("./routes/billRoutes");
const priestRoutes = require("./routes/priestRoutes");
const prasadamRoutes = require("./routes/prasadamRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const attendanceSettingsRoutes = require("./routes/attendanceSettingsRoutes");
const transferRoutes = require("./routes/transferRoutes");
const roomRoutes = require("./routes/roomRoutes");
const attendanceLocationRoutes = require("./routes/attendanceLocationRoutes");
const accountRoutes = require("./routes/accountRoutes");
const poojaSettingsRoutes = require("./routes/poojaSettingsRoutes");
const poojaRoutes = require("./routes/poojaRoutes");
const poojaBookingRoutes = require("./routes/poojaBookingRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const publicRoutes = require("./routes/publicRoutes");
const Room = require("./models/Room");

const app = express();
const { isPostgresConnected } = require("./config/postgres");

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/api/notifications", notificationRoutes);

app.get("/api/health", async (req, res) => {
  let postgres = "unavailable";
  try {
    postgres = (await isPostgresConnected()) ? "connected" : "unavailable";
  } catch (error) {
    console.error("Health check: PostgreSQL status error:", error.message);
  }
  res.status(200).json({
    status: "ok",
    service: "temple-billing-backend",
    postgres,
  });
});

// Public API routes
app.use("/api/public", publicRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/devotee", devoteeRoutes);
app.use("/api/devotees", devoteeRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/staff/attendance", attendanceRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/admin", adminInventoryRoutes);
app.use("/api/admin", adminPrasadamOrdersRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/priest", priestRoutes);
app.use("/api/prasadam", prasadamRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/attendance/settings", attendanceSettingsRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/attendance-locations", attendanceLocationRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/pooja-settings", poojaSettingsRoutes);
app.use("/api/pooja", poojaBookingRoutes);
app.use("/api/poojas", poojaRoutes);
app.use("/api/audit-logs", auditLogRoutes);

// Automatic Check-in/out background scheduler running every 60 seconds
setInterval(async () => {
  try {
    const now = new Date();

    // 1. Process automatic checkouts
    // Find occupied rooms whose checkout time has passed
    const roomsToCheckout = await Room.find({
      status: "Occupied",
      checkoutDate: { $lte: now }
    });

    for (const room of roomsToCheckout) {
      console.log(`[Auto-Checkout] Room ${room.number} checkout time reached.`);
      room.status = "Available";
      room.devotee = undefined;
      room.phone = undefined;
      room.days = undefined;
      room.payMode = undefined;
      room.checkinDate = undefined;
      room.checkoutDate = undefined;
      await room.save();
    }

    // 2. Process automatic checkins
    // Find available rooms that have devotee details set and checkin time has reached (but checkout time has not)
    const roomsToCheckin = await Room.find({
      status: "Available",
      checkinDate: { $lte: now },
      checkoutDate: { $gt: now },
      devotee: { $exists: true, $ne: null }
    });

    for (const room of roomsToCheckin) {
      console.log(`[Auto-Checkin] Room ${room.number} checkin time reached.`);
      room.status = "Occupied";
      await room.save();
    }

  } catch (err) {
    console.error("Background room scheduler error:", err);
  }
}, 60000);

// Daily Background Jobs for Notifications
const cron = require("node-cron");
const Asset = require("./models/Asset");
const Notification = require("./models/Notification");
const PoojaBooking = require("./models/PoojaBooking");

// Run every day at 8:00 AM
cron.schedule("0 8 * * *", async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // 1. Warranty Expiration Check
    const expiringAssets = await Asset.find({
      warranty: { $exists: true, $ne: null },
    });
    
    // Some logic to parse warranty if it's a date. 
    // Usually 'warranty' might be a string like '1 Year' or a Date. 
    // Assuming it's a Date string if parseable
    for (const asset of expiringAssets) {
      const warrantyDate = new Date(asset.warranty);
      if (!isNaN(warrantyDate.getTime())) {
        if (warrantyDate >= today && warrantyDate <= thirtyDaysFromNow) {
          await Notification.create({
            title: "Warranty Expiring Soon",
            message: `The warranty for asset ${asset.name} (ID: ${asset.assetId}) is expiring on ${warrantyDate.toLocaleDateString()}.`,
            category: "Asset Management",
            audienceRole: "admin",
          });
        }
      }
    }

    // 2. Upcoming Poojas for tomorrow
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    const upcomingPoojas = await PoojaBooking.find({
      status: "Booked",
      bookingDate: { $gte: tomorrow, $lt: dayAfterTomorrow }
    });

    if (upcomingPoojas.length > 0) {
      await Notification.create({
        title: "Upcoming Poojas Tomorrow",
        message: `There are ${upcomingPoojas.length} poojas scheduled for tomorrow. Please ensure materials are ready.`,
        category: "Pooja Management",
        audienceRole: "priest", // or staff/admin
      });
    }

    console.log("[Cron] Daily notification checks completed.");
  } catch (err) {
    console.error("[Cron] Error running daily jobs:", err);
  }
});

module.exports = app;
