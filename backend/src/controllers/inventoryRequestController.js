// Inventory Request persistence is additive (Phase 2L): the service selects
// PostgreSQL when the Inventory Request path is explicitly used and PostgreSQL
// is reachable, and otherwise falls back to the existing Mongoose model.
//
// Phase 2AH migrates InventoryIssue, so the multi-entity issue flow now has a
// complete PostgreSQL path: when the seam selects PostgreSQL, the request
// transition, the InventoryItem stock movement and the InventoryIssue row are
// written in ONE PostgreSQL transaction (see exports.issueInventoryRequest).
// The MongoDB path keeps its existing single Mongo multi-document transaction.
const inventoryRequestService = require("../services/inventoryRequestService");
const inventoryIssueService = require("../services/inventoryIssueService");
const inventoryItemService = require("../services/inventoryItemService");
const { runInTransaction } = require("../config/postgres");
// Direct model import retained for the MongoDB issue path, which keeps its
// single Mongo multi-document transaction (InventoryItem + InventoryIssue +
// InventoryRequest).
const InventoryRequest = require("../models/InventoryRequest");
const InventoryItem = require("../models/InventoryItem");
const InventoryIssue = require("../models/InventoryIssue");
const { createStaffNotification } = require("../utils/notificationService");
const { seedDefaultItems } = require("./inventoryItemController");

// A 4xx-worthy failure inside the PostgreSQL issuance unit of work. Throwing
// rolls the transaction back, so a refused issue leaves no partial state.
class IssueOperationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
// request's status to 'Issued'.
//
// Phase 2AH migrated InventoryIssue to PostgreSQL, so the operation now has a
// complete path on EITHER datasource — but never both:
//
//   * PostgreSQL selected (seam connected AND PG reachable): the request
//     transition, the item stock movement and the InventoryIssue row are
//     written inside ONE PostgreSQL transaction on a single pooled client. A
//     failure anywhere rolls the whole issuance back, so the stock decrement and
//     the issue record can never diverge.
//   * PostgreSQL not selected: the existing Mongo multi-document transaction
//     (mongoose.startSession) runs unchanged.
//
// Exactly one datasource participates in the operation.
exports.issueInventoryRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const issuedBy = req.user ? req.user.name || req.user.id : "Admin";
    const usePostgres = await inventoryRequestService.usePostgres();

    if (usePostgres) {
      return await issueInventoryRequestPostgres(req, res, { id, issuedBy });
    }
    return await issueInventoryRequestMongo(req, res, { id, issuedBy });
  } catch (error) {
    if (error instanceof IssueOperationError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PostgreSQL issuance path — ONE transaction covering the request transition,
 * the item stock movement and the InventoryIssue row.
 */
const issueInventoryRequestPostgres = async (req, res, { id, issuedBy }) => {
  // The whole operation must be PG-native. If the item or issue store is not
  // available on PostgreSQL, refuse rather than half-write across datasources.
  const itemUsesPostgres = await inventoryItemService.usePostgres();
  const issueUsesPostgres = await inventoryIssueService.usePostgres();
  if (!itemUsesPostgres || !issueUsesPostgres) {
    return res.status(500).json({
      success: false,
      message:
        "Issuing requires a single datasource: the request, item and issue stores " +
        "must all be available on PostgreSQL for this operation.",
    });
  }

  const result = await runInTransaction(async (client) => {
    const request = await inventoryRequestService.findById(id, client);
    if (!request) {
      throw new IssueOperationError(400, "Inventory request not found");
    }

    if (request.status !== "Approved") {
      throw new IssueOperationError(400, "Only approved requests can be issued.");
    }

    const parsedQty = parseFloat(request.quantity);
    if (!Number.isFinite(parsedQty)) {
      throw new IssueOperationError(400, `Invalid request quantity for ${request.itemName}.`);
    }

    const candidates = await inventoryItemService.findByName(request.itemName, client);
    if (!candidates || candidates.length === 0) {
      throw new IssueOperationError(400, "Inventory item not found.");
    }

    const inventoryItem = candidates.find((item) => Number(item.availableStock) >= parsedQty);
    if (!inventoryItem) {
      throw new IssueOperationError(
        400,
        `Insufficient inventory stock for ${request.itemName}. Needed: ${parsedQty}.`
      );
    }

    const updatedItem = await inventoryItemService.updateById(
      inventoryItem._id,
      {
        availableStock: Number(inventoryItem.availableStock) - parsedQty,
        issuedStock: Number(inventoryItem.issuedStock || 0) + parsedQty,
      },
      client
    );

    const updatedRequest = await inventoryRequestService.updateById(
      id,
      { status: "Issued", issuedAt: new Date() },
      client
    );

    const issue = await inventoryIssueService.create(
      {
        request: request._id,
        item: inventoryItem._id,
        itemName: inventoryItem.name,
        userId: request.userId,
        userName: request.userName,
        role: request.role,
        issuedQuantity: parsedQty,
        unit: inventoryItem.unit,
        issuedBy,
        purpose: request.purpose || request.reason,
      },
      client
    );

    return { request: updatedRequest || request, issue, item: updatedItem || inventoryItem };
  });

  // Notifications are dispatched AFTER the transaction commits: they are
  // side-channel and must not be able to roll back the issuance.
  await createStaffNotification({
    title: "📦 Items Issued",
    message: `Your approved request for ${result.request.itemName} (${result.request.quantity} ${result.request.unit}) has been issued.`,
    audienceId: result.request.userId,
    category: "inventory",
  });

  if (Number(result.item.availableStock) <= Number(result.item.minimumStock)) {
    await createStaffNotification({
      title: "⚠️ Low Stock Alert",
      message: `${result.item.name} stock is now at or below minimum level. Current: ${result.item.availableStock} ${result.item.unit}, Minimum: ${result.item.minimumStock} ${result.item.unit}. Please reorder soon.`,
      audienceRole: "admin",
      category: "inventory",
    });
  }

  return res.json({ success: true, request: result.request, issue: result.issue });
};

/**
 * MongoDB issuance path — the pre-Phase-2AH implementation, preserved exactly:
 * ONE Mongo multi-document transaction, no PostgreSQL writes.
 */
const issueInventoryRequestMongo = async (req, res, { id, issuedBy }) => {
  const mongoose = require("mongoose");
  const session = await mongoose.startSession();

  try {
    let resultRequest, resultIssue;
    await session.withTransaction(async () => {
      const request = await InventoryRequest.findById(id).session(session);
      if (!request) throw new Error("Inventory request not found");

      if (request.status !== "Approved") {
        throw new Error("Only approved requests can be issued.");
      }

      const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inventoryItems = await InventoryItem.find({
        name: { $regex: new RegExp(`^${escapeRegExp(request.itemName)}$`, "i") },
      }).session(session);

      if (!inventoryItems || inventoryItems.length === 0) {
        throw new Error("Inventory item not found.");
      }

      const parsedQty = parseFloat(request.quantity);
      let inventoryItem = inventoryItems.find((item) => item.availableStock >= parsedQty);

      if (!inventoryItem) {
        throw new Error(`Insufficient inventory stock for ${request.itemName}. Needed: ${parsedQty}.`);
      }

      inventoryItem.availableStock -= parsedQty;
      inventoryItem.issuedStock = (inventoryItem.issuedStock || 0) + parsedQty;
      await inventoryItem.save({ session });

      request.status = "Issued";
      request.issuedAt = new Date();
      await request.save({ session });

      resultIssue = await InventoryIssue.create(
        [
          {
            request: request._id,
            item: inventoryItem._id,
            itemName: inventoryItem.name,
            userId: request.userId,
            userName: request.userName,
            role: request.role,
            issuedQuantity: parsedQty,
            unit: inventoryItem.unit,
            issuedBy,
            purpose: request.purpose || request.reason,
          },
        ],
        { session }
      );

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
    session.endSession();
    if (
      error.message.includes("not found") ||
      error.message.includes("Insufficient") ||
      error.message.includes("Only approved")
    ) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
