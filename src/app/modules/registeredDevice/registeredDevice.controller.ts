import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { RegisteredDeviceService } from "./registeredDevice.service";

const createDevice = catchAsync(async (req: Request, res: Response) => {
  const result = await RegisteredDeviceService.createDeviceToDB(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Device registered successfully",
    data: result,
  });
});

const bulkCreateDevices = catchAsync(async (req: Request, res: Response) => {
  const result = await RegisteredDeviceService.bulkCreateDevicesToDB(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: result.message,
    data: result,
  });
});

const bulkUploadDevicesCsv = catchAsync(async (req: Request, res: Response) => {
  let devices: any[] = [];

  if (req.file) {
    const csvContent = req.file.buffer.toString("utf-8");
    devices = RegisteredDeviceService.parseDevicesFromCsv(csvContent);
  } else if (req.body) {
    if (Array.isArray(req.body)) {
      devices = req.body;
    } else if (Array.isArray(req.body.devices)) {
      devices = req.body.devices;
    }
  }

  const result = await RegisteredDeviceService.bulkCreateDevicesToDB(devices);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: result.message,
    data: result,
  });
});

const getAllDevices = catchAsync(async (req: Request, res: Response) => {
  const result = await RegisteredDeviceService.getAllDevicesFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Devices retrieved successfully",
    data: result,
  });
});

const getDeviceById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await RegisteredDeviceService.getDeviceByIdFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Device details retrieved successfully",
    data: result,
  });
});

const updateDevice = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await RegisteredDeviceService.updateDeviceToDB(id, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Device updated successfully",
    data: result,
  });
});

const deleteDevice = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await RegisteredDeviceService.deleteDeviceFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Device deleted successfully",
    data: result,
  });
});

const resetDevice = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await RegisteredDeviceService.resetDeviceToDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Device reset successfully",
    data: result,
  });
});

export const RegisteredDeviceController = {
  createDevice,
  bulkCreateDevices,
  bulkUploadDevicesCsv,
  getAllDevices,
  getDeviceById,
  updateDevice,
  deleteDevice,
  resetDevice,
};
