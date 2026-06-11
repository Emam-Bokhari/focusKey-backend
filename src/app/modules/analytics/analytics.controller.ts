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

export const AnalyticsControllers = {
  getStats,
  getFocusTimeOverTime,
};
