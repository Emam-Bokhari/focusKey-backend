import { Schema, model } from "mongoose";
import { IFriend, INudge } from "./friends.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const friendSchema = new Schema<IFriend>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    friendId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "accepted", // For now, let's assume direct addition
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

friendSchema.plugin(softDeletePlugin);

const nudgeSchema = new Schema<INudge>(
  {
    creatorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    joinedParticipants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    modeId: {
      type: Schema.Types.ObjectId,
      ref: "Mode",
      required: true,
    },
    breakConfig: {
      breaksPerDay: { type: Number, required: true },
      breakDurationMinutes: { type: Number, required: true },
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["active", "completed", "scheduled"],
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

nudgeSchema.plugin(softDeletePlugin);

export const Friend = model<IFriend>("Friend", friendSchema);
export const Nudge = model<INudge>("Nudge", nudgeSchema);
