import { Request } from "express";
import fs from "fs";
import path from "path";
import multer, { FileFilterCallback } from "multer";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiErrors";

// types
type FileConfig = {
  dir: string;
  maxCount: number;
  mimeTypes: Set<string>;
};

const BASE_UPLOAD_DIR = path.join(process.cwd(), "uploads");

// config
export const FILE_CONFIG = {
  image: {
    dir: "image",
    maxCount: 14,
    mimeTypes: new Set([
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/svg+xml",
    ]),
  },
  profileImage: {
    dir: "profileImage",
    maxCount: 1,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  images: {
    dir: "images",
    maxCount: 10,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  photos: {
    dir: "photos",
    maxCount: 10,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  floorPlans: {
    dir: "floorPlans",
    maxCount: 5,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  thumbnail: {
    dir: "thumbnail",
    maxCount: 5,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  logo: {
    dir: "logo",
    maxCount: 5,
    mimeTypes: new Set([
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/svg+xml",
    ]),
  },
  agencyLogo: {
    dir: "agencyLogo",
    maxCount: 1,
    mimeTypes: new Set([
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/svg+xml",
    ]),
  },
  banner: {
    dir: "banner",
    maxCount: 5,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  coverImage: {
    dir: "coverImage",
    maxCount: 1,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  threeSixtyTour: {
    dir: "threeSixtyTour",
    maxCount: 1,
    mimeTypes: new Set(["video/mp4", "video/webm"]),
  },
  attachment: {
    dir: "attachment",
    maxCount: 1,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]),
  },
  audio: {
    dir: "audio",
    maxCount: 5,
    mimeTypes: new Set(["audio/mpeg", "audio/wav", "audio/ogg"]),
  },
  videos: {
    dir: "videos",
    maxCount: 5,
    mimeTypes: new Set(["video/mp4", "video/webm"]),
  },
  document: {
    dir: "document",
    maxCount: 10,
    mimeTypes: new Set(["application/pdf", "text/plain", "application/msword"]),
  },
  brochure: {
    dir: "brochure",
    maxCount: 5,
    mimeTypes: new Set([
      "application/pdf",
      "text/plain",
      "application/msword",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ]),
  },
} satisfies Record<string, FileConfig>;

export type IFolderName = keyof typeof FILE_CONFIG;

// utils
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const generateFileName = (originalName: string) => {
  const ext = path.extname(originalName);
  const base = path
    .basename(originalName, ext)
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `${base}-${Date.now()}${ext}`;
};

// storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const config = FILE_CONFIG[file.fieldname as IFolderName];

    const dir = config
      ? path.join(BASE_UPLOAD_DIR, config.dir)
      : path.join(BASE_UPLOAD_DIR, "others");

    ensureDir(dir);
    cb(null, dir);
  },

  filename: (req, file, cb) => {
    cb(null, generateFileName(file.originalname));
  },
});

// file filter
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) => {
  const config = FILE_CONFIG[file.fieldname as IFolderName];

  if (!config) {
    return cb(new ApiError(StatusCodes.BAD_REQUEST, "Unsupported file field"));
  }

  if (!file.mimetype || !config.mimeTypes.has(file.mimetype)) {
    return cb(
      new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid file type for ${file.fieldname}`,
      ),
    );
  }

  cb(null, true);
};

// main upload
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

// optional field filtering (production improvement)
export const fileUploadHandler = (allowedFields?: IFolderName[]) => {
  const fields = Object.entries(FILE_CONFIG)
    .filter(
      ([name]) => !allowedFields || allowedFields.includes(name as IFolderName),
    )
    .map(([name, config]) => ({
      name,
      maxCount: config.maxCount,
    }));

  return upload.fields(fields);
};

export default fileUploadHandler;
