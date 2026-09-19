const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const AccountHead = require("../models/AccountHead");
const accountHeadRepository = require("../repositories/accountHeadRepository");

const HEAD_TYPES = new Set(["Income", "Expense"]);

const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate: PostgreSQL is used when the datasource seam is
// connected AND PostgreSQL is actually reachable. Reading the seam through the
// config module (rather than a require-time destructure) keeps it switchable at
// call time; the reachability check means an unreachable PostgreSQL can never
// break an accounting write nor cause a partial one — the Mongoose model takes
// over instead. This mirrors the Gate B established in Phase 2G.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

/**
 * PostgreSQL-backed account head operations.
 *
 * Business rules mirror the existing Mongo implementation:
 *  - `name` is required and unique (case-preserving, like Mongo).
 *  - `type` must be one of the model enums ("Income" | "Expense").
 *  - `description` is trimmed.
 *  - `isActive` defaults to true.
 *  - Controller flow `getAccountHeads` lists active heads sorted by name.
 */
const validate = (data) => {
  if (!data.name || !String(data.name).trim()) {
    throw new Error("Account head name is required");
  }
  if (!data.type) {
    throw new Error("Account head type is required");
  }
  if (!HEAD_TYPES.has(data.type)) {
    throw new Error(`Invalid account head type: ${data.type}. Allowed: Income, Expense`);
  }
};

const create = async (data, client) => {
  validate(data);
  if (!(await usePostgres())) return AccountHead.create(data);
  const name = String(data.name).trim();
  const existing = await accountHeadRepository.findByName(name, client);
  if (existing) {
    const error = new Error(`Account head with name "${name}" already exists`);
    error.code = 11000; // mirror Mongo duplicate-key error for route compatibility
    throw error;
  }
  return accountHeadRepository.create({
    ...data,
    name,
    description: data.description ? String(data.description).trim() : undefined,
    isActive: data.isActive !== false,
  }, client);
};

const findById = async (id) =>
  (await usePostgres()) ? accountHeadRepository.findById(id) : AccountHead.findById(id);

const findByName = async (name) =>
  (await usePostgres()) ? accountHeadRepository.findByName(name) : AccountHead.findOne({ name });

const findMany = async (options = {}) =>
  (await usePostgres()) ? accountHeadRepository.findMany(options) : AccountHead.find(options.filter || {}).sort(options.sort || { name: 1 });

const updateById = async (id, updates) => {
  if (updates && updates.type !== undefined && !HEAD_TYPES.has(updates.type)) {
    throw new Error(`Invalid account head type: ${updates.type}. Allowed: Income, Expense`);
  }
  if (updates && updates.name !== undefined && !String(updates.name).trim()) {
    throw new Error("Account head name is required");
  }
  return (await usePostgres())
    ? accountHeadRepository.updateById(id, updates)
    : AccountHead.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? accountHeadRepository.count(filter) : AccountHead.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? accountHeadRepository.destroy(id) : Boolean(await AccountHead.findByIdAndDelete(id));

module.exports = {
  create,
  findById,
  findByName,
  findMany,
  updateById,
  count,
  destroy,
  isConnected,
  usePostgres,
};