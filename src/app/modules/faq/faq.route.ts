import express from "express";
import { FaqController } from "./faq.controller";
import { isAdmin } from "../../../helpers/authHelper";

const router = express.Router();

router
  .route("/")
  .post(isAdmin, FaqController.createFaq)
  .get(FaqController.getFaqs);

router
  .route("/:id")
  .patch(isAdmin, FaqController.updateFaq)
  .delete(isAdmin, FaqController.deleteFaq);

export const FaqRoutes = router;
