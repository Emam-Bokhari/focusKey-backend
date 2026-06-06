import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { TransactionService } from "./transaction.service";

const getAllTransactions = catchAsync(async (req: Request, res: Response) => {
  const result = await TransactionService.getAllTransactionsFromDB(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Transactions retrieved successfully",
    meta: result.meta,
    data: result.result,
  });
});

const getTransactionById = catchAsync(async (req: Request, res: Response) => {
  const { transactionId } = req.params;
  const result =
    await TransactionService.getTransactionByIdFromDB(transactionId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Transaction retrieved successfully",
    data: result,
  });
});

const getMyTransactions = catchAsync(async (req: Request, res: Response) => {
  const { id: agentId } = req.user as { id: string };
  const result = await TransactionService.getMyTransactionsFromDB(
    agentId,
    req.query,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Transactions retrieved successfully",
    meta: result.meta,
    data: result.result,
  });
});

const getMyTransactionById = catchAsync(async (req: Request, res: Response) => {
  const { id: agentId } = req.user as { id: string };
  const { transactionId } = req.params;
  const result = await TransactionService.getMyTransactionByIdFromDB(
    agentId,
    transactionId,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Transaction retrieved successfully",
    data: result,
  });
});

export const TransactionController = {
  getAllTransactions,
  getTransactionById,
  getMyTransactions,
  getMyTransactionById,
};
