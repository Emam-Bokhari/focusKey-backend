import express from "express";
import { isAdmin } from "../../../helpers/authHelper";
import { PlanControllers } from "./plan.controller";
import validateRequest from "../../middlewares/validateRequest";
import { PlanValidations } from "./plan.validation";

const router = express.Router();

router
  .route("/")
  .post(
    isAdmin,
    validateRequest(PlanValidations.createPlanValidationSchema),
    PlanControllers.createPlan,
  )
  .get(PlanControllers.getAllPlans);

router
  .route("/:planId")
  .get(PlanControllers.getPlanById)
  .patch(
    isAdmin,
    validateRequest(PlanValidations.updatePlanValidationSchema),
    PlanControllers.updatePlan,
  )
  .delete(isAdmin, PlanControllers.deletePlan);

export const PlanRoutes = router;
