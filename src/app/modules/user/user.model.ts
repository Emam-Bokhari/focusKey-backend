import { model, Schema } from "mongoose";
import { GENDER, STATUS, USER_ROLES } from "../../../enums/user";
import { IUser, IUserModel } from "./user.interface";
import bcrypt from "bcrypt";
import config from "../../../config";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const installedAppSchema = new Schema(
  {
    packageName: {
      type: String,
      required: true,
      trim: true,
    },
    appName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    isSystemApp: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const deviceSchema = new Schema(
  {
    deviceName: { type: String, required: true, trim: true },

    platform: {
      type: String,
      enum: ["android", "ios", "web"],
      required: true,
      index: true,
    },

    deviceFingerprint: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    nfcChip: {
      type: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const userSchema = new Schema<IUser, IUserModel>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    userName: {
      type: String,
      required: false,
      trim: true,
    },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      unique: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    countryCode: {
      type: String,
    },

    country: {
      type: String,
    },

    postalCode: {
      type: String,
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    timezone: {
      type: String,
      default: "UTC",
      trim: true,
    },

    installedApps: [installedAppSchema],

    device: deviceSchema,

    password: {
      type: String,
      required: true,
      select: false,
      minlength: 8,
    },

    verified: {
      type: Boolean,
      default: false,
    },

    isPaired: {
      type: Boolean,
      default: false,
    },

    pairingCode: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.ACTIVE,
    },

    profileImage: {
      type: String,
      default: "",
    },

    city: {
      type: String,
      required: false,
      trim: true,
    },

    gender: {
      type: String,
      enum: Object.values(GENDER),
    },

    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
    },

    deviceToken: {
      type: String,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: undefined,
        validate: {
          validator: (v: number[]) => !v || v.length === 2,
          message: "Coordinates must be [longitude, latitude]",
        },
      },
      address: {
        type: String,
        default: "",
      },
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    authentication: {
      type: {
        isResetPassword: { type: Boolean, default: false },
        oneTimeCode: { type: Number, default: null },
        expireAt: { type: Date, default: null },
      },
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.index({ email: 1 });
userSchema.index({ role: 1, verified: 1, status: 1 });
userSchema.index({ role: 1, isDeleted: 1 });
userSchema.index({ userName: 1 });
userSchema.index({ name: 1 });
userSchema.index({ location: "2dsphere" });

userSchema.plugin(softDeletePlugin);

userSchema.statics.isExistUserById = async function (id: string) {
  return await this.findById(id);
};

userSchema.statics.isExistUserByEmail = async function (email: string) {
  return await this.findOne({ email });
};

userSchema.statics.isExistUserByPhone = async function (phone: string) {
  return await this.findOne({ phone });
};

userSchema.statics.isMatchPassword = async function (
  password: string,
  hashPassword: string,
) {
  return await bcrypt.compare(password, hashPassword);
};

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  if (this.password) {
    this.password = await bcrypt.hash(
      this.password,
      Number(config.bcrypt_salt_rounds),
    );
  }

  next();
});

export const User = model<IUser, IUserModel>("User", userSchema);
