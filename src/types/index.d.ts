import { JwtPayload } from "jsonwebtoken";
import { IPlan } from "../app/modules/plan/plan.interface";

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
      plan?: IPlan;
    }
  }
}
