import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { ModeController } from "./modes.controller";

const router = express.Router();

router
  .route("/")
  .post(isUser, ModeController.createMode)
  .get(isUser, ModeController.getModes);

router
  .route("/:modeId")
  .get(isUser, ModeController.getSingleMode)
  .patch(isUser, ModeController.updateMode)
  .delete(isUser, ModeController.deleteMode);

// lock/unlock
router.patch(
  "/:modeId/toggle-activation",
  isUser,
  ModeController.toggleModeActivation,
);

export const ModeRoutes = router;
