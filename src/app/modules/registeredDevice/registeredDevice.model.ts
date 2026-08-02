import { model, Schema } from "mongoose";
import { IRegisteredDevice } from "./registeredDevice.interface";
import { ISoftDeleteModel } from "../../../types/softDelete";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const registeredDeviceSchema = new Schema<IRegisteredDevice, ISoftDeleteModel<IRegisteredDevice>>(
  {
    serialNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    uid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    deviceFingerprint: {
      type: String,
      default: null,
      trim: true,
    },
    platform: {
      type: String,
      enum: ["android", "ios", "web"],
      default: null,
    },
    deviceModel: {
      type: String,
      default: null,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "BLOCKED"],
      default: "ACTIVE",
    },
    notes: {
      type: String,
      trim: true,
    },
    pairedAt: {
      type: Date,
      default: null,
    },
    firstPairedAt: {
      type: Date,
      default: null,
    },
    lastPairedAt: {
      type: Date,
      default: null,
    },
    lastUnpairedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

registeredDeviceSchema.index({ uid: 1 });
registeredDeviceSchema.index({ serialNo: 1 });
registeredDeviceSchema.index({ userId: 1 });

registeredDeviceSchema.plugin(softDeletePlugin);

export const RegisteredDevice = model<IRegisteredDevice, ISoftDeleteModel<IRegisteredDevice>>(
  "RegisteredDevice",
  registeredDeviceSchema
);
