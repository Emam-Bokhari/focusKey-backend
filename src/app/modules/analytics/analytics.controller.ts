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

const getFocusTimeTogetherOverTime = catchAsync(
  async (req: Request, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const days = req.query.days ? Number(req.query.days) : undefined;
    const result = await AnalyticsServices.getFocusTimeTogetherOverTime(
      year,
      days,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Focus time together over time data retrieved successfully",
      data: result,
    });
  },
);

const getUsersAnalytics = catchAsync(async (req: Request, res: Response) => {
  // Support both "search" and "searchTerm"
  const query = { ...req.query };
  if (query.search && !query.searchTerm) {
    query.searchTerm = query.search;
  }

  const result = await AnalyticsServices.getUsersAnalyticsFromDB(query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Users analytics data retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSingleUserAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const result = await AnalyticsServices.getSingleUserAnalyticsFromDB(
      req.params.userId,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Single user analytics data retrieved successfully",
      data: result,
    });
  },
);

const getEngagementStats = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsServices.getEngagementStatsFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Engagement stats data retrieved successfully",
    data: result,
  });
});

export const AnalyticsControllers = {
  getStats,
  getFocusTimeOverTime,
  getFocusTimeTogetherOverTime,
  getUsersAnalytics,
  getSingleUserAnalytics,
  getEngagementStats,
};
