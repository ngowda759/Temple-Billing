const poojaService = require("../services/poojaService");

// Poojas are read/written through poojaService so they follow the selected
// datasource: PostgreSQL when it is reachable, otherwise the existing Mongoose
// model. Both datasources return the same Mongo-shaped document; the only
// difference is that references stay plain id strings on the PostgreSQL path,
// so the populated `requiredMaterials.item` shape the pre-migration `populate`
// produced is reassembled via poojaService.populateMaterials. Response shapes,
// status codes and messages are unchanged.

exports.getAllPoojas = async (req, res) => {
  try {
    const poojas = await poojaService.findMany({ filter: {} });
    const populated = await Promise.all(
      poojas.map((pooja) => poojaService.populateMaterials(pooja, "inventoryNameCategoryStock"))
    );
    res.status(200).json(populated);
  } catch (err) {
    console.error("Error fetching poojas:", err);
    res.status(500).json({ message: "Failed to fetch poojas" });
  }
};

exports.getPoojaById = async (req, res) => {
  try {
    const pooja = await poojaService.findById(req.params.id);
    if (!pooja) {
      return res.status(404).json({ message: "Pooja not found" });
    }
    res.status(200).json(await poojaService.populateMaterials(pooja, "inventoryNameCategoryStock"));
  } catch (err) {
    console.error("Error fetching pooja:", err);
    res.status(500).json({ message: "Failed to fetch pooja" });
  }
};

exports.createPooja = async (req, res) => {
  try {
    const pooja = await poojaService.create(req.body);
    res.status(201).json({ message: "Pooja created successfully", pooja });
  } catch (err) {
    console.error("Error creating pooja:", err);
    res.status(400).json({ message: "Failed to create pooja", error: err.message });
  }
};

exports.updatePooja = async (req, res) => {
  try {
    const pooja = await poojaService.updateById(req.params.id, req.body);
    if (!pooja) {
      return res.status(404).json({ message: "Pooja not found" });
    }
    res.status(200).json({ message: "Pooja updated successfully", pooja });
  } catch (err) {
    console.error("Error updating pooja:", err);
    res.status(400).json({ message: "Failed to update pooja", error: err.message });
  }
};

exports.deletePooja = async (req, res) => {
  try {
    const pooja = await poojaService.destroy(req.params.id);
    if (!pooja) {
      return res.status(404).json({ message: "Pooja not found" });
    }
    res.status(200).json({ message: "Pooja deleted successfully" });
  } catch (err) {
    console.error("Error deleting pooja:", err);
    res.status(500).json({ message: "Failed to delete pooja" });
  }
};
