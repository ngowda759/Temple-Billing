const { isDbConnected } = require("../config/db");
const AccountHead = require("../models/AccountHead");
const accountHeadRepository = require("../repositories/accountHeadRepository");

const HEAD_TYPES = new Set(["Income", "Expense"]);

const isConnected = () => isDbConnected();

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

const create = async (data) => {
  validate(data);
  if (!isConnected()) return AccountHead.create(data);
  const name = String(data.name).trim();
  const existing = await accountHeadRepository.findByName(name);
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
  });
};

const findById = async (id) =>
  isConnected() ? accountHeadRepository.findById(id) : AccountHead.findById(id);

const findByName = async (name) =>
  isConnected() ? accountHeadRepository.findByName(name) : AccountHead.findOne({ name });

const findMany = async (options = {}) =>
  isConnected() ? accountHeadRepository.findMany(options) : AccountHead.find(options.filter || {}).sort(options.sort || { name: 1 });

const updateById = async (id, updates) => {
  if (updates && updates.type !== undefined && !HEAD_TYPES.has(updates.type)) {
    throw new Error(`Invalid account head type: ${updates.type}. Allowed: Income, Expense`);
  }
  if (updates && updates.name !== undefined && !String(updates.name).trim()) {
    throw new Error("Account head name is required");
  }
  return isConnected()
    ? accountHeadRepository.updateById(id, updates)
    : AccountHead.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const count = async (filter = {}) =>
  isConnected() ? accountHeadRepository.count(filter) : AccountHead.countDocuments(filter);

const destroy = async (id) =>
  isConnected() ? accountHeadRepository.destroy(id) : Boolean(await AccountHead.findByIdAndDelete(id));

module.exports = {
  create,
  findById,
  findByName,
  findMany,
  updateById,
  count,
  destroy,
  isConnected,
};