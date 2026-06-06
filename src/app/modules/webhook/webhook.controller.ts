import { Request, Response } from "express";
import Stripe from "stripe";
import config from "../../../config";
import stripe from "../../../config/stripe";
import { handleSubscriptionCreated } from "../../../handlers/handleSubscriptionCreated";
import { handleSubscriptionDeleted } from "../../../handlers/handleSubscriptionDeleted";
import { handleSubscriptionUpdated } from "../../../handlers/handleSubscriptionUpdated";
import { handleAccountUpdatedEvent } from "../../../handlers/handleAccountUpdatedEvent";

const stripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = config.stripe.webhookSecret as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // handle the event
  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "account.updated":
        await handleAccountUpdatedEvent(event.data.object as Stripe.Account);
        break;
      case "product.created":
      case "plan.created":
      case "price.created":
        console.log(`Event ${event.type} received and acknowledged.`);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (error: any) {
    console.error(`Error handling event ${event.type}:`, error.message);
    // we still return 200 to Stripe to avoid retries if we've logged the error
  }

  res.json({ received: true });
};

export const WebhookControllers = {
  stripeWebhook,
};
