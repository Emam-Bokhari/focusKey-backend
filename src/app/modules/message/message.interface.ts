import { Model, Types } from "mongoose";
import { ISoftDeleteModel } from "../../../types/softDelete";

export type IMessage = {
  chatId: Types.ObjectId;
  sender: Types.ObjectId;
  text?: string;
  image?: string;
  read: boolean;
  isDeleted: boolean;
  type: "TEXT" | "IMAGE" | "DOC" | "BOTH";
  isPinned: boolean;
  pinnedBy?: Types.ObjectId;
  pinnedAt?: Date;
};

export type MessageModel = ISoftDeleteModel<IMessage>;
