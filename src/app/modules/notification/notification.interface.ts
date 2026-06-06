import { Model, Types } from "mongoose";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "./notification.constant";
import { ISoftDeleteModel } from "../../../types/softDelete";

export type INotification = {
  title: string;
  text: string;
  receiver?: Types.ObjectId | string;
  sender?: Types.ObjectId | string;
  read: boolean;
  referenceId?: Types.ObjectId | string;
  referenceModel?: NOTIFICATION_REFERENCE_MODEL;
  type?: NOTIFICATION_TYPE;
};

export type NotificationModel = ISoftDeleteModel<INotification>;
