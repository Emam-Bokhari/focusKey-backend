import { StatusCodes } from "http-status-codes";
import { Banner } from "./banner.model";
import unlinkFile from "../../../shared/unlinkFile";
import mongoose from "mongoose";
import { TBanner } from "./banner.interface";
import ApiError from "../../../errors/ApiErrors";

const createBannerToDB = async (payload: TBanner): Promise<TBanner> => {
  // If the new banner is set to be active, deactivate all other banners first.
  if (payload.status === true) {
    await Banner.updateMany({}, { $set: { status: false } });
  }

  const createBanner: any = await Banner.create(payload);
  if (!createBanner) {
    // Safely unlink file only if path exists and is not empty
    if (payload.image) {
      unlinkFile(payload.image);
    }
    throw new ApiError(400, "Failed to create banner");
  }

  return createBanner;
};

const getBannerFromDB = async (): Promise<TBanner | null> => {
  return await Banner.findOne({ status: true });
};

const getAllBannerFromDB = async (): Promise<TBanner[]> => {
  return await Banner.find({});
};

const updateBannerToDB = async (id: string, payload: TBanner) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.NOT_ACCEPTABLE, "Invalid ID");
  }

  // If the banner is being activated, deactivate all others first.
  if (payload.status === true) {
    await Banner.updateMany({ _id: { $ne: id } }, { $set: { status: false } });
  }

  const isBannerExist: any = await Banner.findById(id);

  if (!isBannerExist) {
    throw new ApiError(404, "Banner not found");
  }

  // If a new image is uploaded, delete the old one.
  if (payload.image && isBannerExist.image) {
    unlinkFile(isBannerExist.image);
  }

  const banner: any = await Banner.findByIdAndUpdate(id, payload, {
    new: true,
  });

  return banner;
};

const updateBannerStatusToDB = async (id: string, status: boolean) => {
  const banner = await Banner.findById(id);
  if (!banner) {
    throw new ApiError(404, "No banner found in the database");
  }

  const result = await Banner.findByIdAndUpdate(id, { status }, { new: true });
  if (!result) {
    throw new ApiError(400, "Failed to update status");
  }

  return result;
};

const deleteBannerToDB = async (id: string) => {
  const isBannerExist: any = await Banner.findById({ _id: id });

  // delete from folder
  if (isBannerExist) {
    unlinkFile(isBannerExist?.image);
  }

  // delete from database
  const result = await Banner.findByIdAndDelete(id);

  return result;
};

export const BannerService = {
  createBannerToDB,
  getBannerFromDB,
  getAllBannerFromDB,
  updateBannerToDB,
  deleteBannerToDB,
  updateBannerStatusToDB,
};
