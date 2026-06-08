import { Types } from "mongoose";

export interface IBreak {
  userId: Types.ObjectId;
  modeId: Types.ObjectId;
  startTime: Date;
  endTime: Date;
  durationMinutes?: number;
  status: "active" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export interface IBreakConfig {
  userId: Types.ObjectId;
  breaksPerDay: number;
  breakDurationMinutes: number;
}
