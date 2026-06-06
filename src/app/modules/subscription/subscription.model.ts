import { Schema, model } from "mongoose";
import { ISubscription } from "./subscription.interface";

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    subscriptionId: {
      type: String,
      required: true,
      unique: true,
    },
    customerId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "canceled", "trialing", "deactivated"],
      default: "active",
    },
    amountPaid: {
      type: Number,
      required: true,
    },
    trxId: {
      type: String,
    },
    currentPeriodStart: {
      type: Date,
    },
    currentPeriodEnd: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Subscription = model<ISubscription>(
  "Subscription",
  subscriptionSchema,
);
