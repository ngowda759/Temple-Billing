const RepairRequest = require("../models/RepairRequest");
const AccountTransaction = require("../models/AccountTransaction");
const assetService = require("../services/assetService");

const clean = (val) => String(val || "").trim();

// The Asset list/read responses pass through the service's Mongo-shaped
// document verbatim: on the PostgreSQL path supplier is the plain supplier id
// string, on the Mongo fallback path it stays whatever the model returns. The
// admin frontend does not render a populated supplier in the asset list/QR
// cards, and AssetScanResult reads supplier as a name string assembled by
// publicAssetController below, so no populate-specific projection is needed
// here.
const toAssetResponse = (asset) => asset;

exports.getAllAssets = async (req, res) => {
  try {
    const assets = await assetService.findMany({ sort: { name: 1 } });
    res.json({ success: true, assets: assets.map(toAssetResponse) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createAsset = async (req, res) => {
  try {
    const { assetId, name, category, purchaseDate, supplier, invoiceNumber, warranty, assignedLocation, status, purchaseCost, serialNumber } = req.body;
    if (!clean(assetId) || !clean(name)) return res.status(400).json({ success: false, message: "Asset ID and Name are required" });

    const asset = await assetService.create({
      assetId: clean(assetId),
      name: clean(name),
      category: clean(category),
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      supplier: supplier || null,
      invoiceNumber: clean(invoiceNumber),
      warranty: clean(warranty),
      assignedLocation: clean(assignedLocation),
      status: clean(status) || "Active",
      purchaseCost: Number(purchaseCost) || 0,
      serialNumber: clean(serialNumber)
    });
    res.status(201).json({ success: true, asset: toAssetResponse(asset) });
  } catch (error) {
    // Mirror the Mongo 11000 duplicate-key contract for the PG path so the
    // route keeps returning HTTP 409 "Asset ID already exists".
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Asset ID already exists" });
    if (/unique constraint "assets_asset_id_key"/.test(error.message)) {
      return res.status(409).json({ success: false, message: "Asset ID already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAsset = async (req, res) => {
  try {
    const asset = await assetService.updateById(req.params.id, req.body);
    if (!asset) return res.status(404).json({ success: false, message: "Asset not found" });
    res.json({ success: true, asset: toAssetResponse(asset) });
  } catch (error) {
    if (/unique constraint "assets_asset_id_key"/.test(error.message)) {
      return res.status(409).json({ success: false, message: "Asset ID already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
    const deleted = await assetService.destroy(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Asset not found" });
    res.json({ success: true, message: "Asset deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Repairs
exports.getAllRepairs = async (req, res) => {
  try {
    const repairs = await RepairRequest.find().populate("asset").sort({ createdAt: -1 });
    res.json({ success: true, repairs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createRepair = async (req, res) => {
  try {
    const { asset, description, vendor, cost, invoiceNumber } = req.body;
    if (!asset || !description) return res.status(400).json({ success: false, message: "Asset and description required" });

    const repair = await RepairRequest.create({
      asset,
      description: clean(description),
      vendor: clean(vendor),
      cost: Number(cost) || 0,
      invoiceNumber: clean(invoiceNumber),
      status: "Pending",
      createdBy: req.user ? req.user.id : null
    });
    res.status(201).json({ success: true, repair });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.completeRepair = async (req, res) => {
  try {
    const repair = await RepairRequest.findById(req.params.id).populate("asset");
    if (!repair) return res.status(404).json({ success: false, message: "Repair request not found" });

    if (repair.status === "Completed") {
      return res.status(400).json({ success: false, message: "Repair is already marked as completed." });
    }

    repair.status = "Completed";
    repair.completionDate = req.body.completionDate ? new Date(req.body.completionDate) : new Date();
    if (req.body.cost) repair.cost = Number(req.body.cost);
    if (req.body.invoiceNumber) repair.invoiceNumber = clean(req.body.invoiceNumber);
    const paymentMethod = clean(req.body.paymentMethod) || "System";
    const remarks = clean(req.body.remarks);
    await repair.save();

    // Update maintenance history on the asset. The repair itself stays
    // Mongo-backed (RepairRequest is not part of this phase); only the asset
    // write is routed through the assetService so it lands on the same
    // datasource the asset was created on.
    const assetId = repair.asset && typeof repair.asset === "object"
      ? repair.asset._id || repair.asset.id
      : repair.asset;
    await assetService.addMaintenanceRecord(assetId, {
      repairDate: repair.completionDate,
      description: repair.description + (remarks ? ` - Remarks: ${remarks}` : ""),
      cost: repair.cost,
      vendor: repair.vendor
    });

    if (repair.cost > 0) {
      const { recordTransaction } = require("../services/accountingService");
      await recordTransaction({
        transactionType: "Debit",
        source: "Repair",
        category: "Repair Expense",
        amount: repair.cost,
        paymentMethod: paymentMethod,
        description: `Repair completed for asset ${repair.asset.name}. Vendor: ${repair.vendor}` + (remarks ? ` - Remarks: ${remarks}` : ""),
        referenceId: repair._id,
        referenceModel: "RepairRequest",
        recordedBy: req.user ? req.user.id : null,
      });
    }

    res.json({ success: true, repair });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
