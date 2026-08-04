import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { FriendsService } from "./friends.service";

const getUsers = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { searchTerm, page, limit } = req.query;

  const result = await FriendsService.getUsersFromDB(
    userId,
    searchTerm as string,
    Number(page) || 1,
    Number(limit) || 10,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Users fetched successfully",
    meta: result.meta,
    data: result.data,
  });
});

const initiateNudge = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const payload = req.body;

  const result = await FriendsService.initiateNudgePreviewInDB(userId, payload);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Nudge preview created. Fetch preview details before confirming.",
    data: result,
  });
});

const getNudgePreviewDetails = catchAsync(
  async (req: Request, res: Response) => {
    const userId = (req.user as any).id;
    const { previewId } = req.params;

    const result = await FriendsService.getNudgePreviewDetailsFromDB(
      userId,
      previewId,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Nudge preview details fetched successfully",
      data: result,
    });
  },
);

const confirmNudge = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { previewId } = req.params;

  const result = await FriendsService.confirmNudgeFromPreviewInDB(
    userId,
    previewId,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Nudge confirmed and invitations sent successfully",
    data: result,
  });
});

const getPendingNudgePreview = catchAsync(
  async (req: Request, res: Response) => {
    const userId = (req.user as any).id;

    const result = await FriendsService.getPendingNudgePreviewInDB(userId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: result.hasPendingPreview
        ? "Pending nudge preview found"
        : "No pending nudge preview",
      data: result,
    });
  },
);

const joinNudge = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.id || req.query.userId;
  const { nudgeId } = req.params;

  if (!userId) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message:
        "userId is required for joining nudge (pass as ?userId=... if not logged in)",
    });
    return;
  }

  const result = await FriendsService.joinNudgeInDB(userId, nudgeId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Joined nudge successfully",
    data: result,
  });
});

const getNudgeHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { page, limit } = req.query;

  const result = await FriendsService.getNudgeHistoryFromDB(
    userId,
    Number(page) || 1,
    Number(limit) || 10,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Nudge history fetched successfully",
    meta: result.meta,
    data: result.data,
  });
});

const removeFriend = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { friendId } = req.params;

  const result = await FriendsService.removeFriendFromDB(userId, friendId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Friend removed successfully",
    data: result,
  });
});

const unlockNudge = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { nudgeId } = req.params;

  const result = await FriendsService.unlockNudgeInDB(userId, nudgeId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Nudge unlocked and focus session ended successfully",
    data: result,
  });
});

const takeNudgeBreak = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { nudgeId } = req.params;

  const result = await FriendsService.takeNudgeBreakInDB(userId, nudgeId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Nudge break started successfully",
    data: result,
  });
});

const getCurrentNudgeStatus = catchAsync(
  async (req: Request, res: Response) => {
    const userId = (req.user as any).id;

    const result = await FriendsService.getCurrentNudgeStatusInDB(userId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Current nudge status fetched successfully",
      data: result,
    });
  },
);

const addFriend = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const friendId = req.body.friendId || req.params.friendId;

  if (!friendId) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "friendId is required",
    });
    return;
  }

  const result = await FriendsService.addFriendToDB(userId, friendId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Friend added successfully",
    data: result,
  });
});

const getFriends = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;

  const result = await FriendsService.getFriendsFromDB(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Friends fetched successfully",
    data: result,
  });
});

const leaveNudge = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { nudgeId } = req.params;

  const result = await FriendsService.leaveNudgeInDB(userId, nudgeId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const removeNudgeParticipant = catchAsync(
  async (req: Request, res: Response) => {
    const userId = (req.user as any).id;
    const { previewId, participantId } = req.body;

    if (!previewId || !participantId) {
      sendResponse(res, {
        statusCode: StatusCodes.BAD_REQUEST,
        success: false,
        message: "previewId and participantId are required",
      });
      return;
    }

    const result = await FriendsService.removeNudgeParticipantFromDB(
      userId,
      previewId,
      participantId,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Participant removed from nudge successfully",
      data: result,
    });
  },
);

export const FriendsController = {
  getUsers,
  initiateNudge,
  getNudgePreviewDetails,
  confirmNudge,
  getPendingNudgePreview,
  joinNudge,
  getNudgeHistory,
  removeFriend,
  unlockNudge,
  takeNudgeBreak,
  getCurrentNudgeStatus,
  addFriend,
  getFriends,
  leaveNudge,
  removeNudgeParticipant,
};
