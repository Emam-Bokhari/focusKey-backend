import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { Mode } from "../modes/modes.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break, BreakConfig } from "./breaks.model";
import mongoose from "mongoose";
import { IBreakConfig } from "./breaks.interface";

const startBreak = async (userId: string) => {
  const activeMode = await Mode.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true,
    isDeleted: false,
  });

  const activeSession = await FocusSession.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
  });

  if (!activeMode && !activeSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can only take a break when focus mode is locked",
    );
  }

  const modeIdToUse = activeMode?._id || activeSession?.modeId;

  const existingBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: { $in: ["active", "paused"] },
    $or: [
      { status: "active", endTime: { $gt: new Date() } },
      { status: "paused" },
    ],
  });

  if (existingBreak) {
    if (existingBreak.status === "paused") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You have a paused break. Please resume or stop it first.",
      );
    }
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot take a break when you are already in an unlocked state",
    );
  }

  let breakConfig = await BreakConfig.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: new mongoose.Types.ObjectId(userId),
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  }

  const { breaksPerDay, breakDurationMinutes } = breakConfig;

  if (breaksPerDay <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Breaks are not allowed");
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const breaksToday = await Break.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false }, // Only count global breaks
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  if (breaksToday >= breaksPerDay) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Daily break limit reached");
  }

  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + breakDurationMinutes * 60000);

  const result = await Break.create({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: modeIdToUse,
    startTime,
    endTime,
    totalDurationMinutes: breakDurationMinutes,
    remainingSeconds: breakDurationMinutes * 60,
    durationMinutes: 0,
    status: "active",
  });

  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`breakStarted::${userId}`, {
      message: "Break started. Apps are now unlocked.",
      isLocked: false,
      breakDetails: result,
    });
  }

  return result;
};

const pauseBreak = async (userId: string) => {
  const now = new Date();

  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: now },
  });

  if (!activeBreak) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No active break found to pause",
    );
  }

  const remainingMs = Math.max(
    0,
    activeBreak.endTime.getTime() - now.getTime(),
  );
  const remainingSeconds = Math.round(remainingMs / 1000);

  if (remainingSeconds <= 0) {
    const totalAllocatedMinutes = activeBreak.totalDurationMinutes || 15;
    const spentMinutes = totalAllocatedMinutes;

    await Break.findByIdAndUpdate(activeBreak._id, {
      status: "completed",
      durationMinutes: spentMinutes,
      remainingSeconds: 0,
      endTime: now,
    });

    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Break duration has already expired",
    );
  }

  const updatedBreak = await Break.findByIdAndUpdate(
    activeBreak._id,
    {
      status: "paused",
      pausedAt: now,
      remainingSeconds,
    },
    { new: true },
  ).populate("modeId");

  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`breakPaused::${userId}`, {
      message: "Break paused. Apps are now locked.",
      isLocked: true,
      breakDetails: updatedBreak,
    });
  }

  return updatedBreak;
};

const resumeBreak = async (userId: string) => {
  const activeMode = await Mode.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true,
    isDeleted: false,
  });

  const activeSession = await FocusSession.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
  });

  if (!activeMode && !activeSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can only resume a break when focus mode is locked",
    );
  }

  const pausedBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "paused",
  });

  if (!pausedBreak) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No paused break found to resume",
    );
  }

  const remainingSeconds = pausedBreak.remainingSeconds || 0;
  if (remainingSeconds <= 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No remaining break time to resume",
    );
  }

  const now = new Date();
  const newEndTime = new Date(now.getTime() + remainingSeconds * 1000);

  const updatedBreak = await Break.findByIdAndUpdate(
    pausedBreak._id,
    {
      status: "active",
      endTime: newEndTime,
      $unset: { pausedAt: 1 },
    },
    { new: true },
  ).populate("modeId");

  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`breakResumed::${userId}`, {
      message: "Break resumed. Apps are now unlocked.",
      isLocked: false,
      breakDetails: updatedBreak,
    });
  }

  return updatedBreak;
};

const getActiveBreakStatus = async (userId: string) => {
  const now = new Date();
  const currentBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false },
    status: { $in: ["active", "paused"] },
    $or: [{ status: "active", endTime: { $gt: now } }, { status: "paused" }],
  }).populate("modeId");

  let breakConfig = await BreakConfig.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: new mongoose.Types.ObjectId(userId),
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const todayBreaks = await Break.find({
    userId: new mongoose.Types.ObjectId(userId),
    $or: [
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      { status: { $in: ["active", "paused"] } },
    ],
  });

  const weekBreaks = await Break.find({
    userId: new mongoose.Types.ObjectId(userId),
    $or: [
      { createdAt: { $gte: startOfWeek } },
      { status: { $in: ["active", "paused"] } },
    ],
  });

  let todayMinutes = 0;
  todayBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      todayMinutes += breakItem.durationMinutes || 0;
    } else if (breakItem.status === "paused") {
      const totalSec = (breakItem.totalDurationMinutes || 15) * 60;
      const remainingSec = breakItem.remainingSeconds || 0;
      const spentSec = Math.max(0, totalSec - remainingSec);
      todayMinutes += Math.round(spentSec / 60);
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      todayMinutes += Math.round(durationMs / 60000);
    }
  });
  todayMinutes = Math.max(0, todayMinutes);

  let weekMinutes = 0;
  weekBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      weekMinutes += breakItem.durationMinutes || 0;
    } else if (breakItem.status === "paused") {
      const totalSec = (breakItem.totalDurationMinutes || 15) * 60;
      const remainingSec = breakItem.remainingSeconds || 0;
      const spentSec = Math.max(0, totalSec - remainingSec);
      weekMinutes += Math.round(spentSec / 60);
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      weekMinutes += Math.round(durationMs / 60000);
    }
  });
  weekMinutes = Math.max(0, weekMinutes);

  const breaksToday = await Break.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false },
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const breakStats = {
    todayMinutes,
    weekMinutes,
  };

  if (!currentBreak) {
    return {
      isBreakActive: false,
      isBreakPaused: false,
      remainingBreaksToday: Math.max(0, breakConfig.breaksPerDay - breaksToday),
      breakStats,
    };
  }

  const isPaused = currentBreak.status === "paused";
  const remainingSeconds = isPaused
    ? currentBreak.remainingSeconds || 0
    : Math.max(
        0,
        Math.ceil((currentBreak.endTime.getTime() - now.getTime()) / 1000),
      );
  const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

  return {
    isBreakActive: !isPaused,
    isBreakPaused: isPaused,
    breakDetails: {
      ...currentBreak.toObject(),
      remainingSeconds,
      remainingMinutes,
    },
    remainingBreaksToday: Math.max(0, breakConfig.breaksPerDay - breaksToday),
    breakStats,
  };
};

const getRemainingBreaks = async (userId: string) => {
  let breakConfig = await BreakConfig.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isDeleted: { $in: [true, false] },
  });

  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: new mongoose.Types.ObjectId(userId),
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  } else if (breakConfig.isDeleted) {
    breakConfig.isDeleted = false;
    //@ts-ignore
    breakConfig.deletedAt = null;
    await breakConfig.save();
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const breaksToday = await Break.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false },
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const currentBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false },
    status: { $in: ["active", "paused"] },
    $or: [
      { status: "active", endTime: { $gt: new Date() } },
      { status: "paused" },
    ],
  });

  let activeBreakInfo = null;
  if (currentBreak) {
    const isPaused = currentBreak.status === "paused";
    const remainingSeconds = isPaused
      ? currentBreak.remainingSeconds || 0
      : Math.max(
          0,
          Math.ceil(
            (currentBreak.endTime.getTime() - new Date().getTime()) / 1000,
          ),
        );
    const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

    activeBreakInfo = {
      _id: currentBreak._id,
      status: currentBreak.status,
      isPaused,
      endTime: currentBreak.endTime,
      remainingSeconds,
      remainingMinutes,
    };
  }

  return {
    totalAllowed: breakConfig.breaksPerDay,
    durationMinutes: breakConfig.breakDurationMinutes,
    takenToday: breaksToday,
    remaining: Math.max(0, breakConfig.breaksPerDay - breaksToday),
    activeBreak: activeBreakInfo,
  };
};

const stopBreak = async (userId: string) => {
  const now = new Date();

  const currentBreakToStop = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: { $in: ["active", "paused"] },
    $or: [{ status: "active", endTime: { $gt: now } }, { status: "paused" }],
  });

  if (!currentBreakToStop) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No active or paused break found to stop",
    );
  }

  let remainingSeconds = 0;
  if (currentBreakToStop.status === "paused") {
    remainingSeconds = currentBreakToStop.remainingSeconds || 0;
  } else {
    const remainingMs = Math.max(
      0,
      currentBreakToStop.endTime.getTime() - now.getTime(),
    );
    remainingSeconds = Math.round(remainingMs / 1000);
  }

  const totalAllocatedMinutes =
    currentBreakToStop.totalDurationMinutes ||
    Math.round(
      (currentBreakToStop.endTime.getTime() -
        currentBreakToStop.startTime.getTime()) /
        60000,
    ) ||
    15;
  const totalAllocatedSeconds = totalAllocatedMinutes * 60;
  const spentSeconds = Math.max(0, totalAllocatedSeconds - remainingSeconds);
  const durationMinutes = Math.round(spentSeconds / 60);

  const updatedBreak = await Break.findOneAndUpdate(
    {
      _id: currentBreakToStop._id,
    },
    {
      status: "completed",
      endTime: now,
      durationMinutes,
      remainingSeconds: 0,
      $unset: { pausedAt: 1 },
    },
    { new: true },
  );

  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`breakEnded::${userId}`, {
      message: "Break stopped. Apps are now locked.",
      isLocked: true,
    });
  }

  return updatedBreak;
};

const updateExpiredBreaks = async () => {
  const now = new Date();

  const expiredBreaks = await Break.find({
    status: "active",
    endTime: { $lte: now },
  });

  if (expiredBreaks.length === 0) {
    return { modifiedCount: 0, userIds: [] };
  }

  const userIds = expiredBreaks.map((b) => b.userId.toString());

  for (const breakItem of expiredBreaks) {
    const durationMinutes =
      breakItem.totalDurationMinutes ||
      Math.round(
        (breakItem.endTime.getTime() - breakItem.startTime.getTime()) / 60000,
      ) ||
      0;

    await Break.findByIdAndUpdate(breakItem._id, {
      $set: {
        status: "completed",
        durationMinutes,
        remainingSeconds: 0,
      },
    });
  }

  return {
    modifiedCount: expiredBreaks.length,
    userIds: [...new Set(userIds)], // Unique user IDs
  };
};

const getGlobalBreakConfig = async (userId: string) => {
  let breakConfig = await BreakConfig.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: new mongoose.Types.ObjectId(userId),
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  }

  return breakConfig;
};

const updateGlobalBreakConfig = async (
  userId: string,
  payload: Partial<IBreakConfig>,
) => {
  const result = await BreakConfig.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId) },
    { $set: payload },
    {
      new: true,
      upsert: true,
      runValidators: true,
    },
  );

  return result;
};

export const BreakService = {
  startBreak,
  pauseBreak,
  resumeBreak,
  getActiveBreakStatus,
  getRemainingBreaks,
  stopBreak,
  updateExpiredBreaks,
  getGlobalBreakConfig,
  updateGlobalBreakConfig,
};