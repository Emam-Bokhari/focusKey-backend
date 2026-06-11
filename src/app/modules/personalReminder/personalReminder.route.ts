import express from "express";
import { PersonalReminderControllers } from "./personalReminder.controller";
import { isUser } from "../../../helpers/authHelper";

const router = express.Router();

router.post("/", isUser, PersonalReminderControllers.createPersonalReminder);
router.get("/", isUser, PersonalReminderControllers.getPersonalReminders);

export const PersonalReminderRoutes = router;
