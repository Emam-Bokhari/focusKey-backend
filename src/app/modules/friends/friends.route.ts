import express from "express";
import { isPairedUser } from "../../../helpers/authHelper";
import { FriendsController } from "./friends.controller";

const router = express.Router();

// Users search / discovery
router.get("/users", isPairedUser, FriendsController.getUsers);

// Friend details & actions
router.get("/details/:friendId", isPairedUser, FriendsController.getFriendDetails);
router.post("/send-nudge/:friendId?", isPairedUser, FriendsController.sendNudge);
router.post("/send-nudge", isPairedUser, FriendsController.sendNudge);
router.delete(
  "/remove-friend/:friendId",
  isPairedUser,
  FriendsController.removeFriend,
);

// Friends focusing status & list
router.get(
  "/focusing-status",
  isPairedUser,
  FriendsController.getFriendsFocusingStatus,
);
router.get("/list", isPairedUser, FriendsController.getFriends);
router.get("/nudge-history", isPairedUser, FriendsController.getNudgeHistory);

// Friend requests
router.post("/send-request", isPairedUser, FriendsController.sendFriendRequest);
router.post("/add-friend", isPairedUser, FriendsController.oldAddFriend);
router.get(
  "/received-requests",
  isPairedUser,
  FriendsController.getReceivedFriendRequests,
);
router.get("/sent-requests", isPairedUser, FriendsController.getSentFriendRequests);
router.post(
  "/respond-request/:requestId",
  isPairedUser,
  FriendsController.handleFriendRequestAction,
);

export const FriendsRoutes = router;
