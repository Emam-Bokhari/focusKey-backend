import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IMode } from "./modes.interface";
import { Mode } from "./modes.model";
import mongoose from "mongoose";
import { Break } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";

const createModeToDB = async (payload: IMode, userId: string): Promise<any> => {
  payload.userId = new mongoose.Types.ObjectId(userId);
  const result = await Mode.create(payload);
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create mode");
  }

  return {
    ...result.toObject(),
    isLocked: false, // Newly created modes are not active by default
  };
};

const getModesFromDB = async (userId: string) => {
  const modes = await Mode.find({ userId });

  if (!modes || modes.length === 0) {
    return {
      modes: [],
      stats: {
        totalLockedAppsAcrossModes: 0,
      },
    };
  }

  // Calculate total locked apps across all modes
  const totalLockedAppsAcrossModes = modes.reduce(
    (acc, mode) => acc + (mode.lockedApps?.length || 0),
    0,
  );

  // Check if there is an active break for this user
  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: new Date() },
  });

  // Map modes and add isLocked status
  const modesWithStatus = modes.map((mode) => {
    const modeObj = mode.toObject();
    return {
      ...modeObj,
      isLocked: mode.isActive && !activeBreak,
    };
  });

  return {
    modes: modesWithStatus,
    stats: {
      totalLockedAppsAcrossModes,
    },
  };
};

const getSingleModeFromDB = async (modeId: string) => {
  const mode = await Mode.findById(modeId);
  if (!mode) {
    return {};
  }

  const activeBreak = await Break.findOne({
    userId: mode.userId,
    status: "active",
    endTime: { $gt: new Date() },
  });

  return {
    ...mode.toObject(),
    isLocked: mode.isActive && !activeBreak,
  };
};

const updateModeToDB = async (modeId: string, payload: Partial<IMode>) => {
  if (payload.lockedApps) {
    payload.totalLockedApps = payload.lockedApps.length;
  }
  const result = await Mode.findByIdAndUpdate(modeId, payload, {
    new: true,
    runValidators: true,
  });
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  const activeBreak = await Break.findOne({
    userId: result.userId,
    status: "active",
    endTime: { $gt: new Date() },
  });

  return {
    ...result.toObject(),
    isLocked: result.isActive && !activeBreak,
  };
};

const deleteModeFromDB = async (modeId: string) => {
  const mode = await Mode.findById(modeId);
  if (!mode) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  // if deleting an active mode, stop the focus session
  if (mode.isActive) {
    const activeSessions = await FocusSession.find({
      userId: mode.userId,
      modeId: mode._id,
      status: "active",
    });

    for (const session of activeSessions) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - session.startTime.getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      await FocusSession.findByIdAndUpdate(session._id, {
        status: "completed",
        endTime,
        durationMinutes,
      });
    }
  }

  const result = await Mode.findByIdAndUpdate(
    modeId,
    { isDeleted: true, isActive: false }, // also deactivate on delete
    {
      new: true,
      runValidators: true,
    },
  );
  return result;
};

const toggleModeActivation = async (modeId: string, userId: string) => {
  const mode = await Mode.findById(modeId);

  if (!mode) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  if (mode.userId.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized");
  }

  const newStatus = !mode.isActive;

  if (newStatus) {
    // 1. If we are activating this mode, deactivate all other modes for this user
    await Mode.updateMany(
      { userId: new mongoose.Types.ObjectId(userId), _id: { $ne: modeId } },
      { isActive: false },
    );

    // 2. Stop any existing active focus sessions for this user
    const activeSessions = await FocusSession.find({
      userId: new mongoose.Types.ObjectId(userId),
      status: "active",
    });

    for (const session of activeSessions) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - session.startTime.getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      await FocusSession.findByIdAndUpdate(session._id, {
        status: "completed",
        endTime,
        durationMinutes,
      });
    }

    // 3. Start a new focus session
    await FocusSession.create({
      userId: new mongoose.Types.ObjectId(userId),
      modeId: modeId,
      startTime: new Date(),
      status: "active",
    });
  } else {
    // If we are deactivating, stop the current focus session
    const activeSessions = await FocusSession.find({
      userId: new mongoose.Types.ObjectId(userId),
      modeId: modeId,
      status: "active",
    });

    for (const session of activeSessions) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - session.startTime.getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      await FocusSession.findByIdAndUpdate(session._id, {
        status: "completed",
        endTime,
        durationMinutes,
      });
    }
  }

  const result = await Mode.findByIdAndUpdate(
    modeId,
    { isActive: newStatus },
    { new: true },
  );

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: new Date() },
  });

  return {
    ...result.toObject(),
    isLocked: result.isActive && !activeBreak,
  };
};

const getModeAppCounts = async (userId: string) => {
  const modes = await Mode.find({ userId, isDeleted: false });

  const totalFocusAppsCount = modes.reduce(
    (acc, mode) => acc + (mode.lockedApps?.length || 0),
    0,
  );

  return modes.map((mode) => ({
    _id: mode._id,
    modeName: mode.name,
    icon: mode.icon,
    totalApps: mode.lockedApps?.length || 0,
    totalFocusAppsCount,
  }));
};

const getModeAppDetails = async (userId: string) => {
  const modes = await Mode.find({ userId, isDeleted: false });

  return modes.map((mode) => ({
    _id: mode._id,
    modeName: mode.name,
    lockedApps: mode.lockedApps || [],
  }));
};

const getSingleModeAppDetails = async (modeId: string, userId: string) => {
  const mode = await Mode.findOne({ _id: modeId, userId, isDeleted: false });

  if (!mode) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  return {
    _id: mode._id,
    modeName: mode.name,
    lockedApps: mode.lockedApps || [],
  };
};

const getTotalFocusApps = async (userId: string) => {
  const modes = await Mode.find({ userId, isDeleted: false });

  // Get unique apps across all modes
  const allLockedApps: any[] = [];
  const seenPackages = new Set();

  modes.forEach((mode) => {
    mode.lockedApps?.forEach((app) => {
      if (!seenPackages.has(app.packageName)) {
        seenPackages.add(app.packageName);
        allLockedApps.push(app);
      }
    });
  });

  return allLockedApps;
};

export const ModeService = {
  createModeToDB,
  getModesFromDB,
  getSingleModeFromDB,
  updateModeToDB,
  deleteModeFromDB,
  toggleModeActivation,
  getModeAppCounts,
  getModeAppDetails,
  getSingleModeAppDetails,
  getTotalFocusApps,
};
