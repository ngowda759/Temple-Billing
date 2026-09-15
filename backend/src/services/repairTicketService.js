const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const RepairTicket = require("../models/RepairTicket");
const repairTicketRepository = require("../repositories/repairTicketRepository");

// Mirrors the enums declared in backend/src/models/RepairTicket.js exactly.
const STATUSES = new Set([
  "Reported", "Pending Approval", "Approved", "In Progress", "Completed", "Rejected", "Closed",
]);
const PRIORITIES = new Set(["Low", "Medium", "High", "Critical"]);

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// vendorBillAmount has NO min in Mongo ({ type: Number, default: 0 } permits
// negatives) — only finiteness is checked, exactly like the schema.
const assertMoney = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// sparePartsUsed[].quantity has NO min in Mongo ({ type: Number, default: 1 }).
const assertQuantity = (value, label) => {
  if (value === undefined || value === null) return;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
};

// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time
// destructure, so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the RepairTicket path: PostgreSQL is used
// when the datasource seam is connected AND PostgreSQL is actually reachable.
// If either condition fails the existing Mongoose model handles the operation.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const normalizeSpareParts = (list) => {
  if (list === undefined || list === null) return undefined;
  return list.map((entry) => {
    assertQuantity(entry.quantity, "sparePartsUsed.quantity");
    const normalized = { ...entry };
    if (entry.item === undefined || entry.item === null || String(entry.item).trim() === "") {
      delete normalized.item;
    } else {
      normalized.item = String(entry.item).trim();
    }
    if (normalized.quantity === undefined) normalized.quantity = 1;
    return normalized;
  });
};

/**
 * Validates and normalizes repair-ticket data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - ticketNumber is required (uniqueness is enforced by the underlying
 *    datasource: Mongo 11000 / PG repair_tickets_ticket_number_key).
 *  - asset and reportedBy are required references.
 *  - issueDescription is required.
 *  - status defaults to 'Reported' (7-value enum).
 *  - priority defaults to 'Medium' (4-value enum).
 *  - sparePartsUsed is an embedded array of { item, quantity } with quantity
 *    defaulting to 1.
 *  - vendor / vendorBillPhoto / repairExpenseId / approvedBy /
 *    resolutionNotes are optional.
 *  - vendorBillAmount defaults to 0 with no minimum.
 */
const normalizeRepairTicket = (data) => {
  if (!data) throw new Error("Repair ticket data is required");
  assertId(data.ticketNumber, "ticketNumber");
  assertId(data.asset, "asset");
  assertId(data.reportedBy, "reportedBy");
  assertId(data.issueDescription, "issueDescription");
  const status = data.status === undefined || data.status === null || data.status === ""
    ? "Reported"
    : data.status;
  const priority = data.priority === undefined || data.priority === null || data.priority === ""
    ? "Medium"
    : data.priority;
  assertEnum(status, STATUSES, "status");
  assertEnum(priority, PRIORITIES, "priority");
  assertMoney(data.vendorBillAmount, "vendorBillAmount");

  const normalized = { ...data };
  normalized.ticketNumber = String(data.ticketNumber).trim();
  normalized.asset = String(data.asset).trim();
  normalized.reportedBy = String(data.reportedBy).trim();
  normalized.issueDescription = String(data.issueDescription).trim();
  normalized.status = status;
  normalized.priority = priority;
  if (normalized.vendorBillAmount === undefined) normalized.vendorBillAmount = 0;
  if (normalized.vendor === undefined || normalized.vendor === null || String(normalized.vendor).trim() === "") {
    delete normalized.vendor;
  } else {
    normalized.vendor = String(normalized.vendor).trim();
  }
  if (normalized.vendorBillPhoto === undefined || normalized.vendorBillPhoto === null || String(normalized.vendorBillPhoto).trim() === "") {
    delete normalized.vendorBillPhoto;
  } else {
    normalized.vendorBillPhoto = String(normalized.vendorBillPhoto).trim();
  }
  if (normalized.repairExpenseId === undefined || normalized.repairExpenseId === null || String(normalized.repairExpenseId).trim() === "") {
    delete normalized.repairExpenseId;
  } else {
    normalized.repairExpenseId = String(normalized.repairExpenseId).trim();
  }
  if (normalized.approvedBy === undefined || normalized.approvedBy === null || String(normalized.approvedBy).trim() === "") {
    delete normalized.approvedBy;
  } else {
    normalized.approvedBy = String(normalized.approvedBy).trim();
  }
  if (normalized.resolutionNotes === undefined || normalized.resolutionNotes === null) {
    delete normalized.resolutionNotes;
  } else {
    normalized.resolutionNotes = String(normalized.resolutionNotes);
  }
  const sparePartsUsed = normalizeSpareParts(data.sparePartsUsed);
  if (sparePartsUsed === undefined) {
    delete normalized.sparePartsUsed;
  } else {
    normalized.sparePartsUsed = sparePartsUsed;
  }
  return normalized;
};

const validate = (data) => {
  normalizeRepairTicket(data);
};

const create = async (data) => {
  const normalized = normalizeRepairTicket(data);
  if (await usePostgres()) return repairTicketRepository.create(normalized);
  return RepairTicket.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? repairTicketRepository.findById(id) : RepairTicket.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? repairTicketRepository.findOne(filter) : RepairTicket.findOne(filter);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? repairTicketRepository.findMany(options)
    : RepairTicket.find(options.filter || {}).sort(options.sort || { createdAt: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.ticketNumber !== undefined) assertId(updates.ticketNumber, "ticketNumber");
    if (updates.asset !== undefined) assertId(updates.asset, "asset");
    if (updates.reportedBy !== undefined) assertId(updates.reportedBy, "reportedBy");
    if (updates.issueDescription !== undefined) assertId(updates.issueDescription, "issueDescription");
    assertEnum(updates.status, STATUSES, "status");
    assertEnum(updates.priority, PRIORITIES, "priority");
    assertMoney(updates.vendorBillAmount, "vendorBillAmount");
  }
  if (await usePostgres()) return repairTicketRepository.updateById(id, updates);
  return RepairTicket.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? repairTicketRepository.count(filter) : RepairTicket.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? repairTicketRepository.destroy(id) : Boolean(await RepairTicket.findByIdAndDelete(id));

module.exports = {
  isConnected,
  usePostgres,
  STATUSES,
  PRIORITIES,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};