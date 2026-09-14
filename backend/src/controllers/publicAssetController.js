const RepairTicket = require("../models/RepairTicket");
const Supplier = require("../models/Supplier");
const assetService = require("../services/assetService");

// Resolves the supplier of an asset on either datasource. The Mongoose
// populate path leaves asset.supplier as the populated Supplier document (its
// name is read directly); the plain-id path (PG rows store the Mongo supplier
// id as TEXT, and the Mongo fallback without a populate returns the bare
// ObjectId) resolves the Supplier by id from the Mongo collection — suppliers
// stay Mongo-backed this phase, so the same collection serves both paths.
// Unresolvable suppliers return 'N/A', exactly the populate-null contract the
// route had before this migration.
const supplierName = async (asset) => {
  const value = asset && asset.supplier;
  if (!value) return "N/A";
  if (typeof value === "object" && value.name) return value.name;
  try {
    const supplier = await Supplier.findById(String(value));
    return supplier && supplier.name ? supplier.name : "N/A";
  } catch {
    return "N/A";
  }
};

exports.getPublicAssetDetails = async (req, res) => {
  try {
    const { assetId } = req.params;

    // Find the asset by its custom assetId or _id
    let asset = await assetService.findOne({ assetId });

    // If not found by custom ID, try finding by MongoDB _id just in case
    if (!asset && assetId.match(/^[0-9a-fA-F]{24}$/)) {
      asset = await assetService.findById(assetId);
    }

    if (!asset) {
      return res.status(404).json({ success: false, message: "Asset not found" });
    }

    // Find maintenance history (RepairTickets) for this asset. RepairTicket
    // stays Mongo-backed (Repairs are not part of this phase).
    const maintenanceHistory = await RepairTicket.find({ asset: asset._id })
      .populate("reportedBy", "name")
      .populate("approvedBy", "name")
      .sort({ createdAt: -1 });

    // Return combined public details
    res.json({
      success: true,
      asset: {
        id: asset._id,
        assetId: asset.assetId,
        name: asset.name,
        category: asset.category,
        purchaseDate: asset.purchaseDate,
        assignedLocation: asset.assignedLocation,
        status: asset.status,
        warranty: asset.warranty,
        supplier: await supplierName(asset),
      },
      maintenanceHistory,
    });
  } catch (error) {
    console.error("Error fetching public asset details:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
