import cron from "node-cron";
import { logger } from "../../shared/logger";
import { BreakService } from "../modules/breaks/breaks.service";

const handleExpiredBreaks = async () => {
  try {
    const result = await BreakService.updateExpiredBreaks();

    if (result.modifiedCount > 0) {
      logger.info(
        `Cron Job: ${result.modifiedCount} expired breaks marked as completed.`,
      );

      //@ts-ignore
      const io = global.io;
      if (io) {
        result.userIds.forEach((userId) => {
          io.emit(`breakEnded::${userId}`, {
            message: "Your break has ended. Apps are now locked.",
            isLocked: true,
          });
        });
      }
    }
  } catch (error) {
    logger.error("Cron Job Error (handleExpiredBreaks):", error);
  }
};

const initBreakCron = () => {
  cron.schedule("* * * * *", () => {
    handleExpiredBreaks();
  });
  logger.info("Break Cron Job initialized (Running every minute)");
};

export const CronJobs = {
  initBreakCron,
};
