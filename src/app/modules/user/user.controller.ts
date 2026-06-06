import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import bcrypt from "bcrypt";
import config from "../../../config";
import { UserCommands } from "./services/user.command";
import { UserQueries } from "./services/user.query";

const createUser = catchAsync(async (req, res) => {
  const { ...userData } = req.body;

  const result = await UserCommands.createUserToDB(userData);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message:
      "Your account has been successfully created. Verify Your Email By OTP. Check your email",
    data: result,
  });
});

const getUserProfile = catchAsync(async (req, res) => {
  const user = req.user;
  const result = await UserQueries.getUserProfileFromDB(user as JwtPayload);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Profile data retrieved successfully",
    data: result,
  });
});

//update profile
const updateProfile = catchAsync(async (req, res) => {
  const user: any = req.user;
  if ("role" in req.body) {
    delete req.body.role;
  }
  // if ("phone" in req.body) {
  //   delete req.body.phone;
  // }
  // If password is provided
  if (req.body.password) {
    req.body.password = await bcrypt.hash(
      req.body.password,
      Number(config.bcrypt_salt_rounds),
    );
  }

  const result = await UserCommands.updateProfileToDB(user, req.body);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Profile updated successfully",
    data: result,
  });
});

const getAllUsers = catchAsync(async (req, res) => {
  const result = await UserQueries.getAllUsersFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Successfully retrieved are users data",
    data: result.data,
    meta: result.meta,
  });
});

const getUserById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await UserQueries.getUserByIdFromDB(id);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Successfully retrieve user by ID",
    data: result,
  });
});

const updateUserStatusById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const { status } = req.body;

  const result = await UserCommands.updateUserStatusByIdToDB(id, status);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Status updated successfully",
    data: result,
  });
});

const deleteUserById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await UserCommands.deleteUserByIdFromDB(id);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "User is deleted successfully",
    data: result,
  });
});

const deleteProfile = catchAsync(async (req, res) => {
  const { id }: any = req.user;
  // console.log(id, "ID");
  const { password } = req.body;

  const result = await UserCommands.deleteProfileFromDB(id, password);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Profile deleted successfully",
    data: result,
  });
});

const createAdmin = catchAsync(async (req, res) => {
  const userData = req.body;
  // console.log(userData, "payload");
  const result = await UserCommands.createAdminToDB(userData);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Admin created successfully",
    data: result,
  });
});

const getAdmin = catchAsync(async (req, res) => {
  const result = await UserQueries.getAdminFromDB(req.query);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin retrieved Successfully",
    data: result.data,
    meta: result.meta,
  });
});

const deleteAdmin = catchAsync(async (req, res) => {
  const payload = req.params.id;
  const result = await UserCommands.deleteAdminFromDB(payload);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin Deleted Successfully",
    data: result,
  });
});

export const UserControllers = {
  createUser,
  getUserProfile,
  updateProfile,
  getAllUsers,
  getUserById,
  updateUserStatusById,
  deleteUserById,
  deleteProfile,
  createAdmin,
  getAdmin,
  deleteAdmin,
};
