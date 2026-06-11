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

export const AnalyticsServices = {
  getStatsFromDB,
};
