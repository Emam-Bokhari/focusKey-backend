import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PersonalReminderServices } from "./personalReminder.service";

const createPersonalReminder = catchAsync(async (req, res) => {
  const data = req.body;
  const userId = req.user.id;
  const result = await PersonalReminderServices.createPersonalReminderToDB(
    data,
    userId,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Personal reminder created successfully",
    data: result,
  });
});

const getPersonalReminders = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result =
    await PersonalReminderServices.getPersonalRemindersFromDB(userId);

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Personal reminders retrieved successfully",
    data: result,
  });
});

export const PersonalReminderControllers = {
  createPersonalReminder,
  getPersonalReminders,
};
