import { Types } from "mongoose";

export interface IRegisteredDevice {
  serialNo: string;
  uid: string;
  deviceFingerprint?: string | null;
  platform?: "android" | "ios" | "web" | null;
  deviceModel?: string | null;
  userId?: Types.ObjectId | null;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  notes?: string;
  pairedAt?: Date | null;
  firstPairedAt?: Date | null;
  lastPairedAt?: Date | null;
  lastUnpairedAt?: Date | null;
  isDeleted?: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBulkDeviceItem {
  uid: string;
  serialNo?: string;
  status?: "ACTIVE" | "INACTIVE" | "BLOCKED";
  notes?: string;
}

export interface IBulkCreateDevicePayload {
  devices?: IBulkDeviceItem[];
}

export interface IBulkCreateDeviceResult {
  message: string;
  total: number;
  insertedCount: number;
  inserted: IRegisteredDevice[];
}

