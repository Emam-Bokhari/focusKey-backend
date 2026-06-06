import express, { NextFunction, Request, Response } from "express";
import validateRequest from "../../middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";
import { isAuthenticated } from "../../../helpers/authHelper";
const router = express.Router();

router.post(
  "/login",
  validateRequest(AuthValidation.createLoginZodSchema),
  AuthController.loginUser,
);

router.post(
  "/forget-password",
  validateRequest(AuthValidation.createForgetPasswordZodSchema),
  AuthController.forgetPassword,
);

router.post("/refresh-token", AuthController.newAccessToken);

router.post("/resend-otp", AuthController.resendVerificationEmail);

router.post(
  "/verify-email",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, oneTimeCode } = req.body;

      req.body = { email, oneTimeCode: Number(oneTimeCode) };
      next();
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Failed to convert string to number" });
    }
  },
  validateRequest(AuthValidation.createVerifyEmailZodSchema),
  AuthController.verifyEmail,
);

router.post(
  "/reset-password",
  validateRequest(AuthValidation.createResetPasswordZodSchema),
  AuthController.resetPassword,
);

router.post(
  "/change-password",
  isAuthenticated,
  validateRequest(AuthValidation.createChangePasswordZodSchema),
  AuthController.changePassword,
);

router.post("/resend-otp", AuthController.resendVerificationEmail);

router.delete("/delete-account", isAuthenticated, AuthController.deleteUser);

// google login
router.post("/google-login", AuthController.googleLogin);

export const AuthRoutes = router;
