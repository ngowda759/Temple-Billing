const Booking = require("../models/Booking");
const Task = require("../models/Task");
const notificationPersistenceService = require("../services/notificationPersistenceService");
const User = require("../models/User");
const mongoose = require("mongoose");
const InventoryItem = require("../models/InventoryItem");
const Instruction = require("../models/Instruction");
const Employee = require("../models/Employee");
const PriestSetting = require("../models/PriestSetting");
const TransferRequest = require("../models/TransferRequest");
const leaveService = require("../services/leaveService");

// Helper to check if a booking date is today
const isDateToday = (dateStr) => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  } catch (e) {
    return false;
  }
};

// Helper to check if a booking date is in the future
const isDateUpcoming = (dateStr) => {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date.getTime() > today.getTime();
  } catch (e) {
    return false;
  }
};

// Helper to format time as 06:00 AM
const formatTime = (dateStr) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch (e) {
    return dateStr;
  }
};

// Helper to format datetime as "15 May 2025, 07:30 AM"
const formatDateTime = (dateStr) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    return `${datePart}, ${timePart}`;
  } catch (e) {
    return dateStr;
  }
};

// GET /api/priest/dashboard
exports.getPriestDashboard = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    if (!user) {
      return res.status(404).json({ message: "Priest user not found" });
    }

    // 1. Fetch bookings assigned to this priest
    const bookings = await Booking.find({ assignedPriest: priestId });

    // 2. Filter today's poojas
    const todayBookings = bookings.filter(b => isDateToday(b.datetime));

    // 3. Filter upcoming poojas
    const upcomingBookings = bookings.filter(b => isDateUpcoming(b.datetime));
    upcomingBookings.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    // 4. Completed Today
    const completedTodayBookings = todayBookings.filter(b => b.status === "Completed");

    // 5. Pending Services assigned to this priest
    const pendingBookings = bookings.filter(b => b.status === "Pending");

    // 6. Total Devotees Served (All Assigned)
    const uniqueDevotees = new Set(bookings.map(b => b.devoteeName).filter(Boolean));
    const totalDevoteesCount = uniqueDevotees.size;

    // Stats
    const stats = {
      todayPooja: todayBookings.length,
      upcomingPooja: upcomingBookings.length,
      completedToday: completedTodayBookings.length,
      pendingServices: pendingBookings.length,
      totalDevotees: totalDevoteesCount,
    };

    // 7. Format today's schedule
    // The lookup goes through poojaService so it follows the selected
    // datasource. It is intentionally NOT populated: the original query had no
    // populate either, and this loop only reads requiredMaterials[].itemName /
    // qty / unit, so the plain id form is what matters here.
    const poojaService = require("../services/poojaService");
    const todaySchedule = await Promise.all(todayBookings.map(async (b) => {
      const poojaItems = b.isCombined ? (b.items || []).filter(i => i.type === "pooja") : [{
        name: b.service,
        selectedTempleMaterials: b.selectedTempleMaterials || []
      }];
      
      const materialsArranged = [];
      const devoteeBrings = [];
      
      for (const pooja of poojaItems) {
        const poojaInfo = await poojaService.findOne({ name: pooja.name });
        if (poojaInfo && poojaInfo.requiredMaterials) {
          poojaInfo.requiredMaterials.forEach(rm => {
            if (rm.mustBringByDevotee) {
              devoteeBrings.push(`${rm.qty} ${rm.unit} ${rm.itemName || "Item"}`);
            } else if (rm.canTempleArrange && pooja.selectedTempleMaterials && pooja.selectedTempleMaterials.includes(rm.item.toString())) {
              materialsArranged.push(`${rm.qty} ${rm.unit} ${rm.itemName || "Item"}`);
            } else {
              devoteeBrings.push(`${rm.qty} ${rm.unit} ${rm.itemName || "Item"}`);
            }
          });
        }
      }
      
      return {
        id: b._id,
        time: formatTime(b.datetime),
        pooja: b.service,
        devotee: b.devoteeName,
        status: b.status,
        templeArranged: materialsArranged,
        devoteeBrings: devoteeBrings,
      };
    }));

    // 8. Format upcoming poojas
    const upcomingPoojasFormatted = upcomingBookings.map(b => ({
      id: b._id,
      pooja: b.service,
      date: formatDateTime(b.datetime),
      devotee: b.devoteeName,
    }));

    // 9. Format completed services
    const completedBookings = bookings.filter(b => b.status === "Completed");
    const completedServicesFormatted = completedBookings.map(b => ({
      id: b._id,
      pooja: b.service,
      time: formatDateTime(b.datetime),
      devotee: b.devoteeName,
    }));

    // 10. Fetch today's Seva duties (Tasks)
    const todayStr = new Date().toISOString().slice(0, 10);
    const duties = await Task.find({
      $or: [
        { staffId: priestId },
        { staffEmail: user.email }
      ],
      dateKey: todayStr
    });

    const sevaDuties = duties.map(d => ({
      id: d._id,
      duty: d.dutyName || d.title || d.duty,
      time: d.time || d.startTime || "09:00 AM",
      description: d.description || d.notes || "",
    }));

    // 11. Fetch announcements
    const notifications = await notificationPersistenceService.findMany({
      filter: {
        $or: [
          { audienceRole: "priest" },
          { audienceId: priestId },
          { audienceEmail: user.email }
        ]
      },
      sort: { createdAt: -1 },
      limit: 10,
    });

    const announcements = notifications.map(n => ({
      id: n._id,
      title: n.title,
      date: new Date(n.createdAt || n.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      type: n.category || "general",
      description: n.message,
    }));

    return res.status(200).json({
      stats,
      todaySchedule,
      upcomingPoojas: upcomingPoojasFormatted,
      completedServices: completedServicesFormatted,
      sevaDuties,
      announcements,
    });
  } catch (error) {
    console.error("Error fetching priest dashboard data:", error);
    return res.status(500).json({ message: "Failed to load dashboard data" });
  }
};

// GET /api/priest/today-schedule
exports.getTodaySchedule = async (req, res) => {
  try {
    const priestId = req.user.id;
    const bookings = await Booking.find({ assignedPriest: priestId });
    const todayBookings = bookings.filter(b => isDateToday(b.datetime));
    const todaySchedule = todayBookings.map(b => ({
      id: b._id,
      time: formatTime(b.datetime),
      pooja: b.service,
      devotee: b.devoteeName,
      status: b.status,
    }));
    return res.status(200).json(todaySchedule);
  } catch (error) {
    console.error("Error fetching priest today schedule:", error);
    return res.status(500).json({ message: "Failed to load schedule" });
  }
};

// GET /api/priest/upcoming-poojas
exports.getUpcomingPoojas = async (req, res) => {
  try {
    const priestId = req.user.id;
    const bookings = await Booking.find({ assignedPriest: priestId });
    const upcomingBookings = bookings.filter(b => isDateUpcoming(b.datetime));
    upcomingBookings.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const upcomingPoojasFormatted = upcomingBookings.map(b => ({
      id: b._id,
      pooja: b.service,
      date: formatDateTime(b.datetime),
      devotee: b.devoteeName,
    }));
    return res.status(200).json(upcomingPoojasFormatted);
  } catch (error) {
    console.error("Error fetching priest upcoming poojas:", error);
    return res.status(500).json({ message: "Failed to load upcoming poojas" });
  }
};

// GET /api/priest/completed-today
exports.getCompletedToday = async (req, res) => {
  try {
    const priestId = req.user.id;
    const bookings = await Booking.find({ assignedPriest: priestId, status: "Completed" });
    const todayCompleted = bookings.filter(b => isDateToday(b.datetime));
    const completedTodayFormatted = todayCompleted.map(b => ({
      id: b._id,
      pooja: b.service,
      time: formatDateTime(b.datetime),
      devotee: b.devoteeName,
    }));
    return res.status(200).json(completedTodayFormatted);
  } catch (error) {
    console.error("Error fetching priest completed today services:", error);
    return res.status(500).json({ message: "Failed to load completed today services" });
  }
};

// PATCH /api/priest/bookings/:id/status
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const priestId = req.user.id;

    const allowed = ["Pending", "In Progress", "Completed", "Upcoming", "Confirmed", "Rejected", "Cancelled", "Assigned"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const booking = await Booking.findOne({ _id: id, assignedPriest: priestId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found or not assigned to you" });
    }

    const previousStatus = booking.status;
    booking.status = status;
    
    if (status === "Completed") {
      booking.completedAt = new Date();
    }
    
    // Log history
    booking.bookingHistory.push({
      previousStatus: previousStatus,
      newStatus: status,
      updatedBy: priestId,
      note: `Status updated by Priest`,
      updatedAt: new Date(),
    });

    await booking.save();

    return res.status(200).json({ message: "Status updated successfully", booking });
  } catch (error) {
    console.error("Error updating booking status:", error);
    return res.status(500).json({ message: "Failed to update booking status" });
  }
};

// GET /api/priest/assigned-poojas
exports.getAssignedPoojas = async (req, res) => {
  try {
    const priestId = req.user.id;
    const { status, search } = req.query;

    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Dev Data Self-Healing: Roll forward stale 'Upcoming' / 'Confirmed' / 'Assigned' booking dates
    const pastUpcomingBookings = await Booking.find({
      assignedPriest: priestId,
      status: { $in: ["Upcoming", "Confirmed", "Assigned"] }
    });

    for (const b of pastUpcomingBookings) {
      if (b.datetime) {
        const bDate = new Date(b.datetime);
        if (bDate.getTime() < startOfToday.getTime()) {
          const targetDate = new Date();
          const hour = isNaN(bDate.getHours()) ? 9 : bDate.getHours();
          const minute = isNaN(bDate.getMinutes()) ? 0 : bDate.getMinutes();
          targetDate.setHours(hour, minute, 0, 0);
          
          if (targetDate.getTime() < now.getTime()) {
            targetDate.setDate(targetDate.getDate() + 1);
          }
          
          b.datetime = targetDate.toISOString();
          await b.save();
        }
      }
    }

    // 2. Populate realistic devotee phones if missing
    const bookingsWithoutPhone = await Booking.find({
      assignedPriest: priestId,
      $or: [
        { devoteePhone: { $exists: false } },
        { devoteePhone: "" },
        { devoteePhone: null },
        { contactNumber: { $exists: false } },
        { contactNumber: "" },
        { contactNumber: null }
      ]
    });

    const dummyPhones = [
      "+91 98765 43210",
      "+91 87654 32109",
      "+91 76543 21098",
      "+91 95432 10987",
      "+91 91234 56789"
    ];

    for (let i = 0; i < bookingsWithoutPhone.length; i++) {
      const b = bookingsWithoutPhone[i];
      let phone = "";
      if (b.devoteeId) {
        const u = await User.findById(b.devoteeId);
        if (u && u.phone) phone = u.phone;
      }
      if (!phone) {
        phone = dummyPhones[i % dummyPhones.length];
      }
      b.devoteePhone = phone;
      b.contactNumber = phone;
      await b.save();
    }

    let query = { assignedPriest: priestId };

    // Apply search filter
    if (search && search.trim() !== "") {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      const orConditions = [
        { devoteeName: searchRegex },
        { service: searchRegex },
      ];
      if (mongoose.Types.ObjectId.isValid(search.trim())) {
        orConditions.push({ _id: search.trim() });
      }
      query.$or = orConditions;
    }

    let bookings = await Booking.find(query).sort({ datetime: 1 });

    // Apply status filter
    if (status && status !== "All") {
      if (status === "Upcoming") {
        bookings = bookings.filter(b => 
          ["Assigned", "Confirmed", "Upcoming"].includes(b.status) &&
          new Date(b.datetime).getTime() >= startOfToday.getTime()
        );
      } else {
        bookings = bookings.filter(b => b.status === status);
      }
    }

    const formatted = bookings.map(b => ({
      id: b._id,
      bookingId: b._id,
      date: b.datetime ? b.datetime.split("T")[0] : "",
      time: formatTime(b.datetime),
      pooja: b.service,
      devotee: b.devoteeName,
      mobile: b.devoteePhone || b.contactNumber || "N/A",
      email: b.devoteeEmail || "N/A",
      status: b.status,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      pendingReason: b.pendingReason,
      pendingAt: b.pendingAt,
      templeMaterialRequests: b.templeMaterialRequests || [],
      materialStatus: b.materialStatus,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching assigned poojas:", error);
    return res.status(500).json({ message: "Failed to load assigned poojas" });
  }
};

// PUT /api/priest/start-pooja/:id
exports.startPooja = async (req, res) => {
  try {
    const { id } = req.params;
    const priestId = req.user.id;

    const booking = await Booking.findOne({ _id: id, assignedPriest: priestId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found or not assigned to you" });
    }

    booking.status = "In Progress";
    booking.startedAt = new Date();
    await booking.save();

    return res.status(200).json({ message: "Pooja started successfully", booking });
  } catch (error) {
    console.error("Error starting pooja:", error);
    return res.status(500).json({ message: "Failed to start pooja" });
  }
};

// PUT /api/priest/complete-pooja/:id
exports.completePooja = async (req, res) => {
  try {
    const { id } = req.params;
    const priestId = req.user.id;

    const booking = await Booking.findOne({ _id: id, assignedPriest: priestId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found or not assigned to you" });
    }

    booking.status = "Completed";
    booking.completedAt = new Date();
    booking.assignedPriest = priestId;
    await booking.save();

    return res.status(200).json({ message: "Pooja completed successfully", booking });
  } catch (error) {
    console.error("Error completing pooja:", error);
    return res.status(500).json({ message: "Failed to complete pooja" });
  }
};

// PUT /api/priest/pending-pooja/:id
exports.pendingPooja = async (req, res) => {
  try {
    const { id } = req.params;
    const { pendingReason } = req.body;
    const priestId = req.user.id;

    if (!pendingReason || pendingReason.trim() === "") {
      return res.status(400).json({ message: "Reason is mandatory to put a pooja on hold" });
    }

    const booking = await Booking.findOne({ _id: id, assignedPriest: priestId });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found or not assigned to you" });
    }

    booking.status = "Pending";
    booking.pendingReason = pendingReason;
    booking.pendingAt = new Date();
    await booking.save();

    return res.status(200).json({ message: "Pooja status updated to Pending", booking });
  } catch (error) {
    console.error("Error setting pooja to pending:", error);
    return res.status(500).json({ message: "Failed to set pooja to pending" });
  }
};

// GET /api/priest/seva-schedule
exports.getSevaSchedule = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    if (!user) {
      return res.status(404).json({ message: "Priest user not found" });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    
    let duties = await Task.find({
      $or: [{ staffId: priestId }, { staffEmail: user.email }],
      dateKey: todayStr,
    });

    if (duties.length === 0) {
      const anyTasks = await Task.find({
        $or: [{ staffId: priestId }, { staffEmail: user.email }],
      });
      if (anyTasks.length > 0) {
        await Task.updateMany(
          { $or: [{ staffId: priestId }, { staffEmail: user.email }] },
          { dateKey: todayStr }
        );
        duties = await Task.find({
          $or: [{ staffId: priestId }, { staffEmail: user.email }],
          dateKey: todayStr,
        });
      }
    }

    const sevaDuties = duties.map(d => ({
      id: d._id,
      sevaName: d.dutyName || d.title || d.duty,
      startTime: d.startTime || (d.time ? d.time.split(" - ")[0] : "09:00 AM"),
      endTime: d.endTime || (d.time && d.time.includes(" - ") ? d.time.split(" - ")[1] : "10:00 AM"),
      description: d.description || d.notes || "No description provided",
      location: d.area || d.dutyArea || "Main Temple",
    }));

    return res.status(200).json(sevaDuties);
  } catch (error) {
    console.error("Error fetching seva schedule:", error);
    return res.status(500).json({ message: "Failed to load seva schedule" });
  }
};

// GET /api/priest/seva-instructions
exports.getSevaInstructions = async (req, res) => {
  try {
    const count = await Instruction.countDocuments();
    if (count === 0) {
      await Instruction.create([
        {
          title: "Morning Alankaram Preparation",
          description: "Ensure fresh flowers are sourced by 05:00 AM.",
          priority: "High",
          date: new Date(),
        },
        {
          title: "Deeparadhana Ghee Check",
          description: "Pure cow ghee must be used for deeparadhana. Do not use mixed oils.",
          priority: "High",
          date: new Date(),
        },
        {
          title: "Panchamrutham Quantity",
          description: "Panchamrutham quantities must match devotee count.",
          priority: "Medium",
          date: new Date(),
        },
        {
          title: "Dress Code & Discipline",
          description: "Dress code: Traditional white dhoti and shawl. Mobile phones on silent inside the sanctum.",
          priority: "Low",
          date: new Date(),
        }
      ]);
    }

    const instructions = await Instruction.find().sort({ date: -1 });
    const formatted = instructions.map(inst => ({
      id: inst._id,
      title: inst.title,
      description: inst.description,
      priority: inst.priority,
      date: inst.date ? inst.date.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching special instructions:", error);
    return res.status(500).json({ message: "Failed to load special instructions" });
  }
};

// GET /api/priest/material-checklist
exports.getMaterialChecklist = async (req, res) => {
  try {
    const count = await InventoryItem.countDocuments();
    if (count === 0) {
      await InventoryItem.create([
        { name: "Camphor", unit: "Pack", currentStock: 4, minimumStock: 10, category: "Pooja" },
        { name: "Flowers", unit: "Kg", currentStock: 18, minimumStock: 10, category: "Pooja" },
        { name: "Ghee", unit: "Liter", currentStock: 12, minimumStock: 5, category: "Pooja" },
        { name: "Agarbathi", unit: "Pack", currentStock: 6, minimumStock: 10, category: "Pooja" },
        { name: "Betel Leaves", unit: "Pieces", currentStock: 0, minimumStock: 50, category: "Pooja" },
      ]);
    }

    const items = await InventoryItem.find();

    const requiredQuantities = {
      "Camphor": "2 Packs",
      "Flowers": "5 Kg",
      "Ghee": "3 Liters",
      "Agarbathi": "2 Packs",
      "Betel Leaves": "50 Pieces",
    };

    const checklist = items.map(item => {
      const itemName = item.name;
      const requiredQty = requiredQuantities[itemName] || `1 ${item.unit}`;
      const availableQty = `${item.currentStock} ${item.unit}`;
      return {
        id: item._id,
        itemName,
        requiredQuantity: requiredQty,
        availableQuantity: availableQty,
        status: item.status,
      };
    });

    return res.status(200).json(checklist);
  } catch (error) {
    console.error("Error fetching material checklist:", error);
    return res.status(500).json({ message: "Failed to load material checklist" });
  }
};

// ─── Helper: compute duration string from two Date objects ────────────────────
const computeDuration = (startedAt, completedAt) => {
  if (!startedAt || !completedAt) return "N/A";
  try {
    const diffMs = new Date(completedAt) - new Date(startedAt);
    if (diffMs <= 0) return "N/A";
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins  = totalMins % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  } catch {
    return "N/A";
  }
};

// GET /api/priest/completed-services
exports.getCompletedServices = async (req, res) => {
  try {
    const priestId = req.user.id;
    const { search, filter, startDate, endDate, sort } = req.query;

    const query = {
      assignedPriest: priestId,
      status: "Completed",
    };

    const now  = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (filter === "today") {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      query.completedAt = { $gte: today, $lt: tomorrow };
    } else if (filter === "week") {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      query.completedAt = { $gte: weekStart };
    } else if (filter === "month") {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      query.completedAt = { $gte: monthStart };
    } else if (filter === "custom" && startDate && endDate) {
      const rangeStart = new Date(startDate);
      const rangeEnd   = new Date(endDate);
      rangeEnd.setHours(23, 59, 59, 999);
      query.completedAt = { $gte: rangeStart, $lte: rangeEnd };
    }

    if (search && search.trim() !== "") {
      const rx = { $regex: search.trim(), $options: "i" };
      const orConditions = [
        { devoteeName: rx },
        { service: rx },
      ];
      if (mongoose.Types.ObjectId.isValid(search.trim())) {
        orConditions.push({ _id: search.trim() });
      }
      query.$or = orConditions;
    }

    const sortOrder = sort === "oldest" ? 1 : -1;
    const bookings = await Booking.find(query).sort({ completedAt: sortOrder, createdAt: sortOrder });

    const formatted = bookings.map(b => ({
      bookingId: b._id,
      poojaName:    b.service || "N/A",
      devoteeName:  b.devoteeName || "N/A",
      devoteeMobile: b.devoteePhone || b.contactNumber || "N/A",
      date: b.datetime ? b.datetime.split("T")[0] : (b.createdAt ? b.createdAt.toISOString().split("T")[0] : "N/A"),
      startedAt:   b.startedAt  ? formatDateTime(b.startedAt)  : "N/A",
      completedAt: b.completedAt ? formatDateTime(b.completedAt) : "N/A",
      duration:    computeDuration(b.startedAt, b.completedAt),
      status: "Completed",
    }));

    const allCompleted = await Booking.find({ assignedPriest: priestId, status: "Completed" });

    const tomorrow   = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const weekStart  = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const completedToday = allCompleted.filter(b =>
      b.completedAt && new Date(b.completedAt) >= today && new Date(b.completedAt) < tomorrow
    ).length;

    const completedThisWeek = allCompleted.filter(b =>
      b.completedAt && new Date(b.completedAt) >= weekStart
    ).length;

    const completedThisMonth = allCompleted.filter(b =>
      b.completedAt && new Date(b.completedAt) >= monthStart
    ).length;

    const durationsMs = allCompleted
      .filter(b => b.startedAt && b.completedAt)
      .map(b => new Date(b.completedAt) - new Date(b.startedAt))
      .filter(d => d > 0);

    const avgMins = durationsMs.length
      ? Math.round(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 60000)
      : 0;
    const avgDurationStr = avgMins >= 60
      ? `${Math.floor(avgMins / 60)}h ${avgMins % 60}m`
      : `${avgMins}m`;

    return res.status(200).json({
      services: formatted,
      total: formatted.length,
      stats: {
        completedToday,
        completedThisWeek,
        completedThisMonth,
        avgDuration: avgDurationStr,
      },
    });
  } catch (error) {
    console.error("Error fetching completed services:", error);
    return res.status(500).json({ message: "Failed to load completed services" });
  }
};

// MODULE 4: SPECIAL DUTIES

exports.getSpecialDuties = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    
    const duties = await Task.find({
      $or: [{ staffId: priestId }, { staffEmail: user?.email }],
      assignmentType: { $in: ["Special Duty", "Duty & Shift"] },
    }).sort({ createdAt: -1 });

    const formatted = duties.map(d => ({
      id: d._id,
      title: d.dutyName || d.duty || d.title,
      description: d.description || d.notes || "",
      assignedPriest: d.staffName,
      assignedBy: d.assignedBy,
      date: d.dateKey || (d.dueDate ? d.dueDate.split("T")[0] : ""),
      startTime: d.startTime || (d.time ? d.time.split(" - ")[0] : ""),
      endTime: d.endTime || (d.time && d.time.includes(" - ") ? d.time.split(" - ")[1] : ""),
      compensation: d.compensation || "Standard",
      priority: d.priority || "Medium",
      status: d.status,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching special duties:", error);
    return res.status(500).json({ message: "Failed to load special duties" });
  }
};

exports.acceptDuty = async (req, res) => {
  try {
    const { id } = req.params;
    const priestId = req.user.id;
    const user = await User.findById(priestId);

    const task = await Task.findOne({ _id: id, $or: [{ staffId: priestId }, { staffEmail: user?.email }] });
    if (!task) return res.status(404).json({ message: "Duty not found" });

    task.status = "Accepted";
    task.acceptedAt = new Date();
    await task.save();

    return res.status(200).json({ message: "Duty accepted", task });
  } catch (error) {
    console.error("Error accepting duty:", error);
    return res.status(500).json({ message: "Failed to accept duty" });
  }
};

exports.rejectDuty = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const priestId = req.user.id;
    const user = await User.findById(priestId);

    const task = await Task.findOne({ _id: id, $or: [{ staffId: priestId }, { staffEmail: user?.email }] });
    if (!task) return res.status(404).json({ message: "Duty not found" });

    task.status = "Rejected";
    task.rejectedAt = new Date();
    task.rejectionReason = rejectionReason;
    await task.save();

    return res.status(200).json({ message: "Duty rejected", task });
  } catch (error) {
    console.error("Error rejecting duty:", error);
    return res.status(500).json({ message: "Failed to reject duty" });
  }
};

exports.completeDuty = async (req, res) => {
  try {
    const { id } = req.params;
    const priestId = req.user.id;
    const user = await User.findById(priestId);

    const task = await Task.findOne({ _id: id, $or: [{ staffId: priestId }, { staffEmail: user?.email }] });
    if (!task) return res.status(404).json({ message: "Duty not found" });

    task.status = "Completed";
    task.completedAt = new Date();
    await task.save();

    return res.status(200).json({ message: "Duty completed", task });
  } catch (error) {
    console.error("Error completing duty:", error);
    return res.status(500).json({ message: "Failed to complete duty" });
  }
};

// MODULE 5: FESTIVAL DUTIES

exports.getFestivalDuties = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    
    const duties = await Task.find({
      $or: [{ staffId: priestId }, { staffEmail: user?.email }],
      assignmentType: "Festival Duty",
    }).sort({ createdAt: -1 });

    const formatted = duties.map(d => ({
      id: d._id,
      festivalName: d.dutyName || d.duty || d.title,
      role: d.role || "Priest",
      description: d.description || d.notes || "",
      date: d.dateKey || (d.dueDate ? d.dueDate.split("T")[0] : ""),
      location: d.area || d.dutyArea || "Main Temple",
      startTime: d.startTime || (d.time ? d.time.split(" - ")[0] : ""),
      endTime: d.endTime || (d.time && d.time.includes(" - ") ? d.time.split(" - ")[1] : ""),
      status: d.status,
      attendanceStatus: d.attendanceStatus,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching festival duties:", error);
    return res.status(500).json({ message: "Failed to load festival duties" });
  }
};

exports.markFestivalDutyAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const priestId = req.user.id;
    const user = await User.findById(priestId);

    const task = await Task.findOne({ _id: id, $or: [{ staffId: priestId }, { staffEmail: user?.email }] });
    if (!task) return res.status(404).json({ message: "Duty not found" });

    task.status = "Attended";
    task.attendanceStatus = "Present";
    await task.save();

    return res.status(200).json({ message: "Attendance marked successfully", task });
  } catch (error) {
    console.error("Error marking attendance:", error);
    return res.status(500).json({ message: "Failed to mark attendance" });
  }
};

exports.completeFestivalDuty = async (req, res) => {
  try {
    const { id } = req.params;
    const priestId = req.user.id;
    const user = await User.findById(priestId);

    const task = await Task.findOne({ _id: id, $or: [{ staffId: priestId }, { staffEmail: user?.email }] });
    if (!task) return res.status(404).json({ message: "Duty not found" });

    task.status = "Completed";
    task.completedAt = new Date();
    await task.save();

    return res.status(200).json({ message: "Festival duty completed", task });
  } catch (error) {
    console.error("Error completing festival duty:", error);
    return res.status(500).json({ message: "Failed to complete festival duty" });
  }
};

// MODULE 6: NOTIFICATIONS

exports.getNotifications = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    
    const notifications = await notificationPersistenceService.findMany({
      filter: {
        $or: [
          { audienceId: priestId },
          { audienceEmail: user?.email },
          { audienceRole: "priest" }
        ]
      },
      sort: { createdAt: -1 },
    });

    const formatted = notifications.map(n => ({
      id: n._id,
      title: n.title,
      message: n.message,
      category: n.category || "General Notice",
      date: n.createdAt,
      read: n.read || n.viewed,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({ message: "Failed to load notifications" });
  }
};

exports.readNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await notificationPersistenceService.findById(id);
    if (!notification) return res.status(404).json({ message: "Notification not found" });

    await notificationPersistenceService.findByIdAndUpdate(id, {
      read: true,
      viewed: true,
      readAt: new Date(),
      viewedAt: new Date(),
    });

    return res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error reading notification:", error);
    return res.status(500).json({ message: "Failed to mark notification as read" });
  }
};

exports.readAllNotifications = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);

    await notificationPersistenceService.updateMany({
      $or: [
        { audienceId: priestId },
        { audienceEmail: user?.email },
        { audienceRole: "priest" }
      ],
      read: false
    }, {
      read: true,
      viewed: true,
      readAt: new Date(),
      viewedAt: new Date()
    });

    return res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error reading all notifications:", error);
    return res.status(500).json({ message: "Failed to mark all notifications as read" });
  }
};

// MODULE 7: PRIEST PROFILE

exports.getProfile = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    
    // Attempt to find the employee record mapping to this user
    let employee = await Employee.findOne({ email: user.email });
    
    if (!employee) {
      // Create a dummy employee record if none exists
      employee = await Employee.create({
        name: user.name,
        email: user.email,
        password: user.password,
        role: "priest",
        phone: user.phone || "9999999999",
        salary: 0,
        joiningDate: new Date(),
        experience: "5 Years",
        vedaShakha: "Rig Veda",
        specializations: ["Homa", "Alankaram"],
        languages: ["Sanskrit", "English", "Hindi"],
      });
    }

    const formatted = {
      name: employee.name,
      employeeId: employee._id,
      phone: employee.phone || "",
      email: employee.email,
      address: employee.address || "",
      gender: employee.gender || "Male",
      dob: employee.dob || "",
      joiningDate: employee.joiningDate ? new Date(employee.joiningDate).toISOString().split("T")[0] : "",
      experience: employee.experience || "",
      vedaShakha: employee.vedaShakha || "",
      specializations: employee.specializations || [],
      languages: employee.languages || [],
      certification: employee.certification || "",
      photo: employee.photo || "",
    };

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return res.status(500).json({ message: "Failed to load profile" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    const { phone, address, photo } = req.body;

    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ message: "Phone must be 10 digits" });
    }

    const employee = await Employee.findOne({ email: user.email });
    if (!employee) return res.status(404).json({ message: "Employee record not found" });

    if (phone) employee.phone = phone;
    if (address) employee.address = address;
    if (photo) employee.photo = photo;
    await employee.save();

    // Also sync phone with User model
    if (phone) {
      user.phone = phone;
      await user.save();
    }

    return res.status(200).json({ message: "Profile updated successfully", profile: employee });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({ message: "Failed to update profile" });
  }
};

// MODULE 8: PRIEST SETTINGS

exports.getSettings = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    const employee = await Employee.findOne({ email: user.email });
    
    if (!employee) {
      return res.status(404).json({ message: "Employee record not found for priest settings" });
    }

    let settings = await PriestSetting.findOne({ priestId: employee._id });
    if (!settings) {
      settings = await PriestSetting.create({ priestId: employee._id });
    }

    return res.status(200).json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return res.status(500).json({ message: "Failed to load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    const employee = await Employee.findOne({ email: user.email });
    
    if (!employee) {
      return res.status(404).json({ message: "Employee record not found for priest settings" });
    }

    let settings = await PriestSetting.findOne({ priestId: employee._id });
    if (!settings) {
      settings = new PriestSetting({ priestId: employee._id });
    }

    const { smsNotifications, dutyReminders, calendarWidget, agamaReferenceModule } = req.body;

    if (smsNotifications !== undefined) settings.smsNotifications = smsNotifications;
    if (dutyReminders !== undefined) settings.dutyReminders = dutyReminders;
    if (calendarWidget !== undefined) settings.calendarWidget = calendarWidget;
    if (agamaReferenceModule !== undefined) settings.agamaReferenceModule = agamaReferenceModule;

    await settings.save();

    return res.status(200).json({ message: "Settings updated successfully", settings });
  } catch (error) {
    console.error("Error updating settings:", error);
    return res.status(500).json({ message: "Failed to update settings" });
  }
};

// MODULE 9: PRIEST WORKFLOW REDESIGN (MY DUTIES)

exports.getMyDuties = async (req, res) => {
  try {
    const priestId = req.user.id;
    const user = await User.findById(priestId);
    
    // Fetch Priest Employee Record to get default duty
    const employee = await Employee.findOne({ userId: priestId });

    // 1. Fetch Bookings assigned to Priest
    const bookings = await Booking.find({ assignedPriest: priestId });

    // 2. Fetch Tasks assigned to Priest
    const todayStr = new Date().toISOString().slice(0, 10);
    const tasks = await Task.find({
      $or: [{ staffId: priestId }, { staffEmail: user?.email }],
      status: { $in: ["Pending", "Assigned", "Accepted", "In Progress", "Transfer Requested"] }
    });
    
    // Check pending TransferRequests for the employee
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const pendingTransfers = await TransferRequest.find({
      originalPriest: priestId,
      status: "Pending",
      $or: [
        { referenceType: { $ne: "DefaultDuty" } },
        { 
          referenceType: "DefaultDuty",
          $or: [
            { targetDate: { $gte: todayStart, $lte: todayEnd } },
            { targetDate: null, createdAt: { $gte: todayStart, $lte: todayEnd } }
          ]
        }
      ]
    });
    const pendingTransferIds = pendingTransfers.map(tr => tr.referenceId.toString());

    const unifiedDuties = [];

    // Add Priest's Default/Assigned Duty
    if (employee && (employee.defaultDuty || employee.currentDuty?.dutyName)) {
      const dutyName = employee.currentDuty?.dutyName || employee.defaultDuty;
      if (dutyName) {
        unifiedDuties.push({
          id: employee._id.toString(),
          referenceType: "DefaultDuty", // Use DefaultDuty to identify it
          poojaName: dutyName,
          devotee: "N/A",
          date: formatDateTime(new Date()),
          rawDate: new Date(),
          time: employee.currentDuty?.reportingTime || employee.defaultShift || "06:00 AM",
          area: employee.dutyLocation || employee.currentDuty?.dutyLocation || "Main Temple",
          priority: "High",
          assignedBy: "Admin",
          status: pendingTransferIds.includes(employee._id.toString()) ? "Transfer Requested" : "Assigned",
        });
      }
    }

    bookings.forEach(b => {
      unifiedDuties.push({
        id: b._id,
        referenceType: "Booking",
        poojaName: b.service || "General Pooja",
        devotee: b.devoteeName || "N/A",
        date: formatDateTime(b.datetime),
        rawDate: new Date(b.datetime),
        time: formatTime(b.datetime),
        area: "Main Temple", // Default for poojas
        priority: "High", // Default for booked poojas
        assignedBy: "Admin",
        status: b.status,
      });
    });

    tasks.forEach(t => {
      let rawDate = new Date();
      if (t.dateKey) {
        rawDate = new Date(t.dateKey);
      } else if (t.dueDate) {
        rawDate = new Date(t.dueDate);
      }
      
      unifiedDuties.push({
        id: t._id,
        referenceType: "Task",
        poojaName: t.dutyName || t.duty || t.title,
        devotee: "N/A",
        date: formatDateTime(rawDate),
        rawDate: rawDate,
        time: t.time || t.startTime || "N/A",
        area: t.area || t.dutyArea || "Main Temple",
        priority: t.priority || "Medium",
        assignedBy: t.assignedBy || "Admin",
        status: t.status,
      });
    });

    // Sort by date descending
    unifiedDuties.sort((a, b) => b.rawDate - a.rawDate);

    return res.status(200).json(unifiedDuties);
  } catch (error) {
    console.error("Error fetching My Duties:", error);
    return res.status(500).json({ message: "Failed to load My Duties" });
  }
};

exports.startMyDuty = async (req, res) => {
  try {
    const { referenceType, referenceId } = req.body;
    
    if (referenceType === "Booking") {
      const booking = await Booking.findById(referenceId);
      if (!booking || booking.status !== "Assigned") {
        return res.status(400).json({ message: "Cannot start this duty. It may not be in 'Assigned' state." });
      }
      booking.status = "In Progress";
      booking.startedAt = new Date();
      await booking.save();
    } else if (referenceType === "Task") {
      const task = await Task.findById(referenceId);
      if (!task || task.status !== "Assigned") {
        return res.status(400).json({ message: "Cannot start this duty. It may not be in 'Assigned' state." });
      }
      task.status = "In Progress";
      await task.save();
    } else {
      return res.status(400).json({ message: "Invalid reference type" });
    }

    return res.status(200).json({ message: "Duty started successfully" });
  } catch (error) {
    console.error("Error starting duty:", error);
    return res.status(500).json({ message: "Failed to start duty" });
  }
};

exports.completeMyDuty = async (req, res) => {
  try {
    const { referenceType, referenceId, remarks, duration } = req.body;
    
    if (referenceType === "Booking") {
      const booking = await Booking.findById(referenceId);
      if (!booking || booking.status !== "In Progress") {
        return res.status(400).json({ message: "Cannot complete. Duty must be 'In Progress'." });
      }
      booking.status = "Completed";
      booking.completedAt = new Date();
      booking.completionRemarks = remarks || "";
      booking.completionDuration = Number(duration) || 0;
      await booking.save();
    } else if (referenceType === "Task") {
      const task = await Task.findById(referenceId);
      if (!task || task.status !== "In Progress") {
        return res.status(400).json({ message: "Cannot complete. Duty must be 'In Progress'." });
      }
      task.status = "Completed";
      task.completedAt = new Date();
      task.completionRemarks = remarks || "";
      task.completionDuration = Number(duration) || 0;
      await task.save();
    } else {
      return res.status(400).json({ message: "Invalid reference type" });
    }

    return res.status(200).json({ message: "Duty completed successfully" });
  } catch (error) {
    console.error("Error completing duty:", error);
    return res.status(500).json({ message: "Failed to complete duty" });
  }
};

exports.requestTransfer = async (req, res) => {
  try {
    const priestId = req.user.id;
    const { referenceType, referenceId, requestedPriestId, reason, remarks } = req.body;

    if (!requestedPriestId || requestedPriestId === priestId) {
      return res.status(400).json({ message: "Invalid requested priest." });
    }

    // Validation
    let dateStr = "";
    if (referenceType === "Booking") {
      const booking = await Booking.findById(referenceId);
      if (!booking || booking.status !== "Assigned") {
        return res.status(400).json({ message: "Can only transfer duties that are in 'Assigned' state." });
      }
      dateStr = booking.datetime;
    } else if (referenceType === "Task") {
      const task = await Task.findById(referenceId);
      if (!task || task.status !== "Assigned") {
        return res.status(400).json({ message: "Can only transfer duties that are in 'Assigned' state." });
      }
      dateStr = task.dateKey;
    } else if (referenceType === "DefaultDuty") {
      const employee = await Employee.findById(referenceId);
      if (!employee) {
        return res.status(400).json({ message: "Invalid duty reference." });
      }
      // Use the provided date from frontend or default to today
      dateStr = req.body.dateStr || new Date().toISOString();
    } else {
      return res.status(400).json({ message: "Invalid reference type" });
    }

    // Check if requested priest is on leave
    let conflictWarning = "";
    if (dateStr) {
      const checkDate = new Date(dateStr).toISOString().slice(0, 10);
      const leaveCheck = await leaveService.findOne({
        staffId: requestedPriestId,
        status: "Approved",
        fromDate: { $lte: checkDate },
        toDate: { $gte: checkDate },
      });
      if (leaveCheck) {
        conflictWarning = "Warning: The requested priest is on approved leave for this date.";
      }

      // Check 5 hour rule for DefaultDuty, Booking, Task
      const dutyDate = new Date(dateStr);
      if (!isNaN(dutyDate.getTime())) {
        let actualDutyTime = dutyDate;
        
        // If DefaultDuty and the time is passed from frontend, or we just rely on dateStr
        // Actually for DefaultDuty, dateStr from frontend is e.g. "2026-08-25T09:00:00.000Z" (which has the correct time parsed)
        
        const fiveHoursBefore = new Date(actualDutyTime.getTime() - (5 * 60 * 60 * 1000));
        if (new Date() > fiveHoursBefore) {
          return res.status(400).json({ message: "Duty transfers must be requested at least 5 hours before the scheduled time." });
        }
      }
    }

    const transferRequest = await TransferRequest.create({
      referenceType,
      referenceId,
      originalPriest: priestId,
      requestedPriest: requestedPriestId,
      reason,
      remarks,
      targetDate: dateStr ? new Date(dateStr) : undefined
    });

    if (referenceType === "Booking") {
      await Booking.findByIdAndUpdate(referenceId, { status: "Transfer Requested" });
    } else if (referenceType === "Task") {
      await Task.findByIdAndUpdate(referenceId, { status: "Transfer Requested" });
    }
    // For DefaultDuty, we don't update status in any separate model right now.

    await notificationPersistenceService.create({
      title: "Pooja Transfer Request",
      message: `A priest has requested to transfer a duty. Reason: ${reason}`,
      audienceRole: "admin",
      category: "transfer",
    });

    await notificationPersistenceService.create({
      title: "Duty Transfer Request",
      message: `You have a new duty transfer request. Reason: ${reason}`,
      audienceId: requestedPriestId,
      category: "transfer",
    });

    const reqPriestUser = await User.findById(requestedPriestId);
    if (reqPriestUser && reqPriestUser.email) {
      const { sendEmail } = require("../utils/communicationService");
      await sendEmail({
        to: reqPriestUser.email,
        subject: "Duty Transfer Request",
        text: `You have received a new duty transfer request.\n\nDate & Time: ${dateStr ? new Date(dateStr).toLocaleString() : "N/A"}\nReason: ${reason}\nRemarks: ${remarks || "None"}\n\nPlease check your dashboard to approve or reject.`,
        html: `
          <div style="font-family: sans-serif;">
            <h2>Duty Transfer Request</h2>
            <p>You have received a new duty transfer request.</p>
            <ul>
              <li><strong>Date & Time:</strong> ${dateStr ? new Date(dateStr).toLocaleString() : "N/A"}</li>
              <li><strong>Reason:</strong> ${reason}</li>
              <li><strong>Remarks:</strong> ${remarks || "None"}</li>
            </ul>
            <p>Please check your dashboard to approve or reject.</p>
          </div>
        `
      });
    }

    return res.status(200).json({ 
      message: "Transfer request submitted successfully to Admin.", 
      warning: conflictWarning 
    });
  } catch (error) {
    console.error("Error requesting transfer:", error);
    return res.status(500).json({ message: "Failed to request transfer" });
  }
};

exports.getPriestsList = async (req, res) => {
  try {
    const activeEmployees = await Employee.find({
      role: { $regex: /^priest$/i },
      status: { $in: ["Active", "On Leave"] },
      deletedAt: null
    }).select("email employeeId userId");

    const emails = activeEmployees.map(emp => emp.email).filter(Boolean);
    const employeeIds = activeEmployees.map(emp => emp.employeeId).filter(Boolean);
    const userIds = activeEmployees.map(emp => emp.userId).filter(Boolean);

    if (emails.length === 0 && employeeIds.length === 0 && userIds.length === 0) {
      return res.status(200).json([]);
    }

    const priests = await User.find({ 
      $or: [
        { email: { $in: emails } },
        { employeeId: { $in: employeeIds } },
        { _id: { $in: userIds } }
      ],
      role: { $regex: /^priest$/i }, 
      status: { $in: ["Active", "On Leave"] },
      accountEnabled: { $ne: false }
    }).select("name email _id");

    return res.status(200).json(priests);
  } catch (error) {
    console.error("Error fetching priests list:", error);
    return res.status(500).json({ message: "Failed to fetch priests" });
  }
};

exports.getIncomingTransfers = async (req, res) => {
  try {
    const priestId = req.user.id;
    const transfers = await TransferRequest.find({
      requestedPriest: priestId,
      status: "Pending"
    }).populate("originalPriest", "name").populate("referenceId");
    
    return res.status(200).json(transfers);
  } catch (error) {
    console.error("Error fetching incoming transfers:", error);
    return res.status(500).json({ message: "Failed to fetch incoming transfers" });
  }
};

exports.getMyTransfers = async (req, res) => {
  try {
    const priestId = req.user.id;
    const transfers = await TransferRequest.find({
      $or: [{ originalPriest: priestId }, { requestedPriest: priestId }]
    })
      .populate("originalPriest", "name email")
      .populate("requestedPriest", "name email")
      .sort({ createdAt: -1 });

    const Booking = require("../models/Booking");
    const Task = require("../models/Task");

    const formattedRequests = await Promise.all(
      transfers.map(async (req) => {
        let dutyName = "Unknown";
        let devotee = "N/A";
        let date = "N/A";
        let time = "N/A";

        if (req.referenceType === "Booking") {
          const booking = await Booking.findById(req.referenceId);
          if (booking) {
            dutyName = booking.service;
            devotee = booking.devoteeName;
            date = new Date(booking.datetime).toLocaleDateString();
            time = new Date(booking.datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }
        } else if (req.referenceType === "Task") {
          const task = await Task.findById(req.referenceId);
          if (task) {
            dutyName = task.title || task.dutyName || task.duty;
            date = task.dateKey || new Date(task.createdAt).toLocaleDateString();
            time = task.time || task.startTime || "N/A";
          }
        }

        return {
          id: req._id,
          referenceType: req.referenceType,
          referenceId: req.referenceId,
          originalPriest: req.originalPriest,
          requestedPriest: req.requestedPriest,
          dutyName,
          devotee,
          date,
          time,
          reason: req.reason,
          remarks: req.remarks,
          status: req.status,
          requestedAt: req.createdAt,
          type: req.originalPriest._id.toString() === priestId ? "Outgoing" : "Incoming"
        };
      })
    );

    return res.status(200).json(formattedRequests);
  } catch (error) {
    console.error("Error fetching transfers:", error);
    return res.status(500).json({ message: "Failed to fetch transfers" });
  }
};

exports.respondToTransfer = async (req, res) => {
  try {
    const priestId = req.user.id;
    const { id } = req.params;
    const { status, rejectReason } = req.body; // "Approved" or "Rejected"

    const transfer = await TransferRequest.findById(id).populate("originalPriest", "name").populate("requestedPriest", "name");
    if (!transfer) return res.status(404).json({ message: "Transfer request not found" });
    if (transfer.requestedPriest._id.toString() !== priestId) return res.status(403).json({ message: "Not authorized" });

    if (status === "Rejected" && !rejectReason) {
      return res.status(400).json({ message: "Rejection reason is required." });
    }

    transfer.status = status;
    if (status === "Rejected") {
      transfer.rejectReason = rejectReason;
    }
    
    await transfer.save();

    const Booking = require("../models/Booking");
    const Task = require("../models/Task");

    if (status === "Approved") {
      if (transfer.referenceType === "Booking") {
        await Booking.findByIdAndUpdate(transfer.referenceId, { 
          assignedPriest: priestId,
          status: "Assigned" 
        });
      } else {
        await Task.findByIdAndUpdate(transfer.referenceId, {
          assignedPriest: priestId,
          status: "Assigned"
        });
      }
    } else {
      if (transfer.referenceType === "Booking") {
        await Booking.findByIdAndUpdate(transfer.referenceId, { status: "Assigned" });
      } else {
        await Task.findByIdAndUpdate(transfer.referenceId, { status: "Assigned" });
      }
    }

    // Generate notifications
    await notificationPersistenceService.create({
      title: `Duty Transfer ${status}`,
      message: `Your duty transfer request to ${transfer.requestedPriest.name} was ${status.toLowerCase()}.${status === "Rejected" ? ` Reason: ${rejectReason}` : ""}`,
      audienceId: transfer.originalPriest._id.toString(),
      audienceRole: "priest",
      category: "Duty"
    });

    await notificationPersistenceService.create({
      title: `Duty Transfer ${status}`,
      message: `Priest ${transfer.requestedPriest.name} has ${status.toLowerCase()} the duty transfer from ${transfer.originalPriest.name}.${status === "Rejected" ? ` Reason: ${rejectReason}` : ""}`,
      audienceRole: "admin",
      category: "Duty"
    });

    return res.status(200).json({ message: `Transfer request ${status.toLowerCase()} successfully.` });
  } catch (error) {
    console.error("Error responding to transfer:", error);
    return res.status(500).json({ message: "Failed to respond to transfer" });
  }
};

exports.getAvailablePriestsForTransfer = async (req, res) => {
  try {
    const { date, time } = req.query; // e.g. date=2025-05-15, time=07:30 AM
    const priestId = req.user.id;

    if (!date || !time) {
      return res.status(400).json({ message: "Date and time are required." });
    }

    const dutyDateStr = `${date.split("T")[0]} ${time}`;
    const dutyDate = new Date(dutyDateStr);
    
    // If invalid date, fallback to returning all active priests
    let busyPriestIds = [priestId];
    
    if (!isNaN(dutyDate.getTime())) {
      const startOfDuty = new Date(dutyDate.getTime() - (2 * 60 * 60 * 1000));
      const endOfDuty = new Date(dutyDate.getTime() + (2 * 60 * 60 * 1000));

      const busyBookings = await Booking.find({
        status: { $in: ["Booked", "Confirmed", "Assigned", "In Progress", "Upcoming"] }
      });
      
      const busyBookingPriests = busyBookings.filter(b => {
        const bDate = new Date(b.datetime);
        return bDate >= startOfDuty && bDate <= endOfDuty;
      }).map(b => b.assignedPriest?.toString()).filter(Boolean);

      const busyTasks = await Task.find({
        dateKey: { $regex: new RegExp(date.split("T")[0], "i") },
        status: { $in: ["Pending", "Assigned", "Accepted", "In Progress"] }
      });
      
      const busyTaskPriests = busyTasks.filter(t => {
        return t.time === time || t.startTime === time || (t.time && t.time.includes(time.split(" ")[0]));
      }).map(t => t.staffId).filter(Boolean);

      busyPriestIds = [...new Set([...busyBookingPriests, ...busyTaskPriests, priestId])];
    }

    const activeEmployees = await Employee.find({
      role: { $regex: /^priest$/i },
      status: { $in: ["Active"] },
      deletedAt: null
    }).select("email employeeId userId");

    const emails = activeEmployees.map(emp => emp.email).filter(Boolean);
    const userIds = activeEmployees.map(emp => emp.userId).filter(Boolean);

    if (emails.length === 0 && userIds.length === 0) {
      return res.status(200).json([]);
    }

    const availablePriests = await User.find({
      $or: [
        { email: { $in: emails } },
        { _id: { $in: userIds } }
      ],
      role: { $regex: /^priest$/i },
      status: "Active",
      accountEnabled: { $ne: false },
      _id: { $nin: busyPriestIds }
    }).select("name email _id");

    return res.status(200).json(availablePriests);
  } catch (error) {
    console.error("Error fetching available priests:", error);
    return res.status(500).json({ message: "Failed to fetch available priests" });
  }
};



