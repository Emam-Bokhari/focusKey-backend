import express from "express";
import { WebhookControllers } from "./webhook.controller";

const router = express.Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  WebhookControllers.stripeWebhook,
);

export const WebhookRoutes = router;
