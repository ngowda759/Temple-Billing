// Shared Prasadam Order date/status helpers used by the additive
// PostgreSQL-backed path (prasadamOrderService + the controllers that opt in
// via isPostgresConnected()). The Mongo-bound controllers keep their own
// inline logic; the helpers simply expose the same rules for the PG path so
// both datasources behave identically.

// Mirrors prasadamAdminController.mapToModelStatuses: every admin-facing status
// maps to the model statuses that should be shown for it. Values come from the
// ALLOWED_ORDER_STATUSES list used by that controller.
const mapToModelStatuses = (incoming) => {
  if (incoming === "Collected") return ["Collected"];
  if (incoming === "Not Collected") return ["Not Collected"];
  switch (incoming) {
    case "Pending":
      return ["Pending", "Placed", "Not Collected"];
    case "Approved":
      return ["Approved"];
    case "Rejected":
      return ["Rejected"];
    case "Processing":
      return ["Processing", "Preparing"];
    case "Ready for Pickup":
      return ["Ready for Pickup", "Ready"];
    case "Completed":
      return ["Completed", "Delivered", "Collected"];
    case "Cancelled":
      return ["Cancelled"];
    default:
      return [incoming];
  }
};

// Mirrors prasadamAdminController.mapFromModelStatus: a model status maps back
// to the admin-facing display status.
const mapFromModelStatus = (modelStatus) => {
  if (modelStatus === "Collected") return "Collected";
  if (modelStatus === "Not Collected") return "Not Collected";
  switch (modelStatus) {
    case "Pending":
      return "Not Collected";
    case "Approved":
      return "Collected";
    case "Rejected":
      return "Not Collected";
    case "Processing":
      return "Not Collected";
    case "Ready for Pickup":
      return "Collected";
    case "Completed":
      return "Collected";
    case "Placed":
      return "Not Collected";
    case "Preparing":
      return "Not Collected";
    case "Ready":
      return "Collected";
    case "Delivered":
      return "Collected";
    case "Cancelled":
      return "Not Collected";
    default:
      return modelStatus || "Not Collected";
  }
};

module.exports = { mapToModelStatuses, mapFromModelStatus };