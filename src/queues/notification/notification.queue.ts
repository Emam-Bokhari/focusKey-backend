import { Queue } from "bullmq";
import { connection, defaultJobOptions } from "../../config/bull";

export const notificationQueue = new Queue("notificationQueue", {
  connection,
  defaultJobOptions,
});
