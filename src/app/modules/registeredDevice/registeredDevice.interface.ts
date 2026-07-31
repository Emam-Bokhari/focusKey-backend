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
  createdAt?: Date;
  updatedAt?: Date;
}
