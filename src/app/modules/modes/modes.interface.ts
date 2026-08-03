import { Types } from "mongoose";
import { ISoftDeleteModel } from "../../../types/softDelete";

export type IconType =
  | "work"
  | "deepwork"
  | "study"
  | "write"
  | "school"
  | "create"
  | "journal"
  | "read"
  | "world"
  | "thelab"
  | "gym"
  | "run"
  | "ride"
  | "swim"
  | "yoga"
  | "health"
  | "sleep"
  | "winddown"
  | "morning"
  | "evening"
  | "quiet"
  | "dnd"
  | "mindful"
  | "deeptime"
  | "timer"
  | "meals"
  | "cook"
  | "brew"
  | "movie"
  | "family"
  | "home"
  | "pets"
  | "garden"
  | "celebrate"
  | "cards"
  | "travel"
  | "explore"
  | "football"
  | "outdoors"
  | "adventure"
  | "sunshine"
  | "art"
  | "music"
  | "listen"
  | "photo"
  | "game"
  | "play"
  | "puzzle"
  | "favourite"
  | "totalFocus";

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
