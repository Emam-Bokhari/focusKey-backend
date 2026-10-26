import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Secret } from "jsonwebtoken";
import config from "../../config";
import { User } from "../modules/user/user.model";
import ApiError from "../../errors/ApiErrors";
import { verifyToken } from "../../util/verifyToken";
import { STATUS } from "../../enums/user";

import { resolveTimezone } from "../../helpers/timezoneHelper";

interface ICachedAuthUser {
  id: string;
  status?: string;
  timezone?: string;
  role?: string;
  expiresAt: number;
}

const authUserCache = new Map<string, ICachedAuthUser>();

export const invalidateUserAuthCache = (userId: string) => {
  authUserCache.delete(userId);
};

const auth =
  (...roles: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tokenWithBearer = req.headers.authorization;
      if (!tokenWithBearer) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "You are not authorized !!",
        );
      }
      if (!tokenWithBearer.startsWith("Bearer")) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "Token send is not valid !!",
        );
      }

      if (tokenWithBearer && tokenWithBearer.startsWith("Bearer")) {
        const token = tokenWithBearer.split(" ")[1];

        let verifyUser: any;
        try {
          verifyUser = verifyToken(token, config.jwt.jwt_secret as Secret);
        } catch (error) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "You are not authorized !!",
          );
        }

        const nowMs = Date.now();
        const cachedUser = authUserCache.get(verifyUser.id);
        let user: { status?: string; timezone?: string; role?: string } | null =
          null;

        if (cachedUser && cachedUser.expiresAt > nowMs) {
          user = cachedUser;
        } else {
          const dbUser = await User.findById(verifyUser.id)
            .select("status timezone role")
            .lean();

          if (dbUser) {
            user = {
              status: dbUser.status,
              timezone: dbUser.timezone,
              role: dbUser.role,
            };
            authUserCache.set(verifyUser.id, {
              id: verifyUser.id,
              status: dbUser.status,
              timezone: dbUser.timezone,
              role: dbUser.role,
              expiresAt: nowMs + 60_000,
            });
          }
        }

        if (!user) {
          throw new ApiError(
            StatusCodes.NOT_FOUND,
            "This user is not found !!",
          );
        }

        if (user?.status === STATUS.INACTIVE) {
          throw new ApiError(StatusCodes.FORBIDDEN, "This user is blocked !!");
        }

        if (roles.length && !roles.includes(verifyUser?.role)) {
          throw new ApiError(
            StatusCodes.FORBIDDEN,
            "You don't have permission to access this api !!",
          );
        }

        const headerTz = (req.headers["x-timezone"] ||
          req.headers["timezone"]) as string;
        const queryTz = req.query.timezone as string;

        req.user = {
          ...verifyUser,
          timezone: resolveTimezone(user?.timezone, headerTz, queryTz),
        };
        next();
      }
    } catch (error) {
      next(error);
    }
  };

export default auth;
