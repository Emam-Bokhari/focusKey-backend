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

export interface IMode {
  userId: Types.ObjectId;
  name: string;
  description: string;
  icon: IconType;
  lockedApps: {
    packageName: string;
    appName: string;
  }[];
  totalLockedApps: number;
  isActive: boolean;
  isDeleted: boolean;
}

export type TModeModel = ISoftDeleteModel<IMode>;
