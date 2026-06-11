import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AnalyticsServices } from "./analytics.service";

const getStats = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsServices.getStatsFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Analytics data retrieved successfully",
    data: result,
  });
});

const getFocusTimeOverTime = catchAsync(async (req: Request, res: Response) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const days = req.query.days ? Number(req.query.days) : undefined;
  const result = await AnalyticsServices.getFocusTimeOverTime(year, days);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Focus time over time data retrieved successfully",
    data: result,
  });
});

const getUsersAnalytics = catchAsync(async (req: Request, res: Response) => {
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;

  const result = await AnalyticsServices.getUsersAnalyticsFromDB(page, limit, search, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Users analytics data retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

export const AnalyticsControllers = {
  getStats,
  getFocusTimeOverTime,
  getUsersAnalytics,
};
