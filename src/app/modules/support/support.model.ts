import { model, Schema } from "mongoose";
import { TSupport, TSupportModel } from "./support.interface";
import { SUPPORT_STATUS } from "./support.constant";
import { softDeletePlugin } from "../../../DB/plugins/softDeletePlugin";

const supportSchema = new Schema<TSupport, TSupportModel>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    name: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: false,
    },
    subject: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    attachment: {
      type: String,
      default: "",
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(SUPPORT_STATUS),
      default: SUPPORT_STATUS.PENDING,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

supportSchema.plugin(softDeletePlugin);

export const Support = model<TSupport, TSupportModel>("Support", supportSchema);
