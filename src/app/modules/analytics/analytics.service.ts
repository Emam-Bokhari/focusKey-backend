import { User } from "../user/user.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break } from "../breaks/breaks.model";
import { Friend, Nudge } from "../friends/friends.model";
import { Mode } from "../modes/modes.model";
import QueryBuilder from "../../builder/queryBuilder";

const getStatsFromDB = async () => {
  // calculate date ranges
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

  // Total Breaks Taken
  const totalBreaksTaken = await Break.countDocuments({ isDeleted: false });

  // Cooldown Completed (completed breaks)
  const cooldownCompleted = await Break.countDocuments({ status: "completed", isDeleted: false });

  // Users With Partners (users with at least one accepted friend)
  const usersWithPartnersAggregation = await Friend.aggregate([
    { $match: { status: "accepted", isDeleted: false } },
    // Collect both userId and friendId
    { $project: { users: ["$userId", "$friendId"] } },
    // Unwind the array to get individual user IDs
    { $unwind: "$users" },
    // Group to get unique user IDs
    { $group: { _id: "$users" } },
    // Count them
    { $count: "total" },
  ]);
  const uniqueUsersWithPartners = usersWithPartnersAggregation[0]?.total || 0;

  // Joint Sessions (nudges with at least 2 joined participants)
  const jointSessionsAggregation = await Nudge.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    // Only count non-deleted joined participants
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

  // Unlock Attempts: count all soft-deleted joined participants across all nudges
  const unlockAttemptsAggregation = await Nudge.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    // Unwind joinedParticipants
    { $unwind: "$joinedParticipants" },
    // Only count soft-deleted participants
    { $match: { "joinedParticipants.isDeleted": true } },
    { $count: "total" },
  ]);

  // Total Locks (from mode.lockEvents)
  const totalLocksAggregation = await Mode.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    // Unwind lockEvents
    { $unwind: "$lockEvents" },
    // Only count locks
    { $match: { "lockEvents.type": "lock" } },
    { $count: "total" },
  ]);

  // Total Unlocks (from mode.lockEvents)
  const totalUnlocksAggregation = await Mode.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    // Unwind lockEvents
    { $unwind: "$lockEvents" },
    // Only count unlocks
    { $match: { "lockEvents.type": "unlock" } },
    { $count: "total" },
  ]);

  return {
    totalUsers,
    activatedUsers,
    sevenDayActiveUsers,
    totalFocusSessionsThisWeek,
    totalBreaksTaken,
    cooldownCompleted,
    usersWithPartners: uniqueUsersWithPartners,
    jointSessions: jointSessionsAggregation[0]?.total || 0,
    totalLocks: totalLocksAggregation[0]?.total || 0,
    totalUnlocks: totalUnlocksAggregation[0]?.total || 0,
  };
};

const getFocusTimeOverTime = async (year?: number, days?: number) => {
  const currentYear = new Date().getFullYear();
  const targetYear = year || currentYear;
  const targetDays = days || 7;

  // validate days
  const validDays = [7, 14, 30];
  const actualDays = validDays.includes(targetDays) ? targetDays : 7;

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (actualDays - 1));
  startDate.setHours(0, 0, 0, 0);

  // flter for the target year
  const startOfYear = new Date(targetYear, 0, 1);
  const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

  // get all sessions in the date range
  const sessions = await FocusSession.find({
    startTime: {
      $gte: startDate > startOfYear ? startDate : startOfYear,
      $lte: endDate < endOfYear ? endDate : endOfYear,
    },
    isDeleted: false,
  });

  // group by date
  const dateWiseData: Record<string, number> = {};

  // initialize all dates in the range with 0
  for (let i = 0; i < actualDays; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    dateWiseData[dateKey] = 0;
  }

  // calculate focus minutes for each day
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

  // convert to array format
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

const getUsersAnalyticsFromDB = async (query: Record<string, unknown>) => {
  // Create base query with isDeleted: false
  const baseQuery = User.find({ isDeleted: false });

  // Use QueryBuilder to handle search, filter, sort, and pagination
  const userQueryBuilder = new QueryBuilder(baseQuery, query)
    .search(['name', 'email'])
    .filter()
    .sort()
    .paginate()
    .fields('name email role profileImage isPaired status createdAt lastLoginAt');

  // Get total count and pagination meta
  const meta = await userQueryBuilder.countTotal();

  // Get users
  const users = await userQueryBuilder.modelQuery.lean();

  // For each user, calculate additional metrics
  const usersWithAnalytics = await Promise.all(users.map(async (user: any) => {
    // Total sessions
    const totalSessions = await FocusSession.countDocuments({ 
      userId: user._id, 
      isDeleted: false 
    });

    // Total focus time
    const totalFocusTimeResult = await FocusSession.aggregate([
      { $match: { userId: user._id, status: 'completed', isDeleted: false } },
      { $group: { _id: null, totalMinutes: { $sum: '$durationMinutes' } } }
    ]);
    const totalFocusTime = totalFocusTimeResult[0]?.totalMinutes || 0;

    // Break count
    const breakCount = await Break.countDocuments({ 
      userId: user._id, 
      isDeleted: false 
    });

    // Total locks and unlocks from Mode.lockEvents
    const lockEventsResult = await Mode.aggregate([
      { $match: { userId: user._id, isDeleted: false } },
      { $unwind: '$lockEvents' },
      { 
        $group: {
          _id: null,
          totalLocks: { 
            $sum: { 
              $cond: [{ $eq: ['$lockEvents.type', 'lock'] }, 1, 0] 
            }
          },
          totalUnlocks: {
            $sum: {
              $cond: [{ $eq: ['$lockEvents.type', 'unlock'] }, 1, 0]
            }
          }
        }
      }
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
      lastActiveAt: user.lastLoginAt
    };
  }));

  return {
    meta,
    data: usersWithAnalytics
  };
};

const getSingleUserAnalyticsFromDB = async (userId: string) => {
  const user = await User.findOne({ _id: userId, isDeleted: false }).lean();
  if (!user) {
    return null;
  }

  const totalSessions = await FocusSession.countDocuments({ 
    userId: user._id, 
    isDeleted: false 
  });

  const totalFocusTimeResult = await FocusSession.aggregate([
    { $match: { userId: user._id, status: 'completed', isDeleted: false } },
    { $group: { _id: null, totalMinutes: { $sum: '$durationMinutes' } } }
  ]);
  const totalFocusTime = totalFocusTimeResult[0]?.totalMinutes || 0;

  const breakCount = await Break.countDocuments({ 
    userId: user._id, 
    isDeleted: false 
  });

  const lockEventsResult = await Mode.aggregate([
    { $match: { userId: user._id, isDeleted: false } },
    { $unwind: '$lockEvents' },
    { 
      $group: {
        _id: null,
        totalLocks: { 
          $sum: { 
            $cond: [{ $eq: ['$lockEvents.type', 'lock'] }, 1, 0] 
          }
        },
        totalUnlocks: {
          $sum: {
            $cond: [{ $eq: ['$lockEvents.type', 'unlock'] }, 1, 0]
          }
        }
      }
    }
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
    lastActiveAt: user.lastLoginAt
  };
};

export const AnalyticsServices = {
  getStatsFromDB,
  getFocusTimeOverTime,
  getUsersAnalyticsFromDB,
  getSingleUserAnalyticsFromDB,
};
