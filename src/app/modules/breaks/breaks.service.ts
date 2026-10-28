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
  dayjs,
} from "../../../helpers/timezoneHelper";
import { errorLogger } from "../../../shared/logger";
import { BreakCache } from "./breaks.cache";

const startBreak = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const now = new Date();
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Fast retrieval from in-memory cache, or optimized DB load if cold
  let state = await BreakCache.getOrFetchState(userId, userTimezone);

  // If both activeMode and activeSession are null in cache, re-verify with DB to prevent false rejection
  if (!state.activeMode && !state.activeSession) {
    state = await BreakCache.getOrFetchState(userId, userTimezone, true);
  }

  const { activeMode, activeSession, existingBreak, breakConfig, breaksToday } =
    state;

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

    // Cleanly auto-complete leftover/stale break in background
    Break.findByIdAndUpdate(existingBreak._id, {
      status: "completed",
      endTime: now,
      remainingSeconds: 0,
    }).catch((err) =>
      errorLogger.error("Failed to auto-complete stale break:", err),
    );
  }

  const allowedBreaks = breakConfig.breaksPerDay;
  let breakDurationMinutes = breakConfig.breakDurationMinutes;

  if (activeSession && typeof activeSession.breakDurationMinutes === "number") {
    breakDurationMinutes = activeSession.breakDurationMinutes;
  }

  if (allowedBreaks <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Breaks are not allowed");
  }

  if (breaksToday >= allowedBreaks) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Daily break limit reached");
  }

  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + breakDurationMinutes * 60000);

  const result = new Break({
    _id: new mongoose.Types.ObjectId(),
    userId: userObjectId,
    modeId: modeIdToUse,
    startTime,
    endTime,
    totalDurationMinutes: breakDurationMinutes,
    remainingSeconds: breakDurationMinutes * 60,
    durationMinutes: 0,
    status: "active",
    isDeleted: false,
    createdAt: startTime,
    updatedAt: startTime,
  });

  // Immediately update in-memory cache so subsequent requests instantly see active break
  const cachedDoc = {
    ...result.toObject(),
    modeId: activeMode || modeIdToUse,
  };
  BreakCache.setActiveBreak(
    userId,
    cachedDoc,
    breakDurationMinutes,
    userTimezone,
  );

  // Background non-blocking DB persistence
  result.save().catch((err) => {
    errorLogger.error("Failed to save break in DB:", err);
  });

  if (activeSession?._id) {
    FocusSession.findByIdAndUpdate(activeSession._id, {
      $inc: { usedBreaksCount: 1 },
    }).catch((err) => {
      errorLogger.error("Failed to update session usedBreaksCount:", err);
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
  const state = await BreakCache.getOrFetchState(userId, userTimezone);
  const { existingBreak, breakConfig, activeSession, breaksToday } = state;

  let currentBreak: any = null;
  if (
    existingBreak &&
    existingBreak.status === "active" &&
    new Date(existingBreak.endTime).getTime() > now.getTime()
  ) {
    currentBreak = existingBreak;
  }

  const remainingBreaksToday = Math.max(
    0,
    breakConfig.breaksPerDay - breaksToday,
  );

  let elapsedMinutes = 0;
  if (currentBreak) {
    const breakStartMs = new Date(currentBreak.startTime).getTime();
    elapsedMinutes = Math.max(
      0,
      Math.round((now.getTime() - breakStartMs) / 60000),
    );
  }

  const breakStats = {
    todayMinutes: Math.max(
      0,
      (state.todayCompletedMinutes || 0) + elapsedMinutes,
    ),
    weekMinutes: Math.max(
      0,
      (state.weekCompletedMinutes || 0) + elapsedMinutes,
    ),
  };

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
      Math.ceil(
        (new Date(currentBreak.endTime).getTime() - now.getTime()) / 1000,
      ),
    ),
  );
  const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

  const rawDoc =
    typeof (currentBreak as any).toObject === "function"
      ? (currentBreak as any).toObject()
      : { ...currentBreak };

  return {
    isBreakActive: true,
    isBreakPaused: false,
    breakDetails: {
      ...rawDoc,
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
  const now = new Date();
  const state = await BreakCache.getOrFetchState(userId, userTimezone);
  const { breakConfig, breaksToday, activeSession, existingBreak } = state;

  let activeBreakInfo = null;
  if (
    existingBreak &&
    existingBreak.status === "active" &&
    new Date(existingBreak.endTime).getTime() > now.getTime()
  ) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil(
        (new Date(existingBreak.endTime).getTime() - now.getTime()) / 1000,
      ),
    );
    const remainingMinutes = Math.max(0, Math.ceil(remainingSeconds / 60));

    activeBreakInfo = {
      _id: existingBreak._id,
      status: existingBreak.status,
      isPaused: false,
      endTime: existingBreak.endTime,
      remainingSeconds,
      remainingMinutes,
    };
  }

  const totalAllowed = breakConfig.breaksPerDay;
  let durationMinutes = breakConfig.breakDurationMinutes;
  if (activeSession && typeof activeSession.breakDurationMinutes === "number") {
    durationMinutes = activeSession.breakDurationMinutes;
  }
  const takenToday = breaksToday;
  const remaining = Math.max(0, totalAllowed - takenToday);

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

  // Check cache first for active break (instant 0.001ms hit)
  let currentBreakToStop = BreakCache.getActiveBreak(userId);

  if (!currentBreakToStop) {
    currentBreakToStop = await Break.findOne({
      userId: userObjectId,
      nudgeId: { $exists: false },
      status: "active",
      endTime: { $gt: now },
      isDeleted: false,
    })
      .select(
        "_id status remainingSeconds endTime startTime totalDurationMinutes modeId isDeleted createdAt updatedAt",
      )
      .lean();
  }

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

  // Update in-memory cache immediately
  BreakCache.clearActiveBreak(userId, durationMinutes);

  const rawDoc =
    typeof (currentBreakToStop as any).toObject === "function"
      ? (currentBreakToStop as any).toObject()
      : currentBreakToStop;

  const updatedBreak = {
    ...rawDoc,
    status: "completed",
    endTime: now,
    durationMinutes,
    remainingSeconds: 0,
    updatedAt: now,
  };

  // Background non-blocking DB update
  Break.findByIdAndUpdate(
    currentBreakToStop._id,
    {
      status: "completed",
      endTime: now,
      durationMinutes,
      remainingSeconds: 0,
    },
    { new: true },
  ).catch((err) => {
    errorLogger.error("Failed to stop break in DB:", err);
  });

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

  const uniqueUserIds = [...new Set(userIds)];
  uniqueUserIds.forEach((uid) => BreakCache.invalidate(uid));

  return {
    modifiedCount: expiredBreaks.length,
    userIds: uniqueUserIds,
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

  BreakCache.updateBreakConfig(userId, payload);

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

  const allowedBreaks = breakConfig.breaksPerDay;
  let effectiveDurationMinutes = breakConfig.breakDurationMinutes;
  if (activeSession && typeof activeSession.breakDurationMinutes === "number") {
    effectiveDurationMinutes = activeSession.breakDurationMinutes;
  }
  const breaksUsed = breaksToday;

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

  BreakCache.invalidate(userId);

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
