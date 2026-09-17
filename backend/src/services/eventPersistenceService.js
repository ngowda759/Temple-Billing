const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const Event = require("../models/Event");
const eventRepository = require("../repositories/eventRepository");

// The events domain has no dedicated service of its own today — eventController
// and devoteeController talk to the Mongoose model directly. This service is the
// single seam through which those call sites now reach either PostgreSQL or
// Mongoose, selected at call time.
//
// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate for the Event path: PostgreSQL is used when the
// datasource seam is connected AND PostgreSQL is actually reachable. If either
// condition fails the existing Mongoose model handles the operation, so an
// unavailable PostgreSQL can never take the app down nor cause a partial write.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const validate = (data) => eventRepository.validate(data);

// Mirrors Event.create(payload). The repository narrows the payload to the
// strict schema's persisted key set, so a spread `req.body` behaves exactly as
// it does under Mongoose strict mode. Validation runs on both branches so the
// PostgreSQL path and the Mongoose path reject the same payloads with the same
// message.
const create = async (data) => {
  validate(data);
  return (await usePostgres()) ? eventRepository.create(data) : Event.create(data);
};

// Mirrors Event.findById(id) — both updateEvent handlers and both
// updateEventStatus handlers read the document before mutating it.
const findById = async (id) =>
  (await usePostgres()) ? eventRepository.findById(id) : Event.findById(id);

// Mirrors Event.find().sort({ date: 1 }) — the listing both getEvents handlers
// return. The caller supplies the exact filter/sort it needs so the existing
// semantics are preserved verbatim.
const findMany = async (options = {}) => {
  if (await usePostgres()) return eventRepository.findMany(options);
  const { filter = {}, sort = { date: 1 }, limit, offset } = options;
  let q = Event.find(filter).sort(sort);
  if (limit) q = q.limit(limit);
  if (offset) q = q.skip(offset);
  return q;
};

// Mirrors the findById → conditional assignment → save() flow shared by
// eventController.updateEvent, devoteeController.updateEvent and both
// updateEventStatus handlers.
const updateById = async (id, updates) =>
  (await usePostgres()) ? eventRepository.updateById(id, updates) : Event.findByIdAndUpdate(id, updates, { new: true });

// Mirrors the $inc aggregate bumps the booking/donation flows issue against a
// linked event.
const incrementById = async (id, increments) => {
  if (await usePostgres()) return eventRepository.incrementById(id, increments);
  return Event.findByIdAndUpdate(String(id), { $inc: { ...increments } }, { new: true });
};

// Mirrors the auto-complete write
// Event.updateMany({ date: { $lt: todayStart }, status: { $in: [...] } },
//                  { $set: { status: 'Completed' } })
// that both getEvents handlers and getFestivalOverview run before reading.
const updateMany = async (filter = {}, updates = {}) =>
  (await usePostgres()) ? eventRepository.updateMany(filter, updates) : Event.updateMany(filter, updates);

// Mirrors Event.countDocuments(filter) — the three getFestivalOverview counts.
const countDocuments = async (filter = {}) =>
  (await usePostgres()) ? eventRepository.countDocuments(filter) : Event.countDocuments(filter);

// Mirrors the two getFestivalOverview $group $sum aggregations (registrations
// and collection, all-time and current-month).
const sumTotals = async (filter = {}) =>
  (await usePostgres()) ? eventRepository.sumTotals(filter) : sumTotalsFromMongo(filter);

const sumTotalsFromMongo = async (filter) => {
  const agg = await Event.aggregate([
    { $match: filter },
    { $group: { _id: null, registrations: { $sum: "$registrations" }, collection: { $sum: "$collection" } } },
  ]);
  return {
    registrations: (agg[0] && agg[0].registrations) || 0,
    collection: (agg[0] && agg[0].collection) || 0,
  };
};

// Mirrors devoteeController.deleteEvent's Event.findByIdAndDelete(id).
const findByIdAndDelete = async (id) =>
  (await usePostgres()) ? eventRepository.findByIdAndDelete(id) : Event.findByIdAndDelete(id);

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findById,
  findMany,
  updateById,
  incrementById,
  updateMany,
  countDocuments,
  sumTotals,
  findByIdAndDelete,
};
