import express from "express";
import { MessageController } from "./message.controller";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import { parseFileData } from "../../middlewares/parseFileData";
import { isAuthenticated } from "../../../helpers/authHelper";
const router = express.Router();

// Existing routes
router.post(
  "/send-message/:chatId",
  isAuthenticated,
  fileUploadHandler(),
  parseFileData({ mode: "single", fieldName: "image" }),
  MessageController.sendMessage,
);

router.get("/:chatId", isAuthenticated, MessageController.getMessages);

router.delete(
  "/delete/:messageId",
  isAuthenticated,
  MessageController.deleteMessage,
);

// New route for pin/unpin message
router.patch(
  "/pin-unpin/:messageId",
  isAuthenticated,
  MessageController.pinUnpinMessage,
);

export const MessageRoutes = router;
