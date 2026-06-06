import {
  PLAN_STATUS,
  PLAN_TIER,
  PLATFORM_PLAN_DURATION,
} from "./plan.constant";
import { ISoftDeleteModel } from "../../../types/softDelete";

export interface IPlanLimits {
  maxListings: number; // -1 = unlimited
}

export interface IPlanFeatures {
  listings: boolean;
  leadAccess: boolean;
  // featuredListing: boolean;
  verifiedBadge: boolean;
  agentProfilePage: boolean;
}

export interface IPlanTrial {
  enabled: boolean;
  durationInMonths?: number; // only for TRIAL (e.g. 6)
  restrictions?: {
    // featuredListing: boolean;
    leadAccess: boolean;
  };
}

export interface IPlanPricing {
  amount: number;
  currency: string; // "GBP", "USD", etc.
}

export interface IPlan {
  title: string;
  description?: string;

  tier: PLAN_TIER;
  status: PLAN_STATUS;

  duration: PLATFORM_PLAN_DURATION;

  pricing: IPlanPricing;

  limits: IPlanLimits;
  features: IPlanFeatures;
  sortOrder?: number;
  paymentLink?: string;
  productId?: string;
  priceId?: string;
  trial?: IPlanTrial;
  isDeleted?: boolean;
}

export type TPlanModel = ISoftDeleteModel<IPlan>;
