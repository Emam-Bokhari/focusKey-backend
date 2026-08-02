import { connection } from "../../config/bull";
import { Worker } from "bullmq";
import { emailHelper } from "../../helpers/emailHelper";

export const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    const { to, subject, html, userId, event } = job.data;

    await emailHelper.sendEmail({
      to,
      subject,
      html,
      userId,
      event,
    });
  },
  { connection },
);

emailWorker.on("completed", (job) => {
  console.log(`Email Sent: ${job.id}`);
});

emailWorker.on("failed", (job, error) => {
  console.log(`Email Failed: ${job?.id}, Error Message: ${error.message}`);
});
