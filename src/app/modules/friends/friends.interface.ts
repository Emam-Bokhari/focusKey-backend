import { Types } from "mongoose";

export interface IFriend {
  userId: Types.ObjectId;
  friendId: Types.ObjectId;
  status: "pending" | "accepted" | "rejected";
  isDeleted?: boolean;
  deletedAt?: Date;
}

export interface INudgeBreakConfig {
  breaksPerDay: number;
  breakDurationMinutes: number;
}

export interface INudge {
  creatorId: Types.ObjectId;
  participants: Types.ObjectId[];
  joinedParticipants: Types.ObjectId[];
  modeId: Types.ObjectId;
  breakConfig: INudgeBreakConfig;
  startTime: Date;
  endTime?: Date;
  status: "active" | "completed" | "scheduled";
  isDeleted?: boolean;
  deletedAt?: Date;
}

export interface IFriendStats {
  name: string;
  userId: Types.ObjectId;
  userName: string;
  profileImage: string;
  email: string;
  isFocused: boolean;
  recentPastFocus: string; // e.g., "focused 2 h yesterday"
  togetherThisWeek: {
    totalFocusTime: string; // e.g., "5h 20m"
    streak: number; // e.g., 3
    highlightedDays: string[]; // e.g., ["Mon", "Tue", "Wed"]
  };
}
