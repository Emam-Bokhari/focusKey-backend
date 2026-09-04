import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Mode } from "../modes/modes.model";
import { Break, BreakConfig } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Friend, Nudge, NudgePreview } from "../friends/friends.model";
import {
  DEFAULT_TIMEZONE,
  formatZonedDateKey,
  formatZonedSinceDate,
  formatZonedTimeRange,
  getZonedDateGroupHeader,
  getZonedEndOfDay,
  getZonedStartOfDay,
  getZonedStartOfWeek,
} from "../../../helpers/timezoneHelper";

const getDashboardData = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
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

  const startOfDay = getZonedStartOfDay(new Date(), userTimezone);
  const endOfDay = getZonedEndOfDay(new Date(), userTimezone);

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
      { status: { $in: ["active", "paused"] } },
    ],
  });

  const todayNudgeBreaks = await Break.find({
    userId: userObjectId,
    nudgeId: { $exists: true },
    $or: [
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      { status: { $in: ["active", "paused"] } },
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
    } else if (breakItem.status === "paused") {
      const totalSec = (breakItem.totalDurationMinutes || 15) * 60;
      const spentSec = Math.max(
        0,
        totalSec - (breakItem.remainingSeconds || 0),
      );
      todayFocusMinutes -= Math.round(spentSec / 60);
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      todayFocusMinutes -= Math.round(durationMs / 60000);
    }
  });
  todayFocusMinutes = Math.max(0, todayFocusMinutes);

  const startOfWeek = getZonedStartOfWeek(new Date(), userTimezone);

  const weekSessions = await FocusSession.find({
    userId: userObjectId,
    startTime: { $gte: startOfWeek },
  });

  const weekBreaks = await Break.find({
    userId: userObjectId,
    $or: [
      { createdAt: { $gte: startOfWeek } },
      { status: { $in: ["active", "paused"] } },
    ],
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
    } else if (breakItem.status === "paused") {
      const totalSec = (breakItem.totalDurationMinutes || 15) * 60;
      const spentSec = Math.max(
        0,
        totalSec - (breakItem.remainingSeconds || 0),
      );
      weekFocusMinutes -= Math.round(spentSec / 60);
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

  const currentGlobalBreak = await Break.findOne({
    userId: userObjectId,
    nudgeId: { $exists: false },
    status: { $in: ["active", "paused"] },
    $or: [
      { status: "active", endTime: { $gt: new Date() } },
      { status: "paused" },
    ],
  });

  if (currentGlobalBreak) {
    if (currentGlobalBreak.status === "paused") {
      activeBreakRemainingMinutes = Math.max(
        0,
        Math.ceil((currentGlobalBreak.remainingSeconds || 0) / 60),
      );
    } else {
      const remainingTimeMs =
        currentGlobalBreak.endTime.getTime() - new Date().getTime();
      activeBreakRemainingMinutes = Math.max(
        0,
        Math.ceil(remainingTimeMs / 60000),
      );
    }
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
      const hasLockedApps =
        activeMode.lockedApps && activeMode.lockedApps.length > 0;
      return {
        ...activeMode.toObject(),
        lockedApps: filteredLockedApps,
        totalLockedApps: hasLockedApps
          ? filteredLockedApps.length
          : (activeMode.totalLockedApps ?? 0),
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
      activeBreak: currentGlobalBreak
        ? {
            ...currentGlobalBreak.toObject(),
            isPaused: currentGlobalBreak.status === "paused",
            remainingMinutes: activeBreakRemainingMinutes,
            remainingSeconds:
              currentGlobalBreak.status === "paused"
                ? currentGlobalBreak.remainingSeconds || 0
                : Math.max(
                    0,
                    Math.ceil(
                      (currentGlobalBreak.endTime.getTime() -
                        new Date().getTime()) /
                        1000,
                    ),
                  ),
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
    totalBlockedApps:
      activeMode?.totalLockedApps ?? activeMode?.lockedApps?.length ?? 0,
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

const getHistoryData = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [allSessions, allBreaks] = await Promise.all([
    FocusSession.find({ userId: userObjectId, isDeleted: false })
      .populate("modeId")
      .sort({ startTime: -1 })
      .lean(),
    Break.find({ userId: userObjectId, isDeleted: false }).lean(),
  ]);

  const now = new Date();
  const nowMs = now.getTime();

  let totalMinutes = 0;
  for (const s of allSessions) {
    if (s.status === "completed") {
      totalMinutes +=
        s.durationMinutes ||
        (s.endTime
          ? Math.round(
              (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) /
                60000,
            )
          : 0);
    } else {
      const diff = nowMs - new Date(s.startTime).getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  }

  for (const b of allBreaks) {
    if (b.status === "completed") {
      totalMinutes -=
        b.durationMinutes ||
        (b.endTime
          ? Math.round(
              (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) /
                60000,
            )
          : 0);
    } else {
      const diff = nowMs - new Date(b.startTime).getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  }
  totalMinutes = Math.max(0, totalMinutes);

  const startOfDay = getZonedStartOfDay(now, userTimezone);
  const startOfDayMs = startOfDay.getTime();
  const endOfDay = getZonedEndOfDay(now, userTimezone);
  const endOfDayMs = endOfDay.getTime();

  const modeWiseToday: Record<string, number> = {};
  for (const s of allSessions) {
    const sStartMs = new Date(s.startTime).getTime();
    const isActive = s.status === "active";
    const isToday =
      (sStartMs >= startOfDayMs && sStartMs <= endOfDayMs) || isActive;

    if (isToday) {
      const modeName = (s.modeId as any)?.name || "Unknown Mode";
      if (!modeWiseToday[modeName]) {
        modeWiseToday[modeName] = 0;
      }
      if (s.status === "completed") {
        modeWiseToday[modeName] +=
          s.durationMinutes ||
          (s.endTime
            ? Math.round(
                (new Date(s.endTime).getTime() - sStartMs) / 60000,
              )
            : 0);
      } else {
        const diff = nowMs - sStartMs;
        modeWiseToday[modeName] += Math.round(diff / 60000);
      }
    }
  }

  for (const b of allBreaks) {
    const bCreatedMs = new Date(b.createdAt || b.startTime).getTime();
    if (bCreatedMs >= startOfDayMs && bCreatedMs <= endOfDayMs) {
      const modeName = (b.modeId as any)?.name || "Unknown Mode";
      if (modeWiseToday[modeName]) {
        const breakMin =
          b.status === "completed"
            ? b.durationMinutes ||
              (b.endTime
                ? Math.round(
                    (new Date(b.endTime).getTime() -
                      new Date(b.startTime).getTime()) /
                      60000,
                  )
                : 0)
            : Math.round((nowMs - new Date(b.startTime).getTime()) / 60000);
        modeWiseToday[modeName] = Math.max(
          0,
          modeWiseToday[modeName] - breakMin,
        );
      }
    }
  }

  const breaksByMode = new Map<string, any[]>();
  for (const b of allBreaks) {
    const mId = (b.modeId?._id || b.modeId)?.toString();
    if (mId) {
      let list = breaksByMode.get(mId);
      if (!list) {
        list = [];
        breaksByMode.set(mId, list);
      }
      list.push(b);
    }
  }

  const groupedHistory: any = {};

  for (const session of allSessions) {
    const sStartTime = new Date(session.startTime);
    const dateKey = formatZonedDateKey(sStartTime, userTimezone); // YYYY-MM-DD
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
              (new Date(session.endTime).getTime() - sStartTime.getTime()) /
                60000,
            )
          : 0);
    } else {
      sessionMinutes = Math.round((nowMs - sStartTime.getTime()) / 60000);
    }

    const sModeId = (session.modeId as any)?._id
      ? (session.modeId as any)._id.toString()
      : session.modeId?.toString();

    const candidateBreaks = sModeId ? breaksByMode.get(sModeId) || [] : [];
    const sStartMs = sStartTime.getTime();
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

      if (b.status === "completed") {
        sessionBreakMinutes += b.durationMinutes || 0;
      } else {
        sessionBreakMinutes += Math.round((nowMs - bStartMs) / 60000);
      }
    }

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

const getHistoryV2 = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [allSessions, allBreaks, user] = await Promise.all([
    FocusSession.find({ userId: userObjectId, isDeleted: false })
      .populate("modeId")
      .sort({ startTime: -1 })
      .lean(),
    Break.find({ userId: userObjectId, isDeleted: false }).lean(),
    User.findById(userId).select("createdAt").lean(),
  ]);

  const now = new Date();
  const nowMs = now.getTime();

  let totalMinutes = 0;
  for (const s of allSessions) {
    if (s.status === "completed") {
      totalMinutes +=
        s.durationMinutes ||
        (s.endTime
          ? Math.round(
              (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) /
                60000,
            )
          : 0);
    } else {
      const diff = nowMs - new Date(s.startTime).getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  }

  for (const b of allBreaks) {
    if (b.status === "completed") {
      totalMinutes -=
        b.durationMinutes ||
        (b.endTime
          ? Math.round(
              (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) /
                60000,
            )
          : 0);
    } else {
      const diff = nowMs - new Date(b.startTime).getTime();
      totalMinutes += Math.round(diff / 60000);
    }
  }
  totalMinutes = Math.max(0, totalMinutes);

  const sinceDate = formatZonedSinceDate(
    user?.createdAt || now,
    userTimezone,
  );

  const breaksByMode = new Map<string, any[]>();
  for (const b of allBreaks) {
    const mId = (b.modeId?._id || b.modeId)?.toString();
    if (mId) {
      let list = breaksByMode.get(mId);
      if (!list) {
        list = [];
        breaksByMode.set(mId, list);
      }
      list.push(b);
    }
  }

  const groupedHistory: any = {};

  for (const session of allSessions) {
    const sStartTime = new Date(session.startTime);
    const dateKey = formatZonedDateKey(sStartTime, userTimezone); // YYYY-MM-DD
    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = {
        dateGroup: getZonedDateGroupHeader(dateKey, userTimezone),
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
              (new Date(session.endTime).getTime() - sStartTime.getTime()) /
                60000,
            )
          : 0);
    } else {
      sessionMinutes = Math.round((nowMs - sStartTime.getTime()) / 60000);
    }

    const sModeId = (session.modeId as any)?._id
      ? (session.modeId as any)._id.toString()
      : session.modeId?.toString();

    const candidateBreaks = sModeId ? breaksByMode.get(sModeId) || [] : [];
    const sStartMs = sStartTime.getTime();
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

      if (b.status === "completed") {
        sessionBreakMinutes += b.durationMinutes || 0;
      } else {
        sessionBreakMinutes += Math.round((nowMs - bStartMs) / 60000);
      }
    }

    const netSessionMinutes = Math.max(0, sessionMinutes - sessionBreakMinutes);
    const durationObj = formatDuration(netSessionMinutes);
    const duration = `${durationObj.hours}h ${durationObj.minutes}m`;
    const timeRange = formatZonedTimeRange(
      sStartTime,
      session.endTime,
      userTimezone,
      true,
    );

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
      (a: any, b: any) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
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
        event:
          nudge.status === "completed"
            ? "Joint session completed"
            : "Joint session joined",
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