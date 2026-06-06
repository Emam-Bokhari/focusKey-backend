import express from "express";
import { SettingsControllers } from "./settings.controller";
import validateRequest from "../../middlewares/validateRequest";
import { SettingsValidationSchema } from "./settings.validation";
import { isAdmin } from "../../../helpers/authHelper";

const router = express.Router();

router
  .route("/")
  .get(SettingsControllers.getSettings)
  .post(
    isAdmin,
    validateRequest(SettingsValidationSchema.settingsValidationSchema),
    SettingsControllers.createOrUpdateSettings,
  );

export const SettingsRoutes = router;
