import mongoose, { model } from "mongoose";
import { TPersonalReminder } from "./personalReminder.interface";

const personalReminderSchema = new mongoose.Schema<TPersonalReminder>(
  {
    userId: {
      type: mongoose.Types.ObjectId,
      ref: "User",
    },
    message: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const PersonalReminder = model<TPersonalReminder>(
  "PersonalReminder",
  personalReminderSchema,
);
