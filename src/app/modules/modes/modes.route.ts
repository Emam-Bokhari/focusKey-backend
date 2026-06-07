import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { ModeController } from "./modes.controller";

const router = express.Router();

router
  .route("/")
  .post(isUser, ModeController.createMode)
  .get(isUser, ModeController.getModes);

router
  .route("/:id")
  .get(isUser, ModeController.getSingleMode)
  .patch(isUser, ModeController.updateMode)
  .delete(isUser, ModeController.deleteMode);

export const ModeRoutes = router;
