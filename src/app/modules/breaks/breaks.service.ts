import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { Mode } from "../modes/modes.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break, BreakConfig } from "./breaks.model";
import mongoose from "mongoose";
import { IBreakConfig, IReconcileBreakPayload } from "./breaks.interface";
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  formatZonedIso,
  formatZonedTimeRange,
  getZonedEndOfDay,
  getZonedStartOfDay,
  getZonedStartOfWeek,
  dayjs,
} from "../../../helpers/timezoneHelper";


const startBreak = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const now = new Date();
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const startOfDay = getZonedStartOfDay(now, userTimezone);
  const endOfDay = getZonedEndOfDay(now, userTimezone);

  const [activeMode, activeSession, existingBreak, breakConfigDoc, breaksToday] =
    await Promise.all([
      Mode.findOne({
        userId: userObjectId,
        isActive: true,
        isDeleted: false,
      })
        .select("_id")
        .lean(),

      FocusSession.findOne({
        userId: userObjectId,
        status: "active",
      })
        .select("modeId")
        .lean(),

      Break.findOne({
        userId: userObjectId,
        status: { $in: ["active", "paused"] },
        $or: [
          { status: "active", endTime: { $gt: now } },
          { status: "paused" },
        ],
      })
        .select("_id")
        .lean(),

      BreakConfig.findOne({
        userId: userObjectId,
      })
        .select("breaksPerDay breakDurationMinutes")
        .lean(),

      Break.countDocuments({
        userId: userObjectId,
        nudgeId: { $exists: false }, // Only count global breaks
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
    ]);

  if (!activeMode && !activeSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can only take a break when focus mode is locked",
    );
  }

  const modeIdToUse = activeMode?._id || activeSession?.modeId;

  if (existingBreak) {
    // if (existingBreak.status === "paused") {
    //   throw new ApiError(
    //     StatusCodes.BAD_REQUEST,
    //     "You have a paused break. Please resume or stop it first.",
    //   );
    // }
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot take a break when you are already in an unlocked state",
    );
  }

  let breakConfig = breakConfigDoc;
  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: userObjectId,
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  }

  const { breaksPerDay, breakDurationMinutes } = breakConfig;

  if (breaksPerDay <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Breaks are not allowed");
  }

  if (breaksToday >= breaksPerDay) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Daily break limit reached");
  }

  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + breakDurationMinutes * 60000);

  const result = await Break.create({
    userId: userObjectId,
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

/*
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
*/

const getActiveBreakStatus = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
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

  const startOfDay = getZonedStartOfDay(new Date(), userTimezone);
  const endOfDay = getZonedEndOfDay(new Date(), userTimezone);
  const startOfWeek = getZonedStartOfWeek(new Date(), userTimezone);

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

const getRemainingBreaks = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
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

  const startOfDay = getZonedStartOfDay(new Date(), userTimezone);
  const endOfDay = getZonedEndOfDay(new Date(), userTimezone);

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
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const currentBreakToStop = await Break.findOne({
    userId: userObjectId,
    status: { $in: ["active", "paused"] },
    $or: [{ status: "active", endTime: { $gt: now } }, { status: "paused" }],
  })
    .select("_id status remainingSeconds endTime startTime totalDurationMinutes")
    .lean();

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
      new Date(currentBreakToStop.endTime).getTime() - now.getTime(),
    );
    remainingSeconds = Math.round(remainingMs / 1000);
  }

  const totalAllocatedMinutes =
    currentBreakToStop.totalDurationMinutes ||
    Math.round(
      (new Date(currentBreakToStop.endTime).getTime() -
        new Date(currentBreakToStop.startTime).getTime()) /
        60000,
    ) ||
    15;
  const totalAllocatedSeconds = totalAllocatedMinutes * 60;
  const spentSeconds = Math.max(0, totalAllocatedSeconds - remainingSeconds);
  const durationMinutes = Math.round(spentSeconds / 60);

  const updatedBreak = await Break.findByIdAndUpdate(
    currentBreakToStop._id,
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

const getGlobalBreakConfig = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
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

const parseClientDate = (
  dateInput?: string | Date | number | null,
  userTimezone: string = DEFAULT_TIMEZONE,
): Date => {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === "number") return new Date(dateInput);

  const trimmed = dateInput.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return new Date(trimmed.length === 10 ? num * 1000 : num);
  }
  const hasTimezoneOffset = /([Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasTimezoneOffset) {
    return dayjs(trimmed).toDate();
  } else {
    const tz = isValidTimezone(userTimezone) ? userTimezone : DEFAULT_TIMEZONE;
    return dayjs.tz(trimmed, tz).toDate();
  }
};

const formatReconcileBreak = (
  breakDoc: any,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const startTime = breakDoc.startTime
    ? new Date(breakDoc.startTime)
    : new Date();
  const endTime = breakDoc.endTime
    ? new Date(breakDoc.endTime)
    : new Date();
  const now = new Date();

  const isPaused = breakDoc.status === "paused";
  const isCompleted = breakDoc.status === "completed";
  const remainingSeconds = isCompleted
    ? 0
    : isPaused
      ? breakDoc.remainingSeconds || 0
      : Math.max(0, Math.ceil((endTime.getTime() - now.getTime()) / 1000));
  const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

  return {
    _id: breakDoc._id,
    userId: breakDoc.userId,
    modeId: breakDoc.modeId,
    clientBreakId: breakDoc.clientBreakId || null,
    startTime: formatZonedIso(startTime, userTimezone),
    endTime: formatZonedIso(endTime, userTimezone),
    startTimeRaw: startTime.toISOString(),
    endTimeRaw: endTime.toISOString(),
    timeRange: formatZonedTimeRange(startTime, endTime, userTimezone),
    durationMinutes: breakDoc.durationMinutes || 0,
    totalDurationMinutes: breakDoc.totalDurationMinutes || 15,
    remainingSeconds,
    remainingMinutes,
    status: breakDoc.status,
    createdAt: breakDoc.createdAt,
    updatedAt: breakDoc.updatedAt,
  };
};

const reconcileBreakFromDB = async (
  userId: string,
  payload: IReconcileBreakPayload,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const { clientBreakId, modeId, startedAt, endedAt, status, timezone } =
    payload;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const activeTimezone = isValidTimezone(timezone)
    ? timezone!
    : userTimezone;

  if (
    !clientBreakId ||
    typeof clientBreakId !== "string" ||
    !clientBreakId.trim()
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "clientBreakId is required to reconcile break",
    );
  }

  const trimmedClientBreakId = clientBreakId.trim();
  const now = new Date();
  const startOfDay = getZonedStartOfDay(now, activeTimezone);
  const endOfDay = getZonedEndOfDay(now, activeTimezone);

  // 1. Idempotency Check: if break with this clientBreakId already exists
  const existingBreak = await Break.findOne({
    userId: userObjectId,
    clientBreakId: trimmedClientBreakId,
    isDeleted: { $ne: true },
  }).populate("modeId");

  let breakConfig = await BreakConfig.findOne({
    userId: userObjectId,
    isDeleted: { $ne: true },
  });

  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: userObjectId,
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  }

  const breaksToday = await Break.countDocuments({
    userId: userObjectId,
    nudgeId: { $exists: false },
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    isDeleted: { $ne: true },
  });

  const remainingBreaks = Math.max(
    0,
    breakConfig.breaksPerDay - breaksToday,
  );

  if (existingBreak) {
    return {
      isAccepted: true,
      isAlreadySynced: true,
      message: "Break is already synced",
      break: formatReconcileBreak(existingBreak, activeTimezone),
      breaksLeft: remainingBreaks,
      totalAllowed: breakConfig.breaksPerDay,
      durationMinutes: breakConfig.breakDurationMinutes,
      takenToday: breaksToday,
    };
  }

  // 2. Quota Check: verify if user is allowed to take a break
  if (breakConfig.breaksPerDay <= 0) {
    return {
      isAccepted: false,
      isAlreadySynced: false,
      errorCode: "BREAKS_NOT_ALLOWED",
      message: "Breaks are not allowed",
      break: null,
      breaksLeft: 0,
      totalAllowed: breakConfig.breaksPerDay,
      durationMinutes: breakConfig.breakDurationMinutes,
      takenToday: breaksToday,
    };
  }

  if (breaksToday >= breakConfig.breaksPerDay) {
    return {
      isAccepted: false,
      isAlreadySynced: false,
      errorCode: "BREAK_QUOTA_EXCEEDED",
      message: "Daily break limit reached",
      break: null,
      breaksLeft: 0,
      totalAllowed: breakConfig.breaksPerDay,
      durationMinutes: breakConfig.breakDurationMinutes,
      takenToday: breaksToday,
    };
  }

  // 3. Determine Mode
  let modeIdToUse: any = modeId;
  if (!modeIdToUse) {
    const [activeMode, activeSession] = await Promise.all([
      Mode.findOne({
        userId: userObjectId,
        isActive: true,
        isDeleted: false,
      })
        .select("_id")
        .lean(),
      FocusSession.findOne({
        userId: userObjectId,
        status: "active",
        isDeleted: false,
      })
        .select("modeId")
        .lean(),
    ]);
    modeIdToUse = activeMode?._id || activeSession?.modeId;
  }

  if (!modeIdToUse) {
    const defaultMode = await Mode.findOne({
      userId: userObjectId,
      isDeleted: false,
    })
      .select("_id")
      .lean();
    modeIdToUse = defaultMode?._id;
  }

  if (!modeIdToUse) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "No focus mode found for this user",
    );
  }

  const modeObjectId = new mongoose.Types.ObjectId(modeIdToUse);

  // 4. Parse Dates & Status
  let startTime = parseClientDate(startedAt, activeTimezone);
  if (status !== "completed" && !endedAt && startTime.getTime() > Date.now()) {
    startTime = new Date();
  }
  const breakDurationMinutes = breakConfig.breakDurationMinutes || 15;
  const scheduledEndTime = new Date(
    startTime.getTime() + breakDurationMinutes * 60000,
  );

  let finalStatus: "active" | "completed" = "active";
  let finalEndTime: Date = scheduledEndTime;
  let durationMinutes = 0;
  let remainingSeconds = breakDurationMinutes * 60;

  if (status === "completed" || endedAt) {
    finalStatus = "completed";
    finalEndTime = endedAt
      ? parseClientDate(endedAt, activeTimezone)
      : scheduledEndTime;
    const durationMs = Math.max(
      0,
      finalEndTime.getTime() - startTime.getTime(),
    );
    durationMinutes = Math.round(durationMs / 60000);
    remainingSeconds = 0;
  } else {
    // If client says active, but the break duration already elapsed in real-world time:
    if (now.getTime() >= scheduledEndTime.getTime()) {
      finalStatus = "completed";
      finalEndTime = scheduledEndTime;
      durationMinutes = breakDurationMinutes;
      remainingSeconds = 0;
    } else {
      finalStatus = "active";
      finalEndTime = scheduledEndTime;
      remainingSeconds = Math.max(
        0,
        Math.ceil((scheduledEndTime.getTime() - now.getTime()) / 1000),
      );
      durationMinutes = 0;
    }
  }

  // 5. Create Break Document with clientBreakId
  const createdBreak = await Break.create({
    userId: userObjectId,
    modeId: modeObjectId,
    clientBreakId: trimmedClientBreakId,
    startTime,
    endTime: finalEndTime,
    totalDurationMinutes: breakDurationMinutes,
    remainingSeconds,
    durationMinutes,
    status: finalStatus,
    createdAt: startTime, // keep createdAt consistent with break start time
  });

  const newBreaksToday = breaksToday + 1;
  const newBreaksLeft = Math.max(
    0,
    breakConfig.breaksPerDay - newBreaksToday,
  );

  // Socket notification if the break is currently active
  if (finalStatus === "active") {
    //@ts-ignore
    const io = global.io;
    if (io) {
      io.emit(`breakStarted::${userId}`, {
        message: "Break started. Apps are now unlocked.",
        isLocked: false,
        breakDetails: createdBreak,
      });
    }
  }

  const populatedBreak = await Break.findById(createdBreak._id).populate(
    "modeId",
  );

  return {
    isAccepted: true,
    isAlreadySynced: false,
    message:
      finalStatus === "completed"
        ? "Offline break synced and marked as completed"
        : "Offline break synced and apps are now unlocked",
    break: formatReconcileBreak(
      populatedBreak || createdBreak,
      activeTimezone,
    ),
    breaksLeft: newBreaksLeft,
    totalAllowed: breakConfig.breaksPerDay,
    durationMinutes: breakConfig.breakDurationMinutes,
    takenToday: newBreaksToday,
  };
};

export const BreakService = {
  startBreak,
  // pauseBreak,
  // resumeBreak,
  getActiveBreakStatus,
  getRemainingBreaks,
  stopBreak,
  updateExpiredBreaks,
  getGlobalBreakConfig,
  updateGlobalBreakConfig,
  reconcileBreakFromDB,
};