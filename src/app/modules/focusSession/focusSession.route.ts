import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { FocusSessionController } from "./focusSession.controller";

const router = express.Router();

router.get("/history", isUser, FocusSessionController.getFocusHistory);

router.get("/stats", isUser, FocusSessionController.getFocusStats);

router.get("/export-csv", isUser, FocusSessionController.exportHistoryToCSV);

export const FocusSessionRoutes = router;
