import { Request, Response } from "express";
import { BannerService } from "./banner.service";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";

const createBanner = catchAsync(async (req, res) => {
  const bannerData = req.body;
  const result = await BannerService.createBannerToDB(bannerData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner created successfully",
    data: result,
  });
});

const getBannersFromDB = catchAsync(async (req: Request, res: Response) => {
  const result = await BannerService.getBannerFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner retrieved successfully",
    data: result,
  });
});

const getAllBanner = catchAsync(async (req: Request, res: Response) => {
  const result = await BannerService.getAllBannerFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner retrieved successfully",
    data: result,
  });
});

const updateBanner = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const updateData = req.body;

  const result = await BannerService.updateBannerToDB(id, updateData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner updated successfully",
    data: result,
  });
});

const updateBannerStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const result = await BannerService.updateBannerStatusToDB(id, status);
  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Banner status updated successfully",
    data: result,
  });
});

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id;
  const result = await BannerService.deleteBannerToDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner deleted successfully",
    data: result,
  });
});

export const BannerController = {
  createBanner,
  getBannersFromDB,
  getAllBanner,
  updateBanner,
  deleteBanner,
  updateBannerStatus,
};
