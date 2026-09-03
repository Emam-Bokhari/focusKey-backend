// import express, { Application, Request, Response } from "express";
// import cors from "cors";
// import { StatusCodes } from "http-status-codes";
// import { Morgan } from "./shared/morgan";
// import globalErrorHandler from "./app/middlewares/globalErrorHandler";
// import path from "path";
// import v2Router from "./app/routes/v2";
// import router from "./app/routes";
// import { serverAdapter } from "./config/bullboard";

// const app: Application = express();

// app.set("views", path.join(__dirname, "..", "views"));
// app.set("view engine", "ejs");

// app.use(Morgan.successHandler);
// app.use(Morgan.errorHandler);

// app.use(
//   cors({
//     origin: true,
//     credentials: true,
//   }),
// );

// app.use(express.json());

// app.use(express.urlencoded({ extended: true }));

// app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// app.use("/api/v1", router);
// router.use("/api/v2", v2Router);
// app.use("/admin/queues", serverAdapter.getRouter());

// app.get("/", (req: Request, res: Response) => {
//   res.send("Server is running...");
// });

// app.use((req: Request, res: Response) => {
//   res.status(StatusCodes.NOT_FOUND).json({
//     success: false,
//     message: "Not Found",
//     errorMessages: [
//       {
//         path: req.originalUrl,
//         message: "API DOESN'T EXIST",
//       },
//     ],
//   });
// });

// app.use(globalErrorHandler);

// export default app;


import express, { Application, Request, Response } from "express";
import cors from "cors";
import { StatusCodes } from "http-status-codes";
import { Morgan } from "./shared/morgan";
import globalErrorHandler from "./app/middlewares/globalErrorHandler";
import path from "path";
import v2Router from "./app/routes/v2";
import router from "./app/routes";
import { serverAdapter } from "./config/bullboard";

const app: Application = express();

app.set("views", path.join(__dirname, "..", "views"));
app.set("view engine", "ejs");

// Morgan
app.use(Morgan.successHandler);
app.use(Morgan.errorHandler);

// CORS
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Private Network Access (PNA)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Private-Network", "true");
  next();
});

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// API Routes
app.use("/api/v1", router);
router.use("/api/v2", v2Router);

// Bull Board
app.use("/admin/queues", serverAdapter.getRouter());

// Root route
app.get("/", (req: Request, res: Response) => {
  res.send("Server is running...");
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message: "Not Found",
    errorMessages: [
      {
        path: req.originalUrl,
        message: "API DOESN'T EXIST",
      },
    ],
  });
});

// Global Error Handler
app.use(globalErrorHandler);

export default app;

