import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Mode } from "../modes/modes.model";
import { Break } from "../breaks/breaks.model";
import { FocusSession } from "../focusSession/focusSession.model";

const getDashboardData = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Get User Info
  const user = await User.findById(userId).select("name email phone countryCode profileImage");

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
      { status: "active" } // Include currently active session
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

  // 6. Focus Time Stats (This Week)
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const weekSessions = await FocusSession.find({
    userId: userObjectId,
    startTime: { $gte: startOfWeek },
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

  // 7. Break Stats
  let breaksTakenToday = 0;
  let remainingBreaksToday = 0;
  let activeBreakRemainingMinutes = 0;

  if (activeMode) {
    breaksTakenToday = await Break.countDocuments({
      userId: userObjectId,
      modeId: activeMode._id,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });
    remainingBreaksToday = Math.max(0, activeMode.breakConfig.breaksPerDay - breaksTakenToday);
  }

  if (activeBreak) {
    const remainingTimeMs = activeBreak.endTime.getTime() - new Date().getTime();
    activeBreakRemainingMinutes = Math.max(0, Math.ceil(remainingTimeMs / 60000));
  }

  // 8. Total Blocked Apps (Across all modes for this user)
  const allModes = await Mode.find({ userId: userObjectId, isDeleted: false });
  const totalBlockedAppsAcrossModes = allModes.reduce((acc, mode) => acc + (mode.lockedApps?.length || 0), 0);

  return {
    user,
    lockStatus: {
      isLocked,
      activeModeName: activeMode?.name || null,
      // activeModeId: activeMode?._id || null,
    },
    activeMode: activeMode ? {
        ...activeMode.toObject(),
        isLocked // Include the lock status in mode data too
    } : null,
    focusStats: {
      todayMinutes: todayFocusMinutes,
      weekMinutes: weekFocusMinutes,
    },
    breakStats: {
      takenToday: breaksTakenToday,
      remainingToday: remainingBreaksToday,
      activeBreak: activeBreak ? {
          ...activeBreak.toObject(),
          remainingMinutes: activeBreakRemainingMinutes
      } : null
    },
    totalBlockedApps: activeMode?.lockedApps?.length || 0,
    totalBlockedAppsAcrossModes
  };
};

export const DashboardService = {
  getDashboardData,
};
