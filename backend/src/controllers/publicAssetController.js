const Employee = require("../models/Employee");
const Supplier = require("../models/Supplier");
const assetService = require("../services/assetService");
const repairTicketService = require("../services/repairTicketService");

// Resolves the supplier of an asset on either datasource. The Mongoose
// populate path leaves asset.supplier as the populated Supplier document (its
// name is read directly); the plain-id path (PG rows store the Mongo supplier
// id as TEXT, and the Mongo fallback without a populate returns the bare
// ObjectId) resolves the Supplier by id from the Mongo collection — suppliers
// stay Mongo-backed, so the same collection serves both paths.
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

// Normalizes a repair/asset document from either datasource into a plain
// object.
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

// Repairs are read through the service so they follow the selected
// datasource (PostgreSQL when available, otherwise the existing Mongoose
// model). The pre-migration route populated `reportedBy` / `approvedBy` with
// the Employee name; employees stay Mongo-backed, so the referenced name is
// resolved from the Mongo collection on both paths — preserving the exact
// response shape AssetScanResult renders.
const populateTicket = async (ticket) => {
  const doc = plain(ticket);
  if (!doc) return doc;
  const populated = { ...doc };
  for (const field of ["reportedBy", "approvedBy"]) {
    const value = doc[field];
    if (!value) continue;
    const id = typeof value === "object" ? value._id || value.id : value;
    try {
      const employee = await Employee.findById(String(id));
      if (employee) populated[field] = plain(employee);
    } catch {
      // Unresolvable references keep their raw id, exactly like populate
      // leaving the field untouched when the target is missing.
    }
  }
  return populated;
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

    const assetDoc = plain(asset);
    const assetPk = assetDoc._id || assetDoc.id;

    // Find maintenance history (RepairTickets) for this asset, on whichever
    // datasource the service selects.
    const tickets = await repairTicketService.findMany({
      filter: { asset: assetPk },
      sort: { createdAt: -1 },
    });
    const maintenanceHistory = await Promise.all(tickets.map(populateTicket));

    // Return combined public details
    res.json({
      success: true,
      asset: {
        id: assetPk,
        assetId: assetDoc.assetId,
        name: assetDoc.name,
        category: assetDoc.category,
        purchaseDate: assetDoc.purchaseDate,
        assignedLocation: assetDoc.assignedLocation,
        status: assetDoc.status,
        warranty: assetDoc.warranty,
        supplier: await supplierName(assetDoc),
      },
      maintenanceHistory,
    });
  } catch (error) {
    console.error("Error fetching public asset details:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
