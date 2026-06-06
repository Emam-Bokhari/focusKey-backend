import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../errors/ApiErrors";
import { User } from "../user.model";
import generateOTP from "../../../../util/generateOTP";
import { emailTemplate } from "../../../../shared/emailTemplate";
import { emailQueue } from "../../../../queues";
import { jwtHelper } from "../../../../helpers/jwtHelper";
import config from "../../../../config";
import { JwtPayload, Secret } from "jsonwebtoken";
import { STATUS, USER_ROLES } from "../../../../enums/user";
import { sendNotifications } from "../../../../helpers/notificationsHelper";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "../../notification/notification.constant";
import { IUser } from "../user.interface";
import unlinkFile from "../../../../shared/unlinkFile";
import bcrypt from "bcrypt";


const createUserToDB = async (payload: any) => {
  const isExistUser = await User.findOne({ email: payload.email });
  if (isExistUser) {
    throw new ApiError(StatusCodes.CONFLICT, "This Email already taken");
  }

  const createUser = await User.create(payload);
  if (!createUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create user");
  }

  //send email
  const otp = generateOTP();
  const values = {
    name: createUser.name,
    otp: otp,
    email: createUser.email!,
  };

  const createAccountTemplate = emailTemplate.createAccount(values);
  // emailHelper.sendEmail(createAccountTemplate);
  emailQueue.add("create-account-otp", createAccountTemplate);

  //save to DB
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };

  await User.findOneAndUpdate(
    { _id: createUser._id },
    { $set: { authentication, lastLoginAt: new Date() } },
  );

  const createToken = jwtHelper.createToken(
    {
      id: createUser._id,
      email: createUser.email,
      role: createUser.role,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  const result = {
    // token: createToken,
    user: createUser,
  };

  // notify admin
  const admin = await User.findOne({ role: USER_ROLES.SUPER_ADMIN }).select(
    "_id name",
  );

  if (admin) {
    await sendNotifications({
      title: "New User Signup",
      text: `New user signed up successfully`,
      receiver: admin._id.toString(),
      type: NOTIFICATION_TYPE.ADMIN,
      referenceId: result.user._id.toString(),
      referenceModel: NOTIFICATION_REFERENCE_MODEL.USER,
    });
  }

  return result;
};

const updateProfileToDB = async (
  user: JwtPayload,
  payload: Partial<IUser>,
): Promise<Partial<IUser | null>> => {
  const { id } = user;
  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //unlink file here
  if (payload.profileImage && isExistUser.profileImage) {
    unlinkFile(isExistUser.profileImage);
  }

  const updateDoc = await User.findOneAndUpdate({ _id: id }, payload, {
    new: true,
  });
  return updateDoc;
};

const updateUserStatusByIdToDB = async (
  id: string,
  status: STATUS.ACTIVE | STATUS.INACTIVE,
) => {
  if (![STATUS.ACTIVE, STATUS.INACTIVE].includes(status)) {
    throw new ApiError(400, "Status must be either 'ACTIVE' or 'INACTIVE'");
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "No user is found by this user ID",
    );
  }

  if (user.role === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "SUPER_ADMIN status cannot be changed",
    );
  }

  const result = await User.findByIdAndUpdate(id, { status }, { new: true });
  if (!result) {
    throw new ApiError(400, "Failed to change status by this user ID");
  }

  return result;
};

const deleteUserByIdFromDB = async (id: string) => {
  const user = await User.findById(id);

  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "User doest not exist in the database",
    );
  }

  if (user.role === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, "SUPER_ADMIN cannot be deleted");
  }

  const result = await User.findByIdAndDelete(id);

  if (!result) {
    throw new ApiError(400, "Failed to delete user by this ID");
  }

  return result;
};

const deleteProfileFromDB = async (id: string, password: string) => {
  // user exists?
  const user = await User.findById(id).select("+password");
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (user.role === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "SUPER_ADMIN account cannot be deleted",
    );
  }

  // check password
  const isPasswordMatch = await bcrypt.compare(password, user.password!);
  if (!isPasswordMatch) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect!");
  }

  // delete user
  const result = await User.findByIdAndDelete(id);
  if (!result) {
    throw new ApiError(400, "Failed to delete this user");
  }

  return result;
};

const createAdminToDB = async (payload: any): Promise<IUser> => {
  delete payload.phone;

  const isExistAdmin = await User.findOne({ email: payload.email });

  if (isExistAdmin) {
    throw new ApiError(StatusCodes.CONFLICT, "This Email already taken");
  }

  // ⚠️ IMPORTANT: password must come from payload (or generate if needed)
  const rawPassword = payload.password;

  const adminPayload = {
    ...payload,
    verified: true,
    status: STATUS.ACTIVE,
    role: USER_ROLES.ADMIN,
  };

  const createAdmin = await User.create(adminPayload);

  // ---------------- EMAIL TEMPLATE ----------------
  const template = emailTemplate.adminCredentials({
    name: payload.name,
    email: payload.email,
    password: rawPassword,
  });

  await emailQueue.add("admin-credentials-email", {
    to: template.to,
    subject: template.subject,
    html: template.html,
  });

  return createAdmin;
};

const deleteAdminFromDB = async (id: any) => {
  const isExistAdmin = await User.findById(id);

  if (!isExistAdmin) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Admin not found");
  }

  if (isExistAdmin.role === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Super Admin cannot be deleted");
  }

  const result = await User.findByIdAndDelete(id);

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to delete Admin");
  }

  return result;
};

export const UserCommands = {
  createUserToDB,
  updateProfileToDB,
  updateUserStatusByIdToDB,
  deleteUserByIdFromDB,
  deleteProfileFromDB,
  createAdminToDB,
  deleteAdminFromDB,
};
