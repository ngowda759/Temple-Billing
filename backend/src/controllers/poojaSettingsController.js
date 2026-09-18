const poojaMaterialRequirementService = require("../services/poojaMaterialRequirementService");
const poojaService = require("../services/poojaService");

// Pooja material requirements are read/written through
// poojaMaterialRequirementService so they follow the selected datasource:
// PostgreSQL when it is reachable, otherwise the existing Mongoose model. The
// populated `requiredMaterials.item` projection ("name unit category") is
// reassembled via poojaService.populateMaterials because the PostgreSQL
// repository returns plain id strings. Response shapes and status codes are
// unchanged.

exports.getAllRequirements = async (req, res) => {
  try {
    const reqs = await poojaMaterialRequirementService.findMany({});
    const populated = await Promise.all(
      reqs.map((req) => poojaService.populateMaterials(req, "inventoryNameUnitCategory"))
    );
    res.json({ success: true, requirements: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRequirementByName = async (req, res) => {
  try {
    const poojaName = req.params.poojaName;
    const reqs = await poojaMaterialRequirementService.findOneByName(poojaName);
    res.json({
      success: true,
      requirement: await poojaService.populateMaterials(reqs, "inventoryNameUnitCategory"),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveRequirement = async (req, res) => {
  try {
    const { poojaName, requiredMaterials } = req.body;
    if (!poojaName) return res.status(400).json({ success: false, message: "Pooja Name is required" });

    const reqs = await poojaMaterialRequirementService.upsertByName(poojaName, requiredMaterials);

    res.json({
      success: true,
      requirement: await poojaService.populateMaterials(reqs, "inventoryNameUnitCategory"),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
