import { Schema, model } from "mongoose";
import { IBreak, IBreakConfig } from "./breaks.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

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
    nudgeId: {
      type: Schema.Types.ObjectId,
      ref: "Nudge",
    },
    clientBreakId: {
      type: String,
      sparse: true,
      index: true,
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
    totalDurationMinutes: {
      type: Number,
      default: 0,
    },
    remainingSeconds: {
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
  },
);

breakSchema.plugin(softDeletePlugin);

breakSchema.index({ userId: 1, startTime: -1 });
breakSchema.index({ userId: 1, modeId: 1, startTime: -1 });
breakSchema.index({ userId: 1, status: 1, endTime: 1 });
breakSchema.index({ nudgeId: 1, status: 1, endTime: 1 });
breakSchema.index({ userId: 1, nudgeId: 1, status: 1 });
breakSchema.index({ userId: 1, isDeleted: 1 });
breakSchema.index({ userId: 1, createdAt: -1 });
breakSchema.index({ userId: 1, clientBreakId: 1 }, { sparse: true });

export const Break = model<IBreak>("Break", breakSchema);

const breakConfigSchema = new Schema<IBreakConfig>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
  },
);

breakConfigSchema.plugin(softDeletePlugin);

breakConfigSchema.index({ userId: 1 });

export const BreakConfig = model<IBreakConfig>(
  "BreakConfig",
  breakConfigSchema,
);
