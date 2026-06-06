import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import stripe from "../../../config/stripe";
import { User } from "../user/user.model";
import { Plan } from "../plan/plan.model";
import { Subscription } from "./subscription.model";

const createCheckoutSession = async (userId: string, planId: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  console.log(user,"USER")

  const plan = await Plan.findOne({ _id: planId });
  if (!plan) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Plan not found");
  }

  if (!plan.priceId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Plan has no Stripe Price ID");
  }

  // Create or retrieve Stripe Customer
  let customerId = user.customerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        userId: user._id.toString(),
      },
    });
    customerId = customer.id;
    await User.findByIdAndUpdate(userId, { customerId });
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: plan.priceId,
        quantity: 1,
      },
    ],
    success_url: "http://10.10.7.93:5001/api/v1/subscriptions/success",
    cancel_url: "http://10.10.7.93:5001/api/v1/subscriptions/fail",
    metadata: {
      userId: user._id.toString(),
      planId: plan._id.toString(),
    },
  });

  return session.url;
};


const cancelSubscription = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user || !user.subscriptionId) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "No active subscription found for this user",
    );
  }

  // Cancel on Stripe (cancel at period end to let them finish the paid period)
  const subscription = await stripe.subscriptions.update(user.subscriptionId, {
    cancel_at_period_end: true,
  });

  // The webhook 'customer.subscription.updated' will handle the status update in DB.
  // However, we can also update it here for immediate feedback if desired.
  // But usually, we wait for the webhook to be the source of truth.

  return subscription;
};

const getMySubscription = async (userId: string) => {
  const result = await Subscription.findOne({
    userId,
    status: { $in: ["active", "trialing"] },
  })
    .populate("planId")
    .sort({ createdAt: -1 });
  return result;
};

export const SubscriptionService = {
  createCheckoutSession,
  cancelSubscription,
  getMySubscription,
};
