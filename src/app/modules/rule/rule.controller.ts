import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { RuleServices } from "./rule.service";
import { RULE_TYPE } from "./rule.interface";

const upsertRule = catchAsync(async (req: Request, res: Response) => {
  const { type, content } = req.body;

  const { message, result } = await RuleServices.upsertRule(type, content);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message,
    data: result,
  });
});

const getRule = catchAsync(async (req: Request, res: Response) => {
  const { type } = req.params;

  const result = await RuleServices.getRuleByType(type as RULE_TYPE);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: `${type.charAt(0).toUpperCase() + type.slice(1)} retrieved successfully`,
    data: result,
  });
});

const updateRule = catchAsync(async (req: Request, res: Response) => {
  const { type } = req.params;
  const { content } = req.body;

  const { message, result } = await RuleServices.updateRule(
    type as RULE_TYPE,
    content,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message,
    data: result,
  });
});

const deleteRule = catchAsync(async (req: Request, res: Response) => {
  const { type } = req.params;

  const result = await RuleServices.deleteRule(type as RULE_TYPE);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Successfully deleted",
    data: result,
  });
});

export const RuleControllers = {
  upsertRule,
  getRule,
  updateRule,
  deleteRule,
};
