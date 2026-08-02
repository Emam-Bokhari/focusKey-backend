import { Schema, model } from "mongoose";

const settingsSchema = new Schema(
  {
    appName: {
      type: String,
      trim: true,
    },
    supportEmail: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Settings = model("Settings", settingsSchema);
