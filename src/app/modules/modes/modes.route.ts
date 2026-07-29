import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { ModeController } from "./modes.controller";

const router = express.Router();

router
  .route("/")
  .post(isUser, ModeController.createMode)
  .get(isUser, ModeController.getModes);

router.get("/app-counts", isUser, ModeController.getModeAppCounts);
router.get("/app-details", isUser, ModeController.getModeAppDetails);
router.get("/total-focus-apps", isUser, ModeController.getTotalFocusApps);
router.get("/lock-status", isUser, ModeController.getLockStatus);
router.get(
  "/app-details/:modeId",
  isUser,
  ModeController.getSingleModeAppDetails,
);

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
