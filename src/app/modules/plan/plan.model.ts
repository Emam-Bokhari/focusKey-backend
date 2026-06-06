import { Schema, model } from "mongoose";
import {
  PLAN_STATUS,
  PLAN_TIER,
  PLATFORM_PLAN_DURATION,
} from "./plan.constant";

import { IPlan, TPlanModel } from "./plan.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const planLimitsSchema = new Schema(
  {
    maxListings: {
      type: Number,
      required: true,
      default: -1,
    },
  },
  { _id: false },
);

const planFeaturesSchema = new Schema(
  {
    listings: {
      type: Boolean,
      default: false,
    },
    leadAccess: {
      type: Boolean,
      default: false,
    },
    // featuredListing: {
    //   type: Boolean,
    //   default: false,
    // },
    verifiedBadge: {
      type: Boolean,
      default: false,
    },
    agentProfilePage: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const planTrialSchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    durationInMonths: {
      type: Number,
    },
    restrictions: {
      // featuredListing: {
      //   type: Boolean,
      //   default: false,
      // },
      leadAccess: {
        type: Boolean,
        default: false,
      },
    },
  },
  { _id: false },
);

const planPricingSchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: "GBP",
    },
  },
  { _id: false },
);

const planSchema = new Schema<IPlan, TPlanModel>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
    },

    tier: {
      type: String,
      enum: Object.values(PLAN_TIER),
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(PLAN_STATUS),
      default: PLAN_STATUS.ACTIVE,
    },

    duration: {
      type: String,
      enum: Object.values(PLATFORM_PLAN_DURATION),
      required: true,
    },

    pricing: {
      type: planPricingSchema,
      required: true,
    },

    limits: {
      type: planLimitsSchema,
      required: true,
    },

    features: {
      type: planFeaturesSchema,
      required: true,
    },

    trial: {
      type: planTrialSchema,
    },

    paymentLink: {
      type: String,
    },

    productId: {
      type: String,
    },

    priceId: {
      type: String,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

planSchema.plugin(softDeletePlugin);

planSchema.index({ tier: 1, status: 1 });
planSchema.index({ sortOrder: 1 });

export const Plan = model<IPlan>("Plan", planSchema);
