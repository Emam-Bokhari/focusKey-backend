import express from "express";
import { PersonalReminderControllers } from "./personalReminder.controller";
import { isPairedUser } from "../../../helpers/authHelper";

const router = express.Router();

router.post("/", isPairedUser, PersonalReminderControllers.createPersonalReminder);
router.get("/", isPairedUser, PersonalReminderControllers.getPersonalReminders);

export const PersonalReminderRoutes = router;
