import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { SettingsServices } from "./settings.service";

const createOrUpdateSettings = catchAsync(async (req, res) => {
  const data = req.body;
  const result = await SettingsServices.createOrUpdateSettingsToDB(data);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Settings updated successfully",
    data: result,
  });
});

const getSettings = catchAsync(async (req, res) => {
  const result = await SettingsServices.getSettingsFromDB();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Settings fetched successfully",
    data: result,
  });
});

export const SettingsControllers = {
  createOrUpdateSettings,
  getSettings,
};
