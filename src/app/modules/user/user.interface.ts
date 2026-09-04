import { GENDER, STATUS, USER_ROLES } from "../../../enums/user";
import { ISoftDeleteModel } from "../../../types/softDelete";

export interface IInstalledApp {
  packageName: string;
  appName: string;
}

export interface IDevice {
  deviceName: string;
  platform: "android" | "ios" | "web";
  deviceFingerprint: string;
  nfcChip?: string;
}
export type IUser = {
  name: string;

  role?: USER_ROLES;

  email: string;
  phone?: string;
  countryCode?: string;
  country?: string;
  postalCode?: string;
  dateOfBirth?: Date;
  timezone?: string;

  password: string;

  verified: boolean;
  isPaired: boolean;
  pairingCode?: string;

  status?: STATUS;
  userName?: string;

  installedApps?: IInstalledApp[];
  device?: IDevice;

  profileImage?: string;

  city?: string;
  gender?: GENDER;

  firebaseUid?: string;
  deviceToken?: string;

  location?: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
    address: string;
  };

  authentication?: {
    isResetPassword?: boolean;
    oneTimeCode?: number;
    expireAt?: Date;
  };
  isDeleted?: boolean;
  deletedAt?: Date | null;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export interface IUserStatics {
  isExistUserById(id: string): Promise<IUser | null>;
  isExistUserByEmail(email: string): Promise<IUser | null>;
  isExistUserByPhone(phone: string): Promise<IUser | null>;
  isMatchPassword(password: string, hashPassword: string): Promise<boolean>;
}

export type IUserModel = ISoftDeleteModel<IUser> & IUserStatics;
