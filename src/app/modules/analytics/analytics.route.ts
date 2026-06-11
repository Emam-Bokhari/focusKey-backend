import express from "express";
import { isAdmin, isUser } from "../../../helpers/authHelper";
import { AnalyticsControllers } from "./analytics.controller";

const router = express.Router();

router.get("/stats", isAdmin, AnalyticsControllers.getStats);

router.get("/engagement-stats", isAdmin, AnalyticsControllers.getEngagementStats);

router.get(
  "/focus-time-over-time",
  isAdmin,
  AnalyticsControllers.getFocusTimeOverTime,
);

router.get(
  "/focus-time-together-over-time",
  isAdmin,
  AnalyticsControllers.getFocusTimeTogetherOverTime,
);

router.get("/users", isAdmin, AnalyticsControllers.getUsersAnalytics);

router.get(
  "/users/:userId",
  isAdmin,
  AnalyticsControllers.getSingleUserAnalytics,
);

export const AnalyticsRoutes = router;
