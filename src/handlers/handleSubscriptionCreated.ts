import Stripe from "stripe";
import stripe from "../config/stripe";
import { User } from "../app/modules/user/user.model";
import { Plan } from "../app/modules/plan/plan.model";
import { Subscription } from "../app/modules/subscription/subscription.model";
import { sendNotifications } from "../helpers/notificationsHelper";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "../app/modules/notification/notification.constant";
import { emailTemplate } from "../shared/emailTemplate";
import { USER_ROLES } from "../enums/user";

export const handleSubscriptionCreated = async (data: Stripe.Subscription) => {
  // Retrieve the subscription from Stripe
  const subscription = await stripe.subscriptions.retrieve(data.id);

  // Retrieve the customer associated with the subscription
  const customer = (await stripe.customers.retrieve(
    subscription.customer as string,
  )) as Stripe.Customer;

  // Extract the price ID from the subscription items
  const priceId = subscription.items.data[0]?.price?.id;

  // Retrieve the invoice to get the transaction ID and amount paid
  let trxId: string | undefined;
  let amountPaid = 0;

  if (subscription.latest_invoice) {
    const invoice = await stripe.invoices.retrieve(
      subscription.latest_invoice as string,
    );
    trxId =
      typeof invoice?.payment_intent === "string"
        ? invoice.payment_intent
        : undefined;
    amountPaid = invoice?.total ? invoice.total / 100 : 0;
  }

  if (customer?.email) {
    const existingUser = await User.findOne({ email: customer?.email });

    if (existingUser) {
      // Find the pricing plan by priceId
      const pricingPlan = await Plan.findOne({ priceId });

      if (pricingPlan) {
        // Find the current active subscription
        const currentActiveSubscription = await Subscription.findOne({
          userId: existingUser._id,
          status: "active",
        });

        if (currentActiveSubscription) {
          // If already has active, maybe update it instead of error?
          // Stripe usually handles this, but for our DB we can deactivate old one
          await Subscription.findByIdAndUpdate(currentActiveSubscription._id, {
            status: "deactivated",
          });
        }

        const status = subscription.status;
        if (status !== "active" && status !== "trialing") {
          console.log(
            `Subscription ${subscription.id} is not active (status: ${status}). Skipping database creation.`,
          );
          return;
        }

        // Create a new subscription record
        const newSubscription = new Subscription({
          userId: existingUser._id,
          customerId: customer?.id,
          planId: pricingPlan._id,
          subscriptionId: subscription.id,
          status: status as any,
          amountPaid,
          trxId,
          currentPeriodStart: new Date(
            subscription.current_period_start * 1000,
          ),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        });

        await newSubscription.save();

        // Send Notification & Email to User
        await sendNotifications({
          receiver: existingUser._id.toString(),
          title: "Subscription Purchased",
          text: `You have successfully purchased the ${pricingPlan.title} plan.`,
          type: NOTIFICATION_TYPE.AGENT,
          referenceId: newSubscription._id.toString(),
          referenceModel: NOTIFICATION_REFERENCE_MODEL.SUBSCRIPTION,
          event: "subscription",
          ...emailTemplate.subscriptionEmail({
            email: existingUser.email!,
            name: existingUser.name,
            planName: pricingPlan.title,
            amount: amountPaid,
            status: status,
            date: new Date().toLocaleDateString(),
          }),
        });

        // Notify Admins
        const admin = await User.findOne({
          role: { $in: [USER_ROLES.SUPER_ADMIN] },
        });

        if (admin) {
          // Send Push/Socket & Email Notification to Admin
          await sendNotifications({
            receiver: admin._id.toString(),
            title: "New Subscription Purchased",
            text: `${existingUser.name} has purchased the ${pricingPlan.title} plan.`,
            type: NOTIFICATION_TYPE.ADMIN,
            referenceId: newSubscription._id.toString(),
            referenceModel: NOTIFICATION_REFERENCE_MODEL.SUBSCRIPTION,
            event: "subscription",
            ...emailTemplate.adminSubscriptionNotification({
              email: admin.email!,
              userName: existingUser.name,
              userEmail: existingUser.email!,
              planName: pricingPlan.title,
              amount: amountPaid,
              type: "created",
            }),
          });
        }

        console.log("Subscription Created: ", newSubscription);

        // Update the user to reflect the active subscription
        await User.findByIdAndUpdate(
          existingUser._id,
          {
            isSubscribed: true,
            hasAccess: status === "active" || status === "trialing",
            plan: pricingPlan._id,
            subscriptionId: subscription.id,
            customerId: customer.id,
            isAgentVerified: !!pricingPlan.features?.verifiedBadge,
            maxListings: pricingPlan.limits?.maxListings || 0,
            remainingListings: pricingPlan.limits?.maxListings || 0,
          },
          { new: true },
        );
      } else {
        console.error(`Pricing plan with Price ID: ${priceId} not found!`);
      }
    } else {
      console.error(`User with Email: ${customer.email} not found!`);
    }
  } else {
    console.error("No email found for the customer!");
  }
};
