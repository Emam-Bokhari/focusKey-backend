import { Router } from "express";
import { ChatController } from "./chat.controller";
import { USER_ROLES } from "../../../enums/user";
import auth from "../../middlewares/auth";
import { isAuthenticated } from "../../../helpers/authHelper";

const router = Router();

router.get("/", isAuthenticated, ChatController.getChats);

router.get("/:chatId/images", isAuthenticated, ChatController.getChatImages);

router.post("/create-chat", isAuthenticated, ChatController.createChat);

router.patch(
  "/mark-chat-as-read/:id",
  isAuthenticated,
  ChatController.markChatAsRead,
);

router.delete("/delete/:chatId", isAuthenticated, ChatController.deleteChat);

export const ChatRoutes = router;
