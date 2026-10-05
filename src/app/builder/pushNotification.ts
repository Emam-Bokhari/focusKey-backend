import mongoose from "mongoose";
import { User } from "../modules/user/user.model";
import { Notification } from "../modules/notification/notification.model";
import { logger } from "../../shared/logger";
import colors from "colors";
import { DeviceToken } from "../modules/fcmToken/fcmToken.model";
import { firebaseAdmin } from "../../config/firebase";
import { NOTIFICATION_TYPE } from "../modules/notification/notification.constant";

export interface INotificationPayload {
  title: string;
  body: string;
  type: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
  sender?: string;
  channelId?: string;
}

class NotificationHelper {
  async sendToUser(
    userId: string | mongoose.Types.ObjectId,
    payload: INotificationPayload,
  ) {
    let badge = payload.badge;
    if (badge === undefined) {
      try {
        const unreadCount = await Notification.countDocuments({
          receiver: userId,
          read: false,
        });
        badge = unreadCount + 1;
      } catch (err) {
        logger.error(colors.red("Error calculating unreadCount in sendToUser:"), err);
      }
    }
    return this.sendToBatch([userId], { ...payload, badge });
  }

  async sendToBatch(
    userIds: (string | mongoose.Types.ObjectId)[],
    payload: INotificationPayload,
  ) {
    try {
      if (!userIds.length) return;

      const validUsers = await User.find({
        _id: { $in: userIds },
      })
        .select("_id")
        .lean();

      const validUserIds = validUsers.map((u) => u._id);

      if (validUserIds.length === 0) return;

      const tokensData = await DeviceToken.find({
        userId: { $in: validUserIds },
        fcmToken: { $exists: true, $ne: "" },
      })
        .select("fcmToken userId")
        .lean();

      const tasks: Promise<any>[] = [];

      if (tokensData.length > 0) {
        const tokensByUser = new Map<string, string[]>();
        for (const tokenDoc of tokensData) {
          const uid = tokenDoc.userId.toString();
          if (!tokensByUser.has(uid)) {
            tokensByUser.set(uid, []);
          }
          tokensByUser.get(uid)!.push(tokenDoc.fcmToken);
        }

        for (const [uid, userTokens] of tokensByUser.entries()) {
          tasks.push(
            (async () => {
              let userBadge = payload.badge;
              if (userBadge === undefined) {
                try {
                  const unreadCount = await Notification.countDocuments({
                    receiver: uid,
                    read: false,
                  });
                  userBadge = unreadCount + 1;
                } catch (err) {
                  logger.error("Error calculating unreadCount in sendToBatch:", err);
                }
              }

              await this.sendToFCM(userTokens, {
                ...payload,
                badge: userBadge,
              });
            })(),
          );
        }
      }

      if (validUserIds.length > 0) {
        tasks.push(this.saveToDatabase(validUserIds, payload));
      }

      await Promise.allSettled(tasks);

      logger.info(
        colors.green(
          `Notification flow completed for ${validUserIds.length} users.`,
        ),
      );
    } catch (error) {
      logger.error(colors.red("NotificationHelper Error:"), error);
    }
  }

  async sendChatMessage(chat: any, message: any) {
    try {
      const senderId = message.sender._id.toString();
      const senderName =
        message.sender.name ||
        `${message.sender.firstName || ""} ${message.sender.lastName || ""}`.trim() ||
        "User";

      let bodyText = message.text;
      if (message.isDeleted) bodyText = "This message was deleted";
      if (!bodyText && message.productId)
        bodyText = "Sent a product attachment";
      if (!bodyText) bodyText = "Sent a new message";

      const recipients = chat.participants
        .filter((p: any) => {
          const pId = p._id ? p._id.toString() : p.toString();
          return pId !== senderId;
        })
        .map((p: any) => p._id || p);

      if (recipients.length === 0) return;

      await this.sendToBatch(recipients, {
        title: senderName,
        body: bodyText.substring(0, 100),
        type: NOTIFICATION_TYPE.MESSAGE_NEW,
        sender: senderId,
        data: {
          type: NOTIFICATION_TYPE.MESSAGE_NEW,
          chatId: chat._id.toString(),
          messageId: message._id.toString(),
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
      });
    } catch (error) {
      logger.error(colors.red("Error inside sendChatMessage:"), error);
    }
  }

  private async sendToFCM(tokens: string[], payload: INotificationPayload) {
    try {
      const BATCH_SIZE = 500;
      const chunks: string[][] = [];
      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        chunks.push(tokens.slice(i, i + BATCH_SIZE));
      }

      const sanitizedData: Record<string, string> = {};
      if (payload.data) {
        for (const [key, value] of Object.entries(payload.data)) {
          if (value !== undefined && value !== null) {
            sanitizedData[key] = typeof value === "string" ? value : String(value);
          }
        }
      }

      if (!sanitizedData.click_action) {
        sanitizedData.click_action = "FLUTTER_NOTIFICATION_CLICK";
      }

      if (payload.type && !sanitizedData.type) {
        sanitizedData.type = String(payload.type);
      }

      if (!sanitizedData.title) {
        sanitizedData.title = payload.title;
      }

      if (!sanitizedData.body) {
        sanitizedData.body = payload.body;
      }

      const channelId =
        payload.channelId ||
        sanitizedData.channelId ||
        sanitizedData.channel_id;

      for (const chunk of chunks) {
        const message: any = {
          tokens: chunk,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: sanitizedData,
          apns: {
            headers: {
              "apns-priority": "10",
              "apns-push-type": "alert",
            },
            payload: {
              aps: {
                alert: {
                  title: payload.title,
                  body: payload.body,
                },
                sound: payload.sound || "default",
                ...(typeof payload.badge === "number" ? { badge: payload.badge } : {}),
                "content-available": 1,
              },
            },
          },
          android: {
            priority: "high",
            notification: {
              title: payload.title,
              body: payload.body,
              sound: payload.sound || "default",
              defaultSound: true,
              defaultVibrateTimings: true,
              priority: "max",
              clickAction: "FLUTTER_NOTIFICATION_CLICK",
              ...(channelId ? { channelId } : {}),
            },
          },
        };

        const response = await firebaseAdmin
          .messaging()
          .sendEachForMulticast(message);

        logger.info(
          colors.blue(
            `FCM send result: ${response.successCount} succeeded, ${response.failureCount} failed.`,
          ),
        );

        if (response.failureCount > 0) {
          const failedTokens: string[] = [];
          response.responses.forEach((resp: any, idx: number) => {
            if (!resp.success) {
              const errCode = resp.error?.code;
              logger.warn(
                colors.yellow(
                  `FCM token delivery error [${chunk[idx]}]: ${resp.error?.message} (${errCode})`,
                ),
              );
              if (
                errCode === "messaging/registration-token-not-registered" ||
                errCode === "messaging/invalid-registration-token" ||
                errCode === "messaging/mismatched-credential" ||
                (errCode === "messaging/invalid-argument" &&
                  resp.error?.message?.includes("registration token"))
              ) {
                failedTokens.push(chunk[idx]);
              }
            }
          });

          if (failedTokens.length > 0) {
            await DeviceToken.deleteMany({ fcmToken: { $in: failedTokens } });
            logger.info(
              colors.yellow(
                `Cleaned up ${failedTokens.length} invalid tokens.`,
              ),
            );
          }
        }
      }
    } catch (error) {
      logger.error(colors.red("FCM Send Error:"), error);
    }
  }

  private async saveToDatabase(userIds: any[], payload: INotificationPayload) {
    try {
      const notifications = userIds.map((userId) => ({
        receiver: userId,
        sender: payload.sender || payload.data?.sender || undefined,
        title: payload.title,
        text: payload.body,
        type: payload.type,
        read: false,
        referenceId: payload.data?.referenceId || undefined,
        referenceModel: payload.data?.referenceModel || undefined,
      }));

      const savedNotifications = await Notification.insertMany(notifications);

      //@ts-ignore
      const socketIo = global.io;
      if (socketIo) {
        for (const notif of savedNotifications) {
          const populated = await notif.populate("receiver sender referenceId");
          socketIo.emit(`send-notification::${notif.receiver}`, populated);
        }
      }
      return savedNotifications;
    } catch (error) {
      logger.error(colors.red("DB Save Error:"), error);
      return [];
    }
  }
}

export const notificationHelper = new NotificationHelper();
