import { Types } from "mongoose";

export interface IBreak {
  userId: Types.ObjectId;
  modeId: Types.ObjectId;
  nudgeId?: Types.ObjectId;
  clientBreakId?: string;
  startTime: Date;
  endTime: Date;
  durationMinutes?: number;
  totalDurationMinutes?: number;
  remainingSeconds?: number;
  pausedAt?: Date;
  status: "active" | "paused" | "completed";
  isDeleted?: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReconcileBreakPayload {
  clientBreakId: string;
  modeId?: string;
  startedAt?: string | Date | number;
  endedAt?: string | Date | number;
  status?: "active" | "completed";
  timezone?: string;
}

export interface IBreakConfig {
  userId: Types.ObjectId;
  breaksPerDay: number;
  breakDurationMinutes: number;
  isDeleted?: boolean;
  deletedAt?: Date;
}