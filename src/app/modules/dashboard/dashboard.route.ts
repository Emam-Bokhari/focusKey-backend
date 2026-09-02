import express from "express";
import { isAdmin, isUser } from "../../../helpers/authHelper";
import { DashboardController } from "./dashboard.controller";

const router = express.Router();

router.get("/focus-session", isUser, DashboardController.getDashboardData);

router.get("/history", isUser, DashboardController.getHistoryData);

router.get("/history-v2", isUser, DashboardController.getHistoryV2);

router.get(
  "/recent-activity",
  isAdmin,
  DashboardController.getAdminDashboardData,
);

export const DashboardRoutes = router;
