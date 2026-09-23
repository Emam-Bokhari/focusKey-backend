import cron from "node-cron";
import { logger } from "../../shared/logger";
import { BreakService } from "../modules/breaks/breaks.service";
import { FocusSessionService } from "../modules/focusSession/focusSession.service";

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

const handleDanglingSessions = async () => {
  try {
    const result = await FocusSessionService.healDanglingSessions();
    if (result.healedSessionsCount > 0 || result.healedBreaksCount > 0) {
      logger.info(
        `Cron Job (handleDanglingSessions): Auto-healed ${result.healedSessionsCount} dangling sessions and ${result.healedBreaksCount} dangling breaks.`,
      );
    }
  } catch (error) {
    logger.error("Cron Job Error (handleDanglingSessions):", error);
  }
};

const initBreakCron = () => {
  cron.schedule("* * * * *", () => {
    handleExpiredBreaks();
  });
  logger.info("Break Cron Job initialized (Running every minute)");

  cron.schedule("*/30 * * * *", () => {
    handleDanglingSessions();
  });
  logger.info(
    "Dangling Sessions Auto-Heal Cron Job initialized (Running every 30 minutes)",
  );
};

export const CronJobs = {
  initBreakCron,
  handleDanglingSessions,
};
