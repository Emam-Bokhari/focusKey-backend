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

export const FocusSession = model<IFocusSession>(
  "FocusSession",
  focusSessionSchema,
);
