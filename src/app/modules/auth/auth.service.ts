import bcrypt from "bcrypt";
import { StatusCodes } from "http-status-codes";
import { JwtPayload, Secret } from "jsonwebtoken";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import { jwtHelper } from "../../../helpers/jwtHelper";
import {
  IAuthResetPassword,
  IChangePassword,
  ILoginData,
  IVerifyEmail,
} from "../../../types/auth";
import { User } from "../user/user.model";
import cryptoToken from "../../../util/cryptoToken";
import { ResetToken } from "../resetToken/resetToken.model";
import generateOTP from "../../../util/generateOTP";
import { emailTemplate } from "../../../shared/emailTemplate";
import { STATUS, USER_ROLES } from "../../../enums/user";
import { sendNotifications } from "../../../helpers/notificationsHelper";
import {
  NOTIFICATION_REFERENCE_MODEL,
  NOTIFICATION_TYPE,
} from "../notification/notification.constant";
import { firebaseAdmin } from "../../../config/firebase";
import { FcmTokenService } from "../fcmToken/fcmService";
import { emailQueue } from "../../../queues";
import { ModeService } from "../modes/modes.service";

const loginUserFromDB = async (payload: ILoginData) => {
  const { email, password, fcmToken, deviceId, deviceType } = payload;

  const isExistUser = await User.findOne({ email }).select("+password");
  if (!isExistUser) {
    throw new ApiError(400, "User doesn't exist!");
  }

  if (!isExistUser.verified) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,

      "Please verify your account, then try to login again",
    );
  }

  if (isExistUser.status === STATUS.INACTIVE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,

      "You don’t have permission to access this content. It looks like your account has been deactivated.",
    );
  }

  if (
    password &&
    !(await User.isMatchPassword(password, isExistUser.password!))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect!");
  }

  if (fcmToken && deviceId && deviceType) {
    await FcmTokenService.saveDeviceToken(isExistUser._id, {
      fcmToken,
      deviceId,
      deviceType,
    });
  }

  await User.findByIdAndUpdate(isExistUser._id, { lastLoginAt: new Date() });
  await ModeService.ensureDefaultModesExist(isExistUser._id.toString());

  const createToken = jwtHelper.createToken(
    { id: isExistUser._id, role: isExistUser.role, email: isExistUser.email },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  const result = {
    token: createToken,
    user: isExistUser,
  };

  return result;
};

const forgetPasswordToDB = async (email: string) => {
  const isExistUser = await User.isExistUserByEmail(email);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const otp = generateOTP();
  const value = {
    otp,
    email: isExistUser.email,
  };

  const forgetPassword = emailTemplate.resetPassword(value);
  emailQueue.add("forget-password-otp", forgetPassword);

  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };
  await User.findOneAndUpdate({ email }, { $set: { authentication } });
};

const verifyEmailToDB = async (payload: IVerifyEmail) => {
  const { email, oneTimeCode } = payload;
  const isExistUser = await User.findOne({ email }).select("+authentication");
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (!oneTimeCode) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,

      "Please give the otp, check your email we send a code",
    );
  }

  if (isExistUser.authentication?.oneTimeCode !== oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You provided wrong otp");
  }

  const date = new Date();
  if (
    date > isExistUser.authentication?.expireAt! &&
    isExistUser.userName?.length
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,

      "Otp already expired, Please try again",
    );
  }

  let message;
  let data;

  if (!isExistUser.verified) {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      { verified: true, authentication: { oneTimeCode: null, expireAt: null } },
    );
    message = "Email verify successfully";
  } else {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      {
        authentication: {
          isResetPassword: true,
          oneTimeCode: null,
          expireAt: null,
        },
      },
    );

    const createToken = cryptoToken();
    await ResetToken.create({
      user: isExistUser._id,
      token: createToken,
      expireAt: new Date(Date.now() + 5 * 60000),
    });
    message =
      "Verification Successful: Please securely store and utilize this code for reset password";
    data = createToken;
  }
  return { data, message };
};

const resetPasswordToDB = async (
  token: string,
  payload: IAuthResetPassword,
) => {
  const { newPassword, confirmPassword } = payload;
  const isExistToken = await ResetToken.isExistToken(token);
  if (!isExistToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "You are not authorized");
  }

  const isExistUser = await User.findById(isExistToken.user).select(
    "+authentication",
  );
  if (!isExistUser?.authentication?.isResetPassword) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "You don't have permission to change the password. Please click again to 'Forgot Password'",
    );
  }

  const isValid = await ResetToken.isExpireToken(token);
  if (!isValid) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,

      "Token expired, Please click again to the forget password",
    );
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "New password and Confirm password doesn't match!",
    );
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const updateData = {
    password: hashPassword,
    authentication: { isResetPassword: false },
  };

  await User.findOneAndUpdate({ _id: isExistToken.user }, updateData, {
    new: true,
  });
};

const changePasswordToDB = async (
  user: JwtPayload,
  payload: IChangePassword,
) => {
  const { currentPassword, newPassword, confirmPassword } = payload;
  const isExistUser = await User.findById(user.id).select("+password");
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (
    currentPassword &&
    !(await User.isMatchPassword(currentPassword, isExistUser.password!))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect");
  }

  if (currentPassword === newPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,

      "Please give different password from current password",
    );
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Password and Confirm password doesn't matched",
    );
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const updateData = {
    password: hashPassword,
  };

  await User.findOneAndUpdate({ _id: user.id }, updateData, { new: true });
};

const newAccessTokenToUser = async (token: string) => {
  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Token is required!");
  }

  const verifyUser = jwtHelper.verifyToken(
    token,
    config.jwt.jwtRefreshSecret as Secret,
  );

  const isExistUser = await User.findById(verifyUser?.id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized access");
  }

  const accessToken = jwtHelper.createToken(
    { id: isExistUser._id, role: isExistUser.role, email: isExistUser.email },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  return { accessToken };
};

const resendVerificationEmailToDB = async (email: string) => {
  const existingUser: any = await User.findOne({ email: email }).lean();

  if (!existingUser) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,

      "User with this email does not exist!",
    );
  }

  if (existingUser?.verified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User is already verified!");
  }

  const otp = generateOTP();
  const emailValues = {
    name: existingUser.name,
    otp,
    email: existingUser.email,
  };

  const accountEmailTemplate = emailTemplate.createAccount(emailValues);
  emailQueue.add("resend-email-otp", accountEmailTemplate);

  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };

  await User.findOneAndUpdate(
    { email: email },
    { $set: { authentication } },
    { new: true },
  );
};

const deleteUserFromDB = async (user: JwtPayload, password: string) => {
  const isExistUser = await User.findById(user.id).select("+password");

  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (
    password &&
    !(await User.isMatchPassword(password, isExistUser.password!))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect");
  }

  const updateUser = await User.findByIdAndDelete(user.id);
  if (!updateUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const admin = await User.findOne({ role: USER_ROLES.SUPER_ADMIN }).select(
    "_id name",
  );

  if (admin) {
    await sendNotifications({
      title: "User Account Deleted",
      text: `User account deleted: ${updateUser.name} (${updateUser.email})`,
      receiver: admin._id.toString(),
      type: NOTIFICATION_TYPE.ADMIN,
    });
  }

  return;
};

const googleLoginService = async (payload: {
  token: string;
  fcmToken?: string;
  deviceId?: string;
  deviceType?: "ios" | "android" | "web";
}) => {
  const { token, fcmToken, deviceId, deviceType } = payload;

  if (!token) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Firebase ID token is required",
    );
  }

  let decoded;
  try {
    decoded = await firebaseAdmin.auth().verifyIdToken(token);
  } catch (error) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Invalid or expired Firebase token",
    );
  }

  const { uid: firebaseUid, email, name, picture, email_verified } = decoded;

  if (!email) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Email not found in Google account",
    );
  }

  if (!email_verified) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Please verify your email address with Google",
    );
  }

  let user = await User.findOne({
    firebaseUid,
  });

  if (user) {
    if (user.status === STATUS.INACTIVE) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Your account has been blocked. Please contact support.",
      );
    }

    if (user.email !== email || user.profileImage !== picture) {
      user.email = email;
      user.profileImage = picture || user.profileImage;
      user.verified = email_verified;
      await user.save();
    }
  } else {
    const [firstName, ...rest] = (name || "").trim().split(" ");
    const lastName = rest.join(" ");

    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    const baseUsername = email.split("@")[0];
    let userName = baseUsername;
    let counter = 1;

    while (await User.findOne({ userName })) {
      userName = `${baseUsername}${counter}`;
      counter++;
    }

    user = await User.create({
      firebaseUid,
      email,
      userName,
      name: fullName,
      profileImage: picture,
      verified: email_verified,
      status: STATUS.ACTIVE,
    });
  }

  if (fcmToken && deviceId && deviceType) {
    await FcmTokenService.saveDeviceToken(user._id, {
      fcmToken,
      deviceId,
      deviceType,
    });
  }

  await User.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });
  await ModeService.ensureDefaultModesExist(user._id.toString());

  const createToken = jwtHelper.createToken(
    { id: user._id, role: user.role, email: user.email },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  return {
    token: createToken,
    user,
  };
};

export const AuthService = {
  loginUserFromDB,
  forgetPasswordToDB,
  resetPasswordToDB,
  verifyEmailToDB,
  changePasswordToDB,
  newAccessTokenToUser,
  resendVerificationEmailToDB,
  deleteUserFromDB,
  googleLoginService,
};
