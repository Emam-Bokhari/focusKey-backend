import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Friend, Nudge, NudgePreview } from "./friends.model";
import { INudge } from "./friends.interface";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break } from "../breaks/breaks.model";
import { emailHelper } from "../../../helpers/emailHelper";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import config from "../../../config";
import { Mode } from "../modes/modes.model";

const NUDGE_PREVIEW_TTL_MINUTES = 10;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Helper: build last focus info string ──────────────────────────────────────

const buildLastFocusInfo = async (userId: mongoose.Types.ObjectId): Promise<string> => {
  const now = new Date();
  const lastSession = await FocusSession.findOne({
    userId,
    status: "completed",
  }).sort({ endTime: -1 });

  if (!lastSession || !lastSession.endTime) return "No focus history";

  const diffMs = now.getTime() - lastSession.endTime.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) {
    const lastSessionDate = new Date(lastSession.endTime);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      lastSessionDate.getDate() === yesterday.getDate() &&
      lastSessionDate.getMonth() === yesterday.getMonth() &&
      lastSessionDate.getFullYear() === yesterday.getFullYear();

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

// ─── Helper: compute shared focus stats between two users (last 7 days) ────────

const computeSharedFocusStats = async (
  creatorId: mongoose.Types.ObjectId,
  participantId: mongoose.Types.ObjectId,
) => {
  const highlightedDays: string[] = [];
  let totalTogetherMinutes = 0;

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const startOfDay = new Date(date);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dayName = DAY_NAMES[date.getDay()];

    const [creatorSessions, participantSessions] = await Promise.all([
      FocusSession.find({
        userId: creatorId,
        status: "completed",
        startTime: { $lte: endOfDay },
        endTime: { $gte: startOfDay },
      }),
      FocusSession.find({
        userId: participantId,
        status: "completed",
        startTime: { $lte: endOfDay },
        endTime: { $gte: startOfDay },
      }),
    ]);

    if (creatorSessions.length === 0 || participantSessions.length === 0) continue;

    // Calculate total minutes both focused on this day
    let sharedMinutes = 0;
    for (const cs of creatorSessions) {
      for (const ps of participantSessions) {
        const overlapStart = Math.max(
          cs.startTime.getTime(),
          ps.startTime.getTime(),
          startOfDay.getTime(),
        );
        const overlapEnd = Math.min(
          (cs.endTime || endOfDay).getTime(),
          (ps.endTime || endOfDay).getTime(),
          endOfDay.getTime(),
        );
        if (overlapEnd > overlapStart) {
          sharedMinutes += Math.round((overlapEnd - overlapStart) / 60000);
        }
      }
    }

    // Even if no exact overlap, if both focused same day → highlight day
    // Use sum of min(creator, participant) duration for that day as a proxy
    if (sharedMinutes === 0) {
      const creatorMin = creatorSessions.reduce(
        (acc, s) => acc + (s.durationMinutes || 0),
        0,
      );
      const participantMin = participantSessions.reduce(
        (acc, s) => acc + (s.durationMinutes || 0),
        0,
      );
      sharedMinutes = Math.min(creatorMin, participantMin);
    }

    highlightedDays.push(dayName);
    totalTogetherMinutes += sharedMinutes;
  }

  // Compute streak: consecutive highlighted days ending today/yesterday
  let streak = 0;
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayName = DAY_NAMES[date.getDay()];
    if (highlightedDays.includes(dayName)) {
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

  return {
    togetherThisWeek: togetherFormatted,
    streak,
    highlightedDays,
    totalTogetherMinutes,
  };
};

// ─── getUsersFromDB ─────────────────────────────────────────────────────────────

const getUsersFromDB = async (
  userId: string,
  searchTerm: string,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const query: any = {
    _id: { $ne: new mongoose.Types.ObjectId(userId) },
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

  const users = await User.find(query)
    .select("name userName profileImage email")
    .skip(skip)
    .limit(limit)
    .lean();

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friends = await Friend.find({
    $or: [{ userId: userObjectId }, { friendId: userObjectId }],
    status: "accepted",
    isDeleted: { $ne: true },
  });
  const friendIdsSet = new Set(
    friends.map((f) =>
      f.userId.equals(userObjectId) ? f.friendId.toString() : f.userId.toString()
    )
  );

  const now = new Date();
  const usersWithStatus = await Promise.all(
    users.map(async (user) => {
      const activeSession = await FocusSession.findOne({
        userId: user._id,
        status: "active",
      });

      const activeBreak = await Break.findOne({
        userId: user._id,
        status: "active",
        endTime: { $gt: now },
      });

      const isLocked = activeSession ? !activeBreak : false;
      const lastFocusInfo = await buildLastFocusInfo(new mongoose.Types.ObjectId(user._id.toString()));
      const userName = user.userName || user.email?.split("@")[0] || "user";

      return {
        ...user,
        userName,
        isFriend: friendIdsSet.has(user._id.toString()),
        isLocked,
        lastFocusInfo: isLocked ? "Focusing now" : lastFocusInfo,
      };
    }),
  );

  const total = await User.countDocuments(query);

  return {
    meta: { page, limit, total },
    data: usersWithStatus,
  };
};

// ─── initiateNudgePreviewInDB ───────────────────────────────────────────────────

const initiateNudgePreviewInDB = async (
  userId: string,
  payload: { participants: string[]; modeId: string; breakConfig: { breaksPerDay: number; breakDurationMinutes: number } },
) => {
  const { participants, modeId, breakConfig } = payload;

  if (!participants || participants.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "At least one friend must be selected");
  }

  // Block if a pending preview already exists
  const existingPreview = await NudgePreview.findOne({
    creatorId: new mongoose.Types.ObjectId(userId),
    status: "pending",
    expiresAt: { $gt: new Date() },
  });

  if (existingPreview) {
    const remainingMs = existingPreview.expiresAt.getTime() - Date.now();
    const remainingMinutes = Math.max(0, Math.ceil(remainingMs / 60000));
    throw new ApiError(
      StatusCodes.CONFLICT,
      `You already have a pending nudge preview. Please confirm or wait for it to expire (${remainingMinutes} min remaining). Preview ID: ${existingPreview._id}`,
    );
  }

  const creatorActiveSession = await FocusSession.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
  });

  if (creatorActiveSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot send a nudge while you are in a focus session",
    );
  }

  const focusedParticipants = await FocusSession.find({
    userId: { $in: participants.map((id) => new mongoose.Types.ObjectId(id)) },
    status: "active",
  }).populate("userId", "name");

  if (focusedParticipants.length > 0) {
    const focusedNames = focusedParticipants.map((s: any) => s.userId?.name).join(", ");
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot send nudge. The following users are currently in a focus session: ${focusedNames}`,
    );
  }

  const expiresAt = new Date(Date.now() + NUDGE_PREVIEW_TTL_MINUTES * 60 * 1000);

  const preview = await NudgePreview.create({
    creatorId: new mongoose.Types.ObjectId(userId),
    participants: participants.map((id) => new mongoose.Types.ObjectId(id)),
    modeId: new mongoose.Types.ObjectId(modeId),
    breakConfig,
    status: "pending",
    expiresAt,
  });

  return {
    previewId: preview._id,
    expiresAt,
    expiresInMinutes: NUDGE_PREVIEW_TTL_MINUTES,
  };
};

// ─── getNudgePreviewDetailsFromDB ───────────────────────────────────────────────

const getNudgePreviewDetailsFromDB = async (userId: string, previewId: string) => {
  const preview = await NudgePreview.findById(previewId)
    .populate("participants", "name userName profileImage email")
    .populate("modeId", "name iconType lockedApps");

  if (!preview) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge preview not found or expired");
  }

  if (preview.creatorId.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You do not have access to this preview");
  }

  if (preview.status === "confirmed") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This nudge has already been confirmed");
  }

  if (preview.status === "expired" || new Date() > preview.expiresAt) {
    if (preview.status !== "expired") {
      await NudgePreview.findByIdAndUpdate(previewId, { status: "expired" });
    }
    throw new ApiError(StatusCodes.GONE, "This nudge preview has expired. Please initiate again");
  }

  const creatorId = new mongoose.Types.ObjectId(userId);

  const participantsWithDetails = await Promise.all(
    (preview.participants as any[]).map(async (participant) => {
      const participantId = new mongoose.Types.ObjectId(participant._id.toString());

      const activeSession = await FocusSession.findOne({
        userId: participantId,
        status: "active",
      });

      const activeBreak = activeSession
        ? await Break.findOne({
            userId: participantId,
            status: "active",
            endTime: { $gt: new Date() },
          })
        : null;

      const isLocked = activeSession ? !activeBreak : false;
      const lastFocusInfo = await buildLastFocusInfo(participantId);
      const sharedStats = await computeSharedFocusStats(creatorId, participantId);

      return {
        _id: participant._id,
        name: participant.name,
        userName: participant.userName || participant.email?.split("@")[0] || "user",
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
    }),
  );

  const remainingMs = preview.expiresAt.getTime() - Date.now();
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

// ─── confirmNudgeFromPreviewInDB ────────────────────────────────────────────────

const confirmNudgeFromPreviewInDB = async (userId: string, previewId: string) => {
  const preview = await NudgePreview.findById(previewId);

  if (!preview) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge preview not found or expired");
  }

  if (preview.creatorId.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You do not have access to this preview");
  }

  if (preview.status === "confirmed") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This nudge has already been confirmed");
  }

  if (preview.status === "expired" || new Date() > preview.expiresAt) {
    await NudgePreview.findByIdAndUpdate(previewId, { status: "expired" });
    throw new ApiError(StatusCodes.GONE, "This nudge preview has expired. Please initiate again");
  }

  const creatorActiveSession = await FocusSession.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
  });

  if (creatorActiveSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot confirm a nudge while you are in a focus session",
    );
  }

  // Block if creator is already actively joined in another nudge
  const creatorActiveNudge = await Nudge.findOne({
    status: { $in: ["active", "scheduled"] },
    "joinedParticipants": {
      $elemMatch: { userId: new mongoose.Types.ObjectId(userId), isDeleted: false },
    },
  });

  if (creatorActiveNudge) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "You are already part of an active nudge session. Please leave or complete it before starting another.",
    );
  }

  const focusedParticipants = await FocusSession.find({
    userId: { $in: preview.participants.map((id) => new mongoose.Types.ObjectId(id.toString())) },
    status: "active",
  }).populate("userId", "name");

  if (focusedParticipants.length > 0) {
    const focusedNames = focusedParticipants.map((s: any) => s.userId?.name).join(", ");
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot confirm nudge. The following users are now in a focus session: ${focusedNames}`,
    );
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const { participants, modeId, breakConfig } = preview;

  for (const friendId of participants) {
    const existingFriend = await Friend.findOne({
      userId: userObjectId,
      friendId: new mongoose.Types.ObjectId(friendId.toString()),
      isDeleted: { $ne: true },
    });

    if (!existingFriend) {
      await Friend.create({
        userId: userObjectId,
        friendId: new mongoose.Types.ObjectId(friendId.toString()),
        status: "accepted",
      });
    }
  }

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

  await NudgePreview.findByIdAndUpdate(previewId, { status: "confirmed" });

  await Mode.updateMany(
    { userId: userObjectId, isDeleted: false },
    { $set: { isActive: false } },
  );

  const now = new Date();
  await Mode.findByIdAndUpdate(modeId, {
    $set: { isActive: true },
    $push: {
      lockEvents: {
        type: "lock",
        source: "nudge",
        timestamp: now,
      },
    },
  });

  await FocusSession.create({
    userId: userObjectId,
    modeId: new mongoose.Types.ObjectId(modeId.toString()),
    nudgeId: nudge._id,
    startTime: now,
    status: "active",
  });

  const invitedUsers = await User.find({
    _id: { $in: participants.map((id) => new mongoose.Types.ObjectId(id.toString())) },
  });
  const creator = await User.findById(userId);

  for (const user of invitedUsers) {
    if (user.email) {
      await emailHelper.sendEmail({
        to: user.email,
        subject: "New Nudge Invitation",
        html: `
          <p>Hi ${user.name},</p>
          <p><b>${creator?.name}</b> invited you to join a focus session (Nudge).</p>
          <p>Click the link below to join:</p>
          <a href="${config.base_url}/api/v1/friends/join-nudge/${nudge._id}?userId=${user._id}">Join Nudge</a>
        `,
      });
    }
  }

  return nudge;
};

// ─── joinNudgeInDB ──────────────────────────────────────────────────────────────

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
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not invited to this nudge");
  }

  const existingJoined = nudge.joinedParticipants.find(
    (p) => !p.isDeleted && p.userId.equals(userObjectId),
  );
  if (existingJoined) {
    return nudge;
  }

  // Block if user is already actively joined in another nudge
  const activeNudge = await Nudge.findOne({
    _id: { $ne: new mongoose.Types.ObjectId(nudgeId) },
    status: { $in: ["active", "scheduled"] },
    "joinedParticipants": {
      $elemMatch: { userId: userObjectId, isDeleted: false },
    },
  });

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

  const result = await Nudge.findByIdAndUpdate(nudgeId, updateData, { new: true });

  await Mode.updateMany(
    { userId: userObjectId, isDeleted: false },
    { $set: { isActive: false } },
  );

  const now = new Date();
  await Mode.findByIdAndUpdate(nudge.modeId, {
    $set: { isActive: true },
    $push: {
      lockEvents: {
        type: "lock",
        source: "nudge",
        timestamp: now,
      },
    },
  });

  await FocusSession.create({
    userId: userObjectId,
    modeId: nudge.modeId,
    nudgeId: nudge._id,
    startTime: now,
    status: "active",
  });

  return result;
};

// ─── getNudgeHistoryFromDB ──────────────────────────────────────────────────────

const getNudgeHistoryFromDB = async (userId: string, page: number, limit: number) => {
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

  const nudges = await Nudge.find(query)
    .populate("creatorId", "name profileImage")
    .populate("participants.userId", "name profileImage")
    .populate("joinedParticipants.userId", "name profileImage")
    .populate("modeId", "name")
    .sort({ startTime: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Nudge.countDocuments(query);

  return {
    meta: { page, limit, total },
    data: nudges,
  };
};

// ─── removeFriendFromDB ─────────────────────────────────────────────────────────

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

// ─── unlockNudgeInDB ────────────────────────────────────────────────────────────

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

  await FocusSession.findByIdAndUpdate(
    session._id,
    { status: "completed", endTime, durationMinutes },
    { new: true },
  );

  const result = await Nudge.findByIdAndUpdate(
    nudgeId,
    {
      $set: {
        "joinedParticipants.$[elem].isDeleted": true,
        "joinedParticipants.$[elem].deletedAt": new Date(),
      },
    },
    {
      new: true,
      arrayFilters: [{ "elem.userId": userObjectId, "elem.isDeleted": false }],
    },
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

  if (result) {
    const activeJoinedCount = result.joinedParticipants.filter((p) => !p.isDeleted).length;
    if (activeJoinedCount === 0) {
      await Nudge.findByIdAndUpdate(nudgeId, { status: "completed" });
    }
  }

  return result;
};

// ─── takeNudgeBreakInDB ─────────────────────────────────────────────────────────

const takeNudgeBreakInDB = async (userId: string, nudgeId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  const nudge = await Nudge.findById(nudgeId);
  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  const activeSession = await FocusSession.findOne({
    userId: userObjectId,
    nudgeId: nudgeObjectId,
    status: "active",
  });

  if (!activeSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You don't have an active focus session in this nudge",
    );
  }

  const activeBreak = await Break.findOne({
    userId: userObjectId,
    status: "active",
    endTime: { $gt: new Date() },
  });

  if (activeBreak) {
    if (activeBreak.nudgeId && activeBreak.nudgeId.toString() === nudgeObjectId.toString()) {
      const now = new Date();
      const elapsedMinutes = (now.getTime() - activeBreak.startTime.getTime()) / 60000;
      const durationLimit = nudge.breakConfig?.breakDurationMinutes || 0;
      const remainingMinutes = Math.max(0, Math.ceil(durationLimit - elapsedMinutes));
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

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

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
    status: "active",
  });

  return {
    break: createdBreak,
    remainingBreaks: remainingBreaks - 1,
    breakDurationMinutes,
    message: `Break started. You have ${breakDurationMinutes} minutes. After this, apps will lock again.`,
  };
};

// ─── getCurrentNudgeStatusInDB ──────────────────────────────────────────────────

const getCurrentNudgeStatusInDB = async (userId: string) => {
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
      ? (nudge.creatorId as any)?._id?.toString() ?? nudge.creatorId.toString()
      : null;

  const isCreator = creatorIdStr === userId;
  const creatorJoinedEntry = nudge.joinedParticipants.find(
    (p) => p.userId != null && ((p.userId as any)._id || p.userId).toString() === userId
  );

  if (isCreator && !creatorJoinedEntry && nudge.status === "active") {
    await Nudge.findByIdAndUpdate(nudge._id, {
      $addToSet: {
        joinedParticipants: { userId: userObjectId, isDeleted: false },
      },
    });
    nudge.joinedParticipants.push({ userId: userObjectId, isDeleted: false } as any);
  }

  const isJoined = nudge.joinedParticipants.some(
    (p) => !p.isDeleted && p.userId != null && ((p.userId as any)._id || p.userId).toString() === userId,
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

  const currentUser = await User.findById(userId).select("installedApps");
  const installedAppPackages = new Set(
    (currentUser?.installedApps || []).map((app) => app.packageName)
  );

  const modeLockedApps = (nudge.modeId as any)?.lockedApps || [];
  const filteredLockedApps = modeLockedApps.filter((app: any) =>
    installedAppPackages.has(app.packageName)
  );

  const activeBreak = activeSession
    ? await Break.findOne({
        userId: userObjectId,
        nudgeId: nudge._id,
        status: "active",
        endTime: { $gt: new Date() },
      })
    : null;

  const isLocked = isJoined ? !activeBreak : false;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const breaksTakenToday = await Break.countDocuments({
    userId: userObjectId,
    nudgeId: nudge._id,
    startTime: { $gte: startOfDay, $lte: endOfDay },
  });

  const totalAllowedBreaks = nudge.breakConfig?.breaksPerDay || 0;
  const remainingBreaks = Math.max(0, totalAllowedBreaks - breaksTakenToday);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const sessionsThisWeek = await FocusSession.find({
    userId: userObjectId,
    nudgeId: { $exists: true, $ne: null },
    startTime: { $gte: startOfWeek },
  });

  const breaksThisWeek = await Break.find({
    userId: userObjectId,
    nudgeId: { $exists: true, $ne: null },
    createdAt: { $gte: startOfWeek },
  });

  let todayFocusMinutes = 0;
  let weekFocusMinutes = 0;

  sessionsThisWeek.forEach((session) => {
    const duration =
      session.status === "completed"
        ? session.durationMinutes || 0
        : Math.round((new Date().getTime() - session.startTime.getTime()) / 60000);
    weekFocusMinutes += duration;
    if (session.startTime >= startOfDay) todayFocusMinutes += duration;
  });

  breaksThisWeek.forEach((breakItem) => {
    const duration =
      breakItem.status === "completed"
        ? breakItem.durationMinutes || 0
        : Math.round((new Date().getTime() - breakItem.startTime.getTime()) / 60000);
    weekFocusMinutes -= duration;
    if (breakItem.startTime >= startOfDay) todayFocusMinutes -= duration;
  });

  todayFocusMinutes = Math.max(0, todayFocusMinutes);
  weekFocusMinutes = Math.max(0, weekFocusMinutes);

  const activeParticipants = nudge.participants.filter((p) => !p.isDeleted && p.userId != null);
  const participantsWithStatus = await Promise.all(
    activeParticipants.map(async (participant: any) => {
      const participantId = participant.userId._id || participant.userId;

      const isParticipantJoined = nudge.joinedParticipants.some(
        (p: any) => !p.isDeleted && p.userId != null && (p.userId._id || p.userId).equals(participantId),
      );

      const participantActiveBreak = await Break.findOne({
        userId: participantId,
        nudgeId: nudge._id,
        status: "active",
        endTime: { $gt: new Date() },
      });

      return {
        _id: participant.userId._id || participant.userId,
        name: participant.userId.name ?? null,
        profileImage: participant.userId.profileImage ?? null,
        email: participant.userId.email ?? null,
        isJoined: isParticipantJoined,
        isFocused: isParticipantJoined && !participantActiveBreak,
        isOnBreak: !!participantActiveBreak,
      };
    }),
  );

  const activeJoinedParticipants = nudge.joinedParticipants.filter((p) => !p.isDeleted && p.userId != null);
  const joinedParticipantsWithStatus = await Promise.all(
    activeJoinedParticipants.map(async (participant: any) => {
      const participantId = participant.userId._id || participant.userId;

      const participantActiveBreak = await Break.findOne({
        userId: participantId,
        nudgeId: nudge._id,
        status: "active",
        endTime: { $gt: new Date() },
      });

      return {
        _id: participant.userId._id || participant.userId,
        name: participant.userId.name ?? null,
        profileImage: participant.userId.profileImage ?? null,
        email: participant.userId.email ?? null,
        isFocused: !participantActiveBreak,
        isOnBreak: !!participantActiveBreak,
      };
    }),
  );

  return {
    isActive: isJoined,
    nudgeId: nudge._id,
    status: nudge.status,
    isLocked,
    currentMode: nudge.modeId
      ? {
          ...(nudge.modeId as any).toObject(),
          lockedApps: filteredLockedApps,
          totalLockedApps: filteredLockedApps.length,
        }
      : null,
    lockedApps: filteredLockedApps,
    totalLockedApps: filteredLockedApps.length,
    participants: participantsWithStatus,
    joinedParticipants: joinedParticipantsWithStatus,
    breakStats: {
      totalAllowed: totalAllowedBreaks,
      takenToday: breaksTakenToday,
      remaining: remainingBreaks,
      durationMinutes: nudge.breakConfig?.breakDurationMinutes || 0,
      activeBreak: activeBreak
        ? {
            startTime: activeBreak.startTime,
            endTime: activeBreak.endTime,
            remainingMinutes: Math.max(
              0,
              Math.ceil((activeBreak.endTime.getTime() - new Date().getTime()) / 60000),
            ),
          }
        : null,
    },
    focusStats: {
      todayMinutes: todayFocusMinutes,
      weekMinutes: weekFocusMinutes,
      todayFormatted: `${Math.floor(todayFocusMinutes / 60)}h ${todayFocusMinutes % 60}m`,
      weekFormatted: `${Math.floor(weekFocusMinutes / 60)}h ${weekFocusMinutes % 60}m`,
    },
  };
};

// ─── addFriendToDB ──────────────────────────────────────────────────────────────

const addFriendToDB = async (userId: string, friendId: string) => {
  if (userId === friendId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot add yourself as a friend");
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friendObjectId = new mongoose.Types.ObjectId(friendId);

  const userExists = await User.findById(friendId);
  if (!userExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const existingFriend = await Friend.findOne({
    $or: [
      { userId: userObjectId, friendId: friendObjectId },
      { userId: friendObjectId, friendId: userObjectId },
    ],
    isDeleted: { $ne: true },
  });

  if (existingFriend) {
    if (existingFriend.status === "accepted") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "You are already friends");
    }
    existingFriend.status = "accepted";
    await existingFriend.save();
    return existingFriend;
  }

  const result = await Friend.create({
    userId: userObjectId,
    friendId: friendObjectId,
    status: "accepted",
  });

  return result;
};

// ─── getFriendsFromDB ───────────────────────────────────────────────────────────

const getFriendsFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friends = await Friend.find({
    $or: [{ userId: userObjectId }, { friendId: userObjectId }],
    status: "accepted",
    isDeleted: { $ne: true },
  }).populate("userId friendId", "name userName profileImage email");

  const friendsData = friends.map((f) => {
    const otherUser = f.userId._id.toString() === userId ? f.friendId : f.userId;
    return otherUser;
  });

  const now = new Date();
  const friendsWithStatus = await Promise.all(
    friendsData.map(async (friend: any) => {
      const activeSession = await FocusSession.findOne({
        userId: friend._id,
        status: "active",
      });

      const activeBreak = await Break.findOne({
        userId: friend._id,
        status: "active",
        endTime: { $gt: now },
      });

      const isLocked = activeSession ? !activeBreak : false;
      const lastFocusInfo = await buildLastFocusInfo(new mongoose.Types.ObjectId(friend._id.toString()));

      return {
        _id: friend._id,
        name: friend.name,
        userName: friend.userName || friend.email?.split("@")[0] || "user",
        profileImage: friend.profileImage || "",
        email: friend.email || "",
        isLocked,
        lastFocusInfo: isLocked ? "Focusing now" : lastFocusInfo,
      };
    }),
  );

  return friendsWithStatus;
};

// ─── removeNudgeParticipantFromDB ───────────────────────────────────────────────

const removeNudgeParticipantFromDB = async (
  userId: string,
  previewId: string,
  participantId: string,
) => {
  const participantObjectId = new mongoose.Types.ObjectId(participantId);

  // Find the preview to verify ownership and get linked nudgeId (if confirmed)
  const preview = await NudgePreview.findById(previewId);
  if (!preview) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge preview not found");
  }

  if (preview.creatorId.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only the nudge creator can remove a participant");
  }

  // Check that the participant actually belongs to this preview
  const isParticipantInPreview = preview.participants.some(
    (p) => p.toString() === participantId,
  );
  if (!isParticipantInPreview) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Participant not found in this nudge preview");
  }

  // Remove participant from the preview
  await NudgePreview.findByIdAndUpdate(
    previewId,
    { $pull: { participants: participantObjectId } },
    { new: true },
  );

  // If the preview was already confirmed, also remove from the linked Nudge
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
        const activeJoinedCount = result.joinedParticipants.filter((p) => !p.isDeleted).length;
        if (activeJoinedCount === 0) {
          await Nudge.findByIdAndUpdate(nudgeObjectId, { status: "completed" });
        }
      }
    }
  }

  return { message: "Participant removed successfully" };
};

// ─── leaveNudgeInDB ─────────────────────────────────────────────────────────────

const leaveNudgeInDB = async (userId: string, nudgeId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  const nudge = await Nudge.findById(nudgeId);
  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  if (nudge.status === "completed") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This nudge is already completed");
  }

  const isCreator = nudge.creatorId.equals(userObjectId);
  const isParticipant = nudge.participants.some(
    (p) => !p.isDeleted && p.userId.equals(userObjectId),
  );

  if (!isCreator && !isParticipant) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not part of this nudge");
  }

  // End active focus session
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

  // Remove user from both participants and joinedParticipants
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

  // If no active joined participants remain, complete the nudge
  if (result) {
    const activeJoinedCount = result.joinedParticipants.filter((p) => !p.isDeleted).length;
    if (activeJoinedCount === 0) {
      await Nudge.findByIdAndUpdate(nudgeId, { status: "completed" });
    }
  }

  return { message: "You have left the nudge successfully" };
};

// ─── getPendingNudgePreviewInDB ─────────────────────────────────────────────────

const getPendingNudgePreviewInDB = async (userId: string) => {
  const preview = await NudgePreview.findOne({
    creatorId: new mongoose.Types.ObjectId(userId),
    status: "pending",
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .populate("participants", "name userName profileImage email")
    .populate("modeId", "name iconType");

  if (!preview) {
    return {
      hasPendingPreview: false,
      preview: null,
    };
  }

  const remainingMs = preview.expiresAt.getTime() - Date.now();
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
      participants: (preview.participants as any[]).map((p) => ({
        _id: p._id,
        name: p.name,
        userName: p.userName || p.email?.split("@")[0] || "user",
        profileImage: p.profileImage || "",
        email: p.email || "",
      })),
    },
  };
};

// ─── Export ─────────────────────────────────────────────────────────────────────

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
  getFriendsFromDB,
  removeNudgeParticipantFromDB,
  leaveNudgeInDB,
};
