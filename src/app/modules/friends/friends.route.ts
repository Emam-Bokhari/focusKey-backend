import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { FriendsController } from "./friends.controller";

const router = express.Router();

// Users search / discovery
router.get("/users", isUser, FriendsController.getUsers);

// Friend details & actions
router.get("/details/:friendId", isUser, FriendsController.getFriendDetails);
router.post("/send-nudge/:friendId?", isUser, FriendsController.sendNudge);
router.post("/send-nudge", isUser, FriendsController.sendNudge);
router.delete(
  "/remove-friend/:friendId",
  isUser,
  FriendsController.removeFriend,
);

// Friends focusing status & list
router.get(
  "/focusing-status",
  isUser,
  FriendsController.getFriendsFocusingStatus,
);
router.get("/list", isUser, FriendsController.getFriends);
router.get("/nudge-history", isUser, FriendsController.getNudgeHistory);

// Friend requests
router.post("/send-request", isUser, FriendsController.sendFriendRequest);
router.post("/add-friend", isUser, FriendsController.oldAddFriend);
router.get(
  "/received-requests",
  isUser,
  FriendsController.getReceivedFriendRequests,
);
router.get("/sent-requests", isUser, FriendsController.getSentFriendRequests);
router.post(
  "/respond-request/:requestId",
  isUser,
  FriendsController.handleFriendRequestAction,
);

export const FriendsRoutes = router;
