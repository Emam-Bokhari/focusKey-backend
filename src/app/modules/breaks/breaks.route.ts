import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { BreakController } from "./breaks.controller";

const router = express.Router();

router.post("/start", isUser, BreakController.startBreak);
router.post("/stop", isUser, BreakController.stopBreak);
router.get("/status", isUser, BreakController.getActiveBreakStatus);
router.get("/remaining", isUser, BreakController.getRemainingBreaks);

router.get("/config", isUser, BreakController.getGlobalBreakConfig);
router.patch("/config", isUser, BreakController.updateGlobalBreakConfig);

export const BreakRoutes = router;
