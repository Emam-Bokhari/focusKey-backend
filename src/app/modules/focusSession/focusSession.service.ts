import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { FocusSession } from "./focusSession.model";
import { IReconcileSessionPayload } from "./focusSession.interface";
import { Break, BreakConfig } from "../breaks/breaks.model";
import { Mode } from "../modes/modes.model";
import { ModeService } from "../modes/modes.service";
import dayjs from "dayjs";
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  formatZonedDateKey,
  formatZonedSinceDate,
  formatZonedTimeRange,
  getZonedDateGroupHeader,
  getZonedEndOfDay,
  getZonedStartOfDay,
  formatZonedIso,
} from "../../../helpers/timezoneHelper";


const formatDuration = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    hours,
    minutes,
    formatted: `${hours}h ${minutes}m`,
  };
};


const calculateBreakMinutes = (b: any, nowMs: number) => {
  if (b.status === "completed") {
    return b.durationMinutes || 0;
  } else if (b.status === "paused") {
    const totalSec = (b.totalDurationMinutes || 15) * 60;
    const spentSec = Math.max(0, totalSec - (b.remainingSeconds || 0));
    return Math.round(spentSec / 60);
  } else {
    const bStartMs = new Date(b.startTime).getTime();
    return Math.max(0, Math.round((nowMs - bStartMs) / 60000));
  }
};

const calculateTotalMinutes = (
  allSessions: any[],
  allBreaks: any[],
  nowMs: number,
) => {
  let totalMinutes = 0;
  for (const s of allSessions) {
    if (s.status === "completed") {
      totalMinutes += s.durationMinutes || 0;
    } else {
      const diff = Math.max(0, nowMs - new Date(s.startTime).getTime());
      totalMinutes += Math.round(diff / 60000);
    }
  }

  for (const b of allBreaks) {
    totalMinutes -= calculateBreakMinutes(b, nowMs);
  }

  return Math.max(0, totalMinutes);
};

const calculateSevenDaysStats = (
  allSessions: any[],
  allBreaks: any[],
  now: Date,
  nowMs: number,
  isV2 = false,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const stats = [];
  for (let i = 6; i >= 0; i--) {
    const zonedTargetDate = dayjs().tz(userTimezone).subtract(i, "day");
    const startOfDay = zonedTargetDate.startOf("day").toDate();
    const startOfDayMs = startOfDay.getTime();
    const endOfDay = zonedTargetDate.endOf("day").toDate();
    const endOfDayMs = endOfDay.getTime();

    const dayName = isV2
      ? zonedTargetDate.format("dddd")
      : zonedTargetDate.format("ddd");
    const dayLabel = dayName[0];
    const dateStr = zonedTargetDate.format("YYYY-MM-DD");

    let dayMinutes = 0;

    for (const s of allSessions) {
      const sStartMs = new Date(s.startTime).getTime();
      const isActive = s.status === "active";
      const sEndMs = isActive
        ? nowMs
        : s.endTime
          ? new Date(s.endTime).getTime()
          : nowMs;

      const overlaps =
        (sStartMs >= startOfDayMs && sStartMs <= endOfDayMs) ||
        (!isActive && sEndMs >= startOfDayMs && sEndMs <= endOfDayMs) ||
        (isActive && sStartMs <= endOfDayMs);

      if (overlaps) {
        const segStart = sStartMs > startOfDayMs ? sStartMs : startOfDayMs;
        const segEnd = sEndMs > endOfDayMs ? endOfDayMs : sEndMs;
        if (segEnd > segStart) {
          dayMinutes += Math.round((segEnd - segStart) / 60000);
        }
      }
    }

    for (const b of allBreaks) {
      const bStartMs = new Date(b.startTime).getTime();
      const isPaused = b.status === "paused";
      const isActive = b.status === "active";
      const bEndMs = isActive
        ? nowMs
        : b.endTime
          ? new Date(b.endTime).getTime()
          : nowMs;

      const overlaps =
        (bStartMs >= startOfDayMs && bStartMs <= endOfDayMs) ||
        (!isActive && bEndMs >= startOfDayMs && bEndMs <= endOfDayMs) ||
        (isActive && bStartMs <= endOfDayMs);

      if (overlaps) {
        if (isPaused) {
          const totalSec = (b.totalDurationMinutes || 15) * 60;
          const spentSec = Math.max(0, totalSec - (b.remainingSeconds || 0));
          dayMinutes -= Math.round(spentSec / 60);
        } else {
          const segStart = bStartMs > startOfDayMs ? bStartMs : startOfDayMs;
          const segEnd = bEndMs > endOfDayMs ? endOfDayMs : bEndMs;
          if (segEnd > segStart) {
            dayMinutes -= Math.round((segEnd - segStart) / 60000);
          }
        }
      }
    }

    const maxDayMinutes = Math.max(0, dayMinutes);
    if (isV2) {
      stats.push({
        day: dayName,
        dayLabel,
        date: dateStr,
        totalMinutes: maxDayMinutes,
        formatted: formatDuration(maxDayMinutes).formatted,
      });
    } else {
      stats.push({
        day: dayName,
        date: dateStr,
        totalMinutes: maxDayMinutes,
        formatted: formatDuration(maxDayMinutes).formatted,
      });
    }
  }
  return stats;
};

const indexBreaksByMode = (allBreaks: any[]) => {
  const map = new Map<string, any[]>();
  for (const b of allBreaks) {
    const mId = (b.modeId?._id || b.modeId)?.toString();
    if (mId) {
      let list = map.get(mId);
      if (!list) {
        list = [];
        map.set(mId, list);
      }
      list.push(b);
    }
  }
  return map;
};

const calculateSessionBreakMinutes = (
  candidateBreaks: any[],
  session: any,
  nowMs: number,
) => {
  const sStartMs = new Date(session.startTime).getTime();
  const isCompleted = session.status === "completed";
  const sEndMs = session.endTime ? new Date(session.endTime).getTime() : null;

  let sessionBreakMinutes = 0;
  for (const b of candidateBreaks) {
    const bStartMs = new Date(b.startTime).getTime();
    if (bStartMs < sStartMs) continue;

    if (isCompleted) {
      if (!b.endTime || sEndMs === null) continue;
      if (new Date(b.endTime).getTime() > sEndMs) continue;
    } else {
      if (b.endTime == null) continue;
    }

    sessionBreakMinutes += calculateBreakMinutes(b, nowMs);
  }
  return sessionBreakMinutes;
};

const getFocusHistoryFromDB = async (
  userId: string,
  modeId?: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const modeObjectId = modeId ? new mongoose.Types.ObjectId(modeId) : undefined;

  const query: any = { userId: userObjectId, isDeleted: false };
  if (modeObjectId) {
    query.modeId = modeObjectId;
  }

  const [allSessions, allBreaks, firstSessionResult] = await Promise.all([
    FocusSession.find(query)
      .populate("modeId", "_id name icon")
      .sort({ startTime: -1 })
      .lean(),
    Break.find(query).lean(),
    modeObjectId
      ? FocusSession.findOne({ userId: userObjectId, isDeleted: false })
          .select("startTime")
          .sort({ startTime: 1 })
          .lean()
      : Promise.resolve(null),
  ]);

  const now = new Date();
  const nowMs = now.getTime();

  const totalMinutes = calculateTotalMinutes(allSessions, allBreaks, nowMs);

  const firstSession =
    firstSessionResult ||
    (allSessions.length > 0 ? allSessions[allSessions.length - 1] : null);
  const firstFocusDate = firstSession ? firstSession.startTime : null;

  const sevenDaysStats = calculateSevenDaysStats(
    allSessions,
    allBreaks,
    now,
    nowMs,
    false,
    userTimezone,
  );

  const startOfToday = getZonedStartOfDay(now, userTimezone);
  const startOfTodayMs = startOfToday.getTime();
  const endOfToday = getZonedEndOfDay(now, userTimezone);
  const endOfTodayMs = endOfToday.getTime();

  const modeWiseToday: Record<string, number> = {};
  for (const s of allSessions) {
    const sStartMs = new Date(s.startTime).getTime();
    const isActive = s.status === "active";
    const isToday =
      (sStartMs >= startOfTodayMs && sStartMs <= endOfTodayMs) || isActive;

    if (isToday) {
      const modeName = (s.modeId as any)?.name || "Unknown Mode";
      if (!modeWiseToday[modeName]) {
        modeWiseToday[modeName] = 0;
      }
      if (s.status === "completed") {
        modeWiseToday[modeName] += s.durationMinutes || 0;
      } else {
        const diff = Math.max(0, nowMs - sStartMs);
        modeWiseToday[modeName] += Math.round(diff / 60000);
      }
    }
  }

  for (const b of allBreaks) {
    const bCreatedMs = new Date(b.createdAt || b.startTime).getTime();
    if (bCreatedMs >= startOfTodayMs && bCreatedMs <= endOfTodayMs) {
      const modeName = (b.modeId as any)?.name || "Unknown Mode";
      if (modeWiseToday[modeName]) {
        const breakMin = calculateBreakMinutes(b, nowMs);
        modeWiseToday[modeName] = Math.max(
          0,
          modeWiseToday[modeName] - breakMin,
        );
      }
    }
  }

  const todayStats = Object.keys(modeWiseToday).map((mode) => ({
    mode,
    duration: formatDuration(modeWiseToday[mode]),
  }));

  const breaksByMode = indexBreaksByMode(allBreaks);
  const groupedHistory: Record<string, any> = {};

  for (const session of allSessions) {
    const sStartTime = new Date(session.startTime);
    const dateKey = formatZonedDateKey(sStartTime, userTimezone);

    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = {
        date: dateKey,
        totalFocusMinutes: 0,
        sessions: [],
      };
    }

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes = session.durationMinutes || 0;
    } else {
      sessionMinutes = Math.max(
        0,
        Math.round((nowMs - sStartTime.getTime()) / 60000),
      );
    }

    const sModeId = (session.modeId as any)?._id
      ? (session.modeId as any)._id.toString()
      : session.modeId?.toString();

    const candidateBreaks = sModeId ? breaksByMode.get(sModeId) || [] : [];
    const sessionBreakMinutes = calculateSessionBreakMinutes(
      candidateBreaks,
      session,
      nowMs,
    );

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const duration = formatDuration(netSessionMinutes);
    const timeRange = formatZonedTimeRange(
      sStartTime,
      session.endTime,
      userTimezone,
      false,
    );

    groupedHistory[dateKey].totalFocusMinutes += netSessionMinutes;
    groupedHistory[dateKey].sessions.push({
      modeName: (session.modeId as any)?.name,
      startTime: formatZonedIso(session.startTime, userTimezone),
      endTime: session.endTime
        ? formatZonedIso(session.endTime, userTimezone)
        : null,
      timeRange,
      duration,
      status: session.status,
    });
  }

  const sortedDates = Object.keys(groupedHistory).sort((a, b) =>
    b.localeCompare(a),
  );

  const history = sortedDates.map((dateKey) => {
    const day = groupedHistory[dateKey];
    day.sessions.sort(
      (a: any, b: any) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    return {
      ...day,
      totalFocusTimeFormatted: formatDuration(day.totalFocusMinutes).formatted,
    };
  });

  return {
    summary: {
      totalFocusTime: formatDuration(totalMinutes),
      firstFocusDate: firstFocusDate
        ? formatZonedIso(firstFocusDate, userTimezone)
        : null,
    },
    sevenDaysStats,
    todayStats,
    history,
  };
};

const getFocusHistoryV2FromDB = async (
  userId: string,
  modeId?: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const modeObjectId = modeId ? new mongoose.Types.ObjectId(modeId) : undefined;

  const query: any = { userId: userObjectId, isDeleted: false };
  if (modeObjectId) {
    query.modeId = modeObjectId;
  }

  // Single concurrent round-trip for all collections using lean queries and indexes
  const [modesResult, allSessions, allBreaks, firstSessionResult] =
    await Promise.all([
      Mode.find({
        userId: userObjectId,
        isDeleted: false,
      })
        .select("_id name icon")
        .lean(),
      FocusSession.find(query)
        .populate("modeId", "_id name icon")
        .sort({ startTime: -1 })
        .lean(),
      Break.find(query).lean(),
      modeObjectId
        ? FocusSession.findOne({ userId: userObjectId, isDeleted: false })
            .select("startTime")
            .sort({ startTime: 1 })
            .lean()
        : Promise.resolve(null),
    ]);

  let modes = modesResult;
  if (modes.length === 0) {
    await ModeService.ensureDefaultModesExist(userId);
    modes = await Mode.find({
      userId: userObjectId,
      isDeleted: false,
    })
      .select("_id name icon")
      .lean();
  }

  const now = new Date();
  const nowMs = now.getTime();

  const totalMinutes = calculateTotalMinutes(allSessions, allBreaks, nowMs);

  const firstSession =
    firstSessionResult ||
    (allSessions.length > 0 ? allSessions[allSessions.length - 1] : null);
  const firstFocusDate = firstSession ? firstSession.startTime : null;
  const sinceDate = formatZonedSinceDate(firstFocusDate, userTimezone);

  const sevenDaysStats = calculateSevenDaysStats(
    allSessions,
    allBreaks,
    now,
    nowMs,
    true,
    userTimezone,
  );

  const breaksByMode = indexBreaksByMode(allBreaks);
  const groupedHistory: Record<string, any> = {};

  const todayStr = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const monthNamesShort = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];

  const formatHeaderDate = (dateStr: string) => {
    if (dateStr === todayStr) return "TODAY";
    if (dateStr === yesterdayStr) return "YESTERDAY";
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return `${monthNamesShort[d.getMonth()]} ${d.getDate()}`;
  };

  for (const session of allSessions) {
    const sStartTime = new Date(session.startTime);
    const dateKey = formatZonedDateKey(sStartTime, userTimezone);

    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = {
        date: dateKey,
        dateHeader: getZonedDateGroupHeader(dateKey, userTimezone),
        totalFocusMinutes: 0,
        sessions: [],
      };
    }

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes = session.durationMinutes || 0;
    } else {
      sessionMinutes = Math.max(
        0,
        Math.round((nowMs - sStartTime.getTime()) / 60000),
      );
    }

    const sModeId = (session.modeId as any)?._id
      ? (session.modeId as any)._id.toString()
      : session.modeId?.toString();

    const candidateBreaks = sModeId ? breaksByMode.get(sModeId) || [] : [];
    const sessionBreakMinutes = calculateSessionBreakMinutes(
      candidateBreaks,
      session,
      nowMs,
    );

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const duration = formatDuration(netSessionMinutes);
    const timeRange = formatZonedTimeRange(
      sStartTime,
      session.endTime,
      userTimezone,
      true,
    );

    groupedHistory[dateKey].totalFocusMinutes += netSessionMinutes;
    groupedHistory[dateKey].sessions.push({
      modeName: (session.modeId as any)?.name,
      startTime: formatZonedIso(session.startTime, userTimezone),
      endTime: session.endTime
        ? formatZonedIso(session.endTime, userTimezone)
        : null,
      timeRange,
      duration,
      status: session.status,
    });
  }

  const sortedDates = Object.keys(groupedHistory).sort((a, b) =>
    b.localeCompare(a),
  );

  const history = sortedDates.map((dateKey) => {
    const day = groupedHistory[dateKey];
    day.sessions.sort(
      (a: any, b: any) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    return {
      ...day,
      totalFocusTimeFormatted: formatDuration(day.totalFocusMinutes).formatted,
    };
  });

  return {
    modes,
    summary: {
      totalFocusTime: formatDuration(totalMinutes),
      firstFocusDate: firstFocusDate
        ? formatZonedIso(firstFocusDate, userTimezone)
        : null,
      sinceDate,
    },
    sevenDaysStats,
    history,
  };
};

const getFocusStatsFromDB = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [allSessions, allBreaks] = await Promise.all([
    FocusSession.find({ userId: userObjectId, isDeleted: false })
      .sort({ startTime: -1 })
      .lean(),
    Break.find({ userId: userObjectId, isDeleted: false }).lean(),
  ]);

  const nowMs = Date.now();
  const totalSessions = allSessions.length;
  const totalMinutes = calculateTotalMinutes(allSessions, allBreaks, nowMs);

  const firstSession =
    allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;
  const lastSession = allSessions.length > 0 ? allSessions[0] : null;

  const startDate = firstSession
    ? formatZonedIso(firstSession.startTime, userTimezone)
    : null;
  const endDate = lastSession
    ? formatZonedIso(lastSession.endTime || new Date(), userTimezone)
    : null;

  return {
    totalSessions,
    totalFocusTime: formatDuration(totalMinutes),
    dateRange: {
      startDate,
      endDate,
    },
  };
};

const exportFocusHistoryToCSVFromDB = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [sessions, allBreaks] = await Promise.all([
    FocusSession.find({ userId: userObjectId, isDeleted: false })
      .populate("modeId")
      .sort({ startTime: -1 })
      .lean(),
    Break.find({ userId: userObjectId, isDeleted: false }).lean(),
  ]);

  const nowMs = Date.now();
  const breaksByMode = indexBreaksByMode(allBreaks);

  let csvContent = "\ufeffDate,Mode,Time Range,Duration,Status\n";

  for (const session of sessions) {
    const sStartTime = new Date(session.startTime);
    const date = formatZonedDateKey(sStartTime, userTimezone);
    const modeName = (session.modeId as any)?.name || "Unknown Mode";

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes = session.durationMinutes || 0;
    } else {
      sessionMinutes = Math.max(
        0,
        Math.round((nowMs - sStartTime.getTime()) / 60000),
      );
    }

    const sModeId = (session.modeId as any)?._id
      ? (session.modeId as any)._id.toString()
      : session.modeId?.toString();

    const candidateBreaks = sModeId ? breaksByMode.get(sModeId) || [] : [];
    const sessionBreakMinutes = calculateSessionBreakMinutes(
      candidateBreaks,
      session,
      nowMs,
    );

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const durationFormatted = formatDuration(netSessionMinutes).formatted;
    const timeRange = formatZonedTimeRange(
      sStartTime,
      session.endTime,
      userTimezone,
      false,
    );

    const escapedModeName = `"${modeName.replace(/"/g, '""')}"`;

    csvContent += `${date},${escapedModeName},${timeRange},${durationFormatted},${session.status}\n`;
  }

  return csvContent;
};

const clearAllDataFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  await Promise.all([
    FocusSession.updateMany(
      { userId: userObjectId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), status: "completed" } },
    ),
    Mode.updateMany(
      { userId: userObjectId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), isActive: false } },
    ),
    Break.updateMany(
      { userId: userObjectId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), status: "completed" } },
    ),
    BreakConfig.updateMany(
      { userId: userObjectId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
    ),
  ]);

  return { message: "All data cleared successfully" };
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
  // Check if string contains explicit timezone offset or Z, e.g. "Z", "+06:00", "-0400"
  const hasTimezoneOffset = /([Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasTimezoneOffset) {
    return dayjs(trimmed).toDate();
  } else {
    // If no offset was provided, interpret it in the user's selected timezone
    const tz = isValidTimezone(userTimezone) ? userTimezone : DEFAULT_TIMEZONE;
    return dayjs.tz(trimmed, tz).toDate();
  }
};

const formatReconcileSession = (
  session: any,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const startTime = session.startTime ? new Date(session.startTime) : new Date();
  const endTime = session.endTime ? new Date(session.endTime) : null;
  return {
    _id: session._id,
    userId: session.userId,
    modeId: session.modeId,
    clientSessionId: session.clientSessionId || null,
    startTime: formatZonedIso(startTime, userTimezone),
    endTime: endTime ? formatZonedIso(endTime, userTimezone) : null,
    startTimeRaw: startTime.toISOString(),
    endTimeRaw: endTime ? endTime.toISOString() : null,
    timeRange: formatZonedTimeRange(startTime, endTime, userTimezone),
    durationMinutes: session.durationMinutes || 0,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
};

const reconcileSessionFromDB = async (
  userId: string,
  payload: IReconcileSessionPayload,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const { clientSessionId, modeId, startedAt, endedAt, status, timezone } =
    payload;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const activeTimezone = isValidTimezone(timezone)
    ? timezone!
    : userTimezone;

  if (
    !clientSessionId ||
    typeof clientSessionId !== "string" ||
    !clientSessionId.trim()
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "clientSessionId is required to reconcile session",
    );
  }

  const trimmedClientSessionId = clientSessionId.trim();

  // 1. Check if session already exists for this user and clientSessionId
  const existingSession = await FocusSession.findOne({
    userId: userObjectId,
    clientSessionId: trimmedClientSessionId,
    isDeleted: false,
  }).populate("modeId");

  if (existingSession) {
    const lockStatus = await ModeService.getLockStatusFromDB(
      userId,
      activeTimezone,
    );
    return {
      exists: true,
      synced: true,
      isAlreadySynced: true,
      message: "Session is already synced",
      session: formatReconcileSession(existingSession, activeTimezone),
      lockStatus,
    };
  }

  // 2. If it does not exist and no modeId is supplied (pure existence check)
  if (!modeId) {
    const lockStatus = await ModeService.getLockStatusFromDB(
      userId,
      activeTimezone,
    );
    return {
      exists: false,
      synced: false,
      isAlreadySynced: false,
      message: "Session does not exist on server",
      session: null,
      lockStatus,
    };
  }

  // 3. Mode validation
  const modeObjectId = new mongoose.Types.ObjectId(modeId);
  const mode = await Mode.findOne({
    _id: modeObjectId,
    userId: userObjectId,
    isDeleted: false,
  });

  if (!mode) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }

  let startTime = parseClientDate(startedAt, activeTimezone);
  const isCompleted = status === "completed" || Boolean(endedAt);

  // Guard against extreme clock-skew or invalid future timestamp.
  // Allow slight client clock drift (up to 5 minutes into the future) to preserve offline progress.
  const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000;
  if (!isCompleted && startTime.getTime() - Date.now() > MAX_FUTURE_DRIFT_MS) {
    startTime = new Date();
  }

  let createdSession;

  if (isCompleted) {
    // Case A: Offline session that has already finished
    const endTime = endedAt
      ? parseClientDate(endedAt, activeTimezone)
      : new Date();
    const durationMs = Math.max(0, endTime.getTime() - startTime.getTime());
    const durationMinutes = Math.round(durationMs / 60000);

    createdSession = await FocusSession.create({
      userId: userObjectId,
      modeId: modeObjectId,
      clientSessionId: trimmedClientSessionId,
      startTime,
      endTime,
      durationMinutes,
      status: "completed",
    });

    // Retroactively push lock and unlock events to mode
    await Mode.findByIdAndUpdate(modeObjectId, {
      $push: {
        lockEvents: {
          $each: [
            { type: "lock", source: "mode", timestamp: startTime },
            { type: "unlock", source: "mode", timestamp: endTime },
          ],
        },
      },
    });
  } else {
    // Case B: Offline session that is currently ACTIVE / LOCKED
    // Close any previous active sessions
    const activeSessions = await FocusSession.find({
      userId: userObjectId,
      status: "active",
      isDeleted: false,
    }).lean();

    if (activeSessions.length > 0) {
      const bulkOps = activeSessions.map((s) => {
        const sEnd = startTime;
        const durationMs = Math.max(
          0,
          sEnd.getTime() - new Date(s.startTime).getTime(),
        );
        const durationMinutes = Math.round(durationMs / 60000);
        return {
          updateOne: {
            filter: { _id: s._id },
            update: {
              $set: {
                status: "completed",
                endTime: sEnd,
                durationMinutes,
              },
            },
          },
        };
      });
      await FocusSession.bulkWrite(bulkOps);
    }

    // Deactivate all other modes for this user
    await Mode.updateMany(
      { userId: userObjectId, _id: { $ne: modeObjectId } },
      { isActive: false },
    );

    // Activate the requested mode and log lockEvent
    await Mode.findByIdAndUpdate(modeObjectId, {
      isActive: true,
      $push: {
        lockEvents: {
          type: "lock",
          source: "mode",
          timestamp: startTime,
        },
      },
    });

    createdSession = await FocusSession.create({
      userId: userObjectId,
      modeId: modeObjectId,
      clientSessionId: trimmedClientSessionId,
      startTime,
      status: "active",
    });
  }

  const populatedSession = await FocusSession.findById(
    createdSession._id,
  ).populate("modeId");
  const lockStatus = await ModeService.getLockStatusFromDB(
    userId,
    activeTimezone,
  );

  return {
    exists: false,
    synced: true,
    isAlreadySynced: false,
    message: isCompleted
      ? "Offline completed focus session synced successfully"
      : "Offline active focus lock synced and activated successfully",
    session: formatReconcileSession(
      populatedSession || createdSession,
      activeTimezone,
    ),
    lockStatus,
  };
};

export const FocusSessionService = {
  getFocusHistoryFromDB,
  getFocusHistoryV2FromDB,
  getFocusStatsFromDB,
  exportFocusHistoryToCSVFromDB,
  clearAllDataFromDB,
  reconcileSessionFromDB,
};


