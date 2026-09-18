const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Pooja = require("../models/Pooja");
const poojaRepository = require("../repositories/poojaRepository");
const inventoryItemService = require("./inventoryItemService");

// isConnected() exposes the datasource-selection seam used by every Phase 2
// service: mongoose's connectivity flag. It is read through the config module at
// call time (dbConfig.isDbConnected()) rather than destructured at require time,
// so tests (and any future runtime switch) can flip the seam on an
// already-loaded module.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate. This is the Phase 2Y fallback boundary: the
// service uses PostgreSQL when the established datasource seam is connected AND
// PostgreSQL is actually reachable. If either condition fails it routes back to
// the existing Mongoose model — so an unavailable PostgreSQL can never take the
// app down nor cause a partial write.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

// Validation is shared by both datasources so the PostgreSQL path and the Mongo
// fallback reject exactly the same payloads with exactly the same messages.
// nullableFields (populate) is only used by the read paths below.
const validate = (data) => poojaRepository.validate(data);

// Mirrors new Pooja(payload).save(). The repository narrows the payload to the
// strict schema's persisted key set, so a spread `req.body` behaves exactly as
// it does under Mongoose strict mode. Validation runs on both branches so the
// PostgreSQL path and the Mongoose path reject the same payloads with the same
// message.
const create = async (data) => {
  validate(data);
  return (await usePostgres()) ? poojaRepository.create(data) : Pooja.create(data || {});
};

const findById = async (id) =>
  (await usePostgres()) ? poojaRepository.findById(id) : Pooja.findById(id);

const findOne = async (filter = {}) =>
  (await usePostgres()) ? poojaRepository.findOne(filter) : Pooja.findOne(filter);

const findMany = async (options = {}) => {
  if (await usePostgres()) return poojaRepository.findMany(options);
  let q = options.sort ? Pooja.find(options.filter || {}).sort(options.sort) : Pooja.find(options.filter || {});
  if (options.limit) q = q.limit(options.limit);
  if (options.offset) q = q.skip(options.offset);
  return q;
};

const updateById = async (id, updates) =>
  (await usePostgres())
    ? poojaRepository.updateById(id, updates)
    : Pooja.findByIdAndUpdate(id, updates, { new: true, runValidators: true });

const destroy = async (id) =>
  (await usePostgres()) ? poojaRepository.destroy(id) : Pooja.findByIdAndDelete(id);

const count = async (filter = {}) =>
  (await usePostgres()) ? poojaRepository.count(filter) : Pooja.countDocuments(filter);

// Reassembles the `requiredMaterials.item` population the controllers used to
// get from Mongoose. Both datasources return the same Mongo-shaped document,
// but on the PostgreSQL path `item` stays a plain id string, so it is resolved
// through the InventoryItem service (which itself prefers PostgreSQL, falling
// back to Mongoose) — the same approach inventoryAssetController and
// inventoryWorkflowController use for their populated references.
//
// The projection matches the populate select strings exactly, including the
// fields that do not exist on InventoryItem ("currentStock" in poojaController's
// projection): Mongoose only includes paths that exist on the referenced schema,
// so the absent ones stay absent here too.
const POPULATE_PROJECTIONS = {
  inventoryNameCategoryStock: ["name", "category", "currentStock"],
  inventoryNameUnitCategory: ["name", "unit", "category"],
  full: null,
};

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

const project = (item, projection) => {
  const doc = plain(item);
  if (!doc) return null;
  if (!projection) return doc;
  const projected = { _id: doc._id || doc.id, id: doc.id || doc._id };
  for (const field of projection) {
    if (doc[field] !== undefined) projected[field] = doc[field];
  }
  return projected;
};

// `projectionName` selects which populate select string the caller used:
//   * "inventoryNameCategoryStock" — getAllPoojas / getPoojaById
//   * "inventoryNameUnitCategory"  — getAllRequirements / getRequirementByName /
//                                    saveRequirement
//   * "full"                       — the unprojected
//                                    populate("requiredMaterials.item") used by
//                                    poojaBookingController, devoteeController
//                                    and priestController
const populateMaterials = async (pooja, projectionName = "full") => {
  const doc = plain(pooja);
  if (!doc) return doc;
  const projection = POPULATE_PROJECTIONS[projectionName];
  if (projection === undefined) {
    throw new Error(`Unknown populate projection: ${projectionName}`);
  }
  if (!Array.isArray(doc.requiredMaterials) || doc.requiredMaterials.length === 0) {
    return doc;
  }
  const requiredMaterials = await Promise.all(doc.requiredMaterials.map(async (material) => {
    const raw = material && material.item;
    // Already populated (Mongo path) — leave the document as the model returned it.
    if (raw && typeof raw === "object") return material;
    if (!raw) return material;
    const item = await inventoryItemService.findById(String(raw));
    if (!item) return material;
    return { ...material, item: project(item, projection) };
  }));
  return { ...doc, requiredMaterials };
};

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findOne,
  findMany,
  populateMaterials,
  updateById,
  destroy,
  count,
};