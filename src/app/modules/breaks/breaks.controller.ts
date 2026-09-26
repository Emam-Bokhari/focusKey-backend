import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { BreakService } from "./breaks.service";

const startBreak = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const userTimezone = req.user.timezone;
  const result = await BreakService.startBreak(userId, userTimezone);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Break started successfully. Apps are now unlocked.",
    data: result,
  });
});

const getActiveBreakStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const userTimezone = req.user.timezone;
  const result = await BreakService.getActiveBreakStatus(userId, userTimezone);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Active break status retrieved successfully",
    data: result,
  });
});

const getRemainingBreaks = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const userTimezone = req.user.timezone;
  const result = await BreakService.getRemainingBreaks(userId, userTimezone);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Remaining breaks info retrieved successfully",
    data: result,
  });
});

const stopBreak = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await BreakService.stopBreak(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Break stopped successfully. Apps are now locked again.",
    data: result,
  });
});

const getGlobalBreakConfig = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const userTimezone = req.user.timezone;
  const result = await BreakService.getGlobalBreakConfig(userId, userTimezone);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Global break config retrieved successfully",
    data: result,
  });
});

const updateGlobalBreakConfig = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await BreakService.updateGlobalBreakConfig(userId, req.body);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Global break config updated successfully",
      data: result,
    });
  },
);

const reconcileBreak = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const userTimezone = req.user.timezone;
  const result = await BreakService.reconcileBreakFromDB(
    userId,
    req.body,
    userTimezone,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

export const BreakController = {
  startBreak,
  getActiveBreakStatus,
  getRemainingBreaks,
  stopBreak,
  getGlobalBreakConfig,
  updateGlobalBreakConfig,
  reconcileBreak,
};
