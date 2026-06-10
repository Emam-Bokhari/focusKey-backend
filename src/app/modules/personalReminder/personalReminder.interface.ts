import { Types } from "mongoose";

export type TPersonalReminder = {
  userId?: Types.ObjectId;
  message: string;
};
