import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IMode } from "./modes.interface";
import { Mode } from "./modes.model";
import mongoose from "mongoose";
import { Break } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { DashboardService } from "../dashboard/dashboard.service";

const ensureDefaultModesExist = async (userId: string): Promise<void> => {
  const count = await Mode.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    isDeleted: { $in: [true, false] },
  });

  if (count === 0) {
    const defaultModes = [
      {
        userId: new mongoose.Types.ObjectId(userId),
        name: "Deep work.",
        description: "Blocks social media, games, and video.",
        icon: "work",
        lockedApps: [],
        totalLockedApps: 0,
        isActive: false,
      },
      {
        userId: new mongoose.Types.ObjectId(userId),
        name: "Step away.",
        description: "Blocks all social apps. Keeps utilities.",
        icon: "study",
        lockedApps: [],
        totalLockedApps: 0,
        isActive: false,
      },
      {
        userId: new mongoose.Types.ObjectId(userId),
        name: "Nothing gets through.",
        description: "Blocks everything except calls and messages.",
        icon: "sleep",
        lockedApps: [],
        totalLockedApps: 0,
        isActive: false,
      },
    ];
    await Mode.create(defaultModes);
  }
};

const createModeToDB = async (payload: IMode, userId: string): Promise<any> => {
  await ensureDefaultModesExist(userId);
  payload.userId = new mongoose.Types.ObjectId(userId);
  payload.isActive = false; // ensure new mode is not active by default
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
  await ensureDefaultModesExist(userId);
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
  delete payload.isActive; // prevent updating activation status directly
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
  await ensureDefaultModesExist(userId);
  const mode = await Mode.findById(modeId);

  if (!mode) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  if (mode.userId.toString() !== userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not the owner of this mode",
    );
  }

  const newStatus = !mode.isActive;

  if (newStatus) {
    // Check if there is already another active mode for this user
    const activeMode = await Mode.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      isActive: true,
      _id: { $ne: modeId },
    });

    if (activeMode) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Another mode is already active. You cannot activate multiple modes at the same time.",
      );
    }

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
    // 1. Check if this mode is active because of a Nudge session
    const activeNudgeSession = await FocusSession.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      modeId: modeId,
      status: "active",
      nudgeId: { $exists: true },
    });

    if (activeNudgeSession) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "This mode is active because of a Nudge session. To deactivate, please use the 'Unlock Nudge' option.",
      );
    }

    // 2. If we are deactivating, stop the current focus session
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

  const now = new Date();
  const result = await Mode.findByIdAndUpdate(
    modeId,
    {
      isActive: newStatus,
      $push: {
        lockEvents: {
          type: newStatus ? "lock" : "unlock",
          source: "mode",
          timestamp: now,
        },
      },
    },
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

const getModeAppCount = async (userId: string) => {
  await ensureDefaultModesExist(userId);
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
  await ensureDefaultModesExist(userId);
  const modes = await Mode.find({ userId, isDeleted: false });

  return modes.map((mode) => ({
    _id: mode._id,
    modeName: mode.name,
    lockedApps: mode.lockedApps || [],
  }));
};

/*

*/

const getSingleModeAppDetails = async (modeId: string, userId: string) => {
  await ensureDefaultModesExist(userId);
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
  await ensureDefaultModesExist(userId);
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

const getLockStatusFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const dashboardData = await DashboardService.getDashboardData(userId);

  // Find Active Focus Session
  const activeSession = await FocusSession.findOne({
    userId: userObjectId,
    status: "active",
  });

  return {
    ...dashboardData,
    isLocked: dashboardData.lockStatus.isLocked,
    activeSession: activeSession
      ? {
          ...activeSession.toObject(),
          elapsedMinutes: Math.round(
            (new Date().getTime() - activeSession.startTime.getTime()) / 60000,
          ),
        }
      : null,
  };
};

export const ModeService = {
  createModeToDB,
  getModesFromDB,
  getSingleModeFromDB,
  updateModeToDB,
  deleteModeFromDB,
  toggleModeActivation,
  getModeAppCount,
  getModeAppDetails,
  getSingleModeAppDetails,
  getTotalFocusApps,
  getLockStatusFromDB,
  ensureDefaultModesExist,
};
