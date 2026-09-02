import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { FriendsController } from "./friends.controller";
import optionalAuth from "../../middlewares/optionalAuth";
import { USER_ROLES } from "../../../enums/user";

const router = express.Router();

router.get("/users", isUser, FriendsController.getUsers);

router.post("/nudge/initiate", isUser, FriendsController.initiateNudge);
router.get(
  "/nudge/pending-preview",
  isUser,
  FriendsController.getPendingNudgePreview,
);

router.get(
  "/nudge/preview/:previewId",
  isUser,
  FriendsController.getNudgePreviewDetails,
);

router.post(
  "/nudge/confirm/:previewId",
  isUser,
  FriendsController.confirmNudge,
);

router.get(
  "/join-nudge/:nudgeId",
  optionalAuth(USER_ROLES.USER),
  FriendsController.joinNudge,
);

router.post(
  "/join-nudge/:nudgeId",
  optionalAuth(USER_ROLES.USER),
  FriendsController.joinNudge,
);

router.get("/nudge-history", isUser, FriendsController.getNudgeHistory);

router.delete(
  "/remove-friend/:friendId",
  isUser,
  FriendsController.removeFriend,
);

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

router.get("/list", isUser, FriendsController.getFriends);

router.post("/unlock-nudge/:nudgeId", isUser, FriendsController.unlockNudge);

router.post("/leave-nudge/:nudgeId", isUser, FriendsController.leaveNudge);

router.post(
  "/take-nudge-break/:nudgeId",
  isUser,
  FriendsController.takeNudgeBreak,
);

router.get(
  "/current-nudge-status",
  isUser,
  FriendsController.getCurrentNudgeStatus,
);

router.post(
  "/remove-participant",
  isUser,
  FriendsController.removeNudgeParticipant,
);

export const FriendsRoutes = router;