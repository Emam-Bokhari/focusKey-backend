import express from "express";
import { isUser } from "../../../helpers/authHelper";
import { FriendsController } from "./friends.controller";
import optionalAuth from "../../middlewares/optionalAuth";
import { USER_ROLES } from "../../../enums/user";

const router = express.Router();

router.get("/users", isUser, FriendsController.getUsers);

router.post("/create-nudge", isUser, FriendsController.createNudge);

router.post("/join-nudge/:nudgeId", optionalAuth(USER_ROLES.USER), FriendsController.joinNudge);

router.post("/friend-details", isUser, FriendsController.getFriendDetails);

router.get("/nudge-history", isUser, FriendsController.getNudgeHistory);

export const FriendsRoutes = router;
