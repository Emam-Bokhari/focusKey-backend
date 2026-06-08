import { Types } from "mongoose";

export interface IBreak {
  userId: Types.ObjectId;
  modeId: Types.ObjectId;
  startTime: Date;
  endTime: Date;
  status: "active" | "completed";
  createdAt: Date;
  updatedAt: Date;
}
