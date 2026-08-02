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

deviceTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

deviceTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 15552000 });
deviceTokenSchema.index({ fcmToken: 1 });
export const DeviceToken = mongoose.model<IDeviceTokenModel>(
  "DeviceToken",
  deviceTokenSchema,
);
