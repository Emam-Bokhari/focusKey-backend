import { Types } from "mongoose";
import { ISoftDeleteModel } from "../../../types/softDelete";

type IconType =
  | "gym"
  | "study"
  | "work"
  | "workout"
  | "social"
  | "reading"
  | "family"
  | "meditation"
  | "sleep"
  | "creative";

export interface ILockEvent {
  type: "lock" | "unlock";
  source: "mode" | "nudge";
  timestamp: Date;
}

export interface IMode {
  userId: Types.ObjectId;
  name: string;
  description: string;
  icon: IconType;
  lockedApps?: {
    packageName: string;
    appName: string;
  }[];
  totalLockedApps?: number;
  isActive?: boolean;
  isDeleted?: boolean;
  lockEvents?: ILockEvent[];
}

export type TModeModel = ISoftDeleteModel<IMode>;
