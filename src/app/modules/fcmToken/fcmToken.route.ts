import express from "express";
import { FcmTokenController } from "./fcmToken.controller";
import { isAuthenticated } from "../../../helpers/authHelper";

const router = express.Router();

router.post("/save-token", isAuthenticated, FcmTokenController.saveDeviceToken);

export const FcmTokenRoutes = router;
