import { Schema, model } from "mongoose";
import { IMode } from "./modes.interface";


const lockedAppSchema = new Schema(
  {
    packageName: {
      type: String,
      required: true,
      trim: true,
    },
    appName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const scheduleSchema = new Schema(
  {
    startTime: {
      type: String,
      required: true,
      trim: true,
    }, // "09:00"

    endTime: {
      type: String,
      required: true,
      trim: true,
    }, // "15:00"
  },
  { _id: false }
);

const breakConfigSchema = new Schema(
  {
    breaksPerDay: {
      type: Number,
      default: 0,
      min: 0,
    },

    breakDurationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const modeSchema = new Schema<IMode>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    icon: {
      type: String,
      enum: [
        "gym",
        "study",
        "work",
        "workout",
        "social",
        "reading",
        "family",
        "meditation",
        "sleep",
        "creative",
      ],
      required: true,
    },

    lockedApps: {
      type: [lockedAppSchema],
      default: [],
    },

    schedule: {
      type: scheduleSchema,
      required: true,
    },

    breakConfig: {
      type: breakConfigSchema,
      default: {
        breaksPerDay: 0,
        breakDurationMinutes: 0,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);


modeSchema.index({ userId: 1, isActive: 1 });

export const Mode = model<IMode>("Mode", modeSchema);
