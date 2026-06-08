import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { DashboardController } from "./dashboard.controller";

const router = express.Router();

router.get("/focus-session", isUser, DashboardController.getDashboardData);

export const DashboardRoutes = router;
