import express from "express";
import { isPairedUser } from "../../../helpers/authHelper";
import validateRequest from "../../middlewares/validateRequest";
import { BreakController } from "./breaks.controller";
import { BreakValidation } from "./breaks.validation";

const router = express.Router();

router.post("/start", isPairedUser, BreakController.startBreak);
router.post("/stop", isPairedUser, BreakController.stopBreak);
router.post("/reconcile", isPairedUser, BreakController.reconcileBreak);
router.get("/status", isPairedUser, BreakController.getActiveBreakStatus);
router.get("/remaining", isPairedUser, BreakController.getRemainingBreaks);

router.get("/config", isPairedUser, BreakController.getGlobalBreakConfig);
router.patch(
  "/config",
  isPairedUser,
  validateRequest(BreakValidation.updateBreakConfigZodSchema),
  BreakController.updateGlobalBreakConfig,
);

export const BreakRoutes = router;
