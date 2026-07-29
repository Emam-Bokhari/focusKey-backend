import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Friend, Nudge } from "./friends.model";
import { INudge } from "./friends.interface";
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

  // Retrieve current user's friends to set isFriend field
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
      // Check active focus session
      const activeSession = await FocusSession.findOne({
        userId: user._id,
        status: "active",
      });

      // Check active break
      const activeBreak = await Break.findOne({
        userId: user._id,
        status: "active",
        endTime: { $gt: now },
      });

      const isLocked = activeSession ? !activeBreak : false;

      // Get last completed session for history info
      const lastSession = await FocusSession.findOne({
        userId: user._id,
        status: "completed",
      }).sort({ endTime: -1 });

      let lastFocusInfo = "No focus history";
      if (lastSession && lastSession.endTime) {
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
            let sessionDurationStr = "some time";
            if (lastSession.durationMinutes) {
              const h = Math.floor(lastSession.durationMinutes / 60);
              const m = lastSession.durationMinutes % 60;
              sessionDurationStr = h > 0 ? `${h}h` : `${m}m`;
            }
            lastFocusInfo = `Focused ${sessionDurationStr} yesterday`;
          } else {
            lastFocusInfo = `Last focused ${diffDays}d ago`;
          }
        } else if (diffHours > 0) {
          lastFocusInfo = `Last focused ${diffHours}h ago`;
        } else {
          lastFocusInfo = `Last focused ${diffMins}m ago`;
        }
      }

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
      $in: participants.map(
        (id: any) => new mongoose.Types.ObjectId(id.userId || id),
      ),
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
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const nudgeData = {
    creatorId: userObjectId,
    participants: participants.map((id: any) => ({
      userId: new mongoose.Types.ObjectId(id.userId || id),
      isDeleted: false,
    })),
    joinedParticipants: [
      {
        userId: userObjectId,
        isDeleted: false,
      },
    ],
    modeId: new mongoose.Types.ObjectId(modeId as any),
    breakConfig,
    startTime: new Date(),
    status: "active",
  };

  const result = await Nudge.create(nudgeData);

  // Set the selected mode as active for the creator and deactivate others
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

  // Start Focus Session for the creator
  await FocusSession.create({
    userId: userObjectId,
    modeId: new mongoose.Types.ObjectId(modeId as any),
    nudgeId: result._id,
    startTime: now,
    status: "active",
  });

  // 5. Send Emails
  const participantIds = participants.map(
    (id: any) => new mongoose.Types.ObjectId(id.userId || id),
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

  // Check if user is the creator or an invited participant (and not deleted)
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

  // Check if already joined and not deleted
  const existingJoined = nudge.joinedParticipants.find(
    (p) => !p.isDeleted && p.userId.equals(userObjectId),
  );
  if (existingJoined) {
    return nudge;
  }

  // Check if user was previously joined but deleted - restore if so
  const previouslyJoined = nudge.joinedParticipants.find(
    (p) => p.isDeleted && p.userId.equals(userObjectId),
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
      (p) => !p.isDeleted,
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

  // 3. Check if user already has any active break (global or nudge) in progress
  const activeBreak = await Break.findOne({
    userId: userObjectId,
    status: "active",
    endTime: { $gt: new Date() },
  });

  if (activeBreak) {
    if (
      activeBreak.nudgeId &&
      activeBreak.nudgeId.toString() === nudgeObjectId.toString()
    ) {
      const now = new Date();
      const elapsedMinutes =
        (now.getTime() - activeBreak.startTime.getTime()) / 60000;
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

  // 1. Find the active or scheduled nudge where the user is the creator or a participant
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

  // Check if the current user is the creator of the nudge
  const isCreator = nudge.creatorId.toString() === userId;
  const creatorJoinedEntry = nudge.joinedParticipants.find(
    (p) => (p.userId._id || p.userId).toString() === userId
  );

  // Self-healing: if creator of active nudge is not in joinedParticipants, add them
  if (isCreator && !creatorJoinedEntry && nudge.status === "active") {
    await Nudge.findByIdAndUpdate(nudge._id, {
      $addToSet: {
        joinedParticipants: { userId: userObjectId, isDeleted: false }
      }
    });
    nudge.joinedParticipants.push({
      userId: userObjectId,
      isDeleted: false
    } as any);
  }

  // Determine if the user is in joinedParticipants and not deleted
  const isJoined = nudge.joinedParticipants.some(
    (p) => !p.isDeleted && (p.userId._id || p.userId).toString() === userId,
  );

  // 2. Check if the current user has an active focus session for this nudge
  let activeSession = await FocusSession.findOne({
    userId: userObjectId,
    status: "active",
    nudgeId: nudge._id,
  });

  // Self-healing: if user has joined but has no active FocusSession document, create one on the fly
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

  // Get current user's installed apps to filter locked apps
  const currentUser = await User.findById(userId).select("installedApps");
  const installedAppPackages = new Set(
    (currentUser?.installedApps || []).map((app) => app.packageName)
  );

  const modeLockedApps = (nudge.modeId as any)?.lockedApps || [];
  const filteredLockedApps = modeLockedApps.filter((app: any) =>
    installedAppPackages.has(app.packageName)
  );

  // 3. Check for active break if the user has an active focus session
  const activeBreak = activeSession
    ? await Break.findOne({
        userId: userObjectId,
        nudgeId: nudge._id,
        status: "active",
        endTime: { $gt: new Date() },
      })
    : null;

  // 4. Calculate lock status
  const isLocked = isJoined ? !activeBreak : false;

  // 5. Break statistics
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

  // 6. Focus Time Stats (Today & This Week) - Nudge Sessions Only
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
    let duration = 0;
    if (session.status === "completed") {
      duration = session.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - session.startTime.getTime();
      duration = Math.round(durationMs / 60000);
    }
    weekFocusMinutes += duration;
    if (session.startTime >= startOfDay) {
      todayFocusMinutes += duration;
    }
  });

  breaksThisWeek.forEach((breakItem) => {
    let duration = 0;
    if (breakItem.status === "completed") {
      duration = breakItem.durationMinutes || 0;
    } else {
      const durationMs = new Date().getTime() - breakItem.startTime.getTime();
      duration = Math.round(durationMs / 60000);
    }
    weekFocusMinutes -= duration;
    if (breakItem.startTime >= startOfDay) {
      todayFocusMinutes -= duration;
    }
  });

  todayFocusMinutes = Math.max(0, todayFocusMinutes);
  weekFocusMinutes = Math.max(0, weekFocusMinutes);

  // 7. Participants focus and break status
  const activeParticipants = nudge.participants.filter((p) => !p.isDeleted);
  const participantsWithStatus = await Promise.all(
    activeParticipants.map(async (participant: any) => {
      const participantId = participant.userId._id || participant.userId;

      // Check if participant is currently in this nudge's focus session
      const isJoined = nudge.joinedParticipants.some(
        (p: any) =>
          !p.isDeleted && (p.userId._id || p.userId).equals(participantId),
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
  const activeJoinedParticipants = nudge.joinedParticipants.filter(
    (p) => !p.isDeleted,
  );
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

const addFriendToDB = async (userId: string, friendId: string) => {
  if (userId === friendId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot add yourself as a friend");
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friendObjectId = new mongoose.Types.ObjectId(friendId);

  // Check if user exists
  const userExists = await User.findById(friendId);
  if (!userExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  // Check if they are already friends
  const existingFriend = await Friend.findOne({
    $or: [
      { userId: userObjectId, friendId: friendObjectId },
      { userId: friendObjectId, friendId: userObjectId }
    ],
    isDeleted: { $ne: true }
  });

  if (existingFriend) {
    if (existingFriend.status === "accepted") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "You are already friends");
    }
    // If pending/rejected, update status to accepted
    existingFriend.status = "accepted";
    await existingFriend.save();
    return existingFriend;
  }

  // Create friend relationship
  const result = await Friend.create({
    userId: userObjectId,
    friendId: friendObjectId,
    status: "accepted",
  });

  return result;
};

const getFriendsFromDB = async (userId: string) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const friends = await Friend.find({
    $or: [{ userId: userObjectId }, { friendId: userObjectId }],
    status: "accepted",
    isDeleted: { $ne: true },
  }).populate("userId friendId", "name userName profileImage email");

  const friendsData = friends.map((f) => {
    // Return the other user in the relationship
    const otherUser = f.userId._id.toString() === userId ? f.friendId : f.userId;
    return otherUser;
  });

  const now = new Date();
  const friendsWithStatus = await Promise.all(
    friendsData.map(async (friend: any) => {
      // 1. Check active focus session
      const activeSession = await FocusSession.findOne({
        userId: friend._id,
        status: "active",
      });

      // 2. Check active break
      const activeBreak = await Break.findOne({
        userId: friend._id,
        status: "active",
        endTime: { $gt: now },
      });

      const isLocked = activeSession ? !activeBreak : false;

      // 3. Get last completed session for history info
      const lastSession = await FocusSession.findOne({
        userId: friend._id,
        status: "completed",
      }).sort({ endTime: -1 });

      let lastFocusInfo = "No focus history";
      if (lastSession && lastSession.endTime) {
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
            let sessionDurationStr = "some time";
            if (lastSession.durationMinutes) {
              const h = Math.floor(lastSession.durationMinutes / 60);
              const m = lastSession.durationMinutes % 60;
              sessionDurationStr = h > 0 ? `${h}h` : `${m}m`;
            }
            lastFocusInfo = `Focused ${sessionDurationStr} yesterday`;
          } else {
            lastFocusInfo = `Last focused ${diffDays}d ago`;
          }
        } else if (diffHours > 0) {
          lastFocusInfo = `Last focused ${diffHours}h ago`;
        } else {
          lastFocusInfo = `Last focused ${diffMins}m ago`;
        }
      }

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

const removeNudgeParticipantFromDB = async (userId: string, nudgeId: string, participantId: string) => {
  const nudgeObjectId = new mongoose.Types.ObjectId(nudgeId);
  const participantObjectId = new mongoose.Types.ObjectId(participantId);

  const nudge = await Nudge.findById(nudgeId);
  if (!nudge) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Nudge not found");
  }

  // Only the creator of the nudge can remove a participant
  if (nudge.creatorId.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only the nudge creator can remove a participant");
  }

  // 1. Find the active focus session for this participant
  const session = await FocusSession.findOne({
    userId: participantObjectId,
    nudgeId: nudgeObjectId,
    status: "active",
  });

  const endTime = new Date();
  if (session) {
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

    // 3. Deactivate the mode associated with this nudge for the participant
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

  // 4. Soft delete user from joinedParticipants and participants in the Nudge
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
        { "elemJ.userId": participantObjectId },
        { "elemP.userId": participantObjectId }
      ],
    },
  );

  // 5. If no active users left in the nudge, mark it as completed
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

export const FriendsService = {
  getUsersFromDB,
  createNudgeInDB,
  joinNudgeInDB,
  getNudgeHistoryFromDB,
  removeFriendFromDB,
  unlockNudgeInDB,
  takeNudgeBreakInDB,
  getCurrentNudgeStatusInDB,
  addFriendToDB,
  getFriendsFromDB,
  removeNudgeParticipantFromDB,
};
