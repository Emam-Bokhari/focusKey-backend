import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { NotificationService } from "./notification.service";

// --- USER & AGENT CONTROLLERS ---

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.getNotificationsFromDB(
    req.user,
    req.query,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notifications retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const readNotifications = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.readNotificationsToDB(req.user);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notifications marked as read successfully",
    data: result,
  });
});

const getSingleNotification = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.getSingleNotificationFromDB(
      req.user,
      req.params.id,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Notification retrieved successfully",
      data: result,
    });
  },
);

const readSingleNotification = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.readSingleNotificationToDB(
      req.user,
      req.params.id,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Notification marked as read successfully",
      data: result,
    });
  },
);

// --- ADMIN & SUPER_ADMIN CONTROLLERS ---

const getAdminNotifications = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.getAdminNotificationsFromDB(
      req.query,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Admin notifications retrieved successfully",
      data: result.data,
      meta: result.meta,
    });
  },
);

const readAdminNotifications = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.readAdminNotificationsToDB();

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Admin notifications marked as read successfully",
      data: result,
    });
  },
);

const getAdminSingleNotification = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.getAdminSingleNotificationFromDB(
      req.params.id,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Admin notification retrieved successfully",
      data: result,
    });
  },
);

const readAdminSingleNotification = catchAsync(
  async (req: Request, res: Response) => {
    const result = await NotificationService.readAdminSingleNotificationToDB(
      req.params.id,
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Admin notification marked as read successfully",
      data: result,
    });
  },
);

export const NotificationController = {
  getNotifications,
  readNotifications,
  getSingleNotification,
  readSingleNotification,
  getAdminNotifications,
  readAdminNotifications,
  getAdminSingleNotification,
  readAdminSingleNotification,
};
