const Booking = require("../models/Booking");
const Donation = require("../models/Donation");
const Notification = require("../models/Notification");
const Event = require("../models/Event");
const SupportRequest = require("../models/SupportRequest");
const User = require("../models/User");
const PrasadamOrder = require("../models/PrasadamOrder");
const Prasadam = require("../models/Prasadam");
const Bill = require("../models/Bill");
const { isDbConnected } = require("../config/db");
const fileUserStore = require("../store/fileUserStore");
const fileBookingStore = require("../store/fileBookingStore");
const fileDonationStore = require("../store/fileDonationStore");
const fileNotificationStore = require("../store/fileNotificationStore");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const {
  createStaffBroadcastNotifications,
  createEmployeeBroadcastNotifications,
  createBroadcastNotifications,
  createStaffNotification,
} = require("../utils/notificationService");
const { sendBookingConfirmation, sendDonationReceipt, sendPrasadamOrderConfirmation } = require("../utils/communicationService");
const { buildEmailLookup, normalizeEmail } = require("../utils/email");
const { recordTransaction } = require("../services/accountingService");
// Prasadam Order persistence is additive: the shared service selects
// PostgreSQL when the Prasadam Order path is explicitly used and PostgreSQL is
// reachable, and otherwise falls back to the existing Mongoose model.
const prasadamOrderService = require("../services/prasadamOrderService");
const InventoryRequest = require("../models/InventoryRequest");
const InventoryItem = require("../models/InventoryItem");
const Employee = require("../models/Employee");
const Pooja = require("../models/Pooja");

const generateInventoryRequestsForBooking = async (booking) => {
  try {
    const items = booking.isCombined ? (booking.items || []) : [{
      type: "pooja",
      name: booking.service,
      selectedTempleMaterials: booking.selectedTempleMaterials || []
    }];
    
    let needsBookingUpdate = false;

    for (const item of items) {
      if (item.type === "pooja") {
        const pooja = await Pooja.findOne({ name: item.name }).populate("requiredMaterials.item");
        if (!pooja) continue;
        
        // Find materials that the temple must provide (either implicitly or chosen by devotee)
        for (const reqMat of pooja.requiredMaterials) {
          if (reqMat.materialSource !== "TEMPLE_INVENTORY") continue;
          if (!reqMat.item) continue;

          const isTempleProvides = reqMat.responsibilityType === "TEMPLE_PROVIDES";
          const isDevoteeSelected = reqMat.responsibilityType === "DEVOTEE_OR_TEMPLE" && 
                                    item.selectedTempleMaterials && 
                                    item.selectedTempleMaterials.includes(reqMat.item._id.toString());
          const isAdvanceCollection = reqMat.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" && reqMat.requiresAdvanceCollection;
          
          if (isTempleProvides || isDevoteeSelected || isAdvanceCollection) {
            // Check stock availability
            const invItem = await InventoryItem.findById(reqMat.item._id);
            if (invItem && invItem.availableStock < reqMat.qty) {
              await createStaffNotification({
                title: `Low Stock Alert: ${invItem.name}`,
                message: `Insufficient stock for upcoming Pooja Booking (${booking.service}). Required: ${reqMat.qty}, Available: ${invItem.availableStock}`,
                audienceRole: "admin",
                category: "inventory",
              }).catch(() => {});
            }

            // Check if this material is already in templeMaterialRequests
            const existingReq = booking.templeMaterialRequests.find(tmr => 
              tmr.item && tmr.item.toString() === reqMat.item._id.toString()
            );

            if (existingReq && !existingReq.inventoryRequestId) {
              let reasonLabel = isAdvanceCollection ? "Advance Devotee Collection" : `System generated for Pooja Booking: ${item.name}`;
              
              const invReq = await InventoryRequest.create({
                userId: booking.createdBy || booking.devoteeEmail || "System",
                userName: `${booking.devoteeName} (Online Pooja Booking)`,
                role: "System",
                itemName: reqMat.item.name,
                quantity: reqMat.qty,
                unit: reqMat.unit,
                reason: reasonLabel,
                purpose: `Pooja Booking: ${item.name}`,
                expectedDate: booking.datetime || new Date(),
                status: "Pending",
              });
              
              existingReq.inventoryRequestId = invReq._id;
              needsBookingUpdate = true;
            }
          }
        }
      }
    }
    
    if (needsBookingUpdate) {
      await booking.save();
    }
  } catch (err) {
    console.error("Failed to generate inventory requests:", err);
  }
};

const PRASADAM_MENU = {
  "Laddu Prasadam": 151,
  "Panchamrit Prasadam": 101,
  "Pulihora Prasadam": 121,
  "Sweet Pongal Prasadam": 131,
  "Curd Rice Prasadam": 111,
};

const normalizeBookingEmails = (booking) => ({
  ...booking,
  devoteeEmail: normalizeEmail(booking.devoteeEmail),
});

const normalizeDonationEmails = (donation) => ({
  ...donation,
  donorEmail: normalizeEmail(donation.donorEmail),
});

const normalizeOrderEmails = (order) => ({
  ...order,
  email: normalizeEmail(order.email),
});

const createLedgerBill = async ({
  devoteeName,
  sevaType,
  amount,
  paymentMode,
  billType,
  referenceNo,
  sourceId,
  notes,
  status = "Paid",
}) => {
  try {
    return await Bill.create({
      devoteeName,
      sevaType,
      amount,
      paymentMode,
      billType,
      referenceNo,
      sourceId,
      notes,
      status,
    });
  } catch (error) {
    console.warn("Failed to create bill ledger entry:", error.message);
    return null;
  }
};

const getBookings = async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    let bookings;
    if (isDbConnected()) {
      bookings = email
        ? await Booking.find(buildEmailLookup("devoteeEmail", email)).sort({ createdAt: -1 })
        : await Booking.find().sort({ createdAt: -1 });
    } else {
      bookings = await fileBookingStore.findBookings({ devoteeEmail: email });
    }
    return res.status(200).json({ bookings: bookings.map((booking) => normalizeBookingEmails(booking.toObject ? booking.toObject() : booking)) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load bookings." });
  }
};



const createBooking = async (req, res) => {
  try {
    const { devoteeName, devoteeEmail, devoteePhone, service, datetime, amount, contactNumber, notes, devoteeId, eventId, paymentMethod, assignedPriest, isCombined, items, transactionId } = req.body;
    const normalizedDevoteeEmail = normalizeEmail(devoteeEmail);

    if (!devoteeName || !service || !datetime || amount == null) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }

    // Validate amount
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Booking amount must be a positive number." });
    }

    // Validate datetime is a future time
    const parsed = new Date(datetime);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return res.status(400).json({ error: "Booking datetime must be a future date/time." });
    }

    const allowedPaymentMethods = ["UPI", "Cash", "Card", "Bank Transfer", "Net Banking"];
    const pm = paymentMethod && String(paymentMethod).trim() ? String(paymentMethod).trim() : undefined;
    if (pm && !allowedPaymentMethods.includes(pm)) {
      return res.status(400).json({ error: "Invalid payment method." });
    }

    const hasKeys = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
    const isOnline = pm && pm !== "Cash";
    const bookingStatus = "Confirmed";
    const paymentStatus = "Paid";

    let booking;
    let priestName = "";
    
    // Resolve templeMaterialRequests and Approval requirements
    let templeMaterialRequests = [];
    let templeApprovalRequired = false;
    let materialStatus = "N/A";

    const allItems = isCombined ? (items || []) : [{
      type: "pooja",
      name: service,
      selectedTempleMaterials: req.body.selectedTempleMaterials || []
    }];

    // Snapshots
    let poojaDuration = "";
    let poojaRules = [];
    let poojaDressCode = "";
    let priestInstructions = [];
    let preparationInstructions = [];
    let snapshotMaterials = [];

    for (const item of allItems) {
      if (item.type === "pooja") {
        const pooja = await Pooja.findOne({ name: item.name }).populate("requiredMaterials.item");
          if (pooja) {
            if (pooja.duration) poojaDuration = poojaDuration ? `${poojaDuration} + ${pooja.duration}` : pooja.duration;
            if (pooja.rules && pooja.rules.length > 0) {
              pooja.rules.forEach(rule => {
                if (!poojaRules.includes(rule)) poojaRules.push(rule);
              });
            }
            if (pooja.dressCode && !poojaDressCode.includes(pooja.dressCode)) {
              poojaDressCode = poojaDressCode ? `${poojaDressCode} | ${pooja.dressCode}` : pooja.dressCode;
            }
            if (pooja.priestInstructions) priestInstructions.push(pooja.priestInstructions);
            
            const minAdvanceDays = pooja.minimumAdvanceBookingDays || 0;
            let maxPrepDays = 0;
            let hasMaterials = false;
            
            for (const reqMat of pooja.requiredMaterials) {
              snapshotMaterials.push({
                itemName: reqMat.itemName,
                qty: reqMat.qty,
                unit: reqMat.unit,
                responsibilityType: reqMat.responsibilityType,
                materialSource: reqMat.materialSource,
                mandatory: reqMat.mandatory
              });

              if (reqMat.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED") {
                maxPrepDays = Math.max(maxPrepDays, reqMat.preparationDaysBeforePooja || 0);
                if (reqMat.preparationInstructions) {
                  preparationInstructions.push(reqMat.preparationInstructions);
                }
              }
              
              if (reqMat.materialSource === "TEMPLE_INVENTORY" && reqMat.item) {
                const isTempleProvides = reqMat.responsibilityType === "TEMPLE_PROVIDES";
                const isDevoteeSelected = reqMat.responsibilityType === "DEVOTEE_OR_TEMPLE" && 
                                          item.selectedTempleMaterials && 
                                          item.selectedTempleMaterials.includes(reqMat.item._id.toString());
                const isAdvanceCollection = reqMat.responsibilityType === "DEVOTEE_PREPARATION_REQUIRED" && reqMat.requiresAdvanceCollection;
                
                if (isTempleProvides || isDevoteeSelected || isAdvanceCollection) {
                  templeMaterialRequests.push({
                    item: reqMat.item._id,
                    itemName: reqMat.item.name,
                    qty: `${reqMat.qty} ${reqMat.unit}`
                  });
                  hasMaterials = true;
                }
              }
            }
            if (hasMaterials) {
               materialStatus = "Pending";
            }

          // Server-side validation of advance booking days
          const effectiveMinDays = Math.max(minAdvanceDays, maxPrepDays);
          if (effectiveMinDays > 0) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dateToUse = (isCombined && item.date) ? item.date : datetime;
            const selectedDate = new Date(dateToUse);
            selectedDate.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil(Math.abs(selectedDate - today) / (1000 * 60 * 60 * 24));
            
            if (diffDays < effectiveMinDays) {
              if (pooja.strictAdvancePreparation) {
                return res.status(400).json({ error: `This Pooja requires at least ${effectiveMinDays} days of advance notice/preparation.` });
              } else {
                templeApprovalRequired = true;
              }
            }
          }
          
          if (pooja.strictAdvancePreparation && templeApprovalRequired) {
             // In case there was some other reason
          }
        }
      }
    }

    let finalAssignedPriest = assignedPriest;
    if (!finalAssignedPriest && isDbConnected()) {
      // Find eligible priests
      const poojaDoc = await Pooja.findOne({ name: service });
      if (poojaDoc) {
        const eligiblePriests = await Employee.find({ 
          role: "priest", 
          status: "Active",
          eligiblePoojas: poojaDoc._id 
        });
        if (eligiblePriests.length === 1) {
          finalAssignedPriest = eligiblePriests[0]._id.toString();
          priestName = eligiblePriests[0].name;
        } else if (eligiblePriests.length > 0) {
           // Keep unassigned for manual admin assignment
        }
      }
    } else if (finalAssignedPriest && isDbConnected()) {
      const priestEmp = await Employee.findById(finalAssignedPriest);
      if (priestEmp) priestName = priestEmp.name;
    }

    const bookingPayload = {
      devoteeId: devoteeId || undefined,
      eventId: eventId || undefined,
      devoteeName,
      devoteeEmail: normalizedDevoteeEmail || undefined,
      devoteePhone: devoteePhone || contactNumber,
      service,
      datetime,
      amount: numericAmount,
      paymentMethod: pm || undefined,
      status: bookingStatus,
      paymentStatus: paymentStatus,
      transactionId: transactionId || undefined,
      contactNumber,
      notes,
      assignedPriest: finalAssignedPriest || undefined,
      priestName: priestName || undefined,
      isCombined: isCombined || false,
      items: items || [],
      selectedTempleMaterials: req.body.selectedTempleMaterials || [],
      templeMaterialRequests,
      materialStatus,
      templeApprovalRequired,
      preparationAcknowledged: true,
      
      // Snapshots
      poojaDuration,
      poojaRules,
      poojaDressCode,
      snapshotMaterials,
      priestInstructions: priestInstructions.join("\n"),
      preparationInstructions: preparationInstructions.join("\n"),
      source: "Online Portal",
    };

    if (isDbConnected()) {
      booking = await Booking.create(bookingPayload);
    } else {
      booking = await fileBookingStore.createBooking(bookingPayload);
    }

    await createLedgerBill({
      devoteeName,
      sevaType: service,
      amount: numericAmount,
      paymentMode: pm || paymentMethod || "Cash",
      billType: "Pooja Booking",
      referenceNo: `BK-${String(booking._id).slice(-6).toUpperCase()}`,
      sourceId: booking._id.toString(),
      source: "Online Portal",
      notes,
      status: bookingStatus === "Confirmed" ? "Paid" : "Pending",
    });

    if (hasKeys && isOnline) {
      const razorpayClient = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const orderOptions = {
        amount: Math.round(numericAmount * 100),
        currency: "INR",
        receipt: `booking_${Date.now()}`,
        payment_capture: 1,
      };

      const order = await razorpayClient.orders.create(orderOptions);
      booking.razorpayOrderId = order.id;
      await booking.save();

      return res.status(201).json({
        booking: normalizeBookingEmails(booking.toObject ? booking.toObject() : booking),
        order,
        key: process.env.RAZORPAY_KEY_ID || "",
        simulated: false,
      });
    }

    // Direct / Simulated Confirmations
    // Send notification
    await createStaffNotification({
      title: "Booking Confirmed",
      message: `Your ${service} booking has been confirmed successfully.`,
      audienceEmail: normalizedDevoteeEmail || undefined,
      category: "booking",
    }).catch(() => {});

    // Also notify the cashier role
    await createStaffNotification({
      title: `📅 Pooja Booking: ${service}`,
      message: `New booking for "${devoteeName}" — ${service} — ₹${numericAmount} (${pm || "Cash"}) is recorded.`,
      audienceRole: "cashier",
      category: "booking",
    }).catch(() => {});

    // Send multi-channel notifications (Email & SMS) if devotee info is available
    if (devoteeEmail || devoteePhone || contactNumber) {
      const devotee = { name: devoteeName, email: normalizedDevoteeEmail, phone: devoteePhone || contactNumber };
      sendBookingConfirmation(devotee, {
        service,
        datetime,
        amount: numericAmount,
        status: bookingStatus,
      }).catch((err) => console.warn("Failed to send booking confirmation:", err.message));
    }

    // If this booking is linked to an event and already confirmed, update event aggregates
    if (eventId && booking.status === "Confirmed") {
      try {
        if (isDbConnected()) {
          await Event.findByIdAndUpdate(String(eventId), {
            $inc: { registrations: 1, collection: Number(amount) || 0 },
          });
          booking.counted = true;
          await booking.save();
        } else {
          // Local/Mock file fallback for event
          booking.counted = true;
          await fileBookingStore.findByIdAndUpdate(booking._id, { counted: true });
        }
      } catch (err) {
        console.error("Failed to update event aggregates for booking:", err);
      }
    }

    if (isDbConnected() && paymentStatus === "Paid") {
      try {
        if (isCombined && items && items.length > 0) {
          for (const item of items) {
            let cat = "Pooja Income";
            let src = "Pooja Booking";
            if (item.type === "Room" || item.type === "Accommodation") {
              cat = "Room Income";
              src = "Room Booking";
            } else if (item.type === "Prasadam") {
              cat = "Prasadam Income";
              src = "Prasadam";
            }

            await recordTransaction({
              transactionType: "Credit",
              source: src,
              category: cat,
              amount: Number(item.price) * (item.quantity || 1) || item.amount || 0,
              paymentMethod: pm || "Cash",
              status: "Completed",
              description: `Combined Offline: ${item.name || item.service || src} for ${devoteeName}`,
              referenceId: booking._id,
              referenceModel: "PoojaBooking",
              recordedBy: req.user ? req.user.id : null,
            });
          }
        } else {
          await recordTransaction({
            transactionType: "Credit",
            source: "Pooja Booking",
            category: "Pooja Income",
            amount: numericAmount,
            paymentMethod: pm || "Cash",
            status: "Completed",
            description: `Pooja Booking: ${service} for ${devoteeName}`,
            referenceId: booking._id,
            referenceModel: "PoojaBooking",
            recordedBy: req.user ? req.user.id : null,
          });
        }
      } catch (err) {
        console.error("Failed to record accounting transaction:", err);
      }
      
      // Generate InventoryRequests if items have selectedTempleMaterials
      await generateInventoryRequestsForBooking(booking);
    }

    return res.status(201).json({
      booking: normalizeBookingEmails(booking.toObject ? booking.toObject() : booking),
      simulated: true,
    });
  } catch (error) {
    console.error("createBooking error:", error);
    return res.status(500).json({ error: "Unable to create booking. Details: " + (error.message || error) });
  }
};

const verifyBookingPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields." });
    }

    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "").update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature." });
    }

    let booking = null;
    if (bookingId) booking = await Booking.findById(bookingId);
    if (!booking) booking = await Booking.findOne({ razorpayOrderId: razorpay_order_id });
    if (!booking) return res.status(404).json({ error: "Booking not found for this order." });

    booking.status = "Confirmed";
    booking.paymentStatus = "Paid";
    booking.transactionId = razorpay_payment_id;
    booking.razorpayPaymentId = razorpay_payment_id;
    booking.razorpaySignature = razorpay_signature;
    await booking.save();

    await Bill.updateMany(
      { sourceId: booking._id.toString() },
      { status: "Paid" }
    );

    // If booking linked to an event, increment registrations and collection
    if (booking.eventId && !booking.counted) {
      try {
        await Event.findByIdAndUpdate(String(booking.eventId), {
          $inc: { registrations: 1, collection: Number(booking.amount) || 0 }
        });
        booking.counted = true;
        await booking.save();
      } catch (err) {
        console.error("Failed to update event collection from verifyBookingPayment:", err);
      }
    }

    // Send notifications
    try {
      await createStaffNotification({
        title: "Booking Confirmed",
        message: `Your ${booking.service} booking has been confirmed successfully.`,
        audienceEmail: booking.devoteeEmail || undefined,
        category: "booking",
      });

      await createStaffNotification({
        title: `📅 Pooja Booking: ${booking.service}`,
        message: `New booking for "${booking.devoteeName}" — ${booking.service} — ₹${booking.amount} (${booking.paymentMethod || "UPI"}) is recorded.`,
        audienceRole: "cashier",
        category: "booking",
      });

      if (booking.devoteeEmail || booking.devoteePhone || booking.contactNumber) {
        const devotee = { name: booking.devoteeName, email: booking.devoteeEmail, phone: booking.devoteePhone || booking.contactNumber };
        sendBookingConfirmation(devotee, {
          service: booking.service,
          datetime: booking.datetime,
          amount: booking.amount,
          status: "Confirmed",
        }).catch((err) => console.warn("Failed to send booking confirmation:", err.message));
      }
    } catch (notifErr) {
      console.warn("Notification after booking verify failed:", notifErr);
    }

    if (isDbConnected() && booking.paymentStatus === "Paid") {
      try {
        if (booking.isCombined && booking.items && booking.items.length > 0) {
          for (const item of booking.items) {
            let cat = "Pooja Income";
            let src = "Pooja Booking";
            if (item.type === "Room" || item.type === "Accommodation") {
              cat = "Room Income";
              src = "Room Booking";
            } else if (item.type === "Prasadam") {
              cat = "Prasadam Income";
              src = "Prasadam";
            }

            await recordTransaction({
              transactionType: "Credit",
              source: src,
              category: cat,
              amount: Number(item.price) * (item.quantity || 1) || item.amount || 0,
              paymentMethod: booking.paymentMethod || "Bank Transfer",
              status: "Completed",
              description: `Combined: ${item.name || item.service || src} for ${booking.devoteeName} (${razorpay_payment_id})`,
              referenceId: booking._id,
              referenceModel: "PoojaBooking",
              recordedBy: req.user ? req.user.id : null,
            });
          }
        } else {
          await recordTransaction({
            transactionType: "Credit",
            source: "Pooja Booking",
            category: "Pooja Income",
            amount: booking.amount,
            paymentMethod: booking.paymentMethod || "Bank Transfer",
            status: "Completed",
            description: `Online Pooja Booking: ${booking.service} for ${booking.devoteeName} (${razorpay_payment_id})`,
            referenceId: booking._id,
            referenceModel: "PoojaBooking",
            recordedBy: req.user ? req.user.id : null,
          });
        }
      } catch (err) {
        console.error("Failed to record accounting transaction:", err);
      }
      
      // Generate InventoryRequests if items have selectedTempleMaterials
      await generateInventoryRequestsForBooking(booking);
    }

    return res.status(200).json({ success: true, booking: normalizeBookingEmails(booking.toObject ? booking.toObject() : booking) });
  } catch (error) {
    console.error("verifyBookingPayment error:", error);
    return res.status(500).json({ error: "Failed to verify booking payment." });
  }
};

const getDonations = async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    let donations;
    if (isDbConnected()) {
      donations = email
        ? await Donation.find(buildEmailLookup("donorEmail", email)).sort({ createdAt: -1 })
        : await Donation.find().sort({ createdAt: -1 });
    } else {
      donations = await fileDonationStore.findDonations({ donorEmail: email });
    }
    return res.status(200).json({ donations: donations.map((donation) => normalizeDonationEmails(donation.toObject ? donation.toObject() : donation)) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load donations." });
  }
};

const createDonation = async (req, res) => {
  try {
    const {
      donorName,
      donorEmail,
      donorPhone,
      amount,
      category = "General",
      paymentMethod = "UPI",
      contactNumber,
      transactionId,
      notes,
      donatedBy,
      eventId,
    } = req.body;
    const normalizedDonorEmail = normalizeEmail(donorEmail);

    if (!donorName || amount == null) {
      return res.status(400).json({ error: "donorName and amount are required." });
    }

    const numericAmount = Number(String(amount).replace(/[^0-9.-]+/g, ""));
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Donation amount must be a positive number." });
    }

    if (contactNumber && !/^\+?[0-9\s-]{7,15}$/.test(contactNumber.trim())) {
      return res.status(400).json({ error: "Please provide a valid contact number." });
    }

    const hasKeys = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
    const isOnline = paymentMethod && paymentMethod !== "Cash";
    
    // For online payments, wait for razorpay webhook. For offline (Cash), it's immediately collected/paid.
    const donationStatus = (hasKeys && isOnline) ? "Not Collected" : "Collected";
    const paymentStatus = (hasKeys && isOnline) ? "Pending" : "Paid";

    let donation;
    const donationPayload = {
      donorName: donorName.trim(),
      donorEmail: normalizedDonorEmail || undefined,
      donorPhone: donorPhone || contactNumber,
      amount: numericAmount,
      category,
      paymentMethod,
      contactNumber,
      transactionId: (hasKeys && isOnline) ? undefined : transactionId,
      notes,
      status: donationStatus,
      eventId: eventId || undefined,
      donatedBy: donatedBy || undefined,
    };

    if (isDbConnected()) {
      donation = await Donation.create(donationPayload);
    } else {
      donation = await fileDonationStore.createDonation(donationPayload);
    }

    await createLedgerBill({
      devoteeName: donorName.trim(),
      sevaType: category,
      amount: numericAmount,
      paymentMode: paymentMethod || "UPI",
      billType: "Donation",
      referenceNo: `DN-${String(donation._id).slice(-6).toUpperCase()}`,
      sourceId: donation._id.toString(),
      notes,
      status: (donationStatus === "Completed" || donationStatus === "Collected") ? "Paid" : "Pending",
    });

    if (hasKeys && isOnline) {
      const razorpayClient = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const orderOptions = {
        amount: Math.round(numericAmount * 100),
        currency: "INR",
        receipt: `donation_${Date.now()}`,
        payment_capture: 1,
      };

      const order = await razorpayClient.orders.create(orderOptions);
      donation.razorpayOrderId = order.id;
      await donation.save();

      return res.status(201).json({
        donation: normalizeDonationEmails(donation.toObject ? donation.toObject() : donation),
        order,
        key: process.env.RAZORPAY_KEY_ID || "",
        simulated: false,
      });
    } else if (isDbConnected() && paymentStatus === "Paid") {
      // Offline paid donation
      await recordTransaction({
        transactionType: "Credit",
        source: "Donation",
        category: "Donation Income",
        amount: numericAmount,
        paymentMethod: paymentMethod || "Cash",
        status: "Completed",
        description: `Donation: ${category} by ${donorName}`,
        referenceId: donation._id,
        referenceModel: "Donation",
        recordedBy: req.user ? req.user.id : null,
      });
    }

    // Direct / Simulated Completed Donation
    await createStaffNotification({
      title: "Donation Received",
      message: `${donorName.trim()} donated INR ${numericAmount} for ${category}.`,
      audienceEmail: normalizedDonorEmail || undefined,
    }).catch(() => {});

    // Also notify the cashier role
    await createStaffNotification({
      title: `💖 Donation Received`,
      message: `${donorName.trim()} donated ₹${numericAmount} for ${category} (${paymentMethod || "UPI"}).`,
      audienceRole: "cashier",
      category: "donation",
    }).catch(() => {});

    // Send multi-channel notifications (Email & SMS) if donor info is available
    if (donorEmail || donorPhone || contactNumber) {
      const donor = { name: donorName.trim(), email: normalizedDonorEmail, phone: donorPhone || contactNumber };
      await sendDonationReceipt(donor, {
        amount: numericAmount,
        category,
        transactionId: transactionId || "N/A",
      }).catch((err) => console.warn("Failed to send donation receipt:", err.message));
    }

    // If donation is linked to an event, increment the event's collection
    if (eventId) {
      try {
        if (isDbConnected()) {
          await Event.findByIdAndUpdate(String(eventId), { $inc: { collection: numericAmount } });
        }
      } catch (err) {
        console.error("Failed to update event collection for donation:", err);
      }
    }

    return res.status(201).json({
      donation: normalizeDonationEmails(donation.toObject ? donation.toObject() : donation),
      simulated: true,
    });
  } catch (error) {
    console.error("createDonation error:", error);
    return res.status(500).json({ error: "Unable to create donation." });
  }
};

const getNotifications = async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    
    if (isDbConnected()) {
      if (email) {
        let user = await User.findOne(buildEmailLookup("email", email)).select("_id role").lean();
        const userId = user?._id?.toString?.() || user?.id;

        const filters = [
          buildEmailLookup("audienceEmail", email),
          // General broadcast announcements that are not addressed to an individual devotee
          {
            audienceRole: { $in: ["devotee", "all"] },
            audienceEmail: { $in: [null, "", undefined] },
            audienceId: { $in: [null, "", undefined] },
          },
        ];

        if (userId) {
          filters.push({ audienceId: userId });
        }

        const notifications = await Notification.find({
          $or: filters,
        }).sort({ createdAt: -1 });
        return res.status(200).json({ notifications });
      }

      // No email provided: return only general broadcasts
      const notifications = await Notification.find({
        audienceRole: { $in: ["devotee", "all"] },
        audienceEmail: { $in: [null, "", undefined] },
        audienceId: { $in: [null, "", undefined] },
      }).sort({ createdAt: -1 });
      return res.status(200).json({ notifications });
    } else {
      // Offline/Local file fallback
      const notifications = await fileNotificationStore.findNotifications({ audienceEmail: email });
      return res.status(200).json({ notifications });
    }
  } catch (error) {
    return res.status(500).json({ error: "Failed to load notifications." });
  }
};

const getProfile = async (req, res) => {
  try {
    if (req.query.email) {
      const normalizedEmail = normalizeEmail(req.query.email);
      let user = null;
      if (isDbConnected()) {
        user = await User.findOne(buildEmailLookup("email", normalizedEmail)).select("-password");
      } else {
        user = await fileUserStore.findUserByEmail(normalizedEmail);
      }
      if (user) {
        const getYear = (dateVal) => {
          if (!dateVal) return "2025";
          const d = new Date(dateVal);
          return Number.isNaN(d.getTime()) ? "2025" : String(d.getFullYear());
        };
        return res.status(200).json({
          profile: {
            id: user._id?.toString?.() || user.id,
            name: user.name,
            email: normalizeEmail(user.email),
            phone: user.phone || "",
            address: user.address || "",
            place: user.place || "",
            role: user.role || "devotee",
            memberSince: user.createdAt ? getYear(user.createdAt) : "2025",
          },
        });
      }
    }

    return res.status(200).json({
      profile: {
        name: "Devotee User",
        email: "devotee@example.com",
        phone: "",
        address: "",
        place: "",
        role: "devotee",
        memberSince: "2025",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load profile." });
  }
};

const getEvents = async (req, res) => {
  try {
    if (!isDbConnected()) {
      console.warn("getEvents: DB not connected, returning empty list");
      return res.status(200).json({ events: [] });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Automatically mark past events as Completed if they were marked Upcoming or Active
    await Event.updateMany(
      {
        date: { $lt: todayStart },
        status: { $in: ["Upcoming", "Active"] },
      },
      { $set: { status: "Completed" } }
    );

    const events = await Event.find().sort({ date: 1 });
    return res.status(200).json({ events });
  } catch (error) {
    console.error("getEvents error:", error);
    // fallback to empty list so frontend doesn't break
    return res.status(200).json({ events: [] });
  }
};

const validateFestivalDate = (dateValue) => {
  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Invalid festival date.";
  }
  const tomorrowStart = new Date();
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  parsedDate.setHours(0, 0, 0, 0);
  if (parsedDate < tomorrowStart) {
    return "Event date must be in the future (previous dates and today cannot be selected).";
  }
  return null;
};

const createEvent = async (req, res) => {
  try {
    const { title, date, endDate, location, description, imageUrl, slots, registrations, collection, status } = req.body;

    if (!title || !date || !location) {
      return res.status(400).json({ error: "title, date (From Date) and location are required." });
    }

    const dateError = validateFestivalDate(date);
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    if (endDate) {
      const parsedStartDate = new Date(date);
      const parsedEndDate = new Date(endDate);
      parsedStartDate.setHours(0, 0, 0, 0);
      parsedEndDate.setHours(0, 0, 0, 0);
      if (parsedEndDate < parsedStartDate) {
        return res.status(400).json({ error: "To Date cannot be before From Date." });
      }
    }

    const eventData = {
      title,
      date,
      endDate: endDate || date,
      location,
      description,
      image: imageUrl || undefined,
    };

    if (slots != null) eventData.slots = Number(slots) || 0;
    if (registrations != null) eventData.registrations = Number(registrations) || 0;
    if (collection != null) eventData.collection = Number(collection) || 0;
    if (status) eventData.status = status;

    const event = await Event.create(eventData);

    const formattedEventDate = new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    const eventAnnouncementMsg = description
      ? `A new temple event "${title}" has been scheduled on ${formattedEventDate} at ${location}.\n\n${description}`
      : `A new temple event "${title}" has been scheduled on ${formattedEventDate} at ${location}.`;

    // Send notifications along with banner to all employees
    await createEmployeeBroadcastNotifications({
      title: `New Event: ${title}`,
      message: eventAnnouncementMsg,
      category: "event",
      attachment: imageUrl || undefined,
    }).catch((err) => console.error("Employee event broadcast error:", err.message));

    // Send notifications along with banner to all registered devotees
    await createBroadcastNotifications({
      title: `New Event: ${title}`,
      message: eventAnnouncementMsg,
      category: "event",
      role: "devotee",
      attachment: imageUrl || undefined,
    }).catch((err) => console.error("Devotee event broadcast error:", err.message));

    return res.status(201).json({ event });
  } catch (error) {
    console.error("createEvent error:", error);
    return res.status(500).json({ error: "Failed to create event." });
  }
};

const getFestivalOverview = async (req, res) => {
  try {
    if (!isDbConnected()) {
      console.warn("getFestivalOverview: DB not connected, returning defaults");
      return res.status(200).json({
        upcomingFestivals: 0,
        todaysEvents: 0,
        currentMonthFestivals: 0,
        totalRegistrations: 0,
        festivalRevenue: 0,
        monthlyRegistrations: 0,
        monthlyRevenue: 0,
        dbConnected: false,
      });
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Automatically mark past events as Completed
    await Event.updateMany(
      {
        date: { $lt: todayStart },
        status: { $in: ["Upcoming", "Active"] },
      },
      { $set: { status: "Completed" } }
    );

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const upcomingFestivals = await Event.countDocuments({
      date: { $gte: todayStart },
      status: { $nin: ["Completed", "Cancelled"] },
    });
    const todaysEvents = await Event.countDocuments({ date: { $gte: todayStart, $lt: tomorrowStart } });

    // Current month range
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const nextMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 1);

    const currentMonthFestivals = await Event.countDocuments({ date: { $gte: monthStart, $lt: nextMonthStart } });

    // Aggregate totals overall
    const agg = await Event.aggregate([
      { $group: { _id: null, totalRegistrations: { $sum: "$registrations" }, totalCollection: { $sum: "$collection" } } },
    ]);

    let totalRegistrations = (agg[0] && agg[0].totalRegistrations) || 0;
    // Only use Event.collection for festival revenue — do not fall back to global bookings
    let festivalRevenue = (agg[0] && agg[0].totalCollection) || 0;

    // Monthly aggregates (prefer event collection/registrations if present)
    const monthAgg = await Event.aggregate([
      { $match: { date: { $gte: monthStart, $lt: nextMonthStart } } },
      { $group: { _id: null, monthRegistrations: { $sum: "$registrations" }, monthCollection: { $sum: "$collection" } } },
    ]);

    const monthlyRegistrations = (monthAgg[0] && monthAgg[0].monthRegistrations) || 0;
    const monthlyRevenue = (monthAgg[0] && monthAgg[0].monthCollection) || 0;

    // Fallback only for registrations (keep overall booking counts if events don't record registrations)
    if (!totalRegistrations) {
      totalRegistrations = await Booking.countDocuments();
    }

    return res.status(200).json({
      upcomingFestivals,
      todaysEvents,
      currentMonthFestivals,
      totalRegistrations,
      festivalRevenue,
      monthlyRegistrations,
      monthlyRevenue,
    });
  } catch (error) {
    console.error("getFestivalOverview error:", error);
    return res.status(200).json({
      upcomingFestivals: 0,
      todaysEvents: 0,
      currentMonthFestivals: 0,
      totalRegistrations: 0,
      festivalRevenue: 0,
      monthlyRegistrations: 0,
      monthlyRevenue: 0,
      dbConnected: false,
      error: "Failed to load festival overview",
    });
  }
};

const updateEventStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ["Upcoming", "Active", "Completed", "Cancelled"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status provided." });
    }

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ error: "Event not found." });

    event.status = status;
    await event.save();

    await Notification.create({
      title: "Event Status Updated",
      message: `${event.title} status changed to ${status}.`,
    });

    return res.status(200).json({ event });
  } catch (error) {
    console.error("updateEventStatus error:", error);
    return res.status(500).json({ error: "Failed to update event status." });
  }
};

const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      date,
      endDate,
      location,
      description,
      imageUrl,
      slots,
      registrations,
      collection,
      status,
    } = req.body;

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ error: "Event not found." });

    if (title && String(title).trim()) event.title = String(title).trim();
    if (date) {
      const dateError = validateFestivalDate(date);
      if (dateError) {
        return res.status(400).json({ error: dateError });
      }
      event.date = new Date(date);
    }
    if (endDate !== undefined) {
      if (endDate) {
        const parsedStartDate = new Date(date || event.date);
        const parsedEndDate = new Date(endDate);
        parsedStartDate.setHours(0, 0, 0, 0);
        parsedEndDate.setHours(0, 0, 0, 0);
        if (parsedEndDate < parsedStartDate) {
          return res.status(400).json({ error: "To Date cannot be before From Date." });
        }
        event.endDate = parsedEndDate;
      } else {
        event.endDate = event.date;
      }
    }
    if (location && String(location).trim()) event.location = String(location).trim();
    if (description != null) event.description = String(description || "").trim();
    if (imageUrl != null) event.image = imageUrl || undefined;
    if (slots != null) event.slots = Number(slots) || 0;
    if (registrations != null) event.registrations = Number(registrations) || 0;
    if (collection != null) event.collection = Number(collection) || 0;
    if (status && ["Upcoming", "Active", "Completed", "Cancelled"].includes(status)) event.status = status;

    await event.save();

    await Notification.create({
      title: "Event Updated",
      message: `${event.title} has been updated.`,
    });

    return res.status(200).json({ event });
  } catch (error) {
    console.error("updateEvent error:", error);
    return res.status(500).json({ error: "Failed to update event." });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findByIdAndDelete(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found." });
    }

    try {
      await Notification.create({
        title: "Event Deleted",
        message: `The event "${event.title}" has been deleted.`,
        category: "event",
        audienceRole: "devotee",
        broadcast: true,
      });
    } catch (notifErr) {
      console.warn("Failed to create deletion notification:", notifErr.message);
    }

    return res.status(200).json({ message: "Event deleted successfully.", event });
  } catch (error) {
    console.error("deleteEvent error:", error);
    return res.status(500).json({ error: "Failed to delete event." });
  }
};

const submitSupportRequest = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: "Please provide a subject and message." });
    }

    const supportRequest = await SupportRequest.create({
      name: name || "Anonymous Devotee",
      email: email || "support@devotee.com",
      subject,
      message,
    });

    await Notification.create({
      title: "New Support Request",
      message: `${supportRequest.name} raised: ${supportRequest.subject}`,
    });

    return res.status(201).json({ status: "success", message: "Support request received.", request: supportRequest });
  } catch (error) {
    return res.status(500).json({ error: "Failed to submit support request." });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { currentEmail, name, email, phone, address, place } = req.body;
    if (!currentEmail) {
      return res.status(400).json({ error: "currentEmail is required." });
    }
    const normalizedCurrentEmail = normalizeEmail(currentEmail);
    const normalizedUpdatedEmail = normalizeEmail(email);

    // Validate email format
    if (email) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(normalizedUpdatedEmail)) {
        return res.status(400).json({ error: "Please provide a valid email address." });
      }
    }

    // Validate phone number: strictly 10 digits
    if (phone) {
      const cleanedPhone = String(phone).trim();
      if (!/^[0-9]{10}$/.test(cleanedPhone)) {
        return res.status(400).json({ error: "Phone number must be strictly 10 digits (numbers only)." });
      }
    }

    // Validate place: characters and spaces only
    if (place) {
      const cleanedPlace = String(place).trim();
      if (!/^[a-zA-Z\s]+$/.test(cleanedPlace)) {
        return res.status(400).json({ error: "Place/City must contain characters only." });
      }
    }

    let user;
    const getYear = (dateVal) => {
      if (!dateVal) return "2025";
      const d = new Date(dateVal);
      return Number.isNaN(d.getTime()) ? "2025" : String(d.getFullYear());
    };

    if (isDbConnected()) {
      user = await User.findOne(buildEmailLookup("email", normalizedCurrentEmail));
      if (!user) {
        return res.status(404).json({ error: "Profile not found." });
      }

      if (name && String(name).trim()) user.name = String(name).trim();
      if (normalizedUpdatedEmail) user.email = normalizedUpdatedEmail;
      if (phone && String(phone).trim()) user.phone = String(phone).trim();
      if (address && String(address).trim()) user.address = String(address).trim();
      if (place && String(place).trim()) user.place = String(place).trim();
      await user.save();

      await Notification.create({
        title: "Profile Updated",
        message: `${user.name} updated devotee profile details.`,
      }).catch(() => {});
    } else {
      user = await fileUserStore.findUserByEmail(normalizedCurrentEmail);
      if (!user) {
        return res.status(404).json({ error: "Profile not found." });
      }

      const updates = {};
      if (name && String(name).trim()) updates.name = String(name).trim();
      if (normalizedUpdatedEmail) updates.email = normalizedUpdatedEmail;
      if (phone && String(phone).trim()) updates.phone = String(phone).trim();
      if (address && String(address).trim()) updates.address = String(address).trim();
      if (place && String(place).trim()) updates.place = String(place).trim();

      if (updates.email && updates.email !== user.email) {
        const emailExists = await fileUserStore.findUserByEmail(updates.email);
        if (emailExists) {
          return res.status(409).json({ error: "Email already exists. Please use a different email." });
        }
      }

      user = await fileUserStore.updateUser(user.id, updates);
    }

    return res.status(200).json({
      profile: {
        id: user._id?.toString?.() || user.id,
        name: user.name,
        email: normalizeEmail(user.email),
        phone: user.phone || "",
        address: user.address || "",
        place: user.place || "",
        role: user.role || "devotee",
        memberSince: user.createdAt ? getYear(user.createdAt) : "2025",
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "Email already exists. Please use a different email." });
    }
    return res.status(500).json({ error: "Failed to update profile." });
  }
};

const getSupportRequests = async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const filter = email ? { email } : {};
    const requests = await SupportRequest.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ requests });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load support requests." });
  }
};

const replySupportRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reply, status } = req.body;
    if (!reply) {
      return res.status(400).json({ error: "Reply text is required." });
    }

    const supportRequest = await SupportRequest.findById(id);
    if (!supportRequest) {
      return res.status(404).json({ error: "Support request not found." });
    }

    supportRequest.reply = String(reply).trim();
    if (status && ["Open", "In Progress", "Closed"].includes(status)) {
      supportRequest.status = status;
    } else {
      supportRequest.status = "Closed";
    }
    await supportRequest.save();

    await Notification.create({
      title: "Feedback Response",
      message: `Your feedback on '${supportRequest.subject}' has been replied to.`,
      audienceEmail: supportRequest.email,
    });

    return res.status(200).json({ request: supportRequest });
  } catch (error) {
    return res.status(500).json({ error: "Failed to reply to support request." });
  }
};

const createNotification = async (req, res) => {
  try {
    const { title, message, audienceRole, broadcast, category, attachment } = req.body;
    if (!title || !message) return res.status(400).json({ error: "title and message are required." });

    // If admin wants to broadcast to a role or all, create per-user notifications
    if (broadcast || audienceRole) {
      try {
        const lowerRole = String(audienceRole || "").toLowerCase();
        if (lowerRole === "staff" || lowerRole === "employee" || lowerRole === "employees") {
          const docs = await createEmployeeBroadcastNotifications({
            title,
            message,
            category: category || "event",
            attachment: attachment || undefined,
          });
          return res.status(201).json({ notifications: docs });
        }

        // default: broadcast to registered devotees or to specified role
        const docs = await createBroadcastNotifications({
          title,
          message,
          category: category || "event",
          role: audienceRole || "devotee",
          attachment: attachment || undefined,
        });
        return res.status(201).json({ notifications: docs });
      } catch (err) {
        console.error("broadcast create error:", err);
        return res.status(500).json({ error: "Failed to broadcast notification." });
      }
    }

    const notification = await Notification.create({
      title,
      message,
      category: category || "event",
      attachment: attachment || undefined,
    });
    return res.status(201).json({ notification });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create notification." });
  }
};

const getPrasadamOrders = async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    const normalizedChannel = String(req.query.channel || "")
      .trim()
      .toLowerCase();
    const channel = normalizedChannel === "cashier" ? "cashier" : normalizedChannel === "devotee" ? "devotee" : "";

    // When PostgreSQL is used for Prasadam Orders the same query semantics are
    // expressed with simple filter fields. "channel devotee" (the devotee
    // portal case) also matches orders that predate the channel field, exactly
    // like the Mongo { $or: [{ channel: "devotee" }, { channel: { $exists:
    // false } }] } clause below.
    const pgSelected = await prasadamOrderService.usePostgres();
    if (pgSelected) {
      const filter = {};
      if (email) {
        const user = await User.findOne(buildEmailLookup("email", email)).select("_id").lean();
        filter.$or = [
          { email },
          ...(user?._id ? [{ devoteeId: String(user._id) }] : []),
        ];
        filter.channel = { $in: ["devotee", ""] };
      } else if (channel) {
        filter.channel = channel;
      }
      const orders = await prasadamOrderService.findMany({
        filter,
        sort: { createdAt: -1 },
      });
      return res.status(200).json({ orders: orders.map((order) => normalizeOrderEmails(order.toObject ? order.toObject() : order)) });
    }

    const conditions = [];

    if (email) {
      const user = await User.findOne(buildEmailLookup("email", email)).select("_id").lean();
      const emailOr = [buildEmailLookup("email", email)];
      if (user?._id) emailOr.push({ devoteeId: user._id });
      conditions.push({ $or: emailOr });
      conditions.push({ $or: [{ channel: "devotee" }, { channel: { $exists: false } }] });
    } else if (channel) {
      conditions.push({ channel });
    }

    const mongoQuery = conditions.length ? { $and: conditions } : {};

    const orders = await PrasadamOrder.find(mongoQuery).sort({ createdAt: -1 });
    return res.status(200).json({ orders: orders.map((order) => normalizeOrderEmails(order.toObject ? order.toObject() : order)) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load prasadam orders." });
  }
};

const createPrasadamOrder = async (req, res) => {
  try {
    const { devoteeName, email, phone, itemName, quantity, paymentMethod, devoteeId, channel } = req.body;
    const normalizedOrderEmail = normalizeEmail(email);
    if (!devoteeName || !itemName) {
      return res.status(400).json({ error: "devoteeName and itemName are required." });
    }

    const normalizedQty = Number(quantity || 1);
    if (Number.isNaN(normalizedQty) || normalizedQty < 1) {
      return res.status(400).json({ error: "Quantity must be at least 1." });
    }
    const requestedUnitPrice = Number(req.body.unitPrice ?? req.body.price);

    const prasadamItem = await Prasadam.findOne({ name: { $regex: new RegExp(`^${itemName}$`, "i") } });
    if (!prasadamItem) {
      return res.status(404).json({ error: "Prasadam item not found in master list." });
    }

    if (prasadamItem.availableQuantity < normalizedQty) {
      return res.status(400).json({ error: "Prasadam currently unavailable. Out Of Stock or insufficient quantity." });
    }

    const unitPrice = prasadamItem.price;
    const totalAmount = unitPrice * normalizedQty;

    const normalizedChannel = String(channel || "")
      .trim()
      .toLowerCase();
    const resolvedChannel = normalizedChannel === "cashier" ? "cashier" : "devotee";

    const orderStatus = "Not Collected";

    let resolvedDevoteeId = devoteeId || undefined;
    if (!resolvedDevoteeId && normalizedOrderEmail) {
      const user = await User.findOne(buildEmailLookup("email", normalizedOrderEmail)).select("_id").lean();
      if (user?._id) resolvedDevoteeId = user._id;
    }

    // The shared Prasadam Order service routes to the PostgreSQL repository
    // when the Prasadam Order path is explicitly used and PostgreSQL is
    // reachable, and to the existing Mongoose model otherwise. The order
    // document (with a 24-char hex _id) is what the rest of this handler and
    // the ledger bill reference, so both paths return the same shape.
    let order = await prasadamOrderService.create({
      channel: resolvedChannel,
      devoteeId: resolvedDevoteeId,
      devoteeName,
      email: normalizedOrderEmail || undefined,
      phone: phone || undefined,
      itemName,
      quantity: normalizedQty,
      unitPrice,
      amount: totalAmount,
      paymentMethod: paymentMethod || "UPI",
      status: orderStatus,
    });

    await createLedgerBill({
      devoteeName,
      sevaType: itemName,
      amount: totalAmount,
      paymentMode: paymentMethod || "UPI",
      billType: "Prasadam Sale",
      referenceNo: `PR-${String(order._id).slice(-6).toUpperCase()}`,
      sourceId: order._id.toString(),
      notes: `Quantity: ${normalizedQty}, Unit Price: ${unitPrice}`,
      status: orderStatus === "Placed" ? "Paid" : "Pending",
    });

    if (hasKeys && isOnline) {
      const razorpayClient = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const orderOptions = {
        amount: Math.round(totalAmount * 100),
        currency: "INR",
        receipt: `prasadam_${Date.now()}`,
        payment_capture: 1,
      };

      const rzpOrder = await razorpayClient.orders.create(orderOptions);
      // On the PostgreSQL path the order is a plain repository object, so the
      // razorpayOrderId mutation goes through the repository as well; Mongoose
      // documents keep the original in-place save.
      if (await prasadamOrderService.usePostgres()) {
        order = await prasadamOrderService.updateById(order._id || order.id, { razorpayOrderId: rzpOrder.id });
      } else {
        order.razorpayOrderId = rzpOrder.id;
        await order.save();
      }

      return res.status(201).json({
        order: normalizeOrderEmails(order.toObject ? order.toObject() : order),
        rzpOrder,
        key: process.env.RAZORPAY_KEY_ID || "",
        simulated: false,
      });
    }

    // Direct / Simulated Confirmations
    await Notification.create({
      title: "New Prasadam Order",
      message: `${devoteeName} ordered ${itemName} x${normalizedQty}.`,
      audienceEmail: normalizedOrderEmail || undefined,
    });

    // Also notify the cashier role
    await createStaffNotification({
      title: `🍚 Prasadam Order: ${itemName}`,
      message: `${devoteeName} ordered ${itemName} x${normalizedQty} — ₹${totalAmount} (${paymentMethod || "UPI"}).`,
      audienceRole: "cashier",
      category: "prasadam",
    }).catch(() => {});

    // Send multi-channel notifications (Email & SMS) if devotee info is available
    if (email || phone) {
      const devotee = { name: devoteeName, email: normalizedOrderEmail, phone };
      await sendPrasadamOrderConfirmation(devotee, {
        item: itemName,
        quantity: normalizedQty,
        amount: totalAmount,
        status: orderStatus,
      }).catch((err) => console.warn("Failed to send prasadam order confirmation:", err.message));
    }

    prasadamItem.availableQuantity -= normalizedQty;
    await prasadamItem.save();

    if (prasadamItem.availableQuantity <= prasadamItem.minimumStock) {
      await createStaffBroadcastNotifications({
        title: "⚠️ Low Prasadam Stock",
        message: `${prasadamItem.name} stock is low. Current: ${prasadamItem.availableQuantity}.`,
        category: "inventory",
      }).catch(() => {});
    }

    return res.status(201).json({
      order: normalizeOrderEmails(order.toObject ? order.toObject() : order),
      simulated: true,
    });
  } catch (error) {
    console.error("createPrasadamOrder error:", error);
    return res.status(500).json({ error: "Failed to place prasadam order." });
  }
};

const verifyPrasadamPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields." });
    }

    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "").update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature." });
    }

    let order = null;
    if (orderId) order = await prasadamOrderService.findById(orderId);
    if (!order) order = await prasadamOrderService.findOneByRazorpayOrderId(razorpay_order_id);
    if (!order) return res.status(404).json({ error: "Prasadam order not found." });

    // Persist the payment-verification mutation. On the PostgreSQL path this
    // goes through the repository (order.save() is a Mongoose-only concept);
    // on the Mongo path the original document mutation is preserved.
    if (await prasadamOrderService.usePostgres()) {
      await prasadamOrderService.updateById(order._id || order.id, {
        status: "Placed",
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      });
      order = await prasadamOrderService.findById(order._id || order.id);
    } else {
      order.status = "Placed";
      order.razorpayPaymentId = razorpay_payment_id;
      order.razorpaySignature = razorpay_signature;
      await order.save();
    }

    await Bill.updateMany(
      { sourceId: order._id.toString() },
      { status: "Paid" }
    );

    // Deduct stock after payment completes
    const prasadamItem = await Prasadam.findOne({ name: { $regex: new RegExp(`^${order.itemName}$`, "i") } });
    if (prasadamItem) {
      prasadamItem.availableQuantity = Math.max(0, prasadamItem.availableQuantity - order.quantity);
      await prasadamItem.save();

      if (prasadamItem.availableQuantity <= prasadamItem.minimumStock) {
        await createStaffBroadcastNotifications({
          title: "⚠️ Low Prasadam Stock",
          message: `${prasadamItem.name} stock is low. Current: ${prasadamItem.availableQuantity}.`,
          category: "inventory",
        }).catch(() => {});
      }
    }

    // Send notifications/emails
    try {
      await Notification.create({
        title: "New Prasadam Order",
        message: `${order.devoteeName} ordered ${order.itemName} x${order.quantity}.`,
        audienceEmail: order.email || undefined,
      });

      await createStaffNotification({
        title: `🍚 Prasadam Order: ${order.itemName}`,
        message: `${order.devoteeName} ordered ${order.itemName} x${order.quantity} — ₹${order.amount} (${order.paymentMethod || "UPI"}).`,
        audienceRole: "cashier",
        category: "prasadam",
      });

      if (order.email || order.phone) {
        const devotee = { name: order.devoteeName, email: order.email, phone: order.phone };
        sendPrasadamOrderConfirmation(devotee, {
          item: order.itemName,
          quantity: order.quantity,
          amount: order.amount,
          status: "Placed",
        }).catch((err) => console.warn("Failed to send prasadam order confirmation:", err.message));
      }
    } catch (notifErr) {
      console.warn("Notification after prasadam verify failed:", notifErr);
    }

    return res.status(200).json({ success: true, order: normalizeOrderEmails(order.toObject ? order.toObject() : order) });
  } catch (error) {
    console.error("verifyPrasadamPayment error:", error);
    return res.status(500).json({ error: "Failed to verify prasadam payment." });
  }
};

const cancelPrasadamOrder = async (req, res) => {
  try {
    const { id } = req.params;
    let order = await prasadamOrderService.findById(id);
    if (!order) return res.status(404).json({ error: "Prasadam order not found." });
    if (order.status === "Cancelled") return res.status(200).json({ order });
    // Persist the cancellation through the active Prasadam Order path so both
    // the PostgreSQL repository and the Mongoose model stay consistent.
    order = await prasadamOrderService.updateById(id, { status: "Cancelled" });
    await Notification.create({
      title: "Prasadam Order Cancelled",
      message: `${order.devoteeName} cancelled ${order.itemName} order.`,
      audienceEmail: order.email || undefined,
    });
    return res.status(200).json({ order });
  } catch (error) {
    return res.status(500).json({ error: "Failed to cancel prasadam order." });
  }
};

// Create a Razorpay order and a pending Donation record
const createRazorpayOrder = async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(500).json({ error: "Database not connected." });

    const { amount, donorName, donorEmail, donorPhone, category = "General", paymentMethod = "UPI", notes, eventId } = req.body;
    const normalizedDonorEmail = normalizeEmail(donorEmail);
    const paymentMode = paymentMethod || "UPI";
    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount provided." });
    }

    // If Razorpay keys are not present, simulate an order for local/dev testing
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.warn("Razorpay keys missing — creating simulated order for development.", { body: req.body });
      const order = {
        id: `sim_order_${Date.now()}`,
        amount: Math.round(numericAmount * 100),
        currency: "INR",
        receipt: `donation_${Date.now()}`,
      };

      const donation = await Donation.create({
        donorName: donorName || "Anonymous",
        donorEmail: normalizedDonorEmail || undefined,
        donorPhone: donorPhone || undefined,
        amount: numericAmount,
        category,
        paymentMethod,
        notes,
        status: "Completed",
        eventId: eventId || undefined,
        razorpayOrderId: order.id,
        transactionId: `SIM_TXN_${Date.now()}`,
      });

      await createLedgerBill({
        devoteeName: donorName || "Anonymous",
        sevaType: category,
        amount: numericAmount,
        paymentMode,
        billType: "Donation",
        referenceNo: `DN-${String(donation._id).slice(-6).toUpperCase()}`,
        sourceId: donation._id.toString(),
        notes,
        status: "Paid",
      });

      // Update event collection immediately for simulated donations
      if (eventId) {
        try {
          await Event.findByIdAndUpdate(String(eventId), { $inc: { collection: numericAmount } });
        } catch (err) {
          console.error("Failed to update event collection for simulated donation:", err);
        }
      }

      // Create notification and send receipt where possible
      try {
        await Notification.create({
          title: "Donation Received",
          message: `${donorName || "Anonymous"} donated INR ${numericAmount} (simulated).`,
          audienceEmail: normalizedDonorEmail || undefined,
        });
        if (donorEmail || donorPhone) {
          const donor = { name: donorName, email: normalizedDonorEmail, phone: donorPhone };
          await sendDonationReceipt(donor, { amount: numericAmount, category, transactionId: donation.transactionId });
        }
      } catch (notifErr) {
        console.warn("Notification for simulated donation failed:", notifErr);
      }

      return res.status(201).json({ order, donation: normalizeDonationEmails(donation.toObject ? donation.toObject() : donation), key: "", simulated: true });
    }

    const razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const orderOptions = {
      amount: Math.round(numericAmount * 100),
      currency: "INR",
      receipt: `donation_${Date.now()}`,
      payment_capture: 1,
    };

    const order = await razorpayClient.orders.create(orderOptions);

    const donation = await Donation.create({
      donorName: donorName || "Anonymous",
      donorEmail: normalizedDonorEmail || undefined,
      donorPhone: donorPhone || undefined,
      amount: numericAmount,
      category,
      paymentMethod,
      notes,
      status: "Not Collected",
      eventId: eventId || undefined,
      razorpayOrderId: order.id,
    });

    await createLedgerBill({
      devoteeName: donorName || "Anonymous",
      sevaType: category,
      amount: numericAmount,
      paymentMode,
      billType: "Donation",
      referenceNo: `DN-${String(donation._id).slice(-6).toUpperCase()}`,
      sourceId: donation._id.toString(),
      notes,
      status: "Paid",
    });

    return res.status(201).json({ order, donation: normalizeDonationEmails(donation.toObject ? donation.toObject() : donation), key: process.env.RAZORPAY_KEY_ID || "" });
  } catch (error) {
    console.error("createRazorpayOrder error:", error);
    const message = error?.message || (error?.error && JSON.stringify(error.error)) || "Failed to create Razorpay order.";
    return res.status(500).json({ error: message });
  }
};

// Verify Razorpay payment signature (called by frontend after checkout)
const verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, donationId } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields." });
    }

    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "").update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature." });
    }

    let donation = null;
    if (donationId) donation = await Donation.findById(donationId);
    if (!donation) donation = await Donation.findOne({ razorpayOrderId: razorpay_order_id });
    if (!donation) return res.status(404).json({ error: "Donation not found for this order." });

    donation.status = "Completed";
    donation.transactionId = razorpay_payment_id;
    donation.razorpayPaymentId = razorpay_payment_id;
    donation.razorpaySignature = razorpay_signature;
    await donation.save();

    await Bill.updateMany(
      { sourceId: donation._id.toString() },
      { status: "Paid" }
    );

    // If donation linked to an event, increment its collection
    if (donation.eventId) {
      try {
        await Event.findByIdAndUpdate(String(donation.eventId), { $inc: { collection: Number(donation.amount) || 0 } });
      } catch (err) {
        console.error("Failed to update event collection from verifyRazorpayPayment:", err);
      }
    }

    // Send receipt / notification
    try {
      await Notification.create({
        title: "Donation Received",
        message: `${donation.donorName || "A donor"} donated INR ${donation.amount}.`,
        audienceEmail: donation.donorEmail || undefined,
      });
      if (donation.donorEmail || donation.donorPhone) {
        const donor = { name: donation.donorName, email: donation.donorEmail, phone: donation.donorPhone };
        await sendDonationReceipt(donor, { amount: donation.amount, category: donation.category, transactionId: donation.transactionId });
      }
    } catch (notifErr) {
      console.warn("Notification after verify failed:", notifErr);
    }

    if (isDbConnected() && donation.status === "Completed") {
      try {
        await recordTransaction({
          transactionType: "Credit",
          source: "Donation",
          category: "Donation Income",
          amount: donation.amount,
          paymentMethod: donation.paymentMethod || "Bank Transfer",
          status: "Completed",
          description: `Online Donation: ${donation.category} by ${donation.donorName} (${razorpay_payment_id})`,
          referenceId: donation._id,
          referenceModel: "Donation",
          recordedBy: req.user ? req.user.id : null,
        });
      } catch (err) {
        console.error("Failed to record accounting transaction:", err);
      }
    }

    return res.status(200).json({ success: true, donation: normalizeDonationEmails(donation.toObject ? donation.toObject() : donation) });
  } catch (error) {
    console.error("verifyRazorpayPayment error:", error);
    return res.status(500).json({ error: "Failed to verify Razorpay payment." });
  }
};

// Webhook handler for Razorpay events (use express.raw middleware on route)
const handleRazorpayWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || "";
    const signature = req.headers["x-razorpay-signature"];
    const bodyBuffer = req.body;
    const expected = crypto.createHmac("sha256", secret).update(bodyBuffer).digest("hex");
    if (expected !== signature) {
      console.warn("Razorpay webhook signature mismatch");
      return res.status(400).json({ error: "Invalid webhook signature." });
    }

    const payload = JSON.parse(bodyBuffer.toString());
    const evt = payload.event;

    if (evt === "payment.captured" || evt === "payment.authorized") {
      const entity = payload.payload.payment.entity;
      const orderId = entity.order_id;
      const paymentId = entity.id;
      const amount = (entity.amount || 0) / 100;

      const donation = await Donation.findOne({ razorpayOrderId: orderId });
      if (donation) {
        donation.status = "Completed";
        donation.transactionId = paymentId;
        donation.razorpayPaymentId = paymentId;
        donation.razorpaySignature = signature;
        await donation.save();

        await Bill.updateMany(
          { sourceId: donation._id.toString() },
          { status: "Paid" }
        );

        if (donation.eventId) {
          try {
            await Event.findByIdAndUpdate(String(donation.eventId), { $inc: { collection: Number(donation.amount) || amount } });
          } catch (err) {
            console.error("Failed to update event collection from webhook:", err);
          }
        }
      }
    }

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("handleRazorpayWebhook error:", error);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["Confirmed", "Rejected", "Cancelled", "Pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid booking status." });
    }
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    const previousStatus = booking.status;
    booking.status = status;

    // If changing to Confirmed and linked to an event, increment event aggregates once
    if (booking.eventId && status === "Confirmed" && !booking.counted) {
      try {
        await Event.findByIdAndUpdate(String(booking.eventId), {
          $inc: { registrations: 1, collection: Number(booking.amount) || 0 },
        });
        booking.counted = true;
      } catch (err) {
        console.error("Failed to update event aggregates on booking confirm:", err);
      }
    }

    await booking.save();

    await Bill.updateMany(
      { sourceId: booking._id.toString() },
      {
        status: status === "Confirmed" ? "Paid" : status === "Cancelled" || status === "Rejected" ? "Cancelled" : "Pending",
      }
    );

    await Notification.create({
      title: "Booking Status Updated",
      message: `Your ${booking.service} booking is now ${status}.`,
      audienceEmail: booking.devoteeEmail || undefined,
      category: "booking",
    });

    return res.status(200).json({ booking, previousStatus });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update booking status." });
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Notification ID is required." });
    }
    
    const notification = await Notification.findByIdAndUpdate(
      id,
      {
        read: true,
        readAt: new Date(),
      },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({ error: "Notification not found." });
    }
    
    return res.status(200).json({ notification });
  } catch (error) {
    return res.status(500).json({ error: "Failed to mark notification as read." });
  }
};

const markSupportRequestAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const supportRequest = await SupportRequest.findByIdAndUpdate(
      id,
      { read: true },
      { new: true }
    );
    
    if (!supportRequest) {
      return res.status(404).json({ error: "Support request not found." });
    }
    
    return res.status(200).json({ supportRequest });
  } catch (error) {
    return res.status(500).json({ error: "Failed to mark support request as read." });
  }
};

const sendNotificationEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const targetEmail = normalizeEmail(req.body.email || req.query.email);

    if (!id) {
      return res.status(400).json({ error: "Notification ID is required." });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({ error: "Notification not found." });
    }

    const recipient = targetEmail || notification.audienceEmail;
    if (!recipient) {
      return res.status(400).json({ error: "Recipient email is required." });
    }

    const { sendEmail } = require("../utils/communicationService");

    const attachments = [];
    const attachmentDetails = {
      hasImage: false,
      imageSrc: "",
      isPdf: false,
      filename: "",
    };

    if (notification.attachment && typeof notification.attachment === "string") {
      const trimmedAtt = notification.attachment.trim();
      if (trimmedAtt.startsWith("data:image/")) {
        const match = trimmedAtt.match(/^data:(image\/([a-zA-Z0-9+]+));base64,(.+)$/);
        if (match) {
          const contentType = match[1];
          const rawExt = match[2].toLowerCase();
          const ext = rawExt === "jpeg" ? "jpg" : rawExt;
          const buffer = Buffer.from(match[3], "base64");
          const cid = "temple_invitation_banner";
          const filename = `invitation_banner.${ext}`;

          attachments.push({
            filename,
            content: buffer,
            contentType,
            cid,
          });

          attachmentDetails.hasImage = true;
          attachmentDetails.imageSrc = `cid:${cid}`;
          attachmentDetails.filename = filename;
        }
      } else if (trimmedAtt.startsWith("data:application/pdf")) {
        const match = trimmedAtt.match(/^data:application\/pdf;base64,(.+)$/);
        if (match) {
          const buffer = Buffer.from(match[1], "base64");
          const safeTitle = (notification.title || "Event").replace(/[^a-zA-Z0-9_-]/g, "_");
          const filename = `Invitation_${safeTitle}.pdf`;

          attachments.push({
            filename,
            content: buffer,
            contentType: "application/pdf",
          });

          attachmentDetails.isPdf = true;
          attachmentDetails.filename = filename;
        }
      } else if (trimmedAtt.startsWith("http://") || trimmedAtt.startsWith("https://")) {
        if (/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i.test(trimmedAtt) || trimmedAtt.includes("/image/")) {
          attachmentDetails.hasImage = true;
          attachmentDetails.imageSrc = trimmedAtt;
        } else if (/\.pdf($|\?)/i.test(trimmedAtt)) {
          attachmentDetails.isPdf = true;
          attachmentDetails.filename = "Invitation.pdf";
        }
      }
    }

    const emailDateStr = notification.date
      ? new Date(notification.date).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : new Date().toLocaleString("en-IN");

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: 'Segoe UI', Arial, sans-serif; color: #2d1b08;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #faf6f0; padding: 30px 15px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(184, 94, 0, 0.08); border: 1px solid #f4e4d0;">
                  <tr>
                    <td style="background: linear-gradient(135deg, #b46a13 0%, #ea580c 100%); padding: 28px 30px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800;">Sri Shanti Mahadev Mandir</h1>
                      <p style="color: #fde8cc; margin: 6px 0 0 0; font-size: 13px; font-weight: 600; text-transform: uppercase;">Temple Official Notification</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 35px 35px 25px 35px;">
                      <div style="display: inline-block; background-color: #fcf0e4; color: #b46a13; font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 20px; text-transform: uppercase; margin-bottom: 15px;">
                        ${(notification.category || "NOTIFICATION").toUpperCase()}
                      </div>
                      <h2 style="color: #2d1b08; margin: 0 0 15px 0; font-size: 22px; font-weight: 700;">
                        ${notification.title}
                      </h2>
                      ${attachmentDetails.hasImage ? `
                        <div style="margin: 18px 0 24px 0; text-align: center; border-radius: 12px; overflow: hidden; border: 1px solid #ebd8c3;">
                          <img src="${attachmentDetails.imageSrc}" alt="${notification.title}" style="max-width: 100%; width: 100%; height: auto; display: block;" />
                        </div>
                      ` : ""}
                      ${attachmentDetails.isPdf ? `
                        <div style="background-color: #fff9f2; border: 1.5px dashed #ea580c; border-radius: 12px; padding: 18px 20px; margin: 18px 0 22px 0; text-align: center;">
                          <h3 style="margin: 0; color: #9a3412; font-size: 16px;">📄 Official Invitation (PDF Document Attached)</h3>
                        </div>
                      ` : ""}
                      <div style="background-color: #fbf8f5; border-left: 4px solid #ea580c; border-radius: 8px; padding: 18px 20px; margin: 15px 0 25px 0;">
                        <p style="margin: 0; color: #4a3828; font-size: 15px; line-height: 1.6; white-space: pre-line;">
                          ${notification.message}
                        </p>
                      </div>
                      <p style="color: #8c7b6c; font-size: 13px; margin: 0 0 25px 0;">
                        📅 Date: <strong>${emailDateStr}</strong>
                      </p>
                      <p style="margin: 0; color: #5a4b3d; font-size: 13px;">
                        You can also view this notification and all temple events directly in your <a href="http://localhost:5173/devotee" style="color: #ea580c; font-weight: 600;">Devotee Portal</a>.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f7efe6; padding: 20px 30px; text-align: center;">
                      <p style="margin: 0; color: #7f6e5e; font-size: 12px;">
                        With divine blessings,<br>
                        <strong>Sri Shanti Mahadev Mandir Administration</strong>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const emailRes = await sendEmail({
      to: recipient,
      subject: `[Sri Shanti Mahadev Mandir] ${notification.title}`,
      html: emailHtml,
      text: `${notification.title}\n\n${notification.message}\n\nSri Shanti Mahadev Mandir`,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (emailRes.success) {
      notification.emailSent = true;
      notification.emailSentAt = new Date();
      notification.emailRecipient = recipient;
      await notification.save();
      return res.status(200).json({ success: true, message: `Notification email dispatched successfully to ${recipient}` });
    } else {
      return res.status(200).json({
        success: false,
        warning: true,
        message: `Email dispatch attempted: ${emailRes.error || "SMTP service unavailable"}`,
      });
    }
  } catch (error) {
    console.error("sendNotificationEmail error:", error);
    return res.status(500).json({ error: "Failed to send notification email: " + error.message });
  }
};

module.exports = {
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
};
