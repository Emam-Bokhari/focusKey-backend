import ApiError from "../../../errors/ApiErrors";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { SupportServices } from "./support.service";

const submitSupportRequest = catchAsync(async (req, res) => {
  const supportData = req.body;

  if (!req.user) {
    throw new ApiError(401, "User not authenticated");
  }

  const { id } = req.user as any;

  const result = await SupportServices.support(id, supportData);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Support request submitted successfully and email sent to admin.",
    data: result,
  });
});

const getAllSupports = catchAsync(async (req, res) => {
  const result = await SupportServices.getAllSupportsFromDB(req.query);
  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Supports data are retrieve successfully",
    data: result,
  });
});

const getSupportById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await SupportServices.getSupportByIdFromDB(id);
  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Support data is retrieve successfully by this ID",
    data: result,
  });
});

const reviewSupportByAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const result = await SupportServices.reviewSupportByAdminToDB(id, status);
  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Support data is reviewed successfully",
    data: result,
  });
});

const deleteSupportById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await SupportServices.deleteSupportByIdFromDB(id);
  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Support data is deleted successfully",
    data: result,
  });
});

export const SupportControllers = {
  submitSupportRequest,
  getAllSupports,
  getSupportById,
  reviewSupportByAdmin,
  deleteSupportById,
};
