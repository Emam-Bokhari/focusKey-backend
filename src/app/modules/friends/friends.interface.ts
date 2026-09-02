import { Types } from "mongoose";

export interface INudgeParticipant {
  userId: Types.ObjectId;
  isDeleted?: boolean;
  deletedAt?: Date;
}

export interface IFriend {
  userId: Types.ObjectId;
  friendId: Types.ObjectId;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  isDeleted?: boolean;
  deletedAt?: Date;
}

export interface INudgeBreakConfig {
  breaksPerDay: number;
  breakDurationMinutes: number;
}

export interface INudge {
  creatorId: Types.ObjectId;
  participants: INudgeParticipant[];
  joinedParticipants: INudgeParticipant[];
  modeId: Types.ObjectId;
  breakConfig: INudgeBreakConfig;
  startTime: Date;
  endTime?: Date;
  status: "active" | "completed" | "scheduled";
  isDeleted?: boolean;
  deletedAt?: Date;
}

export interface INudgePreview {
  creatorId: Types.ObjectId;
  participants: Types.ObjectId[];
  modeId: Types.ObjectId;
  breakConfig: INudgeBreakConfig;
  status: "pending" | "expired" | "confirmed";
  expiresAt: Date;
  isDeleted?: boolean;
}

export interface IFriendStats {
  name: string;
  userId: Types.ObjectId;
  userName: string;
  profileImage: string;
  email: string;
  isFocused: boolean;
  recentPastFocus: string;
  togetherThisWeek: {
    totalFocusTime: string;
    streak: number;
    highlightedDays: string[];
  };
}
