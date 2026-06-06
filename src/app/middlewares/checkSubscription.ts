import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiErrors";
import { User } from "../modules/user/user.model";
import { IPlanFeatures } from "../modules/plan/plan.interface";
import { Subscription } from "../modules/subscription/subscription.model";

/**
 * Middleware to check if the user has an active subscription and optionally check for specific features.
 * @param requiredFeature Optional feature key to check if the plan supports it.
 */
const checkSubscription = (requiredFeature?: keyof IPlanFeatures) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const user = await User.findById(userId).populate("plan");
      if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
      }

      // Helper to send empty response instead of error
      const sendEmptyResponse = () => {
        const isArray =
          req.method === "GET" &&
          !req.params.listingId &&
          !req.params.enqueryId &&
          !req.params.id &&
          !req.url.includes("stats") &&
          !req.url.includes("dashboard");

        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Subscription required",
          data: isArray ? [] : {},
          ...(isArray && {
            meta: { page: 1, limit: 10, total: 0, totalPage: 0 },
          }),
        });
      };

      // Check if user has active subscription access in user model
      if (!user.hasAccess || !user.isSubscribed || !user.plan) {
        return sendEmptyResponse();
      }

      // Double check the subscription record for expiration
      const activeSubscription = await Subscription.findOne({
        userId: user._id,
        status: { $in: ["active", "trialing"] },
      }).sort({ createdAt: -1 });

      if (!activeSubscription) {
        return sendEmptyResponse();
      }

      // Check if current date is past currentPeriodEnd
      if (
        activeSubscription.currentPeriodEnd &&
        new Date() > activeSubscription.currentPeriodEnd
      ) {
        return sendEmptyResponse();
      }

      const plan = user.plan as any; // Populated plan

      // Check for specific feature if requested
      if (requiredFeature && !plan.features?.[requiredFeature]) {
        return sendEmptyResponse();
      }

      // Attach plan to request for use in controllers
      (req as any).plan = plan;

      next();
    } catch (error) {
      next(error);
    }
  };
};

export default checkSubscription;
