import mongoose from "mongoose";
import { logger } from "../../../shared/logger";
import colors from "colors";
import { ITokenData } from "./fcmToken.interface";
import { DeviceToken } from "./fcmToken.model";

const saveDeviceToken = async (
  userId: string | mongoose.Types.ObjectId,
  payload: ITokenData,
) => {
  try {
    const fcmToken = payload.fcmToken?.trim();
    const deviceId = payload.deviceId?.trim();
    const deviceType = payload.deviceType || "android";

    if (!fcmToken || !deviceId) {
      logger.warn(
        colors.yellow(
          `saveDeviceToken skipped: fcmToken or deviceId missing for user ${userId}`,
        ),
      );
      return null;
    }

    // 1. Delete any record that has this fcmToken but belongs to a different deviceId or another user
    await DeviceToken.deleteMany({
      fcmToken,
      $or: [
        { userId: { $ne: userId } },
        { deviceId: { $ne: deviceId } },
      ],
    });

    // 2. Upsert by (userId, deviceId) so that if the device gets a new token, the old token for that device is replaced
    const result = await DeviceToken.findOneAndUpdate(
      {
        userId: userId,
        deviceId: deviceId,
      },
      {
        $set: {
          fcmToken: fcmToken,
          deviceType: deviceType,
          updatedAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      },
    );

    logger.info(
      colors.green(`Token saved: User ${userId}, Device ${deviceId}`),
    );
    return result;
  } catch (error) {
    logger.error(colors.red("Error saving device token:"), error);
    throw error;
  }
};

export const FcmTokenService = {
  saveDeviceToken,
};
