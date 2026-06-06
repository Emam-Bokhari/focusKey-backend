import { JwtPayload } from "jsonwebtoken";
import { INotification } from "./notification.interface";
import { Notification } from "./notification.model";
import QueryBuilder from "../../builder/queryBuilder";
import { NOTIFICATION_TYPE } from "./notification.constant";

// --- USER & AGENT SERVICES (Receiver Based) ---

const getNotificationsFromDB = async (
  user: JwtPayload,
  query: Record<string, unknown>,
) => {
  const baseQuery = Notification.find({ receiver: user.id }).populate([
    { path: "receiver", select: "name email profileImage" },
    { path: "sender", select: "name email profileImage" },
    { path: "referenceId" },
  ]);

  const unreadCount = await Notification.countDocuments({
    receiver: user.id,
    read: false,
  });

  const queryBuilder = new QueryBuilder(baseQuery, query).sort().paginate();
  const result = await queryBuilder.modelQuery;
  const meta = await queryBuilder.countTotal();

  return {
    data: result,
    meta: {
      ...meta,
      unreadCount,
    },
  };
};

const readNotificationsToDB = async (
  user: JwtPayload,
) => {
  const result = await Notification.updateMany(
    { receiver: user.id, read: false },
    { $set: { read: true } },
  );
  return result;
};

const getSingleNotificationFromDB = async (
  user: JwtPayload,
  id: string,
): Promise<INotification | null> => {
  const result = await Notification.findOne({
    _id: id,
    receiver: user.id,
  }).populate([
    { path: "receiver", select: "name email profileImage" },
    { path: "sender", select: "name email profileImage" },
    { path: "referenceId" },
  ]);

  return result;
};

const readSingleNotificationToDB = async (
  user: JwtPayload,
  id: string,
): Promise<INotification | null> => {
  const result = await Notification.findOneAndUpdate(
    { _id: id, receiver: user.id },
    { $set: { read: true } },
    { new: true },
  );

  return result;
};

// --- ADMIN & SUPER_ADMIN SERVICES (Type Based) ---

const getAdminNotificationsFromDB = async (query: any) => {
  const baseQuery = Notification.find({
    type: NOTIFICATION_TYPE.ADMIN,
  }).populate([
    { path: "receiver", select: "name email profileImage" },
    { path: "sender", select: "name email profileImage" },
    { path: "referenceId" },
  ]);

  const unreadCount = await Notification.countDocuments({
    type: NOTIFICATION_TYPE.ADMIN,
    read: false,
  });

  const queryBuilder = new QueryBuilder(baseQuery, query).sort().paginate();
  const result = await queryBuilder.modelQuery;
  const meta = await queryBuilder.countTotal();

  return {
    data: result,
    meta: {
      ...meta,
      unreadCount,
    },
  };
};

const readAdminNotificationsToDB = async () => {
  const result = await Notification.updateMany(
    { type: NOTIFICATION_TYPE.ADMIN, read: false },
    { $set: { read: true } },
  );
  return result;
};

const getAdminSingleNotificationFromDB = async (
  id: string,
): Promise<INotification | null> => {
  const result = await Notification.findOne({
    _id: id,
    type: NOTIFICATION_TYPE.ADMIN,
  }).populate([
    { path: "receiver", select: "name email profileImage" },
    { path: "sender", select: "name email profileImage" },
    { path: "referenceId" },
  ]);

  return result;
};

const readAdminSingleNotificationToDB = async (
  id: string,
): Promise<INotification | null> => {
  const result = await Notification.findOneAndUpdate(
    { _id: id, type: NOTIFICATION_TYPE.ADMIN },
    { $set: { read: true } },
    { new: true },
  );

  return result;
};

export const NotificationService = {
  getNotificationsFromDB,
  readNotificationsToDB,
  getSingleNotificationFromDB,
  readSingleNotificationToDB,
  getAdminNotificationsFromDB,
  readAdminNotificationsToDB,
  getAdminSingleNotificationFromDB,
  readAdminSingleNotificationToDB,
};
