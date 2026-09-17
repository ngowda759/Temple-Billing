require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("./src/models/User");
const Booking = require("./src/models/Booking");
const Task = require("./src/models/Task");
const notificationPersistenceService = require("./src/services/notificationPersistenceService");
const Bill = require("./src/models/Bill");

const seed = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not found in env");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  try {
    // 1. Create Priest User
    const priestEmail = "rama@gmail.com";
    let priest = await User.findOne({ email: priestEmail });
    if (!priest) {
      console.log("Creating priest user...");
      const hashedPassword = await bcrypt.hash("123456", 10);
      priest = await User.create({
        name: "Sri Ramakrishna Shastri",
        email: priestEmail,
        password: hashedPassword,
        role: "priest",
        phone: "+91 98765 43210",
        address: "Quarter No. 4, Mandir Quarters, Devagiri",
        place: "Devagiri",
        mustChangePassword: false,
        provider: "local",
      });
      console.log("Priest user created successfully:", priestEmail);
    } else {
      console.log("Priest user already exists:", priestEmail);
      // Ensure the role is priest
      if (priest.role !== "priest") {
        priest.role = "priest";
        await priest.save();
        console.log("Updated existing user role to priest.");
      }
    }

    const priestId = priest._id;

    // Remove existing bookings/tasks assigned to this priest to start fresh for test
    await Booking.deleteMany({ assignedPriest: priestId });
    await Task.deleteMany({ staffId: priestId.toString() });

    // Dates helper
    const today = new Date();
    const formatISODate = (hours, minutes, daysOffset = 0) => {
      const d = new Date(today);
      d.setDate(d.getDate() + daysOffset);
      d.setHours(hours, minutes, 0, 0);
      return d.toISOString();
    };

    console.log("Seeding Bookings...");
    // 2. Seed bookings for today
    const bookingsData = [
      {
        devoteeName: "Venkatesh Kumar",
        devoteeEmail: "venkatesh@gmail.com",
        service: "Suprabhatam",
        datetime: formatISODate(6, 0), // Today 06:00 AM
        amount: 250,
        status: "Completed",
        assignedPriest: priestId,
      },
      {
        devoteeName: "Lakshmi Devi",
        devoteeEmail: "lakshmi@gmail.com",
        service: "Abhishekam",
        datetime: formatISODate(7, 30), // Today 07:30 AM
        amount: 500,
        status: "Completed",
        assignedPriest: priestId,
      },
      {
        devoteeName: "Ravi Shankar",
        devoteeEmail: "ravi@gmail.com",
        service: "Archana",
        datetime: formatISODate(9, 0), // Today 09:00 AM
        amount: 100,
        status: "Completed",
        assignedPriest: priestId,
      },
      {
        devoteeName: "Meera Iyer",
        devoteeEmail: "meera@gmail.com",
        service: "Special Seva",
        datetime: formatISODate(10, 30), // Today 10:30 AM
        amount: 1500,
        status: "Completed",
        assignedPriest: priestId,
      },
      {
        devoteeName: "Suresh Babu",
        devoteeEmail: "suresh@gmail.com",
        service: "Homa",
        datetime: formatISODate(12, 0), // Today 12:00 PM
        amount: 2500,
        status: "Completed",
        assignedPriest: priestId,
      },
      {
        devoteeName: "Anjali Sharma",
        devoteeEmail: "anjali@gmail.com",
        service: "Archana",
        datetime: formatISODate(16, 30), // Today 04:30 PM
        amount: 100,
        status: "Completed",
        assignedPriest: priestId,
      },
      // Upcoming future bookings (Tomorrow)
      {
        devoteeName: "Ramesh Kumar",
        devoteeEmail: "ramesh@gmail.com",
        service: "Abhishekam",
        datetime: formatISODate(7, 30, 1), // Tomorrow 07:30 AM
        amount: 500,
        status: "Completed",
        assignedPriest: priestId,
      },
      {
        devoteeName: "Sita Mahalakshmi",
        devoteeEmail: "sita@gmail.com",
        service: "Special Seva",
        datetime: formatISODate(10, 30, 2), // Day after tomorrow 10:30 AM
        amount: 1500,
        status: "Completed",
        assignedPriest: priestId,
      },
      // Completed historical bookings
      {
        devoteeName: "Krishna Prasad",
        devoteeEmail: "krishna@gmail.com",
        service: "Homa",
        datetime: formatISODate(12, 0, -1), // Yesterday 12:00 PM
        amount: 2500,
        status: "Completed",
        assignedPriest: priestId,
      },
    ];

    const createdBookings = await Booking.create(bookingsData);
    console.log("Bookings seeded successfully.");

    // Seed corresponding Bills
    console.log("Seeding Bills for Bookings...");
    await Bill.deleteMany({ billType: "Pooja Booking" });
    const billsData = createdBookings.map((b) => ({
      devoteeName: b.devoteeName,
      sevaType: b.service,
      amount: b.amount,
      paymentMode: "UPI",
      billType: "Pooja Booking",
      referenceNo: `BK-${String(b._id).slice(-6).toUpperCase()}`,
      sourceId: b._id.toString(),
      status: b.status === "Pending" ? "Pending" : "Paid",
      billDate: b.createdAt || b.datetime || new Date(),
    }));
    await Bill.create(billsData);
    console.log("Bills for seeded Bookings created successfully.");

    console.log("Seeding Seva Duties (Tasks)...");
    const todayDateKey = today.toISOString().slice(0, 10);
    const tasksData = [
      {
        assignmentType: "Duty & Shift",
        staffId: priestId.toString(),
        staffName: "Sri Ramakrishna Shastri",
        staffEmail: priestEmail,
        dateKey: todayDateKey,
        title: "Morning Alankaram",
        description: "Decorate the deity and prepare for morning poojas",
        dutyName: "Morning Alankaram",
        duty: "Morning Alankaram",
        area: "Sanctum",
        time: "05:30 AM",
        assignedBy: "Admin",
        status: "Completed",
      },
      {
        assignmentType: "Duty & Shift",
        staffId: priestId.toString(),
        staffName: "Sri Ramakrishna Shastri",
        staffEmail: priestEmail,
        dateKey: todayDateKey,
        title: "Pooja & Archana",
        description: "Perform scheduled poojas and archana",
        dutyName: "Pooja & Archana",
        duty: "Pooja & Archana",
        area: "Main Hall",
        time: "06:00 AM - 01:00 PM",
        assignedBy: "Admin",
        status: "In Progress",
      },
      {
        assignmentType: "Duty & Shift",
        staffId: priestId.toString(),
        staffName: "Sri Ramakrishna Shastri",
        staffEmail: priestEmail,
        dateKey: todayDateKey,
        title: "Homa Preparation",
        description: "Prepare homa items and perform rituals",
        dutyName: "Homa Preparation",
        duty: "Homa Preparation",
        area: "Yagashala",
        time: "03:30 PM",
        assignedBy: "Admin",
        status: "Pending",
      },
      {
        assignmentType: "Duty & Shift",
        staffId: priestId.toString(),
        staffName: "Sri Ramakrishna Shastri",
        staffEmail: priestEmail,
        dateKey: todayDateKey,
        title: "Evening Deeparadhana",
        description: "Conduct evening aarti and deeparadhana",
        dutyName: "Evening Deeparadhana",
        duty: "Evening Deeparadhana",
        area: "Sanctum",
        time: "06:00 PM",
        assignedBy: "Admin",
        status: "Pending",
      },
    ];

    await Task.create(tasksData);
    console.log("Seva Duties seeded successfully.");

    // 4. Seed notifications/announcements
    console.log("Checking Announcements...");
    const announcementsCount = await notificationPersistenceService.countDocuments({
      $or: [{ audienceRole: "priest" }, { audienceRole: "staff" }],
    });
    if (announcementsCount === 0) {
      console.log("Seeding announcements/notifications...");
      const notificationsData = [
        {
          title: "Brahmotsavam 2025",
          message: "Brahmotsavam will begin from 20 May to 28 May 2025. All priests please check the duty schedule.",
          audienceRole: "priest",
          category: "festival",
        },
        {
          title: "Special Pooja Coordination",
          message: "Rudrabhishekam on 15 May 2025 at 08:00 AM. All required items are prepared.",
          audienceRole: "priest",
          category: "event",
        },
        {
          title: "General Priest Meeting",
          message: "Priest meeting on 16 May 2025 at 05:00 PM in the conference hall.",
          audienceRole: "priest",
          category: "meeting",
        },
      ];
      await notificationPersistenceService.create(notificationsData);
      console.log("Announcements seeded successfully.");
    }

    console.log("Seeding completed successfully! Priest credentials: priest@gmail.com / password123");
  } catch (error) {
    console.error("Error seeding data:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
};

seed();
