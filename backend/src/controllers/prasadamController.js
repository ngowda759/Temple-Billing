const { createStaffNotification } = require("../utils/notificationService");
const prasadamOrderService = require("../services/prasadamOrderService");
const prasadamService = require("../services/prasadamService");

const clean = (value) => String(value || "").trim();

// GET /api/prasadam
const getAllPrasadam = async (req, res) => {
  try {
    const items = await prasadamService.findMany({ sort: { name: 1 } });
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

    const newPrasadam = await prasadamService.create({
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

    const oldItem = await prasadamService.findById(id);
    if (!oldItem) {
      return res.status(404).json({ success: false, message: "Prasadam not found." });
    }

    const priceChanged = price !== undefined && Number(price) !== Number(oldItem.price);

    const item = await prasadamService.updateById(id, updatePayload);

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

    const item = await prasadamService.incrementById(id, Number(quantityAdded));
    if (!item) {
      return res.status(404).json({ success: false, message: "Prasadam not found." });
    }

    return res.json({ success: true, message: "Prasadam restocked successfully", item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/prasadam/:id
const deletePrasadam = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prasadamService.destroy(id);
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

    // Reports read through the Prasadam Order service so they follow the same
    // datasource seam as every other Prasadam Order read: PostgreSQL when the
    // Prasadam Order path is active and PostgreSQL is reachable, the Mongoose
    // model otherwise. The repository owns the branch (like findMany/count), so
    // an unreachable PostgreSQL falls back to the Mongo aggregation instead of
    // failing the endpoint. The aggregation semantics — date filters, grouping,
    // sorting, LIMIT 5 and the response shape — are unchanged.
    const [todaySales, monthlySales, topSelling] = await Promise.all([
      prasadamOrderService.aggregateSalesTotals(todayStart),
      prasadamOrderService.aggregateSalesTotals(monthStart),
      prasadamOrderService.aggregateTopSelling(monthStart, 5),
    ]);

    return res.json({
      success: true,
      reports: {
        today: todaySales,
        monthly: monthlySales,
        topSelling,
      },
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
