import { Types } from "mongoose";

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
  schedule: {
    startTime: string; // "09:00"
    endTime: string; // "15:00"
  };
  breakConfig: {
    breaksPerDay: number;
    breakDurationMinutes: number;
  };
  isActive: boolean;
}
