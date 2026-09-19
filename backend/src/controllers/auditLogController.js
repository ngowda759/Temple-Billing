const auditLogService = require("../services/auditLogService");

exports.getAuditLogs = async (req, res) => {
  try {
    const { startDate, endDate, user, action, module } = req.query;
    let query = {};

    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (user && user !== "All Users") {
      // Preserved verbatim from the pre-migration controller: the frontend
      // normally sends a User id, and the filter is applied only when the value
      // has ObjectId length (24). Any other value deliberately skips the filter.
      if (user.length === 24) query.user = user;
    }
    if (action && action !== "All Actions") {
      query.action = { $regex: action, $options: "i" };
    }
    if (module && module !== "All Modules") {
      query.module = module;
    }

    const logs = await auditLogService.findMany({
      filter: query,
      sort: { date: -1 },
      populate: true,
    });

    res.status(200).json(logs);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch audit logs", error: error.message });
  }
};

/**
 * Writes an audit record. Failures are swallowed (and logged) exactly as before:
 * an audit write must never fail the business request that triggered it, on
 * either datasource.
 */
exports.logAudit = async (userId, action, moduleName, details, ipAddress = "127.0.0.1") => {
  try {
    await auditLogService.create({
      user: userId,
      action,
      module: moduleName,
      details,
      ipAddress,
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
};
