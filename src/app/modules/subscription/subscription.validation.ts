import { z } from "zod";

const createCheckoutSessionValidationSchema = z.object({
  body: z.object({
    planId: z.string({
      required_error: "Plan ID is required",
    }),
  }),
});

export const SubscriptionValidations = {
  createCheckoutSessionValidationSchema,
};
