import mongoose from "mongoose";
import { User } from "../user/user.model";
import { Friend, Nudge } from "./friends.model";
import { IFriendStats, INudge } from "./friends.interface";
import { FocusSession } from "../focusSession/focusSession.model";
import { emailHelper } from "../../../helpers/emailHelper";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import config from "../../../config";

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
    role:USER_ROLES.USER,
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
      $in: participants.map((id) => new mongoose.Types.ObjectId(id as any)),
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
    const existingFriend = await Friend.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      friendId: new mongoose.Types.ObjectId(friendId as any),
      isDeleted: { $ne: true },
    });

    if (!existingFriend) {
      await Friend.create({
        userId: new mongoose.Types.ObjectId(userId),
        friendId: new mongoose.Types.ObjectId(friendId as any),
        status: "accepted",
      });
    }
  }

  // 2. Create Nudge
  const nudgeData = {
    creatorId: new mongoose.Types.ObjectId(userId),
    participants: participants.map(
      (id) => new mongoose.Types.ObjectId(id as any),
    ),
    joinedParticipants: [new mongoose.Types.ObjectId(userId)],
    modeId: new mongoose.Types.ObjectId(modeId as any),
    breakConfig,
    startTime: new Date(),
    status: "scheduled",
  };

  const result = await Nudge.create(nudgeData);

  // 3. Start Focus Session for Creator
  await FocusSession.create({
    userId: new mongoose.Types.ObjectId(userId),
    modeId: nudgeData.modeId,
    nudgeId: result._id,
    startTime: nudgeData.startTime,
    status: "active",
  });

  // 4. Send Emails
  const invitedUsers = await User.find({ _id: { $in: participants } });
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

  // Check if user is an invited participant
  const isInvited = nudge.participants.some((id) => id.equals(userObjectId));
  if (!isInvited) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not invited to this nudge",
    );
  }

  // Check if already joined
  const isAlreadyJoined = nudge.joinedParticipants.some((id) =>
    id.equals(userObjectId),
  );
  if (isAlreadyJoined) {
    return nudge;
  }

  // Add to joinedParticipants and activate nudge if it's the first friend joining
  const updateData: any = {
    $addToSet: { joinedParticipants: userObjectId },
  };

  if (nudge.status === "scheduled") {
    updateData.status = "active";
  }

  const result = await Nudge.findByIdAndUpdate(nudgeId, updateData, {
    new: true,
  });

  // Start Focus Session for the user
  await FocusSession.create({
    userId: userObjectId,
    modeId: nudge.modeId,
    nudgeId: nudge._id,
    startTime: new Date(),
    status: "active",
  });

  return result;
};

const getFriendDetailsFromDB = async (userId: string, friendIds: string[]) => {
  const friendObjectIds = friendIds.map((id) => new mongoose.Types.ObjectId(id));
  const allParticipants = [new mongoose.Types.ObjectId(userId), ...friendObjectIds].sort();

  const friendsData = await User.find({ _id: { $in: friendObjectIds } }).select(
    "name userName profileImage email",
  );

  const stats: IFriendStats[] = [];

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

    // 2. Together This Week
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Find nudges where participants match EXACTLY
    const nudges = await Nudge.find({
      status: "completed",
      startTime: { $gte: startOfWeek },
      $and: [
        { participants: { $all: friendObjectIds } },
        { participants: { $size: friendObjectIds.length } },
        { creatorId: new mongoose.Types.ObjectId(userId) }
      ]
    });

    // Actually, the user said "rafi, abong akib, 2 jon frined k select korlam... rafir sathe ai week a ak sathe focus thaka hoise but akib ar sathe thaki nai tahule this week a data show krbe na"
    // This implies we check if ALL selected friends were in the SAME session.
    
    let totalMinutes = 0;
    const daysWorked = new Set<string>();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const highlightedDays: string[] = [];

    nudges.forEach((n) => {
      if (n.endTime) {
        const duration = Math.round((n.endTime.getTime() - n.startTime.getTime()) / 60000);
        totalMinutes += duration;
        const day = n.startTime.getDay();
        daysWorked.add(dayNames[day]);
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    
    // Streak calculation (consecutive days this week)
    let streak = 0;
    const sortedDays = Array.from(daysWorked); // This needs better logic for consecutive days
    streak = sortedDays.length; // Placeholder

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
    $or: [{ creatorId: userObjectId }, { participants: userObjectId }],
    isDeleted: { $ne: true },
  };

  const nudges = await Nudge.find(query)
    .populate("creatorId", "name profileImage")
    .populate("participants", "name profileImage")
    .populate("joinedParticipants", "name profileImage")
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

  // 3. Remove user from joinedParticipants in the Nudge
  const result = await Nudge.findByIdAndUpdate(
    nudgeId,
    {
      $pull: { joinedParticipants: userObjectId },
    },
    { new: true },
  );

  // 4. Optional: If no one is left in the nudge, mark it as completed
  if (result && result.joinedParticipants.length === 0) {
    await Nudge.findByIdAndUpdate(nudgeId, { status: "completed" });
  }

  return result;
};

export const FriendsService = {
  getUsersFromDB,
  createNudgeInDB,
  joinNudgeInDB,
  getFriendDetailsFromDB,
  getNudgeHistoryFromDB,
  removeFriendFromDB,
  unlockNudgeInDB,
};
