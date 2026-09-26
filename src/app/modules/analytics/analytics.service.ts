import { User } from "../user/user.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break } from "../breaks/breaks.model";
import { Friend, Nudge } from "../friends/friends.model";
import { Mode } from "../modes/modes.model";
import QueryBuilder from "../../builder/queryBuilder";
import {
  dayjs,
  DEFAULT_TIMEZONE,
  formatZonedDateKey,
  getZonedEndOfDay,
  getZonedStartOfWeek,
} from "../../../helpers/timezoneHelper";

const getStatsFromDB = async (userTimezone: string = DEFAULT_TIMEZONE) => {
  const now = new Date();
  const startOfWeek = getZonedStartOfWeek(now, userTimezone);

  const sevenDaysAgo = dayjs().tz(userTimezone).subtract(7, "day").startOf("day").toDate();

  const totalUsers = await User.countDocuments({ isDeleted: false });

  const activatedUsers = await User.countDocuments({
    verified: true,
    isDeleted: false,
  });

  const sevenDayActiveUsers = await User.countDocuments({
    lastLoginAt: { $gte: sevenDaysAgo },
    isDeleted: false,
  });

  const totalFocusSessionsThisWeek = await FocusSession.countDocuments({
    startTime: { $gte: startOfWeek },
    isDeleted: false,
  });

  const totalFocusTimeAggregation = await FocusSession.aggregate([
    { $match: { status: "completed", isDeleted: false } },
    { $group: { _id: null, totalMinutes: { $sum: "$durationMinutes" } } },
  ]);
  const totalTimeFocused = totalFocusTimeAggregation[0]?.totalMinutes || 0;

  const totalBreaksTaken = await Break.countDocuments({ isDeleted: false });

  const cooldownCompleted = await Break.countDocuments({
    status: "completed",
    isDeleted: false,
  });

  const usersWithPartnersAggregation = await Friend.aggregate([
    { $match: { status: "accepted", isDeleted: false } },
    { $project: { users: ["$userId", "$friendId"] } },
    { $unwind: "$users" },
    { $group: { _id: "$users" } },
    { $count: "total" },
  ]);
  const uniqueUsersWithPartners = usersWithPartnersAggregation[0]?.total || 0;

  const jointSessionsAggregation = await Nudge.aggregate([
    { $match: { isDeleted: false } },
    {
      $addFields: {
        activeJoinedCount: {
          $size: {
            $filter: {
              input: "$joinedParticipants",
              as: "jp",
              cond: { $eq: ["$$jp.isDeleted", false] },
            },
          },
        },
      },
    },
    { $match: { activeJoinedCount: { $gte: 2 } } },
    { $count: "total" },
  ]);

  const unlockAttemptsAggregation = await Nudge.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: "$joinedParticipants" },
    { $match: { "joinedParticipants.isDeleted": true } },
    { $count: "total" },
  ]);

  const totalLocksAggregation = await Mode.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: "$lockEvents" },
    { $match: { "lockEvents.type": "lock" } },
    { $count: "total" },
  ]);

  const totalUnlocksAggregation = await Mode.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: "$lockEvents" },
    { $match: { "lockEvents.type": "unlock" } },
    { $count: "total" },
  ]);

  return {
    totalUsers,
    activatedUsers,
    sevenDayActiveUsers,
    totalFocusSessionsThisWeek,
    totalTimeFocused,
    totalBreaksTaken,
    cooldownCompleted,
    usersWithPartners: uniqueUsersWithPartners,
    jointSessions: jointSessionsAggregation[0]?.total || 0,
    totalLocks: totalLocksAggregation[0]?.total || 0,
    totalUnlocks: totalUnlocksAggregation[0]?.total || 0,
  };
};

const getFocusTimeOverTime = async (
  year?: number,
  days?: number,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const currentYear = Number(dayjs().tz(userTimezone).format("YYYY"));
  const targetYear = year || currentYear;
  const targetDays = days || 7;

  const validDays = [7, 14, 30];
  const actualDays = validDays.includes(targetDays) ? targetDays : 7;

  const now = new Date();
  const endDate = getZonedEndOfDay(now, userTimezone);

  const startDate = dayjs(endDate)
    .tz(userTimezone)
    .subtract(actualDays - 1, "day")
    .startOf("day")
    .toDate();

  const startOfYear = dayjs.tz(`${targetYear}-01-01 00:00:00`, userTimezone).toDate();
  const endOfYear = dayjs.tz(`${targetYear}-12-31 23:59:59.999`, userTimezone).toDate();

  const sessions = await FocusSession.find({
    nudgeId: { $exists: false },
    status: "completed",
    startTime: {
      $gte: startDate > startOfYear ? startDate : startOfYear,
      $lte: endDate < endOfYear ? endDate : endOfYear,
    },
    isDeleted: false,
  });

  const dateWiseData: Record<string, number> = {};

  for (let i = 0; i < actualDays; i++) {
    const d = dayjs(startDate).tz(userTimezone).add(i, "day").toDate();
    const dateKey = formatZonedDateKey(d, userTimezone);
    dateWiseData[dateKey] = 0;
  }

  sessions.forEach((session) => {
    const dateKey = formatZonedDateKey(session.startTime, userTimezone);
    const minutes =
      session.durationMinutes ??
      (session.endTime
        ? Math.round(
            (new Date(session.endTime).getTime() - session.startTime.getTime()) /
              60000,
          )
        : 0);
    if (dateWiseData[dateKey] !== undefined) {
      dateWiseData[dateKey] += minutes;
    }
  });

  const focusTimeOverTime = Object.entries(dateWiseData).map(
    ([date, minutes]) => ({
      date,
      focusMinutes: minutes,
    }),
  );

  return {
    year: targetYear,
    days: actualDays,
    focusTimeOverTime,
  };
};

const getFocusTimeTogetherOverTime = async (
  year?: number,
  days?: number,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const currentYear = Number(dayjs().tz(userTimezone).format("YYYY"));
  const targetYear = year || currentYear;
  const targetDays = days || 7;

  const validDays = [7, 14, 30];
  const actualDays = validDays.includes(targetDays) ? targetDays : 7;

  const now = new Date();
  const endDate = getZonedEndOfDay(now, userTimezone);

  const startDate = dayjs(endDate)
    .tz(userTimezone)
    .subtract(actualDays - 1, "day")
    .startOf("day")
    .toDate();

  const startOfYear = dayjs.tz(`${targetYear}-01-01 00:00:00`, userTimezone).toDate();
  const endOfYear = dayjs.tz(`${targetYear}-12-31 23:59:59.999`, userTimezone).toDate();

  const sessions = await FocusSession.find({
    nudgeId: { $exists: true, $ne: null },
    status: "completed",
    startTime: {
      $gte: startDate > startOfYear ? startDate : startOfYear,
      $lte: endDate < endOfYear ? endDate : endOfYear,
    },
    isDeleted: false,
  });

  const dateWiseData: Record<string, number> = {};

  for (let i = 0; i < actualDays; i++) {
    const d = dayjs(startDate).tz(userTimezone).add(i, "day").toDate();
    const dateKey = formatZonedDateKey(d, userTimezone);
    dateWiseData[dateKey] = 0;
  }

  sessions.forEach((session) => {
    const dateKey = formatZonedDateKey(session.startTime, userTimezone);
    const minutes =
      session.durationMinutes ??
      (session.endTime
        ? Math.round(
            (new Date(session.endTime).getTime() - session.startTime.getTime()) /
              60000,
          )
        : 0);
    if (dateWiseData[dateKey] !== undefined) {
      dateWiseData[dateKey] += minutes;
    }
  });

  const focusTimeTogetherOverTime = Object.entries(dateWiseData).map(
    ([date, minutes]) => ({
      date,
      focusMinutes: minutes,
    }),
  );

  return {
    year: targetYear,
    days: actualDays,
    focusTimeTogetherOverTime,
  };
};

const getUsersAnalyticsFromDB = async (query: Record<string, unknown>) => {
  const baseQuery = User.find({ isDeleted: false });

  const userQueryBuilder = new QueryBuilder(baseQuery, query)
    .search(["name", "email"])
    .filter()
    .sort()
    .paginate()
    .fields(
      "name email role profileImage isPaired status createdAt lastLoginAt",
    );

  const meta = await userQueryBuilder.countTotal();

  const users = await userQueryBuilder.modelQuery.lean();

  const usersWithAnalytics = await Promise.all(
    users.map(async (user: any) => {
      const totalSessions = await FocusSession.countDocuments({
        userId: user._id,
        isDeleted: false,
      });

      const totalFocusTimeResult = await FocusSession.aggregate([
        { $match: { userId: user._id, status: "completed", isDeleted: false } },
        { $group: { _id: null, totalMinutes: { $sum: "$durationMinutes" } } },
      ]);
      const totalFocusTime = totalFocusTimeResult[0]?.totalMinutes || 0;

      const breakCount = await Break.countDocuments({
        userId: user._id,
        isDeleted: false,
      });

      const lockEventsResult = await Mode.aggregate([
        { $match: { userId: user._id, isDeleted: false } },
        { $unwind: "$lockEvents" },
        {
          $group: {
            _id: null,
            totalLocks: {
              $sum: {
                $cond: [{ $eq: ["$lockEvents.type", "lock"] }, 1, 0],
              },
            },
            totalUnlocks: {
              $sum: {
                $cond: [{ $eq: ["$lockEvents.type", "unlock"] }, 1, 0],
              },
            },
          },
        },
      ]);
      const totalLocks = lockEventsResult[0]?.totalLocks || 0;
      const totalUnlocks = lockEventsResult[0]?.totalUnlocks || 0;

      return {
        userId: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
        isPaired: user.isPaired,
        status: user.status,
        totalSessions,
        totalLocks,
        totalUnlocks,
        totalFocusTime,
        breakCount,
        registeredAt: user.createdAt,
        lastActiveAt: user.lastLoginAt,
      };
    }),
  );

  return {
    meta,
    data: usersWithAnalytics,
  };
};

const getSingleUserAnalyticsFromDB = async (userId: string) => {
  const user = await User.findOne({ _id: userId, isDeleted: false }).lean();
  if (!user) {
    return null;
  }

  const totalSessions = await FocusSession.countDocuments({
    userId: user._id,
    isDeleted: false,
  });

  const totalFocusTimeResult = await FocusSession.aggregate([
    { $match: { userId: user._id, status: "completed", isDeleted: false } },
    { $group: { _id: null, totalMinutes: { $sum: "$durationMinutes" } } },
  ]);
  const totalFocusTime = totalFocusTimeResult[0]?.totalMinutes || 0;

  const breakCount = await Break.countDocuments({
    userId: user._id,
    isDeleted: false,
  });

  const lockEventsResult = await Mode.aggregate([
    { $match: { userId: user._id, isDeleted: false } },
    { $unwind: "$lockEvents" },
    {
      $group: {
        _id: null,
        totalLocks: {
          $sum: {
            $cond: [{ $eq: ["$lockEvents.type", "lock"] }, 1, 0],
          },
        },
        totalUnlocks: {
          $sum: {
            $cond: [{ $eq: ["$lockEvents.type", "unlock"] }, 1, 0],
          },
        },
      },
    },
  ]);
  const totalLocks = lockEventsResult[0]?.totalLocks || 0;
  const totalUnlocks = lockEventsResult[0]?.totalUnlocks || 0;

  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    profileImage: user.profileImage,
    isPaired: user.isPaired,
    status: user.status,
    totalSessions,
    totalLocks,
    totalUnlocks,
    totalFocusTime,
    breakCount,
    registeredAt: user.createdAt,
    lastActiveAt: user.lastLoginAt,
  };
};

const getEngagementStatsFromDB = async () => {
  const usersWithPartnersAggregation = await Friend.aggregate([
    { $match: { status: "accepted", isDeleted: false } },
    { $project: { users: ["$userId", "$friendId"] } },
    { $unwind: "$users" },
    { $group: { _id: "$users" } },
    { $count: "total" },
  ]);
  const usersWithPartners = usersWithPartnersAggregation[0]?.total || 0;

  const partnerRequestsAccepted = await Friend.countDocuments({
    status: "accepted",
    isDeleted: false,
  });

  const nudgesSent = await Nudge.countDocuments({ isDeleted: false });

  const jointSessionsAggregation = await Nudge.aggregate([
    { $match: { isDeleted: false } },
    {
      $addFields: {
        activeJoinedCount: {
          $size: {
            $filter: {
              input: "$joinedParticipants",
              as: "jp",
              cond: { $eq: ["$$jp.isDeleted", false] },
            },
          },
        },
      },
    },
    { $match: { activeJoinedCount: { $gte: 2 } } },
    { $count: "total" },
  ]);
  const jointSessions = jointSessionsAggregation[0]?.total || 0;

  return {
    usersWithPartners,
    partnerRequestsAccepted,
    nudgesSent,
    jointSessions,
  };
};

export const AnalyticsServices = {
  getStatsFromDB,
  getFocusTimeOverTime,
  getFocusTimeTogetherOverTime,
  getUsersAnalyticsFromDB,
  getSingleUserAnalyticsFromDB,
  getEngagementStatsFromDB,
};
