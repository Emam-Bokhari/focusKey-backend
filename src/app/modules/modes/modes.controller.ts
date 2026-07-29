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
  const modeId = req.params.modeId;
  const result = await ModeService.getSingleModeFromDB(modeId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode retrieved successfully",
    data: result,
  });
});

const updateMode = catchAsync(async (req: Request, res: Response) => {
  const modeId = req.params.modeId;
  const payload = req.body;
  const result = await ModeService.updateModeToDB(modeId, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode updated successfully",
    data: result,
  });
});

const deleteMode = catchAsync(async (req: Request, res: Response) => {
  const modeId = req.params.modeId;
  const result = await ModeService.deleteModeFromDB(modeId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode deleted successfully",
    data: result,
  });
});

const toggleModeActivation = catchAsync(async (req: Request, res: Response) => {
  const modeId = req.params.modeId;
  const userId = req.user.id;
  const result = await ModeService.toggleModeActivation(modeId, userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode activation toggled successfully",
    data: result,
  });
});

const getModeAppCount = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ModeService.getModeAppCount(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode app count retrieved successfully",
    data: result,
  });
});

const getModeAppDetails = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ModeService.getModeAppDetails(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Mode app details retrieved successfully",
    data: result,
  });
});

const getSingleModeAppDetails = catchAsync(
  async (req: Request, res: Response) => {
    const modeId = req.params.modeId;
    const userId = req.user.id;
    const result = await ModeService.getSingleModeAppDetails(modeId, userId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Single mode app details retrieved successfully",
      data: result,
    });
  },
);

const getTotalFocusApps = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ModeService.getTotalFocusApps(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Total focus apps retrieved successfully",
    data: result,
  });
});

const getLockStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ModeService.getLockStatusFromDB(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Lock status retrieved successfully",
    data: result,
  });
});

export const ModeController = {
  createMode,
  getModes,
  getSingleMode,
  updateMode,
  deleteMode,
  toggleModeActivation,
  getModeAppCount,
  getModeAppDetails,
  getSingleModeAppDetails,
  getTotalFocusApps,
  getLockStatus,
};
