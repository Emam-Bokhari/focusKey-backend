import { IFolderName } from "./fileUploaderHandler";

type MulterFile = Express.Multer.File;

export const mapFileToUrl = (
  file: MulterFile,
  folderName: IFolderName,
): string => {
  return `/uploads/${folderName}/${file.filename}`;
};

export const mapFilesToUrls = (
  files: MulterFile[],
  folderName: IFolderName,
): string[] => {
  return files.map((file) => mapFileToUrl(file, folderName));
};
