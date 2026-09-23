import { Types } from "mongoose";

export interface IFocusSession {
  userId: Types.ObjectId;
  modeId: Types.ObjectId;
  nudgeId?: Types.ObjectId;
  clientSessionId?: string;
  startTime: Date;
  endTime?: Date;
  durationMinutes?: number;
  status: "active" | "completed";
  maxBreaks?: number;
  breakDurationMinutes?: number;
  usedBreaksCount?: number;
  isDeleted: boolean;
  deletedAt?: Date;
}

export interface IReconcileSessionPayload {
  clientSessionId: string;
  modeId?: string;
  startedAt?: string | Date | number;
  endedAt?: string | Date | number;
  status?: "active" | "completed";
  timezone?: string;
}

