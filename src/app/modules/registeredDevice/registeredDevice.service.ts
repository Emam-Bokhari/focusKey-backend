import crypto from "crypto";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import QueryBuilder from "../../builder/queryBuilder";
import {
  IBulkCreateDevicePayload,
  IBulkCreateDeviceResult,
  IBulkDeviceItem,
  IRegisteredDevice,
} from "./registeredDevice.interface";
import { RegisteredDevice } from "./registeredDevice.model";
import { User } from "../user/user.model";

const createDeviceToDB = async (
  payload: Partial<IRegisteredDevice>,
): Promise<IRegisteredDevice> => {
  const existingDevice = await RegisteredDevice.findOne({ uid: payload.uid });
  if (existingDevice) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "A device with this UID is already registered.",
    );
  }

  if (!payload.serialNo) {
    const timestamp = Date.now().toString().slice(-6);
    const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
    payload.serialNo = `SN-${timestamp}${randomHex}`;
  } else {
    const existingSerial = await RegisteredDevice.findOne({
      serialNo: payload.serialNo,
    });
    if (existingSerial) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "A device with this Serial Number is already registered.",
      );
    }
  }

  const result = await RegisteredDevice.create(payload);
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to register device.");
  }
  return result;
};

const getAllDevicesFromDB = async (query: Record<string, unknown>) => {
  const baseQuery = RegisteredDevice.find().populate(
    "userId",
    "name email profileImage role",
  );

  const searchableFields = [
    "serialNo",
    "uid",
    "notes",
    "deviceFingerprint",
    "deviceModel",
  ];
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

const getDeviceByIdFromDB = async (
  id: string,
): Promise<IRegisteredDevice | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device ID.");
  }
  return await RegisteredDevice.findById(id).populate(
    "userId",
    "name email profileImage role",
  );
};

const updateDeviceToDB = async (
  id: string,
  payload: Partial<IRegisteredDevice>,
): Promise<IRegisteredDevice | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device ID.");
  }

  const device = await RegisteredDevice.findById(id);
  if (!device) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
  }

  if (payload.uid && payload.uid !== device.uid) {
    const existing = await RegisteredDevice.findOne({ uid: payload.uid });
    if (existing) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "A device with this UID is already registered.",
      );
    }
  }
  if (payload.serialNo && payload.serialNo !== device.serialNo) {
    const existing = await RegisteredDevice.findOne({
      serialNo: payload.serialNo,
    });
    if (existing) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "A device with this Serial Number is already registered.",
      );
    }
  }

  const result = await RegisteredDevice.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  return result;
};

const deleteDeviceFromDB = async (
  id: string,
): Promise<IRegisteredDevice | null> => {
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

    device.deviceFingerprint = null;
    device.deviceModel = null;
    device.platform = null;
    device.userId = null;
    device.pairedAt = null;
    device.lastUnpairedAt = new Date();
    await device.save({ session });

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

const bulkCreateDevicesToDB = async (
  payload: IBulkCreateDevicePayload | IBulkDeviceItem[],
): Promise<IBulkCreateDeviceResult> => {
  let rawDevices: IBulkDeviceItem[] = [];

  if (Array.isArray(payload)) {
    rawDevices = payload;
  } else if (payload && Array.isArray(payload.devices)) {
    rawDevices = payload.devices;
  }

  if (!rawDevices || rawDevices.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No devices provided to register.",
    );
  }

  const duplicateBatchUids: string[] = [];
  const seenBatchUids = new Set<string>();

  const duplicateBatchSerials: string[] = [];
  const seenBatchSerials = new Set<string>();

  for (let i = 0; i < rawDevices.length; i++) {
    const item = rawDevices[i];
    const uid = item?.uid?.trim();
    const serialNo = item?.serialNo?.trim();

    if (!uid) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Device at line ${i + 1} is missing a UID.`,
      );
    }

    if (seenBatchUids.has(uid)) {
      duplicateBatchUids.push(uid);
    } else {
      seenBatchUids.add(uid);
    }

    if (serialNo) {
      if (seenBatchSerials.has(serialNo)) {
        duplicateBatchSerials.push(serialNo);
      } else {
        seenBatchSerials.add(serialNo);
      }
    }
  }

  if (duplicateBatchUids.length > 0) {
    const uniqueDuplicates = Array.from(new Set(duplicateBatchUids));
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Duplicate UID(s) found in the upload: ${uniqueDuplicates.join(", ")}`,
    );
  }

  if (duplicateBatchSerials.length > 0) {
    const uniqueDuplicates = Array.from(new Set(duplicateBatchSerials));
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Duplicate Serial Number(s) found in the upload: ${uniqueDuplicates.join(", ")}`,
    );
  }

  const candidateUids = Array.from(seenBatchUids);
  const candidateSerials = Array.from(seenBatchSerials);

  const filterConditions: any[] = [{ uid: { $in: candidateUids } }];
  if (candidateSerials.length > 0) {
    filterConditions.push({ serialNo: { $in: candidateSerials } });
  }

  const existingDevices = await RegisteredDevice.find({
    $or: filterConditions,
    isDeleted: { $in: [true, false] },
  }).select("uid serialNo");

  const existingUids: string[] = [];
  const existingSerials: string[] = [];

  for (const d of existingDevices) {
    if (d.uid && seenBatchUids.has(d.uid)) existingUids.push(d.uid);
    if (d.serialNo && seenBatchSerials.has(d.serialNo))
      existingSerials.push(d.serialNo);
  }

  if (existingUids.length > 0) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `The following UID(s) are already registered: ${existingUids.join(", ")}`,
    );
  }

  if (existingSerials.length > 0) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `The following Serial Number(s) are already registered: ${existingSerials.join(", ")}`,
    );
  }

  const usedSerialSet = new Set<string>([...seenBatchSerials]);
  const toInsert: Partial<IRegisteredDevice>[] = [];

  for (const item of rawDevices) {
    const uid = item.uid.trim();
    let finalSerialNo = item.serialNo?.trim();

    if (!finalSerialNo) {
      let attempts = 0;
      while (attempts < 100) {
        attempts++;
        const timestamp = Date.now().toString().slice(-6);
        const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
        const candidate = `SN-${timestamp}${randomHex}`;
        if (!usedSerialSet.has(candidate)) {
          finalSerialNo = candidate;
          break;
        }
      }
      if (!finalSerialNo) {
        finalSerialNo = `SN-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      }
      usedSerialSet.add(finalSerialNo);
    }

    toInsert.push({
      uid,
      serialNo: finalSerialNo,
      status: item.status || "ACTIVE",
      notes: item.notes?.trim() || undefined,
    });
  }

  const inserted = (await RegisteredDevice.insertMany(
    toInsert,
  )) as unknown as IRegisteredDevice[];

  return {
    message: `Successfully registered ${inserted.length} device${
      inserted.length > 1 ? "s" : ""
    }.`,
    total: rawDevices.length,
    insertedCount: inserted.length,
    inserted,
  };
};

const parseDevicesFromCsv = (csvText: string): IBulkDeviceItem[] => {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstLineCols = lines[0].split(",").map((h) =>
    h
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase(),
  );

  const uidHeaderIdx = firstLineCols.findIndex(
    (h) =>
      h === "uid" ||
      h === "device_uid" ||
      h === "deviceid" ||
      h === "device_id" ||
      h === "device uid",
  );

  const hasHeaders = uidHeaderIdx !== -1;
  const results: IBulkDeviceItem[] = [];

  if (hasHeaders) {
    const headers = firstLineCols;
    const uidIdx = uidHeaderIdx;
    const notesIdx = headers.findIndex((h) => h === "notes" || h === "note");
    const serialIdx = headers.findIndex(
      (h) =>
        h === "serialno" ||
        h === "serial_no" ||
        h === "serial" ||
        h === "serial number",
    );
    const statusIdx = headers.findIndex((h) => h === "status");

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cols: string[] = [];
      const regex = /(?:,|\n|^)("(?:(?:"")*[^"]*)*"|[^",\n]*|(?:\n|$))/g;
      let match;
      while ((match = regex.exec(line)) !== null) {
        let val = match[1];
        if (val === undefined) break;
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1).replace(/""/g, '"');
        }
        cols.push(val.trim());
        if (regex.lastIndex >= line.length && !line.endsWith(",")) break;
      }

      const uid = cols[uidIdx]?.trim();
      if (!uid) continue;

      const device: IBulkDeviceItem = { uid };
      if (notesIdx !== -1 && cols[notesIdx])
        device.notes = cols[notesIdx].trim();
      if (serialIdx !== -1 && cols[serialIdx])
        device.serialNo = cols[serialIdx].trim();
      if (statusIdx !== -1 && cols[statusIdx]) {
        const st = cols[statusIdx].trim().toUpperCase();
        if (["ACTIVE", "INACTIVE", "BLOCKED"].includes(st)) {
          device.status = st as "ACTIVE" | "INACTIVE" | "BLOCKED";
        }
      }
      results.push(device);
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i]
        .split(",")
        .map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const uid = cols[0];
      if (!uid) continue;
      const notes = cols[1] || undefined;
      results.push({ uid, notes });
    }
  }

  return results;
};

export const RegisteredDeviceService = {
  createDeviceToDB,
  bulkCreateDevicesToDB,
  parseDevicesFromCsv,
  getAllDevicesFromDB,
  getDeviceByIdFromDB,
  updateDeviceToDB,
  deleteDeviceFromDB,
  resetDeviceToDB,
};
