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
} /* ================= USER ================= */
export type IUser = {
  name: string;

  role?: USER_ROLES;

  /* ================= HYBRID IDENTITY ================= */
  email: string;
  phone?: string;
  // phoneNumber?:string;
  countryCode?: string;
  country?: string;
  postalCode?: string;
  dateOfBirth?: Date;

  password: string;

  /* ================= VERIFICATION ================= */
  verified: boolean;
  isPaired: boolean;
  pairingCode?: string;

  status?: STATUS;
  userName?: string;

  installedApps?: IInstalledApp[];
  device?: IDevice;

  /* ================= PROFILE ================= */
  profileImage?: string;

  city?: string;
  gender?: GENDER;

  firebaseUid?: string;
  deviceToken?: string;

  /* ================= LOCATION ================= */
  location?: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
    address: string;
  };

  /* ================= AUTH ================= */
  authentication?: {
    isResetPassword?: boolean;
    oneTimeCode?: number;
    expireAt?: Date;
  };
  isDeleted?: boolean;
  deletedAt?: Date | null;
  lastLoginAt?: Date | null;
};

/* ================= STATIC METHODS ================= */
export interface IUserStatics {
  isExistUserById(id: string): Promise<IUser | null>;
  isExistUserByEmail(email: string): Promise<IUser | null>;
  isExistUserByPhone(phone: string): Promise<IUser | null>;
  isMatchPassword(password: string, hashPassword: string): Promise<boolean>;
}

export type IUserModel = ISoftDeleteModel<IUser> & IUserStatics;
