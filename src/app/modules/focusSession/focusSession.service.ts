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

const getFocusHistoryFromDB = async (userId: string, modeId?: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const query: any = { userId: userObjectId };
  if (modeId) {
    query.modeId = new mongoose.Types.ObjectId(modeId);
  }

  const allSessions = await FocusSession.find(query);
  const allBreaks = await Break.find(query);

  let totalMinutes = 0;
  allSessions.forEach((s) => {
    if (s.status === "completed") {
      totalMinutes += s.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - s.startTime.getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  });

  allBreaks.forEach((b) => {
    if (b.status === "completed") {
      totalMinutes -= b.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - b.startTime.getTime();
      totalMinutes -= Math.round(diff / 60000);
    }
  });
  totalMinutes = Math.max(0, totalMinutes);

  const firstSession = await FocusSession.findOne({
    userId: userObjectId,
  }).sort({
    startTime: 1,
  });
  const firstFocusDate = firstSession ? firstSession.startTime : null;

  const sevenDaysStats = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const startOfDay = new Date(date);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dayName = date.toLocaleDateString("en-US", { weekday: "short" });

    const daySessions = await FocusSession.find({
      ...query,
      $or: [
        { startTime: { $gte: startOfDay, $lte: endOfDay } },
        { endTime: { $gte: startOfDay, $lte: endOfDay } },
        { status: "active", startTime: { $lte: endOfDay } },
      ],
    });

    const dayBreaks = await Break.find({
      ...query,
      $or: [
        { startTime: { $gte: startOfDay, $lte: endOfDay } },
        { endTime: { $gte: startOfDay, $lte: endOfDay } },
        { status: "active", startTime: { $lte: endOfDay } },
      ],
    });

    let dayMinutes = 0;
    daySessions.forEach((s) => {
      const sStart = s.startTime > startOfDay ? s.startTime : startOfDay;
      let sEnd = s.status === "active" ? new Date() : s.endTime || new Date();

      if (sEnd > endOfDay) sEnd = endOfDay;

      if (sEnd > sStart) {
        dayMinutes += Math.round((sEnd.getTime() - sStart.getTime()) / 60000);
      }
    });

    dayBreaks.forEach((b) => {
      const bStart = b.startTime > startOfDay ? b.startTime : startOfDay;
      let bEnd = b.status === "active" ? new Date() : b.endTime || new Date();

      if (bEnd > endOfDay) bEnd = endOfDay;

      if (bEnd > bStart) {
        dayMinutes -= Math.round((bEnd.getTime() - bStart.getTime()) / 60000);
      }
    });

    sevenDaysStats.push({
      day: dayName,
      date: date.toISOString().split("T")[0],
      totalMinutes: Math.max(0, dayMinutes),
      formatted: formatDuration(Math.max(0, dayMinutes)).formatted,
    });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const todaySessions = await FocusSession.find({
    ...query,
    $or: [
      { startTime: { $gte: startOfToday, $lte: endOfToday } },
      { status: "active" },
    ],
  }).populate("modeId");

  const todayBreaks = await Break.find({
    ...query,
    createdAt: { $gte: startOfToday, $lte: endOfToday },
  });

  const modeWiseToday: Record<string, number> = {};
  todaySessions.forEach((s: any) => {
    const modeName = s.modeId?.name || "Unknown Mode";
    if (!modeWiseToday[modeName]) {
      modeWiseToday[modeName] = 0;
    }
    if (s.status === "completed") {
      modeWiseToday[modeName] += s.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - s.startTime.getTime();
      modeWiseToday[modeName] += Math.round(diff / 60000);
    }
  });

  for (const b of todayBreaks) {
    const mode = await Mode.findById(b.modeId);
    const modeName = mode?.name || "Unknown Mode";
    if (modeWiseToday[modeName]) {
      const breakMin =
        b.status === "completed"
          ? b.durationMinutes || 0
          : Math.round((new Date().getTime() - b.startTime.getTime()) / 60000);
      modeWiseToday[modeName] = Math.max(0, modeWiseToday[modeName] - breakMin);
    }
  }

  const todayStats = Object.keys(modeWiseToday).map((mode) => ({
    mode,
    duration: formatDuration(modeWiseToday[mode]),
  }));

  const historyLogs = await FocusSession.find(query)
    .populate("modeId")
    .sort({ startTime: -1 });

  const groupedHistory: any = {};

  for (const session of historyLogs) {
    const dateKey = session.startTime.toISOString().split("T")[0];
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
      sessionMinutes = Math.round(
        (new Date().getTime() - session.startTime.getTime()) / 60000,
      );
    }

    const sessionBreaks = await Break.find({
      userId: userObjectId,
      modeId: session.modeId,
      startTime: { $gte: session.startTime },
      endTime:
        session.status === "completed"
          ? { $lte: session.endTime }
          : { $exists: true },
    });

    let sessionBreakMinutes = 0;
    sessionBreaks.forEach((b) => {
      if (b.status === "completed") {
        sessionBreakMinutes += b.durationMinutes || 0;
      } else {
        sessionBreakMinutes += Math.round(
          (new Date().getTime() - b.startTime.getTime()) / 60000,
        );
      }
    });

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const duration = formatDuration(netSessionMinutes);
    const timeRange = `${formatTime(session.startTime)} - ${
      session.endTime ? formatTime(session.endTime) : "Active"
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
    history,
  };
};

const getFocusHistoryV2FromDB = async (userId: string, modeId?: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  await ModeService.ensureDefaultModesExist(userId);

  const modes = await Mode.find({ userId: userObjectId, isDeleted: false }).select("_id name icon");

  const query: any = { userId: userObjectId };
  if (modeId) {
    query.modeId = new mongoose.Types.ObjectId(modeId);
  }

  const allSessions = await FocusSession.find(query);
  const allBreaks = await Break.find(query);

  let totalMinutes = 0;
  allSessions.forEach((s) => {
    if (s.status === "completed") {
      totalMinutes += s.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - s.startTime.getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  });

  allBreaks.forEach((b) => {
    if (b.status === "completed") {
      totalMinutes -= b.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - b.startTime.getTime();
      totalMinutes -= Math.round(diff / 60000);
    }
  });
  totalMinutes = Math.max(0, totalMinutes);

  const firstSession = await FocusSession.findOne({
    userId: userObjectId,
  }).sort({
    startTime: 1,
  });
  const firstFocusDate = firstSession ? firstSession.startTime : null;

  const formatSinceDate = (date: Date | null) => {
    if (!date) return "No focus history";
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    return `Since ${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  };
  const sinceDate = formatSinceDate(firstFocusDate);

  const sevenDaysStats = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const startOfDay = new Date(date);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
    const dayLabel = dayName[0]; // e.g. "M", "T", "W" etc.

    const daySessions = await FocusSession.find({
      ...query,
      $or: [
        { startTime: { $gte: startOfDay, $lte: endOfDay } },
        { endTime: { $gte: startOfDay, $lte: endOfDay } },
        { status: "active", startTime: { $lte: endOfDay } },
      ],
    });

    const dayBreaks = await Break.find({
      ...query,
      $or: [
        { startTime: { $gte: startOfDay, $lte: endOfDay } },
        { endTime: { $gte: startOfDay, $lte: endOfDay } },
        { status: "active", startTime: { $lte: endOfDay } },
      ],
    });

    let dayMinutes = 0;
    daySessions.forEach((s) => {
      const sStart = s.startTime > startOfDay ? s.startTime : startOfDay;
      let sEnd = s.status === "active" ? new Date() : s.endTime || new Date();

      if (sEnd > endOfDay) sEnd = endOfDay;

      if (sEnd > sStart) {
        dayMinutes += Math.round((sEnd.getTime() - sStart.getTime()) / 60000);
      }
    });

    dayBreaks.forEach((b) => {
      const bStart = b.startTime > startOfDay ? b.startTime : startOfDay;
      let bEnd = b.status === "active" ? new Date() : b.endTime || new Date();

      if (bEnd > endOfDay) bEnd = endOfDay;

      if (bEnd > bStart) {
        dayMinutes -= Math.round((bEnd.getTime() - bStart.getTime()) / 60000);
      }
    });

    const maxDayMinutes = Math.max(0, dayMinutes);
    sevenDaysStats.push({
      day: dayName,
      dayLabel,
      date: date.toISOString().split("T")[0],
      totalMinutes: maxDayMinutes,
      formatted: formatDuration(maxDayMinutes).formatted,
    });
  }

  const historyLogs = await FocusSession.find(query)
    .populate("modeId")
    .sort({ startTime: -1 });

  const groupedHistory: any = {};

  const formatTimeV2 = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatHeaderDate = (dateStr: string) => {
    const todayStr = new Date().toISOString().split("T")[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    if (dateStr === todayStr) {
      return "TODAY";
    }
    if (dateStr === yesterdayStr) {
      return "YESTERDAY";
    }

    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
  };

  for (const session of historyLogs) {
    const dateKey = session.startTime.toISOString().split("T")[0];
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
      sessionMinutes = Math.round(
        (new Date().getTime() - session.startTime.getTime()) / 60000,
      );
    }

    const sessionBreaks = await Break.find({
      userId: userObjectId,
      modeId: session.modeId,
      startTime: { $gte: session.startTime },
      endTime:
        session.status === "completed"
          ? { $lte: session.endTime }
          : { $exists: true },
    });

    let sessionBreakMinutes = 0;
    sessionBreaks.forEach((b) => {
      if (b.status === "completed") {
        sessionBreakMinutes += b.durationMinutes || 0;
      } else {
        sessionBreakMinutes += Math.round(
          (new Date().getTime() - b.startTime.getTime()) / 60000,
        );
      }
    });

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const duration = formatDuration(netSessionMinutes);
    const timeRange = `${formatTimeV2(session.startTime)} - ${
      session.endTime ? formatTimeV2(session.endTime) : "Active"
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

  const totalSessions = await FocusSession.countDocuments({
    userId: userObjectId,
  });

  const allSessions = await FocusSession.find({ userId: userObjectId });
  const allBreaks = await Break.find({ userId: userObjectId });

  let totalMinutes = 0;
  allSessions.forEach((s) => {
    if (s.status === "completed") {
      totalMinutes += s.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - s.startTime.getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  });

  allBreaks.forEach((b) => {
    if (b.status === "completed") {
      totalMinutes -= b.durationMinutes || 0;
    } else {
      const diff = new Date().getTime() - b.startTime.getTime();
      totalMinutes -= Math.round(diff / 60000);
    }
  });
  totalMinutes = Math.max(0, totalMinutes);

  const firstSession = await FocusSession.findOne({
    userId: userObjectId,
  }).sort({
    startTime: 1,
  });
  const lastSession = await FocusSession.findOne({ userId: userObjectId }).sort(
    {
      startTime: -1,
    },
  );

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

  const sessions = await FocusSession.find({ userId: userObjectId })
    .populate("modeId")
    .sort({ startTime: -1 });

  let csvContent = "\ufeffDate,Mode,Time Range,Duration,Status\n";

  for (const session of sessions) {
    const date = session.startTime.toISOString().split("T")[0];
    const modeName = (session.modeId as any)?.name || "Unknown Mode";

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes = session.durationMinutes || 0;
    } else {
      sessionMinutes = Math.round(
        (new Date().getTime() - session.startTime.getTime()) / 60000,
      );
    }

    const sessionBreaks = await Break.find({
      userId: userObjectId,
      modeId: session.modeId,
      startTime: { $gte: session.startTime },
      endTime:
        session.status === "completed"
          ? { $lte: session.endTime }
          : { $exists: true },
    });

    let sessionBreakMinutes = 0;
    sessionBreaks.forEach((b) => {
      if (b.status === "completed") {
        sessionBreakMinutes += b.durationMinutes || 0;
      } else {
        sessionBreakMinutes += Math.round(
          (new Date().getTime() - b.startTime.getTime()) / 60000,
        );
      }
    });

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const durationFormatted = formatDuration(netSessionMinutes).formatted;
    const timeRange = `${formatTime(session.startTime)} - ${
      session.endTime ? formatTime(session.endTime) : "Active"
    }`;

    const escapedModeName = `"${modeName.replace(/"/g, '""')}"`;

    csvContent += `${date},${escapedModeName},${timeRange},${durationFormatted},${session.status}\n`;
  }

  return csvContent;
};

const clearAllDataFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  await FocusSession.updateMany(
    { userId: userObjectId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), status: "completed" } },
  );

  await Mode.updateMany(
    { userId: userObjectId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), isActive: false } },
  );

  await Break.updateMany(
    { userId: userObjectId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), status: "completed" } },
  );

  await BreakConfig.updateMany(
    { userId: userObjectId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date() } },
  );

  return { message: "All data cleared successfully" };
};

export const FocusSessionService = {
  getFocusHistoryFromDB,
  getFocusHistoryV2FromDB,
  getFocusStatsFromDB,
  exportFocusHistoryToCSVFromDB,
  clearAllDataFromDB,
};
