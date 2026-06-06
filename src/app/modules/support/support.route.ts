import express from "express";
import { USER_ROLES } from "../../../enums/user";
import auth from "../../middlewares/auth";
import { SupportControllers } from "./support.controller";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import { parseFileData } from "../../middlewares/parseFileData";
import { isAdmin, isAuthenticated } from "../../../helpers/authHelper";

const router = express.Router();

router
  .route("/")
  .post(
    isAuthenticated,
    fileUploadHandler(),
    parseFileData({
      fieldName: "attachment",
      mode: "single",
    }),
    SupportControllers.submitSupportRequest,
  )
  .get(isAdmin, SupportControllers.getAllSupports);

router
  .route("/:id/review")
  .patch(isAdmin, SupportControllers.reviewSupportByAdmin);

router
  .route("/:id")
  .get(isAdmin, SupportControllers.getSupportById)
  .delete(isAdmin, SupportControllers.deleteSupportById);

export const SupportRoutes = router;
