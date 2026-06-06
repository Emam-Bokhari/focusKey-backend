import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IPlan } from "./plan.interface";
import stripe from "../../../config/stripe";
import { Plan } from "./plan.model";
import { createSubscriptionProduct, getStripeInterval } from "./plan.utils";
import { PLAN_STATUS } from "./plan.constant";

const createPlanToDB = async (payload: IPlan): Promise<IPlan | null> => {
  const productPayload = {
    title: payload.title,
    description: payload.description,
    duration: payload.duration,
    price: Number(payload.pricing.amount),
    currency: payload.pricing.currency,
  };

  const stripeData = await createSubscriptionProduct(productPayload);

  // if stripeData creation fails, createSubscriptionProduct will throw an error,
  // preventing the execution from reaching this point and ensuring no Plan is created in DB.

  payload.productId = stripeData.productId;
  payload.priceId = stripeData.priceId;

  const result = await Plan.create(payload);
  if (!result) {
    if (stripeData.productId) {
      await stripe.products.update(stripeData.productId, { active: false });
    }
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create Plan");
  }

  return result;
};

const getAllPlansFromDB = async (query: any) => {
  const result = await Plan.find({ ...query, isDeleted: false }).sort({
    sortOrder: 1,
  });
  return result;
};



const getPlanByIdFromDB = async (planId: string) => {
  const result = await Plan.findById(planId);
  if (!result || result.isDeleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Plan not found");
  }
  return result;
};

const updatePlanToDB = async (planId: string, payload: Partial<IPlan>) => {
  const isExist = await Plan.findById(planId);
  if (!isExist || isExist.isDeleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Plan not found");
  }

  // handle Stripe Product Update (Title/Description/Status)
  if (payload.title || payload.description || payload.status) {
    if (isExist.productId) {
      const stripeUpdatePayload: any = {};
      if (payload.title) stripeUpdatePayload.name = payload.title;
      if (payload.description)
        stripeUpdatePayload.description = payload.description;
      if (payload.status)
        stripeUpdatePayload.active = payload.status === PLAN_STATUS.ACTIVE;
      if (payload.sortOrder !== undefined)
        stripeUpdatePayload.metadata = { sortOrder: payload.sortOrder.toString() };

      await stripe.products.update(isExist.productId, stripeUpdatePayload);
    }
  }

  // handle Stripe Price Update (Amount/Currency/Duration)
  // stripe prices are immutable, so we must create a new one if price-related fields change
  const isPriceChanged =
    payload.pricing?.amount !== undefined &&
    Number(payload.pricing.amount) !== isExist.pricing.amount;

  const isCurrencyChanged =
    payload.pricing?.currency !== undefined &&
    payload.pricing.currency.toLowerCase() !==
      isExist.pricing.currency.toLowerCase();

  const isDurationChanged =
    payload.duration !== undefined && payload.duration !== isExist.duration;



  if (isPriceChanged || isCurrencyChanged || isDurationChanged) {
    if (!isExist.productId) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Cannot update price: No Stripe Product ID found for this plan",
      );
    }

    const newAmount =
      payload.pricing?.amount !== undefined
        ? Number(payload.pricing.amount)
        : isExist.pricing.amount;
    const newCurrency = (
      payload.pricing?.currency ?? isExist.pricing.currency
    ).toLowerCase();
    const newDuration = payload.duration ?? isExist.duration;

    const { interval, interval_count } = getStripeInterval(newDuration);

    const newPrice = await stripe.prices.create({
      product: isExist.productId,
      unit_amount: Math.round(newAmount * 100),
      currency: newCurrency,
      recurring: {
        interval,
        interval_count,
      },
    });

    // update the priceId in payload to be saved in DB
    payload.priceId = newPrice.id;
  }

  // handle: Prevent manual update of Stripe IDs if they leaked into payload
  delete (payload as any).productId;
  // Note: we allow priceId if we just created a new one above,
  // but if it was in the original payload it should be ignored or handled.
  if (!isPriceChanged && !isCurrencyChanged && !isDurationChanged) {
    delete payload.priceId;
  }

  // update DB using findByIdAndUpdate with runValidators
  // handle: be careful with nested objects to avoid partial overwrites
  const plainPlan = isExist.toObject();

  if (payload.pricing) {
    payload.pricing = {
      ...plainPlan.pricing,
      ...payload.pricing,
      amount:
        payload.pricing.amount !== undefined
          ? Number(payload.pricing.amount)
          : isExist.pricing.amount,
    };
  }
  if (payload.limits) {
    payload.limits = { ...plainPlan.limits, ...payload.limits };
  }
  if (payload.features) {
    payload.features = { ...plainPlan.features, ...payload.features };
  }
  if (payload.trial) {
    payload.trial = { ...plainPlan.trial, ...payload.trial };
  }

  const result = await Plan.findByIdAndUpdate(planId, payload, {
    new: true,
    runValidators: true,
  });

  return result;
};

const deletePlanFromDB = async (planId: string) => {
  const isExist = await Plan.findById(planId);
  if (!isExist || isExist.isDeleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Plan not found");
  }

  // handle: Mark plan as deleted in DB
  const result = await Plan.findByIdAndUpdate(
    planId,
    { isDeleted: true, status: PLAN_STATUS.INACTIVE },
    { new: true },
  );

  // handle: Deactivate plan in Stripe
  if (isExist.productId) {
    await stripe.products.update(isExist.productId, { active: false });
  }

  return result;
};

export const PlanServices = {
  createPlanToDB,
  getAllPlansFromDB,
  getPlanByIdFromDB,
  updatePlanToDB,
  deletePlanFromDB,
};
