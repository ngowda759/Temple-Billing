const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Supplier = require("../models/Supplier");
const supplierRepository = require("../repositories/supplierRepository");

// isConnected() exposes the datasource-selection seam. It is read through the
// config module (dbConfig.isDbConnected()) rather than a require-time
// destructure (const { isDbConnected } = ...), so the datasource can change at
// runtime — tests flip it after this module is loaded — without the module
// capturing a stale function reference.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Supplier path: PostgreSQL is used only
// when the established datasource seam is connected AND PostgreSQL is actually
// reachable. If either condition fails the path routes back to the existing
// Mongoose model, so an unavailable PostgreSQL can never take the supplier
// endpoints down.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

// Mirrors the Mongoose `required: true` + `trim` check on `name`: an omitted,
// empty or whitespace-only value fails validation (trim runs before the
// required check). Every other field is optional, exactly as in the schema.
const assertRequired = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
};

/**
 * Validates and normalizes a supplier payload with the same rules the Mongo
 * schema applies, so the PostgreSQL repository and the Mongoose model receive
 * the same cleaned payload.
 *
 * Business rules mirror the Mongo schema exactly:
 *  - `name` is required; a blank or whitespace-only value is rejected.
 *  - address / phone / email / gst are optional Strings trimmed by the schema.
 *    Their values are NOT validated or reformatted — no email-format CHECK, no
 *    GST-format CHECK — because the schema declares them as free Strings and
 *    Mongo enforces nothing, so rejecting a differently-shaped value would make
 *    PostgreSQL stricter than the source of truth.
 *  - No uniqueness rule is applied: the schema declares no unique index, so two
 *    suppliers may share a name (or any other field).
 *  - `itemsSupplied` is not mapped: it is unused across the application, and it
 *    is deliberately not represented in PostgreSQL. It stays accepted by the
 *    Mongo schema untouched.
 *
 * Nothing else is coerced here; the repository applies the same defaults when
 * building the row.
 */
const normalizeSupplier = (data) => {
  if (!data) throw new Error("Supplier data is required");
  assertRequired(data.name, "name");
  const normalized = { ...data };
  normalized.name = String(data.name).trim();
  return normalized;
};

const validate = (data) => {
  normalizeSupplier(data);
};

const create = async (data) => {
  const normalized = normalizeSupplier(data);
  if (await usePostgres()) return supplierRepository.create(normalized);
  return Supplier.create(normalized);
};

const findById = async (id) =>
  (await usePostgres()) ? supplierRepository.findById(id) : Supplier.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? supplierRepository.findOne(filter) : Supplier.findOne(filter);

/**
 * The listing behind GET /api/admin/inventory-suppliers. Mirrors
 * Supplier.find().sort({ name: 1 }) — the only listing query the domain has.
 */
const findMany = async (options = {}) => {
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  if (await usePostgres()) return supplierRepository.findMany(options);

  let q = Supplier.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

/**
 * Mirrors Supplier.findByIdAndUpdate(id, updates, { new: true }).
 *
 * The service deliberately does NOT validate `name` here. The controller's
 * existing Mongo call passes no `runValidators`, so Mongoose applies the update
 * verbatim — an empty name overwrites rather than raising — and the service
 * must not turn that accepted write into an error. (The POST path is where
 * `name` is enforced, and createSupplier already rejects a blank name before
 * reaching the service.)
 */
const updateById = async (id, updates = {}) => {
  if (await usePostgres()) return supplierRepository.updateById(id, updates);
  return Supplier.findByIdAndUpdate(String(id), updates, { new: true });
};

const count = async (filter = {}) =>
  (await usePostgres()) ? supplierRepository.count(filter) : Supplier.countDocuments(filter);

const destroy = async (id) =>
  (await usePostgres()) ? supplierRepository.destroy(id) : Supplier.findByIdAndDelete(String(id));

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  updateById,
  count,
  destroy,
};