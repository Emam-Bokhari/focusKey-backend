import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IMode } from "./modes.interface";
import { Mode } from "./modes.model";
import mongoose from "mongoose";
import { Break } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { DashboardService } from "../dashboard/dashboard.service";
import { sendNotifications } from "../../../helpers/notificationsHelper";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "../notification/notification.constant";

const defaultModeCreationPromises = new Map<string, Promise<void>>();
const knownUsersWithModes = new Set<string>();

const ensureDefaultModesExist = async (userId: string): Promise<void> => {
  if (knownUsersWithModes.has(userId)) {
    return;
  }

  if (defaultModeCreationPromises.has(userId)) {
    return defaultModeCreationPromises.get(userId)!;
  }

  const promise = (async () => {
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
    knownUsersWithModes.add(userId);
  })();

  defaultModeCreationPromises.set(userId, promise);

  try {
    await promise;
  } finally {
    defaultModeCreationPromises.delete(userId);
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

  sendNotifications({
    title: "New Mode Created",
    text: `You have successfully created a new focus mode: "${result.name}".`,
    receiver: userId,
    type: NOTIFICATION_TYPE.USER,
    referenceId: result._id.toString(),
    referenceModel: NOTIFICATION_REFERENCE_MODEL.MODE,
  }).catch(() => {});

  return {
    ...result.toObject(),
    isLocked: false,
  };
};

const getModesFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  let [modes, activeBreak] = await Promise.all([
    Mode.find({ userId }).lean(),
    Break.findOne({
      userId: userObjectId,
      status: "active",
      endTime: { $gt: new Date() },
    }).lean(),
  ]);

  if (!modes || modes.length === 0) {
    await ensureDefaultModesExist(userId);
    modes = await Mode.find({ userId }).lean();
  } else {
    knownUsersWithModes.add(userId);
  }

  if (!modes || modes.length === 0) {
    return {
      modes: [],
      stats: {
        totalLockedAppsAcrossModes: 0,
      },
    };
  }

  const totalLockedAppsAcrossModes = modes.reduce(
    (acc, mode) => acc + (mode.totalLockedApps || 0),
    0,
  );

  const isBreakActive = !!activeBreak;
  const modesWithStatus = modes.map((mode) => ({
    ...mode,
    isLocked: Boolean(mode.isActive && !isBreakActive),
  }));

  return {
    modes: modesWithStatus,
    stats: {
      totalLockedAppsAcrossModes,
    },
  };
};

const getSingleModeFromDB = async (modeId: string) => {
  const mode = await Mode.findById(modeId).lean();
  if (!mode) {
    return {};
  }

  const activeBreak = mode.isActive
    ? await Break.findOne({
        userId: mode.userId,
        status: "active",
        endTime: { $gt: new Date() },
      }).lean()
    : null;

  return {
    ...mode,
    isLocked: Boolean(mode.isActive && !activeBreak),
  };
};

const updateModeToDB = async (modeId: string, payload: Partial<IMode>) => {
  delete payload.isActive;
  const hasLockedApps = payload.lockedApps && payload.lockedApps.length > 0;
  const totalLockedAppsProvided = typeof payload.totalLockedApps === "number";

  if (totalLockedAppsProvided && !hasLockedApps) {
    // Keep payload.totalLockedApps as it was explicitly provided
  } else if (payload.lockedApps) {
    payload.totalLockedApps = payload.lockedApps.length;
  }

  const result = await Mode.findByIdAndUpdate(modeId, payload, {
    new: true,
    runValidators: true,
  }).lean();

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  const activeBreak = result.isActive
    ? await Break.findOne({
        userId: result.userId,
        status: "active",
        endTime: { $gt: new Date() },
      }).lean()
    : null;

  return {
    ...result,
    isLocked: Boolean(result.isActive && !activeBreak),
  };
};

const deleteModeFromDB = async (modeId: string) => {
  const mode = await Mode.findById(modeId);
  if (!mode) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  if (mode.isActive) {
    const activeSessions = await FocusSession.find({
      userId: mode.userId,
      modeId: mode._id,
      status: "active",
    }).lean();

    if (activeSessions.length > 0) {
      const endTime = new Date();
      const bulkOps = activeSessions.map((session) => {
        const durationMs = endTime.getTime() - session.startTime.getTime();
        const durationMinutes = Math.round(durationMs / 60000);
        return {
          updateOne: {
            filter: { _id: session._id },
            update: {
              $set: {
                status: "completed",
                endTime,
                durationMinutes,
              },
            },
          },
        };
      });
      await FocusSession.bulkWrite(bulkOps);
    }
  }

  const result = await Mode.findByIdAndUpdate(
    modeId,
    { isDeleted: true, isActive: false },
    {
      new: true,
      runValidators: true,
    },
  );

  if (result) {
    sendNotifications({
      title: "Mode Deleted",
      text: `You have successfully deleted the focus mode: "${mode.name}".`,
      receiver: mode.userId.toString(),
      type: NOTIFICATION_TYPE.USER,
    }).catch(() => {});
  }

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
  const userObjectId = new mongoose.Types.ObjectId(userId);

  if (newStatus) {
    const activeMode = await Mode.findOne({
      userId: userObjectId,
      isActive: true,
      _id: { $ne: modeId },
    }).lean();

    if (activeMode) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Another mode is already active. You cannot activate multiple modes at the same time.",
      );
    }

    await Mode.updateMany(
      { userId: userObjectId, _id: { $ne: modeId } },
      { isActive: false },
    );

    const activeSessions = await FocusSession.find({
      userId: userObjectId,
      status: "active",
    }).lean();

    if (activeSessions.length > 0) {
      const endTime = new Date();
      const bulkOps = activeSessions.map((session) => {
        const durationMs = endTime.getTime() - session.startTime.getTime();
        const durationMinutes = Math.round(durationMs / 60000);
        return {
          updateOne: {
            filter: { _id: session._id },
            update: {
              $set: {
                status: "completed",
                endTime,
                durationMinutes,
              },
            },
          },
        };
      });
      await FocusSession.bulkWrite(bulkOps);
    }

    await FocusSession.create({
      userId: userObjectId,
      modeId: modeId,
      startTime: new Date(),
      status: "active",
    });
  } else {
    const activeNudgeSession = await FocusSession.findOne({
      userId: userObjectId,
      modeId: modeId,
      status: "active",
      nudgeId: { $exists: true },
    }).lean();

    if (activeNudgeSession) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "This mode is active because of a Nudge session. To deactivate, please use the 'Unlock Nudge' option.",
      );
    }

    const activeSessions = await FocusSession.find({
      userId: userObjectId,
      modeId: modeId,
      status: "active",
    }).lean();

    if (activeSessions.length > 0) {
      const endTime = new Date();
      const bulkOps = activeSessions.map((session) => {
        const durationMs = endTime.getTime() - session.startTime.getTime();
        const durationMinutes = Math.round(durationMs / 60000);
        return {
          updateOne: {
            filter: { _id: session._id },
            update: {
              $set: {
                status: "completed",
                endTime,
                durationMinutes,
              },
            },
          },
        };
      });
      await FocusSession.bulkWrite(bulkOps);
    }
  }

  const now = new Date();
  const [result, activeBreak] = await Promise.all([
    Mode.findByIdAndUpdate(
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
    ).lean(),
    newStatus
      ? Break.findOne({
          userId: userObjectId,
          status: "active",
          endTime: { $gt: now },
        }).lean()
      : Promise.resolve(null),
  ]);

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  return {
    ...result,
    isLocked: Boolean(result.isActive && !activeBreak),
  };
};

const getModeAppCount = async (userId: string) => {
  let modes = await Mode.find({ userId, isDeleted: false })
    .select("name icon totalLockedApps")
    .lean();

  if (modes.length === 0) {
    await ensureDefaultModesExist(userId);
    modes = await Mode.find({ userId, isDeleted: false })
      .select("name icon totalLockedApps")
      .lean();
  } else {
    knownUsersWithModes.add(userId);
  }

  const totalFocusAppsCount = modes.reduce(
    (acc, mode) => acc + (mode.totalLockedApps || 0),
    0,
  );

  return modes.map((mode) => ({
    _id: mode._id,
    modeName: mode.name,
    icon: mode.icon,
    totalApps: mode.totalLockedApps || 0,
    totalFocusAppsCount,
  }));
};

const getModeAppDetails = async (userId: string) => {
  let modes = await Mode.find({ userId, isDeleted: false })
    .select("name lockedApps")
    .lean();

  if (modes.length === 0) {
    await ensureDefaultModesExist(userId);
    modes = await Mode.find({ userId, isDeleted: false })
      .select("name lockedApps")
      .lean();
  } else {
    knownUsersWithModes.add(userId);
  }

  return modes.map((mode) => ({
    _id: mode._id,
    modeName: mode.name,
    lockedApps: mode.lockedApps || [],
  }));
};

const getSingleModeAppDetails = async (modeId: string, userId: string) => {
  const mode = await Mode.findOne({ _id: modeId, userId, isDeleted: false })
    .select("name lockedApps")
    .lean();

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
  let modes = await Mode.find({ userId, isDeleted: false })
    .select("lockedApps")
    .lean();

  if (modes.length === 0) {
    await ensureDefaultModesExist(userId);
    modes = await Mode.find({ userId, isDeleted: false })
      .select("lockedApps")
      .lean();
  } else {
    knownUsersWithModes.add(userId);
  }

  const allLockedApps: any[] = [];
  const seenPackages = new Set<string>();

  for (const mode of modes) {
    if (mode.lockedApps) {
      for (const app of mode.lockedApps) {
        if (!seenPackages.has(app.packageName)) {
          seenPackages.add(app.packageName);
          allLockedApps.push(app);
        }
      }
    }
  }

  return allLockedApps;
};

const getLockStatusFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const [dashboardData, activeSession] = await Promise.all([
    DashboardService.getDashboardData(userId),
    FocusSession.findOne({
      userId: userObjectId,
      status: "active",
    }).lean(),
  ]);

  return {
    ...dashboardData,
    isLocked: dashboardData.lockStatus.isLocked,
    activeSession: activeSession
      ? {
          ...activeSession,
          elapsedMinutes: Math.round(
            (new Date().getTime() - new Date(activeSession.startTime).getTime()) / 60000,
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
