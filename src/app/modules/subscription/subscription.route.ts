import express from "express";
import auth from "../../middlewares/auth";
import { USER_ROLES } from "../../../enums/user";
import { SubscriptionController } from "./subscription.controller";
import validateRequest from "../../middlewares/validateRequest";
import { SubscriptionValidations } from "./subscription.validation";
import { isAgent } from "../../../helpers/authHelper";

const router = express.Router();

router.post(
  "/create-checkout-session",
  isAgent,
  validateRequest(
    SubscriptionValidations.createCheckoutSessionValidationSchema,
  ),
  SubscriptionController.createCheckoutSession,
);

router.post(
  "/cancel-subscription",
  isAgent,
  SubscriptionController.cancelSubscription,
);

router.get(
  "/my-subscription",
  isAgent,
  SubscriptionController.getMySubscription,
);

router.get("/success", SubscriptionController.paymentSuccess);
router.get("/fail", SubscriptionController.paymentFail);

export const SubscriptionRoutes = router;
