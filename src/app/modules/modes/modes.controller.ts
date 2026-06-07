import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ModeService } from "./modes.service";

const createMode = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const payload = { ...req.body, userId };
  const result = await ModeService.createModeToDB(payload, userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode created successfully",
    data: result,
  });
});

const getModes = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ModeService.getModesFromDB(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Modes retrieved successfully",
    data: result,
  });
});

const getSingleMode = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const result = await ModeService.getSingleModeFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode retrieved successfully",
    data: result,
  });
});

const updateMode = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const payload = req.body;
  const result = await ModeService.updateModeToDB(id, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode updated successfully",
    data: result,
  });
});

const deleteMode = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const result = await ModeService.deleteModeFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode deleted successfully",
    data: result,
  });
});

export const ModeController = {
  createMode,
  getModes,
  getSingleMode,
  updateMode,
  deleteMode,
};
