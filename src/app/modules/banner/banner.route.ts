import express from "express";
import { USER_ROLES } from "../../../enums/user";
import { BannerController } from "./banner.controller";
import { FOLDER_NAMES } from "../../../enums/files";
import auth from "../../middlewares/auth";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import validateRequest from "../../middlewares/validateRequest";
import { BannerZodValidation } from "./banner.validation";
import { parseFileData } from "../../middlewares/parseFileData";
import { isAdmin } from "../../../helpers/authHelper";

const router = express.Router();

router
  .route("/")
  .post(
    isAdmin,
    fileUploadHandler(),
    parseFileData({ mode: "single", fieldName: "image" }),
    validateRequest(BannerZodValidation.createBannerValidationSchema),
    BannerController.createBanner,
  )
  .get(BannerController.getBannersFromDB);

router.patch("/status/:id", isAdmin, BannerController.updateBannerStatus);

router
  .route("/:id")
  .patch(
    isAdmin,
    fileUploadHandler(),
    parseFileData({ mode: "single", fieldName: "image" }),
    BannerController.updateBanner,
  )
  .delete(isAdmin, BannerController.deleteBanner);

router.get("/all", isAdmin, BannerController.getAllBanner);

export const BannerRoutes = router;
