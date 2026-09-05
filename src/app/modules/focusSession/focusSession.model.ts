import { Schema, model } from "mongoose";
import { IFocusSession } from "./focusSession.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const focusSessionSchema = new Schema<IFocusSession>(
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
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
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
  },
);

focusSessionSchema.plugin(softDeletePlugin);

focusSessionSchema.index({ userId: 1, startTime: -1 });
focusSessionSchema.index({ userId: 1, modeId: 1, startTime: -1 });
focusSessionSchema.index({ userId: 1, status: 1, endTime: -1 });
focusSessionSchema.index({ userId: 1, status: 1, startTime: -1 });
focusSessionSchema.index({ nudgeId: 1, status: 1 });
focusSessionSchema.index({ userId: 1, isDeleted: 1 });

export const FocusSession = model<IFocusSession>(
  "FocusSession",
  focusSessionSchema,
);
