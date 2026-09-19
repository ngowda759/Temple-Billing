const dbConfig = require("../config/db");
const { isPostgresConnected } = require("../config/postgres");
const PriestSetting = require("../models/PriestSetting");
const priestSettingRepository = require("../repositories/priestSettingRepository");

// PriestSetting has no service of its own today — priestController.getSettings /
// updateSettings talk to the Mongoose model directly. This service is the single
// seam through which those handlers now reach either PostgreSQL or Mongoose,
// selected at call time.
//
// isConnected() exposes the datasource-selection seam (mongoose's connectivity
// flag), read through the config module rather than a require-time destructure,
// so tests can swap the function after this module is loaded.
const isConnected = () => dbConfig.isDbConnected();

// Gate B: PostgreSQL is used when the datasource seam is connected AND
// PostgreSQL is actually reachable. If either condition fails the existing
// Mongoose model handles the operation, so an unavailable PostgreSQL can never
// take the app down nor cause a partial write.
const usePostgres = async () => {
  if (!dbConfig.isDbConnected()) return false;
  try {
    return await isPostgresConnected();
  } catch {
    return false;
  }
};

const validate = (data) => priestSettingRepository.validate(data);

// Mirrors PriestSetting.create(payload) with the schema defaults applied on the
// repository branch, so a freshly created document is identical either way.
const create = async (data) =>
  (await usePostgres()) ? priestSettingRepository.create(data) : PriestSetting.create(data);

// Mirrors PriestSetting.findOne({ priestId }) — the lookup both handlers make.
const findOne = async (filter = {}) =>
  (await usePostgres())
    ? priestSettingRepository.findOne(filter)
    : PriestSetting.findOne(filter);

const findById = async (id) =>
  (await usePostgres()) ? priestSettingRepository.findById(id) : PriestSetting.findById(id);

// Mirrors the lazy materialisation in priestController.getSettings:
//   let settings = await PriestSetting.findOne({ priestId });
//   if (!settings) settings = await PriestSetting.create({ priestId });
// On the MongoDB branch the two steps stay explicit so the fallback issues the
// exact same calls it does today.
const getOrCreate = async (priestId) => {
  if (await usePostgres()) return priestSettingRepository.findOneOrCreate(priestId);
  let settings = await PriestSetting.findOne({ priestId });
  if (!settings) settings = await PriestSetting.create({ priestId });
  return settings;
};

// Mirrors priestController.updateSettings exactly:
//   findOne({ priestId }); when absent build new PriestSetting({ priestId });
//   assign only the fields that are `!== undefined`; save().
// `false` is therefore preserved (it is not treated as "absent"), and an
// omitted toggle keeps its stored value. On the PostgreSQL branch the lazy
// create is followed by a partial update of the same five-field surface.
const updateSettings = async (priestId, body = {}) => {
  const { smsNotifications, dutyReminders, calendarWidget, agamaReferenceModule } = body;

  if (await usePostgres()) {
    const settings = await priestSettingRepository.findOneOrCreate(priestId);
    const updates = {};
    if (smsNotifications !== undefined) updates.smsNotifications = smsNotifications;
    if (dutyReminders !== undefined) updates.dutyReminders = dutyReminders;
    if (calendarWidget !== undefined) updates.calendarWidget = calendarWidget;
    if (agamaReferenceModule !== undefined) updates.agamaReferenceModule = agamaReferenceModule;
    return priestSettingRepository.updateById(settings._id, updates);
  }

  let settings = await PriestSetting.findOne({ priestId });
  if (!settings) {
    settings = new PriestSetting({ priestId });
  }

  if (smsNotifications !== undefined) settings.smsNotifications = smsNotifications;
  if (dutyReminders !== undefined) settings.dutyReminders = dutyReminders;
  if (calendarWidget !== undefined) settings.calendarWidget = calendarWidget;
  if (agamaReferenceModule !== undefined) settings.agamaReferenceModule = agamaReferenceModule;

  await settings.save();
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