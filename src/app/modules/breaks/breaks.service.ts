import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { Mode } from "../modes/modes.model";
import { Break, BreakConfig } from "./breaks.model";
import mongoose from "mongoose";
import { IBreakConfig } from "./breaks.interface";

const startBreak = async (userId: string) => {
  const activeMode = await Mode.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true,
    isDeleted: false,
  });

  if (!activeMode) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can only take a break when focus mode is locked",
    );
  }

  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: new Date() },
  });

  if (activeBreak) {
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
    modeId: activeMode._id,
    startTime,
    endTime,
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

const getActiveBreakStatus = async (userId: string) => {
  const now = new Date();
  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false },
    status: "active",
    endTime: { $gt: now },
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
      { status: "active" },
    ],
  });

  const weekBreaks = await Break.find({
    userId: new mongoose.Types.ObjectId(userId),
    $or: [{ createdAt: { $gte: startOfWeek } }, { status: "active" }],
  });

  let todayMinutes = 0;
  todayBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      todayMinutes += breakItem.durationMinutes || 0;
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

  if (!activeBreak) {
    return {
      isBreakActive: false,
      remainingBreaksToday: Math.max(0, breakConfig.breaksPerDay - breaksToday),
      breakStats,
    };
  }

  const remainingTimeMs = activeBreak.endTime.getTime() - now.getTime();
  const remainingMinutes = Math.max(0, Math.ceil(remainingTimeMs / 60000));

  return {
    isBreakActive: true,
    breakDetails: {
      ...activeBreak.toObject(),
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

  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    nudgeId: { $exists: false },
    status: "active",
    endTime: { $gt: new Date() },
  });

  return {
    totalAllowed: breakConfig.breaksPerDay,
    durationMinutes: breakConfig.breakDurationMinutes,
    takenToday: breaksToday,
    remaining: Math.max(0, breakConfig.breaksPerDay - breaksToday),
    activeBreak: activeBreak
      ? {
          endTime: activeBreak.endTime,
          remainingMinutes: Math.max(
            0,
            Math.ceil(
              (activeBreak.endTime.getTime() - new Date().getTime()) / 60000,
            ),
          ),
        }
      : null,
  };
};

const stopBreak = async (userId: string) => {
  const now = new Date();

  const activeBreakToStop = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: now },
  });

  if (!activeBreakToStop) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No active break found to stop",
    );
  }

  const durationMs = now.getTime() - activeBreakToStop.startTime.getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  const activeBreak = await Break.findOneAndUpdate(
    {
      _id: activeBreakToStop._id,
    },
    {
      status: "completed",
      endTime: now, // End it right now
      durationMinutes,
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

  return activeBreak;
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
    const durationMs =
      breakItem.endTime.getTime() - breakItem.startTime.getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    await Break.findByIdAndUpdate(breakItem._id, {
      $set: {
        status: "completed",
        durationMinutes,
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
  getActiveBreakStatus,
  getRemainingBreaks,
  stopBreak,
  updateExpiredBreaks,
  getGlobalBreakConfig,
  updateGlobalBreakConfig,
};
