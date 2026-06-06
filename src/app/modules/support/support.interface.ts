import { Types } from "mongoose";
import { SUPPORT_STATUS } from "./support.constant";
import { ISoftDeleteModel } from "../../../types/softDelete";

export type TSupport = {
  userId: Types.ObjectId;
  name: string;
  email?: string;
  subject: string;
  message: string;
  attachment?: string;
  status?: SUPPORT_STATUS;
};

export type TSupportModel = ISoftDeleteModel<TSupport>;
