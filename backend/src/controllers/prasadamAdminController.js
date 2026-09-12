const PrasadamOrder = require("../models/PrasadamOrder");
const Prasadam = require("../models/Prasadam");
const Bill = require("../models/Bill");
const { createStaffNotification } = require("../utils/notificationService");
const prasadamOrderService = require("../services/prasadamOrderService");
const { mapToModelStatuses, mapFromModelStatus } = require("../utils/prasadamOrderHelper");

const clean = (v) => String(v || "").trim();

const ALLOWED_ORDER_STATUSES = [
  "Collected",
  "Not Collected",
  "Pending",
  "Approved",
  "Rejected",
  "Processing",
  "Ready for Pickup",
  "Completed",
  "Cancelled",
];

const buildOrderList = (orders) => {
  return orders.map((o) => ({
    ...(o.toObject?.() || o),
    orderStatusDisplay: mapFromModelStatus(o.status),
  }));
};

// GET /api/admin/prasadam-orders
exports.getAdminPrasadamOrders = async (req, res) => {
  try {
    const {
      search = "",
      status = "",
      startDate = "",
      endDate = "",
      page = "1",
      limit = "10",
    } = req.query;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (p - 1) * l;

    const q = clean(search).toLowerCase();

    let statusFilter = [];
    const normalizedStatus = clean(status);
    if (normalizedStatus) {
      statusFilter = mapToModelStatuses(normalizedStatus);
    }

    // PostgreSQL path (additive): the Prasadam Order service prefers
    // PostgreSQL when it is reachable and the Prasadam Order path is active.
    // The filter mirrors the Mongo query below field-for-field.
    if (await prasadamOrderService.usePostgres()) {
      const filter = { channel: "devotee" };
      if (statusFilter.length) filter.status = statusFilter.length === 1 ? statusFilter[0] : { $in: statusFilter };
      const sd = startDate ? new Date(startDate) : null;
      const ed = endDate ? new Date(endDate) : null;
      if (sd && !Number.isNaN(sd.getTime())) {
        filter.createdAt = { ...(filter.createdAt || {}), $gte: sd };
      }
      if (ed && !Number.isNaN(ed.getTime())) {
        const end = new Date(ed);
        end.setHours(23, 59, 59, 999);
        filter.createdAt = { ...(filter.createdAt || {}), $lte: end };
      }
      if (q) filter.search = q;

      const [total, orders] = await Promise.all([
        prasadamOrderService.count(filter),
        prasadamOrderService.findMany({ filter, sort: { createdAt: -1 }, limit: l, offset: skip }),
      ]);

      return res.json({
        orders: buildOrderList(orders),
        total,
        page: p,
        limit: l,
        totalPages: Math.max(1, Math.ceil(total / l)),
      });
    }

    const dateFilter = {};
    const sd = startDate ? new Date(startDate) : null;
    const ed = endDate ? new Date(endDate) : null;
    if (sd && !Number.isNaN(sd.getTime())) dateFilter.$gte = sd;
    if (ed && !Number.isNaN(ed.getTime())) {
      ed.setHours(23, 59, 59, 999);
      dateFilter.$lte = ed;
    }

    const mongoQuery = { $and: [{ $or: [{ channel: "devotee" }, { channel: { $exists: false } }] }] };
    if (statusFilter.length) {
      mongoQuery.$and.push(statusFilter.length === 1 ? { status: statusFilter[0] } : { status: { $in: statusFilter } });
    }
    if (Object.keys(dateFilter).length) mongoQuery.$and.push({ createdAt: dateFilter });

    if (q) {
      mongoQuery.$or = [
        { devoteeName: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { itemName: { $regex: q, $options: "i" } },
        { amount: { $regex: q } },
        { cashierName: { $regex: q, $options: "i" } },
      ];
    }

    const [total, orders] = await Promise.all([
      PrasadamOrder.countDocuments(mongoQuery),
      PrasadamOrder.find(mongoQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l),
    ]);

    return res.json({
      orders: buildOrderList(orders),
      total,
      page: p,
      limit: l,
      totalPages: Math.max(1, Math.ceil(total / l)),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/prasadam-orders/:id
exports.getAdminPrasadamOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await prasadamOrderService.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const obj = order.toObject?.() || order;
    obj.orderStatusDisplay = mapFromModelStatus(order.status);
    return res.json({ success: true, order: obj });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/prasadam-orders/:id/status
exports.updateAdminPrasadamOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminReason = "" } = req.body;

    const incoming = clean(status);
    if (!incoming || !ALLOWED_ORDER_STATUSES.includes(incoming)) {
      return res.status(400).json({ success: false, message: "Invalid order status" });
    }

    let order = await prasadamOrderService.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const mappedStatuses = mapToModelStatuses(incoming);
    const modelStatus = mappedStatuses[0];
    if (!modelStatus) {
      return res.status(400).json({ success: false, message: "Invalid status mapping" });
    }

    const prevModelStatus = order.status;
    // Persist the status change through the active Prasadam Order path so the
    // PostgreSQL repository and the Mongoose model behave identically.
    const savedOrder = await prasadamOrderService.updateById(id, { status: modelStatus });
    if (!savedOrder) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    // Re-read so downstream code (Bill sync + transaction + notification)
    // always works with the persisted document; the raw field values are
    // authoritative for what was just written.
    order = savedOrder;

    // Sync bill ledger status as well
    await Bill.updateMany(
      { sourceId: order._id.toString() },
      { $set: { status: modelStatus === "Collected" || modelStatus === "Completed" || modelStatus === "Delivered" || modelStatus === "Ready" ? "Paid" : "Pending" } }
    );

    const isPaidStatus = ["Collected", "Completed", "Delivered", "Ready"].includes(modelStatus);
    const wasPaidStatus = ["Collected", "Completed", "Delivered", "Ready"].includes(prevModelStatus);

    if (!wasPaidStatus && isPaidStatus) {
      const { recordTransaction } = require("../services/accountingService");
      await recordTransaction({
        transactionType: "Credit",
        source: "Prasadam",
        category: "Prasadam Sales",
        amount: order.amount,
        paymentMethod: order.paymentMethod || "System",
        description: `Prasadam Order: ${order.orderNumber || order._id}`,
        referenceId: order._id,
        referenceModel: "PrasadamOrder",
        recordedBy: req.user ? req.user.id : null,
        status: "Completed"
      });
    } else if (wasPaidStatus && modelStatus === "Cancelled") {
      const { recordTransaction } = require("../services/accountingService");
      await recordTransaction({
        transactionType: "Debit",
        source: "Prasadam",
        category: "Refund Account",
        amount: order.amount,
        paymentMethod: order.paymentMethod || "System",
        description: `Refund for Cancelled Prasadam Order: ${order.orderNumber || order._id}`,
        referenceId: order._id,
        referenceModel: "PrasadamOrder",
        recordedBy: req.user ? req.user.id : null,
        status: "Completed"
      });
    }

    await createStaffNotification({
      title: `🔔 Prasadam Order Updated`,
      message: `${order.devoteeName || order.customerName || "Guest"} - ${order.itemName} status changed: ${prevModelStatus} → ${modelStatus}$${adminReason ? `\\nReason: ${adminReason}` : ""}`.replace("$${", "${"),
      audienceRole: "admin",
      category: "prasadam",
    }).catch(() => {});

    const obj = order.toObject?.() || order;
    obj.orderStatusDisplay = mapFromModelStatus(order.status);

    return res.json({ success: true, order: obj });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAdminPrasadamOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await prasadamOrderService.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    await Promise.all([
      prasadamOrderService.destroy(id),
      // Bills stay Mongo-backed during Phase 2G; the polymorphic sourceId
      // reference is preserved and cleaned up exactly as before.
      Bill.deleteMany({ sourceId: String(id) }),
    ]);

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
