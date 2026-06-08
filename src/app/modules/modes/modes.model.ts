import { Schema, model } from "mongoose";
import { IMode, TModeModel } from "./modes.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";


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



const modeSchema = new Schema<IMode, TModeModel>(
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

    totalLockedApps: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);
modeSchema.plugin(softDeletePlugin);

// Auto update totalLockedApps count before saving
modeSchema.pre("save", function (next) {
  if (this.lockedApps) {
    this.totalLockedApps = this.lockedApps.length;
  }
  next();
});

modeSchema.index({ userId: 1, isActive: 1 });

export const Mode = model<IMode, TModeModel>("Mode", modeSchema);
