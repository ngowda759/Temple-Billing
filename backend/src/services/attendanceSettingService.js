const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const AttendanceSetting = require("../models/AttendanceSetting");
const attendanceSettingRepository = require("../repositories/attendanceSettingRepository");

// The AttendanceSetting singleton has no service of its own today
// (attendanceSettingsController and attendanceController talk to the Mongoose
// model directly). This service is the single seam through which those call
// sites now reach either PostgreSQL or Mongoose, selected at call time.
//
// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// The explicit PostgreSQL gate: PostgreSQL is used when the datasource seam is
// connected AND PostgreSQL is actually reachable. If either condition fails the
// existing Mongoose model handles the operation, so an unavailable PostgreSQL
// can never take the app down nor cause a partial write. This is the same
// Gate B that Phase 2G onward established.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const validate = (data) => attendanceSettingRepository.validate(data);

// Mirrors AttendanceSetting.create(payload) with the schema defaults applied on
// both branches, so a created settings document is identical either way.
const create = async (data) =>
  (await usePostgres())
    ? attendanceSettingRepository.create(data)
    : AttendanceSetting.create(data || {});

// Mirrors AttendanceSetting.findOne() — the read both call sites perform.
const findOne = async () =>
  (await usePostgres()) ? attendanceSettingRepository.findOne() : AttendanceSetting.findOne();

const findById = async (id) =>
  (await usePostgres())
    ? attendanceSettingRepository.findById(id)
    : AttendanceSetting.findById(id);

// Mirrors the lazy materialisation both call sites rely on:
//   let settings = await AttendanceSetting.findOne();
//   if (!settings) settings = await AttendanceSetting.create({});
// On the MongoDB branch the two steps are kept explicit rather than collapsed
// into a Mongoose upsert, so the fallback issues the exact same calls it does
// today.
const getOrCreate = async () => {
  if (await usePostgres()) return attendanceSettingRepository.findOneOrCreate();
  let settings = await AttendanceSetting.findOne();
  if (!settings) settings = await AttendanceSetting.create({});
  return settings;
};

// Mirrors attendanceSettingsController.updateSettings exactly:
//   findOne(); when found assign each field with `body.x ?? settings.x` and
//   save(); when absent create(body).
// The `?? existing` guards mean an omitted or null field keeps its stored
// value, and a lazily created singleton is seeded from the request body the
// same way the controller does it today.
const updateSettings = async (body = {}) => {
  const {
    templeLatitude,
    templeLongitude,
    allowedRadius,
    lateThreshold,
    earlyCheckInWindow,
  } = body;

  if (await usePostgres()) {
    const settings = await attendanceSettingRepository.findOneOrCreate();
    const updates = {};
    if (templeLatitude !== undefined && templeLatitude !== null) updates.templeLatitude = templeLatitude;
    if (templeLongitude !== undefined && templeLongitude !== null) updates.templeLongitude = templeLongitude;
    if (allowedRadius !== undefined && allowedRadius !== null) updates.allowedRadius = allowedRadius;
    if (lateThreshold !== undefined && lateThreshold !== null) updates.lateThreshold = lateThreshold;
    if (earlyCheckInWindow !== undefined && earlyCheckInWindow !== null) {
      updates.earlyCheckInWindow = earlyCheckInWindow;
    }
    return attendanceSettingRepository.updateById(settings._id, updates);
  }

  let settings = await AttendanceSetting.findOne();
  if (settings) {
    settings.templeLatitude = templeLatitude ?? settings.templeLatitude;
    settings.templeLongitude = templeLongitude ?? settings.templeLongitude;
    settings.allowedRadius = allowedRadius ?? settings.allowedRadius;
    settings.lateThreshold = lateThreshold ?? settings.lateThreshold;
    settings.earlyCheckInWindow = earlyCheckInWindow ?? settings.earlyCheckInWindow;
    await settings.save();
  } else {
    settings = await AttendanceSetting.create(body);
  }
  return settings;
};

module.exports = {
  isConnected,
  usePostgres,
  validate,
  create,
  findOne,
  findById,
  getOrCreate,
  updateSettings,
};