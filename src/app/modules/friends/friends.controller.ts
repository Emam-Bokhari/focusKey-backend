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

const createNudge = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const payload = req.body;

  const result = await FriendsService.createNudgeInDB(userId, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Nudge created and invitations sent successfully",
    data: result,
  });
});

const joinNudge = catchAsync(async (req: Request, res: Response) => {
  // Try to get userId from req.user (auth), or from query (for testing without auth)
  const userId = (req.user as any)?.id || req.query.userId;
  const { nudgeId } = req.params;

  if (!userId) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "userId is required for joining nudge (pass as ?userId=... if not logged in)",
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

const getFriendDetails = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;
  const { friendIds } = req.body; // Expecting an array of IDs

  const result = await FriendsService.getFriendDetailsFromDB(userId, friendIds);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Friend details fetched successfully",
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

const getCurrentNudgeStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any).id;

  const result = await FriendsService.getCurrentNudgeStatusInDB(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Current nudge status fetched successfully",
    data: result,
  });
});

export const FriendsController = {
  getUsers,
  createNudge,
  joinNudge,
  getFriendDetails,
  getNudgeHistory,
  removeFriend,
  unlockNudge,
  takeNudgeBreak,
  getCurrentNudgeStatus,
};
