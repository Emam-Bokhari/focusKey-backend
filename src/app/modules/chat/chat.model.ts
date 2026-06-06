import mongoose, { Schema } from "mongoose";
import { ChatModel, IChat } from "./chat.interface";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const chatSchema = new Schema<IChat, ChatModel>(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message" },
    read: {
      type: Boolean,
      required: false,
    },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    deletedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isDeleted: { type: Boolean, default: false },
    status: { type: String, enum: ["ACTIVE", "DELETED"], default: "ACTIVE" },
    pinnedMessages: [{ type: Schema.Types.ObjectId, ref: "Message" }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

chatSchema.plugin(softDeletePlugin);

export const Chat = mongoose.model<IChat, ChatModel>("Chat", chatSchema);
