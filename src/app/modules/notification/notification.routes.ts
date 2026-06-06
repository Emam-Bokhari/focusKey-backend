import express from "express";
import { NotificationController } from "./notification.controller";
import { isAdmin, isUserOrAgent } from "../../../helpers/authHelper";

const router = express.Router();

// --- ADMIN & SUPER_ADMIN ROUTES ---
router
  .route("/admin")
  .get(
    isAdmin,
    NotificationController.getAdminNotifications,
  )
  .patch(
    isAdmin,
    NotificationController.readAdminNotifications,
  );

router
  .route("/admin/:id")
  .get(
    isAdmin,
    NotificationController.getAdminSingleNotification,
  )
  .patch(
    isAdmin,
    NotificationController.readAdminSingleNotification,
  );

// --- USER & AGENT ROUTES ---
router
  .route("/")
  .get(
    isUserOrAgent,
    NotificationController.getNotifications,
  )
  .patch(
    isUserOrAgent,
    NotificationController.readNotifications,
  );

router
  .route("/:id")
  .get(
    isUserOrAgent,
    NotificationController.getSingleNotification,
  )
  .patch(
    isUserOrAgent,
    NotificationController.readSingleNotification,
  );

export const NotificationRoutes = router;
