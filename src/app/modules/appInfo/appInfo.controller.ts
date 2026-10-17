import catchAsync from '../../../shared/catchAsync';
import { SettingsServices } from './appInfo.service';

const getPrivacyPolicy = catchAsync(async (req, res) => {
  const htmlContent = await SettingsServices.getPrivacyPolicy();
  res.sendFile(htmlContent);
});

const getAccountDelete = catchAsync(async (req, res) => {
  const htmlContent = await SettingsServices.getAccountDelete();
  res.sendFile(htmlContent);
});

const getSupport = catchAsync(async (req, res) => {
  const htmlContent = await SettingsServices.getSupport();
  res.sendFile(htmlContent);
});

export const SettingControllers = {
  getPrivacyPolicy,
  getAccountDelete,
  getSupport,
};
