import express from 'express';
import { SettingControllers } from './appInfo.controller';

const router = express.Router();

router
  .get('/privacy-policy', SettingControllers.getPrivacyPolicy)
  .get('/account-delete-policy', SettingControllers.getAccountDelete)
  .get('/support', SettingControllers.getSupport);

export const AppInfoRoutes = router;
