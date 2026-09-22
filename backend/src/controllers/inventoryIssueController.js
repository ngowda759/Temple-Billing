const InventoryItem = require("../models/InventoryItem");
const { runInTransaction } = require("../config/postgres");
const inventoryIssueService = require("../services/inventoryIssueService");
const inventoryItemService = require("../services/inventoryItemService");
const inventoryConsumptionService = require("../services/inventoryConsumptionService");

// A failure raised inside the PostgreSQL unit of work. Throwing (and therefore
// rolling the transaction back) keeps the HTTP status semantics of the Mongo
// path while guaranteeing no partial stock/issue/consumption state.
class IssueOperationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// GET /api/staff/inventory-issues/:userId?
exports.getInventoryIssues = async (req, res) => {
  try {
    const { userId } = req.params;
    const query = userId ? { userId } : {};

    // Routed through the Phase 2AH service: PostgreSQL (issue_date DESC) when
    // the datasource seam + PG are available, otherwise the Mongoose model. The
    // repository returns the same camelCase shape the staff/priest inventory
    // screens expect (_id, itemName, issuedQuantity, unit, issueDate, purpose,
    // status).
    const issues = await inventoryIssueService.findMany({
      filter: query,
      sort: { issueDate: -1 },
    });
    return res.json({ success: true, issues });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PostgreSQL completion path.
 *
 * One authoritative datasource: the InventoryIssue, InventoryItem and
 * InventoryConsumption writes all run inside ONE PostgreSQL transaction on a
 * single pooled client, so a failure in any step rolls back the whole
 * completion. A mixed datasource (for example a PostgreSQL issue with a MongoDB
 * item) is refused outright rather than half-performed.
 */
const completeUsagePostgres = async ({ id, parsedUsed, parsedReturned, remarks }) => {
  const itemUsesPostgres = await inventoryItemService.usePostgres();
  const consumptionUsesPostgres = await inventoryConsumptionService.usePostgres();
  if (!itemUsesPostgres || !consumptionUsesPostgres) {
    throw new IssueOperationError(
      500,
      "Inventory issue completion requires a single datasource: the issue, item and " +
        "consumption stores must all be available on PostgreSQL for this operation."
    );
  }

  return runInTransaction(async (client) => {
    const issue = await inventoryIssueService.findById(id, client);
    if (!issue) {
      throw new IssueOperationError(404, "Inventory issue not found.");
    }

    if (issue.status === "Completed") {
      throw new IssueOperationError(400, "This issue has already been completed.");
    }

    if (parsedUsed + parsedReturned !== Number(issue.issuedQuantity)) {
      throw new IssueOperationError(
        400,
        `Used (${parsedUsed}) + Returned (${parsedReturned}) must equal Issued Quantity (${issue.issuedQuantity}).`
      );
    }

    const item = await inventoryItemService.findById(issue.item, client);
    if (!item) {
      throw new IssueOperationError(404, "Associated inventory item not found.");
    }

    // Preserve the existing stock effects exactly:
    //   issuedStock -= issuedQuantity
    //   consumedStock += usedQuantity
    //   availableStock += returnedQuantity
    const updatedItem = await inventoryItemService.updateById(
      item._id,
      {
        issuedStock: Number(item.issuedStock) - Number(issue.issuedQuantity),
        consumedStock: Number(item.consumedStock) + parsedUsed,
        availableStock: Number(item.availableStock) + parsedReturned,
      },
      client
    );

    const updatedIssue = await inventoryIssueService.updateStatus(issue._id, "Completed", client);

    const consumption = await inventoryConsumptionService.create(
      {
        issue: issue._id,
        item: item._id,
        itemName: item.name,
        userId: issue.userId,
        userName: issue.userName,
        role: issue.role,
        issuedQuantity: issue.issuedQuantity,
        usedQuantity: parsedUsed,
        returnedQuantity: parsedReturned,
        unit: issue.unit,
        purpose: issue.purpose,
        remarks: String(remarks || "").trim(),
      },
      client
    );

    return { issue: updatedIssue || issue, consumption, item: updatedItem || item };
  });
};

/**
 * MongoDB completion path — the pre-Phase 2AH implementation, preserved exactly.
 */
const completeUsageMongo = async ({ id, parsedUsed, parsedReturned, remarks }) => {
  const issue = await inventoryIssueService.findById(id);
  if (!issue) {
    throw new IssueOperationError(404, "Inventory issue not found.");
  }

  if (issue.status === "Completed") {
    throw new IssueOperationError(400, "This issue has already been completed.");
  }

  if (parsedUsed + parsedReturned !== issue.issuedQuantity) {
    throw new IssueOperationError(
      400,
      `Used (${parsedUsed}) + Returned (${parsedReturned}) must equal Issued Quantity (${issue.issuedQuantity}).`
    );
  }

  const item = await InventoryItem.findById(issue.item);
  if (!item) {
    throw new IssueOperationError(404, "Associated inventory item not found.");
  }

  // Adjust stocks
  item.issuedStock -= issue.issuedQuantity;
  item.consumedStock += parsedUsed;
  item.availableStock += parsedReturned;
  await item.save();

  // Mark issue as completed
  issue.status = "Completed";
  await issue.save();

  // Log consumption. Routed through the Phase 2K service so the record is
  // persisted to PostgreSQL when the datasource seam + PG are available and to
  // the existing Mongoose InventoryConsumption model otherwise.
  const consumption = await inventoryConsumptionService.create({
    issue: issue._id,
    item: item._id,
    itemName: item.name,
    userId: issue.userId,
    userName: issue.userName,
    role: issue.role,
    issuedQuantity: issue.issuedQuantity,
    usedQuantity: parsedUsed,
    returnedQuantity: parsedReturned,
    unit: issue.unit,
    purpose: issue.purpose,
    remarks: String(remarks || "").trim(),
  });

  return { issue, consumption };
};

// POST /api/staff/inventory-issues/:id/complete
exports.completeUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { usedQuantity, returnedQuantity, remarks } = req.body;

    const parsedUsed = parseFloat(usedQuantity) || 0;
    const parsedReturned = parseFloat(returnedQuantity) || 0;

    if (parsedUsed < 0 || parsedReturned < 0) {
      return res.status(400).json({ success: false, message: "Quantities cannot be negative." });
    }

    const payload = { id, parsedUsed, parsedReturned, remarks };
    // Exactly ONE datasource per operation: the issue service owns the datasource
    // selection and the whole completion (issue + item + consumption) follows it.
    const usePostgres = await inventoryIssueService.usePostgres();
    const result = usePostgres
      ? await completeUsagePostgres(payload)
      : await completeUsageMongo(payload);

    return res.json({
      success: true,
      message: "Usage completed successfully.",
      issue: result.issue,
      consumption: result.consumption,
    });
  } catch (error) {
    if (error instanceof IssueOperationError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/inventory/reports/consumption
exports.getConsumptionReports = async (req, res) => {
  try {
    // Routed through the Phase 2K service: PostgreSQL (date DESC, limit 100)
    // when the seam + PG are available, otherwise the Mongoose model. The
    // repository returns the same camelCase shape the admin "Consumption
    // Tracking" tab expects (_id, createdAt, userName, itemName, usedQuantity,
    // unit, remarks).
    const consumptions = await inventoryConsumptionService.findMany({
      filter: {},
      sort: { date: -1, createdAt: -1 },
      limit: 100,
    });
    return res.json({ success: true, consumptions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
