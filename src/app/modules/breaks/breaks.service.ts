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

  const [
    activeMode,
    activeSession,
    existingBreak,
    breakConfigDoc,
    breaksToday,
  ] = await Promise.all([
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
    }).lean(),

    Break.findOne({
      userId: userObjectId,
      nudgeId: { $exists: false },
      status: "active",
      endTime: { $gt: now },
    })
      .select("_id startTime createdAt")
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
    const breakStartTime = existingBreak.startTime
      ? new Date(existingBreak.startTime).getTime()
      : existingBreak.createdAt
        ? new Date(existingBreak.createdAt).getTime()
        : 0;
    const breakAgeMs = now.getTime() - breakStartTime;

    // Guard against rapid duplicate button taps (within 5 seconds)
    if (breakStartTime > 0 && breakAgeMs >= 0 && breakAgeMs < 5000) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "A break was already started. Please wait a moment.",
      );
    }

    // Otherwise, this is a leftover/stale break from an earlier session: cleanly auto-complete it
    await Break.findByIdAndUpdate(existingBreak._id, {
      status: "completed",
      endTime: now,
      remainingSeconds: 0,
    });
  }

  let breakConfig = breakConfigDoc;
  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: userObjectId,
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  }

  let allowedBreaks = breakConfig.breaksPerDay;
  let breakDurationMinutes = breakConfig.breakDurationMinutes;
  let breaksUsed = breaksToday;

  if (activeSession) {
    if (typeof activeSession.maxBreaks === "number") {
      allowedBreaks = activeSession.maxBreaks;
    }
    if (typeof activeSession.breakDurationMinutes === "number") {
      breakDurationMinutes = activeSession.breakDurationMinutes;
    }
    breaksUsed =
      typeof activeSession.usedBreaksCount === "number"
        ? activeSession.usedBreaksCount
        : breaksToday;
  }

  if (allowedBreaks <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Breaks are not allowed");
  }

  if (breaksUsed >= allowedBreaks) {
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

  if (activeSession?._id) {
    await FocusSession.findByIdAndUpdate(activeSession._id, {
      $inc: { usedBreaksCount: 1 },
    });
  }

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

const getActiveBreakStatus = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const now = new Date();
  const [currentBreak, breakConfigDoc, activeSession] = await Promise.all([
    Break.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      nudgeId: { $exists: false },
      status: "active",
      endTime: { $gt: now },
    }).populate("modeId"),
    BreakConfig.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    }),
    FocusSession.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: "active",
    }).lean(),
  ]);

  let breakConfig = breakConfigDoc;
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
      const durationMs = Math.max(
        0,
        new Date().getTime() - breakItem.startTime.getTime(),
      );
      todayMinutes += Math.round(durationMs / 60000);
    }
  });
  todayMinutes = Math.max(0, todayMinutes);

  let weekMinutes = 0;
  weekBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      weekMinutes += breakItem.durationMinutes || 0;
    } else {
      const durationMs = Math.max(
        0,
        new Date().getTime() - breakItem.startTime.getTime(),
      );
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

  let remainingBreaksToday = Math.max(
    0,
    breakConfig.breaksPerDay - breaksToday,
  );
  if (activeSession) {
    const sessionMax =
      typeof activeSession.maxBreaks === "number"
        ? activeSession.maxBreaks
        : breakConfig.breaksPerDay;
    const sessionUsed =
      typeof activeSession.usedBreaksCount === "number"
        ? activeSession.usedBreaksCount
        : breaksToday;
    remainingBreaksToday = Math.max(0, sessionMax - sessionUsed);
  }

  if (!currentBreak) {
    return {
      isBreakActive: false,
      isBreakPaused: false,
      remainingBreaksToday,
      breakStats,
    };
  }

  const totalBreakSeconds =
    (currentBreak.totalDurationMinutes ||
      breakConfig.breakDurationMinutes ||
      15) * 60;
  const remainingSeconds = Math.min(
    totalBreakSeconds,
    Math.max(
      0,
      Math.ceil((currentBreak.endTime.getTime() - now.getTime()) / 1000),
    ),
  );
  const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

  return {
    isBreakActive: true,
    isBreakPaused: false,
    breakDetails: {
      ...currentBreak.toObject(),
      remainingSeconds,
      remainingMinutes,
    },
    remainingBreaksToday,
    breakStats,
  };
};

const getRemainingBreaks = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const [breakConfigDoc, activeSession] = await Promise.all([
    BreakConfig.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      isDeleted: { $in: [true, false] },
    }),
    FocusSession.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: "active",
    }).lean(),
  ]);

  let breakConfig = breakConfigDoc;

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
    status: "active",
    endTime: { $gt: new Date() },
  });

  let activeBreakInfo = null;
  if (currentBreak) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((currentBreak.endTime.getTime() - new Date().getTime()) / 1000),
    );
    const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

    activeBreakInfo = {
      _id: currentBreak._id,
      status: currentBreak.status,
      isPaused: false,
      endTime: currentBreak.endTime,
      remainingSeconds,
      remainingMinutes,
    };
  }

  let totalAllowed = breakConfig.breaksPerDay;
  let durationMinutes = breakConfig.breakDurationMinutes;
  let takenToday = breaksToday;
  let remaining = Math.max(0, totalAllowed - takenToday);

  if (activeSession) {
    if (typeof activeSession.maxBreaks === "number") {
      totalAllowed = activeSession.maxBreaks;
    }
    if (typeof activeSession.breakDurationMinutes === "number") {
      durationMinutes = activeSession.breakDurationMinutes;
    }
    takenToday =
      typeof activeSession.usedBreaksCount === "number"
        ? activeSession.usedBreaksCount
        : breaksToday;
    remaining = Math.max(0, totalAllowed - takenToday);
  }

  return {
    totalAllowed,
    durationMinutes,
    takenToday,
    remaining,
    remainingBreaks: remaining,
    activeBreak: activeBreakInfo,
  };
};

const stopBreak = async (userId: string) => {
  const now = new Date();
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const currentBreakToStop = await Break.findOne({
    userId: userObjectId,
    nudgeId: { $exists: false },
    status: "active",
    endTime: { $gt: now },
  })
    .select(
      "_id status remainingSeconds endTime startTime totalDurationMinutes",
    )
    .lean();

  if (!currentBreakToStop) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No active break found to stop",
    );
  }

  const remainingMs = Math.max(
    0,
    new Date(currentBreakToStop.endTime).getTime() - now.getTime(),
  );
  const remainingSeconds = Math.round(remainingMs / 1000);

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
  const endTime = breakDoc.endTime ? new Date(breakDoc.endTime) : new Date();
  const now = new Date();

  const totalDurationMinutes = breakDoc.totalDurationMinutes || 15;
  const maxAllowedSeconds = totalDurationMinutes * 60;
  const isCompleted = breakDoc.status === "completed";
  const remainingSeconds = isCompleted
    ? 0
    : Math.min(
        maxAllowedSeconds,
        Math.max(0, Math.ceil((endTime.getTime() - now.getTime()) / 1000)),
      );
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
  const activeTimezone = isValidTimezone(timezone) ? timezone! : userTimezone;

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

  // 1. Idempotency & Session Check
  const [existingBreak, breakConfigDoc, activeSession] = await Promise.all([
    Break.findOne({
      userId: userObjectId,
      clientBreakId: trimmedClientBreakId,
      isDeleted: { $ne: true },
    }).populate("modeId"),
    BreakConfig.findOne({
      userId: userObjectId,
      isDeleted: { $ne: true },
    }),
    FocusSession.findOne({
      userId: userObjectId,
      status: "active",
      isDeleted: false,
    }),
  ]);

  let breakConfig = breakConfigDoc;
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

  let allowedBreaks = breakConfig.breaksPerDay;
  let effectiveDurationMinutes = breakConfig.breakDurationMinutes;
  let breaksUsed = breaksToday;

  if (activeSession) {
    if (typeof activeSession.maxBreaks === "number") {
      allowedBreaks = activeSession.maxBreaks;
    }
    if (typeof activeSession.breakDurationMinutes === "number") {
      effectiveDurationMinutes = activeSession.breakDurationMinutes;
    }
    breaksUsed =
      typeof activeSession.usedBreaksCount === "number"
        ? activeSession.usedBreaksCount
        : breaksToday;
  }

  const remainingBreaks = Math.max(0, allowedBreaks - breaksUsed);

  if (existingBreak) {
    return {
      isAccepted: true,
      isAlreadySynced: true,
      message: "Break is already synced",
      break: formatReconcileBreak(existingBreak, activeTimezone),
      breaksLeft: remainingBreaks,
      totalAllowed: allowedBreaks,
      durationMinutes: effectiveDurationMinutes,
      takenToday: breaksUsed,
    };
  }

  // 2. Quota Check: verify if user is allowed to take a break
  if (allowedBreaks <= 0) {
    return {
      isAccepted: false,
      isAlreadySynced: false,
      errorCode: "BREAKS_NOT_ALLOWED",
      message: "Breaks are not allowed",
      break: null,
      breaksLeft: 0,
      totalAllowed: allowedBreaks,
      durationMinutes: effectiveDurationMinutes,
      takenToday: breaksUsed,
    };
  }

  if (breaksUsed >= allowedBreaks) {
    return {
      isAccepted: false,
      isAlreadySynced: false,
      errorCode: "BREAK_QUOTA_EXCEEDED",
      message: "Daily break limit reached",
      break: null,
      breaksLeft: 0,
      totalAllowed: allowedBreaks,
      durationMinutes: effectiveDurationMinutes,
      takenToday: breaksUsed,
    };
  }

  // 3. Determine Mode
  let modeIdToUse: any = modeId;
  if (!modeIdToUse) {
    const activeMode = await Mode.findOne({
      userId: userObjectId,
      isActive: true,
      isDeleted: false,
    })
      .select("_id")
      .lean();
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
  // Guard against extreme clock-skew or invalid future timestamp.
  // Allow slight client clock drift (up to 5 minutes into the future) to preserve offline progress.
  const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000;
  if (
    status !== "completed" &&
    !endedAt &&
    startTime.getTime() - Date.now() > MAX_FUTURE_DRIFT_MS
  ) {
    startTime = new Date();
  }
  const breakDurationMinutes = effectiveDurationMinutes || 15;
  const totalBreakSeconds = breakDurationMinutes * 60;
  const scheduledEndTime = new Date(
    startTime.getTime() + breakDurationMinutes * 60000,
  );

  let finalStatus: "active" | "completed" = "active";
  let finalEndTime: Date = scheduledEndTime;
  let durationMinutes = 0;
  let remainingSeconds = totalBreakSeconds;

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
      remainingSeconds = Math.min(
        totalBreakSeconds,
        Math.max(
          0,
          Math.ceil((scheduledEndTime.getTime() - now.getTime()) / 1000),
        ),
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

  if (activeSession?._id) {
    await FocusSession.findByIdAndUpdate(activeSession._id, {
      $inc: { usedBreaksCount: 1 },
    });
  }

  const newBreaksUsed = breaksUsed + 1;
  const newBreaksLeft = Math.max(0, allowedBreaks - newBreaksUsed);

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
    break: formatReconcileBreak(populatedBreak || createdBreak, activeTimezone),
    breaksLeft: newBreaksLeft,
    totalAllowed: allowedBreaks,
    durationMinutes: effectiveDurationMinutes,
    takenToday: newBreaksUsed,
  };
};

export const BreakService = {
  startBreak,
  getActiveBreakStatus,
  getRemainingBreaks,
  stopBreak,
  updateExpiredBreaks,
  getGlobalBreakConfig,
  updateGlobalBreakConfig,
  reconcileBreakFromDB,
};
