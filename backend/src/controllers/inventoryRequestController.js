// Inventory Request persistence is additive (Phase 2L): the service selects
// PostgreSQL when the Inventory Request path is explicitly used and PostgreSQL
// is reachable, and otherwise falls back to the existing Mongoose model. The
// standalone request endpoints (create/read/status) go through this seam; the
// multi-entity issue flow stays on Mongo but refuses PostgreSQL-backed requests
// it cannot yet issue atomically (see exports.issueInventoryRequest).
const inventoryRequestService = require("../services/inventoryRequestService");
// Direct model import retained for exports.issueInventoryRequest, which keeps
// its single Mongo multi-document transaction (InventoryItem +
// InventoryIssue + InventoryRequest) — see the comment there.
const InventoryRequest = require("../models/InventoryRequest");
const InventoryItem = require("../models/InventoryItem");
const InventoryIssue = require("../models/InventoryIssue");
const { createStaffNotification } = require("../utils/notificationService");
const { seedDefaultItems } = require("./inventoryItemController");

const INVENTORY_REQUEST_STATUSES = ["Pending", "Approved", "Rejected", "Issued"];

const clean = (value) => String(value || "").trim();

const buildInventorySummary = (requests) => {
  return requests.reduce(
    (summary, request) => {
      summary.total += 1;
      if (request.status === "Pending") summary.pending += 1;
      if (request.status === "Approved") summary.approved += 1;
      if (request.status === "Rejected") summary.rejected += 1;
      return summary;
    },
    { total: 0, pending: 0, approved: 0, rejected: 0 }
  );
};

// GET /api/staff/inventory/catalog — live stock from DB
exports.getInventoryCatalog = async (req, res) => {
  try {
    await seedDefaultItems();
    const dbItems = await InventoryItem.find().sort({ name: 1 });
    const items = dbItems.map((item) => ({
      _id: item._id,
      name: item.name,
      unit: item.unit,
      stock: item.availableStock,
      minimumStock: item.minimumStock,
      status: item.availableStock === 0 ? "Out Of Stock" : item.availableStock <= item.minimumStock ? "Low Stock" : "Healthy",
    }));
    return res.json({ success: true, items });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/staff/inventory-requests (and /api/priest/inventory-requests)
exports.createInventoryRequest = async (req, res) => {
  try {
    const { userId, staffId, userName, staffName, role, itemName, quantity, unit, reason, requestedBy, purpose, expectedDate, priority } = req.body;
    const trimmedItemName = clean(itemName);
    const trimmedQuantity = clean(quantity);
    const trimmedUnit = clean(unit);
    const trimmedReason = clean(reason);
    const trimmedUserId = clean(userId || staffId);
    const trimmedUserName = clean(userName || staffName || requestedBy);
    const requestRole = clean(role) || "Staff";
    const requestPurpose = clean(purpose);
    const requestPriority = clean(priority) || "Medium";

    if (!trimmedUserId || !trimmedUserName || !trimmedItemName || !trimmedQuantity || !trimmedUnit || (!trimmedReason && !requestPurpose)) {
      return res.status(400).json({
        success: false,
        message: "userId, userName, itemName, quantity, unit and reason/purpose are required",
      });
    }

    // Validate quantity is a positive number
    const parsedQty = parseFloat(trimmedQuantity);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive number.",
      });
    }

    // Duplicate check: same staffId + itemName + Pending request today. The
    // service routes to PostgreSQL when the datasource seam is open, and to the
    // Mongoose model otherwise — the duplicate guard behaves identically on both.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const duplicate = await inventoryRequestService.findOne({
      userId: trimmedUserId,
      itemName: trimmedItemName,
      status: "Pending",
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Request already submitted for ${trimmedItemName} today. Please wait for the pending request to be reviewed.`,
      });
    }

    const request = await inventoryRequestService.create({
      userId: trimmedUserId,
      userName: trimmedUserName,
      role: requestRole,
      requestedBy: trimmedUserName,
      itemName: trimmedItemName,
      quantity: parsedQty,
      unit: trimmedUnit,
      reason: trimmedReason || requestPurpose,
      purpose: requestPurpose || trimmedReason,
      expectedDate: expectedDate ? new Date(expectedDate) : new Date(),
      priority: requestPriority,
      status: "Pending",
      adminReason: "",
      reviewedBy: "",
      reviewedAt: null,
    });

    // Notify admin
    await createStaffNotification({
      title: "🔔 New Inventory Request",
      message: `${trimmedUserName} (${requestRole}) requested ${parsedQty} ${trimmedUnit} of ${trimmedItemName}.\nPurpose: ${requestPurpose || trimmedReason}`,
      audienceRole: "admin",
      category: "inventory",
    });

    return res.status(201).json({ success: true, request });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/staff/inventory-requests or /api/staff/inventory-requests/:userId
exports.getInventoryRequests = async (req, res) => {
  try {
    const { staffId, userId } = req.params;
    const id = clean(userId || staffId);
    const query = id ? { userId: id } : {};
    const requests = await inventoryRequestService.findMany({
      filter: query,
      sort: { createdAt: -1 },
    });
    return res.json({ success: true, requests });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/staff/inventory-requests/:userId/summary
exports.getInventorySummary = async (req, res) => {
  try {
    const { staffId, userId } = req.params;
    const id = clean(userId || staffId);
    const requests = await inventoryRequestService.findMany({ filter: { userId: id } });
    const summary = buildInventorySummary(requests);
    return res.json({ success: true, summary });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/inventory-requests/:id/status
exports.updateInventoryRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminReason, rejectionReason, reviewedBy } = req.body;
    const normalizedStatus = clean(status);

    if (!INVENTORY_REQUEST_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ success: false, message: "Invalid inventory request status" });
    }

    if (normalizedStatus === "Rejected" && !clean(adminReason) && !clean(rejectionReason)) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when rejecting inventory requests",
      });
    }

    const request = await inventoryRequestService.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Inventory request not found" });
    }

    // Approval/rejection mutates the request, applies admin/reviewer metadata
    // and timestamps, then persists through the Phase 2L service — PostgreSQL
    // when the datasource seam is open, the Mongoose model otherwise. The
    // transition rules below (cannot re-approve, cannot reject an approved
    // request, cannot re-reject) are preserved exactly.
    if (normalizedStatus === "Approved") {
      if (request.status === "Approved") {
        return res.status(400).json({ success: false, message: "This request has already been approved." });
      }
      const actor = clean(reviewedBy) || (req.user ? req.user.name : "Admin");
      const updated = await inventoryRequestService.updateById(id, {
        status: "Approved",
        adminReason: clean(adminReason),
        reviewedBy: actor,
        reviewedAt: new Date(),
        approvedBy: actor,
        approvedAt: new Date(),
      });
      request.status = updated.status;
      request.adminReason = updated.adminReason;
      request.reviewedBy = updated.reviewedBy;
      request.reviewedAt = updated.reviewedAt;
      request.approvedBy = updated.approvedBy;
      request.approvedAt = updated.approvedAt;

      await createStaffNotification({
        title: "🔔 Request Approved",
        message: `✅ Your request for ${request.itemName} (${request.quantity} ${request.unit}) has been approved and is ready to be issued.`,
        audienceId: request.userId,
        category: "inventory",
      });
    } else if (normalizedStatus === "Rejected") {
      if (request.status === "Approved") {
        return res.status(400).json({ success: false, message: "Cannot reject an already approved request." });
      }
      if (request.status === "Rejected") {
        return res.status(400).json({ success: false, message: "This request has already been rejected." });
      }

      const actor = clean(reviewedBy) || (req.user ? req.user.name : "Admin");
      const updated = await inventoryRequestService.updateById(id, {
        status: "Rejected",
        adminReason: clean(adminReason) || clean(rejectionReason),
        rejectionReason: clean(rejectionReason) || clean(adminReason),
        reviewedBy: actor,
        reviewedAt: new Date(),
        rejectedAt: new Date(),
      });
      request.status = updated.status;
      request.adminReason = updated.adminReason;
      request.rejectionReason = updated.rejectionReason;
      request.reviewedBy = updated.reviewedBy;
      request.reviewedAt = updated.reviewedAt;
      request.rejectedAt = updated.rejectedAt;

      await createStaffNotification({
        title: "🔔 Request Rejected",
        message: `Your request for ${request.itemName} (${request.quantity} ${request.unit}) has been rejected.\nReason: ${request.adminReason}`,
        audienceId: request.userId,
        category: "inventory",
      });
    }

    return res.json({ success: true, request });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/admin/inventory-requests/:id/issue
//
// Issuing is an atomic cross-entity business operation: it loads the request,
// decrements InventoryItem.availableStock / increments
// InventoryItem.issuedStock, writes an InventoryIssue row and sets the
// request's status to 'Issued', all inside ONE Mongo multi-document
// transaction (mongoose.startSession).
//
// InventoryIssue is still Mongo-backed and PostgreSQL has no inventory_issues
// table (Phase 2AC audit, "MongoDB-only models"), so a Mongo session and a
// PostgreSQL pool cannot participate in one atomic unit. Splitting the flow
// would leave partial state (stock decremented with no issue record, or vice
// versa), which is worse than not supporting the operation on PostgreSQL.
// Issuing therefore stays wholly on the Mongoose path and is the single
// datasource for the whole operation; the standalone request endpoints
// (create / list / summary / approve / reject) keep the Phase 2L seam.
//
// Because create/approve can persist a request to PostgreSQL, this handler
// refuses an operation it cannot perform correctly instead of failing with a
// misleading "not found": when the seam selects PostgreSQL and the request
// exists there, it returns 409 with the explicit limitation.
exports.issueInventoryRequest = async (req, res) => {
  const mongoose = require("mongoose");
  const { id } = req.params;

  if (await inventoryRequestService.usePostgres()) {
    const postgresRequest = await inventoryRequestService.findById(id).catch(() => null);
    if (postgresRequest) {
      return res.status(409).json({
        success: false,
        message:
          "Issuing is not yet available for requests stored in PostgreSQL: the operation " +
          "also writes an InventoryIssue record, which has no PostgreSQL table, so it " +
          "cannot share one transaction. Use the MongoDB path to issue this request.",
      });
    }
  }

  const session = await mongoose.startSession();
  
  try {
    let resultRequest, resultIssue;
    await session.withTransaction(async () => {
      const request = await InventoryRequest.findById(id).session(session);
      if (!request) throw new Error("Inventory request not found");
      
      if (request.status !== "Approved") {
        throw new Error("Only approved requests can be issued.");
      }

      const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const inventoryItems = await InventoryItem.find({
        name: { $regex: new RegExp(`^${escapeRegExp(request.itemName)}$`, "i") },
      }).session(session);

      if (!inventoryItems || inventoryItems.length === 0) {
        throw new Error("Inventory item not found.");
      }

      const parsedQty = parseFloat(request.quantity);
      let inventoryItem = inventoryItems.find(item => item.availableStock >= parsedQty);

      if (!inventoryItem) {
        throw new Error(`Insufficient inventory stock for ${request.itemName}. Needed: ${parsedQty}.`);
      }

      inventoryItem.availableStock -= parsedQty;
      inventoryItem.issuedStock = (inventoryItem.issuedStock || 0) + parsedQty;
      await inventoryItem.save({ session });

      request.status = "Issued";
      request.issuedAt = new Date();
      await request.save({ session });

      resultIssue = await InventoryIssue.create([{
        request: request._id,
        item: inventoryItem._id,
        itemName: inventoryItem.name,
        userId: request.userId,
        userName: request.userName,
        role: request.role,
        issuedQuantity: parsedQty,
        unit: inventoryItem.unit,
        issuedBy: req.user ? req.user.name || req.user.id : "Admin",
        purpose: request.purpose || request.reason,
      }], { session });

      await createStaffNotification({
        title: "📦 Items Issued",
        message: `Your approved request for ${request.itemName} (${request.quantity} ${request.unit}) has been issued.`,
        audienceId: request.userId,
        category: "inventory",
      });

      if (inventoryItem.availableStock <= inventoryItem.minimumStock) {
        await createStaffNotification({
          title: "⚠️ Low Stock Alert",
          message: `${inventoryItem.name} stock is now at or below minimum level. Current: ${inventoryItem.availableStock} ${inventoryItem.unit}, Minimum: ${inventoryItem.minimumStock} ${inventoryItem.unit}. Please reorder soon.`,
          audienceRole: "admin",
          category: "inventory",
        });
      }
      
      resultRequest = request;
    });
    
    session.endSession();
    return res.json({ success: true, request: resultRequest, issue: resultIssue[0] });
  } catch (error) {
    if (error.message.includes("not found") || error.message.includes("Insufficient") || error.message.includes("Only approved")) {
       return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
