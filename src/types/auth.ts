export type IVerifyEmail = {
  email: string;
  oneTimeCode: number;
};

export type ILoginData = {
  email?: string;
  phone?: string;
  password?: string;
  fcmToken?: string;
  deviceId?: string;
  deviceName?: string;
  deviceFingerprint?: string;
  deviceType?: "ios" | "android" | "web";
};

export type IAuthResetPassword = {
  newPassword: string;
  confirmPassword: string;
};

export type IChangePassword = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};
