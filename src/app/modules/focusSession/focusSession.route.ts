import express from "express";
import { isPairedUser } from "../../../helpers/authHelper";
import { FocusSessionController } from "./focusSession.controller";

const router = express.Router();

router.get("/history", isPairedUser, FocusSessionController.getFocusHistory);
router.get("/history-v2", isPairedUser, FocusSessionController.getFocusHistoryV2);

router.get("/stats", isPairedUser, FocusSessionController.getFocusStats);

router.get("/export-csv", isPairedUser, FocusSessionController.exportHistoryToCSV);

router.delete("/clear-all", isPairedUser, FocusSessionController.clearAllData);

router.post("/reconcile", isPairedUser, FocusSessionController.reconcileSession);

export const FocusSessionRoutes = router;
