import { Router } from "express";
import { TransactionController } from "./transaction.controller";
import { isAdmin, isAgent } from "../../../helpers/authHelper";

const router = Router();

router.get("/", isAdmin, TransactionController.getAllTransactions);

router.get(
  "/my-transactions",
  isAgent,
  TransactionController.getMyTransactions,
);

router.get(
  "/my-transactions/:transactionId",
  isAgent,
  TransactionController.getMyTransactionById,
);

router.get(
  "/:transactionId",
  isAdmin,
  TransactionController.getTransactionById,
);

export const TransactionRoutes = router;
