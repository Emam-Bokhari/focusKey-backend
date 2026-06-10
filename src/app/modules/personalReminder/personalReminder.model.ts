import mongoose from "mongoose";
import { TPersonalReminder } from "./personalReminder.interface";

export const personalReminderSchema = new mongoose.Schema<TPersonalReminder>(
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
