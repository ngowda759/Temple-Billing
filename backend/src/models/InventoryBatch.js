const mongoose = require("mongoose");
const { resolveStatusTransition } = require("../utils/inventoryBatchStatus");

const inventoryBatchSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventoryItem",
      required: true,
    },
    batchNumber: {
      type: String,
      required: true,
      trim: true,
    },
    grn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodsReceivedNote",
    },
    purchasePrice: {
      type: Number,
      default: 0,
    },
    manufacturingDate: {
      type: Date,
    },
    expiryDate: {
      type: Date,
    },
    originalQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    currentQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["Active", "Quarantine", "Expired", "Consumed", "Returned", "Disposed"],
      default: "Active",
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventorySupplier",
    }
  },
  { timestamps: true }
);

inventoryBatchSchema.index({ item: 1, batchNumber: 1 }, { unique: true });

// Auto-update status based on current quantity / expiry. The decision lives in
// utils/inventoryBatchStatus.js so the PostgreSQL write path applies the exact
// same rules from one source.
inventoryBatchSchema.pre("save", function(next) {
  this.status = resolveStatusTransition({
    currentQuantity: this.currentQuantity,
    expiryDate: this.expiryDate,
    status: this.status,
  });
  next();
});

module.exports = mongoose.model("InventoryBatch", inventoryBatchSchema);
