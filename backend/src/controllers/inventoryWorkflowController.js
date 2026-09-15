const PurchaseOrder = require("../models/PurchaseOrder");
const purchaseOrderService = require("../services/purchaseOrderService");
const InventoryItem = require("../models/InventoryItem");
const InventoryBatch = require("../models/InventoryBatch");
const AccountTransaction = require("../models/AccountTransaction");
const { recordTransaction } = require("../services/accountingService");
const { addStock, deductStock } = require("../utils/inventoryHelper");
const goodsReceivedNoteService = require("../services/goodsReceivedNoteService");

// Resolves the item id of a GRN line whether the model populated it (Mongo
// populate leaves line.item as the InventoryItem document) or the PostgreSQL
// repository left it as a plain id string. Both datasources round-trip the
// same Mongo-shaped document; this helper normalizes the only populated-vs-
// plain difference so the business logic below is datasource-agnostic.
const lineItemId = (line) => {
  const value = line && line.item;
  return value && typeof value === "object" ? value._id || value : value;
};

// Create GRN from PO
exports.createGRN = async (req, res) => {
  try {
    const { purchaseOrderId, supplierId, supplierInvoiceNumber, supplierInvoiceDate, receivedItems, totalAmount, notes } = req.body;

    // The grnNumber is derived from the CURRENT datasource's row count so the
    // PostgreSQL path numbers from the goods_received_notes table and the
    // Mongo fallback numbers from countDocuments — exactly one numbering
    // domain per persistence path.
    const grnCount = await goodsReceivedNoteService.count({});
    const grnNumber = `GRN-${String(grnCount + 1).padStart(5, "0")}`;

    const newGrn = await goodsReceivedNoteService.create({
      grnNumber,
      purchaseOrder: purchaseOrderId,
      supplier: supplierId,
      supplierInvoiceNumber,
      supplierInvoiceDate,
      receivedItems,
      totalAmount,
      receivedBy: req.user && req.user._id,
      notes,
      status: "Pending Approval"
    });

    if (purchaseOrderId) {
      const po = await purchaseOrderService.findById(purchaseOrderId);
      if (po) {
        // Simplified, ideally check quantities.
        await purchaseOrderService.updateById(po._id, { status: "Partially Received" });
      }
    }

    res.status(201).json({ success: true, message: "GRN Created Successfully", grn: newGrn });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to create GRN", error: error.message });
  }
};

// Approve GRN (Admin) -> Updates Stock & Creates Account Debit
exports.approveGRN = async (req, res) => {
  try {
    const { id } = req.params;
    const grn = await goodsReceivedNoteService.findById(id);
    if (!grn) return res.status(404).json({ success: false, message: "GRN not found" });

    if (grn.status === "Approved") {
      return res.status(400).json({ success: false, message: "GRN already approved" });
    }

    grn.status = "Approved";
    grn.approvedBy = req.user && req.user._id;

    for (const line of grn.receivedItems || []) {
      const itemId = lineItemId(line);
      const item = await InventoryItem.findById(itemId);

      // Update Item Total Stock
      const updatedItem = await addStock(
        itemId,
        line.acceptedQuantity,
        "GRN Approved",
        req.user && req.user._id,
        `Received via GRN ${grn.grnNumber}`
      );

      if (updatedItem) {
        updatedItem.lastPurchasePrice = line.unitPrice;
        updatedItem.lastPurchaseDate = new Date();
        await updatedItem.save();
      }

      // Create Batch if Required
      if (item.batchRequired || line.batchNumber) {
        const batch = new InventoryBatch({
          item: item._id,
          batchNumber: line.batchNumber || `AUTO-${Date.now()}`,
          grn: grn._id,
          purchasePrice: line.unitPrice,
          expiryDate: line.expiryDate,
          originalQuantity: line.acceptedQuantity,
          currentQuantity: line.acceptedQuantity,
          supplier: grn.supplier
        });
        await batch.save();
      }
    }

    await goodsReceivedNoteService.updateById(grn._id, { status: "Approved", approvedBy: grn.approvedBy });

    // Create Account Transaction (Inventory Purchase)
    await recordTransaction({
      transactionType: "Debit",
      source: "Inventory",
      category: "Inventory Purchase",
      amount: grn.totalAmount,
      paymentMethod: "System",
      description: `Purchase against GRN ${grn.grnNumber}`,
      referenceId: grn._id,
      referenceModel: "GoodsReceivedNote",
      recordedBy: req.user && req.user._id
    });

    res.status(200).json({ success: true, message: "GRN Approved and Stock Updated", grn });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to approve GRN", error: error.message });
  }
};


const Recipe = require("../models/Recipe");
const Prasadam = require("../models/Prasadam");

// Kitchen logs production -> Auto Deduct Raw Materials
exports.logKitchenProduction = async (req, res) => {
  try {
    const { recipeId, producedQuantity } = req.body;
    
    const recipe = await Recipe.findById(recipeId).populate("ingredients.item");
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found" });

    // Deduct ingredients proportionally
    const multiplier = producedQuantity / (recipe.outputQuantity || 1);

    for (const ing of recipe.ingredients) {
      const requiredQty = ing.quantityRequired * multiplier;
      const item = await InventoryItem.findById(ing.item._id);
      
      if (!item) continue;
      
      if (item.availableStock < requiredQty) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for ${item.name}. Required: ${requiredQty}, Available: ${item.availableStock}`
        });
      }

      await deductStock(
        item._id,
        requiredQty,
        "Kitchen Production",
        req.user ? req.user._id : null,
        `Used in ${recipe.name}`
      );
      
      const updatedItem = await InventoryItem.findById(item._id);
      if (updatedItem) {
        updatedItem.consumedStock = (updatedItem.consumedStock || 0) + requiredQty;
        await updatedItem.save();
      }

      // Deduct from batches using FIFO
      let remainingToDeduct = requiredQty;
      const batches = await InventoryBatch.find({ item: item._id, status: "Active" }).sort({ expiryDate: 1, createdAt: 1 });
      
      for (const batch of batches) {
        if (remainingToDeduct <= 0) break;
        if (batch.currentQuantity <= remainingToDeduct) {
          remainingToDeduct -= batch.currentQuantity;
          batch.currentQuantity = 0;
          batch.status = "Consumed";
        } else {
          batch.currentQuantity -= remainingToDeduct;
          remainingToDeduct = 0;
        }
        await batch.save();
      }
    }

    // Increase Finished Good (Prasadam) Stock
    if (recipe.outputItem) {
       // if it's an InventoryItem finished good
       await addStock(
         recipe.outputItem,
         producedQuantity,
         "Kitchen Production",
         req.user ? req.user._id : null,
         `Produced from recipe ${recipe.name}`
       );
    }
    
    // Also update Prasadam model if they are linked by name
    const prasadamRecord = await Prasadam.findOne({ name: recipe.name });
    if (prasadamRecord) {
      prasadamRecord.availableStock = (prasadamRecord.availableStock || 0) + producedQuantity;
      await prasadamRecord.save();
    }

    res.status(200).json({ success: true, message: `Production logged. Raw materials deducted for ${recipe.name}.` });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to log production", error: error.message });
  }
};

const damageNoteService = require("../services/damageNoteService");
const repairTicketService = require("../services/repairTicketService");
const assetService = require("../services/assetService");

// Repair tickets are read/written through the service so they follow the
// selected datasource (PostgreSQL when available, otherwise the existing
// Mongoose model). Both datasources return the same Mongo-shaped document;
// the only difference is that references stay plain id strings on the
// PostgreSQL path, so the populated `asset` / `sparePartsUsed.item` shape the
// pre-migration `populate` produced is reassembled here.

// Normalizes a repair/asset document from either datasource into a plain
// object so responses are identical on the PostgreSQL path and the Mongo
// fallback path (Mongoose document).
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

const populateTicket = async (ticket) => {
  const doc = plain(ticket);
  if (!doc) return doc;
  const populated = { ...doc };

  const assetValue = doc.asset;
  if (assetValue) {
    const assetId = typeof assetValue === "object" ? assetValue._id || assetValue.id : assetValue;
    const asset = await assetService.findById(assetId);
    if (asset) populated.asset = plain(asset);
  }

  if (Array.isArray(doc.sparePartsUsed)) {
    populated.sparePartsUsed = await Promise.all(doc.sparePartsUsed.map(async (part) => {
      const value = part && part.item;
      if (!value) return part;
      const itemId = typeof value === "object" ? value._id || value.id : value;
      const item = await InventoryItem.findById(itemId);
      return { ...part, item: item ? plain(item) : value };
    }));
  }

  return populated;
};

// Resolves the item id of a damage note whether the model populated it (Mongo
// populate leaves damage.item as the full InventoryItem document) or the
// PostgreSQL repository left it as a plain id string. Both datasources
// round-trip the same Mongo-shaped document; this helper normalizes the only
// populated-vs-plain difference so the business logic below is
// datasource-agnostic.
const damageItemId = (damage) => {
  const value = damage && damage.item;
  return value && typeof value === "object" ? value._id || value : value;
};

exports.approveDamageNote = async (req, res) => {
  try {
    const { id } = req.params;
    const damage = await damageNoteService.findById(id);
    if (!damage) return res.status(404).json({ success: false, message: "Damage note not found" });

    if (damage.status !== "Pending Approval") {
      return res.status(400).json({ success: false, message: "Only pending damage notes can be approved." });
    }

    const itemId = damageItemId(damage);
    const item = await InventoryItem.findById(itemId);
    if (!item) return res.status(404).json({ success: false, message: "Inventory item not found" });

    await deductStock(
      itemId,
      damage.quantity,
      "Damage Note",
      req.user._id,
      `Damage approved: ${damage.reason || ''}`
    );

    const updatedItem = await InventoryItem.findById(itemId);
    if (updatedItem) {
      updatedItem.damagedStock = (updatedItem.damagedStock || 0) + damage.quantity;
      await updatedItem.save();
    }

    await damageNoteService.updateById(id, { status: "Approved", approvedBy: req.user._id });

    // Create Account Transaction (Inventory Loss)
    await recordTransaction({
      transactionType: "Debit",
      source: "Inventory",
      category: "Inventory Loss",
      amount: damage.writeOffAmount || (item.lastPurchasePrice * damage.quantity) || 0,
      paymentMethod: "System",
      description: `Stock write-off for damaged item: ${item.name}`,
      referenceId: id,
      referenceModel: "DamageNote",
      recordedBy: req.user._id
    });

    res.status(200).json({ success: true, message: "Damage approved and stock reduced.", damage: { ...damage, status: "Approved", approvedBy: req.user._id } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to approve damage", error: error.message });
  }
};

exports.completeRepairTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorBillAmount, vendorBillPhoto, resolutionNotes } = req.body;

    const repair = await repairTicketService.findById(id);
    if (!repair) return res.status(404).json({ success: false, message: "Repair ticket not found" });

    const updates = {
      status: "Completed",
      vendorBillAmount: vendorBillAmount || repair.vendorBillAmount,
      vendorBillPhoto: vendorBillPhoto || repair.vendorBillPhoto,
      resolutionNotes: resolutionNotes || repair.resolutionNotes,
    };

    const updated = await repairTicketService.updateById(id, updates);
    if (!updated) return res.status(404).json({ success: false, message: "Repair ticket not found" });

    // Create Account Transaction (Repair Expense)
    if (updated.vendorBillAmount > 0) {
      await recordTransaction({
        transactionType: "Debit",
        source: "Repair",
        category: "Repair & Maintenance Expense",
        amount: updated.vendorBillAmount,
        paymentMethod: "Cash",
        description: `Repair completed for Asset: ${updated.ticketNumber}`,
        referenceId: updated._id,
        referenceModel: "RepairTicket",
        recordedBy: req.user._id
      });
    }

    res.status(200).json({ success: true, message: "Repair ticket completed.", repair: await populateTicket(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to complete repair", error: error.message });
  }
};
