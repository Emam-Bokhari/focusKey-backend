import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { FocusSessionService } from "./focusSession.service";

const getFocusHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { modeId } = req.query;

  const result = await FocusSessionService.getFocusHistoryFromDB(
    userId,
    modeId as string
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Focus history retrieved successfully",
    data: result,
  });
});

const getFocusStats = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await FocusSessionService.getFocusStatsFromDB(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Focus stats retrieved successfully",
    data: result,
  });
});

const exportHistoryToCSV = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await FocusSessionService.exportFocusHistoryToCSVFromDB(userId);

  const fileName = `focus_history_${new Date().toISOString().split("T")[0]}.csv`;

  // Headers optimized for both Web and Mobile App downloads
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Content-Length", Buffer.byteLength(result));

  res.status(StatusCodes.OK).send(result);
});

export const FocusSessionController = {
  getFocusHistory,
  getFocusStats,
  exportHistoryToCSV,
};
