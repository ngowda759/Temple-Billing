const PoojaBooking = require("../models/PoojaBooking");
const poojaService = require("../services/poojaService");
const InventoryItem = require("../models/InventoryItem");

// Create a new pooja booking
const createBooking = async (req, res) => {
  try {
    const { customerName, service, amount, paymentMethod, contactNumber, notes, bookingDate, selectedTempleMaterials } = req.body;

    if (!customerName || !service || !amount || !paymentMethod || !contactNumber || !bookingDate) {
      return res.status(400).json({ message: "All required fields must be provided" });
    }

    const pooja = await poojaService.populateMaterials(
      await poojaService.findOne({ name: service }),
      "full"
    );
    if (!pooja) {
      return res.status(404).json({ message: "Pooja details not found" });
    }

    // Backend Date Validation
    const d = new Date(bookingDate);
    const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
    const dateString = d.toISOString().split("T")[0]; // YYYY-MM-DD

    const isDayAllowed = pooja.availableDays.includes("Everyday") || pooja.availableDays.includes(dayName);
    const isDateAllowed = pooja.availableDates.includes(dateString);

    if (!isDayAllowed && !isDateAllowed) {
      return res.status(400).json({ message: `Pooja is not available on ${bookingDate}` });
    }

    let templeMaterialRequests = [];
    let calculatedTempleCharge = 0;
    
    // selectedTempleMaterials should be an array of item IDs that the user selected for the temple to arrange.
    const selectedItemIds = Array.isArray(selectedTempleMaterials) ? selectedTempleMaterials : [];

    if (pooja.requiredMaterials && pooja.requiredMaterials.length > 0) {
      for (const reqMat of pooja.requiredMaterials) {
        // If the user selected it AND the temple can actually arrange it
        if (reqMat.canTempleArrange && reqMat.item && selectedItemIds.includes(reqMat.item._id.toString())) {
          calculatedTempleCharge += (reqMat.templeCharge || 0);
          
          templeMaterialRequests.push({
            item: reqMat.item._id,
            itemName: reqMat.item.name,
            qty: reqMat.qty,
            unit: reqMat.unit
          });
          
          // System-generated request creation intentionally stays on the
          // Mongoose model (NOT the Phase 2L service): this runs inside the
          // pooja booking creation flow whose PoojaBooking document is still
          // Mongo-backed, matching the Phase 2L additive boundary.
          const InventoryRequest = require("../models/InventoryRequest");
          await InventoryRequest.create({
            userId: req.user.id,
            userName: `${customerName} (Pooja Booking)`,
            role: "System",
            itemName: reqMat.item.name,
            quantity: reqMat.qty,
            unit: reqMat.unit,
            reason: `System generated for Pooja Booking: ${service}`,
            purpose: `Pooja Booking: ${service}`,
            expectedDate: new Date(bookingDate),
            status: "Approved",
            approvedBy: "System",
            approvedAt: new Date()
          });
        }
      }
    }

    const templeArrangement = templeMaterialRequests.length > 0;

    const newBooking = new PoojaBooking({
      customerName,
      service,
      amount, // Base price + temple charge should already be validated here, but we trust the frontend 'amount' for now, or we can recalculate: pooja.price + calculatedTempleCharge
      paymentMethod,
      contactNumber,
      notes,
      bookingDate,
      createdBy: req.user.id, // from auth middleware
      templeArrangement: Boolean(templeArrangement),
      templeMaterialCharge: calculatedTempleCharge,
      templeMaterialRequests,
      materialStatus: templeArrangement ? "Pending" : "N/A"
    });

    const savedBooking = await newBooking.save();

    const { recordTransaction } = require("../services/accountingService");
    await recordTransaction({
      transactionType: "Credit",
      source: "Pooja Booking",
      category: service,
      amount: savedBooking.amount,
      paymentMethod: savedBooking.paymentMethod,
      description: `Pooja Booking: ${savedBooking.bookingNumber}`,
      referenceId: savedBooking._id,
      referenceModel: "PoojaBooking",
      recordedBy: req.user.id,
      status: "Completed"
    });

    res.status(201).json({ message: "Pooja booked successfully", booking: savedBooking });
  } catch (error) {
    console.error("Error creating pooja booking:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Get bookings for the logged-in user
const getMyBookings = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    
    let query = { createdBy: req.user.id };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { customerName: { $regex: search, $options: "i" } },
        { service: { $regex: search, $options: "i" } },
        { bookingNumber: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const bookings = await PoojaBooking.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PoojaBooking.countDocuments(query);

    res.status(200).json({
      bookings,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      totalBookings: total,
    });
  } catch (error) {
    console.error("Error fetching my bookings:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Cancel a booking (updates status to 'Cancelled')
const cancelBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const booking = await PoojaBooking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Optional: Only allow the creator or an admin to cancel
    if (booking.createdBy.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to cancel this booking" });
    }

    booking.status = "Cancelled";
    await booking.save();

    const { recordTransaction } = require("../services/accountingService");
    await recordTransaction({
      transactionType: "Debit",
      source: "Pooja Booking",
      category: "Refund Account",
      amount: booking.amount,
      paymentMethod: booking.paymentMethod,
      description: `Refund for Cancelled Pooja Booking: ${booking.bookingNumber}`,
      referenceId: booking._id,
      referenceModel: "PoojaBooking",
      recordedBy: req.user.id,
      status: "Completed"
    });

    res.status(200).json({ message: "Booking cancelled successfully", booking });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  cancelBooking,
};
