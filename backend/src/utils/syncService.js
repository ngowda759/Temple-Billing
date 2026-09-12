const Bill = require("../models/Bill");
const Booking = require("../models/Booking");
const Donation = require("../models/Donation");
const PrasadamOrder = require("../models/PrasadamOrder");
const prasadamOrderService = require("../services/prasadamOrderService");

const syncLedgerBills = async () => {
  try {
    console.log("Starting financial ledger synchronization...");

    // 1. Sync Bookings
    const bookings = await Booking.find();
    let bookingCount = 0;
    for (const b of bookings) {
      const existing = await Bill.findOne({ sourceId: b._id.toString() });
      if (!existing) {
        await Bill.create({
          devoteeName: b.devoteeName || "Unknown",
          sevaType: b.service || "Pooja Seva",
          amount: b.amount || 0,
          paymentMode: b.paymentMethod || "UPI",
          billType: "Pooja Booking",
          referenceNo: `BK-${String(b._id).slice(-6).toUpperCase()}`,
          sourceId: b._id.toString(),
          notes: b.notes || "",
          status: "Paid",
          billDate: b.createdAt || b.datetime || new Date(),
        });
        bookingCount++;
      }
    }
    if (bookingCount > 0) {
      console.log(`Synced ${bookingCount} missing bills for bookings.`);
    }

    // 2. Sync Donations
    const donations = await Donation.find();
    let donationCount = 0;
    for (const d of donations) {
      const existing = await Bill.findOne({ sourceId: d._id.toString() });
      if (!existing) {
        await Bill.create({
          devoteeName: d.donorName || "Anonymous",
          sevaType: d.category || "General",
          amount: d.amount || 0,
          paymentMode: d.paymentMethod || "UPI",
          billType: "Donation",
          referenceNo: `DN-${String(d._id).slice(-6).toUpperCase()}`,
          sourceId: d._id.toString(),
          notes: d.notes || "",
          status: "Paid",
          billDate: d.createdAt || new Date(),
        });
        donationCount++;
      }
    }
    if (donationCount > 0) {
      console.log(`Synced ${donationCount} missing bills for donations.`);
    }

    // 3. Sync Prasadam Orders — reads go through the active Prasadam Order path
    //    (PostgreSQL when the Prasadam Order path is active and PostgreSQL is
    //    reachable, Mongoose otherwise), but bills remain Mongo-backed.
    const orders = await prasadamOrderService.findMany({});
    let orderCount = 0;
    for (const o of orders) {
      const existing = await Bill.findOne({ sourceId: o._id.toString() });
      if (!existing) {
        await Bill.create({
          devoteeName: o.devoteeName || "Unknown",
          sevaType: o.itemName || "Prasadam",
          amount: o.amount || 0,
          paymentMode: o.paymentMethod || "UPI",
          billType: "Prasadam Sale",
          referenceNo: `PR-${String(o._id).slice(-6).toUpperCase()}`,
          sourceId: o._id.toString(),
          notes: `Quantity: ${o.quantity || 1}, Unit Price: ${o.unitPrice || 0}`,
          status: "Paid",
          billDate: o.createdAt || new Date(),
        });
        orderCount++;
      }
    }
    if (orderCount > 0) {
      console.log(`Synced ${orderCount} missing bills for prasadam orders.`);
    }

    console.log("Financial ledger synchronization completed.");
  } catch (error) {
    console.error("Error during financial ledger synchronization:", error);
  }
};

module.exports = { syncLedgerBills };
