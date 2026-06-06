import { StatusCodes } from "http-status-codes";
import { Rule } from "./rule.model";
import { RULE_TYPE } from "./rule.interface";
import ApiError from "../../../errors/ApiErrors";

const upsertRule = async (type: RULE_TYPE, content: string) => {
  const result = await Rule.findOneAndUpdate(
    { type },
    { content, type },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const isNew = result.isNew ?? true;
  const message = isNew
    ? `${type} created successfully`
    : `${type} updated successfully`;

  return { message, result };
};

const getRuleByType = async (type: RULE_TYPE) => {
  const result = await Rule.findOne({ type: type.toUpperCase() });

  if (!result) {
    return {};
  }

  return result;
};

const updateRule = async (type: RULE_TYPE, content: string) => {
  const result = await Rule.findOneAndUpdate(
    { type: type.toUpperCase() },
    { content },
    { new: true },
  );

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${type} not found`);
  }

  return { message: `${type} updated successfully`, result };
};

const deleteRule = async (type: RULE_TYPE) => {
  const result = await Rule.findOneAndDelete({ type: type.toUpperCase() });

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, `${type} not found`);
  }

  return result;
};

export const RuleServices = {
  upsertRule,
  getRuleByType,
  updateRule,
  deleteRule,
};
