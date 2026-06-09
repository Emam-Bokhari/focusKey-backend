import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Mode } from "../modes/modes.model";
import { Break, BreakConfig } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";

const getDashboardData = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Get User Info
  const user = await User.findById(userId).select(
    "name email phone countryCode profileImage",
  );

  // 2. Get Active Mode
  const activeMode = await Mode.findOne({
    userId: userObjectId,
    isActive: true,
    isDeleted: false,
  });

  // 3. Check for Active Break
  const activeBreak = await Break.findOne({
    userId: userObjectId,
    status: "active",
    endTime: { $gt: new Date() },
  });

  // 4. Calculate Lock Status
  const isLocked = activeMode ? !activeBreak : false;

  // 5. Focus Time Stats (Today)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const todaySessions = await FocusSession.find({
    userId: userObjectId,
    $or: [
      { startTime: { $gte: startOfDay, $lte: endOfDay } },
      { status: "active" }, // Include currently active session
    ],
  });

  const todayBreaks = await Break.find({
    userId: userObjectId,
    $or: [
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      { status: "active" },
    ],
  });

  let todayFocusMinutes = 0;
  todaySessions.forEach((session) => {
    if (session.status === "completed") {
      todayFocusMinutes += session.durationMinutes || 0;
    } else {
      // For active session, calculate duration up to now
      const durationMs = new Date().getTime() - session.startTime.getTime();
      todayFocusMinutes += Math.round(durationMs / 60000);
    }
  });

  // Subtract today's break time
  todayBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      todayFocusMinutes -= breakItem.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      todayFocusMinutes -= Math.round(durationMs / 60000);
    }
  });
  todayFocusMinutes = Math.max(0, todayFocusMinutes);

  // 6. Focus Time Stats (This Week)
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const weekSessions = await FocusSession.find({
    userId: userObjectId,
    startTime: { $gte: startOfWeek },
  });

  const weekBreaks = await Break.find({
    userId: userObjectId,
    createdAt: { $gte: startOfWeek },
  });

  let weekFocusMinutes = 0;
  weekSessions.forEach((session) => {
    if (session.status === "completed") {
      weekFocusMinutes += session.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - session.startTime.getTime();
      weekFocusMinutes += Math.round(durationMs / 60000);
    }
  });

  // Subtract this week's break time
  weekBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      weekFocusMinutes -= breakItem.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      weekFocusMinutes -= Math.round(durationMs / 60000);
    }
  });
  weekFocusMinutes = Math.max(0, weekFocusMinutes);

  // 7. Break Stats
  let breaksTakenToday = 0;
  let remainingBreaksToday = 0;
  let activeBreakRemainingMinutes = 0;

  // Get global break config (explicitly bypass soft-delete filter to find existing record)
  let breakConfig = await BreakConfig.findOne({
    userId: userObjectId,
    isDeleted: { $in: [true, false] },
  });

  if (!breakConfig) {
    breakConfig = await BreakConfig.create({
      userId: userObjectId,
      breaksPerDay: 4,
      breakDurationMinutes: 15,
    });
  } else if (breakConfig.isDeleted) {
    // Restore if soft-deleted to avoid duplicate key error
    breakConfig.isDeleted = false;
    //@ts-ignore
    breakConfig.deletedAt = null;
    await breakConfig.save();
  }

  breaksTakenToday = await Break.countDocuments({
    userId: userObjectId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
  remainingBreaksToday = Math.max(
    0,
    breakConfig.breaksPerDay - breaksTakenToday,
  );

  if (activeBreak) {
    const remainingTimeMs =
      activeBreak.endTime.getTime() - new Date().getTime();
    activeBreakRemainingMinutes = Math.max(
      0,
      Math.ceil(remainingTimeMs / 60000),
    );
  }

  // 8. Total Blocked Apps (Across all modes for this user)
  const allModes = await Mode.find({ userId: userObjectId, isDeleted: false });
  const totalBlockedAppsAcrossModes = allModes.reduce(
    (acc, mode) => acc + (mode.lockedApps?.length || 0),
    0,
  );

  return {
    user,
    lockStatus: {
      isLocked,
      activeModeName: activeMode?.name || null,
      // activeModeId: activeMode?._id || null,
    },
    activeMode: activeMode
      ? {
          ...activeMode.toObject(),
          isLocked, // Include the lock status in mode data too
        }
      : null,
    focusStats: {
      todayMinutes: todayFocusMinutes,
      weekMinutes: weekFocusMinutes,
    },
    breakStats: {
      takenToday: breaksTakenToday,
      remainingToday: remainingBreaksToday,
      activeBreak: activeBreak
        ? {
            ...activeBreak.toObject(),
            remainingMinutes: activeBreakRemainingMinutes,
          }
        : null,
    },
    totalBlockedApps: activeMode?.lockedApps?.length || 0,
    totalBlockedAppsAcrossModes,
  };
};

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

const getHistoryData = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Total Focus Time (All Time)
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

  // 2. Mode-wise Today Focus Time
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const todaySessions = await FocusSession.find({
    userId: userObjectId,
    $or: [
      { startTime: { $gte: startOfDay, $lte: endOfDay } },
      { status: "active" },
    ],
  }).populate("modeId");

  const todayBreaks = await Break.find({
    userId: userObjectId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });

  const modeWiseToday: any = {};
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

  // Subtract today's breaks from mode-wise today focus time
  // Note: This is simplified; assumes breaks belong to the mode they were taken in
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

  // 3. Date-wise Detailed History
  const historyLogs = await FocusSession.find({ userId: userObjectId })
    .populate("modeId")
    .sort({ startTime: -1 });

  const groupedHistory: any = {};

  for (const session of historyLogs) {
    const dateKey = session.startTime.toISOString().split("T")[0]; // YYYY-MM-DD
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

    // Find breaks within this session's time range to subtract
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

  // Format grouped history for response
  const history = Object.values(groupedHistory).map((day: any) => ({
    ...day,
    totalFocusTimeFormatted: formatDuration(day.totalFocusMinutes).formatted,
  }));

  return {
    summary: {
      totalFocusTime: formatDuration(totalMinutes),
    },
    // todayStats: Object.keys(modeWiseToday).map((mode) => ({
    //   mode,
    //   duration: formatDuration(modeWiseToday[mode]),
    // })),
    history,
  };
};

export const DashboardService = {
  getDashboardData,
  getHistoryData,
};
