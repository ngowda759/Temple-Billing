const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const InventoryIssue = require("../models/InventoryIssue");
const inventoryIssueRepository = require("../repositories/inventoryIssueRepository");

// Mirrors the enum declared in backend/src/models/InventoryIssue.js.
const ISSUE_STATUSES = new Set(["Active", "Completed"]);

// isConnected() mirrors the other Phase 2 services (inventoryItem/request/
// consumption/batch/log): it exposes the datasource-selection seam, which is
// mongoose's connectivity flag. That flag is what the tests pin to select the
// PostgreSQL branch deterministically.
//
// The seam is read through the config module (dbConfig.isDbConnected()) rather
// than a require-time destructure, so tests can swap the function after this
// module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Inventory Issue path. This is the
// Phase 2AH fallback boundary: the service uses PostgreSQL when the established
// datasource seam is connected AND PostgreSQL is actually reachable. If either
// condition fails it routes back to the existing Mongoose model — so an
// unavailable PostgreSQL can never take the app down nor cause a partial write.
//
// The service owns datasource selection; the repository only receives the
// optional transaction client and never probes PostgreSQL itself.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const assertId = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

const assertText = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
};

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

// The Mongo schema declares issuedQuantity as Number, required, min: 0 — zero is
// legal at the model layer (an issue can be issued with everything returned),
// while negatives are rejected, mirroring the Mongoose min: 0 validator exactly.
const assertQuantity = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be a number`);
  }
  if (num < 0) {
    throw new Error(`Invalid ${label}: ${value}. ${label} must be >= 0 (Mongo schema min: 0)`);
  }
};

/**
 * Validates and normalizes inventory issue data so the PostgreSQL repository and
 * the Mongo model receive the same cleaned payload.
 *
 * Business rules mirror the Mongo schema plus the single real create path
 * (inventoryRequestController.issueInventoryRequest):
 *  - item / itemName / userId / userName / role / issuedQuantity / unit /
 *    issuedBy are required.
 *  - issuedQuantity is min: 0 (zero legal, negatives rejected).
 *  - request is optional (the ObjectId ref may be absent — ad-hoc issues are
 *    schema-legal).
 *  - issueDate defaults to now (Mongo default Date.now).
 *  - purpose defaults to "".
 *  - status defaults to "Active" and belongs to ['Active','Completed'].
 */
const normalizeInventoryIssue = (data) => {
  if (!data) throw new Error("Inventory issue data is required");
  const item = assertId(data.item, "item");
  assertText(data.itemName, "itemName");
  const userId = assertId(data.userId, "userId");
  assertText(data.userName, "userName");
  assertText(data.role, "role");
  assertQuantity(data.issuedQuantity, "issuedQuantity");
  assertText(data.unit, "unit");
  assertText(data.issuedBy, "issuedBy");
  assertEnum(data.status, ISSUE_STATUSES, "status");

  const normalized = { ...data };
  normalized.item = item;
  normalized.userId = userId;
  if (data.purpose === undefined || data.purpose === null) {
    normalized.purpose = "";
  }
  if (data.issueDate === undefined || data.issueDate === null) {
    normalized.issueDate = new Date();
  }
  if (data.status === undefined || data.status === null) {
    normalized.status = "Active";
  }
  return normalized;
};

const validate = (data) => {
  normalizeInventoryIssue(data);
};

/**
 * Exactly ONE datasource per operation. The optional `client` is forwarded to
 * the repository only on the PostgreSQL path so a caller running a PostgreSQL
 * unit of work (issueInventoryRequest / completeUsage) can enlist the write in
 * its transaction; the Mongoose path ignores it and never touches PostgreSQL.
 */
const create = async (data, client) => {
  const normalized = normalizeInventoryIssue(data);
  if (await usePostgres()) return inventoryIssueRepository.create(normalized, client);
  return InventoryIssue.create(normalized);
};

const findById = async (id, client) =>
  (await usePostgres()) ? inventoryIssueRepository.findById(id, client) : InventoryIssue.findById(id);

const findMany = async (options = {}) =>
  (await usePostgres())
    ? inventoryIssueRepository.findMany(options)
    : InventoryIssue.find(options.filter || {}).sort(options.sort || { issueDate: -1 });

// completeUsage is the only mutation in the application: `status = 'Completed'`.
const updateStatus = async (id, status, client) => {
  assertEnum(status, ISSUE_STATUSES, "status");
  if (await usePostgres()) return inventoryIssueRepository.updateStatus(id, status, client);
  return InventoryIssue.findByIdAndUpdate(id, { status }, { new: true, runValidators: true });
};

module.exports = {
  isConnected,
  usePostgres,
  ISSUE_STATUSES,
  validate,
  create,
  findById,
  findMany,
  updateStatus,
};
