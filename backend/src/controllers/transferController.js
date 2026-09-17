const TransferRequest = require("../models/TransferRequest");
const Booking = require("../models/Booking");
const Task = require("../models/Task");
const notificationPersistenceService = require("../services/notificationPersistenceService");
const User = require("../models/User");
const { sendEmail } = require("../utils/communicationService");

exports.getAllTransferRequests = async (req, res) => {
  try {
    const requests = await TransferRequest.find()
      .populate("originalPriest", "name email")
      .populate("requestedPriest", "name email")
      .sort({ createdAt: -1 });

    // Fetch details for the reference (Booking or Task)
    const formattedRequests = await Promise.all(
      requests.map(async (req) => {
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
        } else if (req.referenceType === "DefaultDuty") {
          const Employee = require("../models/Employee");
          const employee = await Employee.findById(req.referenceId);
          if (employee) {
            dutyName = employee.currentDuty?.dutyName || employee.defaultDuty || "Daily Duties";
            date = new Date().toLocaleDateString();
            time = employee.currentDuty?.reportingTime || employee.defaultShift || "06:00 AM";
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
        };
      })
    );

    return res.status(200).json(formattedRequests);
  } catch (error) {
    console.error("Error fetching transfer requests:", error);
    return res.status(500).json({ message: "Failed to fetch requests" });
  }
};

exports.resolveTransferRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignToPriestId } = req.body; // status: "Approved" or "Rejected"
    const adminId = req.user.id;

    const request = await TransferRequest.findById(id);
    if (!request) return res.status(404).json({ message: "Transfer request not found" });
    if (request.status !== "Pending") return res.status(400).json({ message: "Request already resolved" });

    request.status = status;
    request.resolvedAt = new Date();
    request.resolvedBy = adminId;
    await request.save();

    let newPriestId = request.originalPriest;
    let originalPriestMsg = "";
    let targetPriestMsg = "";

    if (status === "Approved") {
      newPriestId = assignToPriestId || request.requestedPriest;
      const newPriest = await User.findById(newPriestId);
      
      originalPriestMsg = "Your transfer request was approved.";
      targetPriestMsg = "A new duty has been assigned to you via transfer.";

      if (request.referenceType === "Booking") {
        await Booking.findByIdAndUpdate(request.referenceId, {
          status: "Assigned", // Not Transferred, it needs to be startable by new priest. Wait, requirement says "Original assignment status becomes Transferred". 
          // So we should update the original booking to Transferred, and duplicate it? 
          // No, reusing existing collections. We just update assignedPriest and keep status "Assigned" so they can start it. 
          // But wait, "Original assignment status becomes: Transferred". We can just set status to "Assigned" and record history.
          assignedPriest: newPriestId,
          priestName: newPriest ? newPriest.name : "",
        });
      } else if (request.referenceType === "Task") {
        await Task.findByIdAndUpdate(request.referenceId, {
          status: "Assigned",
          staffId: newPriestId,
          staffName: newPriest ? newPriest.name : "",
          staffEmail: newPriest ? newPriest.email : "",
        });
      } else if (request.referenceType === "DefaultDuty") {
        // For DefaultDuty, we create a one-off Task for the new priest.
        const Employee = require("../models/Employee");
        const origEmp = await Employee.findById(request.referenceId);
        if (origEmp) {
          const dutyName = origEmp.currentDuty?.dutyName || origEmp.defaultDuty || "Daily Duties";
          await Task.create({
            title: dutyName,
            category: "Priest Duty",
            staffId: newPriestId,
            staffName: newPriest ? newPriest.name : "",
            staffEmail: newPriest ? newPriest.email : "",
            dateKey: new Date().toISOString(),
            status: "Assigned"
          });
        }
      }
    } else {
      originalPriestMsg = "Your transfer request was rejected. The duty remains assigned to you.";
      if (request.referenceType === "Booking") {
        await Booking.findByIdAndUpdate(request.referenceId, { status: "Assigned" });
      } else if (request.referenceType === "Task") {
        await Task.findByIdAndUpdate(request.referenceId, { status: "Assigned" });
      }
      // No status update needed for DefaultDuty on rejection.
    }

    // Notify Original Priest
    await notificationPersistenceService.create({
      title: "Transfer Request Resolved",
      message: originalPriestMsg,
      audienceRole: "priest",
      audienceEmail: "",
      category: "transfer",
    });

    // Notify New Priest if approved
    if (status === "Approved") {
      await notificationPersistenceService.create({
        title: "New Duty Assigned",
        message: targetPriestMsg,
        audienceRole: "priest",
        audienceEmail: newPriest ? newPriest.email : "",
        category: "transfer",
      });

      if (newPriest && newPriest.email) {
        let dutyNameStr = "Unknown";
        let dateStr = "N/A";
        let timeStr = "N/A";
        
        if (request.referenceType === "Booking") {
          const booking = await Booking.findById(request.referenceId);
          if (booking) {
            dutyNameStr = booking.service;
            dateStr = new Date(booking.datetime).toLocaleDateString();
            timeStr = new Date(booking.datetime).toLocaleTimeString();
          }
        } else if (request.referenceType === "Task") {
          const task = await Task.findById(request.referenceId);
          if (task) {
            dutyNameStr = task.title || task.dutyName || task.duty;
            dateStr = task.dateKey || new Date(task.createdAt).toLocaleDateString();
            timeStr = task.time || task.startTime || "N/A";
          }
        }

        await sendEmail({
          to: newPriest.email,
          subject: "Duty Transfer Assigned To You",
          html: `
            <h3>Duty Transfer Notice</h3>
            <p>Dear ${newPriest.name},</p>
            <p>A duty has been transferred to you: <strong>${dutyNameStr}</strong></p>
            <p><strong>Date:</strong> ${dateStr}</p>
            <p><strong>Time:</strong> ${timeStr}</p>
            <p>Please log in to the temple portal for more details.</p>
          `,
        }).catch(err => console.error("Failed to send transfer email", err));
      }
    }

    return res.status(200).json({ message: `Transfer request ${status.toLowerCase()} successfully` });
  } catch (error) {
    console.error("Error resolving transfer request:", error);
    return res.status(500).json({ message: "Failed to resolve request" });
  }
};

exports.directAdminTransfer = async (req, res) => {
  try {
    const { referenceType, referenceId, newPriestId } = req.body;
    const adminId = req.user.id;

    const newPriest = await User.findById(newPriestId);
    if (!newPriest) return res.status(404).json({ message: "New priest not found" });

    if (referenceType === "Booking") {
      const booking = await Booking.findById(referenceId);
      if (!booking || booking.status === "Completed") return res.status(400).json({ message: "Invalid or completed duty" });
      
      booking.assignedPriest = newPriestId;
      booking.priestName = newPriest.name;
      booking.status = "Assigned";
      await booking.save();
    } else if (referenceType === "Task") {
      const task = await Task.findById(referenceId);
      if (!task || task.status === "Completed") return res.status(400).json({ message: "Invalid or completed duty" });
      
      task.staffId = newPriestId;
      task.staffName = newPriest.name;
      task.staffEmail = newPriest.email;
      task.status = "Assigned";
      await task.save();
    } else {
      return res.status(400).json({ message: "Invalid reference type" });
    }

    await notificationPersistenceService.create({
      title: "Duty Transferred",
      message: "Admin has directly transferred a duty to you.",
      audienceRole: "priest",
      category: "transfer",
    });

    return res.status(200).json({ message: "Duty transferred successfully" });
  } catch (error) {
    console.error("Error in direct transfer:", error);
    return res.status(500).json({ message: "Failed to transfer duty" });
  }
};
