import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PlanServices } from "./plan.service";

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.createPlanToDB(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Plan created successfully",
    data: result,
  });
});

const getAllPlans = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.getAllPlansFromDB(req.query);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Plans fetched successfully",
    data: result,
  });
});

const getPlanById = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.getPlanByIdFromDB(req.params.planId);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Plan fetched successfully",
    data: result,
  });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.updatePlanToDB(req.params.planId, req.body);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Plan updated successfully",
    data: result,
  });
});

const deletePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.deletePlanFromDB(req.params.planId);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Plan deleted successfully",
    data: result,
  });
});

export const PlanControllers = {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  deletePlan,
};
