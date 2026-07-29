import mongoose from "mongoose";
import { TPersonalReminder } from "./personalReminder.interface";
import { PersonalReminder } from "./personalReminder.model";

const createPersonalReminderToDB = async (
  personalReminder: TPersonalReminder,
  userId: string,
) => {
  personalReminder.userId = new mongoose.Types.ObjectId(userId);
  const data = await PersonalReminder.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId) },
    {
      $set: {
        message: personalReminder.message,
        userId: new mongoose.Types.ObjectId(userId),
      },
    },
    { upsert: true, new: true },
  );
  if (!data) {
    throw new Error("Failed to create personal reminder");
  }
  return data;
};

const getPersonalRemindersFromDB = async (userId: string) => {
  const data = await PersonalReminder.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!data) {
    return {};
  }
  return data;
};

export const PersonalReminderServices = {
  createPersonalReminderToDB,
  getPersonalRemindersFromDB,
};
