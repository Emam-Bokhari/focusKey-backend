import { StatusCodes } from "http-status-codes";
import Stripe from "stripe";
import ApiError from "../errors/ApiErrors";
import stripe from "../config/stripe";
import { User } from "../app/modules/user/user.model";
import { Subscription } from "../app/modules/subscription/subscription.model";
import { Plan } from "../app/modules/plan/plan.model";
import { sendNotifications } from "../helpers/notificationsHelper";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "../app/modules/notification/notification.constant";
import { emailTemplate } from "../shared/emailTemplate";
import { USER_ROLES } from "../enums/user";

export const handleSubscriptionDeleted = async (data: Stripe.Subscription) => {
  // Retrieve the subscription from Stripe
  const subscription = await stripe.subscriptions.retrieve(data.id);

  // Find the current active subscription
  const userSubscription = await Subscription.findOne({
    subscriptionId: subscription.id,
  });

  if (userSubscription) {
    // Deactivate the subscription
    await Subscription.findByIdAndUpdate(
      userSubscription._id,
      { status: "canceled" },
      { new: true },
    );

    // Find the user associated with the subscription
    const existingUser = await User.findById(userSubscription?.userId);

    if (existingUser) {
      // Find the pricing plan
      const pricingPlan = await Plan.findById(userSubscription.planId);
      const planName = pricingPlan ? pricingPlan.title : "Unknown Plan";

      // Send Notification & Email to User
      await sendNotifications({
        receiver: existingUser._id.toString(),
        title: "Subscription Cancelled",
        text: `Your subscription to the ${planName} plan has been cancelled.`,
        type: NOTIFICATION_TYPE.AGENT,
        referenceId: userSubscription._id.toString(),
        referenceModel: NOTIFICATION_REFERENCE_MODEL.SUBSCRIPTION,
        event: "subscription",
        ...emailTemplate.subscriptionEmail({
          email: existingUser.email!,
          name: existingUser.name,
          planName: planName,
          amount: userSubscription.amountPaid || 0,
          status: "canceled",
          date: new Date().toLocaleDateString(),
          isCancellation: true,
        }),
      });

      // Notify Admins
      const admin = await User.findOne({
        role: { $in: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
      });

      if (admin) {
        await sendNotifications({
          receiver: admin._id.toString(),
          title: "Subscription Cancelled",
          text: `${existingUser.name} has cancelled their ${planName} subscription.`,
          type: NOTIFICATION_TYPE.ADMIN,
          referenceId: userSubscription._id.toString(),
          referenceModel: NOTIFICATION_REFERENCE_MODEL.SUBSCRIPTION,
          event: "subscription",
          ...emailTemplate.adminSubscriptionNotification({
            email: admin.email!,
            userName: existingUser.name,
            userEmail: existingUser.email!,
            planName: planName,
            amount: userSubscription.amountPaid || 0,
            type: "cancelled",
          }),
        });
      }

      await User.findByIdAndUpdate(
        existingUser._id,
        {
          hasAccess: false,
          isSubscribed: false,
          isAgentVerified: false,
          maxListings: 0,
          remainingListings: 0,
        },
        { new: true },
      );
    } else {
      console.error(`User not found for subscription ${subscription.id}`);
    }
  } else {
    console.error(`Subscription record not found for ${subscription.id}`);
  }
};
