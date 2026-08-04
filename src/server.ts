import mongoose from "mongoose";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./shared/logger";
import colors from "colors";
import { socketHelper } from "./helpers/socketHelper";
import { Server } from "socket.io";
import seedSuperAdmin from "./DB";
import {
  emailWorker,
  notificationWorker,
  emailQueue,
  notificationQueue,
} from "./queues";
import "./queues";
import "dotenv/config";
import { CronJobs } from "./app/cronJobs/breakCron";

let server: any;

const shutdown = async () => {
  logger.info("Graceful shutdown started...");

  try {
    await Promise.all([emailWorker.close(), notificationWorker.close()]);

    await Promise.all([emailQueue.close(), notificationQueue.close()]);

    if (server) {
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  } catch (error) {
    errorLogger.error("Shutdown error", error);
    process.exit(1);
  }
};

process.on("uncaughtException", (error) => {
  errorLogger.error("uncaughtException Detected", error);
  shutdown();
});

async function main() {
  try {
    await mongoose.connect(config.database_url as string);
    seedSuperAdmin();

    logger.info(colors.green("Database connected successfully"));

    const port =
      typeof config.port === "number" ? config.port : Number(config.port);

    server = app.listen(port, config.ip_address as string, () => {
      logger.info(
        colors.yellow(`Application listening on port:${config.port}`),
      );
    });

    const io = new Server(server, {
      pingTimeout: 60000,
      pingInterval: 25000,
      cors: { origin: "*" },
      transports: ["websocket", "polling"],
    });

    socketHelper.socket(io);
    //@ts-ignore
    global.io = io;

    CronJobs.initBreakCron();
  } catch (error) {
    errorLogger.error(colors.red("Failed to connect Database"));
    process.exit(1);
  }

  process.on("unhandledRejection", (error) => {
    errorLogger.error("UnhandledRejection Detected", error);
    shutdown();
  });
}

main();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
