import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Friend, Nudge, NudgePreview } from "./friends.model";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break } from "../breaks/breaks.model";
import { emailHelper } from "../../../helpers/emailHelper";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import config from "../../../config";
import { Mode } from "../modes/modes.model";
import { sendNotifications } from "../../../helpers/notificationsHelper";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "../notification/notification.constant";
import {
  DEFAULT_TIMEZONE,
  getZonedEndOfDay,
  getZonedStartOfDay,
  getZonedStartOfWeek,
} from "../../../helpers/timezoneHelper";

const NUDGE_PREVIEW_TTL_MINUTES = 10;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Pure helper to format last focus session info into display string
 */
const formatLastFocusString = (
  lastSession:
    | { endTime?: Date | string | null; durationMinutes?: number }
    | null
    | undefined,
  now: Date = new Date(),
): string => {
  if (!lastSession || !lastSession.endTime) return "No focus history";

  const sessionEndTime = new Date(lastSession.endTime);
  const diffMs = now.getTime() - sessionEndTime.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      sessionEndTime.getDate() === yesterday.getDate() &&
      sessionEndTime.getMonth() === yesterday.getMonth() &&
      sessionEndTime.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      let durationStr = "some time";
      if (lastSession.durationMinutes) {
        const h = Math.floor(lastSession.durationMinutes / 60);
        const m = lastSession.durationMinutes % 60;
        durationStr = h > 0 ? `${h}h` : `${m}m`;
      }
      return `Focused ${durationStr} yesterday`;
    }
    return `Last focused ${diffDays}d ago`;
  }
  if (diffHours > 0) return `Last focused ${diffHours}h ago`;
  return `Last focused ${diffMins}m ago`;
};

const buildLastFocusInfo = async (
  userId: mongoose.Types.ObjectId,
): Promise<string> => {
  const lastSession = await FocusSession.findOne({
    userId,
    status: "completed",
  })
    .sort({ endTime: -1 })
    .select("endTime durationMinutes")
    .lean();

  return formatLastFocusString(lastSession);
};

/**
 * Batch retrieves the latest completed focus session for multiple users in 1 aggregation query
 */
const batchGetLastFocusSessions = async (
  userIds: mongoose.Types.ObjectId[],
): Promise<Map<string, { endTime: Date; durationMinutes: number }>> => {
  const map = new Map<string, { endTime: Date; durationMinutes: number }>();
  if (userIds.length === 0) return map;

  const sessions = await FocusSession.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        status: "completed",
        endTime: { $exists: true, $ne: null },
      },
    },
    { $sort: { endTime: -1 } },
    {
      $group: {
        _id: "$userId",
        endTime: { $first: "$endTime" },
        durationMinutes: { $first: "$durationMinutes" },
      },
    },
  ]);

  for (const s of sessions) {
    map.set(s._id.toString(), {
      endTime: s.endTime,
      durationMinutes: s.durationMinutes,
    });
  }

  return map;
};

interface ISharedFocusStatsResult {
  togetherThisWeek: string;
  streak: number;
  highlightedDays: string[];
  totalTogetherMinutes: number;
}

/**
 * Batch computes shared focus stats for creator and multiple participants in memory using 2 database queries
 */
const batchComputeSharedFocusStats = async (
  creatorId: mongoose.Types.ObjectId,
  participantIds: mongoose.Types.ObjectId[],
): Promise<Map<string, ISharedFocusStatsResult>> => {
  const results = new Map<string, ISharedFocusStatsResult>();
  if (participantIds.length === 0) return results;

  const now = new Date();
  const startOfRange = new Date(now);
  startOfRange.setDate(startOfRange.getDate() - 6);
  startOfRange.setHours(0, 0, 0, 0);

  const endOfRange = new Date(now);
  endOfRange.setHours(23, 59, 59, 999);

  const [creatorSessions, allParticipantSessions] = await Promise.all([
    FocusSession.find({
      userId: creatorId,
      status: "completed",
      startTime: { $lte: endOfRange },
      endTime: { $gte: startOfRange },
    })
      .select("startTime endTime durationMinutes")
      .lean(),
    FocusSession.find({
      userId: { $in: participantIds },
      status: "completed",
      startTime: { $lte: endOfRange },
      endTime: { $gte: startOfRange },
    })
      .select("userId startTime endTime durationMinutes")
      .lean(),
  ]);

  const participantSessionsMap = new Map<string, any[]>();
  for (const s of allParticipantSessions) {
    const pIdStr = s.userId.toString();
    const list = participantSessionsMap.get(pIdStr) || [];
    list.push(s);
    participantSessionsMap.set(pIdStr, list);
  }

  // Pre-calculate 7-day boundaries
  const daysInfo: { startOfDay: Date; endOfDay: Date; dayName: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const startOfDay = new Date(d);
    const endOfDay = new Date(d);
    endOfDay.setHours(23, 59, 59, 999);
    daysInfo.push({
      startOfDay,
      endOfDay,
      dayName: DAY_NAMES[d.getDay()],
    });
  }

  for (const participantId of participantIds) {
    const pIdStr = participantId.toString();
    const pSessions = participantSessionsMap.get(pIdStr) || [];

    const highlightedDays: string[] = [];
    let totalTogetherMinutes = 0;

    for (const day of daysInfo) {
      const cDaySessions = creatorSessions.filter(
        (s) =>
          new Date(s.startTime) <= day.endOfDay &&
          new Date(s.endTime || day.endOfDay) >= day.startOfDay,
      );
      const pDaySessions = pSessions.filter(
        (s) =>
          new Date(s.startTime) <= day.endOfDay &&
          new Date(s.endTime || day.endOfDay) >= day.startOfDay,
      );

      if (cDaySessions.length === 0 || pDaySessions.length === 0) {
        continue;
      }

      let sharedMinutes = 0;
      for (const cs of cDaySessions) {
        const csStart = new Date(cs.startTime).getTime();
        const csEnd = (cs.endTime ? new Date(cs.endTime) : day.endOfDay).getTime();

        for (const ps of pDaySessions) {
          const psStart = new Date(ps.startTime).getTime();
          const psEnd = (ps.endTime ? new Date(ps.endTime) : day.endOfDay).getTime();

          const overlapStart = Math.max(csStart, psStart, day.startOfDay.getTime());
          const overlapEnd = Math.min(csEnd, psEnd, day.endOfDay.getTime());

          if (overlapEnd > overlapStart) {
            sharedMinutes += Math.round((overlapEnd - overlapStart) / 60000);
          }
        }
      }

      if (sharedMinutes === 0) {
        const creatorMin = cDaySessions.reduce(
          (acc, s) => acc + (s.durationMinutes || 0),
          0,
        );
        const participantMin = pDaySessions.reduce(
          (acc, s) => acc + (s.durationMinutes || 0),
          0,
        );
        sharedMinutes = Math.min(creatorMin, participantMin);
      }

      highlightedDays.push(day.dayName);
      totalTogetherMinutes += sharedMinutes;
    }

    let streak = 0;
    for (const day of daysInfo) {
      if (highlightedDays.includes(day.dayName)) {
        streak++;
      } else {
        streak = 0;
      }
    }

    const togetherHours = Math.floor(totalTogetherMinutes / 60);
    const togetherMins = totalTogetherMinutes % 60;
    const togetherFormatted =
      togetherHours > 0
        ? `${togetherHours}h${togetherMins > 0 ? ` ${togetherMins}m` : ""}`
        : `${togetherMins}m`;

    results.set(pIdStr, {
      togetherThisWeek: togetherFormatted,
      streak,
      highlightedDays,
      totalTogetherMinutes,
    });
  }

  return results;
};

const computeSharedFocusStats = async (
  creatorId: mongoose.Types.ObjectId,
  participantId: mongoose.Types.ObjectId,
): Promise<ISharedFocusStatsResult> => {
  const map = await batchComputeSharedFocusStats(creatorId, [participantId]);
  return (
    map.get(participantId.toString()) || {
      togetherThisWeek: "0m",
      streak: 0,
      highlightedDays: [],
      totalTogetherMinutes: 0,
    }
  );
};

const getUsersFromDB = async (
  userId: string,
  searchTerm: string,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const query: any = {
    _id: { $ne: userObjectId },
    isDeleted: { $ne: true },
    role: USER_ROLES.USER,
  };

  if (searchTerm) {
    query.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { userName: { $regex: searchTerm, $options: "i" } },
      { email: { $regex: searchTerm, $options: "i" } },
    ];
  }

  // Fetch paginated users and total count concurrently
  const [users, total] = await Promise.all([
    User.find(query)
      .select("name userName profileImage email")
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  if (!users || users.length === 0) {
    return {
      meta: { page, limit, total },
      data: [],
    };
  }

  const userIds = users.map((u) => new mongoose.Types.ObjectId(u._id.toString()));
  const now = new Date();

  // Fetch friend records, active sessions, active breaks, and last completed sessions in parallel
  const [friendRecords, activeSessions, activeBreaks, lastSessionsMap] =
    await Promise.all([
      Friend.find({
        $or: [
          { userId: userObjectId, friendId: { $in: userIds } },
          { friendId: userObjectId, userId: { $in: userIds } },
        ],
        isDeleted: { $ne: true },
      })
        .select("userId friendId status")
        .lean(),
      FocusSession.find({
        userId: { $in: userIds },
        status: "active",
      })
        .select("userId")
        .lean(),
      Break.find({
        userId: { $in: userIds },
        status: "active",
        endTime: { $gt: now },
      })
        .select("userId")
        .lean(),
      batchGetLastFocusSessions(userIds),
    ]);

  const friendStatusMap = new Map<
    string,
    {
      status: "pending" | "accepted" | "rejected" | "cancelled";
      requestId: string;
      isSender: boolean;
    }
  >();

  for (const record of friendRecords) {
    const isSender = (record.userId as any).toString() === userId;
    const targetUserId = isSender
      ? (record.friendId as any).toString()
      : (record.userId as any).toString();
    friendStatusMap.set(targetUserId, {
      status: record.status as any,
      requestId: record._id.toString(),
      isSender,
    });
  }

  const activeSessionSet = new Set(
    activeSessions.map((s) => s.userId.toString()),
  );
  const activeBreakSet = new Set(
    activeBreaks.map((b) => b.userId.toString()),
  );

  const usersWithStatus = users.map((user) => {
    const targetIdStr = user._id.toString();
    const hasActiveSession = activeSessionSet.has(targetIdStr);
    const hasActiveBreak = activeBreakSet.has(targetIdStr);
    const isLocked = hasActiveSession ? !hasActiveBreak : false;

    const lastFocusInfo = formatLastFocusString(
      lastSessionsMap.get(targetIdStr),
      now,
    );
    const userName = user.userName || user.email?.split("@")[0] || "user";

    const friendInfo = friendStatusMap.get(targetIdStr);
    let isFriend = false;
    let friendshipStatus:
      | "none"
      | "pending_sent"
      | "pending_received"
      | "accepted" = "none";
    let requestId: string | null = null;

    if (friendInfo) {
      if (friendInfo.status === "accepted") {
        isFriend = true;
        friendshipStatus = "accepted";
        requestId = friendInfo.requestId;
      } else if (friendInfo.status === "pending") {
        friendshipStatus = friendInfo.isSender
          ? "pending_sent"
          : "pending_received";
        requestId = friendInfo.requestId;
      }
    }

    return {
      ...user,
      userName,
      isFriend,
      friendshipStatus,
      requestId,
      isLocked,
      lastFocusInfo: isLocked ? "Focusing now" : lastFocusInfo,
    };
  });

  return {
    meta: { page, limit, total },
    data: usersWithStatus,
  };
};

const initiateNudgePreviewInDB = async (
  userId: string,
  payload: {
    participants: string[];
    modeId: string;
    breakConfig: { breaksPerDay: number; breakDurationMinutes: number };
  },
) => {
  const { participants, modeId, breakConfig } = payload;

  if (!participants || participants.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "At least one friend must be selected",
    );
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);

  const existingPreview = await NudgePreview.findOne({
    creatorId: userObjectId,
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).lean();

  if (existingPreview) {
    const remainingMs =
      new Date(existingPreview.expiresAt).getTime() - Date.now();
    const remainingMinutes = Math.max(0, Math.ceil(remainingMs / 60000));
    return {
      previewId: existingPreview._id,
      status: existingPreview.status,
      expiresAt: existingPreview.expiresAt,
      expiresInMinutes: remainingMinutes,
      message:
        "You already have a pending nudge preview. Confirm or wait for it to expire.",
    };
  }

  const [creatorActiveSession, creatorActiveNudge] = await Promise.all([
    FocusSession.findOne({
      userId: userObjectId,
      status: "active",
    }).lean(),
    Nudge.findOne({
      status: { $in: ["active", "scheduled"] },
      joinedParticipants: {
        $elemMatch: { userId: userObjectId, isDeleted: false },
      },
    }).lean(),
  ]);

  if (creatorActiveSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot initiate a nudge while you are in a focus session",
    );
  }

  if (creatorActiveNudge) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "You are already part of an active nudge session. Please leave or complete it before starting another.",
    );
  }

  const participantObjectIds = participants.map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const activeFriendships = await Friend.find({
    $or: [
      { userId: userObjectId, friendId: { $in: participantObjectIds } },
      { friendId: userObjectId, userId: { $in: participantObjectIds } },
    ],
    status: "accepted",
    isDeleted: { $ne: true },
  })
    .select("userId friendId")
    .lean();

  const acceptedFriendIds = new Set<string>();
  for (const f of activeFriendships) {
    const isUser = (f.userId as any).toString() === userId;
    acceptedFriendIds.add(
      isUser ? (f.friendId as any).toString() : (f.userId as any).toString(),
    );
  }

  const invalidParticipants = participants.filter(
    (id) => !acceptedFriendIds.has(id),
  );
  if (invalidParticipants.length > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "One or more selected users are not your confirmed friends",
    );
  }

  const expiresAt = new Date(Date.now() + NUDGE_PREVIEW_TTL_MINUTES * 60 * 1000);

  const preview = await NudgePreview.create({
    creatorId: userObjectId,
    participants: participantObjectIds,
    modeId: new mongoose.Types.ObjectId(modeId),
    breakConfig,
    expiresAt,
    status: "pending",
  });

  return {
    previewId: preview._id,
    status: preview.status,
    expiresAt: preview.expiresAt,
    expiresInMinutes: NUDGE_PREVIEW_TTL_MINUTES,
  };
};

const getNudgePreviewDetailsFromDB = async (
  userId: string,
  previewId: string,
) => {
  const preview = await NudgePreview.findById(previewId)
    .populate("participants", "name userName profileImage email")
    .populate("modeId", "name iconType lockedApps")
    .lean();

  if (!preview) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Nudge preview not found or expired",
    );
  }

  if (preview.creatorId.toString() !== userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You do not have access to this preview",
    );
  }

  if (preview.status === "confirmed") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This nudge has already been confirmed",
    );
  }

  if (preview.status === "expired" || new Date() > new Date(preview.expiresAt)) {
    if (preview.status !== "expired") {
      await NudgePreview.findByIdAndUpdate(previewId, { status: "expired" });
    }
    throw new ApiError(
      StatusCodes.GONE,
      "This nudge preview has expired. Please initiate again",
    );
  }

  const creatorId = new mongoose.Types.ObjectId(userId);
  const rawParticipants = (preview.participants as any[]).filter(
    (p) => p != null,
  );
  const participantIds = rawParticipants.map(
    (p) => new mongoose.Types.ObjectId(p._id.toString()),
  );

  const now = new Date();

  // Fetch active sessions, active breaks, last completed sessions, and shared focus stats in parallel
  const [activeSessions, activeBreaks, lastSessionsMap, sharedStatsMap] =
    await Promise.all([
      FocusSession.find({
        userId: { $in: participantIds },
        status: "active",
      })
        .select("userId")
        .lean(),
      Break.find({
        userId: { $in: participantIds },
        status: "active",
        endTime: { $gt: now },
      })
        .select("userId")
        .lean(),
      batchGetLastFocusSessions(participantIds),
      batchComputeSharedFocusStats(creatorId, participantIds),
    ]);

  const activeSessionSet = new Set(
    activeSessions.map((s) => s.userId.toString()),
  );
  const activeBreakSet = new Set(
    activeBreaks.map((b) => b.userId.toString()),
  );

  const participantsWithDetails = rawParticipants.map((participant) => {
    const pIdStr = participant._id.toString();
    const hasActiveSession = activeSessionSet.has(pIdStr);
    const hasActiveBreak = activeBreakSet.has(pIdStr);
    const isLocked = hasActiveSession ? !hasActiveBreak : false;

    const lastFocusInfo = formatLastFocusString(
      lastSessionsMap.get(pIdStr),
      now,
    );
    const sharedStats = sharedStatsMap.get(pIdStr) || {
      togetherThisWeek: "0m",
      streak: 0,
      highlightedDays: [],
      totalTogetherMinutes: 0,
    };

    return {
      _id: participant._id,
      name: participant.name,
      userName:
        participant.userName || participant.email?.split("@")[0] || "user",
      profileImage: participant.profileImage || "",
      email: participant.email || "",
      isLocked,
      lastFocusInfo: isLocked ? "Focusing now" : lastFocusInfo,
      sharedStats: {
        togetherThisWeek: sharedStats.togetherThisWeek,
        streak: sharedStats.streak,
        highlightedDays: sharedStats.highlightedDays,
        totalTogetherMinutes: sharedStats.totalTogetherMinutes,
        hasSharedHistory: sharedStats.highlightedDays.length > 0,
      },
    };
  });

  const remainingMs = new Date(preview.expiresAt).getTime() - Date.now();
  const remainingMinutes = Math.max(0, Math.ceil(remainingMs / 60000));

  return {
    previewId: preview._id,
    status: preview.status,
    expiresAt: preview.expiresAt,
    remainingMinutes,
    mode: preview.modeId,
    breakConfig: preview.breakConfig,
    participants: participantsWithDetails,
  };
};

const confirmNudgeFromPreviewInDB = async (
  userId: string,
  previewId: string,
) => {
  const preview = await NudgePreview.findById(previewId);

  if (!preview) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Nudge preview not found or expired",
    );
  }

  if (preview.creatorId.toString() !== userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You do not have access to this preview",
    );
  }

  if (preview.status === "confirmed") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This nudge has already been confirmed",
    );
  }

  if (preview.status === "expired" || new Date() > preview.expiresAt) {
    await NudgePreview.findByIdAndUpdate(previewId, { status: "expired" });
    throw new ApiError(
      StatusCodes.GONE,
      "This nudge preview has expired. Please initiate again",
    );
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const participantIds = preview.participants.map(
    (id) => new mongoose.Types.ObjectId(id.toString()),
  );

  const [creatorActiveSession, creatorActiveNudge, focusedParticipants, creator] =
    await Promise.all([
      FocusSession.findOne({
        userId: userObjectId,
        status: "active",
      }).lean(),
      Nudge.findOne({
        status: { $in: ["active", "scheduled"] },
        joinedParticipants: {
          $elemMatch: {
            userId: userObjectId,
            isDeleted: false,
          },
        },
      }).lean(),
      FocusSession.find({
        userId: { $in: participantIds },
        status: "active",
      })
        .populate("userId", "name")
        .lean(),
      User.findById(userId).select("name").lean(),
    ]);

  if (creatorActiveSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot confirm a nudge while you are in a focus session",
    );
  }

  if (creatorActiveNudge) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "You are already part of an active nudge session. Please leave or complete it before starting another.",
    );
  }

  if (focusedParticipants.length > 0) {
    const focusedNames = focusedParticipants
      .map((s: any) => s.userId?.name)
      .filter(Boolean)
      .join(", ");
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot confirm nudge. The following users are now in a focus session: ${focusedNames}`,
    );
  }

  const { participants, modeId, breakConfig } = preview;

  const nudgeData = {
    creatorId: userObjectId,
    participants: participants.map((id) => ({
      userId: new mongoose.Types.ObjectId(id.toString()),
      isDeleted: false,
    })),
    joinedParticipants: [{ userId: userObjectId, isDeleted: false }],
    modeId: new mongoose.Types.ObjectId(modeId.toString()),
    breakConfig,
    startTime: new Date(),
    status: "active",
  };

  const nudge = await Nudge.create(nudgeData);
  const now = new Date();

  await Promise.all([
    NudgePreview.findByIdAndUpdate(previewId, { status: "confirmed" }),
    Mode.updateMany(
      { userId: userObjectId, isDeleted: false },
      { $set: { isActive: false } },
    ),
    Mode.findByIdAndUpdate(modeId, {
      $set: { isActive: true },
      $push: {
        lockEvents: {
          type: "lock",
          source: "nudge",
          timestamp: now,
        },
      },
    }),
    FocusSession.create({
      userId: userObjectId,
      modeId: new mongoose.Types.ObjectId(modeId.toString()),
      nudgeId: nudge._id,
      startTime: now,
      status: "active",
    }),
  ]);

  const invitedUsers = await User.find({
    _id: { $in: participantIds },
  })
    .select("name email")
    .lean();

  // Send invitations concurrently via Promise.all
  await Promise.all(
    invitedUsers.map(async (user) => {
      const joinLink = `${config.base_url}/api/v1/friends/join-nudge/${nudge._id}?userId=${user._id}`;

      const tasks: Promise<any>[] = [
        sendNotifications({
          title: "New Nudge Invitation",
          text: `${creator?.name || "Someone"} has invited you to join a focus session (Nudge). Click here to join: ${joinLink}`,
          receiver: user._id.toString(),
          sender: creator?._id?.toString() || userId,
          type: NOTIFICATION_TYPE.USER,
          referenceId: nudge._id.toString(),
          referenceModel: NOTIFICATION_REFERENCE_MODEL.NUDGE,
        }).catch(() => {}),
      ];

      if (user.email) {
        tasks.push(
          emailHelper
            .sendEmail({
              to: user.email,
              subject: "New Nudge Invitation",
              html: `
                <p>Hi ${user.name},</p>
                <p><b>${creator?.name}</b> invited you to join a focus session (Nudge).</p>
                <p>Click the link below to join:</p>
                <a href="${joinLink}">Join Nudge</a>
              `,
            })
            .catch(() => {}),
        );
      }

      return Promise.all(tasks);
    }),
  );

  return nudge;
};

const joinNudgeInDB = async (userId: string, nudgeId: string) => {
  const nudge = await Nudge.findById(nudgeId);

  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  if (nudge.status === "completed") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Nudge is already completed");
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);

  const isCreator = nudge.creatorId.equals(userObjectId);
  const isInvited = nudge.participants.some(
    (p) => !p.isDeleted && p.userId.equals(userObjectId),
  );
  if (!isCreator && !isInvited) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not invited to this nudge",
    );
  }

  const existingJoined = nudge.joinedParticipants.find(
    (p) => !p.isDeleted && p.userId.equals(userObjectId),
  );
  if (existingJoined) {
    return nudge;
  }

  const activeNudge = await Nudge.findOne({
    _id: { $ne: new mongoose.Types.ObjectId(nudgeId) },
    status: { $in: ["active", "scheduled"] },
    joinedParticipants: {
      $elemMatch: { userId: userObjectId, isDeleted: false },
    },
  }).lean();

  if (activeNudge) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "You are already part of an active nudge session. Please leave or complete it before joining another.",
    );
  }

  const previouslyJoined = nudge.joinedParticipants.find(
    (p) => p.isDeleted && p.userId.equals(userObjectId),
  );

  const updateData: any = {};
  if (previouslyJoined) {
    updateData.$set = {
      "joinedParticipants.$[elem].isDeleted": false,
      "joinedParticipants.$[elem].deletedAt": null,
    };
    updateData.arrayFilters = [{ "elem.userId": userObjectId }];
  } else {
    updateData.$addToSet = {
      joinedParticipants: { userId: userObjectId, isDeleted: false },
    };
  }

  if (nudge.status === "scheduled") {
    updateData.status = "active";
  }

  const now = new Date();
  const [result] = await Promise.all([
    Nudge.findByIdAndUpdate(nudgeId, updateData, { new: true }),
    Mode.updateMany(
      { userId: userObjectId, isDeleted: false },
      { $set: { isActive: false } },
    ),
    Mode.findByIdAndUpdate(nudge.modeId, {
      $set: { isActive: true },
      $push: {
        lockEvents: {
          type: "lock",
          source: "nudge",
          timestamp: now,
        },
      },
    }),
    FocusSession.create({
      userId: userObjectId,
      modeId: nudge.modeId,
      nudgeId: nudge._id,
      startTime: now,
      status: "active",
    }),
  ]);

  if (!nudge.creatorId.equals(userObjectId)) {
    User.findById(userId)
      .select("name")
      .lean()
      .then((joiningUser) => {
        sendNotifications({
          title: "Nudge Invitation Accepted",
          text: `${joiningUser?.name || "A friend"} joined your focus session (Nudge).`,
          receiver: nudge.creatorId.toString(),
          sender: userId,
          type: NOTIFICATION_TYPE.USER,
          referenceId: nudge._id.toString(),
          referenceModel: NOTIFICATION_REFERENCE_MODEL.NUDGE,
        }).catch(() => {});
      })
      .catch(() => {});
  }

  return result;
};

const getNudgeHistoryFromDB = async (
  userId: string,
  page: number,
  limit: number,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const skip = (page - 1) * limit;

  const query = {
    $or: [
      { creatorId: userObjectId },
      {
        "participants.userId": userObjectId,
        "participants.isDeleted": { $ne: true },
      },
    ],
    isDeleted: { $ne: true },
  };

  const [nudges, total] = await Promise.all([
    Nudge.find(query)
      .populate("creatorId", "name profileImage")
      .populate("participants.userId", "name profileImage")
      .populate("joinedParticipants.userId", "name profileImage")
      .populate("modeId", "name")
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Nudge.countDocuments(query),
  ]);

  return {
    meta: { page, limit, total },
    data: nudges,
  };
};

const removeFriendFromDB = async (userId: string, friendId: string) => {
  const result = await Friend.deleteMany({
    $or: [
      {
        userId: new mongoose.Types.ObjectId(userId),
        friendId: new mongoose.Types.ObjectId(friendId),
      },
      {
        userId: new mongoose.Types.ObjectId(friendId),
        friendId: new mongoose.Types.ObjectId(userId),
      },
    ],
  });

  if (result.deletedCount === 0) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Friend relationship not found");
  }

  return result;
};

const oldAddFriendToDB = async (userId: string, friendId: string) => {
  if (userId === friendId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot add yourself as a friend",
    );
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friendObjectId = new mongoose.Types.ObjectId(friendId);

  const [userExists, existingFriend, sender] = await Promise.all([
    User.findById(friendId).select("_id").lean(),
    Friend.findOne({
      $or: [
        { userId: userObjectId, friendId: friendObjectId },
        { userId: friendObjectId, friendId: userObjectId },
      ],
      isDeleted: { $ne: true },
    }),
    User.findById(userId).select("name").lean(),
  ]);

  if (!userExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (existingFriend) {
    if (existingFriend.status === "accepted") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "You are already friends");
    }
    existingFriend.status = "accepted";
    await existingFriend.save();

    sendNotifications({
      title: "New Friend Connected",
      text: `${sender?.name || "Someone"} connected with you as a friend.`,
      receiver: friendId,
      sender: userId,
      type: NOTIFICATION_TYPE.USER,
      referenceId: existingFriend._id.toString(),
      referenceModel: NOTIFICATION_REFERENCE_MODEL.USER,
    }).catch(() => {});

    return existingFriend;
  }

  const result = await Friend.create({
    userId: userObjectId,
    friendId: friendObjectId,
    status: "accepted",
  });

  sendNotifications({
    title: "New Friend Connected",
    text: `${sender?.name || "Someone"} connected with you as a friend.`,
    receiver: friendId,
    sender: userId,
    type: NOTIFICATION_TYPE.USER,
    referenceId: result._id.toString(),
    referenceModel: NOTIFICATION_REFERENCE_MODEL.USER,
  }).catch(() => {});

  return result;
};

const unlockNudgeInDB = async (userId: string, nudgeId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  const session = await FocusSession.findOne({
    userId: userObjectId,
    nudgeId: nudgeObjectId,
    status: "active",
  });

  if (!session) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Active focus session not found for this nudge",
    );
  }

  const endTime = new Date();
  const durationMinutes = Math.round(
    (endTime.getTime() - session.startTime.getTime()) / 60000,
  );

  const [result] = await Promise.all([
    Nudge.findByIdAndUpdate(
      nudgeId,
      {
        $set: {
          "joinedParticipants.$[elem].isDeleted": true,
          "joinedParticipants.$[elem].deletedAt": endTime,
        },
      },
      {
        new: true,
        arrayFilters: [
          { "elem.userId": userObjectId, "elem.isDeleted": false },
        ],
      },
    ),
    FocusSession.findByIdAndUpdate(
      session._id,
      { status: "completed", endTime, durationMinutes },
      { new: true },
    ),
    session.modeId
      ? Mode.findByIdAndUpdate(session.modeId, {
          $set: { isActive: false },
          $push: {
            lockEvents: {
              type: "unlock",
              source: "nudge",
              timestamp: endTime,
            },
          },
        })
      : Promise.resolve(),
  ]);

  if (result) {
    const activeJoinedCount = result.joinedParticipants.filter(
      (p) => !p.isDeleted,
    ).length;
    if (activeJoinedCount === 0) {
      await Nudge.findByIdAndUpdate(nudgeId, { status: "completed" });
    }
  }

  return result;
};

const takeNudgeBreakInDB = async (
  userId: string,
  nudgeId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  const [nudge, activeSession, activeBreak] = await Promise.all([
    Nudge.findById(nudgeId).lean(),
    FocusSession.findOne({
      userId: userObjectId,
      nudgeId: nudgeObjectId,
      status: "active",
    }).lean(),
    Break.findOne({
      userId: userObjectId,
      status: { $in: ["active", "paused"] },
      $or: [
        { status: "active", endTime: { $gt: new Date() } },
        { status: "paused" },
      ],
    }).lean(),
  ]);

  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  if (!activeSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You don't have an active focus session in this nudge",
    );
  }

  if (activeBreak) {
    if (activeBreak.status === "paused") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You have a paused break. Please resume or stop it first.",
      );
    }
    if (
      activeBreak.nudgeId &&
      activeBreak.nudgeId.toString() === nudgeObjectId.toString()
    ) {
      const now = new Date();
      const elapsedMinutes =
        (now.getTime() - new Date(activeBreak.startTime).getTime()) / 60000;
      const durationLimit = nudge.breakConfig?.breakDurationMinutes || 0;
      const remainingMinutes = Math.max(
        0,
        Math.ceil(durationLimit - elapsedMinutes),
      );
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `You are already on a break. Please wait ${remainingMinutes} more minute(s) for it to finish automatically.`,
      );
    }
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot take a break when you are already in an unlocked state",
    );
  }

  const startOfDay = getZonedStartOfDay(new Date(), userTimezone);
  const endOfDay = getZonedEndOfDay(new Date(), userTimezone);

  const breaksTodayCount = await Break.countDocuments({
    userId: userObjectId,
    nudgeId: nudgeObjectId,
    startTime: { $gte: startOfDay, $lte: endOfDay },
  });

  const maxBreaks = nudge.breakConfig?.breaksPerDay || 0;
  const remainingBreaks = maxBreaks - breaksTodayCount;

  if (remainingBreaks <= 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `You have reached your daily break limit of ${maxBreaks} for this nudge. No breaks remaining today.`,
    );
  }

  const startTime = new Date();
  const breakDurationMinutes = nudge.breakConfig?.breakDurationMinutes || 0;
  const endTime = new Date(startTime.getTime() + breakDurationMinutes * 60000);

  const createdBreak = await Break.create({
    userId: userObjectId,
    modeId: nudge.modeId,
    nudgeId: nudgeObjectId,
    startTime,
    endTime,
    totalDurationMinutes: breakDurationMinutes,
    remainingSeconds: breakDurationMinutes * 60,
    durationMinutes: 0,
    status: "active",
  });

  return {
    break: createdBreak,
    remainingBreaks: remainingBreaks - 1,
    breakDurationMinutes,
    message: `Break started. You have ${breakDurationMinutes} minutes. After this, apps will lock again.`,
  };
};

const getCurrentNudgeStatusInDB = async (
  userId: string,
  userTimezone: string = DEFAULT_TIMEZONE,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const nudge = await Nudge.findOne({
    status: { $in: ["active", "scheduled"] },
    $or: [
      { creatorId: userObjectId },
      {
        "participants.userId": userObjectId,
        "participants.isDeleted": { $ne: true },
      },
    ],
  })
    .sort({ status: 1, createdAt: -1 })
    .populate("creatorId", "name profileImage email")
    .populate("participants.userId", "name profileImage email")
    .populate("joinedParticipants.userId", "name profileImage email")
    .populate("modeId");

  if (!nudge) {
    return {
      isActive: false,
      message: "No active nudge session found",
    };
  }

  const creatorIdStr =
    nudge.creatorId != null
      ? ((nudge.creatorId as any)?._id?.toString() ??
        nudge.creatorId.toString())
      : null;

  const isCreator = creatorIdStr === userId;
  const creatorJoinedEntry = nudge.joinedParticipants.find(
    (p) =>
      p.userId != null &&
      ((p.userId as any)._id || p.userId).toString() === userId,
  );

  if (isCreator && !creatorJoinedEntry && nudge.status === "active") {
    await Nudge.findByIdAndUpdate(nudge._id, {
      $addToSet: {
        joinedParticipants: { userId: userObjectId, isDeleted: false },
      },
    });
    nudge.joinedParticipants.push({
      userId: userObjectId,
      isDeleted: false,
    } as any);
  }

  const isJoined = nudge.joinedParticipants.some(
    (p) =>
      !p.isDeleted &&
      p.userId != null &&
      ((p.userId as any)._id || p.userId).toString() === userId,
  );

  let activeSession = await FocusSession.findOne({
    userId: userObjectId,
    status: "active",
    nudgeId: nudge._id,
  });

  if (!activeSession && isJoined) {
    const now = new Date();
    activeSession = await FocusSession.create({
      userId: userObjectId,
      modeId: (nudge.modeId as any)?._id || nudge.modeId,
      nudgeId: nudge._id,
      startTime: now,
      status: "active",
    });
  }

  const now = new Date();
  const startOfDay = getZonedStartOfDay(now, userTimezone);
  const endOfDay = getZonedEndOfDay(now, userTimezone);
  const startOfWeek = getZonedStartOfWeek(now, userTimezone);

  // Execute independent queries concurrently with Promise.all
  const [
    currentUser,
    activeBreaksForNudge,
    breaksTakenToday,
    sessionsThisWeek,
    breaksThisWeek,
  ] = await Promise.all([
    User.findById(userId).select("installedApps").lean(),
    Break.find({
      nudgeId: nudge._id,
      status: "active",
      endTime: { $gt: now },
    })
      .select("userId")
      .lean(),
    Break.countDocuments({
      userId: userObjectId,
      nudgeId: nudge._id,
      startTime: { $gte: startOfDay, $lte: endOfDay },
    }),
    FocusSession.find({
      userId: userObjectId,
      nudgeId: { $exists: true, $ne: null },
      startTime: { $gte: startOfWeek },
    }).lean(),
    Break.find({
      userId: userObjectId,
      nudgeId: { $exists: true, $ne: null },
      createdAt: { $gte: startOfWeek },
    }).lean(),
  ]);

  const activeBreakUserIds = new Set(
    activeBreaksForNudge.map((b) => b.userId.toString()),
  );

  const installedAppPackages = new Set(
    (currentUser?.installedApps || []).map((app) => app.packageName),
  );

  const modeLockedApps = (nudge.modeId as any)?.lockedApps || [];
  const filteredLockedApps = modeLockedApps.filter((app: any) =>
    installedAppPackages.has(app.packageName),
  );

  const isUserOnBreak = activeSession ? activeBreakUserIds.has(userId) : false;
  const isLocked = isJoined ? !isUserOnBreak : false;

  const totalAllowedBreaks = nudge.breakConfig?.breaksPerDay || 0;
  const remainingBreaks = Math.max(0, totalAllowedBreaks - breaksTakenToday);

  let todayFocusMinutes = 0;
  let weekFocusMinutes = 0;

  sessionsThisWeek.forEach((session) => {
    const duration =
      session.status === "completed"
        ? session.durationMinutes || 0
        : Math.round(
            (new Date().getTime() - new Date(session.startTime).getTime()) / 60000,
          );
    weekFocusMinutes += duration;
    if (new Date(session.startTime) >= startOfDay) todayFocusMinutes += duration;
  });

  breaksThisWeek.forEach((breakItem) => {
    const duration =
      breakItem.status === "completed"
        ? breakItem.durationMinutes || 0
        : Math.round(
            (new Date().getTime() - new Date(breakItem.startTime).getTime()) / 60000,
          );
    weekFocusMinutes -= duration;
    if (new Date(breakItem.startTime) >= startOfDay) todayFocusMinutes -= duration;
  });

  todayFocusMinutes = Math.max(0, todayFocusMinutes);
  weekFocusMinutes = Math.max(0, weekFocusMinutes);

  const activeParticipants = nudge.participants.filter(
    (p) => !p.isDeleted && p.userId != null,
  );

  const participantsWithStatus = activeParticipants.map((participant: any) => {
    const participantId = participant.userId._id || participant.userId;
    const pIdStr = participantId.toString();

    const isParticipantJoined = nudge.joinedParticipants.some(
      (p: any) =>
        !p.isDeleted &&
        p.userId != null &&
        ((p.userId._id || p.userId).toString() === pIdStr),
    );

    const isOnBreak = activeBreakUserIds.has(pIdStr);

    return {
      _id: participant.userId._id || participant.userId,
      name: participant.userId.name ?? null,
      profileImage: participant.userId.profileImage ?? null,
      email: participant.userId.email ?? null,
      isJoined: isParticipantJoined,
      isFocused: isParticipantJoined && !isOnBreak,
      isOnBreak,
    };
  });

  const activeJoinedParticipants = nudge.joinedParticipants.filter(
    (p) => !p.isDeleted && p.userId != null,
  );

  const joinedParticipantsWithStatus = activeJoinedParticipants.map(
    (participant: any) => {
      const participantId = participant.userId._id || participant.userId;
      const pIdStr = participantId.toString();
      const isOnBreak = activeBreakUserIds.has(pIdStr);

      return {
        _id: participant.userId._id || participant.userId,
        name: participant.userId.name ?? null,
        profileImage: participant.userId.profileImage ?? null,
        email: participant.userId.email ?? null,
        isFocused: !isOnBreak,
        isOnBreak,
      };
    },
  );

  return {
    isActive: isJoined,
    nudgeId: nudge._id,
    modeId: nudge.modeId?._id || nudge.modeId,
    modeName: (nudge.modeId as any)?.name || "Nudge Mode",
    creator: nudge.creatorId,
    participants: participantsWithStatus,
    joinedParticipants: joinedParticipantsWithStatus,
    isJoined,
    isLocked,
    isOnBreak: isUserOnBreak,
    remainingBreaks,
    breakDurationMinutes: nudge.breakConfig?.breakDurationMinutes || 0,
    startTime: nudge.startTime,
    totalLockedApps: filteredLockedApps.length,
    todayFocusMinutes,
    weekFocusMinutes,
    lockedApps: filteredLockedApps,
    focusSessionId: activeSession ? activeSession._id : null,
  };
};

const sendFriendRequestInDB = async (userId: string, friendId: string) => {
  if (userId === friendId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot send a friend request to yourself",
    );
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friendObjectId = new mongoose.Types.ObjectId(friendId);

  const [receiverUser, existingFriend, sender] = await Promise.all([
    User.findOne({
      _id: friendObjectId,
      isDeleted: { $ne: true },
    })
      .select("_id")
      .lean(),
    Friend.findOne({
      $or: [
        { userId: userObjectId, friendId: friendObjectId },
        { userId: friendObjectId, friendId: userObjectId },
      ],
      isDeleted: { $ne: true },
    }),
    User.findById(userId).select("name").lean(),
  ]);

  if (!receiverUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (existingFriend) {
    if (existingFriend.status === "accepted") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "You are already friends");
    }

    if (existingFriend.status === "pending") {
      if (existingFriend.userId.equals(userObjectId)) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          "Friend request already sent and is pending approval",
        );
      } else {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "This user has already sent you a friend request. Please accept their request.",
        );
      }
    }

    // If status was 'rejected' or 'cancelled', re-initiate as pending from current user
    existingFriend.userId = userObjectId;
    existingFriend.friendId = friendObjectId;
    existingFriend.status = "pending";
    await existingFriend.save();

    sendNotifications({
      title: "New Friend Request",
      text: `${sender?.name || "Someone"} sent you a friend request.`,
      receiver: friendId,
      sender: userId,
      type: NOTIFICATION_TYPE.USER,
      referenceId: existingFriend._id.toString(),
      referenceModel: NOTIFICATION_REFERENCE_MODEL.USER,
    }).catch(() => {});

    return existingFriend;
  }

  const result = await Friend.create({
    userId: userObjectId,
    friendId: friendObjectId,
    status: "pending",
  });

  sendNotifications({
    title: "New Friend Request",
    text: `${sender?.name || "Someone"} sent you a friend request.`,
    receiver: friendId,
    sender: userId,
    type: NOTIFICATION_TYPE.USER,
    referenceId: result._id.toString(),
    referenceModel: NOTIFICATION_REFERENCE_MODEL.USER,
  }).catch(() => {});

  return result;
};

const addFriendToDB = async (userId: string, friendId: string) => {
  return await sendFriendRequestInDB(userId, friendId);
};

const getReceivedFriendRequestsFromDB = async (
  userId: string,
  page: number = 1,
  limit: number = 10,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const skip = (page - 1) * limit;

  const query = {
    friendId: userObjectId,
    status: "pending",
    isDeleted: { $ne: true },
  };

  const [requests, total] = await Promise.all([
    Friend.find(query)
      .populate("userId", "name userName profileImage email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Friend.countDocuments(query),
  ]);

  const formattedData = requests.map((req: any) => ({
    _id: req._id,
    status: req.status,
    createdAt: req.createdAt,
    sender: req.userId,
  }));

  return {
    meta: { page, limit, total },
    data: formattedData,
  };
};

const getSentFriendRequestsFromDB = async (
  userId: string,
  page: number = 1,
  limit: number = 10,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const skip = (page - 1) * limit;

  const query = {
    userId: userObjectId,
    status: "pending",
    isDeleted: { $ne: true },
  };

  const [requests, total] = await Promise.all([
    Friend.find(query)
      .populate("friendId", "name userName profileImage email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Friend.countDocuments(query),
  ]);

  const formattedData = requests.map((req: any) => ({
    _id: req._id,
    status: req.status,
    createdAt: req.createdAt,
    recipient: req.friendId,
  }));

  return {
    meta: { page, limit, total },
    data: formattedData,
  };
};

const acceptFriendRequestInDB = async (
  userId: string,
  requestIdOrSenderId: string,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let requestDoc = null;

  if (mongoose.Types.ObjectId.isValid(requestIdOrSenderId)) {
    const targetObjectId = new mongoose.Types.ObjectId(requestIdOrSenderId);
    requestDoc = await Friend.findOne({
      $or: [
        { _id: targetObjectId, friendId: userObjectId, status: "pending" },
        { userId: targetObjectId, friendId: userObjectId, status: "pending" },
      ],
      isDeleted: { $ne: true },
    });
  }

  if (!requestDoc) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Pending friend request not found",
    );
  }

  requestDoc.status = "accepted";
  await requestDoc.save();

  User.findById(userId)
    .select("name")
    .lean()
    .then((receiver) => {
      sendNotifications({
        title: "Friend Request Accepted",
        text: `${receiver?.name || "Someone"} accepted your friend request.`,
        receiver: requestDoc.userId.toString(),
        sender: userId,
        type: NOTIFICATION_TYPE.USER,
        referenceId: requestDoc._id.toString(),
        referenceModel: NOTIFICATION_REFERENCE_MODEL.USER,
      }).catch(() => {});
    })
    .catch(() => {});

  return requestDoc;
};

const rejectFriendRequestInDB = async (
  userId: string,
  requestIdOrSenderId: string,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let requestDoc = null;

  if (mongoose.Types.ObjectId.isValid(requestIdOrSenderId)) {
    const targetObjectId = new mongoose.Types.ObjectId(requestIdOrSenderId);
    requestDoc = await Friend.findOne({
      $or: [
        { _id: targetObjectId, friendId: userObjectId, status: "pending" },
        { userId: targetObjectId, friendId: userObjectId, status: "pending" },
      ],
      isDeleted: { $ne: true },
    });
  }

  if (!requestDoc) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Pending friend request not found",
    );
  }

  requestDoc.status = "rejected";
  await requestDoc.save();

  return { message: "Friend request rejected successfully" };
};

const cancelFriendRequestInDB = async (
  userId: string,
  requestIdOrReceiverId: string,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let requestDoc = null;

  if (mongoose.Types.ObjectId.isValid(requestIdOrReceiverId)) {
    const targetObjectId = new mongoose.Types.ObjectId(requestIdOrReceiverId);
    requestDoc = await Friend.findOne({
      $or: [
        { _id: targetObjectId, userId: userObjectId, status: "pending" },
        { userId: userObjectId, friendId: targetObjectId, status: "pending" },
      ],
      isDeleted: { $ne: true },
    });
  }

  if (!requestDoc) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Pending friend request not found or cannot be cancelled",
    );
  }

  requestDoc.status = "cancelled";
  await requestDoc.save();

  return { message: "Friend request cancelled successfully" };
};

const handleFriendRequestActionInDB = async (
  userId: string,
  payload: {
    requestId?: string;
    friendId?: string;
    action?: string;
    status?: string;
  },
) => {
  const { requestId, friendId } = payload;
  const rawAction = (payload.action || payload.status || "")
    .toLowerCase()
    .trim();

  const identifier = requestId || friendId;
  if (!identifier) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "requestId or friendId is required in request body",
    );
  }

  if (["accept", "accepted"].includes(rawAction)) {
    const data = await acceptFriendRequestInDB(userId, identifier);
    return {
      message: "Friend request accepted successfully",
      data,
    };
  } else if (["reject", "rejected"].includes(rawAction)) {
    const result = await rejectFriendRequestInDB(userId, identifier);
    return {
      message: result.message || "Friend request rejected successfully",
      data: null,
    };
  } else if (["cancel", "cancelled", "canceled"].includes(rawAction)) {
    const result = await cancelFriendRequestInDB(userId, identifier);
    return {
      message: result.message || "Friend request cancelled successfully",
      data: null,
    };
  } else {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid action. Supported actions: 'accept', 'reject', 'cancel' (or status: 'accepted', 'rejected', 'cancelled')",
    );
  }
};

const getFriendsFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friends = await Friend.find({
    $or: [{ userId: userObjectId }, { friendId: userObjectId }],
    status: "accepted",
    isDeleted: { $ne: true },
  })
    .populate("userId friendId", "name userName profileImage email")
    .lean();

  const friendsData = friends
    .filter((f) => f.userId && f.friendId)
    .map((f) => {
      const otherUser: any =
        (f.userId as any)._id.toString() === userId ? f.friendId : f.userId;
      return otherUser;
    });

  if (friendsData.length === 0) {
    return [];
  }

  const friendIds = friendsData.map(
    (friend: any) => new mongoose.Types.ObjectId(friend._id.toString()),
  );
  const now = new Date();

  // Fetch active sessions, active breaks, and last completed sessions in parallel
  const [activeSessions, activeBreaks, lastSessionsMap] = await Promise.all([
    FocusSession.find({
      userId: { $in: friendIds },
      status: "active",
    })
      .select("userId")
      .lean(),
    Break.find({
      userId: { $in: friendIds },
      status: "active",
      endTime: { $gt: now },
    })
      .select("userId")
      .lean(),
    batchGetLastFocusSessions(friendIds),
  ]);

  const activeSessionSet = new Set(
    activeSessions.map((s) => s.userId.toString()),
  );
  const activeBreakSet = new Set(
    activeBreaks.map((b) => b.userId.toString()),
  );

  const friendsWithStatus = friendsData.map((friend: any) => {
    const friendIdStr = friend._id.toString();
    const hasActiveSession = activeSessionSet.has(friendIdStr);
    const hasActiveBreak = activeBreakSet.has(friendIdStr);
    const isLocked = hasActiveSession ? !hasActiveBreak : false;

    const lastFocusInfo = formatLastFocusString(
      lastSessionsMap.get(friendIdStr),
      now,
    );

    return {
      _id: friend._id,
      name: friend.name,
      userName: friend.userName || friend.email?.split("@")[0] || "user",
      profileImage: friend.profileImage || "",
      email: friend.email || "",
      isLocked,
      lastFocusInfo: isLocked ? "Focusing now" : lastFocusInfo,
    };
  });

  return friendsWithStatus;
};

const removeNudgeParticipantFromDB = async (
  userId: string,
  previewId: string,
  participantId: string,
) => {
  const participantObjectId = new mongoose.Types.ObjectId(participantId);

  const preview = await NudgePreview.findById(previewId);
  if (!preview) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge preview not found");
  }

  if (preview.creatorId.toString() !== userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only the nudge creator can remove a participant",
    );
  }

  const isParticipantInPreview = preview.participants.some(
    (p) => p.toString() === participantId,
  );
  if (!isParticipantInPreview) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Participant not found in this nudge preview",
    );
  }

  await NudgePreview.findByIdAndUpdate(
    previewId,
    { $pull: { participants: participantObjectId } },
    { new: true },
  );

  if (preview.status === "confirmed") {
    const nudge = await Nudge.findOne({ creatorId: preview.creatorId })
      .sort({ createdAt: -1 })
      .where("participants.userId")
      .equals(participantObjectId);

    if (nudge) {
      const nudgeObjectId = nudge._id as mongoose.Types.ObjectId;
      const endTime = new Date();

      const session = await FocusSession.findOne({
        userId: participantObjectId,
        nudgeId: nudgeObjectId,
        status: "active",
      });

      if (session) {
        const durationMinutes = Math.round(
          (endTime.getTime() - session.startTime.getTime()) / 60000,
        );

        await FocusSession.findByIdAndUpdate(
          session._id,
          { status: "completed", endTime, durationMinutes },
          { new: true },
        );

        if (session.modeId) {
          await Mode.findByIdAndUpdate(session.modeId, {
            $set: { isActive: false },
            $push: {
              lockEvents: {
                type: "unlock",
                source: "nudge",
                timestamp: endTime,
              },
            },
          });
        }
      }

      const result = await Nudge.findByIdAndUpdate(
        nudgeObjectId,
        {
          $set: {
            "joinedParticipants.$[elemJ].isDeleted": true,
            "joinedParticipants.$[elemJ].deletedAt": endTime,
            "participants.$[elemP].isDeleted": true,
            "participants.$[elemP].deletedAt": endTime,
          },
        },
        {
          new: true,
          arrayFilters: [
            { "elemJ.userId": participantObjectId },
            { "elemP.userId": participantObjectId },
          ],
        },
      );

      if (result) {
        const activeJoinedCount = result.joinedParticipants.filter(
          (p) => !p.isDeleted,
        ).length;
        if (activeJoinedCount === 0) {
          await Nudge.findByIdAndUpdate(nudgeObjectId, { status: "completed" });
        }
      }
    }
  }

  return { message: "Participant removed successfully" };
};

const leaveNudgeInDB = async (userId: string, nudgeId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  const nudge = await Nudge.findById(nudgeId);
  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  if (nudge.status === "completed") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This nudge is already completed",
    );
  }

  const isCreator = nudge.creatorId.equals(userObjectId);
  const isParticipant = nudge.participants.some(
    (p) => !p.isDeleted && p.userId.equals(userObjectId),
  );

  if (!isCreator && !isParticipant) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not part of this nudge");
  }

  const activeSession = await FocusSession.findOne({
    userId: userObjectId,
    nudgeId: nudgeObjectId,
    status: "active",
  });

  const endTime = new Date();

  if (activeSession) {
    const durationMinutes = Math.round(
      (endTime.getTime() - activeSession.startTime.getTime()) / 60000,
    );
    await FocusSession.findByIdAndUpdate(
      activeSession._id,
      { status: "completed", endTime, durationMinutes },
      { new: true },
    );

    if (activeSession.modeId) {
      await Mode.findByIdAndUpdate(activeSession.modeId, {
        $set: { isActive: false },
        $push: {
          lockEvents: {
            type: "unlock",
            source: "nudge",
            timestamp: endTime,
          },
        },
      });
    }
  }

  const result = await Nudge.findByIdAndUpdate(
    nudgeId,
    {
      $set: {
        "joinedParticipants.$[elemJ].isDeleted": true,
        "joinedParticipants.$[elemJ].deletedAt": endTime,
        "participants.$[elemP].isDeleted": true,
        "participants.$[elemP].deletedAt": endTime,
      },
    },
    {
      new: true,
      arrayFilters: [
        { "elemJ.userId": userObjectId },
        { "elemP.userId": userObjectId },
      ],
    },
  );

  if (result) {
    const activeJoinedCount = result.joinedParticipants.filter(
      (p) => !p.isDeleted,
    ).length;
    if (activeJoinedCount === 0) {
      await Nudge.findByIdAndUpdate(nudgeId, { status: "completed" });
    }
  }

  return { message: "You have left the nudge successfully" };
};

const getPendingNudgePreviewInDB = async (userId: string) => {
  const preview = await NudgePreview.findOne({
    creatorId: new mongoose.Types.ObjectId(userId),
    status: "pending",
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .populate("participants", "name userName profileImage email")
    .populate("modeId", "name iconType")
    .lean();

  if (!preview) {
    return {
      hasPendingPreview: false,
      preview: null,
    };
  }

  const remainingMs = new Date(preview.expiresAt).getTime() - Date.now();
  const remainingMinutes = Math.max(0, Math.ceil(remainingMs / 60000));

  return {
    hasPendingPreview: true,
    preview: {
      previewId: preview._id,
      status: preview.status,
      expiresAt: preview.expiresAt,
      remainingMinutes,
      mode: preview.modeId,
      breakConfig: preview.breakConfig,
      participants: (preview.participants as any[])
        .filter((p) => p != null)
        .map((p) => ({
          _id: p._id,
          name: p.name,
          userName: p.userName || p.email?.split("@")[0] || "user",
          profileImage: p.profileImage || "",
          email: p.email || "",
        })),
    },
  };
};

export const FriendsService = {
  getUsersFromDB,
  initiateNudgePreviewInDB,
  getNudgePreviewDetailsFromDB,
  confirmNudgeFromPreviewInDB,
  getPendingNudgePreviewInDB,
  joinNudgeInDB,
  getNudgeHistoryFromDB,
  removeFriendFromDB,
  unlockNudgeInDB,
  takeNudgeBreakInDB,
  getCurrentNudgeStatusInDB,
  addFriendToDB,
  oldAddFriendToDB,
  sendFriendRequestInDB,
  getReceivedFriendRequestsFromDB,
  getSentFriendRequestsFromDB,
  acceptFriendRequestInDB,
  rejectFriendRequestInDB,
  cancelFriendRequestInDB,
  handleFriendRequestActionInDB,
  getFriendsFromDB,
  removeNudgeParticipantFromDB,
  leaveNudgeInDB,
};
