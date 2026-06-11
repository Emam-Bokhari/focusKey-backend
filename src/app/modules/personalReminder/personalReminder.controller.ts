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

export const PersonalReminderControllers = {
  createPersonalReminder,
};
