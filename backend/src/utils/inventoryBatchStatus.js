// Single source of truth for the InventoryBatch automatic status transition.
//
// The behaviour is a verbatim copy of the original Mongoose `pre("save")` hook
// in backend/src/models/InventoryBatch.js:
//
//   if (this.currentQuantity === 0 && this.status === "Active") this.status = "Consumed";
//   if (this.expiryDate && new Date() > this.expiryDate && this.status === "Active") this.status = "Expired";
//
// Two ordering details are load-bearing and must not change:
//   * the Consumed condition is evaluated first, so a batch that is both empty
//     and past expiry becomes Consumed (the Expired branch then sees a status
//     that is no longer "Active" and does nothing);
//   * only `status === "Active"` may be auto-flipped — Quarantine/Returned/
//     Disposed/Expired are never touched.
//
// It is applied on create/save only. Mongoose does not run `pre("save")` for
// `findByIdAndUpdate`, so the PostgreSQL `updateById` path must NOT call this:
// callers that want save-equivalent semantics use
// inventoryBatchService.updateByIdWithStatusTransition.

const AUTO_TRANSITIONABLE_STATUS = "Active";

/**
 * Resolves the status a batch should carry after an automatic transition.
 *
 * @param {object} batch
 * @param {number|string} batch.currentQuantity
 * @param {Date|string|null|undefined} batch.expiryDate
 * @param {string} batch.status
 * @param {Date} [now] - injected clock; defaults to the current instant.
 * @returns {string} the resolved status (unchanged when no transition applies).
 */
const resolveStatusTransition = ({ currentQuantity, expiryDate, status }, now = new Date()) => {
  let resolved = status;

  if (Number(currentQuantity) === 0 && resolved === AUTO_TRANSITIONABLE_STATUS) {
    resolved = "Consumed";
  }

  if (expiryDate && now > new Date(expiryDate) && resolved === AUTO_TRANSITIONABLE_STATUS) {
    resolved = "Expired";
  }

  return resolved;
};

/**
 * Returns the status transition for a batch, or null when nothing changes.
 * Callers apply the result; keeping the decision pure makes both datasources
 * provably identical.
 */
const applyStatusTransition = (batch, now = new Date()) => {
  const resolved = resolveStatusTransition(batch, now);
  return resolved === batch.status ? null : resolved;
};

module.exports = {
  AUTO_TRANSITIONABLE_STATUS,
  resolveStatusTransition,
  applyStatusTransition,
};