import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { DashboardController } from "./dashboard.controller";

const router = express.Router();

router.get("/focus-session", isUser, DashboardController.getDashboardData);

router.get("/history", isUser, DashboardController.getHistoryData);

router.get("/history-v2", isUser, DashboardController.getHistoryV2);

export const DashboardRoutes = router;