import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Friend, Nudge } from "./friends.model";
import { IFriendStats, INudge } from "./friends.interface";
import { FocusSession } from "../focusSession/focusSession.model";
import { Break } from "../breaks/breaks.model";
import { emailHelper } from "../../../helpers/emailHelper";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import config from "../../../config";
import { Mode } from "../modes/modes.model";

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

  const usersWithStatus = await Promise.all(
    users.map(async (user) => {
      // Check active focus session
      const activeSession = await FocusSession.findOne({
        userId: user._id,
        status: "active",
      });

      // Get last completed session for history info
      const lastSession = await FocusSession.findOne({
        userId: user._id,
        status: "completed",
      }).sort({ endTime: -1 });

      let lastFocusInfo = "No focus history";
      if (lastSession && lastSession.endTime) {
        // Calculate how long ago the session ended
        const now = new Date();
        const diffMs = now.getTime() - lastSession.endTime.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        let timeAgoStr = "";
        if (diffDays > 0) {
          timeAgoStr = `${diffDays}d ago`;
        } else if (diffHours > 0) {
          timeAgoStr = `${diffHours}h ago`;
        } else {
          timeAgoStr = `${diffMins}m ago`;
        }

        lastFocusInfo = `Last focused ${timeAgoStr}`;
      }

      const isFocused = !!activeSession;

      return {
        ...user,
        isFocused,
        lastFocusInfo: isFocused ? "Currently focusing" : lastFocusInfo,
      };
    }),
  );

  const total = await User.countDocuments(query);

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: usersWithStatus,
  };
};

const createNudgeInDB = async (userId: string, payload: Partial<INudge>) => {
  const { participants, modeId, breakConfig } = payload;

  if (!participants || participants.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "At least one friend must be selected",
    );
  }

  // 1. Check if the creator (current user) is currently focused
  const creatorActiveSession = await FocusSession.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: "active",
  });

  if (creatorActiveSession) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot create a nudge while you are in a focus session",
    );
  }

  // 2. Check if any participant is currently focused
  const focusedParticipants = await FocusSession.find({
    userId: {
      $in: participants.map((id: any) => new mongoose.Types.ObjectId(id.userId || id)),
    },
    status: "active",
  }).populate("userId", "name");

  if (focusedParticipants.length > 0) {
    const focusedNames = focusedParticipants
      .map((s: any) => s.userId?.name)
      .join(", ");
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot send nudge. The following users are currently in a focus session: ${focusedNames}`,
    );
  }

  // 3. Add participants as friends if not already added
  for (const friendId of participants) {
    const id = (friendId as any).userId || friendId;
    const existingFriend = await Friend.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      friendId: new mongoose.Types.ObjectId(id),
      isDeleted: { $ne: true },
    });

    if (!existingFriend) {
      await Friend.create({
        userId: new mongoose.Types.ObjectId(userId),
        friendId: new mongoose.Types.ObjectId(id),
        status: "accepted",
      });
    }
  }

  // 2. Create Nudge
  const nudgeData = {
    creatorId: new mongoose.Types.ObjectId(userId),
    participants: participants.map((id: any) => ({
      userId: new mongoose.Types.ObjectId(id.userId || id),
      isDeleted: false,
    })),
    joinedParticipants: [
      {
        userId: new mongoose.Types.ObjectId(userId),
        isDeleted: false,
      },
    ],
    modeId: new mongoose.Types.ObjectId(modeId as any),
    breakConfig,
    startTime: new Date(),
    status: "scheduled",
  };

  const result = await Nudge.create(nudgeData);

  // 3. Set the selected mode as active for the creator and deactivate others
  await Mode.updateMany(
    { userId: new mongoose.Types.ObjectId(userId), isDeleted: false },
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

  // 4. Start Focus Session for Creator
  await FocusSession.create({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: nudgeData.modeId,
    nudgeId: result._id,
    startTime: nudgeData.startTime,
    status: "active",
  });

  // 5. Send Emails
  const participantIds = participants.map((id: any) => 
    new mongoose.Types.ObjectId(id.userId || id)
  );
  const invitedUsers = await User.find({ _id: { $in: participantIds } });
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
          <a href="${config.base_url}/api/v1/friends/join-nudge/${result._id}?userId=${user._id}">Join Nudge</a>
        `,
      });
    }
  }

  return result;
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

  // Check if user is an invited participant (and not deleted)
  const isInvited = nudge.participants.some(
    (p) => !p.isDeleted && p.userId.equals(userObjectId)
  );
  if (!isInvited) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not invited to this nudge",
    );
  }

  // Check if already joined and not deleted
  const existingJoined = nudge.joinedParticipants.find(
    (p) => !p.isDeleted && p.userId.equals(userObjectId)
  );
  if (existingJoined) {
    return nudge;
  }

  // Check if user was previously joined but deleted - restore if so
  const previouslyJoined = nudge.joinedParticipants.find(
    (p) => p.isDeleted && p.userId.equals(userObjectId)
  );

  const updateData: any = {};
  if (previouslyJoined) {
    // Restore the participant
    updateData.$set = {
      "joinedParticipants.$[elem].isDeleted": false,
      "joinedParticipants.$[elem].deletedAt": null,
    };
    updateData.arrayFilters = [{ "elem.userId": userObjectId }];
  } else {
    // Add new participant
    updateData.$addToSet = {
      joinedParticipants: { userId: userObjectId, isDeleted: false },
    };
  }

  if (nudge.status === "scheduled") {
    updateData.status = "active";
  }

  const result = await Nudge.findByIdAndUpdate(nudgeId, updateData, {
    new: true,
  });

  // Set the selected mode as active for the joining user and deactivate others
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

  // Start Focus Session for the user
  await FocusSession.create({
    userId: userObjectId,
    modeId: nudge.modeId,
    nudgeId: nudge._id,
    startTime: now,
    status: "active",
  });

  return result;
};

const getFriendDetailsFromDB = async (userId: string, friendIds: string[]) => {
  const friendObjectIds = friendIds.map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const allParticipants = [
    new mongoose.Types.ObjectId(userId),
    ...friendObjectIds,
  ].sort();

  const friendsData = await User.find({ _id: { $in: friendObjectIds } }).select(
    "name userName profileImage email",
  );

  const stats: IFriendStats[] = [];

  // 2. Together This Week - Pre-fetch user's nudge sessions for this week
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const userNudgeSessions = await FocusSession.find({
    userId: new mongoose.Types.ObjectId(userId),
    status: "completed",
    nudgeId: { $exists: true },
    startTime: { $gte: startOfWeek },
  });

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (const friend of friendsData) {
    // 0. Check current focus status
    const activeSession = await FocusSession.findOne({
      userId: friend._id,
      status: "active",
    });

    // 1. Recent Past Focus
    const lastSession = await FocusSession.findOne({
      userId: friend._id,
      status: "completed",
    }).sort({ endTime: -1 });

    let recentPastFocus = "No recent focus";
    if (lastSession && lastSession.endTime) {
      // Calculate how long ago the session ended
      const now = new Date();
      const diffMs = now.getTime() - lastSession.endTime.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      let timeAgoStr = "";
      if (diffDays > 0) {
        timeAgoStr = `${diffDays}d ago`;
      } else if (diffHours > 0) {
        timeAgoStr = `${diffHours}h ago`;
      } else {
        timeAgoStr = `${diffMins}m ago`;
      }

      recentPastFocus = `Last focused ${timeAgoStr}`;
    }

    // 2. Together This Week Calculation
    let totalMinutes = 0;
    const daysWorked = new Set<string>();

    for (const session of userNudgeSessions) {
      // Check how many of the requested friends were also in this same nudge session
      const participantsInNudge = await FocusSession.distinct("userId", {
        nudgeId: session.nudgeId,
        userId: { $in: friendObjectIds },
        status: "completed",
      });

      if (participantsInNudge.length === friendObjectIds.length) {
        let sessionMinutes = session.durationMinutes || 0;
        if (!sessionMinutes && session.endTime) {
          sessionMinutes = Math.round(
            (session.endTime.getTime() - session.startTime.getTime()) / 60000,
          );
        }
        totalMinutes += sessionMinutes;
        daysWorked.add(dayNames[session.startTime.getDay()]);
      }
    }

    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const streak = daysWorked.size;

    const isFocused = !!activeSession;

    stats.push({
      name: friend.name,
      userId: friend._id,
      userName: friend.userName || "",
      profileImage: (friend as any).profileImage || "",
      email: friend.email || "",
      isFocused,
      recentPastFocus: isFocused ? "Currently focusing" : recentPastFocus,
      togetherThisWeek: {
        totalFocusTime: `${hours}h ${mins}m`,
        streak,
        highlightedDays: Array.from(daysWorked),
      },
    });
  }

  return stats;
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
      { "participants.userId": userObjectId, "participants.isDeleted": { $ne: true } },
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
    meta: {
      page,
      limit,
      total,
    },
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

const unlockNudgeInDB = async (userId: string, nudgeId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  // 1. Find the active focus session to get startTime
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

  // 2. Update the session to completed
  await FocusSession.findByIdAndUpdate(
    session._id,
    {
      status: "completed",
      endTime,
      durationMinutes,
    },
    { new: true },
  );

  // 3. Soft delete user from joinedParticipants in the Nudge
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

  // 4. Deactivate the mode associated with this nudge for the user
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

  // 5. Optional: If no active users left in the nudge, mark it as completed
  if (result) {
    const activeJoinedCount = result.joinedParticipants.filter(
      (p) => !p.isDeleted
    ).length;
    if (activeJoinedCount === 0) {
      await Nudge.findByIdAndUpdate(nudgeId, { status: "completed" });
    }
  }

  return result;
};

const takeNudgeBreakInDB = async (userId: string, nudgeId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);

  // 1. Check if nudge exists and is active
  const nudge = await Nudge.findById(nudgeId);
  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  // 2. Check if user has an active focus session for this nudge
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

  // 3. Check if user already has a break in progress (based on time)
  const lastBreak = await Break.findOne({
    userId: userObjectId,
    nudgeId: nudgeObjectId,
  }).sort({ startTime: -1 });

  if (lastBreak && lastBreak.status === "active") {
    const now = new Date();
    const elapsedMinutes =
      (now.getTime() - lastBreak.startTime.getTime()) / 60000;
    const durationLimit = nudge.breakConfig?.breakDurationMinutes || 0;

    if (elapsedMinutes < durationLimit) {
      const remainingMinutes = Math.ceil(durationLimit - elapsedMinutes);
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `You are already on a break. Please wait ${remainingMinutes} more minute(s) for it to finish automatically.`,
      );
    } else {
      // If time passed, we can implicitly treat it as completed if we want,
      // but for simplicity, we just allow a new break if the limit allows.
      await Break.findByIdAndUpdate(lastBreak._id, {
        status: "completed",
        durationMinutes: durationLimit,
        endTime: new Date(
          lastBreak.startTime.getTime() + durationLimit * 60000,
        ),
      });
    }
  }

  // 4. Check breaksPerDay limit
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

  // 5. Create a new break with calculated endTime
  const startTime = new Date();
  const breakDurationMinutes = nudge.breakConfig?.breakDurationMinutes || 0;
  const endTime = new Date(startTime.getTime() + breakDurationMinutes * 60000);

  const breakData = {
    userId: userObjectId,
    modeId: nudge.modeId,
    nudgeId: nudgeObjectId,
    startTime,
    endTime,
    status: "active",
  };

  const createdBreak = await Break.create(breakData);

  return {
    break: createdBreak,
    remainingBreaks: remainingBreaks - 1,
    breakDurationMinutes: nudge.breakConfig?.breakDurationMinutes || 0,
    message: `Break started. You have ${nudge.breakConfig?.breakDurationMinutes} minutes. After this, apps will lock again.`,
  };
};

const getCurrentNudgeStatusInDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Find the active focus session with a nudgeId
  const activeSession = await FocusSession.findOne({
    userId: userObjectId,
    status: "active",
    nudgeId: { $exists: true },
  }).populate("modeId");

  if (!activeSession) {
    return {
      isActive: false,
      message: "No active nudge session found",
    };
  }

  const nudgeId = activeSession.nudgeId;
  const nudge = await Nudge.findById(nudgeId)
    .populate("creatorId", "name profileImage email")
    .populate("participants.userId", "name profileImage email")
    .populate("joinedParticipants.userId", "name profileImage email")
    .populate("modeId");

  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  // 2. Check for active break
  const activeBreak = await Break.findOne({
    userId: userObjectId,
    nudgeId: nudge._id,
    status: "active",
    endTime: { $gt: new Date() },
  });

  // 3. Calculate lock status
  const isLocked = !activeBreak;

  // 4. Break statistics
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

  // 5. Focus Time Stats (Today & This Week)
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const sessionsThisWeek = await FocusSession.find({
    userId: userObjectId,
    startTime: { $gte: startOfWeek },
    status: "completed",
  });

  let todayFocusMinutes = 0;
  let weekFocusMinutes = 0;

  sessionsThisWeek.forEach((session) => {
    const duration = session.durationMinutes || 0;
    weekFocusMinutes += duration;
    if (session.startTime >= startOfDay) {
      todayFocusMinutes += duration;
    }
  });

  // Add current active session time
  const currentSessionDuration = Math.round(
    (new Date().getTime() - activeSession.startTime.getTime()) / 60000,
  );
  todayFocusMinutes += currentSessionDuration;
  weekFocusMinutes += currentSessionDuration;

  // 6. Participants focus and break status
  const activeParticipants = nudge.participants.filter(p => !p.isDeleted);
  const participantsWithStatus = await Promise.all(
    activeParticipants.map(async (participant: any) => {
      const participantId = participant.userId._id || participant.userId;

      // Check if participant is currently in this nudge's focus session
      const isJoined = nudge.joinedParticipants.some(
        (p: any) => !p.isDeleted && (p.userId._id || p.userId).equals(participantId),
      );

      // Check if they have an active break
      const participantActiveBreak = await Break.findOne({
        userId: participantId,
        nudgeId: nudge._id,
        status: "active",
        endTime: { $gt: new Date() },
      });

      return {
        _id: participant.userId._id || participant.userId,
        name: participant.userId.name,
        profileImage: participant.userId.profileImage,
        email: participant.userId.email,
        isJoined,
        isFocused: isJoined && !participantActiveBreak,
        isOnBreak: !!participantActiveBreak,
      };
    }),
  );

  // Also handle joinedParticipants (which includes the creator)
  const activeJoinedParticipants = nudge.joinedParticipants.filter(p => !p.isDeleted);
  const joinedParticipantsWithStatus = await Promise.all(
    activeJoinedParticipants.map(async (participant: any) => {
      const participantId = participant.userId._id || participant.userId;

      // Check if they have an active break
      const participantActiveBreak = await Break.findOne({
        userId: participantId,
        nudgeId: nudge._id,
        status: "active",
        endTime: { $gt: new Date() },
      });

      return {
        _id: participant.userId._id || participant.userId,
        name: participant.userId.name,
        profileImage: participant.userId.profileImage,
        email: participant.userId.email,
        isFocused: !participantActiveBreak,
        isOnBreak: !!participantActiveBreak,
      };
    }),
  );

  return {
    isActive: true,
    nudgeId: nudge._id,
    status: nudge.status,
    isLocked,
    currentMode: nudge.modeId,
    lockedApps: (nudge.modeId as any)?.lockedApps || [],
    totalLockedApps: (nudge.modeId as any)?.lockedApps?.length || 0,
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
              Math.ceil(
                (activeBreak.endTime.getTime() - new Date().getTime()) / 60000,
              ),
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

export const FriendsService = {
  getUsersFromDB,
  createNudgeInDB,
  joinNudgeInDB,
  getFriendDetailsFromDB,
  getNudgeHistoryFromDB,
  removeFriendFromDB,
  unlockNudgeInDB,
  takeNudgeBreakInDB,
  getCurrentNudgeStatusInDB,
};
