import { connection } from "../../config/bull";
import { Worker } from "bullmq";
import { sendNotifications } from "../../helpers/notificationsHelper";

export const notificationWorker = new Worker(
  "notificationQueue",
  async (job) => {
    const { data } = job.data;

    await sendNotifications(data);
  },
  { connection },
);

notificationWorker.on("completed", (job) => {
  console.log(`Notification sent: ${job.id}`);
});

notificationWorker.on("failed", (job, error) => {
  console.log(
    `Failed Notification: ${job?.id}, Error Message: ${error.message}`,
  );
});
