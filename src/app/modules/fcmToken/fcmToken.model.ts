import mongoose, { Schema, Document } from "mongoose";
import { IDeviceTokenModel } from "./fcmToken.interface";

const deviceTokenSchema = new Schema<IDeviceTokenModel>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fcmToken: {
      type: String,
      required: true,
      trim: true,
    },
    deviceType: {
      type: String,
      enum: ["ios", "android", "web"],
      default: "android",
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// 2. Compound Index: Ensures a User + Device combo is unique
// (Prevents User A from having 5 entries for the same "iPhone 13")
deviceTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

// 15552000 seconds = 180 days
deviceTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 15552000 });
deviceTokenSchema.index({ fcmToken: 1 });
export const DeviceToken = mongoose.model<IDeviceTokenModel>(
  "DeviceToken",
  deviceTokenSchema,
);
