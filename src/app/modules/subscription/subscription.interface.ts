import { Types } from "mongoose";

export interface ISubscription {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  subscriptionId: string;
  customerId: string;
  status: "active" | "canceled" | "trialing" | "deactivated";
  amountPaid: number;
  trxId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
}