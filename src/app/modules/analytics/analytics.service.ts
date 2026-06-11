import { User } from "../user/user.model";
import { FocusSession } from "../focusSession/focusSession.model";

const getStatsFromDB = async () => {
  // Calculate date ranges
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // total Users
  const totalUsers = await User.countDocuments({ isDeleted: false });

  // activated Users (verified)
  const activatedUsers = await User.countDocuments({ verified: true, isDeleted: false });

  // 7-Day Active Users (users who logged in in last 7 days)
  const sevenDayActiveUsers = await User.countDocuments({
    lastLoginAt: { $gte: sevenDaysAgo },
    isDeleted: false,
  });

  // total Focus Sessions This Week
  const totalFocusSessionsThisWeek = await FocusSession.countDocuments({
    startTime: { $gte: startOfWeek },
    isDeleted: false,
  });

  return {
    totalUsers,
    activatedUsers,
    sevenDayActiveUsers,
    totalFocusSessionsThisWeek,
  };
};

const getFocusTimeOverTime = async (year?: number, days?: number) => {
  const currentYear = new Date().getFullYear();
  const targetYear = year || currentYear;
  const targetDays = days || 7;

  // Validate days
  const validDays = [7, 14, 30];
  const actualDays = validDays.includes(targetDays) ? targetDays : 7;

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (actualDays - 1));
  startDate.setHours(0, 0, 0, 0);

  // Filter for the target year
  const startOfYear = new Date(targetYear, 0, 1);
  const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

  // Get all sessions in the date range
  const sessions = await FocusSession.find({
    startTime: {
      $gte: startDate > startOfYear ? startDate : startOfYear,
      $lte: endDate < endOfYear ? endDate : endOfYear,
    },
    isDeleted: false,
  });

  // Group by date
  const dateWiseData: Record<string, number> = {};

  // Initialize all dates in the range with 0
  for (let i = 0; i < actualDays; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    dateWiseData[dateKey] = 0;
  }

  // Calculate focus minutes for each day
  sessions.forEach(session => {
    const dateKey = session.startTime.toISOString().split('T')[0];
    let minutes = 0;
    if (session.status === 'completed') {
      minutes = session.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - session.startTime.getTime();
      minutes = Math.round(durationMs / 60000);
    }
    if (dateWiseData[dateKey] !== undefined) {
      dateWiseData[dateKey] += minutes;
    }
  });

  // Convert to array format
  const focusTimeOverTime = Object.entries(dateWiseData).map(([date, minutes]) => ({
    date,
    focusMinutes: minutes,
  }));

  return {
    year: targetYear,
    days: actualDays,
    focusTimeOverTime,
  };
};

export const AnalyticsServices = {
  getStatsFromDB,
  getFocusTimeOverTime,
};
