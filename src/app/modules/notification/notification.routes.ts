import express from "express";
import { NotificationController } from "./notification.controller";
import { isAdmin, isUser } from "../../../helpers/authHelper";

const router = express.Router();

// Admin notification routes
router
  .route("/admin")
  .get(isAdmin, NotificationController.getAdminNotifications)
  .patch(isAdmin, NotificationController.readAdminNotifications);

router
  .route("/admin/:id")
  .get(isAdmin, NotificationController.getAdminSingleNotification)
  .patch(isAdmin, NotificationController.readAdminSingleNotification)
  .delete(isAdmin, NotificationController.deleteAdminNotification);

// User notification routes
router
  .route("/")
  .get(isUser, NotificationController.getNotifications)
  .patch(isUser, NotificationController.readNotifications);

router
  .route("/:id")
  .get(isUser, NotificationController.getSingleNotification)
  .patch(isUser, NotificationController.readSingleNotification)
  .delete(isUser, NotificationController.deleteNotification);

export const NotificationRoutes = router;
