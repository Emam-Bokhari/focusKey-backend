import { Types } from "mongoose";

export interface IFocusSession {
  userId: Types.ObjectId;
  modeId: Types.ObjectId;
  nudgeId?: Types.ObjectId;
  startTime: Date;
  endTime?: Date;
  durationMinutes?: number;
  status: "active" | "completed";
  isDeleted: boolean;
  deletedAt?: Date;
}
