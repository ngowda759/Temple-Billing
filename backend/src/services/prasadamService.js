const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Prasadam = require("../models/Prasadam");
const prasadamRepository = require("../repositories/prasadamRepository");

// The Prasadam master has no service of its own today — prasadamController,
// devoteeController and inventoryWorkflowController talk to the Mongoose model
// directly. This service is the single seam through which those call sites now
// reach either PostgreSQL or Mongoose, selected at call time.
//
// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Prasadam master: PostgreSQL is used when
// the datasource seam is connected AND PostgreSQL is actually reachable. If
// either condition fails the existing Mongoose model handles the operation, so
// an unavailable PostgreSQL can never take the app down nor cause a partial
// write. This is the same Gate B that Phase 2G onward established.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const validate = (data) => prasadamRepository.validate(data);

// The `status` virtual (Out Of Stock / Low Stock / Available) is computed, not
// stored, so a Mongoose document carries it through toJSON/toObject. A lean
// object from the PostgreSQL repository carries it too. This normalizes a
// Mongoose document to the same plain shape the repository returns, so every
// controller response body is identical on both paths.
const toPlain = (doc) => {
  if (!doc) return doc;
  const plainDoc = doc.toObject ? doc.toObject() : doc;
  if (plainDoc.status === undefined) {
    const availableQuantity = Number(plainDoc.availableQuantity) || 0;
    const minimumStock = Number(plainDoc.minimumStock) || 0;
    plainDoc.status = prasadamRepository.computeStatus(availableQuantity, minimumStock);
  }
  return plainDoc;
};

// Mirrors Prasadam.create(payload). Validation runs on both branches so the
// PostgreSQL path and the Mongoose path reject the same payloads with the same
// message. A duplicate name raises a 11000-shaped error on either path, which
// prasadamController already turns into HTTP 409.
const create = async (data) => {
  validate(data);
  return (await usePostgres()) ? prasadamRepository.create(data) : Prasadam.create(data);
};

// Mirrors Prasadam.find().sort({ name: 1 }) — the listing getAllPrasadam
// returns. The caller supplies the exact filter/sort it needs so the existing
// semantics are preserved verbatim.
const findMany = async (options = {}) => {
  if (await usePostgres()) return prasadamRepository.findMany(options);
  const { filter = {}, sort = { name: 1 }, limit, offset } = options;
  let q = Prasadam.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

const findById = async (id) =>
  (await usePostgres()) ? prasadamRepository.findById(id) : Prasadam.findById(id);

// Exact-name lookup. `caseInsensitive` mirrors the specific call site:
// devoteeController's order flow matches with /^<itemName>$/i (true), while
// inventoryWorkflowController.logKitchenProduction matches exactly (false).
const findOneByName = async (name, options) =>
  (await usePostgres())
    ? prasadamRepository.findOneByName(name, options)
    : Prasadam.findOne(
        options && options.caseInsensitive
          ? { name: { $regex: new RegExp(`^${name}$`, "i") } }
          : { name }
      );

// Mirrors prasadamController.updatePrasadam's findById then
// findByIdAndUpdate(..., { new: true }) — deliberately without runValidators,
// exactly as the controller does today. Mongoose therefore does NOT apply the
// min:0 validators here and a negative value is reachable (and persists) through
// PUT /api/prasadam/:id; the PostgreSQL path mirrors that rather than tightening
// it.
const updateById = async (id, updates) =>
  (await usePostgres())
    ? prasadamRepository.updateById(id, updates)
    : Prasadam.findByIdAndUpdate(id, updates, { new: true });

// The two stock movements on the master:
//  - restockPrasadam adds, createPrasadamOrder subtracts without a floor
//    (matching availableQuantity += / -=), and verifyPrasadamPayment subtracts
//    with clampAtZero (matching Math.max(0, …)).
// Mirrors the existing findById → mutate → save() semantics; the PostgreSQL
// path performs it as one atomic UPDATE.
const incrementById = async (id, delta, options) =>
  (await usePostgres())
    ? prasadamRepository.incrementById(id, delta, options)
    : incrementViaMongo(id, delta, options);

const incrementViaMongo = async (id, delta, options = {}) => {
  const doc = await Prasadam.findById(id);
  if (!doc) return null;
  const next = (doc.availableQuantity || 0) + Number(delta);
  doc.availableQuantity = options.clampAtZero ? Math.max(0, next) : next;
  await doc.save();
  return doc;
};

// Mirrors prasadamController.deletePrasadam's Prasadam.findByIdAndDelete(id).
const destroy = async (id) =>
  (await usePostgres()) ? prasadamRepository.destroy(id) : Prasadam.findByIdAndDelete(id);

module.exports = {
  isConnected,
  usePostgres,
  validate,
  toPlain,
  create,
  findMany,
  findById,
  findOneByName,
  updateById,
  incrementById,
  destroy,
};
