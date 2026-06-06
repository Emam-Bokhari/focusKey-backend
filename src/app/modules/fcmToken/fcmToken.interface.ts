import { Types } from "mongoose";
export interface IDeviceToken {
  userId: Types.ObjectId;
  fcmToken: string;
  deviceType: "ios" | "android" | "web";
  deviceId: string;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface INotificationPayload {
  notification: {
    title: string;
    body: string;
  };
  data?: Record<string, string>; // FCM data values MUST be strings
}
export type ITokenData = {
  fcmToken: string;
  deviceId: string;
  deviceType: "ios" | "android" | "web";
};
// 1. Extend Document to include timestamps automatically in TS
export interface IDeviceTokenModel extends IDeviceToken, Document {
  createdAt: Date;
  updatedAt: Date;
}
