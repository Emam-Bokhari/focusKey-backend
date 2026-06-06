import { Response } from "express";

type IData<T> = {
  success: boolean;
  statusCode: number;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    totalPage: number;
    total: number;
  };
  meta?: any;
  stats?: Record<string, any>;
  data?: T;
};

const sendResponse = <T>(res: Response, data: IData<T>) => {
  const resData = {
    success: data.success,
    message: data.message,
    data: data.data,
    meta: data.meta,
    stats: data.stats,

    pagination: data.pagination,
  };

  res.status(data.statusCode).json(resData);
};

export default sendResponse;
