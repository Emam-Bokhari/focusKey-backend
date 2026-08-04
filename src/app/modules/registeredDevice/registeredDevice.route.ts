import express from "express";
import { isAdmin } from "../../../helpers/authHelper";
import validateRequest from "../../middlewares/validateRequest";
import { RegisteredDeviceValidation } from "./registeredDevice.validation";
import { RegisteredDeviceController } from "./registeredDevice.controller";

const router = express.Router();

router
  .route("/")
  .post(
    isAdmin,
    validateRequest(RegisteredDeviceValidation.createDeviceSchema),
    RegisteredDeviceController.createDevice,
  )
  .get(isAdmin, RegisteredDeviceController.getAllDevices);

router.post("/:id/reset", isAdmin, RegisteredDeviceController.resetDevice);

router
  .route("/:id")
  .get(isAdmin, RegisteredDeviceController.getDeviceById)
  .patch(
    isAdmin,
    validateRequest(RegisteredDeviceValidation.updateDeviceSchema),
    RegisteredDeviceController.updateDevice,
  )
  .delete(isAdmin, RegisteredDeviceController.deleteDevice);

export const RegisteredDeviceRoutes = router;
