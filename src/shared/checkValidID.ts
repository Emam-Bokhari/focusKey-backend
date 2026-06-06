import { z } from "zod";
import mongoose from "mongoose";

export const checkValidID = (fieldName: string) =>
  z.string().refine(
    (val) => {
      if (!val) {
        return false;
      }
      if (!mongoose.Types.ObjectId.isValid(val)) {
        return false;
      }
      return true;
    },
    {
      message: `${fieldName}`,
    },
  );
