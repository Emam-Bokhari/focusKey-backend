import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { Mode } from "../modes/modes.model";
import { Break } from "./breaks.model";
import mongoose from "mongoose";

const startBreak = async (userId: string) => {
  // 1. Find the active mode for the user
  const activeMode = await Mode.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true,
    isDeleted: false,
  });

  if (!activeMode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "No active mode found to take a break");
  }

  const { breaksPerDay, breakDurationMinutes } = activeMode.breakConfig;

  if (breaksPerDay <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Breaks are not allowed in this mode");
  }

  // 2. Count breaks taken today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const breaksToday = await Break.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: activeMode._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  if (breaksToday >= breaksPerDay) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Daily break limit reached for this mode");
  }

  // 3. Check if there's an already active break
  const existingActiveBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: new Date() },
  });

  if (existingActiveBreak) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "A break is already in progress");
  }

  // 4. Create new break
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + breakDurationMinutes * 60000);

  const result = await Break.create({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: activeMode._id,
    startTime,
    endTime,
    status: "active",
  });

  // Notify user via socket that break started (apps unlocked)
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
    status: "active",
    endTime: { $gt: now },
  }).populate("modeId");

  if (!activeBreak) {
    return {
      isBreakActive: false,
      remainingBreaksToday: 0,
    };
  }

  // Calculate remaining breaks for the active mode
  const activeMode = await Mode.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true,
    isDeleted: false,
  });

  if (!activeMode) {
     return {
      isBreakActive: false,
      remainingBreaksToday: 0,
    };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const breaksToday = await Break.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: activeMode._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const remainingTimeMs = activeBreak.endTime.getTime() - now.getTime();
  const remainingMinutes = Math.max(0, Math.ceil(remainingTimeMs / 60000));

  return {
    isBreakActive: true,
    breakDetails: {
      ...activeBreak.toObject(),
      remainingMinutes,
    },
    remainingBreaksToday: Math.max(0, activeMode.breakConfig.breaksPerDay - breaksToday),
  };
};

const getRemainingBreaks = async (userId: string) => {
    const activeMode = await Mode.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true,
    isDeleted: false,
  });

  if (!activeMode) {
    return {
        totalAllowed: 0,
        takenToday: 0,
        remaining: 0
    };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const breaksToday = await Break.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: activeMode._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const activeBreak = await Break.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
    endTime: { $gt: new Date() },
  });

  return {
    modeName: activeMode.name,
    totalAllowed: activeMode.breakConfig.breaksPerDay,
    durationMinutes: activeMode.breakConfig.breakDurationMinutes,
    takenToday: breaksToday,
    remaining: Math.max(0, activeMode.breakConfig.breaksPerDay - breaksToday),
    activeBreak: activeBreak
      ? {
          endTime: activeBreak.endTime,
          remainingMinutes: Math.max(
            0,
            Math.ceil(
              (activeBreak.endTime.getTime() - new Date().getTime()) / 60000
            )
          ),
        }
      : null,
  };
};

const stopBreak = async (userId: string) => {
  const now = new Date();
  const activeBreak = await Break.findOneAndUpdate(
    {
      userId: new mongoose.Types.ObjectId(userId),
      status: "active",
      endTime: { $gt: now },
    },
    {
      status: "completed",
      endTime: now, // End it right now
    },
    { new: true }
  );

  if (!activeBreak) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "No active break found to stop");
  }

  // Notify user via socket that break stopped (apps locked)
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

  // Find expired breaks first to get userIds for notification
  const expiredBreaks = await Break.find({
    status: "active",
    endTime: { $lte: now },
  });

  if (expiredBreaks.length === 0) {
    return { modifiedCount: 0, userIds: [] };
  }

  const userIds = expiredBreaks.map((b) => b.userId.toString());

  const result = await Break.updateMany(
    {
      _id: { $in: expiredBreaks.map((b) => b._id) },
    },
    {
      $set: { status: "completed" },
    }
  );

  return {
    modifiedCount: result.modifiedCount,
    userIds: [...new Set(userIds)], // Unique user IDs
  };
};

export const BreakService = {
  startBreak,
  getActiveBreakStatus,
  getRemainingBreaks,
  stopBreak,
  updateExpiredBreaks,
};
