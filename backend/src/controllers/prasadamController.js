const Prasadam = require("../models/Prasadam");
const PrasadamOrder = require("../models/PrasadamOrder");
const { createStaffNotification } = require("../utils/notificationService");
const prasadamOrderService = require("../services/prasadamOrderService");

const clean = (value) => String(value || "").trim();

// GET /api/prasadam
const getAllPrasadam = async (req, res) => {
  try {
    const items = await Prasadam.find().sort({ name: 1 });
    return res.json({ success: true, items });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/prasadam
const createPrasadam = async (req, res) => {
  try {
    const { name, price, availableQuantity, minimumStock } = req.body;

    if (!clean(name)) {
      return res.status(400).json({ success: false, message: "Prasadam name is required." });
    }

    const newPrasadam = await Prasadam.create({
      name: clean(name),
      price: Number(price) || 0,
      availableQuantity: Number(availableQuantity) || 0,
      minimumStock: Number(minimumStock) || 0,
    });

    try {
      const { createBroadcastNotifications } = require("../utils/notificationService");
      await createBroadcastNotifications({
        title: `New Prasadam Available: ${newPrasadam.name}`,
        message: `Prasadam "${newPrasadam.name}" is now available for purchase for Rs ${newPrasadam.price.toLocaleString("en-IN")}.`,
        category: "prasada",
        role: "devotee",
      });
    } catch (err) {
      console.warn("Failed to create devotee notification for new prasadam", err);
    }

    return res.status(201).json({ success: true, item: newPrasadam });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Prasadam with this name already exists." });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/prasadam/:id
const updatePrasadam = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, availableQuantity, minimumStock } = req.body;

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = clean(name);
    if (price !== undefined) updatePayload.price = Number(price);
    if (availableQuantity !== undefined) updatePayload.availableQuantity = Number(availableQuantity);
    if (minimumStock !== undefined) updatePayload.minimumStock = Number(minimumStock);

    const oldItem = await Prasadam.findById(id);
    if (!oldItem) {
      return res.status(404).json({ success: false, message: "Prasadam not found." });
    }

    const priceChanged = price !== undefined && Number(price) !== oldItem.price;

    const item = await Prasadam.findByIdAndUpdate(id, updatePayload, { new: true });

    if (priceChanged) {
      try {
        const { createBroadcastNotifications } = require("../utils/notificationService");
        await createBroadcastNotifications({
          title: `Prasadam Price Updated: ${item.name}`,
          message: `The price of ${item.name} has been updated to Rs ${item.price.toLocaleString("en-IN")}.`,
          category: "prasada",
          role: "devotee",
        });
      } catch (err) {
        console.warn("Failed to create devotee notification for prasadam price change", err);
      }
    }

    if (item.availableQuantity <= item.minimumStock) {
      await createStaffNotification({
        title: "⚠️ Low Prasadam Stock",
        message: `${item.name} stock is low. Current: ${item.availableQuantity}, Minimum: ${item.minimumStock}.`,
        audienceRole: "admin",
        category: "inventory",
      });
    }

    return res.json({ success: true, item });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Prasadam with this name already exists." });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/prasadam/:id/restock
const restockPrasadam = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantityAdded } = req.body;

    if (!quantityAdded || Number(quantityAdded) <= 0) {
      return res.status(400).json({ success: false, message: "Valid quantity added is required." });
    }

    const item = await Prasadam.findById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Prasadam not found." });
    }

    item.availableQuantity += Number(quantityAdded);
    await item.save();

    return res.json({ success: true, message: "Prasadam restocked successfully", item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/prasadam/:id
const deletePrasadam = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Prasadam.findByIdAndDelete(id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Prasadam not found." });
    }
    return res.json({ success: true, message: "Prasadam deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/prasadam/reports/sales
const getSalesReports = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // PostgreSQL path (additive): when Prasadam Orders use the PostgreSQL
    // repository, sales reports are computed from the same normalized records.
    // The aggregation mirrors the Mongo aggregate below.
    if (await prasadamOrderService.usePostgres()) {
      const { query } = require("../config/postgres");
      const [todaySales, monthlySales] = await Promise.all([
        (async () => {
          const { rows } = await query(
            `SELECT COALESCE(SUM(amount), 0)::numeric AS total_revenue, COUNT(*)::int AS total_orders
             FROM prasadam_orders WHERE created_at >= $1`,
            [todayStart]
          );
          return rows[0];
        })(),
        (async () => {
          const { rows } = await query(
            `SELECT COALESCE(SUM(amount), 0)::numeric AS total_revenue, COUNT(*)::int AS total_orders
             FROM prasadam_orders WHERE created_at >= $1`,
            [monthStart]
          );
          return rows[0];
        })(),
      ]);
      const { rows: topSelling } = await query(
        `SELECT item_name, SUM(quantity)::numeric AS total_quantity
         FROM prasadam_orders WHERE created_at >= $1
         GROUP BY item_name ORDER BY total_quantity DESC LIMIT 5`,
        [monthStart]
      );

      return res.json({
        success: true,
        reports: {
          today: {
            totalRevenue: todaySales.total_revenue === null ? 0 : Number(todaySales.total_revenue),
            totalOrders: todaySales.total_orders || 0,
          },
          monthly: {
            totalRevenue: monthlySales.total_revenue === null ? 0 : Number(monthlySales.total_revenue),
            totalOrders: monthlySales.total_orders || 0,
          },
          topSelling: topSelling.map((r) => ({
            _id: r.item_name,
            totalQuantity: Number(r.total_quantity),
          })),
        },
      });
    }

    const [todaySales, monthlySales] = await Promise.all([
      PrasadamOrder.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" }, totalOrders: { $sum: 1 } } }
      ]),
      PrasadamOrder.aggregate([
        { $match: { createdAt: { $gte: monthStart } } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" }, totalOrders: { $sum: 1 } } }
      ])
    ]);

    const topSelling = await PrasadamOrder.aggregate([
      { $match: { createdAt: { $gte: monthStart } } },
      { $group: { _id: "$itemName", totalQuantity: { $sum: "$quantity" } } },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 }
    ]);

    return res.json({
      success: true,
      reports: {
        today: todaySales[0] || { totalRevenue: 0, totalOrders: 0 },
        monthly: monthlySales[0] || { totalRevenue: 0, totalOrders: 0 },
        topSelling,
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllPrasadam,
  createPrasadam,
  updatePrasadam,
  restockPrasadam,
  deletePrasadam,
  getSalesReports,
};
