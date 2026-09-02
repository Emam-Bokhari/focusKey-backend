import mongoose from "mongoose";
import { FocusSession } from "./focusSession.model";
import { Break, BreakConfig } from "../breaks/breaks.model";
import { Mode } from "../modes/modes.model";
import { ModeService } from "../modes/modes.service";

const formatDuration = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    hours,
    minutes,
    formatted: `${hours}h ${minutes}m`,
  };
};

const formatTime = (date: Date) => {
  return date
    .toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
};

const formatTimeV2 = (date: Date) => {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const formatSinceDate = (date: Date | null) => {
  if (!date) return "No focus history";
  const d = new Date(date);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `Since ${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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
    return Math.round((nowMs - bStartMs) / 60000);
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
      const diff = nowMs - new Date(s.startTime).getTime();
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
) => {
  const stats = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const startOfDay = new Date(date);
    const startOfDayMs = startOfDay.getTime();
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfDayMs = endOfDay.getTime();

    const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
    const dayLabel = dayName[0];

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
        date: date.toISOString().split("T")[0],
        totalMinutes: maxDayMinutes,
        formatted: formatDuration(maxDayMinutes).formatted,
      });
    } else {
      stats.push({
        day: dayName,
        date: date.toISOString().split("T")[0],
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

const getFocusHistoryFromDB = async (userId: string, modeId?: string) => {
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
  );

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
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
        const diff = nowMs - sStartMs;
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
    const dateKey = sStartTime.toISOString().split("T")[0];

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
      sessionMinutes = Math.round((nowMs - sStartTime.getTime()) / 60000);
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
    const timeRange = `${formatTime(sStartTime)} - ${
      session.endTime ? formatTime(new Date(session.endTime)) : "Active"
    }`;

    groupedHistory[dateKey].totalFocusMinutes += netSessionMinutes;
    groupedHistory[dateKey].sessions.push({
      modeName: (session.modeId as any)?.name,
      startTime: session.startTime,
      endTime: session.endTime || null,
      timeRange,
      duration,
      status: session.status,
    });
  }

  const history = Object.values(groupedHistory).map((day: any) => ({
    ...day,
    totalFocusTimeFormatted: formatDuration(day.totalFocusMinutes).formatted,
  }));

  return {
    summary: {
      totalFocusTime: formatDuration(totalMinutes),
      firstFocusDate,
    },
    sevenDaysStats,
    todayStats,
    history,
  };
};

const getFocusHistoryV2FromDB = async (userId: string, modeId?: string) => {
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
  const sinceDate = formatSinceDate(firstFocusDate);

  const sevenDaysStats = calculateSevenDaysStats(
    allSessions,
    allBreaks,
    now,
    nowMs,
    true,
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
    const dateKey = sStartTime.toISOString().split("T")[0];

    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = {
        date: dateKey,
        dateHeader: formatHeaderDate(dateKey),
        totalFocusMinutes: 0,
        sessions: [],
      };
    }

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes = session.durationMinutes || 0;
    } else {
      sessionMinutes = Math.round((nowMs - sStartTime.getTime()) / 60000);
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
    const timeRange = `${formatTimeV2(sStartTime)} - ${
      session.endTime ? formatTimeV2(new Date(session.endTime)) : "Active"
    }`;

    groupedHistory[dateKey].totalFocusMinutes += netSessionMinutes;
    groupedHistory[dateKey].sessions.push({
      modeName: (session.modeId as any)?.name,
      startTime: session.startTime,
      endTime: session.endTime || null,
      timeRange,
      duration,
      status: session.status,
    });
  }

  const history = Object.values(groupedHistory).map((day: any) => ({
    ...day,
    totalFocusTimeFormatted: formatDuration(day.totalFocusMinutes).formatted,
  }));

  return {
    modes,
    summary: {
      totalFocusTime: formatDuration(totalMinutes),
      firstFocusDate,
      sinceDate,
    },
    sevenDaysStats,
    history,
  };
};

const getFocusStatsFromDB = async (userId: string) => {
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

  const startDate = firstSession ? firstSession.startTime : null;
  const endDate = lastSession ? lastSession.endTime || new Date() : null;

  return {
    totalSessions,
    totalFocusTime: formatDuration(totalMinutes),
    dateRange: {
      startDate,
      endDate,
    },
  };
};

const exportFocusHistoryToCSVFromDB = async (userId: string) => {
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
    const date = sStartTime.toISOString().split("T")[0];
    const modeName = (session.modeId as any)?.name || "Unknown Mode";

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes = session.durationMinutes || 0;
    } else {
      sessionMinutes = Math.round((nowMs - sStartTime.getTime()) / 60000);
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
    const timeRange = `${formatTime(sStartTime)} - ${
      session.endTime ? formatTime(new Date(session.endTime)) : "Active"
    }`;

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

export const FocusSessionService = {
  getFocusHistoryFromDB,
  getFocusHistoryV2FromDB,
  getFocusStatsFromDB,
  exportFocusHistoryToCSVFromDB,
  clearAllDataFromDB,
};
