import express, { Application, Request, Response } from "express";
import cors from "cors";
import { StatusCodes } from "http-status-codes";
import { Morgan } from "./shared/morgan";
import globalErrorHandler from "./app/middlewares/globalErrorHandler";
import path from "path";
import v2Router from "./app/routes/v2";
import router from "./app/routes";
import { serverAdapter } from "./config/bullboard";
import { WebhookRoutes } from "./app/modules/webhook/webhook.route";

const app: Application = express();

app.set("views", path.join(__dirname, "..", "views"));
app.set("view engine", "ejs");

// morgan
app.use(Morgan.successHandler);
app.use(Morgan.errorHandler);

//body parser
app.use(
  cors({ 
    origin: true, 
    credentials: true 
  }),
);

// Stripe Webhook (MUST be before express.json())
app.use("/api/v1/webhooks", WebhookRoutes);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

//file retrieve
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

//router
app.use("/api/v1", router);
router.use("/api/v2", v2Router);
app.use("/admin/queues", serverAdapter.getRouter());

app.get("/", (req: Request, res: Response) => {
  res.send("Server is running...");
});

// handle not found route
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

//global error handle
app.use(globalErrorHandler);

export default app;
