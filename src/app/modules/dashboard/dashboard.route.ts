import express from "express";
import { isAdmin, isPairedUser } from "../../../helpers/authHelper";
import { DashboardController } from "./dashboard.controller";

const router = express.Router();

router.get("/focus-session", isPairedUser, DashboardController.getDashboardData);

router.get("/history", isPairedUser, DashboardController.getHistoryData);

router.get("/history-v2", isPairedUser, DashboardController.getHistoryV2);

router.get(
  "/recent-activity",
  isAdmin,
  DashboardController.getAdminDashboardData,
);

export const DashboardRoutes = router;
