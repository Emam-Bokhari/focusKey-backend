import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../errors/ApiErrors";
import { User } from "../user.model";
import generateOTP from "../../../../util/generateOTP";
import { emailTemplate } from "../../../../shared/emailTemplate";
import mongoose from "mongoose";
import { RegisteredDevice } from "../../registeredDevice/registeredDevice.model";
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
import { IDevice, IUser } from "../user.interface";
import unlinkFile from "../../../../shared/unlinkFile";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { ModeService } from "../../modes/modes.service";

const generatePairingCode = (): string => {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 character hex code
};

const handleUserPairing = async (
  userId: string,
  payload: {
    uid: string;
    device_fingerprint?: string;
    deviceFingerprint?: string;
    device_id?: string;
    device_model: string;
    platform: "android" | "ios" | "web";
  }
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }

    if (user.isPaired) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Already paired. Please unpair first.");
    }

    // Resolve deviceFingerprint from input
    const fingerprint = (payload.deviceFingerprint || payload.device_fingerprint || payload.device_id || "").trim();
    
    // Security check on deviceFingerprint: reject placeholder values
    const lowercaseFingerprint = fingerprint.toLowerCase();
    const invalidFingerprints = ["", "unknown", "null", "undefined", "000000", "android", "ios"];
    if (invalidFingerprints.includes(lowercaseFingerprint)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device fingerprint.");
    }

    // Find RegisteredDevice
    const device = await RegisteredDevice.findOne({ uid: payload.uid, status: "ACTIVE" }).session(session);
    if (!device) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Device is not registered.");
    }

    // Check if paired with another user
    if (device.userId && device.userId.toString() !== userId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "This NFC key is already paired with another user.");
    }

    // If tag has never been paired before OR is currently unpaired, store/update credentials
    if (!device.userId || (!device.deviceFingerprint && !device.platform)) {
      device.deviceFingerprint = fingerprint;
      device.deviceModel = payload.device_model;
      device.platform = payload.platform;
      device.userId = new mongoose.Types.ObjectId(userId);
      device.pairedAt = new Date();
      if (!device.firstPairedAt) {
        device.firstPairedAt = new Date();
      }
      device.lastPairedAt = new Date();
    } else {
      // If tag has been paired before and is currently paired, verify fingerprint and platform match
      if (device.deviceFingerprint !== fingerprint || device.platform !== payload.platform) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "This NFC key is already paired with another device.");
      }
      device.userId = new mongoose.Types.ObjectId(userId);
      device.deviceModel = payload.device_model; // model can still be updated
      device.pairedAt = new Date();
      device.lastPairedAt = new Date();
    }

    await device.save({ session });

    // Update User
    user.isPaired = true;
    user.device = {
      deviceName: payload.device_model,
      platform: payload.platform,
      deviceFingerprint: fingerprint,
      nfcChip: payload.uid,
    };
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Emit Socket event
    //@ts-ignore
    const io = global.io;
    if (io) {
      io.emit(`device-pairing-updated::${userId}`, {
        status: "PAIRED",
        device: user.device,
      });
    }

    return user;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const handleUserUnpairing = async (userId: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }

    const device = await RegisteredDevice.findOne({ userId }).session(session);
    if (device) {
      device.userId = null;
      device.pairedAt = null;
      device.lastUnpairedAt = new Date();
      await device.save({ session });
    }

    user.isPaired = false;
    user.device = undefined;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Emit Socket event
    //@ts-ignore
    const io = global.io;
    if (io) {
      io.emit(`device-pairing-updated::${userId}`, {
        status: "UNPAIRED",
      });
    }

    return user;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const createUserToDB = async (payload: any) => {
  const isExistUser = await User.findOne({ email: payload.email });
  if (isExistUser) {
    throw new ApiError(StatusCodes.CONFLICT, "This Email already taken");
  }

  if (!payload.userName && payload.email) {
    const baseUsername = payload.email.split("@")[0];
    let userName = baseUsername;
    let counter = 1;
    while (await User.findOne({ userName })) {
      userName = `${baseUsername}${counter}`;
      counter++;
    }
    payload.userName = userName;
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

  await ModeService.ensureDefaultModesExist(createUser._id.toString());

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
  handleUserPairing,
  handleUserUnpairing,
};
