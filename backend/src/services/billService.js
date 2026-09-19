const dbConfig = require("../config/db");
const Bill = require("../models/Bill");
const billRepository = require("../repositories/billRepository");
const billItemRepository = require("../repositories/billItemRepository");

const PAYMENT_MODES = new Set(["Cash", "UPI", "Card", "Bank Transfer", "Net Banking", "Debit Card", "Credit Card"]);
const STATUSES = new Set(["Paid", "Pending", "Cancelled"]);
const ITEM_TYPES = new Set(["Pooja", "Donation", "Prasadam", "Room", "Other"]);

const isConnected = () => dbConfig.isDbConnected();

const assertEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return;
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: ${[...allowed].join(", ")}`);
  }
};

const assertAmount = (amount) => {
  const num = Number(amount);
  if (amount === undefined || amount === null || !Number.isFinite(num) || num < 1) {
    throw new Error(`Invalid amount: ${amount}. Amount must be a number >= 1 (Mongo schema min: 1).`);
  }
};

const assertItemAmount = (amount) => {
  const num = Number(amount);
  if (amount !== undefined && amount !== null && !Number.isFinite(num)) {
    throw new Error(`Invalid item amount: ${amount}. Amount must be a finite number.`);
  }
};

const validate = (data) => {
  if (!data || !data.devoteeName || !String(data.devoteeName).trim()) {
    throw new Error("devoteeName is required");
  }
  if (data.amount === undefined || data.amount === null) {
    throw new Error("amount is required");
  }
  assertAmount(data.amount);
  assertEnum(data.paymentMode, PAYMENT_MODES, "paymentMode");
  assertEnum(data.status, STATUSES, "status");
  const items = Array.isArray(data.items)
    ? data.items
    : data.items === undefined || data.items === null ? [] : [data.items];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    assertEnum(item.itemType, ITEM_TYPES, "itemType");
    assertItemAmount(item.amount);
  }
};

/**
 * Creates a bill and its normalized items. Mirrors the semantic requirements
 * of the existing Mongo flow (billController.createBill, createLedgerBill):
 * devoteeName + amount are required, amount >= 1, and when no sevaType is
 * given at least one item must be present (validated by the caller).
 */
const create = async (data) => {
  validate(data);
  if (isConnected()) return billRepository.create(data);
  return Bill.create(data);
};

const findById = async (id) =>
  isConnected() ? billRepository.findById(id) : Bill.findById(id);

const findOne = async (filter = {}) =>
  isConnected() ? billRepository.findOne(filter) : Bill.findOne(filter);

const findMany = async (options = {}) =>
  isConnected() ? billRepository.findMany(options) : Bill.find(options.filter || {}).sort(options.sort || { billDate: -1 });

const updateById = async (id, updates) => {
  if (updates) {
    if (updates.amount !== undefined) assertAmount(updates.amount);
    assertEnum(updates.paymentMode, PAYMENT_MODES, "paymentMode");
    assertEnum(updates.status, STATUSES, "status");
  }
  return isConnected()
    ? billRepository.updateById(id, updates)
    : Bill.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
};

const replaceItems = async (billId, items) => {
  for (const item of Array.isArray(items) ? items : [items]) {
    if (!item || typeof item !== "object") continue;
    assertEnum(item.itemType, ITEM_TYPES, "itemType");
    assertItemAmount(item.amount);
  }
  return isConnected()
    ? billRepository.replaceItems(billId, items)
    : (async () => {
        const bill = await Bill.findById(billId);
        if (!bill) return null;
        bill.items = Array.isArray(items) ? items : items ? [items] : [];
        await bill.save();
        return bill;
      })();
};

const count = async (filter = {}) =>
  isConnected() ? billRepository.count(filter) : Bill.countDocuments(filter);

const destroy = async (id) =>
  isConnected() ? billRepository.destroy(id) : Boolean(await Bill.findByIdAndDelete(id));

const findManyBySourceId = async (sourceId) =>
  isConnected() ? billRepository.findManyBySourceId(sourceId) : Bill.find({ sourceId });

const updateManyBySourceId = async (sourceId, updates) =>
  isConnected() ? billRepository.updateManyBySourceId(sourceId, updates) : Bill.updateMany({ sourceId }, updates);

const deleteManyBySourceId = async (sourceId) =>
  isConnected() ? billRepository.deleteManyBySourceId(sourceId) : Bill.deleteMany({ sourceId });

// --- bill items ---

const createItem = async (data) => {
  assertEnum(data.itemType, ITEM_TYPES, "itemType");
  assertItemAmount(data.amount);
  if (isConnected()) return billItemRepository.create(data);
  const bill = await Bill.findById(data.billId);
  if (!bill) return null;
  bill.items.push({ itemType: data.itemType, itemName: data.itemName, amount: data.amount });
  await bill.save();
  return bill.items[bill.items.length - 1];
};

const findItemById = async (id) =>
  isConnected() ? billItemRepository.findById(id) : null;

const findItemsByBillId = async (billId) =>
  isConnected() ? billItemRepository.findByBillId(billId) : (async () => {
    const bill = await Bill.findById(billId).select("items");
    return bill && Array.isArray(bill.items) ? bill.items : [];
  })();

const updateItemById = async (id, updates) => {
  if (updates) {
    assertEnum(updates.itemType, ITEM_TYPES, "itemType");
    assertItemAmount(updates.amount);
  }
  return isConnected() ? billItemRepository.updateById(id, updates) : null;
};

const countItems = async (filter = {}) =>
  isConnected() ? billItemRepository.count(filter) : null;

const destroyItem = async (id) =>
  isConnected() ? billItemRepository.destroy(id) : false;

module.exports = {
  isConnected,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  replaceItems,
  count,
  destroy,
  findManyBySourceId,
  updateManyBySourceId,
  deleteManyBySourceId,
  createItem,
  findItemById,
  findItemsByBillId,
  updateItemById,
  countItems,
  destroyItem,
};