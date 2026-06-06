import colors from "colors";
import { Server } from "socket.io";
import { logger } from "../shared/logger";

const socket = (io: Server) => {
  io.on("connection", (socket) => {
    logger.info(colors.blue("A User connected"));

    // disconnect
    socket.on("disconnect", (reason) => {
      logger.info(colors.red(`A user disconnect. Reason: ${reason}`));
    });
  });
};

export const socketHelper = { socket };
