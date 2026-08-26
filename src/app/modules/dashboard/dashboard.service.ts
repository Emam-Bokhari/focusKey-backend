import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Mode } from "../modes/modes.model";
import { Break, BreakConfig } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Friend, Nudge, NudgePreview } from "../friends/friends.model";

const getDashboardData = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const user = await User.findById(userId).select(
    "name email phone countryCode profileImage installedApps",
  );

  const activeSession = await FocusSession.findOne({
    userId: userObjectId,
    status: "active",
  }).populate("modeId");

  const activeMode = activeSession
    ? (activeSession.modeId as any)
    : await Mode.findOne({
        userId: userObjectId,
        isActive: true,
        isDeleted: false,
      });

  const activeBreak = await Break.findOne({
    userId: userObjectId,
    nudgeId: { $exists: false },
    status: "active",
    endTime: { $gt: new Date() },
  });

  const activeNudgeBreak = await Break.findOne({
    userId: userObjectId,
    nudgeId: { $exists: true },
    status: "active",
    endTime: { $gt: new Date() },
  });

  const isLocked = activeMode ? !(activeBreak || activeNudgeBreak) : false;

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

  const todayGlobalBreaks = await Break.find({
    userId: userObjectId,
    nudgeId: { $exists: false },
    $or: [
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      { status: "active" },
    ],
  });

  const todayNudgeBreaks = await Break.find({
    userId: userObjectId,
    nudgeId: { $exists: true },
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
      const durationMs = new Date().getTime() - session.startTime.getTime();
      todayFocusMinutes += Math.round(durationMs / 60000);
    }
  });

  const allTodayBreaks = [...todayGlobalBreaks, ...todayNudgeBreaks];
  allTodayBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      todayFocusMinutes -= breakItem.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      todayFocusMinutes -= Math.round(durationMs / 60000);
    }
  });
  todayFocusMinutes = Math.max(0, todayFocusMinutes);

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

  weekBreaks.forEach((breakItem) => {
    if (breakItem.status === "completed") {
      weekFocusMinutes -= breakItem.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      weekFocusMinutes -= Math.round(durationMs / 60000);
    }
  });
  weekFocusMinutes = Math.max(0, weekFocusMinutes);

  let breaksTakenToday = 0;
  let remainingBreaksToday = 0;
  let activeBreakRemainingMinutes = 0;

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
    breakConfig.isDeleted = false;
    //@ts-ignore
    breakConfig.deletedAt = null;
    await breakConfig.save();
  }

  breaksTakenToday = await Break.countDocuments({
    userId: userObjectId,
    nudgeId: { $exists: false },
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

  const allModes = await Mode.find({ userId: userObjectId, isDeleted: false });
  const totalBlockedAppsAcrossModes = allModes.reduce(
    (acc, mode) => acc + (mode.totalLockedApps ?? mode.lockedApps?.length ?? 0),
    0,
  );

  return {
    user,
    lockStatus: {
      isLocked,
      activeModeName: activeMode?.name || null,
    },
    activeMode: (() => {
      if (!activeMode) return null;
      const installedAppPackages = new Set(
        (user?.installedApps || []).map((app) => app.packageName),
      );
      const filteredLockedApps = (activeMode.lockedApps || []).filter(
        (app: any) => installedAppPackages.has(app.packageName),
      );
      const hasLockedApps = activeMode.lockedApps && activeMode.lockedApps.length > 0;
      return {
        ...activeMode.toObject(),
        lockedApps: filteredLockedApps,
        totalLockedApps: hasLockedApps ? filteredLockedApps.length : (activeMode.totalLockedApps ?? 0),
        isLocked,
      };
    })(),
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
      activeNudgeBreak: activeNudgeBreak
        ? {
            ...activeNudgeBreak.toObject(),
            remainingMinutes: Math.max(
              0,
              Math.ceil(
                (activeNudgeBreak.endTime.getTime() - new Date().getTime()) /
                  60000,
              ),
            ),
          }
        : null,
    },
    totalBlockedApps: activeMode?.totalLockedApps ?? activeMode?.lockedApps?.length ?? 0,
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

  const allSessions = await FocusSession.find({ userId: userObjectId });
  const allBreaks = await Break.find({ userId: userObjectId });

  let totalMinutes = 0;
  allSessions.forEach((s) => {
    if (s.status === "completed") {
      totalMinutes +=
        s.durationMinutes ||
        (s.endTime
          ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60000)
          : 0);
    } else {
      const diff = new Date().getTime() - s.startTime.getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  });

  allBreaks.forEach((b) => {
    if (b.status === "completed") {
      totalMinutes -=
        b.durationMinutes ||
        (b.endTime
          ? Math.round((b.endTime.getTime() - b.startTime.getTime()) / 60000)
          : 0);
    } else {
      const diff = new Date().getTime() - b.startTime.getTime();
      totalMinutes -= Math.round(diff / 60000);
    }
  });
  totalMinutes = Math.max(0, totalMinutes);

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
      modeWiseToday[modeName] +=
        s.durationMinutes ||
        (s.endTime
          ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60000)
          : 0);
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
          ? b.durationMinutes ||
            (b.endTime
              ? Math.round(
                  (b.endTime.getTime() - b.startTime.getTime()) / 60000,
                )
              : 0)
          : Math.round((new Date().getTime() - b.startTime.getTime()) / 60000);
      modeWiseToday[modeName] = Math.max(0, modeWiseToday[modeName] - breakMin);
    }
  }

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
      sessionMinutes =
        session.durationMinutes ||
        (session.endTime
          ? Math.round(
              (session.endTime.getTime() - session.startTime.getTime()) / 60000,
            )
          : 0);
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
    },
    history,
  };
};

const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateGroupHeader = (dateStr: string) => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const todayStr = getLocalDateKey(today);
  const yesterdayStr = getLocalDateKey(yesterday);

  if (dateStr === todayStr) {
    return "TODAY";
  } else if (dateStr === yesterdayStr) {
    return "YESTERDAY";
  } else {
    const [year, month, day] = dateStr.split("-").map(Number);
    const months = [
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
    return `${months[month - 1]} ${day}`;
  }
};

const formatTimeV2 = (date: Date) => {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const getHistoryV2 = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const allSessions = await FocusSession.find({ userId: userObjectId });
  const allBreaks = await Break.find({ userId: userObjectId });

  let totalMinutes = 0;
  allSessions.forEach((s) => {
    if (s.status === "completed") {
      totalMinutes +=
        s.durationMinutes ||
        (s.endTime
          ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60000)
          : 0);
    } else {
      const diff = new Date().getTime() - s.startTime.getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  });

  allBreaks.forEach((b) => {
    if (b.status === "completed") {
      totalMinutes -=
        b.durationMinutes ||
        (b.endTime
          ? Math.round((b.endTime.getTime() - b.startTime.getTime()) / 60000)
          : 0);
    } else {
      const diff = new Date().getTime() - b.startTime.getTime();
      totalMinutes -= Math.round(diff / 60000);
    }
  });
  totalMinutes = Math.max(0, totalMinutes);

  const user = await User.findById(userId).select("createdAt");
  let sinceDate = "";
  if (user && user.createdAt) {
    sinceDate = `Since ${user.createdAt.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`;
  } else {
    sinceDate = `Since ${new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`;
  }

  const historyLogs = await FocusSession.find({ userId: userObjectId })
    .populate("modeId")
    .sort({ startTime: -1 });

  const groupedHistory: any = {};

  for (const session of historyLogs) {
    const dateKey = getLocalDateKey(session.startTime); // YYYY-MM-DD
    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = {
        dateGroup: getDateGroupHeader(dateKey),
        rawDate: dateKey,
        sessions: [],
      };
    }

    let sessionMinutes = 0;
    if (session.status === "completed") {
      sessionMinutes =
        session.durationMinutes ||
        (session.endTime
          ? Math.round(
              (session.endTime.getTime() - session.startTime.getTime()) / 60000,
            )
          : 0);
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
    const durationObj = formatDuration(netSessionMinutes);
    const duration = `${durationObj.hours}h ${durationObj.minutes}m`;
    const timeRange = `${formatTimeV2(session.startTime)} – ${
      session.endTime ? formatTimeV2(session.endTime) : "Active"
    }`;

    groupedHistory[dateKey].sessions.push({
      modeName: (session.modeId as any)?.name || "Unknown Mode",
      startTime: session.startTime,
      timeRange,
      duration,
      status: session.status,
    });
  }

  const sortedDates = Object.keys(groupedHistory).sort((a, b) =>
    b.localeCompare(a),
  );

  const history = sortedDates.map((dateKey) => {
    const group = groupedHistory[dateKey];
    group.sessions.sort(
      (a: any, b: any) => a.startTime.getTime() - b.startTime.getTime(),
    );
    const cleanSessions = group.sessions.map(
      ({ startTime, ...rest }: any) => rest,
    );

    return {
      dateGroup: group.dateGroup,
      sessions: cleanSessions,
    };
  });

  const totalFocusTimeObj = formatDuration(totalMinutes);
  const totalFocusTime = `${totalFocusTimeObj.hours}h ${totalFocusTimeObj.minutes}m`;

  return {
    totalFocusTime,
    sinceDate,
    history,
  };
};

const getAdminDashboardData = async () => {
  // 1. Social Activity Data (Friend, Nudge, NudgePreview)
  const recentFriends = await Friend.find({ status: "accepted" })
    .sort({ updatedAt: -1 })
    .limit(5)
    .populate({
      path: "userId friendId",
      select: "name email profileImage",
    });

  const recentNudgePreviews = await NudgePreview.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate({
      path: "creatorId",
      select: "name email profileImage",
    });

  const recentNudges = await Nudge.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .populate({
      path: "creatorId",
      select: "name email profileImage",
    });

  // 2. Map to unified format
  const activities: any[] = [];

  recentFriends.forEach((friend: any) => {
    if (friend.userId && friend.friendId) {
      activities.push({
        user: {
          name: friend.userId.name,
          email: friend.userId.email,
          profileImage: friend.userId.profileImage || null,
        },
        event: "Partner request accepted",
        time: friend.updatedAt || friend.createdAt,
        status: "Completed",
      });
    }
  });

  recentNudgePreviews.forEach((preview: any) => {
    if (preview.creatorId) {
      activities.push({
        user: {
          name: preview.creatorId.name,
          email: preview.creatorId.email,
          profileImage: preview.creatorId.profileImage || null,
        },
        event: "Nudge sent",
        time: preview.createdAt,
        status: preview.status === "confirmed" ? "Completed" : "Sent",
      });
    }
  });

  recentNudges.forEach((nudge: any) => {
    if (nudge.creatorId) {
      activities.push({
        user: {
          name: nudge.creatorId.name,
          email: nudge.creatorId.email,
          profileImage: nudge.creatorId.profileImage || null,
        },
        event: nudge.status === "completed" ? "Joint session completed" : "Joint session joined",
        time: nudge.updatedAt || nudge.createdAt,
        status: nudge.status === "completed" ? "Completed" : "Active",
      });
    }
  });

  const sortedActivities = activities
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 5);

  return sortedActivities;
};

export const DashboardService = {
  getDashboardData,
  getHistoryData,
  getHistoryV2,
  getAdminDashboardData,
};
