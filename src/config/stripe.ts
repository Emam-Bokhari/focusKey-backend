import Stripe from "stripe";
import config from ".";

const stripe = new Stripe(config.stripe.stripeSecretKey as string);

export default stripe;
