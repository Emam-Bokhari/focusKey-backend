export type ICreateAccount = {
  name: string;
  email: string;
  otp: number;
};

export type IResetPassword = {
  email: string;
  otp: number;
};

export type IAdminCredentials = {
  name: string;
  email: string;
  password: string;
};
