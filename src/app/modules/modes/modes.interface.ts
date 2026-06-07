import { Types } from "mongoose";

type IconType = 
  | "book" | "briefcase" | "dumbbell" | "moon"
  | "meditation" | "code" | "music" | "heart";

export interface IMode {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description: string;
  icon: IconType;
  lockedApps: {
    packageName: string;
    appName: string;
  }[];
  schedule: {
    startTime: string;   // "09:00"
    endTime: string;     // "15:00"
  };
  breakConfig: {
    breaksPerDay: number;
    breakDurationMinutes: number;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}