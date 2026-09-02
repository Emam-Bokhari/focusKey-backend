import { Schema, model } from "mongoose";
import {
  IFriend,
  INudge,
  INudgeParticipant,
  INudgePreview,
} from "./friends.interface";
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
      enum: ["pending", "accepted", "rejected", "cancelled"],
      default: "pending",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

friendSchema.index({ userId: 1, friendId: 1 });
friendSchema.index({ status: 1 });

friendSchema.plugin(softDeletePlugin);

const nudgeParticipantSchema = new Schema<INudgeParticipant>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    _id: false,
  },
);

const nudgeSchema = new Schema<INudge>(
  {
    creatorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participants: [nudgeParticipantSchema],
    joinedParticipants: [nudgeParticipantSchema],
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

const nudgePreviewSchema = new Schema<INudgePreview>(
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
    modeId: {
      type: Schema.Types.ObjectId,
      ref: "Mode",
      required: true,
    },
    breakConfig: {
      breaksPerDay: { type: Number, required: true },
      breakDurationMinutes: { type: Number, required: true },
    },
    status: {
      type: String,
      enum: ["pending", "expired", "confirmed"],
      default: "pending",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Friend = model<IFriend>("Friend", friendSchema);
export const Nudge = model<INudge>("Nudge", nudgeSchema);
export const NudgePreview = model<INudgePreview>(
  "NudgePreview",
  nudgePreviewSchema,
);
