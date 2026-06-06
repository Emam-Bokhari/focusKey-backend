import { model, Schema } from "mongoose";
import { RULE_TYPE, TRule } from "./rule.interface";

const ruleSchema = new Schema<TRule>(
  {
    content: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(RULE_TYPE),
      select: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Rule = model<TRule>("Rule", ruleSchema);
