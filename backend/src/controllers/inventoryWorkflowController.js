const GoodsReceivedNote = require("../models/GoodsReceivedNote");
const PurchaseOrder = require("../models/PurchaseOrder");
const purchaseOrderService = require("../services/purchaseOrderService");
const InventoryItem = require("../models/InventoryItem");
const InventoryBatch = require("../models/InventoryBatch");
const AccountTransaction = require("../models/AccountTransaction");
const { recordTransaction } = require("../services/accountingService");
const { addStock, deductStock } = require("../utils/inventoryHelper");

// Create GRN from PO
exports.createGRN = async (req, res) => {
  try {
    const { purchaseOrderId, supplierId, supplierInvoiceNumber, supplierInvoiceDate, receivedItems, totalAmount, notes } = req.body;

    const grnCount = await GoodsReceivedNote.countDocuments();
    const grnNumber = `GRN-${String(grnCount + 1).padStart(5, "0")}`;

    const newGrn = new GoodsReceivedNote({
      grnNumber,
      purchaseOrder: purchaseOrderId,
      supplier: supplierId,
      supplierInvoiceNumber,
      supplierInvoiceDate,
      receivedItems,
      totalAmount,
      receivedBy: req.user._id,
      notes,
      status: "Pending Approval"
    });

    await newGrn.save();

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
    const grn = await GoodsReceivedNote.findById(id).populate("receivedItems.item");
    if (!grn) return res.status(404).json({ success: false, message: "GRN not found" });

    if (grn.status === "Approved") {
      return res.status(400).json({ success: false, message: "GRN already approved" });
    }

    grn.status = "Approved";
    grn.approvedBy = req.user._id;

    for (const line of grn.receivedItems) {
      const item = await InventoryItem.findById(line.item._id);
      
      // Update Item Total Stock
      const updatedItem = await addStock(
        line.item._id, 
        line.acceptedQuantity, 
        "GRN Approved", 
        req.user._id, 
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

    await grn.save();

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
      recordedBy: req.user._id
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

const DamageNote = require("../models/DamageNote");
const RepairTicket = require("../models/RepairTicket");

exports.approveDamageNote = async (req, res) => {
  try {
    const { id } = req.params;
    const damage = await DamageNote.findById(id).populate("item");
    if (!damage) return res.status(404).json({ success: false, message: "Damage note not found" });

    if (damage.status !== "Pending Approval") {
      return res.status(400).json({ success: false, message: "Only pending damage notes can be approved." });
    }

    damage.status = "Approved";
    damage.approvedBy = req.user._id;

    const item = damage.item;
    await deductStock(
      item._id,
      damage.quantity,
      "Damage Note",
      req.user._id,
      `Damage approved: ${damage.reason || ''}`
    );
    
    const updatedItem = await InventoryItem.findById(item._id);
    if (updatedItem) {
      updatedItem.damagedStock = (updatedItem.damagedStock || 0) + damage.quantity;
      await updatedItem.save();
    }

    await damage.save();

    // Create Account Transaction (Inventory Loss)
    await recordTransaction({
      transactionType: "Debit",
      source: "Inventory",
      category: "Inventory Loss",
      amount: damage.writeOffAmount || (item.lastPurchasePrice * damage.quantity) || 0,
      paymentMethod: "System",
      description: `Stock write-off for damaged item: ${item.name}`,
      referenceId: damage._id,
      referenceModel: "DamageNote",
      recordedBy: req.user._id
    });

    res.status(200).json({ success: true, message: "Damage approved and stock reduced.", damage });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to approve damage", error: error.message });
  }
};

exports.completeRepairTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorBillAmount, vendorBillPhoto, resolutionNotes } = req.body;
    
    const repair = await RepairTicket.findById(id).populate("asset").populate("sparePartsUsed.item");
    if (!repair) return res.status(404).json({ success: false, message: "Repair ticket not found" });

    repair.status = "Completed";
    repair.vendorBillAmount = vendorBillAmount || repair.vendorBillAmount;
    repair.vendorBillPhoto = vendorBillPhoto || repair.vendorBillPhoto;
    repair.resolutionNotes = resolutionNotes || repair.resolutionNotes;
    
    await repair.save();

    // Create Account Transaction (Repair Expense)
    if (repair.vendorBillAmount > 0) {
      await recordTransaction({
        transactionType: "Debit",
        source: "Repair",
        category: "Repair & Maintenance Expense",
        amount: repair.vendorBillAmount,
        paymentMethod: "Cash",
        description: `Repair completed for Asset: ${repair.ticketNumber}`,
        referenceId: repair._id,
        referenceModel: "RepairTicket",
        recordedBy: req.user._id
      });
    }

    res.status(200).json({ success: true, message: "Repair ticket completed.", repair });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to complete repair", error: error.message });
  }
};
