import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import QueryBuilder from "../../builder/queryBuilder";
import { IRegisteredDevice } from "./registeredDevice.interface";
import { RegisteredDevice } from "./registeredDevice.model";
import { User } from "../user/user.model";

const createDeviceToDB = async (payload: Partial<IRegisteredDevice>): Promise<IRegisteredDevice> => {
  // check if uid is already registered
  const existingDevice = await RegisteredDevice.findOne({ uid: payload.uid });
  if (existingDevice) {
    throw new ApiError(StatusCodes.CONFLICT, "A device with this UID is already registered.");
  }

  // generate serialNo if not provided
  if (!payload.serialNo) {
    const timestamp = Date.now().toString().slice(-6);
    const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
    payload.serialNo = `SN-${timestamp}${randomHex}`;
  } else {
    // check if serialNo is unique
    const existingSerial = await RegisteredDevice.findOne({ serialNo: payload.serialNo });
    if (existingSerial) {
      throw new ApiError(StatusCodes.CONFLICT, "A device with this Serial Number is already registered.");
    }
  }

  const result = await RegisteredDevice.create(payload);
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to register device.");
  }
  return result;
};

const getAllDevicesFromDB = async (query: Record<string, unknown>) => {
  const baseQuery = RegisteredDevice.find().populate("userId", "name email profileImage role");
  
  const searchableFields = ["serialNo", "uid", "notes", "deviceFingerprint", "deviceModel"];
  const queryBuilder = new QueryBuilder(baseQuery, query)
    .search(searchableFields)
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await queryBuilder.modelQuery;
  const meta = await queryBuilder.countTotal();

  return {
    data: result,
    meta,
  };
};

const getDeviceByIdFromDB = async (id: string): Promise<IRegisteredDevice | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device ID.");
  }
  return await RegisteredDevice.findById(id).populate("userId", "name email profileImage role");
};

const updateDeviceToDB = async (id: string, payload: Partial<IRegisteredDevice>): Promise<IRegisteredDevice | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device ID.");
  }
  
  const device = await RegisteredDevice.findById(id);
  if (!device) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
  }

  // Check unique constraints if uid or serialNo is changed
  if (payload.uid && payload.uid !== device.uid) {
    const existing = await RegisteredDevice.findOne({ uid: payload.uid });
    if (existing) {
      throw new ApiError(StatusCodes.CONFLICT, "A device with this UID is already registered.");
    }
  }
  if (payload.serialNo && payload.serialNo !== device.serialNo) {
    const existing = await RegisteredDevice.findOne({ serialNo: payload.serialNo });
    if (existing) {
      throw new ApiError(StatusCodes.CONFLICT, "A device with this Serial Number is already registered.");
    }
  }

  const result = await RegisteredDevice.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  return result;
};

const deleteDeviceFromDB = async (id: string): Promise<IRegisteredDevice | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device ID.");
  }
  
  const device = await RegisteredDevice.findById(id);
  if (!device) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
  }

  const result = await RegisteredDevice.findByIdAndDelete(id);
  return result;
};

// Admin reset device
const resetDeviceToDB = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device ID.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const device = await RegisteredDevice.findById(id).session(session);
    if (!device) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
    }

    const pairedUserId = device.userId;

    // Reset device fields
    device.deviceFingerprint = null;
    device.deviceModel = null;
    device.platform = null;
    device.userId = null;
    device.pairedAt = null;
    device.lastUnpairedAt = new Date();
    await device.save({ session });

    // Reset user fields if paired
    if (pairedUserId) {
      const user = await User.findById(pairedUserId).session(session);
      if (user) {
        user.isPaired = false;
        user.device = undefined;
        await user.save({ session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Emit socket event to notify offline/online user
    if (pairedUserId) {
      //@ts-ignore
      const io = global.io;
      if (io) {
        io.emit(`device-pairing-updated::${pairedUserId.toString()}`, {
          status: "UNPAIRED",
        });
      }
    }

    return device;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const RegisteredDeviceService = {
  createDeviceToDB,
  getAllDevicesFromDB,
  getDeviceByIdFromDB,
  updateDeviceToDB,
  deleteDeviceFromDB,
  resetDeviceToDB,
};
