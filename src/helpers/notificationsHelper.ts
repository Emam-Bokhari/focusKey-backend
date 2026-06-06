import { INotification } from "../app/modules/notification/notification.interface";
import { Notification } from "../app/modules/notification/notification.model";
import { notificationHelper } from "../app/builder/pushNotification";
import { NOTIFICATION_TYPE } from "../app/modules/notification/notification.constant";

export const sendNotifications = async (
  data: Partial<INotification>,
): Promise<INotification | any> => {
  if (data.type === NOTIFICATION_TYPE.USER) {
    // For User, use the Push Notification Helper (which also saves to DB)
    if (!data.receiver) return;

    const payload = {
      title: data.title || "Notification",
      body: data.text || "",
      type: data.type,
      data: {
        type: data.type,
        referenceId: data.referenceId?.toString() || "",
        referenceModel: data.referenceModel || "",
      },
    };

    return await notificationHelper.sendToUser(
      data.receiver.toString(),
      payload,
    );
  } else {
    // For Admin and others, keep the existing Socket.io logic
    const result = await (
      await Notification.create(data)
    ).populate("receiver sender referenceId");

    //@ts-ignore
    const socketIo = global.io;

    if (socketIo) {
      socketIo.emit(`send-notification::${data?.receiver}`, result);
    }

    return result;
  }
};
