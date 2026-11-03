import express from "express";
import { isUser } from "../../../helpers/authHelper";
import validateRequest from "../../middlewares/validateRequest";
import { BreakController } from "./breaks.controller";
import { BreakValidation } from "./breaks.validation";

const router = express.Router();

router.post("/start", isUser, BreakController.startBreak);
router.post("/stop", isUser, BreakController.stopBreak);
router.post("/reconcile", isUser, BreakController.reconcileBreak);
router.get("/status", isUser, BreakController.getActiveBreakStatus);
router.get("/remaining", isUser, BreakController.getRemainingBreaks);

router.get("/config", isUser, BreakController.getGlobalBreakConfig);
router.patch(
  "/config",
  isUser,
  validateRequest(BreakValidation.updateBreakConfigZodSchema),
  BreakController.updateGlobalBreakConfig,
);

export const BreakRoutes = router;
