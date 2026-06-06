import { Router } from "express";
import { RuleControllers } from "./rule.controller";
import { USER_ROLES } from "../../../enums/user";
import auth from "../../middlewares/auth";

const router = Router();

router.post(
  "/",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  RuleControllers.upsertRule,
);

router.get("/:type", RuleControllers.getRule);

router.patch(
  "/:type",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  RuleControllers.updateRule,
);

router.delete(
  "/:type",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  RuleControllers.deleteRule,
);

export const RuleRoutes = router;
