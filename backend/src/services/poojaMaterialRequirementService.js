const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const PoojaMaterialRequirement = require("../models/PoojaMaterialRequirement");
const poojaMaterialRequirementRepository = require("../repositories/poojaMaterialRequirementRepository");

// Same datasource seam as every other Phase 2 service: read through the config
// module at call time, never captured at module load.
const isConnected = () => dbConfig.isDbConnected();

const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

// Mirrors PoojaMaterialRequirement.find() — the listing behind
// GET /api/pooja-settings. The populated `requiredMaterials.item` projection
// ("name unit category") is reassembled by poojaService.populateMaterials,
// because the PostgreSQL repository returns plain id strings.
const findMany = async (options = {}) =>
  (await usePostgres())
    ? poojaMaterialRequirementRepository.findMany(options)
    : PoojaMaterialRequirement.find(options.filter || {});

const findOneByName = async (poojaName) =>
  (await usePostgres())
    ? poojaMaterialRequirementRepository.findOneByName(poojaName)
    : PoojaMaterialRequirement.findOne({ poojaName });

// Mirrors saveRequirement's findOneAndUpdate({ poojaName: poojaName.trim() },
// { requiredMaterials: items || [] }, { new: true, upsert: true }). The Mongo
// branch deliberately does NOT pass runValidators, because the original
// controller does not — that asymmetry is part of the behaviour being preserved.
const upsertByName = async (poojaName, materials) =>
  (await usePostgres())
    ? poojaMaterialRequirementRepository.upsertByName(poojaName, materials)
    : PoojaMaterialRequirement.findOneAndUpdate(
      { poojaName: String(poojaName).trim() },
      { requiredMaterials: materials || [] },
      { new: true, upsert: true }
    );

const count = async (filter = {}) =>
  (await usePostgres())
    ? poojaMaterialRequirementRepository.count(filter)
    : PoojaMaterialRequirement.countDocuments(filter);

module.exports = {
  isConnected,
  usePostgres,
  findMany,
  findOneByName,
  upsertByName,
  count,
};