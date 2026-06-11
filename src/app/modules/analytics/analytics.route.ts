import express from "express";
import { isAdmin, isUser } from "../../../helpers/authHelper";
import { AnalyticsControllers } from "./analytics.controller";

const router = express.Router();

router.get("/stats", isAdmin, AnalyticsControllers.getStats);

export const AnalyticsRoutes = router;
