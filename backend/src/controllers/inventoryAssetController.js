const AccountTransaction = require("../models/AccountTransaction");
const assetService = require("../services/assetService");
const repairRequestService = require("../services/repairRequestService");

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

// Repair requests are read/written through the service so they follow the
// selected datasource (PostgreSQL when available, otherwise the existing
// Mongoose model). Both datasources return the same Mongo-shaped document;
// the only difference is that references stay plain id strings on the
// PostgreSQL path, so the populated `asset` shape the admin UI expects is
// reassembled here.

// Normalizes a repair/asset document from either datasource into a plain
// object so responses are identical on the PostgreSQL path (plain repository
// object) and the Mongo fallback path (Mongoose document).
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

const withPopulatedAsset = async (repair) => {
  const doc = plain(repair);
  if (!doc) return doc;
  const value = doc.asset;
  if (!value) return doc;
  const id = typeof value === "object" ? value._id || value.id : value;
  const asset = await assetService.findById(id);
  return { ...doc, asset: asset ? plain(asset) : value };
};

// Repairs
exports.getAllRepairs = async (req, res) => {
  try {
    const repairs = await repairRequestService.findMany({ sort: { createdAt: -1 } });
    const populated = await Promise.all(repairs.map(withPopulatedAsset));
    res.json({ success: true, repairs: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createRepair = async (req, res) => {
  try {
    const { asset, description, vendor, cost, invoiceNumber } = req.body;
    if (!asset || !description) return res.status(400).json({ success: false, message: "Asset and description required" });

    const repair = await repairRequestService.create({
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
    const repair = await repairRequestService.findById(req.params.id);
    if (!repair) return res.status(404).json({ success: false, message: "Repair request not found" });

    if (repair.status === "Completed") {
      return res.status(400).json({ success: false, message: "Repair is already marked as completed." });
    }

    const assetId = repair.asset && typeof repair.asset === "object"
      ? repair.asset._id || repair.asset.id
      : repair.asset;
    // Resolve the referenced asset on whichever datasource it lives on so the
    // maintenance record and the accounting description keep the populated
    // asset name the pre-migration flow read.
    const asset = assetId ? await assetService.findById(assetId) : null;

    const completionDate = req.body.completionDate ? new Date(req.body.completionDate) : new Date();
    const updates = { status: "Completed", completionDate };
    if (req.body.cost) updates.cost = Number(req.body.cost);
    if (req.body.invoiceNumber) updates.invoiceNumber = clean(req.body.invoiceNumber);

    const paymentMethod = clean(req.body.paymentMethod) || "System";
    const remarks = clean(req.body.remarks);

    const updated = await repairRequestService.updateById(req.params.id, updates);
    if (!updated) return res.status(404).json({ success: false, message: "Repair request not found" });

    // Update maintenance history on the asset, on whichever datasource the
    // asset lives on.
    await assetService.addMaintenanceRecord(assetId, {
      repairDate: updated.completionDate,
      description: updated.description + (remarks ? ` - Remarks: ${remarks}` : ""),
      cost: updated.cost,
      vendor: updated.vendor
    });

    if (updated.cost > 0) {
      const { recordTransaction } = require("../services/accountingService");
      await recordTransaction({
        transactionType: "Debit",
        source: "Repair",
        category: "Repair Expense",
        amount: updated.cost,
        paymentMethod: paymentMethod,
        description: `Repair completed for asset ${plain(asset)?.name}. Vendor: ${updated.vendor}` + (remarks ? ` - Remarks: ${remarks}` : ""),
        referenceId: updated._id,
        referenceModel: "RepairRequest",
        recordedBy: req.user ? req.user.id : null,
      });
    }

    res.json({ success: true, repair: await withPopulatedAsset(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
