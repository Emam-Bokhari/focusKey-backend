import { createClient } from "redis";
import config from "../config";

const redisClient = createClient({
  socket: {
    host: config.redis_host,
    port: parseInt(config.redis_port as string),
  },
  password: config.redis_password,
  database: parseInt(config.redis_db as string),
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

(async () => {
  await redisClient.connect();
  console.log("Redis connected");
})();

export default redisClient;
