import { connection, defaultJobOptions } from "../../config/bull";
import { Queue } from "bullmq";

export const emailQueue = new Queue("emailQueue", {
  connection,
  defaultJobOptions,
});
