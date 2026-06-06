import { z } from "zod";
import {
  PLAN_STATUS,
  PLAN_TIER,
  PLATFORM_PLAN_DURATION,
} from "./plan.constant";

const createPlanValidationSchema = z.object({
  body: z.object({
    title: z.string({ required_error: "Title is required" }),
    description: z.string().optional(),
    tier: z.nativeEnum(PLAN_TIER, { required_error: "Tier is required" }),
    status: z.nativeEnum(PLAN_STATUS).optional(),
    duration: z.nativeEnum(PLATFORM_PLAN_DURATION, {
      required_error: "Duration is required",
    }),
    pricing: z.object({
      amount: z.number({ required_error: "Amount is required" }),
      currency: z
        .string({ required_error: "Currency is required" })
        .default("GBP"),
    }),
    limits: z.object({
      maxListings: z.number({ required_error: "Max listings is required" }),
    }),
    features: z.object({
      listings: z.boolean().default(false),
      leadAccess: z.boolean().default(false),
      // featuredListing: z.boolean().default(false),
      verifiedBadge: z.boolean().default(false),
      agentProfilePage: z.boolean().default(false),
    }),
    sortOrder: z.number().optional(),
    trial: z
      .object({
        enabled: z.boolean().default(false),
        durationInMonths: z.number().optional(),
        restrictions: z
          .object({
            // featuredListing: z.boolean().default(false),
            leadAccess: z.boolean().default(false),
          })
          .optional(),
      })
      .optional(),
  }),
});

const updatePlanValidationSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    tier: z.nativeEnum(PLAN_TIER).optional(),
    status: z.nativeEnum(PLAN_STATUS).optional(),
    duration: z.nativeEnum(PLATFORM_PLAN_DURATION).optional(),
    pricing: z
      .object({
        amount: z.number().optional(),
        currency: z.string().optional(),
      })
      .optional(),
    limits: z
      .object({
        maxListings: z.number().optional(),
      })
      .optional(),
    features: z
      .object({
        listings: z.boolean().optional(),
        leadAccess: z.boolean().optional(),
        // featuredListing: z.boolean().optional(),
        verifiedBadge: z.boolean().optional(),
        agentProfilePage: z.boolean().optional(),
      })
      .optional(),
    sortOrder: z.number().optional(),
    trial: z
      .object({
        enabled: z.boolean().optional(),
        durationInMonths: z.number().optional(),
        restrictions: z
          .object({
            // featuredListing: z.boolean().optional(),
            leadAccess: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export const PlanValidations = {
  createPlanValidationSchema,
  updatePlanValidationSchema,
};
