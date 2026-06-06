import { Request, Response, NextFunction } from "express";
import { mapFilesToUrls, mapFileToUrl } from "./fileMapper";
import { IFolderName } from "./fileUploaderHandler";
import ApiError from "../../errors/ApiErrors";

// types
interface FileFieldConfig {
  fieldName: IFolderName;
  mode?: "single" | "multiple" | "auto";
}

type FieldInput = IFolderName | FileFieldConfig;

type MulterFiles = {
  [key in IFolderName]?: Express.Multer.File[];
};

// normalizer
const normalizeField = (field: FieldInput) => {
  if (typeof field === "string") {
    return { fieldName: field, mode: "auto" as const };
  }

  return {
    fieldName: field.fieldName,
    mode: field.mode ?? "auto",
  };
};

// safe json parse (FIXED)
const safeJsonParse = (value: any) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(400, "Invalid JSON in body.data");
  }
};

// auto mode resolver
const resolveMode = (
  mode: "single" | "multiple" | "auto",
  files?: Express.Multer.File[],
): "single" | "multiple" => {
  if (mode !== "auto") return mode;
  return files && files.length <= 1 ? "single" : "multiple";
};

// main middleware
export const parseFileData = (...fields: FieldInput[]) => {
  const normalized = fields.map(normalizeField);

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = (req.files || {}) as MulterFiles;

      const fileData: Record<string, string | string[]> = {};

      for (const { fieldName, mode } of normalized) {
        const fieldFiles = files[fieldName];

        if (!fieldFiles || fieldFiles.length === 0) continue;

        const resolvedMode = resolveMode(mode, fieldFiles);

        if (resolvedMode === "single") {
          fileData[fieldName] = mapFileToUrl(fieldFiles[0]!, fieldName);
        } else {
          fileData[fieldName] = mapFilesToUrls(fieldFiles, fieldName);
        }
      }

      let parsedBody: Record<string, unknown> = {};

      if (req.body?.data) {
        parsedBody = safeJsonParse(req.body.data);
      }

      req.body = {
        ...req.body,
        ...parsedBody,
        ...fileData,
      };

      if (req.body.data) {
        delete req.body.data;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
