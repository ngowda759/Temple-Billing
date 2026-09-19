const donationService = require("../services/donationService");
const Bill = require("../models/Bill");

// CREATE DONATION
const createDonation = async (req, res) => {
  try {
    const {
      donorName,
      donorEmail,
      amount,
      category = "General",
      paymentMethod = "UPI",
      contactNumber,
      transactionId,
      notes,
      status = "Completed",
    } = req.body;

    if (!donorName || !amount) {
      return res.status(400).json({
        success: false,
        message: "donorName and amount are required",
      });
    }

    if (contactNumber && !/^\+?[0-9\s-]{7,15}$/.test(contactNumber.trim())) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid contact number.",
      });
    }

    const numericAmount = Number(String(amount).replace(/[^0-9.-]+/g, ""));

    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid donation amount",
      });
    }

    const donation = await donationService.create({
      donorName: donorName.trim(),
      donorEmail: donorEmail ? String(donorEmail).trim().toLowerCase() : undefined,
      contactNumber,
      amount: numericAmount,
      category,
      paymentMethod,
      transactionId,
      notes,
      status,
    });

    await Bill.create({
      devoteeName: donorName.trim(),
      sevaType: category || "General",
      amount: numericAmount,
      paymentMode: paymentMethod || "UPI",
      billType: "Donation",
      referenceNo: `DN-${String(donation._id).slice(-6).toUpperCase()}`,
      sourceId: donation._id.toString(),
      notes: notes || "",
      status: status === "Completed" || status === "Collected" ? "Paid" : "Pending",
      billDate: new Date(),
    });

    if (status === "Completed" || status === "Collected") {
      const { recordTransaction } = require("../services/accountingService");

      // Determine Fund based on category
      let accountHead = "Donation Income";
      const cat = (category || "").toLowerCase();
      if (cat.includes("annadan") || cat.includes("annadanam")) accountHead = "Annadanam Donation";
      else if (cat.includes("hundi")) accountHead = "Hundi Collection";
      else if (cat.includes("festival")) accountHead = "Festival Income";
      else if (cat.includes("general")) accountHead = "Donation Income";

      await recordTransaction({
        transactionType: "Credit",
        source: "Donation",
        category: accountHead,
        amount: numericAmount,
        paymentMethod: paymentMethod || "UPI",
        description: `Donation by ${donorName.trim()}${notes ? ' - ' + notes : ''}`,
        referenceId: donation._id,
        referenceModel: "Donation",
        recordedBy: req.user ? req.user.id : null,
        status: "Completed"
      });
    }

    res.status(201).json({
      success: true,
      message: "Donation added successfully",
      donation,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



// GET ALL DONATIONS
const getAllDonations = async (req, res) => {
  try {
    const donations = await donationService.findMany({ sort: { createdAt: -1 } });

    res.status(200).json({
      success: true,
      count: donations.length,
      donations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



// GET DASHBOARD STATS
const getDonationStats = async (req, res) => {
  try {
    const donations = await donationService.findMany({ sort: { createdAt: -1 } });

    const totalAmount = donations.reduce(
      (acc, item) => acc + (Number(item.amount) || 0),
      0
    );

    const totalDonors = donations.length;

    const completed = donations.filter((d) => d.status === "Completed").length;
    const pending = donations.filter((d) => d.status === "Pending").length;

    res.status(200).json({
      success: true,
      stats: {
        totalAmount,
        totalDonors,
        completed,
        pending,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



// DELETE DONATION
const deleteDonation = async (req, res) => {
  try {
    const donation = await donationService.findById(req.params.id);

    if (!donation) {
      return res.status(404).json({
        success: false,
        message: "Donation not found",
      });
    }

    await donationService.destroy(donation._id);
    await Bill.deleteMany({ sourceId: donation._id.toString() });

    res.status(200).json({
      success: true,
      message: "Donation deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// UPDATE DONATION STATUS
const updateDonationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const donation = await donationService.findById(req.params.id);
    if (!donation) {
      return res.status(404).json({
        success: false,
        message: "Donation not found",
      });
    }

    const previousStatus = donation.status;
    const updatedDonation = await donationService.updateById(donation._id, { status });

    // Sync bill ledger status as well
    await Bill.updateMany(
      { sourceId: donation._id.toString() },
      { $set: { status: (status === "Collected" || status === "Completed") ? "Paid" : "Pending" } }
    );

    if (previousStatus !== status && (status === "Collected" || status === "Completed")) {
      const { recordTransaction } = require("../services/accountingService");

      // Determine Fund based on category
      let accountHead = "Donation Income";
      const cat = (donation.category || "").toLowerCase();
      if (cat.includes("annadan") || cat.includes("annadanam")) accountHead = "Annadanam Donation";
      else if (cat.includes("hundi")) accountHead = "Hundi Collection";
      else if (cat.includes("festival")) accountHead = "Festival Income";
      else if (cat.includes("general")) accountHead = "Donation Income";

      await recordTransaction({
        transactionType: "Credit",
        source: "Donation",
        category: accountHead,
        amount: donation.amount,
        paymentMethod: donation.paymentMethod,
        description: `Donation by ${donation.donorName}`,
        referenceId: donation._id,
        referenceModel: "Donation",
        recordedBy: req.user ? req.user.id : donation.donatedBy,
        status: "Completed"
      });
    }

    res.status(200).json({
      success: true,
      message: "Donation status updated successfully",
      donation: updatedDonation || donation,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createDonation,
  getAllDonations,
  getDonationStats,
  deleteDonation,
  updateDonationStatus,
};
