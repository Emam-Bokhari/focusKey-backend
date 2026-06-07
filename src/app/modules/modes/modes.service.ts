import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IMode } from "./modes.interface";
import { Mode } from "./modes.model";

const createModeToDB = async (payload: IMode): Promise<IMode> => {
  const result = await Mode.create(payload);
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create mode");
  }
  return result;
};

const getModesFromDB = async (userId: string) => {
  const result = await Mode.find({ userId });
  if (!result) {
    return [];
  }
  return result;
};

const getSingleModeFromDB = async (id: string) => {
  const result = await Mode.findById(id);
  if (!result) {
    return {};
  }
  return result;
};

const updateModeToDB = async (id: string, payload: Partial<IMode>) => {
  const result = await Mode.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }
  return result;
};

const deleteModeFromDB = async (id: string) => {
  const result = await Mode.findByIdAndDelete(id);
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Mode not found");
  }
  return result;
};

export const ModeService = {
  createModeToDB,
  getModesFromDB,
  getSingleModeFromDB,
  updateModeToDB,
  deleteModeFromDB,
};
