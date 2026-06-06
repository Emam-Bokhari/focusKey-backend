import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { FcmTokenService } from "./fcmService";

const saveDeviceToken = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;
  const result = await FcmTokenService.saveDeviceToken(user.id, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Device token saved successfully",
    data: result,
  });
});

export const FcmTokenController = {
  saveDeviceToken,
};
