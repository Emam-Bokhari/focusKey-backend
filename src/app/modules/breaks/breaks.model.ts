import { Schema, model } from "mongoose";
import { IBreak, IBreakConfig } from "./breaks.interface";

const breakSchema = new Schema<IBreak>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    modeId: {
      type: Schema.Types.ObjectId,
      ref: "Mode",
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    durationMinutes: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const Break = model<IBreak>("Break", breakSchema);

const breakConfigSchema = new Schema<IBreakConfig>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    breaksPerDay: {
      type: Number,
      required: true,
      default: 4,
    },
    breakDurationMinutes: {
      type: Number,
      required: true,
      default: 15,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const BreakConfig = model<IBreakConfig>("BreakConfig", breakConfigSchema);
