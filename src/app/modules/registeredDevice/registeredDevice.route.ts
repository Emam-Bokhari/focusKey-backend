import express from "express";
import multer from "multer";
import { isAdmin } from "../../../helpers/authHelper";
import validateRequest from "../../middlewares/validateRequest";
import { RegisteredDeviceValidation } from "./registeredDevice.validation";
import { RegisteredDeviceController } from "./registeredDevice.controller";

const router = express.Router();

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router
  .route("/")
  .post(
    isAdmin,
    validateRequest(RegisteredDeviceValidation.createDeviceSchema),
    RegisteredDeviceController.createDevice,
  )
  .get(isAdmin, RegisteredDeviceController.getAllDevices);

router.post(
  "/bulk",
  isAdmin,
  validateRequest(RegisteredDeviceValidation.bulkCreateDeviceSchema),
  RegisteredDeviceController.bulkCreateDevices,
);

router.post(
  "/bulk-upload",
  isAdmin,
  memoryUpload.single("file"),
  RegisteredDeviceController.bulkUploadDevicesCsv,
);

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
