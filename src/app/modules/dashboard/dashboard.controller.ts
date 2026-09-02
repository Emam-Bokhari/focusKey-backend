import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { DashboardService } from "./dashboard.service";

const getDashboardData = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await DashboardService.getDashboardData(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Dashboard data retrieved successfully",
    data: result,
  });
});

const getHistoryData = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await DashboardService.getHistoryData(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Focus history retrieved successfully",
    data: result,
  });
});

const getHistoryV2 = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await DashboardService.getHistoryV2(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Focus history retrieved successfully",
    data: result,
  });
});

const getAdminDashboardData = catchAsync(
  async (req: Request, res: Response) => {
    const result = await DashboardService.getAdminDashboardData();

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Admin dashboard data retrieved successfully",
      data: result,
    });
  },
);

export const DashboardController = {
  getDashboardData,
  getHistoryData,
  getHistoryV2,
  getAdminDashboardData,
};
