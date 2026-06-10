import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { FriendsController } from "./friends.controller";
import optionalAuth from "../../middlewares/optionalAuth";
import { USER_ROLES } from "../../../enums/user";

const router = express.Router();

router.get("/users", isUser, FriendsController.getUsers);

router.post("/create-nudge", isUser, FriendsController.createNudge);

router.get("/join-nudge/:nudgeId", optionalAuth(USER_ROLES.USER), FriendsController.joinNudge);

router.post("/join-nudge/:nudgeId", optionalAuth(USER_ROLES.USER), FriendsController.joinNudge);

router.post("/friend-details", isUser, FriendsController.getFriendDetails);

router.get("/nudge-history", isUser, FriendsController.getNudgeHistory);

router.delete("/remove-friend/:friendId", isUser, FriendsController.removeFriend);

router.post("/unlock-nudge/:nudgeId", isUser, FriendsController.unlockNudge);

router.post("/take-nudge-break/:nudgeId", isUser, FriendsController.takeNudgeBreak);


export const FriendsRoutes = router;
