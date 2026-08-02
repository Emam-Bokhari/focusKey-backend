import ApiError from "../../../errors/ApiErrors";
import { TSettings } from "./settings.interface";
import { Settings } from "./settings.model";

const createOrUpdateSettingsToDB = async (payload: TSettings) => {
  const existingSettings = await Settings.findOne();

  let result;

  if (existingSettings) {
    result = await Settings.findByIdAndUpdate(
      existingSettings._id,
      { $set: payload },
      { new: true, runValidators: true },
    );
  } else {
    result = await Settings.create(payload);
  }

  return result;
};

const getSettingsFromDB = async () => {
  const settings = await Settings.findOne();

  if (!settings) {
    throw new ApiError(404, "Settings not found");
  }

  return settings;
};

export const SettingsServices = {
  createOrUpdateSettingsToDB,
  getSettingsFromDB,
};
