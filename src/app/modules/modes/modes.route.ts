import express from "express";
import { isPairedUser } from "../../../helpers/authHelper";
import { ModeController } from "./modes.controller";

const router = express.Router();

router
  .route("/")
  .post(isPairedUser, ModeController.createMode)
  .get(isPairedUser, ModeController.getModes);

router.get("/app-count", isPairedUser, ModeController.getModeAppCount);
router.get("/app-details", isPairedUser, ModeController.getModeAppDetails);
router.get("/total-focus-apps", isPairedUser, ModeController.getTotalFocusApps);
router.get("/lock-status", isPairedUser, ModeController.getLockStatus);
router.get(
  "/app-details/:modeId",
  isPairedUser,
  ModeController.getSingleModeAppDetails,
);

router
  .route("/:modeId")
  .get(isPairedUser, ModeController.getSingleMode)
  .patch(isPairedUser, ModeController.updateMode)
  .delete(isPairedUser, ModeController.deleteMode);

router.patch(
  "/:modeId/toggle-activation",
  isPairedUser,
  ModeController.toggleModeActivation,
);

export const ModeRoutes = router;
