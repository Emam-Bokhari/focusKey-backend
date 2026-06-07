import express from "express";
import { NotificationController } from "./notification.controller";
import { isAdmin,  } from "../../../helpers/authHelper";

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


export const NotificationRoutes = router;
